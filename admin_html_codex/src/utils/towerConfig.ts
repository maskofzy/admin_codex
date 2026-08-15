import type {
  JsonObject,
  JsonValue,
  TowerAnchor,
  TowerConfigDocument,
  TowerConfigRecord,
  TowerRecovery,
} from '@/types/tower';

export type LegacyValueType = 'number' | 'string' | 'missing';

export interface EditableLegacyValue {
  value: string;
  originalType: LegacyValueType;
}

export interface TowerBasicField extends EditableLegacyValue {
  key: TowerBasicKey;
  label: string;
}

export interface TowerValueListEditor {
  key: TowerValueListKey;
  label: string;
  itemLabel: string;
  present: boolean;
  values: EditableLegacyValue[];
}

export type TowerMonsterFieldKey = `d${
  1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22
}`;

export interface TowerMonsterEditor {
  editorId: string;
  source: JsonObject;
  fields: Record<TowerMonsterFieldKey, EditableLegacyValue>;
}

export interface TowerLevelEditor {
  editorId: string;
  source: JsonObject;
  prompt: string;
  reward: EditableLegacyValue;
  level: EditableLegacyValue;
  monsters: TowerMonsterEditor[];
}

export interface TowerMainEditor {
  editable: boolean;
  warning: string;
  source: JsonObject;
  basic: TowerBasicField[];
  population: TowerValueListEditor[];
  levelExperience: TowerValueListEditor;
  levels: TowerLevelEditor[];
}

export interface TowerWelfareEditor {
  editable: boolean;
  warning: string;
  source: JsonObject;
  maxCount: EditableLegacyValue;
  monsters: TowerMonsterEditor[];
}

export interface TowerRecoveryEditor {
  source: JsonObject;
  fields: Array<EditableLegacyValue & { key: TowerRecoveryKey; label: string }>;
}

export interface TowerMonsterCatalogItem {
  id: number;
  name: string;
  imageUrl: string;
}

export const TOWER_BASIC_FIELDS = [
  ['levelTime', '关卡时间'],
  ['maxLevelNum', '关卡数量'],
  ['relicHealth', '基地血量'],
  ['reviveCount', '复活次数'],
  ['firstGiftUserCount', '每日礼物名额'],
  ['dieCountdown', '死亡倒计时'],
  ['autoBeginCountdown', '自动闯关倒计时'],
  ['difficulty', '难度系数'],
  ['expOefficient', '分数经验换算'],
  ['bossPercentExp', 'Boss 经验瓜分系数'],
  ['expPriceFactor', '一元对应经验'],
] as const;

export type TowerBasicKey = typeof TOWER_BASIC_FIELDS[number][0];

export const TOWER_VALUE_LISTS = [
  ['healthParams', '血量系数', '人'],
  ['countParams', '数量系数', '人'],
  ['speedParams', '速度系数', '人'],
  ['attackParams', '伤害系数', '人'],
] as const;

export type TowerValueListKey = typeof TOWER_VALUE_LISTS[number][0] | 'level2Exp';

export const TOWER_MONSTER_FIELDS = [
  ['d3', '数量'],
  ['d4', '刷怪间隔'],
  ['d5', '位置 X'],
  ['d6', '位置 Y'],
  ['d7', '位置 Z'],
  ['d8', '血量'],
  ['d9', '速度'],
  ['d10', '伤害'],
  ['d11', '分数'],
  ['d12', '大小'],
  ['d13', '范围'],
  ['d14', '箭 Damage 免疫'],
  ['d15', '箭 Debuff 免疫'],
  ['d16', '火 Damage 免疫'],
  ['d17', '火 Debuff 免疫'],
  ['d18', '冰 Damage 免疫'],
  ['d19', '冰 Debuff 免疫'],
  ['d20', 'Percent 免疫'],
  ['d21', '宝石数量（可选）'],
  ['d22', '宝石概率‰（可选）'],
] as const satisfies ReadonlyArray<readonly [TowerMonsterFieldKey, string]>;

export const TOWER_RECOVERY_FIELDS = [
  ['currentLevel', '当前波次'],
  ['relicHealth', '基地当前血量'],
  ['relicMaxHealth', '基地最大血量'],
  ['reviveCount', '复活次数'],
  ['boss1Health', 'Boss 1 血量'],
  ['boss2Health', 'Boss 2 血量'],
] as const;

export type TowerRecoveryKey = typeof TOWER_RECOVERY_FIELDS[number][0];

const MONSTER_NAMES = [
  'bat_0', 'bat_1', 'bat_2', 'dragon_3', 'dragon_4', 'Scorpions_5', 'Scorpions_6',
  'Scorpions_7', 'shades_8', 'shades_9', 'shell_10', 'shell_11', 'spider_12', 'spider_13',
  'spores_14', 'spores_15', 'wolf_16', 'wolf_17', 'bat_18', 'beholder_19', 'blackknight_20',
  'chestmonster_21', 'crabmonster_22', 'dragon_23', 'evilmage_24', 'evilmage1_25',
  'flyingdemon_26', 'golem_27', 'lizardwarrior_28', 'monsterPlant_29', 'orcOne_30',
  'orcOne1_31', 'ratassassin_32', 'skeleton_33', 'skeleton1_34', 'Slime_35', 'specter_36',
  'spider_37', 'TurtleShell_38', 'werewolf_39', 'wormnonster_40', 'beholder_41',
  'blackknight_42', 'chestmonster_43', 'dragon_44', 'flyingdemon_45', 'golem_46',
  'lizardwarrior_47', 'werewolf_48', 'evilmage1_49', 'orcOne1_50', 'skeleton1_51',
  'Orc_04_52', 'orc_10_53', 'orc_14_54', 'orc_17_55', 'Orc_Cavalry_Heavy_A_56',
  'Orc_Cavalry_Light_A_57', 'Orc_Cavalry_Shaman_A_58', 'Orc_Heavy_Infantry_A_59',
  'Orc_Infantry_A_60', 'Orc_Shaman_A_61', 'Orc_Spearman_A_62',
] as const;

const TOWER_ASSET_BASE = import.meta.env.BASE_URL.endsWith('/')
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;

export const TOWER_MONSTER_CATALOG: TowerMonsterCatalogItem[] = MONSTER_NAMES.map((name, id) => ({
  id,
  name,
  imageUrl: `${TOWER_ASSET_BASE}tower-monsters/${encodeURIComponent(name)}.png`,
}));

let editorSequence = 0;

export function parseTowerConfigDocument(value: unknown): TowerConfigDocument {
  const object = record(value, 'tower config');
  return {
    main: parseTowerConfigRecord(object.main, 'main'),
    welfare: object.welfare === null ? null : parseTowerConfigRecord(object.welfare, 'welfare'),
  };
}

export function parseTowerConfigRecord(value: unknown, field = 'tower config'): TowerConfigRecord {
  const configRecord = record(value, field);
  const revision = sha256Revision(configRecord.revision, `${field}.revision`);
  return {
    id: identifier(configRecord.id, `${field}.id`),
    revision,
    version: configRecord.version === null || configRecord.version === undefined
      ? null
      : nullableVersion(configRecord.version, `${field}.version`),
    remark: typeof configRecord.remark === 'string' ? configRecord.remark : '',
    config: cloneJson(record(configRecord.config, `${field}.config`)),
  };
}

export function parseTowerAnchors(value: unknown): TowerAnchor[] {
  const object = record(value, 'tower anchors');
  if (!Array.isArray(object.items)) throw new Error('tower anchors.items 必须是数组');
  return object.items.map((item, index) => {
    const anchor = record(item, `tower anchors.items[${index}]`);
    return {
      open_uid: text(anchor.open_uid, `anchors[${index}].open_uid`),
      nickname: text(anchor.nickname, `anchors[${index}].nickname`),
      config_id: anchor.config_id === null || anchor.config_id === undefined
        ? null
        : identifier(anchor.config_id, `anchors[${index}].config_id`),
    };
  });
}

export function parseTowerRecoveries(value: unknown): TowerRecovery[] {
  const object = record(value, 'tower recoveries');
  if (!Array.isArray(object.items)) throw new Error('tower recoveries.items 必须是数组');
  return object.items.map((item, index) => {
    const recovery = record(item, `tower recoveries.items[${index}]`);
    if (typeof recovery.is_used !== 'boolean') {
      throw new Error(`recoveries[${index}].is_used 必须是布尔值`);
    }
    return {
      id: identifier(recovery.id, `recoveries[${index}].id`),
      open_uid: text(recovery.open_uid, `recoveries[${index}].open_uid`),
      nickname: text(recovery.nickname, `recoveries[${index}].nickname`),
      config: cloneJson(record(recovery.config, `recoveries[${index}].config`)),
      is_used: recovery.is_used,
      created_at: text(recovery.created_at, `recoveries[${index}].created_at`),
    };
  });
}

export function createTowerMainEditor(config: JsonObject): TowerMainEditor {
  const source = cloneJson(config);
  const incompatibility = compactMainIncompatibility(source);
  const population = TOWER_VALUE_LISTS.map(([key, label, itemLabel]) =>
    createValueList(source, key, label, itemLabel));
  const levelExperience = createValueList(source, 'level2Exp', '等级经验', '级');
  return {
    editable: !incompatibility,
    warning: incompatibility,
    source,
    basic: TOWER_BASIC_FIELDS.map(([key, label]) => ({
      key,
      label,
      ...editableValue(source[key]),
    })),
    population,
    levelExperience,
    levels: incompatibility ? [] : (source.monsterConfig as JsonValue[] | undefined ?? [])
      .map((level, index) => createLevelEditor(record(level, `monsterConfig[${index}]`))),
  };
}

export function parseTowerMainImport(value: unknown): TowerMainEditor {
  const object = record(value, '导入配置');
  const wrappedConfig = Object.keys(object).length === 1 && 'config' in object;
  if (wrappedConfig && !isRecord(object.config)) throw new Error('导入配置.config 必须是对象');
  const config = wrappedConfig ? object.config as JsonObject : object;
  const editor = createTowerMainEditor(config as JsonObject);
  if (!editor.editable) throw new Error(editor.warning);
  const requiredLists: TowerValueListKey[] = [
    'healthParams', 'countParams', 'speedParams', 'attackParams', 'level2Exp',
  ];
  if (!Array.isArray(config.monsterConfig)) throw new Error('导入配置.monsterConfig 必须是数组');
  for (const key of requiredLists) {
    if (!Array.isArray(config[key])) throw new Error(`导入配置.${key} 必须是数组`);
  }
  serializeTowerMainEditor(editor);
  return editor;
}

export function serializeTowerMainEditor(editor: TowerMainEditor): JsonObject {
  assertEditable(editor.editable, editor.warning);
  const config = cloneJson(editor.source);
  for (const field of editor.basic) writeValue(config, field.key, field, field.label);
  for (const list of [...editor.population, editor.levelExperience]) {
    writeValueList(config, list);
  }
  config.monsterConfig = editor.levels.map((level, levelIndex) => {
    const value = cloneJson(level.source);
    value.ld1 = level.prompt;
    writeValue(value, 'ld2', level.reward, `第 ${levelIndex + 1} 关奖励方案`);
    writeValue(value, 'ld3', level.level, `第 ${levelIndex + 1} 关关卡号`);
    value.ld4 = level.monsters.map((monster, monsterIndex) =>
      serializeMonster(monster, `第 ${levelIndex + 1} 关第 ${monsterIndex + 1} 个怪物`));
    return value;
  });
  return config;
}

export function createTowerWelfareEditor(config: JsonObject): TowerWelfareEditor {
  const source = cloneJson(config);
  const incompatibility = compactWelfareIncompatibility(source);
  return {
    editable: !incompatibility,
    warning: incompatibility,
    source,
    maxCount: editableValue(source.maxCount),
    monsters: incompatibility ? [] : (source.ld4 as JsonValue[] | undefined ?? [])
      .map((monster, index) => createMonsterEditor(record(monster, `welfare.ld4[${index}]`))),
  };
}

export function serializeTowerWelfareEditor(editor: TowerWelfareEditor): JsonObject {
  assertEditable(editor.editable, editor.warning);
  const config = cloneJson(editor.source);
  writeValue(config, 'maxCount', editor.maxCount, '福利怪最大次数');
  config.ld4 = editor.monsters.map((monster, index) =>
    serializeMonster(monster, `第 ${index + 1} 个福利怪`));
  return config;
}

export function createTowerRecoveryEditor(
  config: JsonObject = DEFAULT_TOWER_RECOVERY_CONFIG,
): TowerRecoveryEditor {
  const source = cloneJson(config);
  return {
    source,
    fields: TOWER_RECOVERY_FIELDS.map(([key, label]) => ({
      key,
      label,
      ...editableValue(source[key]),
    })),
  };
}

export function serializeTowerRecoveryEditor(editor: TowerRecoveryEditor): JsonObject {
  const config = cloneJson(editor.source);
  for (const field of editor.fields) {
    const value = field.value.trim();
    if (value === '') throw new Error(`${field.label}不能为空`);
    if (!Number.isFinite(Number(value))) throw new Error(`${field.label}必须是有效数字`);
    config[field.key] = value;
  }
  return config;
}

export function addTowerLevel(editor: TowerMainEditor): void {
  assertEditable(editor.editable, editor.warning);
  const previous = editor.levels.at(-1);
  const nextLevel = numericText(previous?.level.value) + 1;
  editor.levels.push({
    editorId: nextEditorId('level'),
    source: {},
    prompt: '',
    reward: { value: '0', originalType: 'number' },
    level: { value: String(Math.max(1, nextLevel)), originalType: 'number' },
    monsters: [createMonsterEditor(defaultMonster())],
  });
}

export function addTowerMonster(target: TowerLevelEditor | TowerWelfareEditor): void {
  target.monsters.push(createMonsterEditor(defaultMonster()));
}

export function addTowerListValue(list: TowerValueListEditor): void {
  list.present = true;
  list.values.push({ value: '', originalType: 'number' });
}

export function monsterCatalogItem(value: string): TowerMonsterCatalogItem | undefined {
  const id = Number(value);
  return Number.isInteger(id) ? TOWER_MONSTER_CATALOG.find(item => item.id === id) : undefined;
}

function compactMainIncompatibility(config: JsonObject): string {
  if ('levels' in config) return readonlyWarning('检测到 expanded levels 字段');
  for (const [key] of TOWER_VALUE_LISTS) {
    if (config[key] !== undefined && !Array.isArray(config[key])) {
      return readonlyWarning(`${key} 不是数组`);
    }
  }
  if (config.level2Exp !== undefined && !Array.isArray(config.level2Exp)) {
    return readonlyWarning('level2Exp 不是数组');
  }
  if (config.monsterConfig === undefined) return '';
  if (!Array.isArray(config.monsterConfig)) return readonlyWarning('monsterConfig 不是数组');
  for (const [index, level] of config.monsterConfig.entries()) {
    if (!isRecord(level) || !Array.isArray(level.ld4)) {
      return readonlyWarning(`monsterConfig[${index}] 不是 compact ld1/ld2/ld3/ld4 结构`);
    }
    for (const [monsterIndex, monster] of level.ld4.entries()) {
      if (!isRecord(monster) || !('d1' in monster) || !('d2' in monster)) {
        return readonlyWarning(`monsterConfig[${index}].ld4[${monsterIndex}] 不是 compact d* 结构`);
      }
    }
  }
  return '';
}

function compactWelfareIncompatibility(config: JsonObject): string {
  if ('monsters' in config) return readonlyWarning('检测到 expanded monsters 字段');
  if (config.ld4 === undefined) return '';
  if (!Array.isArray(config.ld4)) return readonlyWarning('福利配置 ld4 不是数组');
  for (const [index, monster] of config.ld4.entries()) {
    if (!isRecord(monster) || !('d1' in monster) || !('d2' in monster)) {
      return readonlyWarning(`福利配置 ld4[${index}] 不是 compact d* 结构`);
    }
  }
  return '';
}

function readonlyWarning(reason: string): string {
  return `${reason}。当前页面只验证过 compact ld*/d* 配置，因此保持原 JSON 只读，禁止自动覆盖。`;
}

function createValueList(
  source: JsonObject,
  key: TowerValueListKey,
  label: string,
  itemLabel: string,
): TowerValueListEditor {
  const raw = source[key];
  return {
    key,
    label,
    itemLabel,
    present: raw !== undefined,
    values: Array.isArray(raw) ? raw.map(editableValue) : [],
  };
}

function createLevelEditor(source: JsonObject): TowerLevelEditor {
  return {
    editorId: nextEditorId('level'),
    source: cloneJson(source),
    prompt: typeof source.ld1 === 'string' ? source.ld1 : String(source.ld1 ?? ''),
    reward: editableValue(source.ld2),
    level: editableValue(source.ld3),
    monsters: (source.ld4 as JsonValue[]).map((monster, index) =>
      createMonsterEditor(record(monster, `level.ld4[${index}]`))),
  };
}

function createMonsterEditor(source: JsonObject): TowerMonsterEditor {
  const fields = {} as Record<TowerMonsterFieldKey, EditableLegacyValue>;
  for (let index = 1; index <= 22; index += 1) {
    const key = `d${index}` as TowerMonsterFieldKey;
    fields[key] = editableValue(source[key]);
  }
  return { editorId: nextEditorId('monster'), source: cloneJson(source), fields };
}

function serializeMonster(editor: TowerMonsterEditor, label: string): JsonObject {
  const monster = cloneJson(editor.source);
  for (let index = 1; index <= 22; index += 1) {
    const key = `d${index}` as TowerMonsterFieldKey;
    writeValue(monster, key, editor.fields[key], `${label} ${key}`);
  }
  return monster;
}

function writeValueList(config: JsonObject, list: TowerValueListEditor): void {
  if (!list.present && list.values.length === 0) return;
  config[list.key] = list.values.map((value, index) =>
    serializedValue(value, `${list.label}第 ${index + 1} 项`));
}

function writeValue(
  target: JsonObject,
  key: string,
  field: EditableLegacyValue,
  label: string,
): void {
  const trimmed = field.value.trim();
  if (field.originalType === 'missing' && trimmed === '') return;
  target[key] = serializedValue(field, label);
}

function serializedValue(
  field: EditableLegacyValue,
  label: string,
): string | number {
  const value = field.value.trim();
  if (value === '') {
    if (field.originalType === 'string') return '';
    throw new Error(`${label} 不能为空`);
  }
  if (field.originalType === 'string') return value;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} 必须是有效数字`);
  return number;
}

function editableValue(value: JsonValue | undefined): EditableLegacyValue {
  if (typeof value === 'number') return { value: String(value), originalType: 'number' };
  if (typeof value === 'string') return { value, originalType: 'string' };
  return { value: '', originalType: 'missing' };
}

function defaultMonster(): JsonObject {
  return {
    d1: 0, d2: 1, d3: 1, d4: 2, d5: -6000, d6: 0, d7: 0,
    d8: 1, d9: 300, d10: 1, d11: 1, d12: 1, d13: 200,
    d14: 0, d15: 0, d16: 0, d17: 0, d18: 0, d19: 0, d20: 0,
  };
}

const DEFAULT_TOWER_RECOVERY_CONFIG: JsonObject = Object.freeze({
  currentLevel: '1',
  relicHealth: '',
  relicMaxHealth: '',
  reviveCount: '0',
  boss1Health: '0',
  boss2Health: '0',
});

function numericText(value: string | undefined): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function nextEditorId(prefix: string): string {
  editorSequence += 1;
  return `${prefix}-${editorSequence}`;
}

function assertEditable(editable: boolean, warning: string): void {
  if (!editable) throw new Error(warning || '当前配置只读');
}

function cloneJson<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function identifier(value: unknown, field: string): string {
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value).trim() === '') {
    throw new Error(`${field} 不能为空`);
  }
  return String(value);
}

function sha256Revision(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/iu.test(value)) {
    throw new Error(`${field} 必须是 SHA-256 hex 字符串`);
  }
  return value;
}

function nullableVersion(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} 必须是非空文本或 null`);
  }
  return value.trim();
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} 不能为空`);
  return value.trim();
}

function record(value: unknown, field: string): JsonObject {
  if (!isRecord(value)) throw new Error(`${field} 必须是对象`);
  return value as JsonObject;
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
