import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CAPABILITIES = new Set([
  'leaderboards',
  'compensations',
  'guilds',
  'debug',
  'operations',
  'tower_config',
]);
const PLATFORMS = new Set(['dy', 'ks']);
const DEFAULT_PROJECTS_PATH = fileURLToPath(new URL('../config/projects.json', import.meta.url));

export function loadConfig(env = process.env, registryInput) {
  const nodeEnv = env.NODE_ENV || 'development';
  const registryPath = env.PROJECTS_CONFIG_PATH
    ? resolve(env.PROJECTS_CONFIG_PATH)
    : DEFAULT_PROJECTS_PATH;
  const registry = registryInput ?? readRegistry(registryPath);
  const projects = parseProjects(registry, env, nodeEnv);
  const adminAuthDisabled = readBoolean(env.ADMIN_AUTH_DISABLED, false);
  const host = env.HOST || '0.0.0.0';
  if (adminAuthDisabled && !new Set(['development', 'test']).has(nodeEnv)) {
    throw new Error('ADMIN_AUTH_DISABLED is allowed only in development or test');
  }
  if (adminAuthDisabled && !new Set(['127.0.0.1', '::1', 'localhost']).has(host)) {
    throw new Error('ADMIN_AUTH_DISABLED requires a loopback HOST');
  }
  if (adminAuthDisabled && projects.some(project => !project.mockMode)) {
    throw new Error('ADMIN_AUTH_DISABLED requires every project to use mock mode');
  }
  const adminToken = env.ADMIN_API_TOKEN || '';
  if (!adminAuthDisabled && adminToken.length < 32) {
    throw new Error('ADMIN_API_TOKEN must contain at least 32 characters');
  }

  return {
    nodeEnv,
    host,
    port: readInteger(env.PORT, 8121, { min: 1, max: 65535 }),
    logLevel: env.LOG_LEVEL || 'info',
    adminAuthDisabled,
    adminToken,
    registryPath,
    projects,
    projectsById: new Map(projects.map(project => [project.id, project])),
  };
}

function readRegistry(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to load project registry ${path}: ${error.message}`, { cause: error });
  }
}

function parseProjects(registry, env, nodeEnv) {
  if (!isRecord(registry) || !Array.isArray(registry.projects) || registry.projects.length === 0) {
    throw new Error('Project registry must contain a non-empty projects array');
  }
  const projects = registry.projects.map((value, index) => parseProject(value, index, env, nodeEnv));
  assertUnique(projects, project => project.id, 'project id');
  assertUnique(
    projects,
    project => `${project.mysql.host}:${project.mysql.port}/${project.mysql.database}`,
    'project MySQL target',
  );
  assertUnique(
    projects,
    project => `${project.redis.host}:${project.redis.port}/${project.redis.db}`,
    'project Redis target',
  );
  return projects;
}

function parseProject(value, index, env, nodeEnv) {
  if (!isRecord(value)) throw new Error(`projects[${index}] must be an object`);
  const id = stableIdentifier(value.id, `projects[${index}].id`);
  const name = requiredString(value.name, `projects[${index}].name`, 100);
  const platform = requiredString(value.platform, `projects[${index}].platform`, 2);
  if (!PLATFORMS.has(platform)) throw new Error(`projects[${index}].platform must be dy or ks`);
  const database = databaseName(value.database, `projects[${index}].database`);
  const redisDb = exactInteger(value.redisDb, `projects[${index}].redisDb`, { min: 0, max: 255 });
  const envPrefix = requiredString(value.envPrefix, `projects[${index}].envPrefix`, 32);
  if (!/^[A-Z][A-Z0-9_]*$/u.test(envPrefix)) {
    throw new Error(`projects[${index}].envPrefix must use uppercase environment variable syntax`);
  }
  const configKey = requiredString(value.configKey, `projects[${index}].configKey`, 64);
  if (!Array.isArray(value.capabilities)) {
    throw new Error(`projects[${index}].capabilities must be an array`);
  }
  const capabilityNames = value.capabilities.map((capability, capabilityIndex) => {
    const normalized = requiredString(
      capability,
      `projects[${index}].capabilities[${capabilityIndex}]`,
      32,
    );
    if (!CAPABILITIES.has(normalized)) throw new Error(`Unknown capability: ${normalized}`);
    return normalized;
  });
  if (new Set(capabilityNames).size !== capabilityNames.length) {
    throw new Error(`projects[${index}].capabilities cannot contain duplicates`);
  }
  if (!Array.isArray(value.giftCatalog)) {
    throw new Error(`projects[${index}].giftCatalog must be an array`);
  }
  const giftCatalog = value.giftCatalog.map((gift, giftIndex) => parseGift(gift, index, giftIndex));
  assertUnique(giftCatalog, gift => gift.id, `projects[${index}] gift id`);

  const prefixed = key => env[`${envPrefix}_${key}`];
  const capabilitySet = new Set(capabilityNames);
  if (capabilitySet.has('tower_config') && capabilitySet.size !== 1) {
    throw new Error(`projects[${index}].tower_config cannot be combined with other capabilities`);
  }
  if ((capabilitySet.has('compensations') || capabilitySet.has('debug')) && giftCatalog.length === 0) {
    throw new Error(`projects[${index}].giftCatalog is required for gift operations`);
  }
  const tower = capabilitySet.has('tower_config')
    ? parseTowerConfig(value.tower, index)
    : null;
  if (!tower && value.tower !== undefined) {
    throw new Error(`projects[${index}].tower requires the tower_config capability`);
  }
  return {
    id,
    name,
    platform,
    envPrefix,
    configKey,
    capabilities: Object.freeze({
      leaderboards: capabilitySet.has('leaderboards'),
      compensations: capabilitySet.has('compensations'),
      guilds: capabilitySet.has('guilds'),
      debug: capabilitySet.has('debug'),
      operations: capabilitySet.has('operations'),
      towerConfig: capabilitySet.has('tower_config'),
    }),
    tower,
    giftCatalog,
    giftCatalogById: new Map(giftCatalog.map(gift => [gift.id, gift])),
    mockMode: readBoolean(prefixed('MOCK_MODE'), nodeEnv !== 'production'),
    rankTimezoneOffsetMinutes: readInteger(
      prefixed('RANK_TIMEZONE_OFFSET_MINUTES') ?? env.RANK_TIMEZONE_OFFSET_MINUTES,
      480,
      { min: -720, max: 840 },
    ),
    mysql: {
      host: prefixed('MYSQL_HOST') || env.MYSQL_HOST || '127.0.0.1',
      port: readInteger(prefixed('MYSQL_PORT') ?? env.MYSQL_PORT, 3306, { min: 1, max: 65535 }),
      user: prefixed('MYSQL_USER') || env.MYSQL_USER || 'root',
      password: prefixed('MYSQL_PASSWORD') ?? env.MYSQL_PASSWORD ?? '',
      database,
      connectionLimit: readInteger(
        prefixed('MYSQL_CONNECTION_LIMIT') ?? env.MYSQL_CONNECTION_LIMIT,
        10,
        { min: 1, max: 100 },
      ),
    },
    redis: {
      host: prefixed('REDIS_HOST') || env.REDIS_HOST || '127.0.0.1',
      port: readInteger(prefixed('REDIS_PORT') ?? env.REDIS_PORT, 6379, { min: 1, max: 65535 }),
      db: redisDb,
      password: (prefixed('REDIS_PASSWORD') ?? env.REDIS_PASSWORD) || undefined,
    },
    eventStore: {
      eventDedupeTtlSeconds: readInteger(
        prefixed('EVENT_DEDUPE_TTL_SECONDS') ?? env.EVENT_DEDUPE_TTL_SECONDS,
        604800,
        { min: 60 },
      ),
    },
    douyin: {
      appId: prefixed('DOUYIN_APP_ID') || '',
      appSecret: prefixed('DOUYIN_APP_SECRET') || '',
    },
    kuaishou: {
      appId: prefixed('KUAISHOU_APP_ID') || '',
      appSecret: prefixed('KUAISHOU_APP_SECRET') || '',
    },
  };
}

function parseTowerConfig(value, projectIndex) {
  if (!isRecord(value)) {
    throw new Error(`projects[${projectIndex}].tower must be an object`);
  }
  const mainConfigId = exactInteger(
    value.mainConfigId,
    `projects[${projectIndex}].tower.mainConfigId`,
    { min: 1 },
  );
  const welfareConfigId = value.welfareConfigId === undefined || value.welfareConfigId === null
    ? null
    : exactInteger(
        value.welfareConfigId,
        `projects[${projectIndex}].tower.welfareConfigId`,
        { min: 1 },
      );
  if (!Array.isArray(value.anchorConfigIds) || value.anchorConfigIds.length === 0) {
    throw new Error(`projects[${projectIndex}].tower.anchorConfigIds must be a non-empty array`);
  }
  const anchorConfigIds = value.anchorConfigIds.map((configId, configIndex) => exactInteger(
    configId,
    `projects[${projectIndex}].tower.anchorConfigIds[${configIndex}]`,
    { min: 1 },
  ));
  if (new Set(anchorConfigIds).size !== anchorConfigIds.length) {
    throw new Error(`projects[${projectIndex}].tower.anchorConfigIds cannot contain duplicates`);
  }
  return Object.freeze({ mainConfigId, welfareConfigId, anchorConfigIds });
}

function parseGift(value, projectIndex, giftIndex) {
  if (!isRecord(value)) {
    throw new Error(`projects[${projectIndex}].giftCatalog[${giftIndex}] must be an object`);
  }
  return {
    id: requiredString(value.id, `giftCatalog[${giftIndex}].id`, 256),
    name: requiredString(value.name, `giftCatalog[${giftIndex}].name`, 200),
    value: exactInteger(value.value, `giftCatalog[${giftIndex}].value`, { min: 1 }),
  };
}

function stableIdentifier(value, field) {
  const normalized = requiredString(value, field, 64);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(normalized)) {
    throw new Error(`${field} must be a stable identifier`);
  }
  return normalized;
}

function databaseName(value, field) {
  const normalized = requiredString(value, field, 64);
  if (!/^[A-Za-z0-9_]+$/u.test(normalized)) {
    throw new Error(`${field} must be a MySQL database name`);
  }
  return normalized;
}

function requiredString(value, field, maxLength) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} is required`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error(`${field} is too long`);
  return normalized;
}

function assertUnique(values, selector, field) {
  const keys = values.map(selector);
  if (new Set(keys).size !== keys.length) throw new Error(`${field} must be unique`);
}

function exactInteger(value, field, limits = {}) {
  if (!Number.isSafeInteger(value)) throw new Error(`${field} must be an integer`);
  if (limits.min !== undefined && value < limits.min) throw new Error(`${field} is below ${limits.min}`);
  if (limits.max !== undefined && value > limits.max) throw new Error(`${field} is above ${limits.max}`);
  return value;
}

function readBoolean(value, fallback) {
  if (value === undefined || value === '') return fallback;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  throw new Error(`Invalid boolean value: ${value}`);
}

function readInteger(value, fallback, limits = {}) {
  const parsed = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`Invalid integer value: ${value}`);
  if (limits.min !== undefined && parsed < limits.min) throw new Error(`Value is below ${limits.min}`);
  if (limits.max !== undefined && parsed > limits.max) throw new Error(`Value is above ${limits.max}`);
  return parsed;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
