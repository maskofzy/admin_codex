import { parseJson } from '../lib/json.js';
import { identifier } from '../lib/values.js';

const DOUYIN_TOKEN_URL = 'https://developer.toutiao.com/api/apps/v2/token';
const KUAISHOU_TOKEN_URL = 'https://open.kuaishou.com/oauth2/access_token';
const DEFAULT_ACCESS_TOKEN_EXPIRES_IN_SECONDS = 5400;
const ACCESS_TOKEN_REFRESH_SKEW_SECONDS = 60;

export class PlatformConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PlatformConfigurationError';
  }
}

export class PlatformGateway {
  constructor({ config, redis, fetchImpl = fetch }) {
    this.config = config;
    this.redis = redis;
    this.fetchImpl = fetchImpl;
  }

  async getPlatformAccessToken(platform, { forceRefresh = false } = {}) {
    const key = this.accessTokenCacheKey(platform);
    if (!forceRefresh) {
      const cached = await this.getCachedAccessToken(platform);
      if (cached?.ttlSeconds > 0) return cached;
    }
    const loaded = platform === 'dy'
      ? await this.loadDouyinAccessToken()
      : await this.loadKuaishouAccessToken();
    const ttlSeconds = Math.max(1, loaded.expiresInSeconds - ACCESS_TOKEN_REFRESH_SKEW_SECONDS);
    await this.redis.set(key, loaded.token, 'EX', ttlSeconds);
    return { token: loaded.token, ttlSeconds };
  }

  async getCachedAccessToken(platform) {
    const key = this.accessTokenCacheKey(platform);
    const token = await this.redis.get(key);
    if (!token) return null;
    const ttlSeconds = Number(await this.redis.ttl(key));
    return {
      token,
      ttlSeconds: Number.isFinite(ttlSeconds) ? Math.max(0, Math.floor(ttlSeconds)) : 0,
    };
  }

  async loadDouyinAccessToken() {
    const credentials = this.platformConfig('dy', true);
    const response = await requestJson(this.fetchImpl, DOUYIN_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        appid: credentials.appId,
        secret: credentials.appSecret,
        grant_type: 'client_credential',
      }),
    });
    return {
      token: identifier(response?.data?.access_token ?? response?.access_token, {
        field: 'access_token',
        required: true,
      }),
      expiresInSeconds: accessTokenExpiresInSeconds(response),
    };
  }

  async loadKuaishouAccessToken() {
    const credentials = this.platformConfig('ks', true);
    const body = new URLSearchParams({
      app_id: credentials.appId,
      app_secret: credentials.appSecret,
      grant_type: 'client_credentials',
    });
    const response = await requestJson(this.fetchImpl, KUAISHOU_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    return {
      token: identifier(response?.access_token ?? response?.data?.access_token, {
        field: 'access_token',
        required: true,
      }),
      expiresInSeconds: accessTokenExpiresInSeconds(response),
    };
  }

  accessTokenCacheKey(platform) {
    const { appId } = this.platformConfig(platform, false);
    if (!appId) throw new PlatformConfigurationError(`${platform} appId is not configured`);
    return `platform:${platform}:${appId}:access-token`;
  }

  platformConfig(platform, requireSecret) {
    const credentials = platform === 'dy'
      ? this.config.douyin
      : platform === 'ks'
        ? this.config.kuaishou
        : undefined;
    if (!credentials) throw new PlatformConfigurationError(`Unsupported platform: ${platform}`);
    if (requireSecret && (!credentials.appId || !credentials.appSecret)) {
      throw new PlatformConfigurationError(`${platform} platform credentials are not configured`);
    }
    return credentials;
  }
}

function accessTokenExpiresInSeconds(response) {
  for (const container of [response?.data, response]) {
    const expiresIn = Number(container?.expires_in ?? container?.expiresIn);
    if (Number.isFinite(expiresIn) && expiresIn > 0) return Math.floor(expiresIn);
  }
  return DEFAULT_ACCESS_TOKEN_EXPIRES_IN_SECONDS;
}

async function requestJson(fetchImpl, url, init) {
  const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(10_000) });
  const raw = await response.text();
  if (!response.ok) throw new Error(`Platform HTTP request failed with status ${response.status}`);
  try {
    return parseJson(raw);
  } catch {
    throw new Error('Platform returned invalid JSON');
  }
}
