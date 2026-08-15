import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import {
  assertTowerSchema,
  REQUIRED_BUSINESS_TABLES,
} from '../../src/services/management-schema.js';
import { createProjectServices } from '../../src/services/project-services.js';

const MANAGEMENT_TABLES = [
  'guild',
  'guild_member',
  'gift_compensation',
  'compensation_job',
  'compensation_job_item',
];

test('all registered projects expose healthy isolated management contexts', { timeout: 30_000 }, async t => {
  const config = loadConfig();
  const services = createProjectServices(config);
  const app = await buildApp({ config, services, logger: false });
  t.after(async () => {
    await app.close();
    await services.close();
  });

  const health = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(health.statusCode, 200, health.body);
  assert.equal(health.json().projects.length, config.projects.length);

  for (const project of config.projects) {
    const projectServices = services.projects.get(project.id);
    const [[session]] = await projectServices.repository.pool.query(
      'SELECT @@session.time_zone AS session_time_zone',
    );
    assert.equal(session.session_time_zone, '+00:00');
    if (project.capabilities.towerConfig) {
      await assertTowerSchema(projectServices.repository.pool, project.mysql.database, project.tower);
      assert.equal(projectServices.adminRepository, null);
      assert.equal(projectServices.eventStore, null);
    } else {
      const [rows] = await projectServices.repository.pool.query(
        `SELECT TABLE_NAME AS table_name
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?)`,
        [project.mysql.database, [...REQUIRED_BUSINESS_TABLES, ...MANAGEMENT_TABLES]],
      );
      const present = new Set(rows.map(row => row.table_name));
      const missing = [...REQUIRED_BUSINESS_TABLES, ...MANAGEMENT_TABLES]
        .filter(table => !present.has(table));
      assert.deepEqual(missing, [], `${project.id} missing tables: ${missing.join(', ')}`);
    }

    const context = await app.inject({
      method: 'GET',
      url: '/admin/v1/context',
      headers: {
        'x-admin-token': config.adminToken,
        'x-project-id': project.id,
      },
    });
    assert.equal(context.statusCode, 200, context.body);
    assert.equal(context.json().data.project_id, project.id);
    assert.equal(context.json().data.platform, project.platform);
    assert.equal(context.json().data.config_key, project.configKey);
    assert.equal(
      context.json().data.capabilities.tower_config,
      project.capabilities.towerConfig,
    );

    if (project.capabilities.towerConfig) {
      const towerConfig = await app.inject({
        method: 'GET',
        url: '/admin/v1/tower-config',
        headers: {
          'x-admin-token': config.adminToken,
          'x-project-id': project.id,
        },
      });
      assert.equal(towerConfig.statusCode, 200, towerConfig.body);
      assert.equal(towerConfig.json().data.main.id, String(project.tower.mainConfigId));
      assert.equal(towerConfig.json().data.main.config.monsterConfig.length, 90);
    }
  }
});
