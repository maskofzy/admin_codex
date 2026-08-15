import assert from 'node:assert/strict';
import test from 'node:test';
import { AdminRepository, AdminRepositoryError } from '../src/services/admin-repository.js';

test('round search prefers immutable round anchor snapshots and falls back for legacy rows', async () => {
  const pool = {
    async query(sql, params) {
      assert.match(sql, /NULLIF\(gr\.anchor_nickname_snapshot, ''\)/u);
      assert.match(sql, /round_anchor\.external_user_id/u);
      assert.match(sql, /room_anchor\.nickname/u);
      assert.match(sql, /candidate\.anchor_user_id = COALESCE\(gr\.anchor_user_id/u);
      assert.deepEqual(params.slice(0, 4), [
        'dy', '%Anchor%',
        new Date('2026-08-07T00:00:00.000Z'),
        new Date('2026-08-08T00:00:00.000Z'),
      ]);
      return [[roundRow()]];
    },
  };
  const repository = new AdminRepository(pool);
  const rows = await repository.listCompensationRounds({
    platform: 'dy',
    anchorNickname: 'Anchor',
    startedFrom: new Date('2026-08-07T00:00:00.000Z'),
    startedTo: new Date('2026-08-08T00:00:00.000Z'),
    limit: 20,
  });
  assert.equal(rows[0].anchorNickname, 'Anchor');
  assert.equal(rows[0].latestTargetRoomId, 'target-room');
});

test('round gift lookup merges explicitly linked and in-window unassigned ledger events', async () => {
  const calls = [];
  const pool = {
    async execute(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('WHERE source_room.platform = ? AND gr.id = ?')) {
        return [[roundRow()]];
      }
      if (sql.includes('MAX(gift.id)')) {
        return [[{ snapshot_max_event_id: '102' }]];
      }
      if (sql.includes('WITH round_window AS')) {
        return [[{
          external_user_id: 'viewer-1',
          nickname_snapshot: 'Viewer',
          avatar_url_snapshot: 'https://avatar.test/1.png',
          gift_id: 'legacy-gift',
          gift_name: 'Legacy Gift',
          event_count: '2',
          total_count: '5',
          total_value: '30',
          first_at: '2026-08-07 08:01:00.000',
          last_at: '2026-08-07 08:02:00.000',
        }]];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const repository = new AdminRepository(pool);
  const result = await repository.listCompensationRoundGifts({ platform: 'dy', roundId: '7' });

  assert.equal(result.round.externalRoundId, 'round-7');
  assert.equal(result.snapshotMaxEventId, '102');
  assert.deepEqual(result.totals, { eventCount: 2, totalCount: 5, totalValue: 30 });
  assert.equal(result.items[0].giftId, 'legacy-gift');
  const ledgerSql = calls[2].sql;
  assert.match(ledgerSql, /gift\.round_id = rw\.id/u);
  assert.match(ledgerSql, /gift\.round_id IS NULL/u);
  assert.match(ledgerSql, /gift\.room_id = rw\.room_id/u);
  assert.match(ledgerSql, /gift\.occurred_at >= rw\.started_at/u);
  assert.match(ledgerSql, /gift\.occurred_at < rw\.ended_at/u);
  assert.match(ledgerSql, /next_round\.started_at/u);
  assert.match(ledgerSql, /UTC_TIMESTAMP\(3\)/u);
  assert.match(ledgerSql, /WHERE gift\.id <= \?/u);
  assert.deepEqual(calls[2].params, ['7', '102']);
});

test('job creation re-reads raw source events and materializes seat comments before gifts', async () => {
  const writes = [];
  const connection = transactionConnection(async (sql, params, method) => {
    if (sql.includes('job.request_id = ?')) return [[]];
    if (sql.includes('job.payload_hash = ?')) return [[]];
    if (sql.includes('FROM game_round gr') && sql.includes('FOR UPDATE')) {
      assert.match(sql, /COALESCE\(gr\.anchor_user_id, source_room\.anchor_user_id\)/u);
      return [[{
        id: '7', room_id: '3', external_round_id: 'round-7', platform: 'dy',
        external_room_id: 'source-room', anchor_user_id: '11',
      }]];
    }
    if (sql.includes('FROM live_room') && sql.includes('external_room_id = ?')) {
      return [[{ id: '4', platform: 'dy', external_room_id: 'target-room', anchor_user_id: '11' }]];
    }
    if (sql.includes('FROM live_gift_event gift')) {
      assert.match(sql, /gift\.round_id IS NULL/u);
      assert.match(sql, /gift\.id <= \?/u);
      assert.deepEqual(params, ['7', '102', 'viewer-1', 'legacy-gift']);
      return [[sourceGift('101', 2, 10, '2026-08-07 08:01:00.000'),
        sourceGift('102', 3, 20, '2026-08-07 08:02:00.000')]];
    }
    if (sql.includes('INSERT INTO compensation_job_item')) {
      writes.push({ sql, params, method });
      return [{ affectedRows: 3 }];
    }
    if (sql.includes('INSERT INTO compensation_job')) {
      assert.equal((sql.match(/\?/gu) || []).length, params.length);
      writes.push({ sql, params, method });
      return [{ insertId: '15', affectedRows: 1 }];
    }
    if (sql.includes('WHERE source_room.platform = ? AND job.id = ?')) {
      return [[jobRow({ id: '15', total_items: 3, total_gift_events: 2, total_seat_events: 1 })]];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const repository = new AdminRepository({ async getConnection() { return connection; } });
  const input = jobInput();
  const result = await repository.createCompensationJob(input);

  assert.equal(result.totalItems, 3);
  assert.equal(result.totalGiftEvents, 2);
  const jobInsert = writes.find(write => write.sql.includes('INSERT INTO compensation_job\n'));
  assert.equal(jobInsert.params[9], 3);
  assert.equal(jobInsert.params[10], 2);
  assert.equal(jobInsert.params[11], '5');
  assert.equal(jobInsert.params[12], '30');
  assert.equal(jobInsert.params[13], 1);

  const itemInsert = writes.find(write => write.sql.includes('INSERT INTO compensation_job_item'));
  assert.equal(itemInsert.method, 'query');
  assert.equal(itemInsert.params[2], 'comment');
  assert.equal(itemInsert.params[3], null);
  assert.equal(JSON.parse(itemInsert.params[12]).msg_type, 1);
  assert.equal(itemInsert.params[17], 'gift');
  assert.equal(itemInsert.params[18], '101');
  assert.equal(JSON.parse(itemInsert.params[27]).gift_value, 10);
  assert.equal(itemInsert.params[32], 'gift');
  assert.equal(itemInsert.params[33], '102');
  assert.equal(JSON.parse(itemInsert.params[42]).count, 3);
  assert.notEqual(itemInsert.params[19], itemInsert.params[34]);
});

test('same request id is idempotent but rejects a different normalized payload hash', async () => {
  const existing = jobRow({ payload_hash: 'a'.repeat(64) });
  const connection = transactionConnection(async (sql, params) => {
    if (sql.includes('job.request_id = ?')) {
      return params[1] === 'incident-1' ? [[existing]] : [[]];
    }
    if (sql.includes('job.payload_hash = ?')) return [[existing]];
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const repository = new AdminRepository({ async getConnection() { return connection; } });

  const same = await repository.createCompensationJob(jobInput());
  assert.equal(same.requestId, 'incident-1');
  const refreshedPage = await repository.createCompensationJob({
    ...jobInput(), requestId: 'incident-after-refresh',
  });
  assert.equal(refreshedPage.requestId, 'incident-1');
  await assert.rejects(
    repository.createCompensationJob({ ...jobInput(), payloadHash: 'b'.repeat(64) }),
    error => error instanceof AdminRepositoryError
      && error.code === 'compensation_job_payload_conflict'
      && error.status === 409,
  );
});

test('partially overlapping jobs report the globally claimed source gift event', async () => {
  const duplicate = Object.assign(new Error(
    "Duplicate entry '101' for key 'compensation_job_item.uq_compensation_job_source_claim'",
  ), { code: 'ER_DUP_ENTRY' });
  const connection = transactionConnection(async (sql) => {
    if (sql.includes('job.request_id = ?') || sql.includes('job.payload_hash = ?')) return [[]];
    if (sql.includes('FROM game_round gr') && sql.includes('FOR UPDATE')) {
      return [[{
        id: '7', room_id: '3', external_round_id: 'round-7', platform: 'dy',
        external_room_id: 'source-room', anchor_user_id: '11',
      }]];
    }
    if (sql.includes('FROM live_room') && sql.includes('external_room_id = ?')) {
      return [[{ id: '4', platform: 'dy', external_room_id: 'target-room', anchor_user_id: '11' }]];
    }
    if (sql.includes('FROM live_gift_event gift')) {
      return [[sourceGift('101', 1, 10, '2026-08-07 08:01:00.000')]];
    }
    if (sql.includes('INSERT INTO compensation_job_item')) throw duplicate;
    if (sql.includes('INSERT INTO compensation_job')) return [{ insertId: '15', affectedRows: 1 }];
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const pool = {
    async getConnection() { return connection; },
    async execute(sql) {
      if (sql.includes('job.request_id = ?') || sql.includes('job.payload_hash = ?')) return [[]];
      throw new Error(`Unexpected SQL after rollback: ${sql}`);
    },
  };
  const repository = new AdminRepository(pool);
  await assert.rejects(
    repository.createCompensationJob({
      ...jobInput(), seatPlayers: false, commentContent: '', requestId: 'overlap-2',
      payloadHash: 'c'.repeat(64),
    }),
    error => error instanceof AdminRepositoryError
      && error.code === 'compensation_source_event_already_claimed'
      && error.status === 409,
  );
});

test('claiming recovers an expired processing lease and keeps priority comments in sequence', async () => {
  const calls = [];
  let claimedItem = {
    id: '20', job_id: '15', sequence_no: 1, item_type: 'comment',
    source_gift_event_id: null, event_id: 'recovery:seat', external_user_id: 'viewer-1',
    nickname_snapshot: 'Viewer', avatar_url_snapshot: '', gift_id: null, gift_name: null,
    gift_count: null, gift_value: null,
    payload_json: JSON.stringify({
      msg_id: 'recovery:seat', msg_type: 1, content: '上车', timestamp: 1,
    }),
    status: 'processing', attempt_count: 1,
    lease_expires_at: '2026-08-07 07:59:59.000', last_error: '', enqueued_at: null,
    created_at: '2026-08-07 07:59:00.000', updated_at: '2026-08-07 07:59:00.000',
  };
  const connection = transactionConnection(async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes("job.status = 'cancelled'")) return [[]];
    if (sql.includes("job.status IN ('pending', 'running')")) {
      return [[jobRow({ status: 'running', next_run_at: '2026-08-07 08:00:00.000' })]];
    }
    if (sql.includes("item.status IN ('pending', 'processing')")) {
      return [[claimedItem]];
    }
    if (sql.includes('UPDATE compensation_job_item') || sql.includes('UPDATE compensation_job')) {
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const repository = new AdminRepository({ async getConnection() { return connection; } });
  const claimedAt = new Date('2026-08-07T08:00:00.000Z');
  const result = await repository.claimNextCompensationItem({
    claimedAt,
    leaseToken: '00000000-0000-4000-8000-000000000001',
    leaseExpiresAt: new Date('2026-08-07T08:00:30.000Z'),
  });

  assert.equal(result.itemId, '20');
  assert.equal(result.event.priority, true);
  assert.equal(result.event.gift, false);
  assert.equal(result.event.payload.msg_type, 1);
  assert.equal(result.event.payload.timestamp, claimedAt.getTime());
  assert.match(calls[0].sql, /FOR UPDATE SKIP LOCKED/u);
  const itemClaim = calls.find(call => call.sql.includes("item.status IN ('pending', 'processing')"));
  assert.match(itemClaim.sql, /ORDER BY item\.sequence_no ASC/u);
  assert.ok(calls.some(call => call.sql.includes("SET status = 'processing'")));

  claimedItem = {
    ...claimedItem,
    id: '21', sequence_no: 2, item_type: 'gift', source_gift_event_id: '101',
    event_id: 'recovery:gift', gift_id: 'legacy-gift', gift_name: 'Legacy Gift',
    gift_count: '2', gift_value: '10',
    payload_json: JSON.stringify({
      msg_id: 'recovery:gift', msg_type: 3, count: 2, timestamp: 1,
      sec_gift_id: 'legacy-gift', giftname: 'Legacy Gift', gift_value: 10,
    }),
  };
  const giftClaimedAt = new Date('2026-08-07T08:01:00.000Z');
  const gift = await repository.claimNextCompensationItem({
    claimedAt: giftClaimedAt,
    leaseToken: '00000000-0000-4000-8000-000000000002',
    leaseExpiresAt: new Date('2026-08-07T08:01:30.000Z'),
  });
  assert.equal(gift.event.gift, true);
  assert.equal(gift.event.payload.msg_type, 3);
  assert.equal(gift.event.payload.timestamp, giftClaimedAt.getTime());
});

test('claiming after cancel and lease expiry returns a reconciliation-only item', async () => {
  const calls = [];
  const item = {
    id: '21', job_id: '15', sequence_no: 2, item_type: 'gift',
    source_gift_event_id: '101', event_id: 'recovery:gift', external_user_id: 'viewer-1',
    nickname_snapshot: 'Viewer', avatar_url_snapshot: '', gift_id: 'legacy-gift',
    gift_name: 'Legacy Gift', gift_count: '2', gift_value: '10',
    payload_json: JSON.stringify({
      msg_id: 'recovery:gift', msg_type: 3, count: 2, timestamp: 1,
      sec_gift_id: 'legacy-gift', giftname: 'Legacy Gift', gift_value: 10,
    }),
    status: 'processing', attempt_count: 1,
    lease_expires_at: '2026-08-07 07:59:59.000', last_error: '', enqueued_at: null,
    created_at: '2026-08-07 07:59:00.000', updated_at: '2026-08-07 07:59:00.000',
  };
  const connection = transactionConnection(async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes("job.status = 'cancelled'")) {
      return [[jobRow({ status: 'cancelled', next_run_at: null })]];
    }
    if (sql.includes("item.status = 'processing'")) return [[item]];
    if (sql.includes('UPDATE compensation_job_item')) return [{ affectedRows: 1 }];
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const repository = new AdminRepository({ async getConnection() { return connection; } });
  const claimedAt = new Date('2026-08-07T08:00:00.000Z');
  const result = await repository.claimNextCompensationItem({
    claimedAt,
    leaseToken: '00000000-0000-4000-8000-000000000003',
    leaseExpiresAt: new Date('2026-08-07T08:00:30.000Z'),
  });

  assert.equal(result.reconcileCancelled, true);
  assert.equal(result.event.eventId, 'recovery:gift');
  assert.equal(calls.some(call => call.sql.includes("job.status IN ('pending', 'running')")), false);
  assert.match(calls[0].sql, /lease_expires_at <= \?/u);
});

test('item completion advances the durable schedule and item failure stops the job', async () => {
  const completionCalls = [];
  const completionConnection = transactionConnection(async (sql, params) => {
    completionCalls.push({ sql, params });
    if (sql.includes("item.status = 'processing'") && sql.includes('job.interval_ms')) {
      return [[{ id: '20', job_id: '15', job_status: 'running', interval_ms: 1500 }]];
    }
    if (sql.includes('COUNT(*) AS remaining')) return [[{ remaining: '1' }]];
    if (sql.includes('UPDATE compensation_job_item') || sql.includes('UPDATE compensation_job')) {
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const completedAt = new Date('2026-08-07T08:00:00.000Z');
  const completionRepository = new AdminRepository({
    async getConnection() { return completionConnection; },
  });
  assert.equal(await completionRepository.completeCompensationItem({
    itemId: '20', leaseToken: 'lease-1', status: 'enqueued', completedAt,
  }), true);
  const scheduleWrite = completionCalls.find(call => (
    call.sql.includes('completed_items = completed_items + 1')
      && call.sql.includes('next_run_at = ?')
  ));
  assert.equal(scheduleWrite.params[0].toISOString(), '2026-08-07T08:00:01.500Z');

  const failureCalls = [];
  const failureConnection = transactionConnection(async (sql, params) => {
    failureCalls.push({ sql, params });
    if (sql.includes("item.status = 'processing'") && sql.includes('job.status AS job_status')) {
      return [[{ id: '21', job_id: '15', job_status: 'running' }]];
    }
    if (sql.includes('UPDATE compensation_job_item') || sql.includes('UPDATE compensation_job')) {
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const failureRepository = new AdminRepository({
    async getConnection() { return failureConnection; },
  });
  assert.equal(await failureRepository.failCompensationItem({
    itemId: '21', leaseToken: 'lease-2', error: new Error('Redis down'), failedAt: completedAt,
    releaseOnCancel: true,
  }), true);
  const failedItemWrite = failureCalls.find(call => (
    call.sql.includes('UPDATE compensation_job_item') && call.sql.includes('cancel_releases_source')
  ));
  assert.deepEqual(failedItemWrite.params.slice(0, 2), ['failed', true]);
  const failedJobWrite = failureCalls.find(call => (
    call.sql.includes('UPDATE compensation_job\n') && call.sql.includes("SET status = 'failed'")
  ));
  assert.match(failedJobWrite.sql, /next_run_at = NULL/u);
  assert.equal(failedJobWrite.params[0], 'Redis down');
});

test('failed jobs can be retried and pending work can be cancelled transactionally', async () => {
  let retryStatus = 'failed';
  const retryCalls = [];
  const retryConnection = transactionConnection(async (sql, params) => {
    retryCalls.push({ sql, params });
    if (sql.includes('WHERE source_room.platform = ? AND job.id = ?')) {
      return [[jobRow({ status: retryStatus, failed_items: retryStatus === 'failed' ? 1 : 0 })]];
    }
    if (sql.includes('UPDATE compensation_job_item')) return [{ affectedRows: 1 }];
    if (sql.includes('UPDATE compensation_job')) {
      retryStatus = 'pending';
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const repository = new AdminRepository({ async getConnection() { return retryConnection; } });
  const retried = await repository.retryCompensationJob({
    platform: 'dy', jobId: '15', retriedAt: new Date('2026-08-07T08:05:00.000Z'),
  });
  assert.equal(retried.status, 'pending');
  assert.ok(retryCalls.find(call => call.sql.includes("SET status = 'pending'")));

  let cancelStatus = 'pending';
  const cancelCalls = [];
  const cancelConnection = transactionConnection(async (sql, params) => {
    cancelCalls.push({ sql, params });
    if (sql.includes('WHERE source_room.platform = ? AND job.id = ?')) {
      return [[jobRow({
        status: cancelStatus,
        cancelled_items: cancelStatus === 'cancelled' ? 2 : 0,
      })]];
    }
    if (sql.includes('UPDATE compensation_job_item')) return [{ affectedRows: 2 }];
    if (sql.includes("SUM(status = 'failed')")) {
      return [[{ failed_items: '0', cancelled_items: '2' }]];
    }
    if (sql.includes('UPDATE compensation_job')) {
      cancelStatus = 'cancelled';
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const cancelRepository = new AdminRepository({
    async getConnection() { return cancelConnection; },
  });
  const cancelled = await cancelRepository.cancelCompensationJob({
    platform: 'dy', jobId: '15', cancelledAt: new Date('2026-08-07T08:06:00.000Z'),
  });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.cancelledItems, 2);
  const cancelledItemsWrite = cancelCalls.find(call => (
    call.sql.includes("status IN ('pending', 'failed')")
  ));
  assert.match(cancelledItemsWrite.sql, /cancel_releases_source = IF\(status = 'pending'/u);
});

test('a processing item cancelled in flight keeps its source claim unless absence is confirmed', async t => {
  await t.test('event later enqueued remains terminal and claimed', async () => {
    const calls = [];
    const connection = transactionConnection(async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes("item.status = 'processing'") && sql.includes('job.interval_ms')) {
        return [[{ id: '20', job_id: '15', job_status: 'cancelled', interval_ms: 500 }]];
      }
      if (sql.includes('COUNT(*) AS remaining')) return [[{ remaining: '0' }]];
      if (sql.includes('UPDATE compensation_job_item') || sql.includes('UPDATE compensation_job')) {
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = new AdminRepository({ async getConnection() { return connection; } });
    await repository.completeCompensationItem({
      itemId: '20', leaseToken: 'lease', status: 'enqueued', completedAt: new Date(),
    });
    const itemWrite = calls.find(call => call.sql.includes('UPDATE compensation_job_item'));
    assert.equal(itemWrite.params[0], 'enqueued');
  });

  await t.test('confirmed absence releases while ambiguous failure remains claimed', async () => {
    async function fail(releaseOnCancel) {
      const calls = [];
      const connection = transactionConnection(async (sql, params) => {
        calls.push({ sql, params });
        if (sql.includes("item.status = 'processing'") && sql.includes('job.status AS job_status')) {
          return [[{ id: '20', job_id: '15', job_status: 'cancelled' }]];
        }
        if (sql.includes('UPDATE compensation_job_item') || sql.includes('UPDATE compensation_job')) {
          return [{ affectedRows: 1 }];
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      });
      const repository = new AdminRepository({ async getConnection() { return connection; } });
      await repository.failCompensationItem({
        itemId: '20', leaseToken: 'lease', error: new Error('failed'), failedAt: new Date(),
        releaseOnCancel,
      });
      return calls;
    }

    const released = await fail(true);
    const releasedItem = released.find(call => call.sql.includes('UPDATE compensation_job_item'));
    assert.deepEqual(releasedItem.params.slice(0, 2), ['cancelled', true]);
    assert.ok(released.find(call => call.sql.includes('cancelled_items = cancelled_items + 1')));

    const ambiguous = await fail(false);
    const ambiguousItem = ambiguous.find(call => call.sql.includes('UPDATE compensation_job_item'));
    assert.deepEqual(ambiguousItem.params.slice(0, 2), ['failed', false]);
    assert.ok(ambiguous.find(call => call.sql.includes('failed_items = failed_items + 1')));
  });
});

function transactionConnection(handler) {
  return {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql, params) { return handler(sql, params, 'execute'); },
    async query(sql, params) { return handler(sql, params, 'query'); },
  };
}

function jobInput() {
  return {
    platform: 'dy',
    requestId: 'incident-1',
    payloadHash: 'a'.repeat(64),
    sourceRoundId: '7',
    sourceSnapshotMaxEventId: '102',
    targetRoomId: 'target-room',
    selections: [{ userId: 'viewer-1', giftId: 'legacy-gift' }],
    seatPlayers: true,
    commentContent: '上车',
    intervalMs: 1000,
    reason: 'restore interrupted live state',
    createdAt: new Date('2026-08-07T08:10:00.000Z'),
  };
}

function sourceGift(id, count, value, occurredAt) {
  return {
    source_gift_event_id: id,
    external_user_id: 'viewer-1',
    nickname_snapshot: 'Viewer',
    avatar_url_snapshot: 'https://avatar.test/1.png',
    gift_id: 'legacy-gift',
    gift_name: 'Legacy Gift',
    gift_count: String(count),
    gift_value: String(value),
    occurred_at: occurredAt,
  };
}

function roundRow() {
  return {
    round_db_id: '7', room_db_id: '3', external_room_id: 'source-room',
    external_round_id: 'round-7', status: 'settled',
    started_at: '2026-08-07 08:00:00.000', settled_at: '2026-08-07 08:05:00.000',
    anchor_external_user_id: 'anchor-1', anchor_nickname: 'Anchor', anchor_avatar_url: '',
    latest_target_room_id: 'target-room',
    latest_target_room_authenticated_at: '2026-08-07 08:09:00.000',
  };
}

function jobRow(overrides = {}) {
  return {
    id: '15', request_id: 'incident-1', payload_hash: 'a'.repeat(64),
    source_round_id: '7', source_snapshot_max_event_id: '102',
    source_external_round_id: 'round-7',
    source_external_room_id: 'source-room', target_external_room_id: 'target-room',
    platform: 'dy', interval_ms: 1000, seat_players: 1, comment_content: '上车',
    reason: 'restore interrupted live state', status: 'pending', total_items: 3,
    completed_items: 0, failed_items: 0, cancelled_items: 0,
    total_gift_events: 2, total_gift_count: '5', total_gift_value: '30',
    total_seat_events: 1, next_run_at: '2026-08-07 08:10:00.000', last_error: '',
    started_at: null, finished_at: null, created_at: '2026-08-07 08:10:00.000',
    updated_at: '2026-08-07 08:10:00.000',
    ...overrides,
  };
}
