import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyManagementSchema,
  REQUIRED_BUSINESS_COLUMNS,
  REQUIRED_BUSINESS_TABLES,
  REQUIRED_TOWER_COLUMNS,
} from '../src/services/management-schema.js';
import { projectRegistry, testConfig } from './helpers.js';

test('preflights every project business schema before creating management tables', async () => {
  assert.ok(REQUIRED_BUSINESS_TABLES.includes('live_gift_event'));
  const config = testConfig();
  const calls = [];
  const applied = await applyManagementSchema(config, 'CREATE TABLE management_test (id INT)', {
    connectionFactory: async (mysql, project) => ({
      async query(sql, params) {
        calls.push({ project: project.id, sql, params, database: mysql.database });
        if (sql.includes('information_schema.TABLES')) {
          return [REQUIRED_BUSINESS_TABLES.map(table_name => ({ table_name }))];
        }
        if (sql.includes('information_schema.COLUMNS')) {
          return [requiredColumnRows()];
        }
        return [{ affectedRows: 0 }];
      },
      async end() { calls.push({ project: project.id, sql: 'END' }); },
    }),
  });

  assert.deepEqual(applied, [
    { projectId: 'cars', database: 'cars_test' },
    { projectId: 'arena', database: 'arena_test' },
  ]);
  for (const projectId of ['cars', 'arena']) {
    const projectCalls = calls.filter(call => call.project === projectId);
    assert.match(projectCalls[0].sql, /information_schema\.TABLES/);
    assert.match(projectCalls[1].sql, /information_schema\.COLUMNS/);
    assert.equal(projectCalls[2].sql, 'CREATE TABLE management_test (id INT)');
    assert.equal(projectCalls.at(-1).sql, 'END');
  }
});

test('fails before mutation when a project business schema is incomplete', async () => {
  const registry = projectRegistry();
  registry.projects = [registry.projects[0]];
  const config = testConfig({ registry });
  let schemaExecuted = false;
  await assert.rejects(
    applyManagementSchema(config, 'MUTATION', {
      connectionFactory: async () => ({
        async query(sql) {
          if (sql.includes('information_schema.TABLES')) {
            return [[{ table_name: 'platform_user' }]];
          }
          schemaExecuted = true;
          return [[]];
        },
        async end() {},
      }),
    }),
    /Business schema is incomplete in cars_test/,
  );
  assert.equal(schemaExecuted, false);
});

test('fails before mutation when recovery-ledger columns are incomplete', async () => {
  const registry = projectRegistry();
  registry.projects = [registry.projects[0]];
  const config = testConfig({ registry });
  let schemaExecuted = false;
  await assert.rejects(
    applyManagementSchema(config, 'MUTATION', {
      connectionFactory: async () => ({
        async query(sql) {
          if (sql.includes('information_schema.TABLES')) {
            return [REQUIRED_BUSINESS_TABLES.map(table_name => ({ table_name }))];
          }
          if (sql.includes('information_schema.COLUMNS')) {
            return [requiredColumnRows().filter(row => (
              row.column_name !== 'anchor_nickname_snapshot'
            ))];
          }
          schemaExecuted = true;
          return [[]];
        },
        async end() {},
      }),
    }),
    /missing game_round\.anchor_nickname_snapshot/u,
  );
  assert.equal(schemaExecuted, false);
});

test('preflights tower legacy tables without applying the generic management schema', async () => {
  const registry = projectRegistry();
  registry.projects = [{
    id: 'tower-dy', name: 'Tower DY', platform: 'dy', database: 'tower_dy_test',
    redisDb: 9, envPrefix: 'TOWER_DY', configKey: 'tower-main',
    capabilities: ['tower_config'], giftCatalog: [],
    tower: { mainConfigId: 1, anchorConfigIds: [1] },
  }];
  const config = testConfig({ registry });
  const calls = [];
  const applied = await applyManagementSchema(config, 'GENERIC MUTATION', {
    connectionFactory: async () => ({
      async query(sql) {
        calls.push(sql);
        if (sql.includes('information_schema.TABLES')) {
          return [[
            { table_name: 't_config' },
            { table_name: 't_anchor_info' },
            { table_name: 't_config_recover' },
          ]];
        }
        if (sql.includes('information_schema.COLUMNS')) {
          return [Object.entries(REQUIRED_TOWER_COLUMNS)
            .filter(([table]) => table !== 't_config_welfare')
            .flatMap(([table_name, columns]) => (
              columns.map(column_name => ({ table_name, column_name }))
            ))];
        }
        if (sql.startsWith('SELECT ID FROM t_config')) return [[{ ID: 1 }]];
        throw new Error(`Unexpected SQL: ${sql}`);
      },
      async end() { calls.push('END'); },
    }),
  });

  assert.deepEqual(applied, [{ projectId: 'tower-dy', database: 'tower_dy_test' }]);
  assert.equal(calls.includes('GENERIC MUTATION'), false);
  assert.equal(calls.at(-1), 'END');
});

function requiredColumnRows() {
  return Object.entries(REQUIRED_BUSINESS_COLUMNS).flatMap(([table_name, columns]) => (
    columns.map(column_name => ({ table_name, column_name }))
  ));
}
