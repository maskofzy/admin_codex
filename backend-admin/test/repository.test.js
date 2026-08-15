import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  ConfigConflictError,
  createRepository,
  Repository,
} from '../src/services/repository.js';

test('createRepository preserves SQL dates as strings and initializes UTC sessions', async () => {
  const repository = createRepository({
    host: '127.0.0.1',
    port: 3306,
    user: 'test',
    password: '',
    database: 'test',
    connectionLimit: 1,
  });
  try {
    assert.equal(repository.pool.pool.config.connectionConfig.dateStrings, true);
    let sessionSql;
    repository.pool.emit('connection', {
      query(sql, callback) {
        sessionSql = sql;
        callback();
      },
    });
    assert.equal(sessionSql, "SET SESSION time_zone = '+00:00'");
  } finally {
    await repository.close();
  }
});

test('scopes configuration reads to the registered config key', async () => {
  const pool = {
    async execute(sql, params) {
      assert.match(sql, /WHERE gc\.config_key = \?/u);
      assert.deepEqual(params, ['version1']);
      return [[{
        config_key: 'version1', version: 2, config_json: '{"cars":300}', enabled: 1,
        updated_at: '2026-08-07 08:00:00.000', remark: 'update', changed_at: '2026-08-07 08:00:00.000',
      }]];
    },
  };
  const repository = new Repository(pool);
  const configs = await repository.listGameConfigs('version1');
  assert.deepEqual(configs[0].config, { cars: 300 });
  assert.equal(configs[0].version, 2);
});

test('configuration writes use a locked CAS transaction', async () => {
  const calls = [];
  const connection = {
    async beginTransaction() { calls.push('begin'); },
    async execute(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('SELECT version, enabled')) return [[{ version: 4, enabled: 1 }]];
      return [{ affectedRows: 1 }];
    },
    async commit() { calls.push('commit'); },
    async rollback() { calls.push('rollback'); },
    release() { calls.push('release'); },
  };
  const repository = new Repository({ async getConnection() { return connection; } });
  const updated = await repository.updateGameConfig({
    configKey: 'version1',
    version: 4,
    config: { cars: 360 },
    enabled: false,
    remark: 'scale',
    changedAt: new Date('2026-08-07T08:00:00.000Z'),
  });
  assert.equal(updated.version, 5);
  assert.equal(updated.enabled, false);
  assert.match(calls[1].sql, /FOR UPDATE/u);
  assert.equal(calls.at(-2), 'commit');

  const stale = new Repository({
    async getConnection() {
      return {
        ...connection,
        async execute(sql) {
          if (sql.includes('SELECT version, enabled')) return [[{ version: 5, enabled: 1 }]];
          return [{ affectedRows: 1 }];
        },
      };
    },
  });
  await assert.rejects(
    stale.updateGameConfig({ configKey: 'version1', version: 4, config: {} }),
    error => error instanceof ConfigConflictError && error.code === 'config_version_conflict',
  );
});

test('runtime and schema code never issue dynamic USE database statements', async () => {
  const files = [
    '../src/services/repository.js',
    '../src/services/project-services.js',
    '../src/services/management-schema.js',
    '../scripts/apply-schema.js',
    '../database/schema.sql',
  ];
  for (const relative of files) {
    const source = await readFile(new URL(relative, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\bUSE\s+[`\w]/iu, relative);
  }
});
