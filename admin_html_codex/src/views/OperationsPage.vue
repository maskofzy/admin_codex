<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import AsyncState from '@/components/AsyncState.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import PageHeader from '@/components/PageHeader.vue';
import { ApiError } from '@/services/api';
import { adminSession } from '@/services/session';
import type { ConfigRevision, GameConfigRecord, PlatformTokenResponse } from '@/types/api';
import { formatDateTime } from '@/utils/format';

const configs = ref<GameConfigRecord[]>([]);
const revisions = ref<ConfigRevision[]>([]);
const selectedKey = ref(adminSession.state.context?.config_key ?? '');
const selectedConfig = computed(() => configs.value.find(config => config.config_key === selectedKey.value) ?? null);
const loading = ref(true);
const error = ref('');
const configText = ref('{}');
const configRemark = ref('');
const configEnabled = ref(true);
const configError = ref('');
const configBusy = ref(false);
const configConfirmOpen = ref(false);
const parsedConfig = ref<Record<string, unknown> | null>(null);
const platform = computed(() => adminSession.state.context?.platform ?? 'dy');
const platformLabel = computed(() => platform.value === 'dy' ? '抖音' : '快手');
const tokenResult = ref<PlatformTokenResponse | null>(null);
const tokenBusy = ref(false);
const tokenError = ref('');
const revealToken = ref(false);
const refreshTokenConfirmOpen = ref(false);

async function loadConfigs(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const response = await adminSession.api().request<{ items: GameConfigRecord[] }>('/admin/v1/configs');
    configs.value = response.items;
    if (!configs.value.some(config => config.config_key === selectedKey.value)) {
      selectedKey.value = configs.value[0]?.config_key ?? '';
    }
  } catch (reason) {
    error.value = errorText(reason, '配置加载失败');
  } finally {
    loading.value = false;
  }
}

async function loadRevisions(): Promise<void> {
  if (!selectedKey.value) {
    revisions.value = [];
    return;
  }
  try {
    const response = await adminSession.api().request<{ items: ConfigRevision[] }>(
      `/admin/v1/configs/${encodeURIComponent(selectedKey.value)}/revisions`,
    );
    revisions.value = response.items;
  } catch (reason) {
    configError.value = errorText(reason, '配置历史加载失败');
  }
}

function syncEditor(): void {
  const config = selectedConfig.value;
  if (!config) return;
  configText.value = JSON.stringify(config.config, null, 2);
  configRemark.value = config.remark;
  configEnabled.value = config.enabled;
  configError.value = '';
  void loadRevisions();
}

function requestConfigSave(): void {
  configError.value = '';
  try {
    const value: unknown = JSON.parse(configText.value);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      configError.value = '配置必须是 JSON 对象。';
      return;
    }
    parsedConfig.value = value as Record<string, unknown>;
    configConfirmOpen.value = true;
  } catch (reason) {
    configError.value = reason instanceof Error ? `JSON 解析失败：${reason.message}` : 'JSON 解析失败';
  }
}

async function saveConfig(): Promise<void> {
  const current = selectedConfig.value;
  if (!current || !parsedConfig.value || configBusy.value) return;
  configBusy.value = true;
  configError.value = '';
  try {
    const updated = await adminSession.api().request<GameConfigRecord>(
      `/admin/v1/configs/${encodeURIComponent(current.config_key)}`,
      {
        method: 'PATCH',
        body: {
          version: current.version,
          config: parsedConfig.value,
          enabled: configEnabled.value,
          remark: configRemark.value.trim(),
        },
      },
    );
    const index = configs.value.findIndex(config => config.config_key === updated.config_key);
    if (index >= 0) configs.value[index] = updated;
    configConfirmOpen.value = false;
    syncEditor();
  } catch (reason) {
    configError.value = reason instanceof ApiError && reason.status === 409
      ? '保存失败：配置版本已变化，请重新加载后再编辑。'
      : errorText(reason, '配置保存失败');
    configConfirmOpen.value = false;
  } finally {
    configBusy.value = false;
  }
}

async function readToken(forceRefresh: boolean): Promise<void> {
  if (tokenBusy.value) return;
  tokenBusy.value = true;
  tokenError.value = '';
  revealToken.value = false;
  try {
    tokenResult.value = await adminSession.api().request<PlatformTokenResponse>(
      forceRefresh
        ? `/admin/v1/platform-tokens/${platform.value}/refresh`
        : `/admin/v1/platform-tokens/${platform.value}`,
      { method: forceRefresh ? 'POST' : 'GET' },
    );
    refreshTokenConfirmOpen.value = false;
  } catch (reason) {
    tokenError.value = errorText(reason, forceRefresh ? 'Token 刷新失败' : 'Token 读取失败');
  } finally {
    tokenBusy.value = false;
  }
}

const displayedToken = computed(() => {
  const token = tokenResult.value?.access_token ?? '';
  if (!token || revealToken.value) return token || '缓存中没有 token';
  if (token.length <= 12) return '••••••••••••';
  return `${token.slice(0, 6)}${'•'.repeat(12)}${token.slice(-6)}`;
});

watch(selectedKey, syncEditor);
onMounted(async () => {
  await loadConfigs();
  syncEditor();
});

function errorText(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}
</script>

<template>
  <section>
    <PageHeader title="配置与平台令牌" description="配置采用版本号 CAS 更新；平台 access token 按抖音、快手独立缓存。" />
    <div class="alert alert-warning operations-warning">
      <strong>配置不是客户端热更新。</strong>
      <span>保存后只影响下一次开播或重新连接。已经运行的客户端需要重新执行开播/恢复流程才能取得新配置。</span>
    </div>

    <div class="operations-grid">
      <div class="panel config-panel">
        <div class="panel-heading">
          <div><p class="eyebrow">玩法参数</p><h2>配置编辑</h2></div>
          <button class="button button-small button-secondary" type="button" :disabled="loading" @click="loadConfigs">重新加载</button>
        </div>
        <AsyncState :loading="loading" :error="error" :empty="!configs.length" empty-text="没有可编辑配置。" @retry="loadConfigs">
          <form class="form-stack" @submit.prevent="requestConfigSave">
            <label class="field"><span>配置项</span><select v-model="selectedKey"><option v-for="config in configs" :key="config.config_key" :value="config.config_key">{{ config.config_key }} · v{{ config.version }}</option></select></label>
            <label class="field"><span>JSON 配置</span><textarea v-model="configText" class="code-editor" rows="18" spellcheck="false" required /></label>
            <label class="field"><span>修改备注</span><input v-model="configRemark" maxlength="255" placeholder="说明本次参数调整" /></label>
            <label class="check-field"><input v-model="configEnabled" type="checkbox" /><span>启用此配置</span></label>
            <p v-if="configError" class="form-error" role="alert">{{ configError }}</p>
            <button class="button button-primary" type="submit" :disabled="configBusy || !selectedConfig">复核并保存 v{{ selectedConfig?.version }}</button>
          </form>
        </AsyncState>
      </div>

      <div class="side-stack">
        <div class="panel">
          <div class="panel-heading"><div><p class="eyebrow">平台凭据</p><h2>Access Token</h2></div></div>
          <div class="form-stack">
            <label class="field"><span>当前玩法平台</span><input :value="platformLabel" readonly /></label>
            <div class="token-display" :class="{ revealed: revealToken }"><code>{{ displayedToken }}</code></div>
            <p v-if="tokenResult" class="field-help">剩余有效期 {{ tokenResult.expires_in }} 秒。该值只保留在当前页面内存中。</p>
            <p v-if="tokenError" class="form-error" role="alert">{{ tokenError }}</p>
            <div class="inline-actions">
              <button class="button button-secondary" type="button" :disabled="tokenBusy" @click="readToken(false)">读取缓存</button>
              <button class="button button-secondary" type="button" :disabled="!tokenResult?.access_token" @click="revealToken = !revealToken">{{ revealToken ? '隐藏' : '显示' }}</button>
              <button class="button button-danger" type="button" :disabled="tokenBusy" @click="refreshTokenConfirmOpen = true">强制刷新</button>
            </div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-heading"><div><p class="eyebrow">审计</p><h2>配置版本历史</h2></div></div>
          <div v-if="!revisions.length" class="state-card"><strong>暂无历史</strong><span>保存配置后会记录版本。</span></div>
          <div v-else class="revision-list">
            <article v-for="revision in revisions" :key="revision.version">
              <strong>v{{ revision.version }}</strong>
              <span>{{ revision.remark || '无备注' }}</span>
              <time>{{ formatDateTime(revision.changed_at) }}</time>
            </article>
          </div>
        </div>
      </div>
    </div>

    <ConfirmDialog :open="configConfirmOpen" title="确认发布新配置版本？" :busy="configBusy" confirm-text="确认保存" @cancel="configConfirmOpen = false" @confirm="saveConfig">
      <p>将基于 {{ selectedConfig?.config_key }} v{{ selectedConfig?.version }} 执行 CAS 更新。</p>
      <p class="alert alert-warning">保存不会让当前直播客户端立即热更新；新配置在下一次开播或重连时生效。</p>
    </ConfirmDialog>
    <ConfirmDialog :open="refreshTokenConfirmOpen" title="确认强制刷新平台 Token？" :busy="tokenBusy" danger confirm-text="确认刷新" @cancel="refreshTokenConfirmOpen = false" @confirm="readToken(true)">
      <p>这会请求 {{ platformLabel }}平台生成或刷新 access token，并替换该平台缓存。</p>
    </ConfirmDialog>
  </section>
</template>
