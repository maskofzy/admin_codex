import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/app.js';
import { sha256Hex } from '../src/lib/crypto.js';
import { AdminRepositoryError } from '../src/services/admin-repository.js';
import {
  TowerConfigRepositoryError,
} from '../src/services/tower-config-repository.js';
import {
  adminHeaders,
  ADMIN_TOKEN,
  projectRegistry,
  testConfig,
} from './helpers.js';

test('requires the global token and a valid project id on every admin endpoint', async t => {
  const fixture = await createFixture(t);

  const noHeaders = await fixture.app.inject({ method: 'GET', url: '/admin/v1/context' });
  assert.equal(noHeaders.statusCode, 401);

  const noProject = await fixture.app.inject({
    method: 'GET',
    url: '/admin/v1/context',
    headers: { 'x-admin-token': ADMIN_TOKEN },
  });
  assert.equal(noProject.statusCode, 400);
  assert.equal(noProject.json().message, 'x-project-id is required');

  const wrongToken = await fixture.app.inject({
    method: 'GET',
    url: '/admin/v1/context',
    headers: adminHeaders('cars', `${ADMIN_TOKEN}-wrong`),
  });
  assert.equal(wrongToken.statusCode, 401);

  const unknownProject = await fixture.app.inject({
    method: 'GET',
    url: '/admin/v1/context',
    headers: adminHeaders('unknown'),
  });
  assert.equal(unknownProject.statusCode, 404);
  assert.equal(unknownProject.json().message, 'project_not_found');

  const context = await adminRequest(fixture.app, 'cars', 'GET', '/admin/v1/context');
  assert.equal(context.response.headers['cache-control'], 'no-store');
  assert.deepEqual(context.body.data, {
    project_id: 'cars',
    project_name: 'Cars',
    platform: 'dy',
    mock_mode: true,
    config_key: 'version1',
    capabilities: {
      leaderboards: true,
      gift_compensation: true,
      guilds: true,
        gift_debug: true,
        configs: true,
        platform_tokens: true,
        tower_config: false,
      },
    gift_catalog: [
      { id: 'nitro', name: 'Nitro', value: 1 },
      { id: 'love-explosion', name: 'Love Explosion', value: 199 },
    ],
  });
});

test('allows tokenless project access only when the development bypass is enabled', async t => {
  const fixture = await createFixture(t, {
    env: {
      HOST: '127.0.0.1',
      ADMIN_AUTH_DISABLED: 'true',
    },
  });
  const noProject = await fixture.app.inject({ method: 'GET', url: '/admin/v1/context' });
  assert.equal(noProject.statusCode, 400);

  const unknownProject = await fixture.app.inject({
    method: 'GET',
    url: '/admin/v1/context',
    headers: { 'x-project-id': 'unknown' },
  });
  assert.equal(unknownProject.statusCode, 404);

  const response = await fixture.app.inject({
    method: 'GET',
    url: '/admin/v1/context',
    headers: { 'x-project-id': 'cars' },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.project_id, 'cars');

  const businessRoute = await fixture.app.inject({ method: 'GET', url: '/dy/startRoom' });
  assert.equal(businessRoute.statusCode, 404);
});

test('exposes isolated tower configuration, CAS updates, and recovery conflicts', async t => {
  const fixture = await createFixture(t);

  const context = await adminRequest(fixture.app, 'tower-dy', 'GET', '/admin/v1/context');
  assert.equal(context.body.data.capabilities.tower_config, true);
  assert.equal(context.body.data.capabilities.configs, false);
  assert.deepEqual(context.body.data.gift_catalog, []);

  const document = await adminRequest(
    fixture.app,
    'tower-dy',
    'GET',
    '/admin/v1/tower-config',
  );
  assert.deepEqual(document.body.data.main, {
    id: '2',
    revision: fixture.states['tower-dy'].towerMain.revision,
    version: 'tower-dy-version',
    remark: 'tower-dy-remark',
    config: { marker: 'tower-dy-main' },
  });
  assert.deepEqual(document.body.data.welfare, {
    id: '7',
    revision: fixture.states['tower-dy'].towerWelfare.revision,
    config: { marker: 'tower-dy-welfare' },
  });
  assert.equal(Object.hasOwn(document.body.data.welfare, 'version'), false);
  assert.equal(Object.hasOwn(document.body.data.welfare, 'remark'), false);

  const mainRevision = document.body.data.main.revision;
  const updatedMain = await adminRequest(
    fixture.app,
    'tower-dy',
    'PUT',
    '/admin/v1/tower-config/main',
    {
      expected_revision: mainRevision,
      config: { marker: 'tower-dy-main-updated', unknown: { kept: true } },
      remark: 'reviewed',
    },
  );
  assert.equal(updatedMain.body.data.remark, 'reviewed');
  assert.deepEqual(updatedMain.body.data.config, {
    marker: 'tower-dy-main-updated',
    unknown: { kept: true },
  });
  const mainConflict = await adminRequest(
    fixture.app,
    'tower-dy',
    'PUT',
    '/admin/v1/tower-config/main',
    { expected_revision: mainRevision, config: { stale: true } },
    409,
  );
  assert.equal(mainConflict.body.message, 'tower_config_conflict');

  const welfareRevision = document.body.data.welfare.revision;
  const updatedWelfare = await adminRequest(
    fixture.app,
    'tower-dy',
    'PUT',
    '/admin/v1/tower-config/welfare',
    {
      expected_revision: welfareRevision,
      config: { marker: 'tower-dy-welfare-updated' },
    },
  );
  assert.deepEqual(updatedWelfare.body.data, {
    id: '7',
    revision: sha256Hex(JSON.stringify({ marker: 'tower-dy-welfare-updated' })),
    config: { marker: 'tower-dy-welfare-updated' },
  });
  const welfareConflict = await adminRequest(
    fixture.app,
    'tower-dy',
    'PUT',
    '/admin/v1/tower-config/welfare',
    { expected_revision: welfareRevision, config: { stale: true } },
    409,
  );
  assert.equal(welfareConflict.body.message, 'tower_config_conflict');

  const dyAnchors = await adminRequest(
    fixture.app,
    'tower-dy',
    'GET',
    '/admin/v1/tower-config/anchors?q=host&limit=20',
  );
  const ksAnchors = await adminRequest(
    fixture.app,
    'tower-ks',
    'GET',
    '/admin/v1/tower-config/anchors?q=host&limit=20',
  );
  assert.equal(dyAnchors.body.data.items[0].open_uid, 'tower-dy-anchor');
  assert.equal(ksAnchors.body.data.items[0].open_uid, 'tower-ks-anchor');
  assert.deepEqual(fixture.states['tower-dy'].towerAnchorQueries, [{ query: 'host', limit: 20 }]);
  assert.deepEqual(fixture.states['tower-ks'].towerAnchorQueries, [{ query: 'host', limit: 20 }]);

  const recoveryPayload = { open_uid: 'tower-dy-anchor', config: { currentLevel: 30 } };
  const recovery = await adminRequest(
    fixture.app,
    'tower-dy',
    'POST',
    '/admin/v1/tower-config/recoveries',
    recoveryPayload,
  );
  assert.equal(recovery.body.data.open_uid, 'tower-dy-anchor');
  const duplicateRecovery = await adminRequest(
    fixture.app,
    'tower-dy',
    'POST',
    '/admin/v1/tower-config/recoveries',
    recoveryPayload,
    409,
  );
  assert.equal(duplicateRecovery.body.message, 'tower_recovery_exists');

  const carsDenied = await adminRequest(
    fixture.app,
    'cars',
    'GET',
    '/admin/v1/tower-config',
    undefined,
    403,
  );
  assert.equal(carsDenied.body.message, 'capability_disabled');
});

test('routes reads and operations to the selected project without sharing services', async t => {
  const fixture = await createFixture(t);

  const carsRank = await adminRequest(
    fixture.app,
    'cars',
    'GET',
    '/admin/v1/leaderboards?period=current_week',
  );
  const arenaRank = await adminRequest(
    fixture.app,
    'arena',
    'GET',
    '/admin/v1/leaderboards?period=current_week',
  );
  assert.equal(carsRank.body.data.items[0].user_id, 'cars-user');
  assert.equal(arenaRank.body.data.items[0].user_id, 'arena-user');
  assert.deepEqual(fixture.states.cars.leaderboardPlatforms, ['dy']);
  assert.deepEqual(fixture.states.arena.leaderboardPlatforms, ['ks']);

  const carsConfigs = await adminRequest(fixture.app, 'cars', 'GET', '/admin/v1/configs');
  const arenaConfigs = await adminRequest(fixture.app, 'arena', 'GET', '/admin/v1/configs');
  assert.equal(carsConfigs.body.data.items[0].config_key, 'version1');
  assert.equal(arenaConfigs.body.data.items[0].config_key, 'version2');
  assert.deepEqual(fixture.states.cars.configKeys, ['version1']);
  assert.deepEqual(fixture.states.arena.configKeys, ['version2']);

  const wrongConfig = await adminRequest(
    fixture.app,
    'cars',
    'PATCH',
    '/admin/v1/configs/version2',
    { version: 1, config: {} },
    404,
  );
  assert.equal(wrongConfig.body.message, 'config_not_found');

  const carsToken = await adminRequest(
    fixture.app,
    'cars',
    'GET',
    '/admin/v1/platform-tokens/dy',
  );
  const arenaToken = await adminRequest(
    fixture.app,
    'arena',
    'GET',
    '/admin/v1/platform-tokens/ks',
  );
  assert.equal(carsToken.body.data.access_token, 'cars-dy-token');
  assert.equal(arenaToken.body.data.access_token, 'arena-ks-token');

  const wrongPlatform = await adminRequest(
    fixture.app,
    'cars',
    'GET',
    '/admin/v1/platform-tokens/ks',
    undefined,
    400,
  );
  assert.equal(wrongPlatform.body.message, 'platform must match the selected project');
});

test('keeps compensation idempotency isolated per project and enforces each gift catalog', async t => {
  const fixture = await createFixture(t);
  const eventId = 'shared-recovery-event';
  const carsPayload = compensationPayload({
    eventId,
    giftId: 'nitro',
    giftName: 'untrusted label',
  });
  const arenaPayload = compensationPayload({
    eventId,
    giftId: 'rocket',
    giftName: 'untrusted label',
  });

  const cars = await adminRequest(
    fixture.app,
    'cars',
    'POST',
    '/admin/v1/compensations',
    carsPayload,
  );
  const arena = await adminRequest(
    fixture.app,
    'arena',
    'POST',
    '/admin/v1/compensations',
    arenaPayload,
  );
  assert.equal(cars.body.data.status, 'enqueued');
  assert.equal(arena.body.data.status, 'enqueued');
  assert.equal(fixture.states.cars.compensations.get(eventId).giftName, 'Nitro');
  assert.equal(fixture.states.arena.compensations.get(eventId).giftName, 'Rocket');
  assert.equal(fixture.states.cars.queued.length, 1);
  assert.equal(fixture.states.arena.queued.length, 1);
  assert.deepEqual(fixture.states.cars.enqueueOptions, [{ permanentDedupe: true }]);
  assert.deepEqual(fixture.states.arena.enqueueOptions, [{ permanentDedupe: true }]);

  const repeated = await adminRequest(
    fixture.app,
    'cars',
    'POST',
    '/admin/v1/compensations',
    carsPayload,
  );
  assert.equal(repeated.body.data.status, 'enqueued');
  assert.equal(fixture.states.cars.queued.length, 1);

  const conflict = await adminRequest(
    fixture.app,
    'cars',
    'POST',
    '/admin/v1/compensations',
    { ...carsPayload, count: 2 },
    409,
  );
  assert.equal(conflict.body.message, 'compensation_payload_conflict');

  const unknownGift = await adminRequest(
    fixture.app,
    'cars',
    'POST',
    '/admin/v1/compensations',
    { ...carsPayload, event_id: 'unknown-gift-event', gift_id: 'rocket' },
    400,
  );
  assert.equal(unknownGift.body.message, 'gift_id is not in the project gift catalog');
});

test('recovers an ambiguous Redis response without ever enqueueing the compensation twice', async t => {
  const fixture = await createFixture(t);
  const state = fixture.states.cars;
  const eventStore = fixture.services.projects.get('cars').eventStore;
  eventStore.enqueue = async (event, options) => {
    state.enqueueOptions.push(options);
    if (!state.queuedIds.has(event.eventId)) {
      state.queuedIds.add(event.eventId);
      state.queued.push(event);
    }
    throw new Error('Redis response lost after script execution');
  };
  const payload = compensationPayload({
    eventId: 'ambiguous-response-event',
    giftId: 'nitro',
    giftName: 'Nitro',
  });

  const recovered = await adminRequest(
    fixture.app,
    'cars',
    'POST',
    '/admin/v1/compensations',
    payload,
  );
  assert.equal(recovered.body.data.status, 'enqueued');
  assert.equal(state.queued.length, 1);
  assert.deepEqual(state.enqueueOptions, [{ permanentDedupe: true }]);

  const retry = await adminRequest(
    fixture.app,
    'cars',
    'POST',
    '/admin/v1/compensations',
    payload,
  );
  assert.equal(retry.body.data.status, 'enqueued');
  assert.equal(state.queued.length, 1);
  assert.equal(state.enqueueOptions.length, 1);
});

test('exposes the durable round-search and paced recovery-job workflow', async t => {
  const fixture = await createFixture(t);
  const search = await adminRequest(
    fixture.app,
    'cars',
    'GET',
    '/admin/v1/compensation-rounds?anchor_nickname=Anchor&started_from=2026-08-07T00%3A00%3A00Z&started_to=2026-08-08T00%3A00%3A00Z',
  );
  assert.equal(search.body.data.items[0].round_db_id, '7');
  assert.equal(search.body.data.items[0].latest_target_room_id, 'target-room');
  assert.equal(fixture.states.cars.roundSearch.anchorNickname, 'Anchor');
  assert.equal(fixture.states.cars.roundSearch.platform, 'dy');

  const gifts = await adminRequest(
    fixture.app,
    'cars',
    'GET',
    '/admin/v1/compensation-rounds/7/gifts',
  );
  assert.equal(gifts.body.data.totals.event_count, 2);
  assert.equal(gifts.body.data.snapshot_max_event_id, '102');
  assert.equal(gifts.body.data.items[0].gift_id, 'legacy-gift');
  assert.equal(gifts.body.data.items[0].catalog_known, false);
  assert.equal(gifts.body.data.items[0].catalog_name, null);

  const created = await adminRequest(
    fixture.app,
    'cars',
    'POST',
    '/admin/v1/compensation-jobs',
    {
      request_id: 'incident-1',
      source_round_id: '7',
      source_snapshot_max_event_id: '102',
      target_room_id: 'target-room',
      selections: [{ user_id: 'viewer-1', gift_id: 'legacy-gift' }],
      seat_players: true,
      comment_content: '上车',
      interval_ms: 1500,
      reason: 'restore interrupted state',
    },
  );
  assert.equal(created.body.data.status, 'pending');
  assert.equal(created.body.data.total_items, 3);
  assert.equal(fixture.states.cars.jobInputs[0].intervalMs, 1500);
  assert.equal(fixture.states.cars.jobInputs[0].sourceSnapshotMaxEventId, '102');
  assert.deepEqual(fixture.states.cars.jobInputs[0].selections, [
    { userId: 'viewer-1', giftId: 'legacy-gift' },
  ]);
  assert.match(fixture.states.cars.jobInputs[0].payloadHash, /^[a-f0-9]{64}$/u);

  const detail = await adminRequest(
    fixture.app,
    'cars',
    'GET',
    '/admin/v1/compensation-jobs/15',
  );
  assert.equal(detail.body.data.items[0].type, 'comment');
  assert.equal(detail.body.data.items[0].status, 'pending');
  const retry = await adminRequest(
    fixture.app,
    'cars',
    'POST',
    '/admin/v1/compensation-jobs/15/retry',
  );
  assert.equal(retry.body.data.id, '15');
  const cancel = await adminRequest(
    fixture.app,
    'cars',
    'POST',
    '/admin/v1/compensation-jobs/15/cancel',
  );
  assert.equal(cancel.body.data.status, 'cancelled');

  const missingSeatComment = await adminRequest(
    fixture.app,
    'cars',
    'POST',
    '/admin/v1/compensation-jobs',
    {
      request_id: 'incident-2', source_round_id: '7', target_room_id: 'target-room',
      source_snapshot_max_event_id: '102',
      selections: [{ user_id: 'viewer-1', gift_id: 'legacy-gift' }],
      seat_players: true, reason: 'restore',
    },
    400,
  );
  assert.equal(missingSeatComment.body.message, 'comment_content is required');

  const tooFast = await adminRequest(
    fixture.app,
    'cars',
    'POST',
    '/admin/v1/compensation-jobs',
    {
      request_id: 'incident-3', source_round_id: '7', target_room_id: 'target-room',
      source_snapshot_max_event_id: '102',
      selections: [{ user_id: 'viewer-1', gift_id: 'legacy-gift' }],
      interval_ms: 499, reason: 'restore',
    },
    400,
  );
  assert.equal(tooFast.body.message, 'interval_ms must be between 500 and 60000');

  const missingSnapshot = await adminRequest(
    fixture.app,
    'cars',
    'POST',
    '/admin/v1/compensation-jobs',
    {
      request_id: 'incident-4', source_round_id: '7', target_room_id: 'target-room',
      selections: [{ user_id: 'viewer-1', gift_id: 'legacy-gift' }], reason: 'restore',
    },
    400,
  );
  assert.equal(missingSnapshot.body.message, 'source_snapshot_max_event_id is required');
});

test('exposes authenticated mock comment, like, and gift events only for enabled mock projects', async t => {
  const fixture = await createFixture(t);
  const comment = {
    type: 'comment',
    roomid: 'room-1',
    event_id: 'debug-comment-1',
    user_id: 'user-1',
    content: '666',
  };
  const first = await adminRequest(
    fixture.app,
    'cars',
    'POST',
    '/admin/v1/debug-events',
    comment,
  );
  assert.equal(first.body.data.accepted, 1);
  const duplicate = await adminRequest(
    fixture.app,
    'cars',
    'POST',
    '/admin/v1/debug-events',
    comment,
  );
  assert.equal(duplicate.body.data.duplicates, 1);
  assert.equal(fixture.states.cars.queued[0].platform, 'dy');

  const gift = await adminRequest(
    fixture.app,
    'cars',
    'POST',
    '/admin/v1/debug-events',
    {
      type: 'gift',
      roomid: 'room-1',
      event_id: 'debug-gift-1',
      user_id: 'user-1',
      gift_id: 'love-explosion',
      gift_name: 'wrong label',
      count: 1,
    },
  );
  assert.equal(gift.body.data.accepted, 1);
  assert.equal(fixture.states.cars.queued[1].payload.giftname, 'Love Explosion');

  const disabled = await adminRequest(
    fixture.app,
    'arena',
    'POST',
    '/admin/v1/debug-events',
    comment,
    403,
  );
  assert.equal(disabled.body.message, 'capability_disabled');
});

async function createFixture(t, options) {
  const registry = options?.registry ?? routeProjectRegistry();
  const config = testConfig({ ...options, registry });
  const states = Object.fromEntries(
    config.projects.map(project => [project.id, createState(project)]),
  );
  const services = {
    projects: new Map(config.projects.map(project => [
      project.id,
      createFakeServices(project, states[project.id]),
    ])),
  };
  const app = await buildApp({ config, services, logger: false });
  t.after(() => app.close());
  return { app, config, services, states };
}

function createState(project) {
  const marker = project.id;
  const tower = project.capabilities.towerConfig ? project.tower : null;
  return {
    marker,
    configKeys: [],
    leaderboardPlatforms: [],
    queued: [],
    queuedIds: new Set(),
    enqueueOptions: [],
    compensations: new Map(),
    jobInputs: [],
    roundSearch: null,
    towerMain: tower ? {
      id: String(tower.mainConfigId),
      revision: sha256Hex(JSON.stringify({ marker: `${marker}-main` })),
      version: `${marker}-version`,
      remark: `${marker}-remark`,
      config: { marker: `${marker}-main` },
    } : null,
    towerWelfare: tower?.welfareConfigId ? {
      id: String(tower.welfareConfigId),
      revision: sha256Hex(JSON.stringify({ marker: `${marker}-welfare` })),
      config: { marker: `${marker}-welfare` },
    } : null,
    towerAnchorQueries: [],
    towerPendingRecoveries: new Set(),
  };
}

function createFakeServices(project, state) {
  return {
    repository: {
      async health() {},
      async listGameConfigs(configKey) {
        state.configKeys.push(configKey);
        return [{
          configKey,
          version: 1,
          config: { marker: state.marker },
          enabled: true,
          remark: '',
          updatedAt: '2026-08-07 08:00:00.000',
        }];
      },
      async updateGameConfig(input) {
        return { ...input, version: input.version + 1, changedAt: input.changedAt };
      },
    },
    adminRepository: fakeAdminRepository(project, state),
    eventStore: {
      async health() {},
      async hasEvent(event) {
        return state.queuedIds.has(event.eventId);
      },
      async enqueue(event, options) {
        state.enqueueOptions.push(options);
        const [accepted] = await this.enqueueMany([event]);
        return accepted;
      },
      async enqueueMany(events) {
        return events.map(event => {
          if (state.queuedIds.has(event.eventId)) return false;
          state.queuedIds.add(event.eventId);
          state.queued.push(event);
          return true;
        });
      },
    },
    platformGateway: {
      async getCachedAccessToken(platform) {
        return { token: `${state.marker}-${platform}-token`, ttlSeconds: 120 };
      },
      async getPlatformAccessToken(platform) {
        return { token: `${state.marker}-${platform}-fresh`, ttlSeconds: 240 };
      },
    },
    towerConfigRepository: project.capabilities.towerConfig
      ? fakeTowerConfigRepository(project, state)
      : null,
  };
}

function fakeTowerConfigRepository(project, state) {
  return {
    async getDocument() {
      return { main: state.towerMain, welfare: state.towerWelfare };
    },
    async updateMain({ expectedRevision, config, remark }) {
      assertTowerRevision(state.towerMain.revision, expectedRevision);
      state.towerMain = {
        ...state.towerMain,
        revision: sha256Hex(JSON.stringify(config)),
        remark: remark === undefined ? state.towerMain.remark : remark,
        config,
      };
      return state.towerMain;
    },
    async updateWelfare({ expectedRevision, config }) {
      if (!state.towerWelfare) {
        throw new TowerConfigRepositoryError('tower_welfare_not_configured', 404);
      }
      assertTowerRevision(state.towerWelfare.revision, expectedRevision);
      state.towerWelfare = {
        ...state.towerWelfare,
        revision: sha256Hex(JSON.stringify(config)),
        config,
      };
      return state.towerWelfare;
    },
    async listAnchors(input) {
      state.towerAnchorQueries.push(input);
      return [{
        openUid: `${state.marker}-anchor`,
        nickname: `${state.marker} host`,
        configId: String(project.tower.anchorConfigIds[0]),
      }];
    },
    async listRecoveries() {
      return [];
    },
    async createRecovery({ openUid, config, createdAt }) {
      if (state.towerPendingRecoveries.has(openUid)) {
        throw new TowerConfigRepositoryError('tower_recovery_exists', 409);
      }
      state.towerPendingRecoveries.add(openUid);
      return {
        id: `${state.marker}-recovery-1`,
        openUid,
        nickname: `${state.marker} host`,
        config,
        isUsed: false,
        createdAt,
      };
    },
  };
}

function assertTowerRevision(current, expected) {
  if (current !== expected) {
    throw new TowerConfigRepositoryError('tower_config_conflict', 409);
  }
}

function routeProjectRegistry() {
  const registry = projectRegistry();
  registry.projects.push(
    {
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
    },
    {
      id: 'tower-ks',
      name: 'Tower KS',
      platform: 'ks',
      database: 'tower_ks_test',
      redisDb: 6,
      envPrefix: 'TOWER_KS',
      configKey: 'tower-main',
      capabilities: ['tower_config'],
      giftCatalog: [],
      tower: { mainConfigId: 4, welfareConfigId: 8, anchorConfigIds: [4, 6] },
    },
  );
  return registry;
}

function fakeAdminRepository(project, state) {
  return {
    async listLeaderboard({ platform }) {
      state.leaderboardPlatforms.push(platform);
      return [{
        rank: 1,
        userId: `${state.marker}-user`,
        nickname: state.marker,
        avatarUrl: '',
        score: 10,
        totalScore: 20,
      }];
    },
    async listUserRounds() { return []; },
    async listCompensationRounds(input) {
      state.roundSearch = input;
      return [compensationRoundRecord()];
    },
    async listCompensationRoundGifts() {
      return {
        round: compensationRoundRecord(),
        snapshotMaxEventId: '102',
        totals: { eventCount: 2, totalCount: 5, totalValue: 30 },
        items: [{
          userId: 'viewer-1', nickname: 'Viewer', avatarUrl: '',
          giftId: 'legacy-gift', giftName: 'Legacy Gift', eventCount: 2,
          totalCount: 5, totalValue: 30,
          firstAt: '2026-08-07 08:01:00.000', lastAt: '2026-08-07 08:02:00.000',
        }],
      };
    },
    async createCompensationJob(input) {
      state.jobInputs.push(input);
      return compensationJobRecord();
    },
    async listCompensationJobs() { return [compensationJobRecord()]; },
    async getCompensationJob() {
      return { ...compensationJobRecord(), items: [compensationJobItemRecord()] };
    },
    async retryCompensationJob() { return compensationJobRecord(); },
    async cancelCompensationJob() {
      return { ...compensationJobRecord(), status: 'cancelled', cancelledItems: 2, pendingItems: 0 };
    },
    async listGiftCompensations() { return [...state.compensations.values()]; },
    async prepareGiftCompensation(input) {
      const existing = state.compensations.get(input.eventId);
      if (existing) {
        if (existing.payloadHash !== input.payloadHash) {
          throw new AdminRepositoryError('conflict', 'compensation_payload_conflict', 409);
        }
        return {
          shouldEnqueue: existing.status === 'pending',
          event: existing.event,
          compensation: existing,
        };
      }
      const record = {
        id: `${state.marker}-${state.compensations.size + 1}`,
        ...input,
        status: 'pending',
        attemptCount: 0,
        lastError: '',
        updatedAt: input.createdAt,
        enqueuedAt: null,
      };
      state.compensations.set(input.eventId, record);
      return { shouldEnqueue: true, event: input.event, compensation: record };
    },
    async retryGiftCompensation({ eventId }) {
      const record = state.compensations.get(eventId);
      if (!record) throw new AdminRepositoryError('missing', 'compensation_not_found', 404);
      return { event: record.event, compensation: record };
    },
    async finishGiftCompensation({ eventId, status, completedAt }) {
      const record = state.compensations.get(eventId);
      if (record.status === 'enqueued' && status === 'duplicate') return record;
      record.status = status;
      record.attemptCount += 1;
      record.updatedAt = completedAt;
      record.enqueuedAt ??= completedAt;
      return record;
    },
    async failGiftCompensation({ eventId, error, failedAt }) {
      const record = state.compensations.get(eventId);
      record.status = 'failed';
      record.attemptCount += 1;
      record.lastError = error.message;
      record.updatedAt = failedAt;
    },
    async listConfigRevisions() { return []; },
    async listGuilds() { return []; },
    async createGuild() { throw new Error(`Unexpected guild create for ${project.id}`); },
    async updateGuild() { throw new Error(`Unexpected guild update for ${project.id}`); },
    async listGuildMembers() { return []; },
    async putGuildMember() { throw new Error(`Unexpected guild member write for ${project.id}`); },
    async deleteGuildMember() { throw new Error(`Unexpected guild member delete for ${project.id}`); },
  };
}

function compensationRoundRecord() {
  return {
    roundDbId: '7', roomDbId: '3', roomId: 'source-room', externalRoundId: 'round-7',
    status: 'settled', startedAt: '2026-08-07 08:00:00.000',
    settledAt: '2026-08-07 08:05:00.000', anchorUserId: 'anchor-1',
    anchorNickname: 'Anchor', anchorAvatarUrl: '', latestTargetRoomId: 'target-room',
    latestTargetRoomAuthenticatedAt: '2026-08-07 08:09:00.000',
  };
}

function compensationJobRecord() {
  return {
    id: '15', requestId: 'incident-1', sourceRoundId: '7', sourceRoomId: 'source-room',
    sourceSnapshotMaxEventId: '102',
    sourceExternalRoundId: 'round-7', targetRoomId: 'target-room', status: 'pending',
    seatPlayers: true, commentContent: '上车', intervalMs: 1500,
    reason: 'restore interrupted state', totalItems: 3, completedItems: 0,
    failedItems: 0, cancelledItems: 0, pendingItems: 3, totalGiftEvents: 2,
    totalGiftCount: 5, totalGiftValue: 30, totalSeatEvents: 1, lastError: '',
    nextRunAt: '2026-08-07 08:10:00.000', startedAt: null, finishedAt: null,
    createdAt: '2026-08-07 08:10:00.000', updatedAt: '2026-08-07 08:10:00.000',
  };
}

function compensationJobItemRecord() {
  return {
    id: '20', sequence: 1, type: 'comment', sourceGiftEventId: null,
    eventId: 'recovery:seat', userId: 'viewer-1', nickname: 'Viewer', avatarUrl: '',
    giftId: null, giftName: null, count: null, value: null, status: 'pending',
    sourceClaimReleased: null, attemptCount: 0, lastError: '',
    leaseExpiresAt: null, enqueuedAt: null,
  };
}

function compensationPayload({ eventId, giftId, giftName }) {
  return {
    event_id: eventId,
    room_id: 'room-1',
    user_id: 'user-1',
    nickname: 'User One',
    avatar_url: '',
    gift_id: giftId,
    gift_name: giftName,
    count: 1,
    reason: 'restore state',
  };
}

async function adminRequest(app, projectId, method, url, payload, expectedStatus = 200) {
  const response = await app.inject({
    method,
    url,
    headers: adminHeaders(projectId),
    ...(payload === undefined ? {} : { payload }),
  });
  assert.equal(response.statusCode, expectedStatus, response.body);
  return { response, body: response.json() };
}
