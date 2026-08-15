<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import AsyncState from '@/components/AsyncState.vue';
import PageHeader from '@/components/PageHeader.vue';
import UserIdentity from '@/components/UserIdentity.vue';
import { adminSession } from '@/services/session';
import type { LeaderboardItem, LeaderboardResponse } from '@/types/api';
import { formatDate, formatDateTime, formatNumber } from '@/utils/format';

const items = ref<LeaderboardItem[]>([]);
const periodStart = ref('');
const loading = ref(true);
const refreshing = ref(false);
const error = ref('');
const paused = ref(false);
const updatedAt = ref<Date | null>(null);
let timer: ReturnType<typeof setInterval> | undefined;

async function load(): Promise<void> {
  if (refreshing.value) return;
  refreshing.value = true;
  error.value = '';
  try {
    const response = await adminSession.api().request<LeaderboardResponse>(
      '/admin/v1/leaderboards',
      { query: { period: 'current_week', limit: 100 } },
    );
    items.value = response.items;
    periodStart.value = response.period_start;
    updatedAt.value = new Date();
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '榜单加载失败';
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

function togglePause(): void {
  paused.value = !paused.value;
}

onMounted(() => {
  void load();
  timer = setInterval(() => {
    if (!paused.value) void load();
  }, 30_000);
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <section>
    <PageHeader title="本周榜单监控" description="每 30 秒自动刷新，榜单记录由服务端周期统计生成。">
      <button class="button button-secondary" type="button" @click="togglePause">
        {{ paused ? '恢复自动刷新' : '暂停自动刷新' }}
      </button>
      <button class="button button-primary" type="button" :disabled="refreshing" @click="load">
        {{ refreshing ? '刷新中…' : '立即刷新' }}
      </button>
    </PageHeader>

    <div class="metric-row">
      <div class="metric-card"><span>榜单人数</span><strong>{{ formatNumber(items.length) }}</strong></div>
      <div class="metric-card"><span>周期开始</span><strong>{{ formatDate(periodStart) }}</strong></div>
      <div class="metric-card"><span>最后更新</span><strong>{{ updatedAt ? formatDateTime(updatedAt.toISOString()) : '—' }}</strong></div>
      <div class="metric-card"><span>自动刷新</span><strong>{{ paused ? '已暂停' : '30 秒' }}</strong></div>
    </div>

    <AsyncState
      :loading="loading"
      :error="error"
      :empty="!items.length"
      empty-text="本周尚无榜单数据。"
      @retry="load"
    >
      <div class="table-card">
        <table>
          <thead><tr><th>排名</th><th>玩家</th><th>本周积分</th><th>累计积分</th><th /></tr></thead>
          <tbody>
            <tr v-for="item in items" :key="item.user_id">
              <td><span class="rank-badge" :class="`rank-${item.rank}`">{{ item.rank }}</span></td>
              <td><UserIdentity :name="item.nickname" :user-id="item.user_id" :avatar-url="item.avatar_url" /></td>
              <td class="number-cell">{{ formatNumber(item.score) }}</td>
              <td class="number-cell muted">{{ formatNumber(item.total_score) }}</td>
              <td class="actions-cell">
                <RouterLink
                  class="button button-small button-secondary"
                  :to="{ name: 'player-detail', params: { period: 'current_week', userId: item.user_id }, query: { name: item.nickname } }"
                >
                  局详情
                </RouterLink>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </AsyncState>
  </section>
</template>
