<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAsyncTask } from '@/composables/useAsyncTask';
import { adminSession } from '@/services/session';
import type { ProjectDefinition } from '@/types/project';

const route = useRoute();
const router = useRouter();
const { loading, error, run } = useAsyncTask();
const projects = computed(() => adminSession.state.projects);

async function selectProject(project: ProjectDefinition): Promise<void> {
  if (project.authRequired) {
    adminSession.logout();
    await router.push({
      name: 'login',
      query: { project: project.id, redirect: requestedRedirect() },
    });
    return;
  }

  const selected = await run(async () => {
    await adminSession.login(project.id, '');
    return true;
  });
  if (selected) await router.replace(requestedRedirect());
}

function requestedRedirect(): string {
  const value = typeof route.query.redirect === 'string' ? route.query.redirect : '/overview';
  return value.startsWith('/') && value !== '/projects' && !value.startsWith('/login')
    ? value
    : '/overview';
}
</script>

<template>
  <main class="projects-page">
    <section class="projects-hero">
      <p class="eyebrow">Danmaku Operations</p>
      <h1>选择要管理的玩法</h1>
      <p>先进入玩法，再查看该玩法开放的功能。平台、数据库和页面权限均由独立管理服务确认。</p>
    </section>

    <section class="projects-panel">
      <div v-if="adminSession.state.initializationError" class="alert alert-error" role="alert">
        {{ adminSession.state.initializationError }}
      </div>
      <div v-else-if="adminSession.state.initializing" class="state-card">
        <span class="spinner" aria-hidden="true" />
        <strong>正在加载玩法列表</strong>
      </div>
      <div v-else class="project-entry-grid">
        <button
          v-for="project in projects"
          :key="project.id"
          class="project-entry-card"
          type="button"
          :disabled="loading"
          @click="selectProject(project)"
        >
          <span class="project-entry-mark">{{ project.name.slice(0, 1) }}</span>
          <span class="project-entry-copy">
            <strong>{{ project.name }}</strong>
            <small class="mono">{{ project.id }}</small>
            <em>{{ project.authRequired ? '需要管理员 Token' : '本机测试 · 免 Token' }}</em>
            <span class="project-entry-meta">
              <span>平台：进入后确认</span>
              <span>功能数：进入后确认</span>
            </span>
          </span>
          <span class="project-entry-action">进入 →</span>
        </button>
      </div>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    </section>
  </main>
</template>
