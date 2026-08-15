import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeDebugEvent } from '../src/lib/debug-events.js';

test('normalizes only comment, like, and gift management events', () => {
  const comment = normalizeDebugEvent({
    type: 'comment', roomid: 'r', event_id: 'c', user_id: 'u', content: '666',
  });
  const like = normalizeDebugEvent({
    type: 'like', roomid: 'r', event_id: 'l', user_id: 'u', count: 10,
  });
  const gift = normalizeDebugEvent({
    type: 'gift', roomid: 'r', event_id: 'g', user_id: 'u', gift_id: 'nitro', count: 2,
  });
  assert.equal(comment.payload.msg_type, 1);
  assert.equal(like.payload.msg_type, 2);
  assert.equal(gift.payload.msg_type, 3);
  assert.equal(gift.gift, true);
});

test('rejects old group events and fractional counts', () => {
  assert.throws(
    () => normalizeDebugEvent({
      type: 'group', roomid: 'r', event_id: 'x', user_id: 'u', group_id: 'red',
    }),
    /Unsupported debug event type/,
  );
  assert.throws(
    () => normalizeDebugEvent({
      type: 'gift', roomid: 'r', event_id: 'x', user_id: 'u', gift_id: 'nitro', count: 1.5,
    }),
    /positive safe integer/,
  );
});
