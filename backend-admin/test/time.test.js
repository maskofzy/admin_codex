import assert from 'node:assert/strict';
import test from 'node:test';
import { toIsoUtc } from '../src/lib/time.js';

test('normalizes Date and MySQL UTC datetime values to ISO-8601', () => {
  assert.equal(toIsoUtc('2026-08-07 08:00:00.123'), '2026-08-07T08:00:00.123Z');
  assert.equal(toIsoUtc('2026-08-07 08:00:00'), '2026-08-07T08:00:00.000Z');
  assert.equal(
    toIsoUtc(new Date('2026-08-07T08:00:00.000Z')),
    '2026-08-07T08:00:00.000Z',
  );
  assert.equal(toIsoUtc(null), null);
});

test('rejects invalid database timestamp values', () => {
  assert.throws(() => toIsoUtc('not-a-date'), /Invalid UTC timestamp/);
});
