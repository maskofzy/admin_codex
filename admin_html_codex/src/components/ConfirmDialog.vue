<script setup lang="ts">
const props = defineProps<{
  open: boolean;
  title: string;
  confirmText?: string;
  busy?: boolean;
  danger?: boolean;
}>();

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();

function cancel(): void {
  if (!props.busy) emit('cancel');
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="dialog-backdrop" @click.self="cancel">
      <section class="dialog-card" role="alertdialog" aria-modal="true" :aria-label="title">
        <h2>{{ title }}</h2>
        <div class="dialog-content">
          <slot />
        </div>
        <div class="dialog-actions">
          <button class="button button-secondary" type="button" :disabled="busy" @click="cancel">
            取消
          </button>
          <button
            class="button"
            :class="danger ? 'button-danger' : 'button-primary'"
            type="button"
            :disabled="busy"
            @click="$emit('confirm')"
          >
            {{ busy ? '处理中…' : (confirmText || '确认') }}
          </button>
        </div>
      </section>
    </div>
  </Teleport>
</template>
