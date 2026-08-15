<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { adminSession } from '@/services/session';
import type { ProjectCapability } from '@/types/project';

interface NavigationItem {
  label: string;
  route: string;
  capability?: ProjectCapability;
}

const router = useRouter();
const menuOpen = ref(false);
const projectName = computed(() =>
  adminSession.state.context?.project_name || adminSession.state.project?.name || '');
const navigation = computed<NavigationItem[]>(() => {
  const items: NavigationItem[] = [
    { label: '总览', route: '/overview' },
    { label: '本周榜单', route: '/leaderboards/current', capability: 'leaderboards' },
    { label: '上周 Top100', route: '/leaderboards/previous', capability: 'leaderboards' },
    { label: '礼物补偿', route: '/compensations', capability: 'compensations' },
    { label: '行会管理', route: '/guilds', capability: 'guilds' },
    { label: '礼物调试', route: '/debug', capability: 'debug' },
    { label: '配置与令牌', route: '/operations', capability: 'operations' },
    { label: '塔防配置', route: '/tower-config', capability: 'tower_config' },
  ];
  return items.filter(item => !item.capability || adminSession.can(item.capability));
});

function switchProject(): void {
  adminSession.logout();
  void router.replace({ name: 'projects' });
}
</script>

<template>
  <div class="admin-shell">
    <aside class="sidebar" :class="{ 'sidebar-open': menuOpen }">
      <div class="brand">
        <span class="brand-mark">弹</span>
        <span>
          <strong>玩法管理台</strong>
          <small>{{ projectName }}</small>
        </span>
      </div>
      <nav class="navigation" aria-label="主导航">
        <RouterLink
          v-for="item in navigation"
          :key="item.route"
          :to="item.route"
          @click="menuOpen = false"
        >
          {{ item.label }}
        </RouterLink>
      </nav>
      <div class="sidebar-footer">
        <span class="environment-badge" :class="{ mock: adminSession.state.context?.mock_mode }">
          {{ adminSession.state.context?.mock_mode ? 'Mock 调试环境' : '生产运维环境' }}
        </span>
        <button class="button button-ghost" type="button" @click="switchProject">切换玩法</button>
      </div>
    </aside>
    <div class="main-column">
      <header class="mobile-bar">
        <button class="icon-button" type="button" aria-label="打开导航" @click="menuOpen = !menuOpen">☰</button>
        <strong>{{ projectName }}</strong>
      </header>
      <button
        v-if="menuOpen"
        class="sidebar-scrim"
        type="button"
        aria-label="关闭导航"
        @click="menuOpen = false"
      />
      <main class="main-content">
        <RouterView />
      </main>
    </div>
  </div>
</template>
