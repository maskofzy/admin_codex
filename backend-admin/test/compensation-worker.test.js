import assert from 'node:assert/strict';
import test from 'node:test';
import { CompensationWorker } from '../src/services/compensation-worker.js';

test('worker permanently enqueues one claimed item and records its terminal result', async () => {
  const calls = [];
  const event = priorityCommentEvent();
  const worker = new CompensationWorker({
    repository: {
      async claimNextCompensationItem(input) {
        calls.push(['claim', input]);
        return { itemId: '9', event };
      },
      async completeCompensationItem(input) { calls.push(['complete', input]); },
      async failCompensationItem(input) { calls.push(['fail', input]); },
    },
    eventStore: {
      async enqueue(value, options) {
        calls.push(['enqueue', value, options]);
        return true;
      },
      async hasEvent() { return false; },
    },
    clock: clockAt('2026-08-07T08:00:00.000Z'),
  });

  assert.equal(await worker.runOnce(), true);
  assert.equal(calls[1][0], 'enqueue');
  assert.equal(calls[1][1].priority, true);
  assert.equal(calls[1][1].payload.msg_type, 1);
  assert.deepEqual(calls[1][2], { permanentDedupe: true });
  assert.equal(calls[2][0], 'complete');
  assert.equal(calls[2][1].status, 'enqueued');
  assert.equal(calls.some(call => call[0] === 'fail'), false);
  assert.equal(calls[0][1].leaseExpiresAt.toISOString(), '2026-08-07T08:00:30.000Z');
});

test('worker converges an ambiguous Redis response through permanent dedupe confirmation', async () => {
  const calls = [];
  const event = priorityCommentEvent();
  const worker = new CompensationWorker({
    repository: {
      async claimNextCompensationItem() { return { itemId: '9', event }; },
      async completeCompensationItem(input) { calls.push(['complete', input]); },
      async failCompensationItem(input) { calls.push(['fail', input]); },
    },
    eventStore: {
      async enqueue() { throw new Error('response lost'); },
      async hasEvent(value) {
        calls.push(['confirm', value.eventId]);
        return true;
      },
    },
    clock: clockAt('2026-08-07T08:00:00.000Z'),
  });

  assert.equal(await worker.runOnce(), true);
  assert.deepEqual(calls.map(call => call[0]), ['confirm', 'complete']);
  assert.equal(calls[1][1].status, 'enqueued');
});

test('worker stops a job through the repository when Redis did not accept the item', async () => {
  const calls = [];
  const event = priorityCommentEvent();
  const worker = new CompensationWorker({
    repository: {
      async claimNextCompensationItem() { return { itemId: '9', event }; },
      async completeCompensationItem(input) { calls.push(['complete', input]); },
      async failCompensationItem(input) { calls.push(['fail', input]); },
    },
    eventStore: {
      async enqueue() { throw new Error('Redis unavailable'); },
      async hasEvent() { return false; },
    },
    clock: clockAt('2026-08-07T08:00:00.000Z'),
  });

  assert.equal(await worker.runOnce(), true);
  assert.deepEqual(calls.map(call => call[0]), ['fail']);
  assert.equal(calls[0][1].error.message, 'Redis unavailable');
  assert.equal(calls[0][1].releaseOnCancel, true);
});

test('worker keeps the source claim when Redis confirmation is also unavailable', async () => {
  const calls = [];
  const event = priorityCommentEvent();
  const worker = new CompensationWorker({
    repository: {
      async claimNextCompensationItem() { return { itemId: '9', event }; },
      async completeCompensationItem() {},
      async failCompensationItem(input) { calls.push(input); },
    },
    eventStore: {
      async enqueue() { throw new Error('enqueue response lost'); },
      async hasEvent() { throw new Error('confirmation unavailable'); },
    },
    clock: clockAt('2026-08-07T08:00:00.000Z'),
  });

  await worker.runOnce();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].releaseOnCancel, false);
  assert.ok(calls[0].error instanceof AggregateError);
});

test('a restarted worker reconciles an expired cancelled claim without enqueueing it again', async () => {
  const calls = [];
  const event = priorityGiftEvent();
  const worker = new CompensationWorker({
    repository: {
      async claimNextCompensationItem(input) {
        calls.push(['claim', input]);
        return { itemId: '9', event, reconcileCancelled: true };
      },
      async completeCompensationItem(input) { calls.push(['complete', input]); },
      async failCompensationItem(input) { calls.push(['cancel', input]); },
    },
    eventStore: {
      async enqueue() { calls.push(['enqueue']); return true; },
      async hasEvent(value) { calls.push(['confirm', value.eventId]); return false; },
    },
    clock: clockAt('2026-08-07T08:01:00.000Z'),
  });

  assert.equal(await worker.runOnce(), true);
  assert.deepEqual(calls.map(call => call[0]), ['claim', 'confirm', 'cancel']);
  assert.equal(calls[2][1].releaseOnCancel, true);
  assert.equal(calls.some(call => call[0] === 'enqueue'), false);
});

test('cancelled reconciliation records an event already present in Redis as enqueued', async () => {
  const calls = [];
  const event = priorityGiftEvent();
  const worker = new CompensationWorker({
    repository: {
      async claimNextCompensationItem() {
        return { itemId: '9', event, reconcileCancelled: true };
      },
      async completeCompensationItem(input) { calls.push(['complete', input]); },
      async failCompensationItem(input) { calls.push(['cancel', input]); },
    },
    eventStore: {
      async enqueue() { calls.push(['enqueue']); return true; },
      async hasEvent() { calls.push(['confirm']); return true; },
    },
    clock: clockAt('2026-08-07T08:01:00.000Z'),
  });

  assert.equal(await worker.runOnce(), true);
  assert.deepEqual(calls.map(call => call[0]), ['confirm', 'complete']);
  assert.equal(calls[1][1].status, 'enqueued');
});

test('cancelled reconciliation keeps the lease and source claim when Redis is uncertain', async () => {
  const calls = [];
  const event = priorityGiftEvent();
  const worker = new CompensationWorker({
    repository: {
      async claimNextCompensationItem() {
        calls.push('claim');
        return { itemId: '9', event, reconcileCancelled: true };
      },
      async completeCompensationItem() { calls.push('complete'); },
      async failCompensationItem() { calls.push('cancel'); },
    },
    eventStore: {
      async enqueue() { calls.push('enqueue'); return true; },
      async hasEvent() { calls.push('confirm'); throw new Error('confirmation unavailable'); },
    },
    clock: clockAt('2026-08-07T08:01:00.000Z'),
  });

  await assert.rejects(worker.runOnce(), /confirmation unavailable/u);
  assert.deepEqual(calls, ['claim', 'confirm']);
});

function priorityCommentEvent() {
  return {
    platform: 'dy',
    roomId: 'room-1',
    eventId: 'recovery:event-1',
    gift: false,
    priority: true,
    payload: { msg_id: 'recovery:event-1', msg_type: 1 },
  };
}

function priorityGiftEvent() {
  return {
    platform: 'dy',
    roomId: 'room-1',
    eventId: 'recovery:gift-1',
    gift: true,
    priority: true,
    payload: { msg_id: 'recovery:gift-1', msg_type: 3 },
  };
}

function clockAt(value) {
  const timestamp = new Date(value).getTime();
  return () => new Date(timestamp);
}
