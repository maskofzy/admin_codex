import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectServices } from '../src/services/project-services.js';
import { projectRegistry, testConfig } from './helpers.js';

test('creates distinct fixed MySQL and Redis clients for every registered project', async () => {
  const config = testConfig();
  const mysqlTargets = [];
  const redisTargets = [];
  const closed = [];
  const services = createProjectServices(config, {
    repositoryFactory(mysql, project) {
      mysqlTargets.push({ project: project.id, ...mysql });
      return { pool: { project: project.id }, async close() { closed.push(`mysql:${project.id}`); } };
    },
    redisFactory(redis, project) {
      redisTargets.push({ project: project.id, ...redis });
      return { project: project.id };
    },
    eventStoreFactory(_redis, project) {
      return { async close() { closed.push(`redis:${project.id}`); } };
    },
    adminRepositoryFactory(repository, project) {
      return { project: project.id, pool: repository.pool };
    },
    platformGatewayFactory(project, redis) {
      return { project: project.id, redis };
    },
    compensationWorkerFactory(repository, eventStore, project) {
      assert.equal(repository.project, project.id);
      return {
        start() { closed.push(`worker-start:${project.id}`); },
        async stop() {
          assert.ok(eventStore);
          closed.push(`worker-stop:${project.id}`);
        },
      };
    },
  });

  assert.deepEqual(mysqlTargets.map(target => [target.project, target.database]), [
    ['cars', 'cars_test'],
    ['arena', 'arena_test'],
  ]);
  assert.deepEqual(redisTargets.map(target => [target.project, target.db]), [
    ['cars', 3],
    ['arena', 4],
  ]);
  assert.notEqual(services.projects.get('cars'), services.projects.get('arena'));
  assert.equal(services.projects.get('cars').adminRepository.pool.project, 'cars');
  assert.equal(services.projects.get('arena').adminRepository.pool.project, 'arena');
  assert.deepEqual(closed, ['worker-start:cars', 'worker-start:arena']);

  await services.close();
  assert.deepEqual(new Set(closed), new Set([
    'worker-start:cars', 'worker-start:arena',
    'worker-stop:cars', 'worker-stop:arena',
    'mysql:cars', 'redis:cars', 'mysql:arena', 'redis:arena',
  ]));
  assert.ok(closed.indexOf('worker-stop:cars') < closed.indexOf('mysql:cars'));
  assert.ok(closed.indexOf('worker-stop:cars') < closed.indexOf('redis:cars'));
});

test('creates only a MySQL tower repository for standalone tower projects', async () => {
  const registry = projectRegistry();
  registry.projects = [{
    id: 'tower-ks',
    name: 'Tower KS',
    platform: 'ks',
    database: 'tower_ks_test',
    redisDb: 8,
    envPrefix: 'TOWER_KS',
    configKey: 'tower-main',
    capabilities: ['tower_config'],
    giftCatalog: [],
    tower: { mainConfigId: 4, anchorConfigIds: [4] },
  }];
  const config = testConfig({ registry });
  const calls = [];
  const services = createProjectServices(config, {
    repositoryFactory(_mysql, project) {
      return { pool: { project: project.id }, async close() { calls.push('mysql-close'); } };
    },
    redisFactory() {
      throw new Error('tower projects must not create Redis clients');
    },
    adminRepositoryFactory() {
      throw new Error('tower projects must not create generic admin repositories');
    },
    platformGatewayFactory() {
      throw new Error('tower projects must not create platform gateways');
    },
    towerConfigRepositoryFactory(repository, project) {
      calls.push(['tower', repository.pool.project, project.tower.mainConfigId]);
      return { project: project.id };
    },
  });

  assert.deepEqual(calls, [['tower', 'tower-ks', 4]]);
  assert.equal(services.projects.get('tower-ks').eventStore, null);
  assert.equal(services.projects.get('tower-ks').adminRepository, null);
  assert.equal(services.projects.get('tower-ks').towerConfigRepository.project, 'tower-ks');
  await services.close();
  assert.deepEqual(calls, [['tower', 'tower-ks', 4], 'mysql-close']);
});
