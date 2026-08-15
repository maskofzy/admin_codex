<script setup lang="ts">
import { computed } from 'vue';
import type { TowerMonsterEditor } from '@/utils/towerConfig';
import {
  monsterCatalogItem,
  TOWER_MONSTER_CATALOG,
  TOWER_MONSTER_FIELDS,
} from '@/utils/towerConfig';

const props = withDefaults(defineProps<{
  monster: TowerMonsterEditor;
  index: number;
  removable?: boolean;
}>(), {
  removable: true,
});

defineEmits<{
  remove: [];
}>();

const catalogItem = computed(() => monsterCatalogItem(props.monster.fields.d1.value));
</script>

<template>
  <article class="tower-monster-editor">
    <header class="tower-monster-heading">
      <div class="tower-monster-identity">
        <img
          v-if="catalogItem"
          :src="catalogItem.imageUrl"
          :alt="catalogItem.name"
          width="54"
          height="54"
        />
        <span v-else class="tower-monster-placeholder">?</span>
        <div>
          <strong>怪物 {{ index + 1 }}</strong>
          <small>{{ catalogItem ? `#${catalogItem.id} · ${catalogItem.name}` : '请选择怪物 ID' }}</small>
        </div>
      </div>
      <button
        v-if="removable"
        class="button button-small button-danger"
        type="button"
        @click="$emit('remove')"
      >
        移除
      </button>
    </header>

    <div class="tower-monster-primary-fields">
      <label class="field">
        <span>d1 · 怪物</span>
        <select v-model="monster.fields.d1.value">
          <option v-for="item in TOWER_MONSTER_CATALOG" :key="item.id" :value="String(item.id)">
            {{ item.id }} · {{ item.name }}
          </option>
        </select>
      </label>
      <label class="field">
        <span>d2 · 类型</span>
        <select v-model="monster.fields.d2.value">
          <option value="1">1 · 普通</option>
          <option value="2">2 · 精英</option>
          <option value="3">3 · Boss</option>
        </select>
      </label>
    </div>

    <div class="tower-monster-field-grid">
      <label v-for="[key, label] in TOWER_MONSTER_FIELDS" :key="key" class="field">
        <span>{{ key }} · {{ label }}</span>
        <input
          v-model="monster.fields[key].value"
          inputmode="decimal"
          :placeholder="monster.fields[key].originalType === 'missing' ? '未设置' : ''"
        />
      </label>
    </div>
  </article>
</template>
