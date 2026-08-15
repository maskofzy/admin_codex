import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PlatformConfigurationError,
  PlatformGateway,
} from '../src/services/platform-gateway.js';

test('uses the business-compatible platform/appId cache key and platform expiry field', async () => {
  const redis = fakeRedis();
  const gateway = new PlatformGateway({
    config: credentials(),
    redis,
    fetchImpl: async () => response({ data: { access_token: 'dy-new', expires_in: 7200 } }),
  });
  const token = await gateway.getPlatformAccessToken('dy', { forceRefresh: true });
  assert.deepEqual(token, { token: 'dy-new', ttlSeconds: 7140 });
  assert.deepEqual(redis.setCalls, [[
    'platform:dy:dy-app:access-token',
    'dy-new',
    'EX',
    7140,
  ]]);
});

test('parses Kuaishou expiresIn independently and preserves an old token on refresh failure', async () => {
  const redis = fakeRedis({
    'platform:ks:ks-app:access-token': { value: 'ks-old', ttl: 300 },
  });
  const failed = new PlatformGateway({
    config: credentials(),
    redis,
    fetchImpl: async () => { throw new Error('platform unavailable'); },
  });
  await assert.rejects(
    failed.getPlatformAccessToken('ks', { forceRefresh: true }),
    /platform unavailable/,
  );
  assert.equal(redis.values.get('platform:ks:ks-app:access-token').value, 'ks-old');
  assert.equal(redis.setCalls.length, 0);

  const working = new PlatformGateway({
    config: credentials(),
    redis,
    fetchImpl: async () => response({ access_token: 'ks-new', expiresIn: 1800 }),
  });
  const token = await working.getPlatformAccessToken('ks', { forceRefresh: true });
  assert.deepEqual(token, { token: 'ks-new', ttlSeconds: 1740 });
});

test('reports missing project-prefixed credentials without touching Redis', async () => {
  const redis = fakeRedis();
  const gateway = new PlatformGateway({
    config: { douyin: { appId: '', appSecret: '' }, kuaishou: { appId: '', appSecret: '' } },
    redis,
  });
  await assert.rejects(
    gateway.getCachedAccessToken('dy'),
    error => error instanceof PlatformConfigurationError,
  );
  assert.equal(redis.getCalls.length, 0);
});

function credentials() {
  return {
    douyin: { appId: 'dy-app', appSecret: 'dy-secret' },
    kuaishou: { appId: 'ks-app', appSecret: 'ks-secret' },
  };
}

function fakeRedis(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getCalls: [],
    setCalls: [],
    async get(key) {
      this.getCalls.push(key);
      return values.get(key)?.value ?? null;
    },
    async ttl(key) { return values.get(key)?.ttl ?? -2; },
    async set(...args) {
      this.setCalls.push(args);
      values.set(args[0], { value: args[1], ttl: args[3] });
    },
  };
}

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(body); },
  };
}
