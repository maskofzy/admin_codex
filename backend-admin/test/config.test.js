import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.js';
import { ADMIN_TOKEN, projectRegistry, testConfig } from './helpers.js';

test('loads multiple fixed project targets and project-prefixed credentials', () => {
  const config = testConfig({
    env: {
      PORT: '',
      CARS_MYSQL_HOST: 'cars.mysql',
      CARS_MYSQL_CONNECTION_LIMIT: '7',
      CARS_REDIS_HOST: 'cars.redis',
      CARS_DOUYIN_APP_ID: 'cars-dy',
      CARS_DOUYIN_APP_SECRET: 'cars-secret',
      ARENA_KUAISHOU_APP_ID: 'arena-ks',
      ARENA_KUAISHOU_APP_SECRET: 'arena-secret',
    },
  });

  assert.equal(config.port, 8121);
  assert.equal(config.projects.length, 2);
  assert.equal(config.projectsById.get('cars').mysql.database, 'cars_test');
  assert.equal(config.projectsById.get('cars').mysql.host, 'cars.mysql');
  assert.equal(config.projectsById.get('cars').mysql.connectionLimit, 7);
  assert.equal(config.projectsById.get('cars').redis.db, 3);
  assert.equal(config.projectsById.get('cars').redis.host, 'cars.redis');
  assert.equal(config.projectsById.get('cars').douyin.appId, 'cars-dy');
  assert.equal(config.projectsById.get('arena').kuaishou.appId, 'arena-ks');
  assert.equal(config.projectsById.get('arena').platform, 'ks');
});

test('requires a global strong admin token', () => {
  assert.throws(
    () => loadConfig({ ADMIN_API_TOKEN: 'short' }, projectRegistry()),
    /ADMIN_API_TOKEN must contain at least 32 characters/,
  );
});

test('allows an explicit development-only authentication bypass', () => {
  const config = loadConfig({
    NODE_ENV: 'development',
    HOST: '127.0.0.1',
    ADMIN_AUTH_DISABLED: 'true',
    CARS_MOCK_MODE: 'true',
    ARENA_MOCK_MODE: 'true',
  }, projectRegistry());
  assert.equal(config.adminAuthDisabled, true);
  assert.equal(config.adminToken, '');

  assert.throws(
    () => loadConfig({
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      ADMIN_AUTH_DISABLED: 'true',
    }, projectRegistry()),
    /ADMIN_AUTH_DISABLED is allowed only in development or test/,
  );

  assert.throws(
    () => loadConfig({
      NODE_ENV: 'development',
      HOST: '0.0.0.0',
      ADMIN_AUTH_DISABLED: 'true',
      CARS_MOCK_MODE: 'true',
      ARENA_MOCK_MODE: 'true',
    }, projectRegistry()),
    /ADMIN_AUTH_DISABLED requires a loopback HOST/,
  );

  assert.throws(
    () => loadConfig({
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      ADMIN_AUTH_DISABLED: 'true',
      CARS_MOCK_MODE: 'false',
      ARENA_MOCK_MODE: 'true',
    }, projectRegistry()),
    /ADMIN_AUTH_DISABLED requires every project to use mock mode/,
  );
});

test('rejects duplicate project ids, MySQL targets, Redis targets, and invalid registry fields', async t => {
  await t.test('duplicate id', () => {
    const registry = projectRegistry();
    registry.projects[1].id = 'cars';
    assert.throws(() => loadConfig({ ADMIN_API_TOKEN: ADMIN_TOKEN }, registry), /project id must be unique/);
  });
  await t.test('duplicate MySQL target', () => {
    const registry = projectRegistry();
    registry.projects[1].database = 'cars_test';
    assert.throws(
      () => loadConfig({ ADMIN_API_TOKEN: ADMIN_TOKEN }, registry),
      /project MySQL target must be unique/,
    );
  });
  await t.test('duplicate Redis target', () => {
    const registry = projectRegistry();
    registry.projects[1].redisDb = 3;
    assert.throws(
      () => loadConfig({ ADMIN_API_TOKEN: ADMIN_TOKEN }, registry),
      /project Redis target must be unique/,
    );
  });
  await t.test('unknown capability', () => {
    const registry = projectRegistry();
    registry.projects[0].capabilities.push('anything');
    assert.throws(() => loadConfig({ ADMIN_API_TOKEN: ADMIN_TOKEN }, registry), /Unknown capability/);
  });
  await t.test('unsafe database name', () => {
    const registry = projectRegistry();
    registry.projects[0].database = 'cars; USE other';
    assert.throws(() => loadConfig({ ADMIN_API_TOKEN: ADMIN_TOKEN }, registry), /MySQL database name/);
  });
  await t.test('missing gift catalog for gift operations', () => {
    const registry = projectRegistry();
    registry.projects[0].giftCatalog = [];
    assert.throws(
      () => loadConfig({ ADMIN_API_TOKEN: ADMIN_TOKEN }, registry),
      /giftCatalog is required for gift operations/,
    );
  });
});

test('requires explicit fixed ids for standalone tower configuration projects', () => {
  const registry = projectRegistry();
  registry.projects.push({
    id: 'tower-dy',
    name: 'Tower DY',
    platform: 'dy',
    database: 'tower_dy_test',
    redisDb: 5,
    envPrefix: 'TOWER_DY',
    configKey: 'tower-main',
    capabilities: ['tower_config'],
    giftCatalog: [],
    tower: { mainConfigId: 2, welfareConfigId: 7, anchorConfigIds: [2, 3] },
  });
  const config = loadConfig({
    NODE_ENV: 'test',
    ADMIN_API_TOKEN: ADMIN_TOKEN,
  }, registry);
  const tower = config.projectsById.get('tower-dy');
  assert.equal(tower.capabilities.towerConfig, true);
  assert.deepEqual(tower.tower, {
    mainConfigId: 2,
    welfareConfigId: 7,
    anchorConfigIds: [2, 3],
  });

  registry.projects.at(-1).tower = { mainConfigId: 2, anchorConfigIds: [] };
  assert.throws(
    () => loadConfig({ ADMIN_API_TOKEN: ADMIN_TOKEN }, registry),
    /anchorConfigIds must be a non-empty array/,
  );
  registry.projects.at(-1).tower = { mainConfigId: 2, anchorConfigIds: [2] };
  registry.projects.at(-1).capabilities = ['tower_config', 'operations'];
  assert.throws(
    () => loadConfig({ ADMIN_API_TOKEN: ADMIN_TOKEN }, registry),
    /tower_config cannot be combined/,
  );
});
