<script setup lang="ts">
import { computed } from 'vue';
import PageHeader from '@/components/PageHeader.vue';
import { adminSession } from '@/services/session';
import type { ProjectCapability } from '@/types/project';

const cards = computed(() => ([
  { title: '本周榜单监控', copy: '每 30 秒自动更新，可随时暂停并查看玩家每局记录。', to: '/leaderboards/current', capability: 'leaderboards' },
  { title: '上周 Top100', copy: '复核上周排名与玩家每局明细，榜单页面保持只读。', to: '/leaderboards/previous', capability: 'leaderboards' },
  { title: '礼物补偿', copy: '使用显式 eventId 补发礼物，重复提交不会重复履约。', to: '/compensations', capability: 'compensations' },
  { title: '行会管理', copy: '维护长期行会及成员，和单局阵营分组保持清晰边界。', to: '/guilds', capability: 'guilds' },
  { title: '礼物调试', copy: '仅 Mock 环境开放，使用稳定 gift_id 模拟完整事件。', to: '/debug', capability: 'debug' },
  { title: '配置与令牌', copy: 'CAS 更新玩法配置，查看或刷新对应平台 access token。', to: '/operations', capability: 'operations' },
  { title: '塔防配置', copy: '集中维护关卡、怪物、人数系数、经验和主播跳关配置。', to: '/tower-config', capability: 'tower_config' },
].filter(card => adminSession.can(card.capability as ProjectCapability))));
</script>

<template>
  <section>
    <PageHeader
      title="运维总览"
      :description="`${adminSession.state.context?.project_name || adminSession.state.project?.name || ''} · ${adminSession.state.context?.platform.toUpperCase() || ''}`"
    />
    <div class="notice-banner">
      <strong>{{ adminSession.state.context?.mock_mode ? '当前为 Mock 环境' : '当前为生产环境' }}</strong>
      <span v-if="adminSession.state.project?.authRequired">
        所有写操作均通过管理员 Token 鉴权；生产环境不提供评论或点赞补偿。
      </span>
      <span v-else>当前仅允许本机 Mock 测试免 Token；生产环境仍强制鉴权。</span>
    </div>
    <div class="overview-grid">
      <RouterLink v-for="card in cards" :key="card.to" class="overview-card" :to="card.to">
        <h2>{{ card.title }}</h2>
        <p>{{ card.copy }}</p>
        <span>打开功能 →</span>
      </RouterLink>
    </div>
  </section>
</template>
