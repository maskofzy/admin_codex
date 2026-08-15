import { describe, expect, it } from 'vitest';
import type { CompensationGiftGroup, CompensationJob } from '@/types/api';
import {
  cancelledGiftRecoveryMessage,
  compensationJobProcessedPercent,
  compensationSelectionKey,
  defaultCompensationRange,
  estimatedCompensationDurationMs,
  formatCompensationDuration,
  groupCompensationGifts,
  shouldRefreshCompensationTargetRoom,
  summarizeCancelledGiftRecovery,
  summarizeCompensationSelection,
} from './compensations';

const giftItems: CompensationGiftGroup[] = [
  {
    user_id: 'user-1',
    nickname: '玩家一',
    avatar_url: '',
    gift_id: 'gift-a',
    gift_name: '仙女棒',
    event_count: 2,
    total_count: 5,
    total_value: 5,
    first_at: '2026-08-07T01:00:00.000Z',
    last_at: '2026-08-07T01:02:00.000Z',
    catalog_known: true,
    catalog_name: '仙女棒',
  },
  {
    user_id: 'user-1',
    nickname: '玩家一',
    avatar_url: '',
    gift_id: 'legacy-gift',
    gift_name: '旧礼物',
    event_count: 1,
    total_count: 3,
    total_value: 99,
    first_at: '2026-08-07T01:03:00.000Z',
    last_at: '2026-08-07T01:03:00.000Z',
    catalog_known: false,
    catalog_name: null,
  },
  {
    user_id: 'user-2',
    nickname: '玩家二',
    avatar_url: '',
    gift_id: 'gift-a',
    gift_name: '仙女棒',
    event_count: 4,
    total_count: 4,
    total_value: 4,
    first_at: '2026-08-07T01:04:00.000Z',
    last_at: '2026-08-07T01:06:00.000Z',
    catalog_known: true,
    catalog_name: '仙女棒',
  },
];

describe('compensation gift selection', () => {
  it('groups gift summaries by player while preserving raw event totals', () => {
    expect(groupCompensationGifts(giftItems)).toEqual([
      expect.objectContaining({
        user_id: 'user-1',
        event_count: 3,
        total_count: '8',
        total_value: '104',
        gifts: giftItems.slice(0, 2),
      }),
      expect.objectContaining({
        user_id: 'user-2',
        event_count: 4,
        total_count: '4',
        total_value: '4',
        gifts: giftItems.slice(2),
      }),
    ]);
  });

  it('summarizes only selected user and gift pairs and keeps unknown gifts recoverable', () => {
    const selected = new Set([
      compensationSelectionKey('user-1', 'legacy-gift'),
      compensationSelectionKey('user-2', 'gift-a'),
    ]);
    expect(summarizeCompensationSelection(giftItems, selected)).toEqual({
      selections: [
        { user_id: 'user-1', gift_id: 'legacy-gift' },
        { user_id: 'user-2', gift_id: 'gift-a' },
      ],
      player_count: 2,
      gift_event_count: 5,
      gift_count: '7',
      gift_value: '103',
      unknown_gift_count: 1,
    });
  });

  it('adds BIGINT totals as decimal strings without precision loss or concatenation', () => {
    const largeItems = [
      { ...giftItems[0]!, total_count: '9007199254740993', total_value: '9007199254740995' },
      { ...giftItems[1]!, total_count: 7, total_value: 9 },
    ];
    expect(groupCompensationGifts(largeItems)[0]).toMatchObject({
      total_count: '9007199254741000',
      total_value: '9007199254741004',
    });
    expect(summarizeCompensationSelection(largeItems, new Set([
      compensationSelectionKey('user-1', 'gift-a'),
      compensationSelectionKey('user-1', 'legacy-gift'),
    ]))).toMatchObject({
      gift_count: '9007199254741000',
      gift_value: '9007199254741004',
    });
  });
});

describe('compensation scheduling helpers', () => {
  it('explains cancelled gift recovery safety using business language', () => {
    expect(cancelledGiftRecoveryMessage({
      type: 'gift',
      source_claim_released: true,
    })).toBe('确认未发送，可重新创建恢复');
    expect(cancelledGiftRecoveryMessage({
      type: 'gift',
      source_claim_released: false,
    })).toBe('已发送/结果不确定、仍受防重复保护');
    expect(cancelledGiftRecoveryMessage({
      type: 'comment',
      source_claim_released: null,
    })).toBeNull();
  });

  it('summarizes every cancelled gift while limiting rendered details to fifty', () => {
    const giftItems = Array.from({ length: 52 }, (_, index) => ({
      type: 'gift' as const,
      source_claim_released: index < 7,
      sequence: index + 1,
    }));
    const summary = summarizeCancelledGiftRecovery([
      ...giftItems,
      { type: 'comment' as const, source_claim_released: null, sequence: 53 },
    ]);

    expect(summary).toMatchObject({
      totalCount: 52,
      recoverableCount: 7,
      protectedCount: 45,
    });
    expect(summary.visibleItems).toHaveLength(50);
    expect(summary.visibleItems[0]?.sequence).toBe(1);
    expect(summary.visibleItems[49]?.sequence).toBe(50);
  });

  it('refreshes a stale candidate room unless the operator changed it to another value', () => {
    expect(shouldRefreshCompensationTargetRoom(false, 'old-room', 'old-room')).toBe(true);
    expect(shouldRefreshCompensationTargetRoom(true, 'old-room', 'old-room')).toBe(true);
    expect(shouldRefreshCompensationTargetRoom(true, 'manual-room', 'old-room')).toBe(false);
  });

  it('uses the current local calendar day as the default search range', () => {
    expect(defaultCompensationRange(new Date(2026, 7, 7, 12, 34))).toEqual({
      startedFrom: '2026-08-07T00:00',
      startedTo: '2026-08-08T00:00',
    });
  });

  it('estimates only gaps between server-scheduled items and formats long durations', () => {
    expect(estimatedCompensationDurationMs(0, 1000)).toBe(0);
    expect(estimatedCompensationDurationMs(6, 1000)).toBe(5000);
    expect(formatCompensationDuration(65_000)).toBe('1 分 5 秒');
  });

  it('counts successful and terminal failed items in job progress', () => {
    const job = {
      status: 'running',
      total_items: 10,
      completed_items: 6,
      failed_items: 1,
      cancelled_items: 1,
    } as CompensationJob;
    expect(compensationJobProcessedPercent(job)).toBe(80);
  });
});
