import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/app.js';
import { testConfig } from './helpers.js';

test('registers only public health and authenticated admin routes', async t => {
  const config = testConfig();
  const services = { projects: new Map(config.projects.map(project => [project.id, healthyServices()])) };
  const app = await buildApp({ config, services, logger: false });
  t.after(() => app.close());

  const health = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(health.statusCode, 200);
  assert.deepEqual(health.json(), {
    ok: true,
    projects: [
      { project_id: 'cars', mysql: 'ok', redis: 'ok' },
      { project_id: 'arena', mysql: 'ok', redis: 'ok' },
    ],
  });

  for (const url of ['/dy/startRoom', '/dy/getHash', '/msg', '/ksmsg', '/debug/events']) {
    const response = await app.inject({ method: 'GET', url });
    assert.equal(response.statusCode, 404, url);
  }

  const preflight = await app.inject({
    method: 'OPTIONS',
    url: '/admin/v1/context',
    headers: {
      origin: 'http://127.0.0.1:4173',
      'access-control-request-method': 'GET',
      'access-control-request-headers': 'x-admin-token,x-project-id',
    },
  });
  assert.equal(preflight.statusCode, 204);
  const allowedHeaders = preflight.headers['access-control-allow-headers'].toLowerCase();
  assert.match(allowedHeaders, /x-admin-token/u);
  assert.match(allowedHeaders, /x-project-id/u);
});

test('health reports every project independently and returns 503 when one dependency is down', async t => {
  const config = testConfig();
  const services = {
    projects: new Map([
      ['cars', healthyServices()],
      ['arena', healthyServices({ redisError: new Error('down') })],
    ]),
  };
  const app = await buildApp({ config, services, logger: false });
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json().projects, [
    { project_id: 'cars', mysql: 'ok', redis: 'ok' },
    { project_id: 'arena', mysql: 'ok', redis: 'error' },
  ]);
});

test('limits tokenless CORS access to local management pages', async t => {
  const config = testConfig({ env: { HOST: '127.0.0.1', ADMIN_AUTH_DISABLED: 'true' } });
  const services = { projects: new Map(config.projects.map(project => [project.id, healthyServices()])) };
  const app = await buildApp({ config, services, logger: false });
  t.after(() => app.close());

  const local = await app.inject({
    method: 'OPTIONS',
    url: '/admin/v1/context',
    headers: {
      origin: 'http://127.0.0.1:4174',
      'access-control-request-method': 'GET',
      'access-control-request-headers': 'x-project-id',
    },
  });
  assert.equal(local.headers['access-control-allow-origin'], 'http://127.0.0.1:4174');

  const remote = await app.inject({
    method: 'OPTIONS',
    url: '/admin/v1/context',
    headers: {
      origin: 'https://example.com',
      'access-control-request-method': 'GET',
      'access-control-request-headers': 'x-project-id',
    },
  });
  assert.equal(remote.headers['access-control-allow-origin'], undefined);
});

function healthyServices({ mysqlError, redisError } = {}) {
  return {
    repository: { async health() { if (mysqlError) throw mysqlError; } },
    eventStore: { async health() { if (redisError) throw redisError; } },
    adminRepository: {},
    platformGateway: {},
  };
}
