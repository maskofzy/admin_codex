import assert from 'node:assert/strict';
import test from 'node:test';
import { EventStore } from '../src/services/event-store.js';

test('enqueues gift and free events with business-compatible keys in one Redis pipeline', async () => {
  const commands = [];
  const redis = {
    pipeline() {
      return {
        eval(...args) { commands.push(args); },
        async exec() { return [[null, 1], [null, 0]]; },
      };
    },
  };
  const store = new EventStore(redis, { eventDedupeTtlSeconds: 604800 });
  const results = await store.enqueueMany([
    {
      platform: 'dy', roomId: 'room-1', eventId: 'gift-1', gift: true,
      payload: { msg_id: 'gift-1', msg_type: 3 },
    },
    {
      platform: 'dy', roomId: 'room-1', eventId: 'comment-1', gift: false,
      payload: { msg_id: 'comment-1', msg_type: 1 },
    },
  ]);

  assert.deepEqual(results, [true, false]);
  assert.match(commands[0][2], /^live:dy:\{room-1\}:dedupe:/u);
  assert.equal(commands[0][3], 'live:dy:{room-1}:ready:gift');
  assert.equal(commands[0][4], 604800);
  assert.equal(commands[1][3], 'live:dy:{room-1}:ready:free');
});

test('enqueue delegates to the same idempotent batch path', async () => {
  const redis = {
    pipeline() {
      return { eval() {}, async exec() { return [[null, 1]]; } };
    },
  };
  const store = new EventStore(redis, { eventDedupeTtlSeconds: 60 });
  assert.equal(await store.enqueue({
    platform: 'ks', roomId: 'r', eventId: 'e', gift: true, payload: { msg_id: 'e' },
  }), true);
});

test('priority comments share the gift FIFO without changing their message type', async () => {
  const commands = [];
  const redis = {
    pipeline() {
      return {
        eval(...args) { commands.push(args); },
        async exec() { return [[null, 1]]; },
      };
    },
  };
  const store = new EventStore(redis, { eventDedupeTtlSeconds: 60 });
  await store.enqueue({
    platform: 'dy', roomId: 'room-1', eventId: 'seat-1', gift: false, priority: true,
    payload: { msg_id: 'seat-1', msg_type: 1, content: '上车' },
  }, { permanentDedupe: true });
  assert.equal(commands[0][3], 'live:dy:{room-1}:ready:gift');
  assert.equal(commands[0][4], 0);
  assert.equal(JSON.parse(commands[0][5]).msg_type, 1);
});

test('uses a permanent dedupe key for production compensation and can confirm it later', async () => {
  const commands = [];
  const redis = {
    pipeline() {
      return {
        eval(...args) { commands.push(args); },
        async exec() { return [[null, 1]]; },
      };
    },
    async exists(key) {
      assert.match(key, /^live:dy:\{room-1\}:dedupe:/u);
      return 1;
    },
  };
  const store = new EventStore(redis, { eventDedupeTtlSeconds: 60 });
  const event = {
    platform: 'dy', roomId: 'room-1', eventId: 'comp-1', gift: true,
    payload: { msg_id: 'comp-1' },
  };
  assert.equal(await store.enqueue(event, { permanentDedupe: true }), true);
  assert.equal(commands[0][4], 0);
  assert.equal(await store.hasEvent(event), true);
});
