<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import AsyncState from '@/components/AsyncState.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import PageHeader from '@/components/PageHeader.vue';
import UserIdentity from '@/components/UserIdentity.vue';
import { ApiError } from '@/services/api';
import { adminSession } from '@/services/session';
import type { GuildMember, GuildRecord } from '@/types/api';
import { formatDateTime } from '@/utils/format';

const guilds = ref<GuildRecord[]>([]);
const selectedGuildId = ref('');
const selectedGuild = computed(() => guilds.value.find(guild => guild.guild_id === selectedGuildId.value) ?? null);
const members = ref<GuildMember[]>([]);
const loading = ref(true);
const error = ref('');
const memberLoading = ref(false);
const memberError = ref('');
const editorOpen = ref(false);
const editing = ref(false);
const editorBusy = ref(false);
const editorError = ref('');
const disableOpen = ref(false);
const disableBusy = ref(false);
const removeTarget = ref<GuildMember | null>(null);
const memberBusy = ref(false);
const editor = reactive({ name: '', joinCode: '', description: '', enabled: true, version: 0 });
const memberForm = reactive<{ userId: string; role: GuildMember['role'] }>({ userId: '', role: 'member' });

async function loadGuilds(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const response = await adminSession.api().request<{ items: GuildRecord[] }>('/admin/v1/guilds', {
      query: { limit: 100 },
    });
    guilds.value = response.items;
    if (!guilds.value.some(guild => guild.guild_id === selectedGuildId.value)) {
      selectedGuildId.value = guilds.value[0]?.guild_id ?? '';
    }
  } catch (reason) {
    error.value = errorText(reason, '行会列表加载失败');
  } finally {
    loading.value = false;
  }
}

async function loadMembers(): Promise<void> {
  const guild = selectedGuild.value;
  members.value = [];
  memberError.value = '';
  if (!guild) return;
  memberLoading.value = true;
  try {
    const response = await adminSession.api().request<{ items: GuildMember[] }>(
      `/admin/v1/guilds/${encodeURIComponent(guild.guild_id)}/members`,
    );
    members.value = response.items;
  } catch (reason) {
    memberError.value = errorText(reason, '成员列表加载失败');
  } finally {
    memberLoading.value = false;
  }
}

function openCreate(): void {
  editing.value = false;
  Object.assign(editor, { name: '', joinCode: '', description: '', enabled: true, version: 0 });
  editorError.value = '';
  editorOpen.value = true;
}

function openEdit(): void {
  const guild = selectedGuild.value;
  if (!guild) return;
  editing.value = true;
  Object.assign(editor, {
    name: guild.name,
    joinCode: guild.join_code,
    description: guild.description,
    enabled: guild.enabled,
    version: guild.version,
  });
  editorError.value = '';
  editorOpen.value = true;
}

async function saveGuild(): Promise<void> {
  if (editorBusy.value) return;
  if (!editor.name.trim() || !editor.joinCode.trim()) {
    editorError.value = '行会名称和加入码不能为空。';
    return;
  }
  editorBusy.value = true;
  editorError.value = '';
  const current = selectedGuild.value;
  try {
    const record = await adminSession.api().request<GuildRecord>(
      editing.value && current
        ? `/admin/v1/guilds/${encodeURIComponent(current.guild_id)}`
        : '/admin/v1/guilds',
      {
        method: editing.value ? 'PATCH' : 'POST',
        body: {
          ...(editing.value ? { version: editor.version } : {}),
          name: editor.name.trim(),
          join_code: editor.joinCode.trim(),
          description: editor.description.trim(),
          enabled: editor.enabled,
        },
      },
    );
    const index = guilds.value.findIndex(guild => guild.guild_id === record.guild_id);
    if (index >= 0) guilds.value[index] = record;
    else guilds.value.unshift(record);
    selectedGuildId.value = record.guild_id;
    editorOpen.value = false;
  } catch (reason) {
    editorError.value = guildErrorText(reason, '行会保存失败');
  } finally {
    editorBusy.value = false;
  }
}

async function disableGuild(): Promise<void> {
  const guild = selectedGuild.value;
  if (!guild || disableBusy.value) return;
  disableBusy.value = true;
  try {
    const updated = await adminSession.api().request<GuildRecord>(
      `/admin/v1/guilds/${encodeURIComponent(guild.guild_id)}`,
      { method: 'PATCH', body: { version: guild.version, enabled: false } },
    );
    const index = guilds.value.findIndex(item => item.guild_id === updated.guild_id);
    if (index >= 0) guilds.value[index] = updated;
    disableOpen.value = false;
  } catch (reason) {
    memberError.value = guildErrorText(reason, '行会停用失败');
    disableOpen.value = false;
  } finally {
    disableBusy.value = false;
  }
}

async function addMember(): Promise<void> {
  const guild = selectedGuild.value;
  if (!guild || !guild.enabled || memberBusy.value) return;
  memberBusy.value = true;
  memberError.value = '';
  try {
    await adminSession.api().request<GuildMember>(
      `/admin/v1/guilds/${encodeURIComponent(guild.guild_id)}/members/${encodeURIComponent(memberForm.userId.trim())}`,
      { method: 'PUT', body: { role: memberForm.role } },
    );
    memberForm.userId = '';
    memberForm.role = 'member';
    await Promise.all([loadMembers(), loadGuilds()]);
  } catch (reason) {
    memberError.value = guildErrorText(reason, '添加成员失败');
  } finally {
    memberBusy.value = false;
  }
}

async function removeMember(): Promise<void> {
  const guild = selectedGuild.value;
  const member = removeTarget.value;
  if (!guild || !member || memberBusy.value) return;
  memberBusy.value = true;
  memberError.value = '';
  try {
    await adminSession.api().request<{ removed: boolean }>(
      `/admin/v1/guilds/${encodeURIComponent(guild.guild_id)}/members/${encodeURIComponent(member.user_id)}`,
      { method: 'DELETE' },
    );
    removeTarget.value = null;
    await Promise.all([loadMembers(), loadGuilds()]);
  } catch (reason) {
    memberError.value = guildErrorText(reason, '移除成员失败');
  } finally {
    memberBusy.value = false;
  }
}

watch(selectedGuildId, () => void loadMembers());
onMounted(() => void loadGuilds());

function errorText(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

function guildErrorText(reason: unknown, fallback: string): string {
  if (!(reason instanceof ApiError)) return errorText(reason, fallback);
  const messages: Record<string, string> = {
    guild_version_conflict: '行会已被其他管理员更新，请刷新后再操作。',
    guild_name_conflict: '行会名称已被使用，请更换名称。',
    guild_join_code_conflict: '加入码已被使用，请更换加入码。',
    user_already_in_guild: '该用户已加入其他行会，不能重复归属。',
    guild_disabled: '行会已停用，请先重新启用行会。',
  };
  return messages[reason.message] ?? reason.message ?? fallback;
}
</script>

<template>
  <section>
    <PageHeader title="行会管理" description="行会是跨局长期组织；按局阵营分组是单场玩法状态，两者互不替代。">
      <button class="button button-secondary" type="button" :disabled="loading" @click="loadGuilds">刷新</button>
      <button class="button button-primary" type="button" @click="openCreate">新建行会</button>
    </PageHeader>
    <div class="notice-banner compact">
      <strong>职责边界</strong>
      <span>此页维护长期行会、加入码和负责人。需要阵营玩法时，玩家的“本局分组”仍应通过独立按局分组接口处理。</span>
    </div>

    <AsyncState :loading="loading" :error="error" :empty="!guilds.length" empty-text="尚未创建行会。" @retry="loadGuilds">
      <div class="master-detail">
        <aside class="master-list" aria-label="行会列表">
          <button
            v-for="guild in guilds"
            :key="guild.guild_id"
            class="master-item"
            :class="{ active: guild.guild_id === selectedGuildId }"
            type="button"
            @click="selectedGuildId = guild.guild_id"
          >
            <span><strong>{{ guild.name }}</strong><small class="mono">加入码 {{ guild.join_code }}</small></span>
            <span class="status-pill" :class="guild.enabled ? 'status-success' : 'status-muted'">{{ guild.enabled ? `${guild.member_count} 人` : '已停用' }}</span>
          </button>
        </aside>

        <div v-if="selectedGuild" class="detail-panel">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">行会详情</p>
              <h2>{{ selectedGuild.name }}</h2>
              <p class="muted">{{ selectedGuild.description || '暂无简介' }}</p>
            </div>
            <div class="inline-actions">
              <button class="button button-secondary" type="button" @click="openEdit">编辑</button>
              <button v-if="selectedGuild.enabled" class="button button-danger" type="button" @click="disableOpen = true">停用</button>
            </div>
          </div>
          <dl class="detail-grid">
            <div><dt>加入码</dt><dd class="mono">{{ selectedGuild.join_code }}</dd></div>
            <div><dt>版本</dt><dd>v{{ selectedGuild.version }}</dd></div>
            <div><dt>成员数</dt><dd>{{ selectedGuild.member_count }}</dd></div>
            <div><dt>更新时间</dt><dd>{{ formatDateTime(selectedGuild.updated_at) }}</dd></div>
          </dl>

          <div class="section-heading"><div><h3>成员列表</h3><p>负责人使用 manager 角色；一个用户只能归属一个行会。</p></div></div>
          <p v-if="!selectedGuild.enabled" class="alert alert-warning">行会已停用，不能新增成员或分配负责人；仍可移除现有成员。</p>
          <form class="inline-form" @submit.prevent="addMember">
            <label class="field grow"><span>用户 ID</span><input v-model="memberForm.userId" :disabled="!selectedGuild.enabled" required spellcheck="false" placeholder="输入已有平台用户 ID" /></label>
            <label class="field"><span>角色</span><select v-model="memberForm.role" :disabled="!selectedGuild.enabled"><option value="member">成员</option><option value="manager">负责人</option></select></label>
            <button class="button button-primary align-end" type="submit" :disabled="memberBusy || !selectedGuild.enabled">{{ memberBusy ? '处理中…' : '添加成员' }}</button>
          </form>
          <p v-if="memberError" class="form-error" role="alert">{{ memberError }}</p>
          <AsyncState :loading="memberLoading" :empty="!members.length" empty-text="该行会尚无成员。">
            <div class="member-list">
              <article v-for="member in members" :key="member.user_id" class="member-item">
                <UserIdentity :name="member.nickname" :user-id="member.user_id" :avatar-url="member.avatar_url" />
                <span class="status-pill">{{ member.role === 'manager' ? '负责人' : '成员' }}</span>
                <time>{{ formatDateTime(member.joined_at) }}</time>
                <button class="button button-small button-danger" type="button" @click="removeTarget = member">移除</button>
              </article>
            </div>
          </AsyncState>
        </div>
      </div>
    </AsyncState>

    <ConfirmDialog :open="editorOpen" :title="editing ? '编辑行会' : '新建行会'" :busy="editorBusy" confirm-text="保存" @cancel="editorOpen = false" @confirm="saveGuild">
      <form class="form-stack" @submit.prevent="saveGuild">
        <label class="field"><span>行会名称</span><input v-model="editor.name" required maxlength="100" /></label>
        <label class="field"><span>加入码</span><input v-model="editor.joinCode" required maxlength="64" spellcheck="false" /></label>
        <label class="field"><span>简介</span><textarea v-model="editor.description" rows="3" maxlength="500" /></label>
        <label class="check-field"><input v-model="editor.enabled" type="checkbox" /><span>启用行会</span></label>
        <p v-if="editorError" class="form-error" role="alert">{{ editorError }}</p>
      </form>
    </ConfirmDialog>

    <ConfirmDialog :open="disableOpen" title="确认停用该行会？" :busy="disableBusy" danger confirm-text="确认停用" @cancel="disableOpen = false" @confirm="disableGuild">
      <p>停用后保留历史和成员关系，但不再作为可加入行会。需要恢复时可在编辑窗口重新启用。</p>
    </ConfirmDialog>

    <ConfirmDialog :open="Boolean(removeTarget)" title="确认移除成员？" :busy="memberBusy" danger confirm-text="确认移除" @cancel="removeTarget = null" @confirm="removeMember">
      <p v-if="removeTarget">将从 {{ selectedGuild?.name }} 移除 {{ removeTarget.nickname }}（{{ removeTarget.user_id }}）。</p>
    </ConfirmDialog>
  </section>
</template>
