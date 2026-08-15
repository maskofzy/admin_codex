<script setup lang="ts">
import { onMounted, ref } from 'vue';
import AsyncState from '@/components/AsyncState.vue';
import PageHeader from '@/components/PageHeader.vue';
import UserIdentity from '@/components/UserIdentity.vue';
import { adminSession } from '@/services/session';
import type { LeaderboardItem, LeaderboardResponse } from '@/types/api';
import { formatDate, formatNumber } from '@/utils/format';

const items = ref<LeaderboardItem[]>([]);
const periodStart = ref('');
const loading = ref(true);
const error = ref('');

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const response = await adminSession.api().request<LeaderboardResponse>(
      '/admin/v1/leaderboards',
      { query: { period: 'previous_week', limit: 100 } },
    );
    items.value = response.items;
    periodStart.value = response.period_start;
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '榜单加载失败';
  } finally {
    loading.value = false;
  }
}

onMounted(() => void load());
</script>

<template>
  <section>
    <PageHeader title="上周 Top100" description="用于复核上周排名与玩家每局明细，榜单页面保持只读。">
      <button class="button button-primary" type="button" :disabled="loading" @click="load">重新加载</button>
    </PageHeader>
    <div class="notice-banner compact">
      <strong>周期开始：{{ formatDate(periodStart) }}</strong>
      <span>排名与积分来自已结算周期数据，本页不会修改玩家或局状态。</span>
    </div>

    <AsyncState :loading="loading" :error="error" :empty="!items.length" empty-text="上周没有榜单记录。" @retry="load">
      <div class="table-card">
        <table>
          <thead><tr><th>排名</th><th>玩家</th><th>上周积分</th><th>累计积分</th><th /></tr></thead>
          <tbody>
            <tr v-for="item in items" :key="item.user_id">
              <td><span class="rank-badge" :class="`rank-${item.rank}`">{{ item.rank }}</span></td>
              <td><UserIdentity :name="item.nickname" :user-id="item.user_id" :avatar-url="item.avatar_url" /></td>
              <td class="number-cell">{{ formatNumber(item.score) }}</td>
              <td class="number-cell muted">{{ formatNumber(item.total_score) }}</td>
              <td class="actions-cell">
                <RouterLink
                  class="button button-small button-secondary"
                  :to="{ name: 'player-detail', params: { period: 'previous_week', userId: item.user_id }, query: { name: item.nickname } }"
                >局详情</RouterLink>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </AsyncState>
  </section>
</template>
