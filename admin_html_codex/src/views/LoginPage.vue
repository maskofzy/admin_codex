<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { adminSession } from '@/services/session';
import { useAsyncTask } from '@/composables/useAsyncTask';

const route = useRoute();
const router = useRouter();
const token = ref('');
const { loading, error, run } = useAsyncTask();
const projectId = computed(() => typeof route.query.project === 'string' ? route.query.project : '');
const selectedProject = computed(() => adminSession.state.projects
  .find(project => project.id === projectId.value) ?? null);
const validProject = computed(() => Boolean(selectedProject.value?.authRequired));

async function submit(): Promise<void> {
  const result = await run(async () => {
    if (!selectedProject.value || !selectedProject.value.authRequired) {
      throw new Error('请先从玩法列表选择需要登录的玩法');
    }
    await adminSession.login(selectedProject.value.id, token.value);
    return true;
  });
  if (!result) return;
  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/overview';
  await router.replace(redirect);
}
</script>

<template>
  <main class="login-page">
    <section class="login-intro">
      <p class="eyebrow">Danmaku Operations</p>
      <h1>一个入口管理所有玩法</h1>
      <p>前端只连接独立管理服务；玩法能力、平台和礼物目录在登录后由服务端返回。</p>
      <ul class="feature-list">
        <li>榜单监控与玩家局详情</li>
        <li>幂等礼物补偿与审核记录</li>
        <li>行会、调试和配置运维</li>
      </ul>
    </section>
    <section class="login-card">
      <h2>管理员登录</h2>
      <p class="muted">Token 只保存在当前浏览器标签页，关闭标签页后自动清除。</p>
      <div v-if="adminSession.state.initializationError" class="alert alert-error" role="alert">
        {{ adminSession.state.initializationError }}
      </div>
      <div v-else-if="!validProject" class="form-stack">
        <div class="alert alert-warning">当前登录链接没有有效玩法，请返回玩法列表重新选择。</div>
        <RouterLink class="button button-secondary button-block" :to="{ name: 'projects' }">返回玩法列表</RouterLink>
      </div>
      <form v-else class="form-stack" @submit.prevent="submit">
        <div class="selected-project-summary">
          <strong>{{ selectedProject?.name }}</strong>
          <small class="mono">{{ selectedProject?.id }}</small>
        </div>
        <label class="field">
          <span>管理员 Token</span>
          <input
            v-model="token"
            type="password"
            autocomplete="off"
            spellcheck="false"
            placeholder="输入 x-admin-token"
            required
          />
        </label>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <button class="button button-primary button-block" type="submit" :disabled="loading">
          {{ loading ? '正在连接…' : '验证并进入' }}
        </button>
        <RouterLink class="button button-secondary button-block" :to="{ name: 'projects' }">更换玩法</RouterLink>
      </form>
    </section>
  </main>
</template>
