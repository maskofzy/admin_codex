<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import AsyncState from '@/components/AsyncState.vue';
import PageHeader from '@/components/PageHeader.vue';
import TowerMonsterEditor from '@/components/TowerMonsterEditor.vue';
import { ApiError } from '@/services/api';
import { adminSession } from '@/services/session';
import type { TowerAnchor, TowerConfigDocument, TowerRecovery } from '@/types/tower';
import { formatDateTime } from '@/utils/format';
import {
  addTowerLevel,
  addTowerListValue,
  addTowerMonster,
  createTowerMainEditor,
  createTowerRecoveryEditor,
  createTowerWelfareEditor,
  parseTowerAnchors,
  parseTowerConfigDocument,
  parseTowerMainImport,
  parseTowerConfigRecord,
  parseTowerRecoveries,
  serializeTowerMainEditor,
  serializeTowerRecoveryEditor,
  serializeTowerWelfareEditor,
  TOWER_MONSTER_CATALOG,
  type TowerLevelEditor,
  type TowerMainEditor,
  type TowerRecoveryEditor,
  type TowerValueListEditor,
  type TowerValueListKey,
  type TowerWelfareEditor,
} from '@/utils/towerConfig';

type TowerTab =
  | 'basic'
  | 'levels'
  | 'population'
  | 'level-experience'
  | 'experience-welfare'
  | 'recoveries'
  | 'catalog';

const tabs: Array<{ id: TowerTab; label: string }> = [
  { id: 'basic', label: '基础参数' },
  { id: 'levels', label: '关卡/怪物' },
  { id: 'population', label: '人数系数' },
  { id: 'level-experience', label: '等级经验' },
  { id: 'experience-welfare', label: '经验 Boss/福利怪' },
  { id: 'recoveries', label: '主播跳关' },
  { id: 'catalog', label: '怪物图鉴' },
];

const EXP_BASIC_KEYS = new Set(['expOefficient', 'bossPercentExp', 'expPriceFactor']);
const LEVEL_PAGE_SIZE = 10;
const LIST_PAGE_SIZE = 20;
const WELFARE_PAGE_SIZE = 10;

const activeTab = ref<TowerTab>('basic');
const document = ref<TowerConfigDocument | null>(null);
const mainEditor = ref<TowerMainEditor | null>(null);
const welfareEditor = ref<TowerWelfareEditor | null>(null);
const mainRemark = ref('');
const loading = ref(true);
const loadError = ref('');
const mainBusy = ref(false);
const welfareBusy = ref(false);
const mainMessage = ref('');
const mainError = ref('');
const importInput = ref<HTMLInputElement | null>(null);
const importedFileName = ref('');
const welfareMessage = ref('');
const welfareError = ref('');

const levelPage = ref(1);
const welfarePage = ref(1);
const listPages = reactive<Record<TowerValueListKey, number>>({
  healthParams: 1,
  countParams: 1,
  speedParams: 1,
  attackParams: 1,
  level2Exp: 1,
});

const anchorQuery = ref('');
const anchors = ref<TowerAnchor[]>([]);
const anchorLoading = ref(false);
const anchorError = ref('');
const selectedAnchor = ref<TowerAnchor | null>(null);
const recoveryEditor = ref<TowerRecoveryEditor>(createTowerRecoveryEditor());
const recoveries = ref<TowerRecovery[]>([]);
const recoveryLoading = ref(false);
const recoveryError = ref('');
const recoveryBusy = ref(false);
const recoveryMessage = ref('');

const generalBasicFields = computed(() => mainEditor.value?.basic
  .filter(field => !EXP_BASIC_KEYS.has(field.key)) ?? []);
const experienceFields = computed(() => mainEditor.value?.basic
  .filter(field => EXP_BASIC_KEYS.has(field.key)) ?? []);
const levelPageCount = computed(() => Math.max(
  1,
  Math.ceil((mainEditor.value?.levels.length ?? 0) / LEVEL_PAGE_SIZE),
));
const currentLevels = computed(() => {
  const levels = mainEditor.value?.levels ?? [];
  const page = Math.min(levelPage.value, levelPageCount.value);
  const start = (page - 1) * LEVEL_PAGE_SIZE;
  return levels.slice(start, start + LEVEL_PAGE_SIZE).map((level, offset) => ({
    level,
    index: start + offset,
  }));
});
const welfarePageCount = computed(() => Math.max(
  1,
  Math.ceil((welfareEditor.value?.monsters.length ?? 0) / WELFARE_PAGE_SIZE),
));
const currentWelfareMonsters = computed(() => {
  const monsters = welfareEditor.value?.monsters ?? [];
  const page = Math.min(welfarePage.value, welfarePageCount.value);
  const start = (page - 1) * WELFARE_PAGE_SIZE;
  return monsters.slice(start, start + WELFARE_PAGE_SIZE).map((monster, offset) => ({
    monster,
    index: start + offset,
  }));
});
const selectedAnchorRecovery = computed(() => selectedAnchor.value
  ? recoveries.value.find(item => item.open_uid === selectedAnchor.value?.open_uid && !item.is_used) ?? null
  : null);

async function loadConfig(): Promise<boolean> {
  loading.value = true;
  loadError.value = '';
  mainError.value = '';
  mainMessage.value = '';
  welfareMessage.value = '';
  try {
    const value = await adminSession.api().request<unknown>('/admin/v1/tower-config');
    const parsed = parseTowerConfigDocument(value);
    document.value = parsed;
    mainEditor.value = createTowerMainEditor(parsed.main.config);
    welfareEditor.value = parsed.welfare ? createTowerWelfareEditor(parsed.welfare.config) : null;
    importedFileName.value = '';
    mainRemark.value = parsed.main.remark;
    levelPage.value = 1;
    welfarePage.value = 1;
    for (const key of Object.keys(listPages) as TowerValueListKey[]) listPages[key] = 1;
    return true;
  } catch (reason) {
    loadError.value = errorText(reason, '塔防配置加载失败');
    return false;
  } finally {
    loading.value = false;
  }
}

async function saveMain(): Promise<void> {
  const currentDocument = document.value;
  const record = currentDocument?.main;
  const editor = mainEditor.value;
  if (!currentDocument || !record || !editor || !editor.editable || loading.value || mainBusy.value) return;
  mainBusy.value = true;
  mainError.value = '';
  mainMessage.value = '';
  try {
    const value = await adminSession.api().request<unknown>('/admin/v1/tower-config/main', {
      method: 'PUT',
      body: {
        expected_revision: record.revision,
        config: serializeTowerMainEditor(editor),
        remark: mainRemark.value.trim(),
      },
    });
    const updated = parseTowerConfigRecord(value, 'main');
    document.value = { ...currentDocument, main: updated };
    mainEditor.value = createTowerMainEditor(updated.config);
    importedFileName.value = '';
    mainRemark.value = updated.remark;
    levelPage.value = Math.min(levelPage.value, levelPageCount.value);
    mainMessage.value = '主配置已保存，并刷新了服务端 revision。';
  } catch (reason) {
    mainError.value = towerSaveError(reason, '主配置保存失败');
  } finally {
    mainBusy.value = false;
  }
}

function chooseMainImport(): void {
  importInput.value?.click();
}

async function importMain(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file || mainBusy.value) return;
  mainError.value = '';
  mainMessage.value = '';
  try {
    mainEditor.value = parseTowerMainImport(JSON.parse(await file.text()) as unknown);
    importedFileName.value = file.name;
    mainRemark.value = `导入 ${file.name}`.slice(0, 255);
    levelPage.value = 1;
    for (const key of Object.keys(listPages) as TowerValueListKey[]) listPages[key] = 1;
    mainMessage.value = `已导入 ${file.name} 为未保存草稿；确认内容后点击“保存主配置”才会写入数据库。`;
  } catch (reason) {
    importedFileName.value = '';
    mainError.value = errorText(reason, '主配置 JSON 导入失败');
  }
}

async function saveWelfare(): Promise<void> {
  const currentDocument = document.value;
  const record = currentDocument?.welfare;
  const editor = welfareEditor.value;
  if (!currentDocument || !record || !editor || !editor.editable || welfareBusy.value) return;
  welfareBusy.value = true;
  welfareError.value = '';
  welfareMessage.value = '';
  try {
    const value = await adminSession.api().request<unknown>('/admin/v1/tower-config/welfare', {
      method: 'PUT',
      body: {
        expected_revision: record.revision,
        config: serializeTowerWelfareEditor(editor),
      },
    });
    const updated = parseTowerConfigRecord(value, 'welfare');
    document.value = { ...currentDocument, welfare: updated };
    welfareEditor.value = createTowerWelfareEditor(updated.config);
    welfarePage.value = Math.min(welfarePage.value, welfarePageCount.value);
    welfareMessage.value = '福利怪配置已保存，并刷新了服务端 revision。';
  } catch (reason) {
    welfareError.value = towerSaveError(reason, '福利怪配置保存失败');
  } finally {
    welfareBusy.value = false;
  }
}

function addLevel(): void {
  const editor = mainEditor.value;
  if (!editor) return;
  addTowerLevel(editor);
  levelPage.value = Math.ceil(editor.levels.length / LEVEL_PAGE_SIZE);
}

function removeLevel(index: number): void {
  const editor = mainEditor.value;
  if (!editor) return;
  editor.levels.splice(index, 1);
  levelPage.value = Math.min(levelPage.value, levelPageCount.value);
}

function addLevelMonster(level: TowerLevelEditor): void {
  addTowerMonster(level);
}

function listPageCount(list: TowerValueListEditor): number {
  return Math.max(1, Math.ceil(list.values.length / LIST_PAGE_SIZE));
}

function pagedListValues(list: TowerValueListEditor): Array<{ index: number; value: TowerValueListEditor['values'][number] }> {
  const page = Math.min(listPages[list.key], listPageCount(list));
  const start = (page - 1) * LIST_PAGE_SIZE;
  return list.values.slice(start, start + LIST_PAGE_SIZE).map((value, offset) => ({
    index: start + offset,
    value,
  }));
}

function setListPage(list: TowerValueListEditor, page: number): void {
  listPages[list.key] = Math.max(1, Math.min(page, listPageCount(list)));
}

function appendListValue(list: TowerValueListEditor): void {
  addTowerListValue(list);
  setListPage(list, listPageCount(list));
}

function removeListValue(list: TowerValueListEditor, index: number): void {
  list.values.splice(index, 1);
  setListPage(list, listPages[list.key]);
}

function addWelfareMonster(): void {
  const editor = welfareEditor.value;
  if (!editor) return;
  addTowerMonster(editor);
  welfarePage.value = Math.ceil(editor.monsters.length / WELFARE_PAGE_SIZE);
}

function removeWelfareMonster(index: number): void {
  const editor = welfareEditor.value;
  if (!editor) return;
  editor.monsters.splice(index, 1);
  welfarePage.value = Math.min(welfarePage.value, welfarePageCount.value);
}

async function searchAnchors(): Promise<void> {
  if (anchorLoading.value) return;
  anchorLoading.value = true;
  anchorError.value = '';
  try {
    const value = await adminSession.api().request<unknown>('/admin/v1/tower-config/anchors', {
      query: { q: anchorQuery.value.trim(), limit: 30 },
    });
    anchors.value = parseTowerAnchors(value);
  } catch (reason) {
    anchorError.value = errorText(reason, '主播搜索失败');
  } finally {
    anchorLoading.value = false;
  }
}

async function loadRecoveries(): Promise<void> {
  if (recoveryLoading.value) return;
  recoveryLoading.value = true;
  recoveryError.value = '';
  try {
    const value = await adminSession.api().request<unknown>('/admin/v1/tower-config/recoveries', {
      query: { unused_only: true },
    });
    recoveries.value = parseTowerRecoveries(value);
  } catch (reason) {
    recoveryError.value = errorText(reason, '跳关记录加载失败');
  } finally {
    recoveryLoading.value = false;
  }
}

function selectAnchor(anchor: TowerAnchor): void {
  selectedAnchor.value = anchor;
  const existing = recoveries.value.find(item => item.open_uid === anchor.open_uid && !item.is_used);
  recoveryEditor.value = existing
    ? createTowerRecoveryEditor(existing.config)
    : createTowerRecoveryEditor();
  recoveryMessage.value = '';
  recoveryError.value = '';
}

async function createRecovery(): Promise<void> {
  const anchor = selectedAnchor.value;
  if (!anchor || recoveryBusy.value) return;
  recoveryBusy.value = true;
  recoveryError.value = '';
  recoveryMessage.value = '';
  try {
    await adminSession.api().request<unknown>('/admin/v1/tower-config/recoveries', {
      method: 'POST',
      body: {
        open_uid: anchor.open_uid,
        config: serializeTowerRecoveryEditor(recoveryEditor.value),
      },
    });
    await loadRecoveries();
    recoveryMessage.value = `已为 ${anchor.nickname} 创建未消费跳关记录。`;
  } catch (reason) {
    recoveryError.value = recoverySaveError(reason);
  } finally {
    recoveryBusy.value = false;
  }
}

function shortRevision(value: string): string {
  return `${value.slice(0, 8)}…${value.slice(-8)}`;
}

function errorText(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

function towerSaveError(reason: unknown, fallback: string): string {
  if (reason instanceof ApiError && (reason.status === 409 || reason.message === 'tower_config_conflict')) {
    return '配置已被其他人修改，请重新加载后再编辑。';
  }
  return errorText(reason, fallback);
}

function recoverySaveError(reason: unknown): string {
  if (reason instanceof ApiError && reason.message === 'tower_recovery_exists') {
    return '该主播已有未消费跳关记录，请等待客户端消费或先核对现有记录。';
  }
  return errorText(reason, '跳关记录创建失败');
}

onMounted(() => {
  void loadConfig();
  void loadRecoveries();
});
</script>

<template>
  <section class="tower-config-page">
    <PageHeader title="塔防配置" description="仅编辑已验证的 compact ld*/d* 字段；服务端 revision 用于 CAS 冲突保护。">
      <input ref="importInput" class="visually-hidden" type="file" accept="application/json,.json" @change="importMain" />
      <button class="button button-secondary" type="button" :disabled="loading || mainBusy || welfareBusy" @click="loadConfig">重新加载</button>
      <button class="button button-secondary" type="button" :disabled="loading || !document || mainBusy" @click="chooseMainImport">导入主配置 JSON</button>
      <button
        v-if="mainEditor?.editable && activeTab !== 'recoveries' && activeTab !== 'catalog'"
        class="button button-primary"
        type="button"
        :disabled="loading || mainBusy"
        @click="saveMain"
      >
        {{ mainBusy ? '保存中…' : '保存主配置' }}
      </button>
    </PageHeader>

    <nav class="tower-tabs" role="tablist" aria-label="塔防配置分类">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        role="tab"
        :aria-selected="activeTab === tab.id"
        :class="{ active: activeTab === tab.id }"
        @click="activeTab = tab.id"
      >
        {{ tab.label }}
      </button>
    </nav>

    <AsyncState :loading="loading" :error="loadError" :empty="!document || !mainEditor" @retry="loadConfig">
      <template v-if="document && mainEditor">
        <div class="tower-record-strip">
          <div><span>主配置 ID</span><strong class="mono">{{ document.main.id }}</strong></div>
          <div><span>旧表 Version</span><strong>{{ document.main.version || '—' }}</strong></div>
          <div><span>Revision</span><strong class="mono" :title="document.main.revision">{{ shortRevision(document.main.revision) }}</strong></div>
          <div><span>模式</span><strong>{{ mainEditor.editable ? 'compact · 可编辑' : 'expanded · 只读' }}</strong></div>
          <div v-if="importedFileName"><span>草稿来源</span><strong :title="importedFileName">{{ importedFileName }}</strong></div>
        </div>

        <p v-if="mainEditor.warning" class="alert alert-warning" role="alert">{{ mainEditor.warning }}</p>
        <p v-if="mainMessage" class="alert alert-success" role="status">{{ mainMessage }}</p>
        <p v-if="mainError" class="form-error" role="alert">{{ mainError }}</p>

        <section
          v-if="!mainEditor.editable && activeTab !== 'recoveries' && activeTab !== 'catalog' && activeTab !== 'experience-welfare'"
          class="panel tower-readonly-panel"
        >
          <div class="panel-heading">
            <div><p class="eyebrow">安全只读</p><h2>原始配置 JSON</h2></div>
          </div>
          <pre class="tower-json-preview">{{ JSON.stringify(mainEditor.source, null, 2) }}</pre>
        </section>

        <section v-else-if="activeTab === 'basic'" class="panel">
          <div class="panel-heading"><div><p class="eyebrow">主配置</p><h2>基础参数</h2></div></div>
          <div class="tower-basic-grid">
            <label v-for="field in generalBasicFields" :key="field.key" class="field">
              <span>{{ field.label }} · {{ field.key }}</span>
              <input v-model="field.value" inputmode="decimal" :placeholder="field.originalType === 'missing' ? '未设置' : ''" />
            </label>
          </div>
          <label class="field tower-remark-field">
            <span>修改备注</span>
            <input v-model="mainRemark" maxlength="255" placeholder="说明本次参数调整" />
          </label>
        </section>

        <section v-else-if="activeTab === 'levels'" class="panel tower-levels-panel">
          <div class="panel-heading">
            <div><p class="eyebrow">monsterConfig</p><h2>关卡与怪物</h2><p class="muted">每页最多渲染 10 关；保存时仍提交完整配置。</p></div>
            <button class="button button-secondary" type="button" @click="addLevel">新增关卡</button>
          </div>
          <div v-if="!mainEditor.levels.length" class="state-card"><strong>暂无关卡</strong><span>可新增第一关。</span></div>
          <div v-else class="tower-level-list">
            <article v-for="entry in currentLevels" :key="entry.level.editorId" class="tower-level-card">
              <header class="tower-level-heading">
                <div><p class="eyebrow">第 {{ entry.index + 1 }} 项</p><h3>关卡 {{ entry.level.level.value || '未设置' }}</h3></div>
                <div class="inline-actions">
                  <button class="button button-small button-secondary" type="button" @click="addLevelMonster(entry.level)">新增怪物</button>
                  <button class="button button-small button-danger" type="button" @click="removeLevel(entry.index)">移除关卡</button>
                </div>
              </header>
              <div class="tower-level-fields">
                <label class="field tower-level-prompt"><span>ld1 · 提示</span><input v-model="entry.level.prompt" /></label>
                <label class="field"><span>ld2 · 奖励方案 0–4</span><input v-model="entry.level.reward.value" inputmode="numeric" /></label>
                <label class="field"><span>ld3 · 关卡号</span><input v-model="entry.level.level.value" inputmode="numeric" /></label>
              </div>
              <div class="tower-monster-list">
                <TowerMonsterEditor
                  v-for="(monster, monsterIndex) in entry.level.monsters"
                  :key="monster.editorId"
                  :monster="monster"
                  :index="monsterIndex"
                  @remove="entry.level.monsters.splice(monsterIndex, 1)"
                />
              </div>
            </article>
          </div>
          <div v-if="mainEditor.levels.length" class="tower-pagination">
            <button class="button button-small button-secondary" type="button" :disabled="levelPage <= 1" @click="levelPage -= 1">上一页</button>
            <span>第 {{ levelPage }} / {{ levelPageCount }} 页 · 共 {{ mainEditor.levels.length }} 关</span>
            <button class="button button-small button-secondary" type="button" :disabled="levelPage >= levelPageCount" @click="levelPage += 1">下一页</button>
          </div>
        </section>

        <section v-else-if="activeTab === 'population'" class="tower-list-stack">
          <article v-for="list in mainEditor.population" :key="list.key" class="panel tower-value-panel">
            <div class="panel-heading">
              <div><p class="eyebrow">{{ list.key }}</p><h2>{{ list.label }}</h2></div>
              <button class="button button-small button-secondary" type="button" @click="appendListValue(list)">新增一项</button>
            </div>
            <div v-if="!list.values.length" class="state-card"><strong>暂无系数</strong><span>此字段当前未设置。</span></div>
            <div v-else class="tower-value-table">
              <div class="tower-value-row tower-value-header"><span>{{ list.itemLabel }}</span><span>值</span><span>操作</span></div>
              <div v-for="entry in pagedListValues(list)" :key="entry.index" class="tower-value-row">
                <strong>{{ entry.index + 1 }}</strong>
                <input v-model="entry.value.value" inputmode="decimal" :aria-label="`${list.label}第 ${entry.index + 1} 项`" />
                <button class="button button-small button-danger" type="button" @click="removeListValue(list, entry.index)">移除</button>
              </div>
            </div>
            <div v-if="list.values.length" class="tower-pagination">
              <button class="button button-small button-secondary" type="button" :disabled="listPages[list.key] <= 1" @click="setListPage(list, listPages[list.key] - 1)">上一页</button>
              <span>第 {{ listPages[list.key] }} / {{ listPageCount(list) }} 页 · 共 {{ list.values.length }} 项</span>
              <button class="button button-small button-secondary" type="button" :disabled="listPages[list.key] >= listPageCount(list)" @click="setListPage(list, listPages[list.key] + 1)">下一页</button>
            </div>
          </article>
        </section>

        <section v-else-if="activeTab === 'level-experience'" class="panel tower-value-panel">
          <div class="panel-heading">
            <div><p class="eyebrow">level2Exp</p><h2>等级经验表</h2><p class="muted">每页最多显示 20 级。</p></div>
            <button class="button button-small button-secondary" type="button" @click="appendListValue(mainEditor.levelExperience)">新增等级</button>
          </div>
          <div v-if="!mainEditor.levelExperience.values.length" class="state-card"><strong>暂无经验表</strong><span>此字段当前未设置。</span></div>
          <div v-else class="tower-value-table">
            <div class="tower-value-row tower-value-header"><span>等级</span><span>所需经验</span><span>操作</span></div>
            <div v-for="entry in pagedListValues(mainEditor.levelExperience)" :key="entry.index" class="tower-value-row">
              <strong>{{ entry.index + 1 }}</strong>
              <input v-model="entry.value.value" inputmode="decimal" :aria-label="`第 ${entry.index + 1} 级经验`" />
              <button class="button button-small button-danger" type="button" @click="removeListValue(mainEditor.levelExperience, entry.index)">移除</button>
            </div>
          </div>
          <div v-if="mainEditor.levelExperience.values.length" class="tower-pagination">
            <button class="button button-small button-secondary" type="button" :disabled="listPages.level2Exp <= 1" @click="setListPage(mainEditor.levelExperience, listPages.level2Exp - 1)">上一页</button>
            <span>第 {{ listPages.level2Exp }} / {{ listPageCount(mainEditor.levelExperience) }} 页 · 共 {{ mainEditor.levelExperience.values.length }} 级</span>
            <button class="button button-small button-secondary" type="button" :disabled="listPages.level2Exp >= listPageCount(mainEditor.levelExperience)" @click="setListPage(mainEditor.levelExperience, listPages.level2Exp + 1)">下一页</button>
          </div>
        </section>

        <section v-else-if="activeTab === 'experience-welfare'" class="tower-list-stack">
          <article class="panel">
            <div class="panel-heading"><div><p class="eyebrow">主配置</p><h2>经验与 Boss 参数</h2></div></div>
            <pre v-if="!mainEditor.editable" class="tower-json-preview">{{ JSON.stringify(mainEditor.source, null, 2) }}</pre>
            <div v-else class="tower-basic-grid">
              <label v-for="field in experienceFields" :key="field.key" class="field">
                <span>{{ field.label }} · {{ field.key }}</span>
                <input v-model="field.value" inputmode="decimal" :placeholder="field.originalType === 'missing' ? '未设置' : ''" />
              </label>
            </div>
          </article>

          <article class="panel">
            <div class="panel-heading">
              <div><p class="eyebrow">独立福利配置</p><h2>福利怪</h2><p class="muted">d21 为宝石数量，d22 为千分比概率。</p></div>
              <div class="inline-actions">
                <button v-if="welfareEditor?.editable" class="button button-small button-secondary" type="button" @click="addWelfareMonster">新增福利怪</button>
                <button v-if="welfareEditor?.editable" class="button button-small button-primary" type="button" :disabled="welfareBusy" @click="saveWelfare">{{ welfareBusy ? '保存中…' : '保存福利配置' }}</button>
              </div>
            </div>
            <p v-if="welfareMessage" class="alert alert-success" role="status">{{ welfareMessage }}</p>
            <p v-if="welfareError" class="form-error" role="alert">{{ welfareError }}</p>
            <div v-if="!document.welfare || !welfareEditor" class="state-card"><strong>没有福利配置记录</strong><span>接口未返回可供 CAS 更新的 welfare revision，页面不会自行创建或猜测。</span></div>
            <template v-else>
              <div class="tower-record-strip tower-record-strip-small">
                <div><span>配置 ID</span><strong class="mono">{{ document.welfare.id }}</strong></div>
                <div><span>旧表 Version</span><strong>{{ document.welfare.version || '—' }}</strong></div>
                <div><span>Revision</span><strong class="mono" :title="document.welfare.revision">{{ shortRevision(document.welfare.revision) }}</strong></div>
              </div>
              <p v-if="welfareEditor.warning" class="alert alert-warning" role="alert">{{ welfareEditor.warning }}</p>
              <pre v-if="!welfareEditor.editable" class="tower-json-preview">{{ JSON.stringify(welfareEditor.source, null, 2) }}</pre>
              <template v-else>
                <label class="field tower-welfare-count"><span>maxCount · 福利怪最大次数</span><input v-model="welfareEditor.maxCount.value" inputmode="numeric" /></label>
                <div class="tower-monster-list">
                  <TowerMonsterEditor
                    v-for="entry in currentWelfareMonsters"
                    :key="entry.monster.editorId"
                    :monster="entry.monster"
                    :index="entry.index"
                    @remove="removeWelfareMonster(entry.index)"
                  />
                </div>
                <div v-if="welfareEditor.monsters.length" class="tower-pagination">
                  <button class="button button-small button-secondary" type="button" :disabled="welfarePage <= 1" @click="welfarePage -= 1">上一页</button>
                  <span>第 {{ welfarePage }} / {{ welfarePageCount }} 页 · 共 {{ welfareEditor.monsters.length }} 个</span>
                  <button class="button button-small button-secondary" type="button" :disabled="welfarePage >= welfarePageCount" @click="welfarePage += 1">下一页</button>
                </div>
              </template>
            </template>
          </article>
        </section>

        <section v-else-if="activeTab === 'recoveries'" class="tower-recovery-layout">
          <article class="panel">
            <div class="panel-heading"><div><p class="eyebrow">主播检索</p><h2>选择主播</h2></div></div>
            <form class="inline-form" @submit.prevent="searchAnchors">
              <label class="field grow"><span>昵称或 open_uid</span><input v-model="anchorQuery" placeholder="输入主播昵称" /></label>
              <button class="button button-primary align-end" type="submit" :disabled="anchorLoading">{{ anchorLoading ? '搜索中…' : '搜索' }}</button>
            </form>
            <p v-if="anchorError" class="form-error" role="alert">{{ anchorError }}</p>
            <div v-if="!anchors.length" class="state-card"><strong>尚未选择主播</strong><span>按昵称搜索后，从结果中选择目标主播。</span></div>
            <div v-else class="tower-anchor-list">
              <button
                v-for="anchor in anchors"
                :key="anchor.open_uid"
                class="tower-anchor-card"
                :class="{ active: selectedAnchor?.open_uid === anchor.open_uid }"
                type="button"
                @click="selectAnchor(anchor)"
              >
                <span><strong>{{ anchor.nickname }}</strong><small class="mono">{{ anchor.open_uid }}</small></span>
                <em>{{ anchor.config_id ? `配置 ${anchor.config_id}` : '未关联配置' }}</em>
              </button>
            </div>
          </article>

          <article class="panel">
            <div class="panel-heading"><div><p class="eyebrow">跳关恢复</p><h2>创建恢复记录</h2></div></div>
            <div v-if="!selectedAnchor" class="state-card"><strong>请先选择主播</strong><span>恢复记录只通过明确 open_uid 写入。</span></div>
            <form v-else class="form-stack" @submit.prevent="createRecovery">
              <div class="selected-project-summary"><strong>{{ selectedAnchor.nickname }}</strong><small class="mono">{{ selectedAnchor.open_uid }}</small></div>
              <p v-if="selectedAnchorRecovery" class="alert alert-warning">该主播已有未消费记录；下方展示的是现有配置，再次提交会被服务端拒绝。</p>
              <div class="tower-recovery-fields">
                <label v-for="field in recoveryEditor.fields" :key="field.key" class="field">
                  <span>{{ field.label }} · {{ field.key }}</span>
                  <input v-model="field.value" inputmode="decimal" :placeholder="field.originalType === 'missing' ? '未设置' : ''" />
                </label>
              </div>
              <p v-if="recoveryMessage" class="alert alert-success" role="status">{{ recoveryMessage }}</p>
              <p v-if="recoveryError" class="form-error" role="alert">{{ recoveryError }}</p>
              <button class="button button-primary" type="submit" :disabled="recoveryBusy || Boolean(selectedAnchorRecovery)">{{ recoveryBusy ? '创建中…' : '创建未消费跳关记录' }}</button>
            </form>
          </article>

          <article class="panel tower-recovery-history">
            <div class="panel-heading"><div><p class="eyebrow">未消费记录</p><h2>待客户端读取</h2></div><button class="button button-small button-secondary" type="button" :disabled="recoveryLoading" @click="loadRecoveries">刷新</button></div>
            <AsyncState :loading="recoveryLoading" :error="recoveryError" :empty="!recoveries.length" empty-text="当前没有未消费跳关记录。" @retry="loadRecoveries">
              <div class="record-list">
                <article v-for="recovery in recoveries" :key="recovery.id" class="record-item">
                  <div><strong>{{ recovery.nickname }}</strong><span class="mono">{{ recovery.open_uid }}</span></div>
                  <time>{{ formatDateTime(recovery.created_at) }}</time>
                  <small class="mono">{{ JSON.stringify(recovery.config) }}</small>
                </article>
              </div>
            </AsyncState>
          </article>
        </section>

        <section v-else-if="activeTab === 'catalog'" class="panel">
          <div class="panel-heading"><div><p class="eyebrow">0–62</p><h2>怪物图鉴</h2><p class="muted">图鉴 ID 与 compact d1 一一对应。</p></div></div>
          <div class="tower-catalog-grid">
            <article v-for="item in TOWER_MONSTER_CATALOG" :key="item.id" class="tower-catalog-card">
              <img :src="item.imageUrl" :alt="item.name" loading="lazy" width="96" height="96" />
              <strong>#{{ item.id }}</strong>
              <small>{{ item.name }}</small>
            </article>
          </div>
        </section>
      </template>
    </AsyncState>
  </section>
</template>
