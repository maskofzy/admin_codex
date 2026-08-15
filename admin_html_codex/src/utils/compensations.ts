import type {
  CompensationGiftGroup,
  CompensationJob,
  CompensationJobItem,
  CompensationJobStatus,
} from '@/types/api';

export interface CompensationPlayerGifts {
  user_id: string;
  nickname: string;
  avatar_url: string;
  gifts: CompensationGiftGroup[];
  event_count: number;
  total_count: string;
  total_value: string;
}

export interface CompensationSelectionSummary {
  selections: Array<{ user_id: string; gift_id: string }>;
  player_count: number;
  gift_event_count: number;
  gift_count: string;
  gift_value: string;
  unknown_gift_count: number;
}

export const MAX_COMPENSATION_SELECTIONS = 500;
export const MAX_CANCELLED_GIFT_DETAILS = 50;

export interface CompensationDateTimeRange {
  startedFrom: string;
  startedTo: string;
}

export function compensationSelectionKey(userId: string, giftId: string): string {
  return JSON.stringify([userId, giftId]);
}

export function shouldRefreshCompensationTargetRoom(
  manuallyEdited: boolean,
  currentRoomId: string,
  candidateRoomId: string,
): boolean {
  return !manuallyEdited || currentRoomId === candidateRoomId;
}

export function groupCompensationGifts(
  items: CompensationGiftGroup[],
): CompensationPlayerGifts[] {
  const players = new Map<string, CompensationPlayerGifts>();
  for (const item of items) {
    const existing = players.get(item.user_id);
    const player = existing ?? {
      user_id: item.user_id,
      nickname: item.nickname,
      avatar_url: item.avatar_url,
      gifts: [],
      event_count: 0,
      total_count: '0',
      total_value: '0',
    };
    player.gifts.push(item);
    player.event_count += item.event_count;
    player.total_count = addIntegerValue(player.total_count, item.total_count);
    player.total_value = addIntegerValue(player.total_value, item.total_value);
    if (!existing) players.set(item.user_id, player);
  }
  return [...players.values()];
}

export function summarizeCompensationSelection(
  items: CompensationGiftGroup[],
  selectedKeys: ReadonlySet<string>,
): CompensationSelectionSummary {
  const selections: CompensationSelectionSummary['selections'] = [];
  const players = new Set<string>();
  let giftEventCount = 0;
  let giftCount = '0';
  let giftValue = '0';
  let unknownGiftCount = 0;

  for (const item of items) {
    if (!selectedKeys.has(compensationSelectionKey(item.user_id, item.gift_id))) continue;
    selections.push({ user_id: item.user_id, gift_id: item.gift_id });
    players.add(item.user_id);
    giftEventCount += item.event_count;
    giftCount = addIntegerValue(giftCount, item.total_count);
    giftValue = addIntegerValue(giftValue, item.total_value);
    if (!item.catalog_known) unknownGiftCount += 1;
  }

  return {
    selections,
    player_count: players.size,
    gift_event_count: giftEventCount,
    gift_count: giftCount,
    gift_value: giftValue,
    unknown_gift_count: unknownGiftCount,
  };
}

export function defaultCompensationRange(now = new Date()): CompensationDateTimeRange {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return {
    startedFrom: toDateTimeLocalValue(start),
    startedTo: toDateTimeLocalValue(end),
  };
}

export function dateTimeLocalToIso(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

export function estimatedCompensationDurationMs(totalItems: number, intervalMs: number): number {
  return Math.max(0, totalItems - 1) * Math.max(0, intervalMs);
}

export function formatCompensationDuration(milliseconds: number): string {
  const seconds = Math.ceil(Math.max(0, milliseconds) / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes} 分 ${remainder} 秒` : `${minutes} 分钟`;
}

export function compensationJobProcessedPercent(job: CompensationJob): number {
  if (job.total_items <= 0) return job.status === 'completed' ? 100 : 0;
  return Math.min(100, Math.round(
    ((job.completed_items + job.failed_items + job.cancelled_items) / job.total_items) * 100,
  ));
}

export function isActiveCompensationJob(status: CompensationJobStatus): boolean {
  return status === 'pending' || status === 'running';
}

export function compensationJobStatusLabel(status: CompensationJobStatus): string {
  return {
    pending: '等待执行',
    running: '执行中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
  }[status];
}

export function compensationJobStatusClass(status: CompensationJobStatus): string {
  if (status === 'completed') return 'status-success';
  if (status === 'failed') return 'status-danger';
  if (status === 'pending' || status === 'running') return 'status-warning';
  return 'status-muted';
}

export function cancelledGiftRecoveryMessage(
  item: Pick<CompensationJobItem, 'type' | 'source_claim_released'>,
): string | null {
  if (item.type !== 'gift') return null;
  return item.source_claim_released
    ? '确认未发送，可重新创建恢复'
    : '已发送/结果不确定、仍受防重复保护';
}

export function summarizeCancelledGiftRecovery<
  T extends Pick<CompensationJobItem, 'type' | 'source_claim_released'>,
>(items: readonly T[], limit = MAX_CANCELLED_GIFT_DETAILS) {
  const giftItems = items.filter(item => item.type === 'gift');
  const recoverableCount = giftItems.filter(item => item.source_claim_released === true).length;
  return {
    totalCount: giftItems.length,
    recoverableCount,
    protectedCount: giftItems.length - recoverableCount,
    visibleItems: giftItems.slice(0, limit),
  };
}

function addIntegerValue(left: string, right: string | number): string {
  return (BigInt(left) + BigInt(String(right))).toString();
}

function toDateTimeLocalValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    'T',
    pad(date.getHours()),
    ':',
    pad(date.getMinutes()),
  ].join('');
}
