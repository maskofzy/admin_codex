import { randomUUID } from 'node:crypto';
import {
  InputError,
  identifier,
  nonNegativeInteger,
  text,
} from './values.js';

export function normalizeDebugEvent(input, defaults = {}) {
  const roomId = identifier(input.roomid ?? input.room_id ?? defaults.roomId, {
    field: 'roomid',
    required: true,
  });
  const type = identifier(input.type ?? defaults.type, { field: 'type', required: true });
  const userId = identifier(input.user_id ?? input.sec_openid ?? defaults.userId, {
    field: 'user_id',
    required: true,
  });
  const suppliedEventId = identifier(input.event_id ?? input.msg_id, {
    field: 'event_id',
    maxLength: 256,
  });
  if (defaults.requireEventId && !suppliedEventId) {
    throw new InputError('event_id is required for production recovery');
  }
  const eventId = suppliedEventId || `operator:${randomUUID()}`;
  const common = {
    msg_id: eventId,
    sec_openid: userId,
    nickname: text(input.nickname, { fallback: userId }),
    avatar_url: text(input.avatar_url, { maxLength: 2048 }),
    timestamp: nonNegativeInteger(input.timestamp, { fallback: Date.now() }),
    source: 'operator',
  };

  if (type === 'comment') {
    return wrap(roomId, false, {
      ...common,
      msg_type: 1,
      content: text(input.content, { maxLength: 2000, fallback: '666' }),
    });
  }
  if (type === 'like') {
    return wrap(roomId, false, {
      ...common,
      msg_type: 2,
      count: exactPositiveInteger(input.count ?? 1, 'count'),
    });
  }
  if (type === 'gift') {
    const giftId = identifier(input.gift_id ?? input.sec_gift_id ?? defaults.giftId, {
      field: 'gift_id',
      maxLength: 256,
      required: true,
    });
    return wrap(roomId, true, {
      ...common,
      msg_type: 3,
      count: exactPositiveInteger(input.count ?? 1, 'count'),
      sec_gift_id: giftId,
      giftname: text(input.gift_name ?? input.giftname, { fallback: giftId }),
    });
  }
  throw new InputError(`Unsupported debug event type: ${type}`);
}

function exactPositiveInteger(value, field) {
  const validNumber = typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
  const validString = typeof value === 'string' && /^[1-9]\d*$/u.test(value);
  if (!validNumber && !validString) {
    throw new InputError(`${field} must be a positive safe integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new InputError(`${field} must be a positive safe integer`);
  return parsed;
}

function wrap(roomId, gift, payload) {
  return {
    roomId,
    eventId: payload.msg_id,
    gift,
    payload,
  };
}
