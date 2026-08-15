<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import AsyncState from '@/components/AsyncState.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import PageHeader from '@/components/PageHeader.vue';
import UserIdentity from '@/components/UserIdentity.vue';
import { adminSession } from '@/services/session';
import type {
  CompensationGiftGroup,
  CompensationJob,
  CompensationJobDetail,
  CompensationJobItem,
  CompensationRound,
  CompensationRoundGiftsResponse,
} from '@/types/api';
import {
  cancelledGiftRecoveryMessage,
  compensationJobProcessedPercent,
  compensationJobStatusClass,
  compensationJobStatusLabel,
  compensationSelectionKey,
  dateTimeLocalToIso,
  defaultCompensationRange,
  estimatedCompensationDurationMs,
  formatCompensationDuration,
  groupCompensationGifts,
  isActiveCompensationJob,
  MAX_COMPENSATION_SELECTIONS,
  shouldRefreshCompensationTargetRoom,
  summarizeCancelledGiftRecovery,
  summarizeCompensationSelection,
  type CompensationPlayerGifts,
} from '@/utils/compensations';
import { formatDateTime, formatNumber, makeEventId } from '@/utils/format';

type JobAction = 'retry' | 'cancel';

const defaultRange = defaultCompensationRange();
const search = reactive({
  anchorNickname: '',
  startedFrom: defaultRange.startedFrom,
  startedTo: defaultRange.startedTo,
});
const rounds = ref<CompensationRound[]>([]);
const roundsLoading = ref(false);
const roundsError = ref('');
const hasSearched = ref(false);
const selectedRound = ref<CompensationRound | null>(null);
const gifts = ref<CompensationRoundGiftsResponse | null>(null);
const giftsLoading = ref(false);
const giftsError = ref('');
const selectedGiftKeys = ref<Set<string>>(new Set());
const candidateTargetRoomId = ref('');
const targetRoomManuallyEdited = ref(false);

const recovery = reactive({
  requestId: makeEventId('gift-recovery'),
  targetRoomId: '',
  seatPlayers: true,
  commentContent: '666',
  intervalMs: 1000,
  reason: '',
});
const recoveryError = ref('');
const confirmOpen = ref(false);
const submitting = ref(false);
const submitError = ref('');
const successMessage = ref('');

const jobs = ref<CompensationJob[]>([]);
const jobsLoading = ref(true);
const jobsRefreshing = ref(false);
const jobsError = ref('');
const pollingWarning = ref('');
const activeJob = ref<CompensationJob | CompensationJobDetail | null>(null);
const activeJobLoading = ref(false);
const activeJobError = ref('');
const actionTarget = ref<{ job: CompensationJob; action: JobAction } | null>(null);
const actionBusy = ref(false);
const actionError = ref('');
let pollTimer: ReturnType<typeof setInterval> | undefined;
let polling = false;
let roundGiftRequestSequence = 0;
let jobDetailRequestSequence = 0;

const playerGroups = computed(() => groupCompensationGifts(gifts.value?.items ?? []));
const selectionSummary = computed(() => summarizeCompensationSelection(
  gifts.value?.items ?? [],
  selectedGiftKeys.value,
));
const allGiftKeys = computed(() => (gifts.value?.items ?? []).map(item =>
  compensationSelectionKey(item.user_id, item.gift_id)));
const allSelected = computed(() => allGiftKeys.value.length > 0 &&
  allGiftKeys.value.every(key => selectedGiftKeys.value.has(key)));
const selectedSeatCount = computed(() => recovery.seatPlayers
  ? selectionSummary.value.player_count
  : 0);
const totalReplayItems = computed(() =>
  selectionSummary.value.gift_event_count + selectedSeatCount.value);
const estimatedDuration = computed(() => formatCompensationDuration(
  estimatedCompensationDurationMs(totalReplayItems.value, Number(recovery.intervalMs)),
));
const workflowStep = computed(() => {
  if (confirmOpen.value || activeJob.value) return 3;
  return selectedRound.value ? 2 : 1;
});
const activeJobItems = computed<CompensationJobItem[]>(() => {
  const job = activeJob.value;
  return job && 'items' in job ? job.items : [];
});
const activeJobFailures = computed(() => activeJobItems.value
  .filter(item => item.status === 'failed')
  .slice(0, 20));
const activeCancelledGiftSummary = computed(() => summarizeCancelledGiftRecovery(
  activeJob.value?.status === 'cancelled' ? activeJobItems.value : [],
));
const hasRunningJobs = computed(() => jobs.value.some(job => isActiveCompensationJob(job.status)) ||
  Boolean(activeJob.value && isActiveCompensationJob(activeJob.value.status)));

async function searchRounds(): Promise<void> {
  if (roundsLoading.value) return;
  roundsError.value = '';
  successMessage.value = '';
  const nickname = search.anchorNickname.trim();
  const from = new Date(search.startedFrom);
  const to = new Date(search.startedTo);
  if (!nickname) {
    roundsError.value = '请输入主播昵称。';
    return;
  }
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
    roundsError.value = '请选择有效的开播时间范围，结束时间必须晚于开始时间。';
    return;
  }

  roundsLoading.value = true;
  hasSearched.value = true;
  roundGiftRequestSequence += 1;
  selectedRound.value = null;
  gifts.value = null;
  selectedGiftKeys.value = new Set();
  candidateTargetRoomId.value = '';
  targetRoomManuallyEdited.value = false;
  try {
    const response = await adminSession.api().request<{ items: CompensationRound[] }>(
      '/admin/v1/compensation-rounds',
      {
        query: {
          anchor_nickname: nickname,
          started_from: dateTimeLocalToIso(search.startedFrom),
          started_to: dateTimeLocalToIso(search.startedTo),
          limit: 50,
        },
      },
    );
    rounds.value = response.items;
  } catch (reason) {
    rounds.value = [];
    roundsError.value = errorMessage(reason, '候选场次查询失败');
  } finally {
    roundsLoading.value = false;
  }
}

async function selectRound(round: CompensationRound): Promise<void> {
  const requestSequence = ++roundGiftRequestSequence;
  selectedRound.value = round;
  gifts.value = null;
  giftsError.value = '';
  selectedGiftKeys.value = new Set();
  candidateTargetRoomId.value = round.latest_target_room_id || '';
  targetRoomManuallyEdited.value = false;
  recovery.targetRoomId = candidateTargetRoomId.value;
  recoveryError.value = '';
  successMessage.value = '';
  giftsLoading.value = true;
  try {
    const response = await adminSession.api().request<CompensationRoundGiftsResponse>(
      `/admin/v1/compensation-rounds/${encodeURIComponent(round.round_db_id)}/gifts`,
    );
    if (requestSequence !== roundGiftRequestSequence ||
        selectedRound.value?.round_db_id !== round.round_db_id) return;
    const shouldRefreshTargetRoom = shouldRefreshCompensationTargetRoom(
      targetRoomManuallyEdited.value,
      recovery.targetRoomId,
      candidateTargetRoomId.value,
    );
    selectedRound.value = response.round;
    gifts.value = response;
    if (shouldRefreshTargetRoom) {
      recovery.targetRoomId = response.round.latest_target_room_id || '';
      targetRoomManuallyEdited.value = false;
    }
  } catch (reason) {
    if (requestSequence === roundGiftRequestSequence &&
        selectedRound.value?.round_db_id === round.round_db_id) {
      giftsError.value = errorMessage(reason, '场次礼物加载失败');
    }
  } finally {
    if (requestSequence === roundGiftRequestSequence &&
        selectedRound.value?.round_db_id === round.round_db_id) {
      giftsLoading.value = false;
    }
  }
}

function markTargetRoomEdited(): void {
  targetRoomManuallyEdited.value = true;
}

function isGiftSelected(item: CompensationGiftGroup): boolean {
  return selectedGiftKeys.value.has(compensationSelectionKey(item.user_id, item.gift_id));
}

function toggleGift(item: CompensationGiftGroup, checked: boolean): void {
  const next = new Set(selectedGiftKeys.value);
  const key = compensationSelectionKey(item.user_id, item.gift_id);
  if (checked) next.add(key);
  else next.delete(key);
  selectedGiftKeys.value = next;
}

function selectedGiftCount(player: CompensationPlayerGifts): number {
  return player.gifts.filter(isGiftSelected).length;
}

function togglePlayer(player: CompensationPlayerGifts, checked: boolean): void {
  const next = new Set(selectedGiftKeys.value);
  for (const gift of player.gifts) {
    const key = compensationSelectionKey(gift.user_id, gift.gift_id);
    if (checked) next.add(key);
    else next.delete(key);
  }
  selectedGiftKeys.value = next;
}

function toggleAllGifts(): void {
  selectedGiftKeys.value = allSelected.value ? new Set() : new Set(allGiftKeys.value);
}

function requestConfirmation(): void {
  recoveryError.value = validateRecovery();
  submitError.value = '';
  successMessage.value = '';
  if (recoveryError.value) return;
  confirmOpen.value = true;
}

async function submitRecovery(): Promise<void> {
  if (submitting.value || !selectedRound.value || !gifts.value) return;
  submitting.value = true;
  submitError.value = '';
  try {
    const job = await adminSession.api().request<CompensationJob>(
      '/admin/v1/compensation-jobs',
      {
        method: 'POST',
        body: {
          request_id: recovery.requestId,
          source_round_id: selectedRound.value.round_db_id,
          source_snapshot_max_event_id: gifts.value.snapshot_max_event_id,
          target_room_id: recovery.targetRoomId.trim(),
          selections: selectionSummary.value.selections,
          seat_players: recovery.seatPlayers,
          comment_content: recovery.commentContent.trim(),
          interval_ms: Number(recovery.intervalMs),
          reason: recovery.reason.trim(),
        },
      },
    );
    confirmOpen.value = false;
    activeJob.value = job;
    successMessage.value = `恢复任务已由服务端接管：${job.request_id}`;
    recovery.requestId = makeEventId('gift-recovery');
    recovery.reason = '';
    selectedGiftKeys.value = new Set();
    const jobsFresh = await loadJobs(true);
    const detailFresh = await loadJobDetail(job.id, true);
    if (jobsFresh && detailFresh) pollingWarning.value = '';
  } catch (reason) {
    submitError.value = errorMessage(reason, '恢复任务创建失败');
  } finally {
    submitting.value = false;
  }
}

function validateRecovery(): string {
  if (!selectedRound.value || !gifts.value) return '请先选择并加载源场次。';
  if (!selectionSummary.value.selections.length) return '请至少选择一组玩家礼物。';
  if (selectionSummary.value.selections.length > MAX_COMPENSATION_SELECTIONS) {
    return `一次最多选择 ${MAX_COMPENSATION_SELECTIONS} 组玩家礼物，请拆分为多个恢复任务。`;
  }
  if (!recovery.targetRoomId.trim()) return '请输入当前客户端正在使用的目标房间 ID。';
  const interval = Number(recovery.intervalMs);
  if (!Number.isInteger(interval) || interval < 500 || interval > 60_000) {
    return '发送间隔必须是 500 到 60000 毫秒之间的整数。';
  }
  if (recovery.seatPlayers && !recovery.commentContent.trim()) {
    return '启用代玩家落座时必须填写评论内容。';
  }
  if (!recovery.reason.trim()) return '请填写事故恢复原因。';
  return '';
}

async function loadJobs(silent = false): Promise<boolean> {
  if (jobsRefreshing.value) return true;
  jobsRefreshing.value = true;
  if (!silent) {
    jobsError.value = '';
    pollingWarning.value = '';
  }
  try {
    const response = await adminSession.api().request<{ items: CompensationJob[] }>(
      '/admin/v1/compensation-jobs',
      { query: { limit: 50 } },
    );
    jobs.value = response.items;
    const current = activeJob.value;
    if (current) {
      const updated = response.items.find(job => job.id === current.id);
      if (updated && !('items' in current)) activeJob.value = updated;
    } else {
      const running = response.items.find(job => isActiveCompensationJob(job.status));
      if (running) void loadJobDetail(running.id, true);
    }
    return true;
  } catch (reason) {
    if (silent) pollingWarning.value = '进度刷新失败，当前任务数据可能已过期。';
    else jobsError.value = errorMessage(reason, '恢复任务加载失败');
    return false;
  } finally {
    jobsLoading.value = false;
    jobsRefreshing.value = false;
  }
}

async function loadJobDetail(jobId: string, silent = false): Promise<boolean> {
  const requestSequence = ++jobDetailRequestSequence;
  if (!silent) {
    const summary = jobs.value.find(job => job.id === jobId);
    if (summary) activeJob.value = summary;
    activeJobLoading.value = true;
    activeJobError.value = '';
    pollingWarning.value = '';
  }
  try {
    const detail = await adminSession.api().request<CompensationJobDetail>(
      `/admin/v1/compensation-jobs/${encodeURIComponent(jobId)}`,
    );
    if (requestSequence !== jobDetailRequestSequence) return true;
    activeJob.value = detail;
    return true;
  } catch (reason) {
    if (requestSequence !== jobDetailRequestSequence) return true;
    if (silent) pollingWarning.value = '进度刷新失败，当前任务数据可能已过期。';
    else activeJobError.value = errorMessage(reason, '任务详情加载失败');
    return false;
  } finally {
    if (requestSequence === jobDetailRequestSequence) {
      activeJobLoading.value = false;
    }
  }
}

function openJobAction(job: CompensationJob, action: JobAction): void {
  actionTarget.value = { job, action };
  actionError.value = '';
}

async function runJobAction(): Promise<void> {
  const target = actionTarget.value;
  if (!target || actionBusy.value) return;
  actionBusy.value = true;
  actionError.value = '';
  try {
    const job = await adminSession.api().request<CompensationJob>(
      `/admin/v1/compensation-jobs/${encodeURIComponent(target.job.id)}/${target.action}`,
      { method: 'POST' },
    );
    actionTarget.value = null;
    activeJob.value = job;
    successMessage.value = target.action === 'retry'
      ? `任务已从失败项继续执行：${job.request_id}`
      : `任务已取消：${job.request_id}`;
    const jobsFresh = await loadJobs(true);
    const detailFresh = await loadJobDetail(job.id, true);
    if (jobsFresh && detailFresh) pollingWarning.value = '';
  } catch (reason) {
    actionError.value = errorMessage(reason, target.action === 'retry' ? '任务重试失败' : '任务取消失败');
  } finally {
    actionBusy.value = false;
  }
}

async function pollJobProgress(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    const jobsFresh = await loadJobs(true);
    const job = activeJob.value;
    let detailFresh = true;
    if (job && isActiveCompensationJob(job.status)) {
      detailFresh = await loadJobDetail(job.id, true);
    }
    if (jobsFresh && detailFresh) pollingWarning.value = '';
  } finally {
    polling = false;
  }
}

function syncPolling(active: boolean): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = undefined;
  if (active) pollTimer = setInterval(() => void pollJobProgress(), 2500);
}

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

watch(hasRunningJobs, syncPolling);

onMounted(() => void loadJobs());

onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer);
});
</script>

<template>
  <section class="compensation-page">
    <PageHeader
      title="直播事故礼物恢复"
      description="先定位中断场次，再选择原始礼物并创建服务端节流任务。页面关闭或刷新不会中断已创建任务。"
    />

    <ol class="workflow-steps" aria-label="礼物恢复步骤">
      <li v-for="step in [1, 2, 3]" :key="step" :class="{ active: workflowStep === step, completed: workflowStep > step }">
        <span>{{ step }}</span>
        <strong>{{ step === 1 ? '查找源场次' : step === 2 ? '选择恢复内容' : '确认并跟踪' }}</strong>
      </li>
    </ol>

    <article class="panel recovery-step-panel">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">步骤 1</p>
          <h2>按主播和开播时间定位场次</h2>
          <p>房间号和 roundId 由服务端查询，不需要主播人工提供。</p>
        </div>
      </div>
      <form class="round-search-form" @submit.prevent="searchRounds">
        <label class="field round-search-name">
          <span>主播昵称</span>
          <input v-model="search.anchorNickname" required maxlength="200" placeholder="支持昵称关键字" />
        </label>
        <label class="field">
          <span>开播时间从</span>
          <input v-model="search.startedFrom" type="datetime-local" required />
        </label>
        <label class="field">
          <span>开播时间到（不含）</span>
          <input v-model="search.startedTo" type="datetime-local" required />
        </label>
        <button class="button button-primary align-end" type="submit" :disabled="roundsLoading">
          {{ roundsLoading ? '查询中…' : '查询候选场次' }}
        </button>
      </form>
      <p v-if="roundsError" class="form-error" role="alert">{{ roundsError }}</p>

      <div v-if="!hasSearched && !roundsLoading" class="state-card compact-state">
        <strong>等待查询</strong>
        <span>默认时间范围是今天，可按主播提供的实际开播时间调整。</span>
      </div>
      <AsyncState
        v-else
        :loading="roundsLoading"
        :empty="!rounds.length && !roundsError"
        empty-text="没有找到匹配场次，请扩大时间范围或检查主播昵称。"
      >
        <div class="round-candidate-grid">
          <button
            v-for="round in rounds"
            :key="round.round_db_id"
            class="round-candidate"
            :class="{ active: selectedRound?.round_db_id === round.round_db_id }"
            type="button"
            @click="selectRound(round)"
          >
            <div class="round-candidate-heading">
              <UserIdentity
                :name="round.anchor_nickname"
                :user-id="round.anchor_user_id"
                :avatar-url="round.anchor_avatar_url"
              />
              <span class="status-pill" :class="round.status === 'settled' ? 'status-success' : 'status-warning'">
                {{ round.status === 'settled' ? '已结算' : round.status }}
              </span>
            </div>
            <dl class="round-candidate-details">
              <div><dt>源房间</dt><dd class="mono">{{ round.room_id }}</dd></div>
              <div><dt>外部 roundId</dt><dd class="mono">{{ round.external_round_id }}</dd></div>
              <div><dt>开始</dt><dd>{{ formatDateTime(round.started_at) }}</dd></div>
              <div><dt>结束</dt><dd>{{ formatDateTime(round.settled_at) }}</dd></div>
              <div><dt>最新候选目标房间</dt><dd class="mono">{{ round.latest_target_room_id || '未找到，可在下一步手填' }}</dd></div>
              <div><dt>目标房间最近认证</dt><dd>{{ formatDateTime(round.latest_target_room_authenticated_at) }}</dd></div>
            </dl>
            <span class="round-select-label">
              {{ selectedRound?.round_db_id === round.round_db_id && giftsLoading ? '正在加载礼物…' : '选择并查看礼物' }}
            </span>
          </button>
        </div>
      </AsyncState>
    </article>

    <article class="panel recovery-step-panel">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">步骤 2</p>
          <h2>选择玩家礼物与恢复节奏</h2>
          <p>礼物按玩家和 giftId 聚合显示，服务端仍会按原始礼物事件逐笔补发。</p>
        </div>
      </div>

      <div v-if="!selectedRound" class="state-card compact-state">
        <strong>尚未选择源场次</strong>
        <span>完成步骤 1 后，这里会显示该场次内的玩家和礼物。</span>
      </div>
      <AsyncState
        v-else
        :loading="giftsLoading"
        :error="giftsError"
        :empty="Boolean(gifts && !gifts.items.length)"
        empty-text="该场次没有可恢复的礼物记录。"
        @retry="selectRound(selectedRound)"
      >
        <form v-if="gifts" class="recovery-selection-form" @submit.prevent="requestConfirmation">
          <div class="source-target-strip">
            <div>
              <span>源场次（只读）</span>
              <strong class="mono">{{ gifts.round.room_id }}</strong>
              <small class="mono">round {{ gifts.round.external_round_id }}</small>
              <small class="mono">冻结到礼物流水 #{{ gifts.snapshot_max_event_id }}</small>
            </div>
            <span class="source-target-arrow" aria-hidden="true">→</span>
            <label class="field">
              <span>目标房间 ID（当前客户端）</span>
              <input v-model="recovery.targetRoomId" required maxlength="128" spellcheck="false" @input="markTargetRoomEdited" />
              <small>
                服务端最新房间认证于 {{ formatDateTime(gifts.round.latest_target_room_authenticated_at) }}；请核对它正是当前客户端房间。
              </small>
            </label>
          </div>

          <div class="selection-toolbar">
            <div>
              <strong>本场共 {{ formatNumber(gifts.totals.event_count) }} 笔原始礼物事件</strong>
              <span>{{ formatNumber(gifts.totals.total_count) }} 份 · {{ formatNumber(gifts.totals.total_value) }} 抖</span>
              <span>已选 {{ selectionSummary.selections.length }} / {{ MAX_COMPENSATION_SELECTIONS }} 组玩家礼物</span>
            </div>
            <button class="button button-small button-secondary" type="button" @click="toggleAllGifts">
              {{ allSelected ? '取消全选' : '全选全部礼物' }}
            </button>
          </div>

          <p v-if="gifts.items.some(item => !item.catalog_known)" class="alert alert-warning">
            本场包含当前礼物目录中不存在的旧 giftId。它们仍可恢复，请在提交前核对原始名称、份数和价值。
          </p>
          <p v-if="selectionSummary.selections.length > MAX_COMPENSATION_SELECTIONS" class="alert alert-warning">
            当前选择超过单个任务的 {{ MAX_COMPENSATION_SELECTIONS }} 组上限，请取消部分礼物后分批恢复。
          </p>

          <div class="player-gift-list">
            <article v-for="player in playerGroups" :key="player.user_id" class="player-gift-card">
              <header class="player-gift-heading">
                <UserIdentity :name="player.nickname" :user-id="player.user_id" :avatar-url="player.avatar_url" />
                <label class="check-field player-select-all">
                  <input
                    type="checkbox"
                    :checked="selectedGiftCount(player) === player.gifts.length"
                    @change="togglePlayer(player, ($event.target as HTMLInputElement).checked)"
                  />
                  <span>该玩家 {{ selectedGiftCount(player) }}/{{ player.gifts.length }} 组</span>
                </label>
              </header>
              <p class="player-gift-totals">
                共 {{ formatNumber(player.event_count) }} 笔 · {{ formatNumber(player.total_count) }} 份 · {{ formatNumber(player.total_value) }} 抖
              </p>
              <div class="gift-choice-list">
                <label
                  v-for="gift in player.gifts"
                  :key="gift.gift_id"
                  class="gift-choice"
                  :class="{ selected: isGiftSelected(gift), unknown: !gift.catalog_known }"
                >
                  <input
                    type="checkbox"
                    :checked="isGiftSelected(gift)"
                    @change="toggleGift(gift, ($event.target as HTMLInputElement).checked)"
                  />
                  <span class="gift-choice-copy">
                    <span class="gift-choice-title">
                      <strong>{{ gift.gift_name || gift.catalog_name || gift.gift_id }}</strong>
                      <span v-if="!gift.catalog_known" class="status-pill status-warning">目录未知</span>
                    </span>
                    <small class="mono">{{ gift.gift_id }}</small>
                    <span>{{ formatNumber(gift.event_count) }} 笔事件 · {{ formatNumber(gift.total_count) }} 份 · {{ formatNumber(gift.total_value) }} 抖</span>
                    <time>{{ formatDateTime(gift.first_at) }} — {{ formatDateTime(gift.last_at) }}</time>
                  </span>
                </label>
              </div>
            </article>
          </div>

          <div class="recovery-options">
            <label class="check-field seat-option">
              <input v-model="recovery.seatPlayers" type="checkbox" />
              <span>先代所选玩家发评论落座（默认开启）</span>
            </label>
            <label v-if="recovery.seatPlayers" class="field">
              <span>落座评论内容</span>
              <input v-model="recovery.commentContent" required maxlength="2000" />
            </label>
            <label class="field">
              <span>每项发送间隔（毫秒）</span>
              <input v-model.number="recovery.intervalMs" type="number" min="500" max="60000" step="100" required />
              <small>由服务端调度，范围 500–60000 ms；不是浏览器定时发送。</small>
            </label>
            <label class="field recovery-reason">
              <span>事故恢复原因</span>
              <textarea v-model="recovery.reason" rows="3" maxlength="255" required placeholder="例如：直播中断，客户端在 20:15 后未消费礼物" />
            </label>
          </div>

          <div class="selection-summary">
            <div><span>玩家</span><strong>{{ selectionSummary.player_count }}</strong></div>
            <div><span>落座评论</span><strong>{{ selectedSeatCount }}</strong></div>
            <div><span>原始礼物事件</span><strong>{{ selectionSummary.gift_event_count }}</strong></div>
            <div><span>礼物总份数</span><strong>{{ formatNumber(selectionSummary.gift_count) }}</strong></div>
            <div><span>礼物总价值</span><strong>{{ formatNumber(selectionSummary.gift_value) }} 抖</strong></div>
            <div><span>预计耗时</span><strong>{{ estimatedDuration }}</strong></div>
          </div>
          <p v-if="recoveryError" class="form-error" role="alert">{{ recoveryError }}</p>
          <p v-if="successMessage" class="alert alert-success" role="status">{{ successMessage }}</p>
          <button class="button button-danger button-block" type="submit" :disabled="submitting || !selectionSummary.selections.length">
            复核 {{ totalReplayItems }} 项并创建恢复任务
          </button>
        </form>
      </AsyncState>
    </article>

    <article v-if="activeJob" class="panel active-job-panel">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">步骤 3 · 服务端任务</p>
          <h2>恢复进度</h2>
          <p class="mono">{{ activeJob.request_id }}</p>
        </div>
        <span class="status-pill" :class="compensationJobStatusClass(activeJob.status)">
          {{ compensationJobStatusLabel(activeJob.status) }}
        </span>
      </div>
      <div class="job-progress-copy">
        <strong>{{ compensationJobProcessedPercent(activeJob) }}%</strong>
        <span>
          {{ activeJob.completed_items + activeJob.failed_items + activeJob.cancelled_items }} / {{ activeJob.total_items }} 已处理
        </span>
      </div>
      <div class="job-progress-track" role="progressbar" aria-label="已处理比例" :aria-valuenow="compensationJobProcessedPercent(activeJob)" aria-valuemin="0" aria-valuemax="100">
        <span :style="{ width: `${compensationJobProcessedPercent(activeJob)}%` }" />
      </div>
      <div class="active-job-grid">
        <div><span>源 → 目标</span><strong class="mono">{{ activeJob.source_room_id }} → {{ activeJob.target_room_id }}</strong></div>
        <div><span>成功</span><strong>{{ activeJob.completed_items }}</strong></div>
        <div><span>失败</span><strong>{{ activeJob.failed_items }}</strong></div>
        <div><span>取消</span><strong>{{ activeJob.cancelled_items }}</strong></div>
        <div><span>待处理</span><strong>{{ activeJob.pending_items }}</strong></div>
        <div><span>礼物事件 / 份数</span><strong>{{ activeJob.total_gift_events }} / {{ formatNumber(activeJob.total_gift_count) }}</strong></div>
        <div><span>落座评论 / 间隔</span><strong>{{ activeJob.total_seat_events }} / {{ activeJob.interval_ms }} ms</strong></div>
        <div><span>冻结礼物流水</span><strong class="mono">#{{ activeJob.source_snapshot_max_event_id }}</strong></div>
      </div>
      <p class="field-help server-owned-note">任务已保存在服务端。关闭本页面不会停止任务；本页只轮询并显示进度。</p>
      <p v-if="activeJob.last_error" class="alert alert-error">{{ activeJob.last_error }}</p>
      <p v-if="activeJobError" class="form-error" role="alert">{{ activeJobError }}</p>
      <div v-if="activeJobFailures.length" class="job-failure-list">
        <strong>失败项（最多显示 20 条）</strong>
        <article v-for="item in activeJobFailures" :key="item.id">
          <span>#{{ item.sequence }} {{ item.type === 'comment' ? '落座评论' : (item.gift_name || item.gift_id) }}</span>
          <small>{{ item.nickname || item.user_id }} · {{ item.last_error || '未返回错误信息' }}</small>
        </article>
      </div>
      <div v-if="activeCancelledGiftSummary.totalCount" class="job-cancelled-gift-list">
        <strong>取消后的礼物状态</strong>
        <small class="job-cancelled-gift-summary">
          可重新创建恢复 {{ activeCancelledGiftSummary.recoverableCount }} ·
          受防重复保护 {{ activeCancelledGiftSummary.protectedCount }} ·
          仅显示前 {{ activeCancelledGiftSummary.visibleItems.length }} / 共 {{ activeCancelledGiftSummary.totalCount }}
        </small>
        <article v-for="item in activeCancelledGiftSummary.visibleItems" :key="item.id">
          <span>#{{ item.sequence }} {{ item.gift_name || item.gift_id }} × {{ formatNumber(item.count ?? 0) }}</span>
          <small :class="item.source_claim_released ? 'is-recoverable' : 'is-protected'">
            {{ cancelledGiftRecoveryMessage(item) }}
          </small>
        </article>
      </div>
      <div class="job-actions">
        <button class="button button-small button-secondary" type="button" :disabled="activeJobLoading" @click="loadJobDetail(activeJob.id)">
          {{ activeJobLoading ? '刷新中…' : '刷新详情' }}
        </button>
        <button v-if="activeJob.status === 'failed'" class="button button-small button-secondary" type="button" @click="openJobAction(activeJob, 'retry')">重试失败项</button>
        <button v-if="isActiveCompensationJob(activeJob.status)" class="button button-small button-danger" type="button" @click="openJobAction(activeJob, 'cancel')">取消未发送项</button>
      </div>
    </article>

    <article class="panel jobs-panel">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">审计与续跑</p>
          <h2>最近恢复任务</h2>
          <p>运行中任务每 2.5 秒短轮询；只有失败任务可重试，等待或运行中的任务可取消。</p>
        </div>
        <button class="button button-small button-secondary" type="button" :disabled="jobsRefreshing" @click="loadJobs()">
          {{ jobsRefreshing ? '刷新中…' : '刷新任务' }}
        </button>
      </div>
      <p v-if="pollingWarning" class="alert alert-warning" role="status">{{ pollingWarning }}</p>
      <AsyncState :loading="jobsLoading" :error="jobsError" :empty="!jobs.length" empty-text="尚无礼物恢复任务。" @retry="loadJobs()">
        <div class="recovery-job-list">
          <article v-for="job in jobs" :key="job.id" class="recovery-job-card">
            <div class="recovery-job-main">
              <div>
                <span class="status-pill" :class="compensationJobStatusClass(job.status)">{{ compensationJobStatusLabel(job.status) }}</span>
                <strong>{{ job.source_room_id }} → {{ job.target_room_id }}</strong>
                <small class="mono">{{ job.source_external_round_id }} · 流水 #{{ job.source_snapshot_max_event_id }} · {{ job.request_id }}</small>
              </div>
              <time>{{ formatDateTime(job.created_at) }}</time>
            </div>
            <p>{{ job.reason }}</p>
            <div class="recovery-job-stats">
              <span>已处理 {{ job.completed_items + job.failed_items + job.cancelled_items }}/{{ job.total_items }}</span>
              <span>成功 {{ job.completed_items }}</span>
              <span>失败 {{ job.failed_items }}</span>
              <span>取消 {{ job.cancelled_items }}</span>
              <span>礼物 {{ job.total_gift_events }} 笔 / {{ formatNumber(job.total_gift_count) }} 份</span>
              <span>落座 {{ job.total_seat_events }}</span>
            </div>
            <small v-if="job.last_error" class="form-error">{{ job.last_error }}</small>
            <div class="job-actions">
              <button class="button button-small button-secondary" type="button" @click="loadJobDetail(job.id)">查看进度</button>
              <button v-if="job.status === 'failed'" class="button button-small button-secondary" type="button" @click="openJobAction(job, 'retry')">重试</button>
              <button v-if="isActiveCompensationJob(job.status)" class="button button-small button-danger" type="button" @click="openJobAction(job, 'cancel')">取消</button>
            </div>
          </article>
        </div>
      </AsyncState>
    </article>

    <ConfirmDialog
      :open="confirmOpen"
      title="确认创建礼物恢复任务？"
      confirm-text="确认并由服务端执行"
      :busy="submitting"
      danger
      @cancel="confirmOpen = false"
      @confirm="submitRecovery"
    >
      <dl class="confirmation-list">
        <div><dt>Request ID</dt><dd class="mono">{{ recovery.requestId }}</dd></div>
        <div><dt>源场次</dt><dd class="mono">{{ selectedRound?.room_id }} / {{ selectedRound?.external_round_id }}</dd></div>
        <div><dt>礼物流水快照</dt><dd class="mono">冻结到流水 #{{ gifts?.snapshot_max_event_id }}</dd></div>
        <div><dt>目标房间</dt><dd class="mono">{{ recovery.targetRoomId }}</dd></div>
        <div><dt>目标房间最近认证</dt><dd>{{ formatDateTime(selectedRound?.latest_target_room_authenticated_at) }}，请确认当前客户端仍在此房间</dd></div>
        <div><dt>玩家数</dt><dd>{{ selectionSummary.player_count }}</dd></div>
        <div><dt>落座评论</dt><dd>{{ selectedSeatCount }} 项{{ recovery.seatPlayers ? `（“${recovery.commentContent}”）` : '' }}</dd></div>
        <div><dt>原始礼物</dt><dd>{{ selectionSummary.gift_event_count }} 笔 · {{ formatNumber(selectionSummary.gift_count) }} 份 · {{ formatNumber(selectionSummary.gift_value) }} 抖</dd></div>
        <div><dt>发送间隔</dt><dd>{{ recovery.intervalMs }} ms</dd></div>
        <div><dt>预计耗时</dt><dd>{{ estimatedDuration }}</dd></div>
        <div><dt>原因</dt><dd>{{ recovery.reason }}</dd></div>
      </dl>
      <p v-if="selectionSummary.unknown_gift_count" class="alert alert-warning">
        已选择 {{ selectionSummary.unknown_gift_count }} 组当前目录未知礼物，它们会按原始记录恢复。
      </p>
      <p class="alert alert-warning">
        提交后任务由服务端按顺序执行：先发落座评论，再按原始礼物事件逐笔补发。关闭页面不会中止任务。
      </p>
      <p v-if="submitError" class="form-error" role="alert">{{ submitError }}</p>
    </ConfirmDialog>

    <ConfirmDialog
      :open="Boolean(actionTarget)"
      :title="actionTarget?.action === 'retry' ? '确认重试失败项？' : '确认取消未发送项？'"
      :confirm-text="actionTarget?.action === 'retry' ? '确认重试' : '确认取消'"
      :busy="actionBusy"
      danger
      @cancel="actionTarget = null"
      @confirm="runJobAction"
    >
      <p v-if="actionTarget" class="mono">{{ actionTarget.job.request_id }}</p>
      <p v-if="actionTarget?.action === 'retry'">服务端只会续跑原任务中的失败项，沿用原 eventId，不会重放已成功项。</p>
      <p v-else>等待中的项目会取消；当前正在 processing 的项目无法撤回，最多仍可能再发送 1 项。已经入队或完成的项目不会撤回。</p>
      <p v-if="actionError" class="form-error" role="alert">{{ actionError }}</p>
    </ConfirmDialog>
  </section>
</template>
