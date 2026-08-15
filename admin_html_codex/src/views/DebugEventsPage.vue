<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import PageHeader from '@/components/PageHeader.vue';
import { adminSession } from '@/services/session';
import { formatDateTime, makeEventId } from '@/utils/format';
import { giftEventFields } from '@/utils/gifts';

type DebugEventType = 'gift' | 'comment' | 'like';

interface DebugResult {
  accepted: number;
  duplicates: number;
  event_ids: string[];
}

interface DebugLog extends DebugResult {
  type: DebugEventType;
  createdAt: string;
}

const giftCatalog = computed(() => adminSession.state.context?.gift_catalog ?? []);
const sending = ref(false);
const error = ref('');
const logs = ref<DebugLog[]>([]);
const form = reactive({
  type: 'gift' as DebugEventType,
  eventId: makeEventId('debug'),
  roomId: '99995',
  userId: 'debug-user-1',
  nickname: '调试玩家',
  avatarUrl: '',
  giftId: giftCatalog.value[0]?.id ?? '',
  count: 1,
  content: '666',
});
const selectedGift = computed(() => giftCatalog.value.find(gift => gift.id === form.giftId));

watch(giftCatalog, catalog => {
  if (!catalog.some(gift => gift.id === form.giftId)) {
    form.giftId = catalog[0]?.id ?? '';
  }
}, { immediate: true });

async function send(): Promise<void> {
  if (sending.value) return;
  sending.value = true;
  error.value = '';
  try {
    const common = {
      type: form.type,
      event_id: form.eventId.trim(),
      roomid: form.roomId.trim(),
      user_id: form.userId.trim(),
      nickname: form.nickname.trim(),
      avatar_url: form.avatarUrl.trim() || undefined,
    };
    const specific = form.type === 'gift'
      ? {
          ...(selectedGift.value ? giftEventFields(selectedGift.value, Number(form.count)) : {}),
        }
      : form.type === 'like'
        ? { count: Number(form.count) }
        : { content: form.content.trim() || '666' };
    const result = await adminSession.api().request<DebugResult>('/admin/v1/debug-events', {
      method: 'POST',
      body: { ...common, ...specific },
    });
    logs.value.unshift({ ...result, type: form.type, createdAt: new Date().toISOString() });
    logs.value = logs.value.slice(0, 20);
    form.eventId = makeEventId('debug');
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '调试事件发送失败';
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <section>
    <PageHeader title="测试礼物与互动" description="仅 Mock 环境显示。事件进入与正式平台回调相同的 Redis 队列。">
      <span class="environment-badge mock">Mock only</span>
    </PageHeader>
    <div class="split-layout debug-layout">
      <form class="panel form-stack" @submit.prevent="send">
        <div class="segmented-control" aria-label="事件类型">
          <label><input v-model="form.type" type="radio" value="gift" /><span>礼物</span></label>
          <label><input v-model="form.type" type="radio" value="comment" /><span>评论</span></label>
          <label><input v-model="form.type" type="radio" value="like" /><span>点赞</span></label>
        </div>
        <label class="field"><span>Event ID</span><input v-model="form.eventId" required maxlength="256" spellcheck="false" /></label>
        <div class="form-grid">
          <label class="field"><span>房间 ID</span><input v-model="form.roomId" required maxlength="128" spellcheck="false" /></label>
          <label class="field"><span>用户 ID</span><input v-model="form.userId" required maxlength="128" spellcheck="false" /></label>
        </div>
        <div class="form-grid">
          <label class="field"><span>昵称</span><input v-model="form.nickname" required maxlength="200" /></label>
          <label class="field"><span>头像 URL（可选）</span><input v-model="form.avatarUrl" type="url" maxlength="2048" /></label>
        </div>
        <template v-if="form.type === 'gift'">
          <label class="field">
            <span>稳定 Gift ID</span>
            <select v-model="form.giftId" required>
              <option v-for="gift in giftCatalog" :key="gift.id" :value="gift.id">{{ gift.name }} · {{ gift.value }} 抖 · {{ gift.id }}</option>
            </select>
          </label>
          <label class="field"><span>份数</span><input v-model.number="form.count" type="number" min="1" max="10000" required /></label>
        </template>
        <label v-else-if="form.type === 'comment'" class="field"><span>评论内容</span><textarea v-model="form.content" rows="3" maxlength="2000" required /></label>
        <label v-else class="field"><span>点赞数</span><input v-model.number="form.count" type="number" min="1" max="1000000" required /></label>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <button class="button button-primary button-block" type="submit" :disabled="sending">
          {{ sending ? '正在发送…' : `发送${form.type === 'gift' ? '礼物' : form.type === 'comment' ? '评论' : '点赞'}事件` }}
        </button>
      </form>

      <div class="panel panel-wide">
        <div class="panel-heading"><div><p class="eyebrow">当前标签页</p><h2>发送记录</h2></div><button class="button button-small button-secondary" type="button" :disabled="!logs.length" @click="logs = []">清空</button></div>
        <div v-if="!logs.length" class="state-card"><strong>尚未发送</strong><span>成功和去重结果会显示在这里。</span></div>
        <div v-else class="record-list">
          <article v-for="log in logs" :key="`${log.createdAt}-${log.event_ids[0]}`" class="record-item compact-record">
            <div><strong>{{ log.type }}</strong><span>接收 {{ log.accepted }} · 去重 {{ log.duplicates }}</span></div>
            <time>{{ formatDateTime(log.createdAt) }}</time>
            <small v-for="eventId in log.event_ids" :key="eventId" class="mono">{{ eventId }}</small>
          </article>
        </div>
      </div>
    </div>
  </section>
</template>
