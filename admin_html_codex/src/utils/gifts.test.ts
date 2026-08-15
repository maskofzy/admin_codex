import { describe, expect, it } from 'vitest';
import { giftEventFields } from './gifts';

describe('giftEventFields', () => {
  it('uses the stable gift id and never sends a multiplied gift_value', () => {
    const fields = giftEventFields({ id: 'overclock', name: '能量电池', value: 99 }, 3);
    expect(fields).toEqual({
      gift_id: 'overclock',
      gift_name: '能量电池',
      count: 3,
    });
    expect(fields).not.toHaveProperty('gift_value');
  });
});
