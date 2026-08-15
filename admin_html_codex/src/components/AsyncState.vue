<script setup lang="ts">
defineProps<{
  loading?: boolean;
  error?: string;
  empty?: boolean;
  emptyText?: string;
}>();

defineEmits<{
  retry: [];
}>();
</script>

<template>
  <div v-if="loading" class="state-card" role="status" aria-live="polite">
    <span class="spinner" aria-hidden="true" />
    <span>正在加载…</span>
  </div>
  <div v-else-if="error" class="state-card state-error" role="alert">
    <strong>加载失败</strong>
    <span>{{ error }}</span>
    <button class="button button-secondary" type="button" @click="$emit('retry')">重试</button>
  </div>
  <div v-else-if="empty" class="state-card">
    <strong>暂无数据</strong>
    <span>{{ emptyText || '当前条件下没有可显示的记录。' }}</span>
  </div>
  <slot v-else />
</template>
