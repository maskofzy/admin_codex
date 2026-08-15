export interface ApiEnvelope<T> {
  code: number;
  data: T;
  message: string;
}

export type LeaderboardPeriod = 'current_week' | 'previous_week';

export interface LeaderboardItem {
  rank: number;
  user_id: string;
  nickname: string;
  avatar_url: string;
  score: string | number;
  total_score: string | number;
}

export interface LeaderboardResponse {
  period: LeaderboardPeriod;
  period_start: string;
  items: LeaderboardItem[];
}

export interface RoundSummary {
  round_id: string;
  room_id: string;
  status: string;
  score: string | number;
  base_score: string | number;
  total_value: string | number;
  started_at: string;
  settled_at: string | null;
}

export interface CompensationRound {
  round_db_id: string;
  room_db_id: string;
  room_id: string;
  external_round_id: string;
  status: string;
  started_at: string;
  settled_at: string | null;
  anchor_user_id: string;
  anchor_nickname: string;
  anchor_avatar_url: string;
  latest_target_room_id: string;
  latest_target_room_authenticated_at: string | null;
}

export interface CompensationGiftGroup {
  user_id: string;
  nickname: string;
  avatar_url: string;
  gift_id: string;
  gift_name: string;
  event_count: number;
  total_count: string | number;
  total_value: string | number;
  first_at: string;
  last_at: string;
  catalog_known: boolean;
  catalog_name: string | null;
}

export interface CompensationGiftTotals {
  event_count: number;
  total_count: string | number;
  total_value: string | number;
}

export interface CompensationRoundGiftsResponse {
  round: CompensationRound;
  snapshot_max_event_id: string;
  totals: CompensationGiftTotals;
  items: CompensationGiftGroup[];
}

export type CompensationJobStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface CompensationJob {
  id: string;
  request_id: string;
  source_round_id: string;
  source_snapshot_max_event_id: string;
  source_room_id: string;
  source_external_round_id: string;
  target_room_id: string;
  status: CompensationJobStatus;
  seat_players: boolean;
  comment_content: string;
  interval_ms: number;
  reason: string;
  total_items: number;
  completed_items: number;
  failed_items: number;
  cancelled_items: number;
  pending_items: number;
  total_gift_events: number;
  total_gift_count: string | number;
  total_gift_value: string | number;
  total_seat_events: number;
  last_error: string | null;
  next_run_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

export type CompensationJobItemStatus =
  | 'pending'
  | 'processing'
  | 'enqueued'
  | 'duplicate'
  | 'failed'
  | 'cancelled';

export interface CompensationJobItem {
  id: string;
  sequence: number;
  type: 'comment' | 'gift';
  source_gift_event_id: string | null;
  event_id: string;
  user_id: string;
  nickname: string;
  avatar_url: string;
  gift_id: string | null;
  gift_name: string | null;
  count: string | number | null;
  value: string | number | null;
  status: CompensationJobItemStatus;
  source_claim_released: boolean | null;
  attempt_count: number;
  last_error: string | null;
  lease_expires_at: string | null;
  enqueued_at: string | null;
}

export interface CompensationJobDetail extends CompensationJob {
  items: CompensationJobItem[];
}

export interface GuildRecord {
  guild_id: string;
  name: string;
  join_code: string;
  description: string;
  enabled: boolean;
  version: number;
  member_count: number;
  created_at: string;
  updated_at: string;
}

export interface GuildMember {
  user_id: string;
  nickname: string;
  avatar_url: string;
  role: 'member' | 'manager';
  joined_at: string;
}

export interface GameConfigRecord {
  config_key: string;
  version: number;
  config: Record<string, unknown>;
  enabled: boolean;
  remark: string;
  updated_at: string;
}

export interface ConfigRevision {
  config_key: string;
  version: number;
  config: Record<string, unknown>;
  enabled: boolean;
  remark: string;
  changed_at: string;
}

export interface PlatformTokenResponse {
  platform: 'dy' | 'ks';
  access_token: string;
  expires_in: number;
}
