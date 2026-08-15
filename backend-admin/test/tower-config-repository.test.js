import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256Hex } from '../src/lib/crypto.js';
import {
  TowerConfigRepository,
  TowerConfigRepositoryError,
} from '../src/services/tower-config-repository.js';

test('reads fixed tower records and returns content-hash revisions', async () => {
  const raw = '{"levelTime":60,"unknown":{"kept":true}}';
  const repository = new TowerConfigRepository({
    async execute(sql, params) {
      assert.match(sql, /FROM t_config/u);
      assert.deepEqual(params, [2]);
      return [[{ ID: 2, Version: 'release-a', Config: raw, Remark: 'current' }]];
    },
  }, {
    mainConfigId: 2,
    welfareConfigId: null,
    anchorConfigIds: [2],
  });

  const document = await repository.getDocument();
  assert.equal(document.main.id, '2');
  assert.equal(document.main.version, 'release-a');
  assert.equal(document.main.revision, sha256Hex(raw));
  assert.deepEqual(document.main.config, { levelTime: 60, unknown: { kept: true } });
  assert.equal(document.welfare, null);
});

test('updates the complete main JSON only after a locked revision check', async () => {
  const raw = '{"levelTime":60,"unknown":1}';
  const state = { calls: [], updated: null };
  const repository = new TowerConfigRepository(transactionPool(async (sql, params) => {
    state.calls.push(sql);
    if (sql.includes('SELECT ID, Version, Config, Remark')) {
      return [[{ ID: 1, Version: '1', Config: raw, Remark: 'old' }]];
    }
    if (sql.startsWith('UPDATE t_config')) {
      state.updated = params;
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }, state), {
    mainConfigId: 1,
    welfareConfigId: null,
    anchorConfigIds: [1],
  });

  await assert.rejects(
    repository.updateMain({
      expectedRevision: '0'.repeat(64),
      config: { levelTime: 30 },
    }),
    error => error instanceof TowerConfigRepositoryError &&
      error.code === 'tower_config_conflict' && error.status === 409,
  );
  assert.equal(state.rollbacks, 1);
  assert.equal(state.updated, null);

  const config = { levelTime: 45, unknown: 1 };
  const updated = await repository.updateMain({
    expectedRevision: sha256Hex(raw),
    config,
    remark: 'reviewed',
  });
  assert.deepEqual(state.updated, [JSON.stringify(config), 'reviewed', 1]);
  assert.equal(updated.revision, sha256Hex(JSON.stringify(config)));
  assert.deepEqual(updated.config, config);
  assert.equal(state.commits, 1);
});

test('updates welfare JSON with a MySQL 5.7-compatible locked CAS transaction', async () => {
  const raw = '{"dailyGift":3,"unknown":true}';
  const state = { calls: [], updated: null };
  const repository = new TowerConfigRepository(transactionPool(async (sql, params) => {
    state.calls.push({ sql, params });
    if (sql.includes('SELECT ID, config')) {
      return [[{ ID: 7, config: raw }]];
    }
    if (sql.startsWith('UPDATE t_config_welfare')) {
      state.updated = params;
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }, state), {
    mainConfigId: 2,
    welfareConfigId: 7,
    anchorConfigIds: [2],
  });

  const config = { dailyGift: 5, unknown: { kept: true } };
  const updated = await repository.updateWelfare({
    expectedRevision: sha256Hex(raw),
    config,
  });

  assert.match(
    state.calls[0].sql,
    /FROM t_config_welfare\s+WHERE ID = \? FOR UPDATE/u,
  );
  assert.deepEqual(state.calls[0].params, [7]);
  assert.equal(state.calls[1].sql, 'UPDATE t_config_welfare SET config = ? WHERE ID = ?');
  assert.deepEqual(state.updated, [JSON.stringify(config), 7]);
  assert.equal(updated.revision, sha256Hex(JSON.stringify(config)));
  assert.deepEqual(updated.config, config);
  assert.equal(state.commits, 1);
});

test('scopes anchors and recoveries to configured ids and rejects duplicate pending recovery', async () => {
  const calls = [];
  const pool = {
    async execute(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM t_anchor_info') && !sql.includes('FOR UPDATE')) {
        return [[{ openUID: 'anchor-1', nickName: '主播一', configID: 4 }]];
      }
      if (sql.includes('FROM t_config_recover recovery')) {
        return [[{
          ID: 8,
          openUID: 'anchor-1',
          nickname: '主播一',
          recoverconfig: '{"currentLevel":20}',
          isUsed: '0',
          Time: '2026-08-08 01:02:03.000',
        }]];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    getConnection() {
      return transactionConnection(async (sql, params) => {
        calls.push({ sql, params });
        if (sql.includes('FROM t_anchor_info')) {
          return [[{ ID: 3, openUID: 'anchor-1', nickName: '主播一', configID: 4 }]];
        }
        if (sql.includes('FROM t_config_recover')) return [[]];
        if (sql.startsWith('INSERT INTO t_config_recover')) return [{ insertId: 9 }];
        throw new Error(`Unexpected SQL: ${sql}`);
      });
    },
  };
  const repository = new TowerConfigRepository(pool, {
    mainConfigId: 4,
    welfareConfigId: null,
    anchorConfigIds: [4, 6],
  });

  const anchors = await repository.listAnchors({ query: 'host%_=', limit: 20 });
  assert.deepEqual(anchors, [{ openUid: 'anchor-1', nickname: '主播一', configId: '4' }]);
  assert.match(calls[0].sql, /LIKE \? ESCAPE '=' OR openUID LIKE \? ESCAPE '='/u);
  assert.match(calls[0].sql, /ORDER BY nickName ASC, openUID ASC\s+LIMIT \?/u);
  assert.deepEqual(calls[0].params, [4, 6, '%host=%=_==%', '%host=%=_==%', 20]);
  const recoveries = await repository.listRecoveries({ unusedOnly: true, limit: 10 });
  assert.equal(recoveries[0].config.currentLevel, 20);
  assert.deepEqual(calls[1].params, [4, 6, 10]);
  const created = await repository.createRecovery({
    openUid: 'anchor-1',
    config: { currentLevel: 30 },
    createdAt: new Date('2026-08-08T01:03:00Z'),
  });
  assert.equal(created.id, '9');
  assert.equal(created.nickname, '主播一');
  assert.deepEqual(created.config, { currentLevel: 30 });
  const lockingCalls = calls.filter(call => call.sql.includes('FOR UPDATE'));
  assert.equal(lockingCalls.length, 2);
  for (const call of lockingCalls) {
    assert.match(call.sql, /LIMIT 1\s+FOR UPDATE/u);
  }
  for (const call of calls) {
    assert.doesNotMatch(
      call.sql,
      /\b(?:WITH|ROW_NUMBER|JSON_TABLE|SKIP LOCKED|NOWAIT)\b/iu,
    );
  }

  pool.getConnection = () => transactionConnection(async sql => {
    if (sql.includes('FROM t_anchor_info')) {
      return [[{ ID: 3, openUID: 'anchor-1', nickName: '主播一', configID: 4 }]];
    }
    if (sql.includes('FROM t_config_recover')) return [[{ ID: 9 }]];
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  await assert.rejects(
    repository.createRecovery({ openUid: 'anchor-1', config: { currentLevel: 31 } }),
    error => error instanceof TowerConfigRepositoryError &&
      error.code === 'tower_recovery_exists' && error.status === 409,
  );
});

function transactionPool(execute, state) {
  return {
    getConnection() {
      const connection = transactionConnection(execute);
      const commit = connection.commit.bind(connection);
      const rollback = connection.rollback.bind(connection);
      connection.commit = async () => {
        state.commits = (state.commits ?? 0) + 1;
        await commit();
      };
      connection.rollback = async () => {
        state.rollbacks = (state.rollbacks ?? 0) + 1;
        await rollback();
      };
      return connection;
    },
  };
}

function transactionConnection(execute) {
  return {
    async beginTransaction() {},
    execute,
    async commit() {},
    async rollback() {},
    release() {},
  };
}
