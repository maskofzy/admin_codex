import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { AdminRepository, AdminRepositoryError } from '../src/services/admin-repository.js';

test('schema adds durable single and batch compensation audit tables', async () => {
  const schema = await readFile(new URL('../database/schema.sql', import.meta.url), 'utf8');
  for (const table of [
    'guild', 'guild_member', 'gift_compensation', 'compensation_job',
    'compensation_job_item',
  ]) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(schema, /UNIQUE KEY uq_gift_compensation_event \(event_id\)/);
  assert.match(schema, /UNIQUE KEY uq_compensation_job_request \(request_id\)/);
  assert.match(schema, /UNIQUE KEY uq_compensation_job_payload \(payload_hash\)/);
  assert.match(schema, /UNIQUE KEY uq_compensation_job_active_target \(active_target_room_id\)/);
  assert.match(schema, /UNIQUE KEY uq_compensation_job_item_event \(event_id\)/);
  assert.match(schema, /UNIQUE KEY uq_compensation_job_source_claim \(claimed_source_gift_event_id\)/);
  assert.match(schema, /status = 'cancelled' AND cancel_releases_source/u);
  assert.match(schema, /lease_expires_at DATETIME\(3\)/);
  assert.match(schema, /source_snapshot_max_event_id BIGINT UNSIGNED NOT NULL/);
  assert.match(schema, /FOREIGN KEY \(source_gift_event_id\) REFERENCES live_gift_event \(id\)/);
  assert.match(schema, /UNIQUE KEY uq_guild_join_code \(join_code\)/);
  assert.match(schema, /UNIQUE KEY uq_guild_member_user \(user_id\)/);
  assert.match(schema, /UNIQUE KEY uq_guild_manager \(guild_id, manager_slot\)/);
  assert.match(schema, /status ENUM\('pending', 'enqueued', 'duplicate', 'failed'\)/);
  assert.match(schema, /status ENUM\('pending', 'running', 'completed', 'failed', 'cancelled'\)/);
  assert.doesNotMatch(schema, /comment_history|like_history/);
  for (const table of [
    'game_config', 'game_config_revision', 'platform_user', 'live_room', 'game_round',
    'pending_player_group', 'round_player_group', 'round_player_score',
    'leaderboard_period_score',
  ]) {
    assert.doesNotMatch(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
  }
});

test('prepareGiftCompensation persists pending before enqueue and reuses terminal records', async () => {
  let stored;
  const calls = [];
  const connection = transactionConnection(async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('INSERT INTO gift_compensation')) {
      if (!stored) stored = compensationRowFromInsert(params);
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('FROM gift_compensation') && sql.includes('FOR UPDATE')) {
      return [[stored]];
    }
    if (sql.includes("SET status = 'pending'")) {
      stored.status = 'pending';
      stored.last_error = '';
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const repository = new AdminRepository({ async getConnection() { return connection; } });
  const input = compensationInput();

  const prepared = await repository.prepareGiftCompensation(input);
  assert.equal(prepared.shouldEnqueue, true);
  assert.deepEqual(prepared.event, input.event);
  assert.equal(prepared.compensation.status, 'pending');
  assert.ok(calls.findIndex(call => call.sql.includes('INSERT INTO gift_compensation'))
    < calls.findIndex(call => call.sql.includes('FOR UPDATE')));

  stored.status = 'enqueued';
  stored.attempt_count = 1;
  stored.enqueued_at = '2026-08-07 08:00:01.000';
  const completedRetry = await repository.prepareGiftCompensation(input);
  assert.equal(completedRetry.shouldEnqueue, false);
  assert.equal(completedRetry.compensation.status, 'enqueued');
});

test('prepareGiftCompensation recovers failed records and rejects event payload conflicts', async () => {
  const input = compensationInput();
  const stored = compensationRowFromInsert([
    input.platform, input.eventId, input.roomId, input.userId, input.nickname,
    input.giftId, input.giftName, input.count, input.payloadHash,
    JSON.stringify(input.event), input.reason, input.createdAt,
  ]);
  stored.status = 'failed';
  stored.last_error = 'Redis unavailable';
  const connection = transactionConnection(async (sql) => {
    if (sql.includes('INSERT INTO gift_compensation')) return [{ affectedRows: 0 }];
    if (sql.includes('FROM gift_compensation') && sql.includes('FOR UPDATE')) return [[stored]];
    if (sql.includes("SET status = 'pending'")) {
      stored.status = 'pending';
      stored.last_error = '';
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const repository = new AdminRepository({ async getConnection() { return connection; } });

  const recovered = await repository.prepareGiftCompensation(input);
  assert.equal(recovered.shouldEnqueue, true);
  assert.equal(recovered.compensation.status, 'pending');

  await assert.rejects(
    repository.prepareGiftCompensation({ ...input, payloadHash: 'b'.repeat(64) }),
    error => error instanceof AdminRepositoryError
      && error.code === 'compensation_payload_conflict'
      && error.status === 409,
  );
});

test('retryGiftCompensation reuses stored pending or failed payloads and rejects terminal rows', async () => {
  const input = compensationInput();
  const stored = compensationRowFromInsert([
    input.platform, input.eventId, input.roomId, input.userId, input.nickname,
    input.giftId, input.giftName, input.count, input.payloadHash,
    JSON.stringify(input.event), input.reason, input.createdAt,
  ]);
  stored.status = 'failed';
  stored.last_error = 'Redis unavailable';
  const calls = [];
  const connection = transactionConnection(async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('FROM gift_compensation') && sql.includes('FOR UPDATE')) return [[stored]];
    if (sql.includes("SET status = 'pending'")) {
      stored.status = 'pending';
      stored.last_error = '';
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const repository = new AdminRepository({ async getConnection() { return connection; } });

  const failedRetry = await repository.retryGiftCompensation({
    platform: 'dy', eventId: 'event-1', retriedAt: new Date('2026-08-07T08:01:00.000Z'),
  });
  assert.deepEqual(failedRetry.event, input.event);
  assert.equal(failedRetry.compensation.status, 'pending');
  assert.deepEqual(calls[0].params, ['dy', 'event-1']);

  const writesAfterFailed = calls.filter(call => call.sql.includes("SET status = 'pending'")).length;
  const pendingRetry = await repository.retryGiftCompensation({ platform: 'dy', eventId: 'event-1' });
  assert.deepEqual(pendingRetry.event, input.event);
  assert.equal(calls.filter(call => call.sql.includes("SET status = 'pending'")).length, writesAfterFailed);

  stored.status = 'enqueued';
  await assert.rejects(
    repository.retryGiftCompensation({ platform: 'dy', eventId: 'event-1' }),
    error => error instanceof AdminRepositoryError && error.code === 'compensation_not_retryable',
  );
});

test('finish and fail compensation attempts update durable audit status', async () => {
  const calls = [];
  const pool = {
    async execute(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('UPDATE gift_compensation')) return [{ affectedRows: 1 }];
      if (sql.includes('FROM gift_compensation')) {
        return [[{ ...compensationRowFromInsert([
          'dy', 'event-1', 'room-1', 'user-1', 'Alpha', 'gift-1', 'Gift One', 1,
          'a'.repeat(64), JSON.stringify({ eventId: 'event-1' }), 'restore',
          '2026-08-07 08:00:00.000',
        ]), status: 'enqueued', attempt_count: 1 }]];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const repository = new AdminRepository(pool);

  const finished = await repository.finishGiftCompensation({
    eventId: 'event-1', status: 'enqueued', completedAt: new Date('2026-08-07T08:00:01.000Z'),
  });
  assert.equal(finished.status, 'enqueued');
  assert.match(calls[0].sql, /attempt_count = attempt_count \+ 1/);
  assert.match(calls[0].sql, /status IN \('pending', 'failed'\)/);

  await repository.failGiftCompensation({ eventId: 'event-2', error: new Error('Redis unavailable') });
  assert.match(calls.at(-1).sql, /status = 'failed'/);
  assert.equal(calls.at(-1).params[0], 'Redis unavailable');
});

test('a late duplicate result cannot overwrite an already enqueued terminal status', async () => {
  const calls = [];
  const row = {
    ...compensationRowFromInsert([
      'dy', 'event-1', 'room-1', 'user-1', 'Alpha', 'gift-1', 'Gift One', 1,
      'a'.repeat(64), JSON.stringify({ eventId: 'event-1' }), 'restore',
      '2026-08-07 08:00:00.000',
    ]),
    status: 'enqueued',
    attempt_count: 1,
  };
  const pool = {
    async execute(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('UPDATE gift_compensation')) return [{ affectedRows: 0 }];
      if (sql.includes('FROM gift_compensation')) return [[row]];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const repository = new AdminRepository(pool);
  const result = await repository.finishGiftCompensation({
    eventId: 'event-1', status: 'duplicate', completedAt: new Date(),
  });
  assert.equal(result.status, 'enqueued');
  assert.match(calls[0].sql, /status IN \('pending', 'failed'\)/u);
});

test('listGiftCompensations always scopes audit history to one platform', async () => {
  const pool = {
    async query(sql, params) {
      assert.match(sql, /WHERE platform = \? AND status = \?/);
      assert.deepEqual(params, ['ks', 'failed', 25]);
      return [[]];
    },
  };
  const repository = new AdminRepository(pool);
  assert.deepEqual(await repository.listGiftCompensations({
    platform: 'ks', status: 'failed', limit: 25,
  }), []);
});

test('updateGuild uses a locked version check before publishing the next version', async () => {
  const calls = [];
  let guild = {
    id: '7', name: 'Racers', join_code: 'RACE-7', description: 'Fast', enabled: 1, version: 2,
    created_at: '2026-08-07 08:00:00.000', updated_at: '2026-08-07 08:00:00.000',
    member_count: '3',
  };
  const connection = transactionConnection(async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('FROM guild') && sql.includes('FOR UPDATE')) return [[guild]];
    if (sql.includes('UPDATE guild')) {
      guild = { ...guild, name: params[0], join_code: params[1], version: params[4], updated_at: params[5] };
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('FROM guild g')) return [[guild]];
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const repository = new AdminRepository({ async getConnection() { return connection; } });

  const updated = await repository.updateGuild({
    guildId: '7', version: 2, name: 'Faster Racers', updatedAt: new Date('2026-08-07T08:01:00.000Z'),
  });
  assert.equal(updated.version, 3);
  assert.equal(updated.name, 'Faster Racers');
  assert.match(calls.find(call => call.sql.includes('FROM guild') && call.sql.includes('FOR UPDATE')).sql, /FOR UPDATE/);

  await assert.rejects(
    repository.updateGuild({ guildId: '7', version: 2, name: 'Stale' }),
    error => error instanceof AdminRepositoryError && error.code === 'guild_version_conflict',
  );
});

test('putGuildMember rejects disabled guilds before changing membership', async () => {
  let queries = 0;
  const connection = transactionConnection(async sql => {
    queries += 1;
    if (sql.includes('SELECT id, enabled FROM guild')) return [[{ id: '7', enabled: 0 }]];
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const repository = new AdminRepository({ async getConnection() { return connection; } });

  await assert.rejects(
    repository.putGuildMember({
      platform: 'dy', guildId: '7', userId: 'player-1', role: 'member',
    }),
    error => error instanceof AdminRepositoryError && error.code === 'guild_disabled',
  );
  assert.equal(queries, 1);
});

test('putGuildMember keeps one guild per user and replaces the manager transactionally', async t => {
  await t.test('rejects membership in another guild', async () => {
    const connection = transactionConnection(async sql => {
      if (sql.includes('SELECT id, enabled FROM guild')) return [[{ id: '7', enabled: 1 }]];
      if (sql.includes('FROM platform_user')) return [[{ id: 'user-db-id' }]];
      if (sql.includes('SELECT guild_id FROM guild_member')) return [[{ guild_id: '8' }]];
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = new AdminRepository({ async getConnection() { return connection; } });
    await assert.rejects(
      repository.putGuildMember({
        platform: 'dy', guildId: '7', userId: 'player-1', role: 'member',
      }),
      error => error instanceof AdminRepositoryError && error.code === 'user_already_in_guild',
    );
  });

  await t.test('downgrades the previous manager before inserting the new one', async () => {
    const writes = [];
    const connection = transactionConnection(async (sql, params) => {
      if (sql.includes('SELECT id, enabled FROM guild')) return [[{ id: '7', enabled: 1 }]];
      if (sql.includes('FROM platform_user')) return [[{ id: 'user-db-id' }]];
      if (sql.includes('SELECT guild_id FROM guild_member')) return [[]];
      if (sql.includes('UPDATE guild_member') || sql.includes('INSERT INTO guild_member')) {
        writes.push({ sql, params });
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('SELECT pu.external_user_id')) {
        return [[{
          external_user_id: 'player-1', nickname: 'Alpha', avatar_url: '',
          role: 'manager', joined_at: '2026-08-07 08:00:00.000',
        }]];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = new AdminRepository({ async getConnection() { return connection; } });
    const member = await repository.putGuildMember({
      platform: 'dy', guildId: '7', userId: 'player-1', role: 'manager',
    });
    assert.equal(member.role, 'manager');
    assert.match(writes[0].sql, /SET role = 'member'/);
    assert.match(writes[1].sql, /INSERT INTO guild_member/);
  });
});

function transactionConnection(execute) {
  return {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    execute,
  };
}

function compensationInput() {
  return {
    platform: 'dy',
    eventId: 'event-1',
    roomId: 'room-1',
    userId: 'user-1',
    nickname: 'Alpha',
    giftId: 'gift-1',
    giftName: 'Gift One',
    count: 1,
    payloadHash: 'a'.repeat(64),
    event: { platform: 'dy', roomId: 'room-1', eventId: 'event-1', gift: true },
    reason: 'restore live state',
    createdAt: new Date('2026-08-07T08:00:00.000Z'),
  };
}

function compensationRowFromInsert(params) {
  return {
    id: '1',
    platform: params[0],
    event_id: params[1],
    room_id: params[2],
    external_user_id: params[3],
    nickname: params[4],
    gift_id: params[5],
    gift_name: params[6],
    gift_count: params[7],
    payload_hash: params[8],
    payload_json: params[9],
    reason: params[10],
    status: 'pending',
    attempt_count: 0,
    last_error: '',
    enqueued_at: null,
    created_at: params[11],
    updated_at: params[11],
  };
}
