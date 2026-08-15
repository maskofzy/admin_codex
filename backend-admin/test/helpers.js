import { loadConfig } from '../src/config.js';

export const ADMIN_TOKEN = 'test-admin-token-0123456789abcdef';

export function projectRegistry({ arenaCapabilities } = {}) {
  return {
    projects: [
      {
        id: 'cars',
        name: 'Cars',
        platform: 'dy',
        database: 'cars_test',
        redisDb: 3,
        envPrefix: 'CARS',
        configKey: 'version1',
        capabilities: ['leaderboards', 'compensations', 'guilds', 'debug', 'operations'],
        giftCatalog: [
          { id: 'nitro', name: 'Nitro', value: 1 },
          { id: 'love-explosion', name: 'Love Explosion', value: 199 },
        ],
      },
      {
        id: 'arena',
        name: 'Arena',
        platform: 'ks',
        database: 'arena_test',
        redisDb: 4,
        envPrefix: 'ARENA',
        configKey: 'version2',
        capabilities: arenaCapabilities ?? [
          'leaderboards',
          'compensations',
          'guilds',
          'operations',
        ],
        giftCatalog: [{ id: 'rocket', name: 'Rocket', value: 10 }],
      },
    ],
  };
}

export function testConfig(options = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    ADMIN_API_TOKEN: ADMIN_TOKEN,
    MYSQL_HOST: 'mysql.test',
    MYSQL_USER: 'root',
    MYSQL_PASSWORD: 'secret',
    REDIS_HOST: 'redis.test',
    CARS_MOCK_MODE: 'true',
    ARENA_MOCK_MODE: 'true',
    CARS_DOUYIN_APP_ID: 'cars-dy-app',
    CARS_DOUYIN_APP_SECRET: 'cars-dy-secret',
    ARENA_KUAISHOU_APP_ID: 'arena-ks-app',
    ARENA_KUAISHOU_APP_SECRET: 'arena-ks-secret',
    ...options.env,
  }, options.registry ?? projectRegistry(options));
}

export function adminHeaders(projectId, token = ADMIN_TOKEN) {
  return { 'x-admin-token': token, 'x-project-id': projectId };
}
