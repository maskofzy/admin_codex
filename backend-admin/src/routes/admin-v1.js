import { sha256Hex } from '../lib/crypto.js';
import { normalizeDebugEvent } from '../lib/debug-events.js';
import { isRecord } from '../lib/json.js';
import { currentPeriodStart } from '../lib/periods.js';
import { toIsoUtc } from '../lib/time.js';
import { InputError, identifier, objectBody, text } from '../lib/values.js';
import { AdminRepositoryError } from '../services/admin-repository.js';
import { PlatformConfigurationError } from '../services/platform-gateway.js';
import { ConfigConflictError } from '../services/repository.js';
import { TowerConfigRepositoryError } from '../services/tower-config-repository.js';
import {
  authenticateAdminProject,
  failure,
  requireCapability,
  success,
} from './shared.js';

const LEADERBOARD_PERIODS = new Set(['current_week', 'previous_week']);
const USER_ROUND_PERIODS = new Set([...LEADERBOARD_PERIODS, 'all']);
const COMPENSATION_STATUSES = new Set(['pending', 'enqueued', 'duplicate', 'failed']);
const DEBUG_EVENT_TYPES = new Set(['comment', 'like', 'gift']);
const GUILD_ROLES = new Set(['member', 'manager']);
const PLATFORMS = new Set(['dy', 'ks']);
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export async function adminV1Routes(app, { config, services }) {
  app.addHook('onRequest', async (request, reply) => {
    disableResponseCaching(reply);
    const context = authenticateAdminProject(request, reply, config, services);
    if (!context) return reply;
    request.adminContext = context;
  });

  app.setErrorHandler((error, request, reply) => {
    if (reply.sent) return reply;
    if (error instanceof InputError) {
      return reply.code(400).send(failure(400, error.message));
    }
    if (error instanceof AdminRepositoryError) {
      return reply.code(error.status).send(failure(error.status, error.code));
    }
    if (error instanceof ConfigConflictError) {
      const status = error.code === 'config_not_found' ? 404 : 409;
      return reply.code(status).send(failure(status, error.code));
    }
    if (error instanceof TowerConfigRepositoryError) {
      return reply.code(error.status).send(failure(error.status, error.code));
    }
    if (error instanceof PlatformConfigurationError) {
      return reply.code(503).send(failure(503, 'platform_credentials_not_configured'));
    }
    request.log.error({ err: error }, 'admin v1 request failed');
    return reply.code(500).send(failure(500, 'internal server error'));
  });

  app.get('/admin/v1/context', async request => {
    const { project } = request.adminContext;
    return success({
      project_id: project.id,
      project_name: project.name,
      platform: project.platform,
      mock_mode: project.mockMode,
      config_key: project.configKey,
      capabilities: {
        leaderboards: project.capabilities.leaderboards,
        gift_compensation: project.capabilities.compensations,
        guilds: project.capabilities.guilds,
        gift_debug: project.capabilities.debug && project.mockMode,
        configs: project.capabilities.operations,
        platform_tokens: project.capabilities.operations,
        tower_config: project.capabilities.towerConfig,
      },
      gift_catalog: project.giftCatalog.map(gift => ({ ...gift })),
    });
  });

  app.get('/admin/v1/tower-config', async (request, reply) => {
    if (!requireCapability(request, reply, 'towerConfig')) return reply;
    const document = await request.adminContext.services.towerConfigRepository.getDocument();
    return success({
      main: toTowerMainConfigRecord(document.main),
      welfare: document.welfare ? toTowerWelfareConfigRecord(document.welfare) : null,
    });
  });

  app.put('/admin/v1/tower-config/main', async (request, reply) => {
    if (!requireCapability(request, reply, 'towerConfig')) return reply;
    const input = objectBody(request.body);
    if (!isRecord(input.config)) throw new InputError('config must be a JSON object');
    const updated = await request.adminContext.services.towerConfigRepository.updateMain({
      expectedRevision: towerRevision(input.expected_revision),
      config: input.config,
      remark: Object.hasOwn(input, 'remark')
        ? strictOptionalText(input.remark, 'remark', 255)
        : undefined,
    });
    return success(toTowerMainConfigRecord(updated));
  });

  app.put('/admin/v1/tower-config/welfare', async (request, reply) => {
    if (!requireCapability(request, reply, 'towerConfig')) return reply;
    const input = objectBody(request.body);
    if (!isRecord(input.config)) throw new InputError('config must be a JSON object');
    const updated = await request.adminContext.services.towerConfigRepository.updateWelfare({
      expectedRevision: towerRevision(input.expected_revision),
      config: input.config,
    });
    return success(toTowerWelfareConfigRecord(updated));
  });

  app.get('/admin/v1/tower-config/anchors', async (request, reply) => {
    if (!requireCapability(request, reply, 'towerConfig')) return reply;
    const items = await request.adminContext.services.towerConfigRepository.listAnchors({
      query: text(request.query?.q, { maxLength: 200 }),
      limit: boundedLimit(request.query?.limit, 50, 100),
    });
    return success({ items: items.map(toTowerAnchor) });
  });

  app.get('/admin/v1/tower-config/recoveries', async (request, reply) => {
    if (!requireCapability(request, reply, 'towerConfig')) return reply;
    const items = await request.adminContext.services.towerConfigRepository.listRecoveries({
      unusedOnly: queryBoolean(request.query?.unused_only, true, 'unused_only'),
      limit: boundedLimit(request.query?.limit, 50, 100),
    });
    return success({ items: items.map(toTowerRecovery) });
  });

  app.post('/admin/v1/tower-config/recoveries', async (request, reply) => {
    if (!requireCapability(request, reply, 'towerConfig')) return reply;
    const input = objectBody(request.body);
    if (!isRecord(input.config)) throw new InputError('config must be a JSON object');
    const recovery = await request.adminContext.services.towerConfigRepository.createRecovery({
      openUid: requiredText(input.open_uid, 'open_uid', 100),
      config: input.config,
      createdAt: new Date(),
    });
    return success(toTowerRecovery(recovery));
  });

  app.post('/admin/v1/debug-events', async (request, reply) => {
    if (!requireCapability(request, reply, 'debug')) return reply;
    const { project, services: projectServices } = request.adminContext;
    if (!project.mockMode) {
      return reply.code(403).send(failure(403, 'debug events require mock mode'));
    }
    const input = objectBody(request.body);
    const type = identifier(input.type, { field: 'type', required: true });
    if (!DEBUG_EVENT_TYPES.has(type)) {
      throw new InputError('type must be comment, like, or gift');
    }
    const normalizedInput = type === 'gift'
      ? withCanonicalGift(input, project)
      : input;
    const event = normalizeDebugEvent(normalizedInput);
    const [accepted] = await projectServices.eventStore.enqueueMany([
      { platform: project.platform, ...event },
    ]);
    return success({
      accepted: accepted ? 1 : 0,
      duplicates: accepted ? 0 : 1,
      event_ids: [event.eventId],
    });
  });

  app.get('/admin/v1/platform-tokens/:platform', async (request, reply) => {
    if (!requireCapability(request, reply, 'operations')) return reply;
    const platform = projectPlatformValue(request.params.platform, request.adminContext.project);
    const token = await request.adminContext.services.platformGateway.getCachedAccessToken(platform);
    return success(toPlatformToken(platform, token));
  });

  app.post('/admin/v1/platform-tokens/:platform/refresh', async (request, reply) => {
    if (!requireCapability(request, reply, 'operations')) return reply;
    const platform = projectPlatformValue(request.params.platform, request.adminContext.project);
    try {
      const token = await request.adminContext.services.platformGateway.getPlatformAccessToken(
        platform,
        { forceRefresh: true },
      );
      return success(toPlatformToken(platform, token));
    } catch (error) {
      if (error instanceof PlatformConfigurationError) throw error;
      request.log.error({ err: error, platform }, 'access-token refresh failed');
      return reply.code(502).send(failure(502, 'platform access-token refresh failed'));
    }
  });

  app.get('/admin/v1/configs', async (request, reply) => {
    if (!requireCapability(request, reply, 'operations')) return reply;
    const { project, services: projectServices } = request.adminContext;
    const configs = await projectServices.repository.listGameConfigs(project.configKey);
    return success({ items: configs.map(toGameConfig) });
  });

  app.patch('/admin/v1/configs/:configKey', async (request, reply) => {
    if (!requireCapability(request, reply, 'operations')) return reply;
    const { project, services: projectServices } = request.adminContext;
    const configKey = projectConfigKey(request.params.configKey, project);
    const input = objectBody(request.body);
    if (!isRecord(input.config)) throw new InputError('config must be a JSON object');
    const updated = await projectServices.repository.updateGameConfig({
      configKey,
      version: exactPositiveInteger(input.version, 'version'),
      config: input.config,
      enabled: input.enabled === undefined ? undefined : booleanValue(input.enabled, 'enabled'),
      remark: strictOptionalText(input.remark, 'remark', 255),
      changedAt: new Date(),
    });
    return success(toGameConfig(updated));
  });

  app.get('/admin/v1/configs/:configKey/revisions', async (request, reply) => {
    if (!requireCapability(request, reply, 'operations')) return reply;
    const { project, services: projectServices } = request.adminContext;
    const configKey = projectConfigKey(request.params.configKey, project);
    const items = await projectServices.adminRepository.listConfigRevisions({ configKey });
    return success({ items: items.map(toConfigRevision) });
  });

  app.get('/admin/v1/leaderboards', async (request, reply) => {
    if (!requireCapability(request, reply, 'leaderboards')) return reply;
    const { project, services: projectServices } = request.adminContext;
    const period = periodValue(request.query?.period, LEADERBOARD_PERIODS, 'current_week');
    const periodStart = weekStart(period, new Date(), project.rankTimezoneOffsetMinutes);
    const items = await projectServices.adminRepository.listLeaderboard({
      platform: project.platform,
      periodStart,
      limit: boundedLimit(request.query?.limit, 100, 100),
    });
    return success({ period, period_start: periodStart, items: items.map(toLeaderboard) });
  });

  app.get('/admin/v1/users/:userId/rounds', async (request, reply) => {
    if (!requireCapability(request, reply, 'leaderboards')) return reply;
    const { project, services: projectServices } = request.adminContext;
    const userId = identifier(request.params.userId, { field: 'userId', required: true });
    const period = periodValue(request.query?.period, USER_ROUND_PERIODS, 'current_week');
    const range = period === 'all'
      ? {}
      : weekUtcRange(
          weekStart(period, new Date(), project.rankTimezoneOffsetMinutes),
          project.rankTimezoneOffsetMinutes,
        );
    const items = await projectServices.adminRepository.listUserRounds({
      platform: project.platform,
      userId,
      ...range,
      limit: 100,
    });
    return success({ period, items: items.map(toRound) });
  });

  app.get('/admin/v1/compensations', async (request, reply) => {
    if (!requireCapability(request, reply, 'compensations')) return reply;
    const { project, services: projectServices } = request.adminContext;
    const status = optionalSetValue(request.query?.status, COMPENSATION_STATUSES, 'status');
    const items = await projectServices.adminRepository.listGiftCompensations({
      platform: project.platform,
      status,
      limit: boundedLimit(request.query?.limit, 50, 100),
    });
    return success({ items: items.map(toCompensation) });
  });

  app.post('/admin/v1/compensations', async (request, reply) => {
    if (!requireCapability(request, reply, 'compensations')) return reply;
    const { project, services: projectServices } = request.adminContext;
    const compensation = normalizeCompensation(objectBody(request.body), project);
    const prepared = await projectServices.adminRepository.prepareGiftCompensation(compensation);
    if (!prepared.shouldEnqueue) return success(toCompensation(prepared.compensation));
    return enqueueGiftCompensation({
      request,
      reply,
      services: projectServices,
      eventId: compensation.eventId,
      event: prepared.event,
    });
  });

  app.post('/admin/v1/compensations/:eventId/retry', async (request, reply) => {
    if (!requireCapability(request, reply, 'compensations')) return reply;
    const { project, services: projectServices } = request.adminContext;
    const eventId = identifier(request.params.eventId, {
      field: 'eventId',
      maxLength: 256,
      required: true,
    });
    const prepared = await projectServices.adminRepository.retryGiftCompensation({
      platform: project.platform,
      eventId,
      retriedAt: new Date(),
    });
    return enqueueGiftCompensation({
      request,
      reply,
      services: projectServices,
      eventId,
      event: prepared.event,
    });
  });

  app.get('/admin/v1/compensation-rounds', async (request, reply) => {
    if (!requireCapability(request, reply, 'compensations')) return reply;
    const { project, services: projectServices } = request.adminContext;
    const startedFrom = utcQueryDate(request.query?.started_from, 'started_from');
    const startedTo = utcQueryDate(request.query?.started_to, 'started_to');
    if (startedFrom >= startedTo) {
      throw new InputError('started_from must be before started_to');
    }
    const items = await projectServices.adminRepository.listCompensationRounds({
      platform: project.platform,
      anchorNickname: requiredText(request.query?.anchor_nickname, 'anchor_nickname', 200),
      startedFrom,
      startedTo,
      limit: boundedLimit(request.query?.limit, 20, 100),
    });
    return success({ items: items.map(toCompensationRound) });
  });

  app.get('/admin/v1/compensation-rounds/:roundDbId/gifts', async (request, reply) => {
    if (!requireCapability(request, reply, 'compensations')) return reply;
    const { project, services: projectServices } = request.adminContext;
    const result = await projectServices.adminRepository.listCompensationRoundGifts({
      platform: project.platform,
      roundId: databaseId(request.params.roundDbId, 'roundDbId'),
    });
    return success({
      round: toCompensationRound(result.round),
      snapshot_max_event_id: result.snapshotMaxEventId,
      totals: {
        event_count: result.totals.eventCount,
        total_count: result.totals.totalCount,
        total_value: result.totals.totalValue,
      },
      items: result.items.map(item => toCompensationGiftGroup(item, project)),
    });
  });

  app.post('/admin/v1/compensation-jobs', async (request, reply) => {
    if (!requireCapability(request, reply, 'compensations')) return reply;
    const { project, services: projectServices } = request.adminContext;
    const input = normalizeCompensationJob(objectBody(request.body), project);
    const job = await projectServices.adminRepository.createCompensationJob(input);
    return success(toCompensationJob(job));
  });

  app.get('/admin/v1/compensation-jobs', async (request, reply) => {
    if (!requireCapability(request, reply, 'compensations')) return reply;
    const { project, services: projectServices } = request.adminContext;
    const items = await projectServices.adminRepository.listCompensationJobs({
      platform: project.platform,
      limit: boundedLimit(request.query?.limit, 50, 100),
    });
    return success({ items: items.map(toCompensationJob) });
  });

  app.get('/admin/v1/compensation-jobs/:jobId', async (request, reply) => {
    if (!requireCapability(request, reply, 'compensations')) return reply;
    const { project, services: projectServices } = request.adminContext;
    const job = await projectServices.adminRepository.getCompensationJob({
      platform: project.platform,
      jobId: databaseId(request.params.jobId, 'jobId'),
    });
    return success(toCompensationJob(job));
  });

  app.post('/admin/v1/compensation-jobs/:jobId/retry', async (request, reply) => {
    if (!requireCapability(request, reply, 'compensations')) return reply;
    const { project, services: projectServices } = request.adminContext;
    const job = await projectServices.adminRepository.retryCompensationJob({
      platform: project.platform,
      jobId: databaseId(request.params.jobId, 'jobId'),
      retriedAt: new Date(),
    });
    return success(toCompensationJob(job));
  });

  app.post('/admin/v1/compensation-jobs/:jobId/cancel', async (request, reply) => {
    if (!requireCapability(request, reply, 'compensations')) return reply;
    const { project, services: projectServices } = request.adminContext;
    const job = await projectServices.adminRepository.cancelCompensationJob({
      platform: project.platform,
      jobId: databaseId(request.params.jobId, 'jobId'),
      cancelledAt: new Date(),
    });
    return success(toCompensationJob(job));
  });

  app.get('/admin/v1/guilds', async (request, reply) => {
    if (!requireCapability(request, reply, 'guilds')) return reply;
    const items = await request.adminContext.services.adminRepository.listGuilds({
      query: text(request.query?.q, { maxLength: 200 }),
      limit: boundedLimit(request.query?.limit, 50, 100),
    });
    return success({ items: items.map(toGuild) });
  });

  app.post('/admin/v1/guilds', async (request, reply) => {
    if (!requireCapability(request, reply, 'guilds')) return reply;
    const input = objectBody(request.body);
    const guild = await request.adminContext.services.adminRepository.createGuild({
      name: requiredText(input.name, 'name', 100),
      joinCode: requiredText(input.join_code, 'join_code', 64),
      description: strictOptionalText(input.description, 'description', 500),
      enabled: input.enabled === undefined ? true : booleanValue(input.enabled, 'enabled'),
      createdAt: new Date(),
    });
    return success(toGuild(guild));
  });

  app.patch('/admin/v1/guilds/:guildId', async (request, reply) => {
    if (!requireCapability(request, reply, 'guilds')) return reply;
    const input = objectBody(request.body);
    const guild = await request.adminContext.services.adminRepository.updateGuild({
      guildId: databaseId(request.params.guildId, 'guildId'),
      ...normalizeGuildUpdate(input),
      updatedAt: new Date(),
    });
    return success(toGuild(guild));
  });

  app.get('/admin/v1/guilds/:guildId/members', async (request, reply) => {
    if (!requireCapability(request, reply, 'guilds')) return reply;
    const guildId = databaseId(request.params.guildId, 'guildId');
    const items = await request.adminContext.services.adminRepository.listGuildMembers({ guildId });
    return success({ items: items.map(toGuildMember) });
  });

  app.put('/admin/v1/guilds/:guildId/members/:userId', async (request, reply) => {
    if (!requireCapability(request, reply, 'guilds')) return reply;
    const { project, services: projectServices } = request.adminContext;
    const input = objectBody(request.body);
    const role = input.role === undefined ? 'member' : requiredText(input.role, 'role', 20);
    if (!GUILD_ROLES.has(role)) throw new InputError('role must be member or manager');
    const member = await projectServices.adminRepository.putGuildMember({
      platform: project.platform,
      guildId: databaseId(request.params.guildId, 'guildId'),
      userId: identifier(request.params.userId, { field: 'userId', required: true }),
      role,
      joinedAt: new Date(),
    });
    return success(toGuildMember(member));
  });

  app.delete('/admin/v1/guilds/:guildId/members/:userId', async (request, reply) => {
    if (!requireCapability(request, reply, 'guilds')) return reply;
    const { project, services: projectServices } = request.adminContext;
    const guildId = databaseId(request.params.guildId, 'guildId');
    const userId = identifier(request.params.userId, { field: 'userId', required: true });
    await projectServices.adminRepository.deleteGuildMember({
      platform: project.platform,
      guildId,
      userId,
    });
    return success({ guild_id: guildId, user_id: userId, removed: true });
  });
}

async function enqueueGiftCompensation({ request, reply, services, eventId, event }) {
  try {
    if (await services.eventStore.hasEvent(event)) {
      const completed = await services.adminRepository.finishGiftCompensation({
        eventId,
        status: 'duplicate',
        completedAt: new Date(),
      });
      return success(toCompensation(completed));
    }
    const accepted = await services.eventStore.enqueue(event, { permanentDedupe: true });
    const completed = await services.adminRepository.finishGiftCompensation({
      eventId,
      status: accepted ? 'enqueued' : 'duplicate',
      completedAt: new Date(),
    });
    return success(toCompensation(completed));
  } catch (operationError) {
    let reportedError = operationError;
    try {
      if (await services.eventStore.hasEvent(event)) {
        const completed = await services.adminRepository.finishGiftCompensation({
          eventId,
          status: 'enqueued',
          completedAt: new Date(),
        });
        return success(toCompensation(completed));
      }
    } catch (confirmationError) {
      reportedError = new AggregateError(
        [operationError, confirmationError],
        'event enqueue and Redis confirmation both failed',
      );
    }
    try {
      await services.adminRepository.failGiftCompensation({
        eventId,
        error: reportedError,
        failedAt: new Date(),
      });
    } catch (auditError) {
      reportedError = new AggregateError(
        [reportedError, auditError],
        'event enqueue and compensation audit update both failed',
      );
    }
    request.log.error(
      { err: reportedError, event_id: eventId },
      'gift compensation enqueue failed',
    );
    return reply.code(503).send(failure(503, 'event queue unavailable'));
  }
}

function normalizeCompensation(input, project) {
  if (Object.hasOwn(input, 'gift_value')) {
    throw new InputError('gift_value is not accepted; use gift_id and count');
  }
  const gift = projectGift(project, requiredText(input.gift_id, 'gift_id', 256));
  const reason = requiredText(input.reason, 'reason', 255);
  const count = compensationCount(input.count);
  const createdAt = new Date();
  const event = {
    platform: project.platform,
    ...normalizeDebugEvent({
      roomid: requiredText(input.room_id, 'room_id', 128),
      type: 'gift',
      event_id: requiredText(input.event_id, 'event_id', 256),
      user_id: requiredText(input.user_id, 'user_id', 128),
      nickname: strictOptionalText(input.nickname, 'nickname', 200),
      avatar_url: strictOptionalText(input.avatar_url, 'avatar_url', 2048),
      gift_id: gift.id,
      gift_name: gift.name,
      count,
      timestamp: createdAt.getTime(),
    }, { requireEventId: true }),
  };
  const payload = event.payload;
  const payloadHash = sha256Hex(JSON.stringify({
    platform: project.platform,
    roomId: event.roomId,
    eventId: event.eventId,
    userId: payload.sec_openid,
    nickname: payload.nickname,
    avatarUrl: payload.avatar_url,
    giftId: payload.sec_gift_id,
    giftName: payload.giftname,
    count: payload.count,
  }));
  return {
    platform: project.platform,
    eventId: event.eventId,
    roomId: event.roomId,
    userId: payload.sec_openid,
    nickname: payload.nickname,
    giftId: payload.sec_gift_id,
    giftName: payload.giftname,
    count: payload.count,
    payloadHash,
    event,
    reason,
    createdAt,
  };
}

function normalizeCompensationJob(input, project) {
  const requestId = requiredText(input.request_id, 'request_id', 256);
  const sourceRoundId = databaseId(input.source_round_id, 'source_round_id');
  const sourceSnapshotMaxEventId = databaseNonNegativeId(
    input.source_snapshot_max_event_id,
    'source_snapshot_max_event_id',
  );
  const targetRoomId = requiredText(input.target_room_id, 'target_room_id', 128);
  if (!Array.isArray(input.selections) || input.selections.length === 0) {
    throw new InputError('selections must be a non-empty array');
  }
  if (input.selections.length > 500) {
    throw new InputError('selections must contain at most 500 gift groups');
  }
  const seen = new Set();
  const selections = input.selections.map((value, index) => {
    if (!isRecord(value)) throw new InputError(`selections[${index}] must be an object`);
    const selection = {
      userId: requiredText(value.user_id, `selections[${index}].user_id`, 128),
      giftId: requiredText(value.gift_id, `selections[${index}].gift_id`, 256),
    };
    const key = `${selection.userId}\u0000${selection.giftId}`;
    if (seen.has(key)) throw new InputError('selections cannot contain duplicates');
    seen.add(key);
    return selection;
  }).sort(compareSelections);
  const seatPlayers = input.seat_players === undefined
    ? false
    : booleanValue(input.seat_players, 'seat_players');
  const commentContent = seatPlayers
    ? requiredText(input.comment_content, 'comment_content', 2000)
    : '';
  const intervalMs = boundedInteger(input.interval_ms, 'interval_ms', 1000, 500, 60_000);
  const reason = requiredText(input.reason, 'reason', 255);
  const createdAt = new Date();
  const payloadHash = sha256Hex(JSON.stringify({
    platform: project.platform,
    sourceRoundId,
    sourceSnapshotMaxEventId,
    targetRoomId,
    selections,
    seatPlayers,
    commentContent,
    intervalMs,
    reason,
  }));
  return {
    platform: project.platform,
    requestId,
    payloadHash,
    sourceRoundId,
    sourceSnapshotMaxEventId,
    targetRoomId,
    selections,
    seatPlayers,
    commentContent,
    intervalMs,
    reason,
    createdAt,
  };
}

function compareSelections(left, right) {
  if (left.userId < right.userId) return -1;
  if (left.userId > right.userId) return 1;
  if (left.giftId < right.giftId) return -1;
  if (left.giftId > right.giftId) return 1;
  return 0;
}

function withCanonicalGift(input, project) {
  const giftId = requiredText(input.gift_id ?? input.sec_gift_id, 'gift_id', 256);
  const gift = projectGift(project, giftId);
  return { ...input, gift_id: gift.id, gift_name: gift.name };
}

function projectGift(project, giftId) {
  const gift = project.giftCatalogById.get(giftId);
  if (!gift) throw new InputError('gift_id is not in the project gift catalog');
  return gift;
}

function projectConfigKey(value, project) {
  const configKey = identifier(value, {
    field: 'configKey',
    maxLength: 64,
    required: true,
  });
  if (configKey !== project.configKey) {
    throw new ConfigConflictError('game config does not exist', 'config_not_found');
  }
  return configKey;
}

function compensationCount(value) {
  const count = exactPositiveInteger(value, 'count');
  if (count > 10_000) throw new InputError('count must be at most 10000');
  return count;
}

function normalizeGuildUpdate(input) {
  const update = { version: exactPositiveInteger(input.version, 'version') };
  if (Object.hasOwn(input, 'name')) update.name = requiredText(input.name, 'name', 100);
  if (Object.hasOwn(input, 'join_code')) {
    update.joinCode = requiredText(input.join_code, 'join_code', 64);
  }
  if (Object.hasOwn(input, 'description')) {
    update.description = strictOptionalText(input.description, 'description', 500);
  }
  if (Object.hasOwn(input, 'enabled')) update.enabled = booleanValue(input.enabled, 'enabled');
  if (Object.keys(update).length === 1) {
    throw new InputError('at least one guild field must be updated');
  }
  return update;
}

function weekStart(period, now, timezoneOffsetMinutes) {
  const current = currentPeriodStart('week', now, timezoneOffsetMinutes);
  if (period === 'current_week') return current;
  const date = new Date(`${current}T00:00:00.000Z`);
  return formatDate(new Date(date.getTime() - WEEK_MS));
}

function weekUtcRange(periodStart, timezoneOffsetMinutes) {
  const localMidnight = new Date(`${periodStart}T00:00:00.000Z`).getTime();
  const startAt = new Date(localMidnight - timezoneOffsetMinutes * 60_000);
  return { startAt, endAt: new Date(startAt.getTime() + WEEK_MS) };
}

function formatDate(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function periodValue(value, accepted, fallback) {
  const period = identifier(value || fallback, { field: 'period', required: true });
  if (!accepted.has(period)) {
    throw new InputError(`period must be one of: ${[...accepted].join(', ')}`);
  }
  return period;
}

function optionalSetValue(value, accepted, field) {
  const normalized = identifier(value, { field });
  if (normalized && !accepted.has(normalized)) {
    throw new InputError(`${field} must be one of: ${[...accepted].join(', ')}`);
  }
  return normalized;
}

function platformValue(value) {
  const platform = identifier(value, { field: 'platform', maxLength: 2, required: true });
  if (!PLATFORMS.has(platform)) throw new InputError('platform must be dy or ks');
  return platform;
}

function projectPlatformValue(value, project) {
  const platform = platformValue(value);
  if (platform !== project.platform) {
    throw new InputError('platform must match the selected project');
  }
  return platform;
}

function boundedLimit(value, fallback, maximum) {
  if (value === undefined || value === null || value === '') return fallback;
  const limit = exactPositiveInteger(value, 'limit');
  if (limit > maximum) throw new InputError(`limit must be at most ${maximum}`);
  return limit;
}

function boundedInteger(value, field, fallback, minimum, maximum) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = exactPositiveInteger(value, field);
  if (parsed < minimum || parsed > maximum) {
    throw new InputError(`${field} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function utcQueryDate(value, field) {
  const source = requiredText(value, field, 40);
  if (!/(?:Z|[+-]\d{2}:\d{2})$/iu.test(source)) {
    throw new InputError(`${field} must include a UTC offset`);
  }
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) throw new InputError(`${field} must be a valid timestamp`);
  return date;
}

function databaseId(value, field) {
  const id = identifier(value, { field, maxLength: 20, required: true });
  if (!/^[1-9]\d*$/u.test(id)) throw new InputError(`${field} must be a positive integer`);
  return id;
}

function databaseNonNegativeId(value, field) {
  const id = identifier(value, { field, maxLength: 20, required: true });
  if (!/^(?:0|[1-9]\d*)$/u.test(id)) {
    throw new InputError(`${field} must be a non-negative integer`);
  }
  return id;
}

function requiredText(value, field, maxLength) {
  const normalized = strictOptionalText(value, field, maxLength);
  if (!normalized) throw new InputError(`${field} is required`);
  return normalized;
}

function strictOptionalText(value, field, maxLength) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new InputError(`${field} must be a string`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new InputError(`${field} is too long`);
  return normalized;
}

function exactPositiveInteger(value, field) {
  if (value === undefined || value === null || value === '') {
    throw new InputError(`${field} is required`);
  }
  const validNumber = typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
  const validString = typeof value === 'string' && /^[1-9]\d*$/u.test(value);
  if (!validNumber && !validString) {
    throw new InputError(`${field} must be a positive safe integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new InputError(`${field} must be a positive safe integer`);
  }
  return parsed;
}

function booleanValue(value, field) {
  if (typeof value === 'boolean') return value;
  throw new InputError(`${field} must be boolean`);
}

function queryBoolean(value, fallback, field) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  throw new InputError(`${field} must be boolean`);
}

function towerRevision(value) {
  const revision = requiredText(value, 'expected_revision', 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(revision)) {
    throw new InputError('expected_revision must be a SHA-256 hex string');
  }
  return revision;
}

function disableResponseCaching(reply) {
  reply.header('cache-control', 'no-store');
  reply.header('pragma', 'no-cache');
}

function toLeaderboard(value) {
  return {
    rank: value.rank,
    user_id: value.userId,
    nickname: value.nickname,
    avatar_url: value.avatarUrl,
    score: value.score,
    total_score: value.totalScore,
  };
}

function toPlatformToken(platform, token) {
  return {
    platform,
    access_token: token?.token || '',
    expires_in: token?.ttlSeconds || 0,
  };
}

function toRound(value) {
  return {
    round_id: value.roundId,
    room_id: value.roomId,
    status: value.status,
    score: value.score,
    base_score: value.baseScore,
    total_value: value.totalValue,
    started_at: toIsoUtc(value.startedAt),
    settled_at: toIsoUtc(value.settledAt),
  };
}

function toCompensation(value) {
  return {
    id: value.id,
    platform: value.platform,
    event_id: value.eventId,
    room_id: value.roomId,
    user_id: value.userId,
    nickname: value.nickname,
    gift_id: value.giftId,
    gift_name: value.giftName,
    count: value.count,
    status: value.status,
    reason: value.reason,
    attempt_count: value.attemptCount,
    last_error: value.lastError,
    created_at: toIsoUtc(value.createdAt),
    updated_at: toIsoUtc(value.updatedAt),
    enqueued_at: toIsoUtc(value.enqueuedAt),
  };
}

function toCompensationRound(value) {
  return {
    round_db_id: value.roundDbId,
    room_db_id: value.roomDbId,
    room_id: value.roomId,
    external_round_id: value.externalRoundId,
    status: value.status,
    started_at: toIsoUtc(value.startedAt),
    settled_at: toIsoUtc(value.settledAt),
    anchor_user_id: value.anchorUserId,
    anchor_nickname: value.anchorNickname,
    anchor_avatar_url: value.anchorAvatarUrl,
    latest_target_room_id: value.latestTargetRoomId,
    latest_target_room_authenticated_at: toIsoUtc(value.latestTargetRoomAuthenticatedAt),
  };
}

function toCompensationGiftGroup(value, project) {
  const catalogGift = project.giftCatalogById.get(value.giftId);
  return {
    user_id: value.userId,
    nickname: value.nickname,
    avatar_url: value.avatarUrl,
    gift_id: value.giftId,
    gift_name: value.giftName,
    event_count: value.eventCount,
    total_count: value.totalCount,
    total_value: value.totalValue,
    first_at: toIsoUtc(value.firstAt),
    last_at: toIsoUtc(value.lastAt),
    catalog_known: Boolean(catalogGift),
    catalog_name: catalogGift?.name ?? null,
  };
}

function toCompensationJob(value) {
  const result = {
    id: value.id,
    request_id: value.requestId,
    source_round_id: value.sourceRoundId,
    source_snapshot_max_event_id: value.sourceSnapshotMaxEventId,
    source_room_id: value.sourceRoomId,
    source_external_round_id: value.sourceExternalRoundId,
    target_room_id: value.targetRoomId,
    status: value.status,
    seat_players: value.seatPlayers,
    comment_content: value.commentContent,
    interval_ms: value.intervalMs,
    reason: value.reason,
    total_items: value.totalItems,
    completed_items: value.completedItems,
    failed_items: value.failedItems,
    cancelled_items: value.cancelledItems,
    pending_items: value.pendingItems,
    total_gift_events: value.totalGiftEvents,
    total_gift_count: value.totalGiftCount,
    total_gift_value: value.totalGiftValue,
    total_seat_events: value.totalSeatEvents,
    last_error: value.lastError,
    next_run_at: toIsoUtc(value.nextRunAt),
    started_at: toIsoUtc(value.startedAt),
    finished_at: toIsoUtc(value.finishedAt),
    created_at: toIsoUtc(value.createdAt),
    updated_at: toIsoUtc(value.updatedAt),
  };
  if (Array.isArray(value.items)) {
    result.items = value.items.map(toCompensationJobItem);
  }
  return result;
}

function toCompensationJobItem(value) {
  return {
    id: value.id,
    sequence: value.sequence,
    type: value.type,
    source_gift_event_id: value.sourceGiftEventId,
    event_id: value.eventId,
    user_id: value.userId,
    nickname: value.nickname,
    avatar_url: value.avatarUrl,
    gift_id: value.giftId,
    gift_name: value.giftName,
    count: value.count,
    value: value.value,
    status: value.status,
    source_claim_released: value.sourceClaimReleased,
    attempt_count: value.attemptCount,
    last_error: value.lastError,
    lease_expires_at: toIsoUtc(value.leaseExpiresAt),
    enqueued_at: toIsoUtc(value.enqueuedAt),
  };
}

function toGuild(value) {
  return {
    guild_id: value.guildId,
    name: value.name,
    join_code: value.joinCode,
    description: value.description,
    enabled: value.enabled,
    version: value.version,
    member_count: value.memberCount,
    created_at: toIsoUtc(value.createdAt),
    updated_at: toIsoUtc(value.updatedAt),
  };
}

function toGuildMember(value) {
  return {
    user_id: value.userId,
    nickname: value.nickname,
    avatar_url: value.avatarUrl,
    role: value.role,
    joined_at: toIsoUtc(value.joinedAt),
  };
}

function toConfigRevision(value) {
  return {
    config_key: value.configKey,
    version: value.version,
    config: value.config,
    enabled: value.enabled,
    remark: value.remark,
    changed_at: toIsoUtc(value.changedAt),
  };
}

function toGameConfig(value) {
  return {
    config_key: value.configKey,
    version: value.version,
    config: value.config,
    enabled: value.enabled,
    remark: value.remark || '',
    updated_at: toIsoUtc(value.updatedAt ?? value.changedAt),
  };
}

function toTowerMainConfigRecord(value) {
  return {
    id: value.id,
    revision: value.revision,
    version: value.version,
    remark: value.remark,
    config: value.config,
  };
}

function toTowerWelfareConfigRecord(value) {
  return {
    id: value.id,
    revision: value.revision,
    config: value.config,
  };
}

function toTowerAnchor(value) {
  return {
    open_uid: value.openUid,
    nickname: value.nickname,
    config_id: value.configId,
  };
}

function toTowerRecovery(value) {
  return {
    id: value.id,
    open_uid: value.openUid,
    nickname: value.nickname,
    config: value.config,
    is_used: value.isUsed,
    created_at: toIsoUtc(value.createdAt),
  };
}
