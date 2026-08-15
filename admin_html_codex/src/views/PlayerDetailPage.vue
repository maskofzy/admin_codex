<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import AsyncState from '@/components/AsyncState.vue';
import PageHeader from '@/components/PageHeader.vue';
import { adminSession } from '@/services/session';
import type { LeaderboardPeriod, RoundSummary } from '@/types/api';
import { formatDateTime, formatNumber } from '@/utils/format';

const route = useRoute();
const rounds = ref<RoundSummary[]>([]);
const loading = ref(true);
const error = ref('');
const userId = computed(() => String(route.params.userId));
const nickname = computed(() => typeof route.query.name === 'string' ? route.query.name : userId.value);
const period = computed<LeaderboardPeriod>(() =>
  route.params.period === 'previous_week' ? 'previous_week' : 'current_week');
const backRoute = computed(() => period.value === 'previous_week' ? '/leaderboards/previous' : '/leaderboards/current');

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const response = await adminSession.api().request<{ period: string; items: RoundSummary[] }>(
      `/admin/v1/users/${encodeURIComponent(userId.value)}/rounds`,
      { query: { period: period.value } },
    );
    rounds.value = response.items;
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '玩家局记录加载失败';
  } finally {
    loading.value = false;
  }
}

onMounted(() => void load());
</script>

<template>
  <section>
    <PageHeader :title="`${nickname} · 局详情`" :description="`用户 ID：${userId}`">
      <RouterLink class="button button-secondary" :to="backRoute">返回榜单</RouterLink>
    </PageHeader>
    <AsyncState :loading="loading" :error="error" :empty="!rounds.length" empty-text="该玩家在所选周期没有局记录。" @retry="load">
      <div class="table-card">
        <table>
          <thead><tr><th>轮次</th><th>房间</th><th>状态</th><th>局积分</th><th>基础分</th><th>整局总价值</th><th>开始</th><th>结算</th></tr></thead>
          <tbody>
            <tr v-for="round in rounds" :key="round.round_id">
              <td class="mono">{{ round.round_id }}</td>
              <td class="mono">{{ round.room_id }}</td>
              <td><span class="status-pill">{{ round.status }}</span></td>
              <td class="number-cell">{{ formatNumber(round.score) }}</td>
              <td class="number-cell muted">{{ formatNumber(round.base_score) }}</td>
              <td class="number-cell muted">{{ formatNumber(round.total_value) }}</td>
              <td>{{ formatDateTime(round.started_at) }}</td>
              <td>{{ formatDateTime(round.settled_at) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </AsyncState>
  </section>
</template>
