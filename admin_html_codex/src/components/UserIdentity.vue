<script setup lang="ts">
import { ref } from 'vue';
import { avatarFallback } from '@/utils/format';

defineProps<{
  name: string;
  userId?: string;
  avatarUrl?: string;
}>();

const imageFailed = ref(false);
</script>

<template>
  <div class="user-identity">
    <img
      v-if="avatarUrl && !imageFailed"
      class="avatar"
      :src="avatarUrl"
      alt=""
      referrerpolicy="no-referrer"
      @error="imageFailed = true"
    />
    <span v-else class="avatar avatar-fallback" aria-hidden="true">{{ avatarFallback(name) }}</span>
    <span class="user-copy">
      <strong>{{ name || '未命名用户' }}</strong>
      <small v-if="userId" class="mono">{{ userId }}</small>
    </span>
  </div>
</template>
