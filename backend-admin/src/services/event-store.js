import Redis from 'ioredis';
import { sha256Hex } from '../lib/crypto.js';

const ENQUEUE_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then
  return 0
end
local queue_type = redis.call('TYPE', KEYS[2])
if queue_type.ok ~= 'none' and queue_type.ok ~= 'list' then
  return redis.error_reply('event queue key is not a list')
end
if tonumber(ARGV[1]) == 0 then
  redis.call('SET', KEYS[1], '1')
else
  redis.call('SET', KEYS[1], '1', 'EX', ARGV[1])
end
redis.call('RPUSH', KEYS[2], ARGV[2])
return 1
`;

export function createRedis(config) {
  return new Redis({
    host: config.host,
    port: config.port,
    db: config.db,
    password: config.password,
    lazyConnect: true,
    enableReadyCheck: true,
    maxRetriesPerRequest: 2,
  });
}

export class EventStore {
  constructor(redis, config) {
    this.redis = redis;
    this.config = config;
  }

  async health() {
    await this.redis.ping();
  }

  async close() {
    if (this.redis.status === 'wait') {
      this.redis.disconnect();
      return;
    }
    if (this.redis.status !== 'end') await this.redis.quit();
  }

  async enqueue(event, options) {
    const [accepted] = await this.enqueueMany([event], options);
    return accepted;
  }

  async enqueueMany(events, { permanentDedupe = false } = {}) {
    if (events.length === 0) return [];
    const pipeline = this.redis.pipeline();
    for (const { platform, roomId, eventId, gift, priority, payload } of events) {
      const base = `live:${platform}:{${roomId}}`;
      const dedupe = dedupeKey(platform, roomId, eventId);
      const queue = gift || priority ? `${base}:ready:gift` : `${base}:ready:free`;
      pipeline.eval(
        ENQUEUE_SCRIPT,
        2,
        dedupe,
        queue,
        permanentDedupe ? 0 : this.config.eventDedupeTtlSeconds,
        JSON.stringify(payload),
      );
    }
    const results = await pipeline.exec();
    return results.map(([error, result]) => {
      if (error) throw error;
      return Number(result) === 1;
    });
  }

  async hasEvent({ platform, roomId, eventId }) {
    return Number(await this.redis.exists(dedupeKey(platform, roomId, eventId))) === 1;
  }
}

function dedupeKey(platform, roomId, eventId) {
  return `live:${platform}:{${roomId}}:dedupe:${sha256Hex(eventId)}`;
}
