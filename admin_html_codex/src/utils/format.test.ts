import { describe, expect, it } from 'vitest';
import { avatarFallback, formatDate, formatNumber, makeEventId } from './format';

describe('format utilities', () => {
  it('formats BIGINT strings without converting through Number', () => {
    expect(formatNumber('900719925474099312345')).toBe('900,719,925,474,099,312,345');
  });

  it('keeps non-integer server values readable', () => {
    expect(formatNumber('not-a-number')).toBe('not-a-number');
    expect(formatNumber(12345)).toBe('12,345');
  });

  it('formats period dates without applying a timezone', () => {
    expect(formatDate('2026-08-03')).toBe('2026/08/03');
    expect(formatDate('unexpected')).toBe('unexpected');
  });

  it('creates traceable event ids and avatar fallbacks', () => {
    expect(makeEventId('compensation')).toMatch(/^compensation-/u);
    expect(avatarFallback(' 赛车手')).toBe('赛');
  });
});
