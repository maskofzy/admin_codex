import { describe, expect, it } from 'vitest';
import {
  addTowerLevel,
  createTowerMainEditor,
  createTowerRecoveryEditor,
  createTowerWelfareEditor,
  monsterCatalogItem,
  parseTowerAnchors,
  parseTowerConfigDocument,
  parseTowerMainImport,
  parseTowerConfigRecord,
  parseTowerRecoveries,
  serializeTowerMainEditor,
  serializeTowerRecoveryEditor,
  serializeTowerWelfareEditor,
  TOWER_MONSTER_CATALOG,
} from './towerConfig';

describe('tower config documents', () => {
  it('parses named records and rejects the retired positional array protocol', () => {
    const revision = 'a'.repeat(64);
    expect(parseTowerConfigDocument({
      main: { id: '2', revision, version: 'v3', remark: 'live', config: { monsterConfig: [] } },
      welfare: null,
    })).toMatchObject({ main: { id: '2', revision, version: 'v3' } });
    expect(parseTowerConfigDocument({
      main: { id: '2', revision, version: null, config: {} }, welfare: null,
    }).main.version).toBeNull();
    expect(() => parseTowerConfigDocument([{ Config: {} }])).toThrow('必须是对象');
    expect(() => parseTowerConfigDocument({
      main: { id: '2', revision: 7, version: 'v3', config: {} }, welfare: null,
    })).toThrow('SHA-256');
    expect(() => parseTowerConfigDocument({
      main: { id: '2', revision, version: 3, config: {} }, welfare: null,
    })).toThrow('文本或 null');
  });

  it('parses a single CAS update response without reloading the other document', () => {
    const revision = 'b'.repeat(64);
    expect(parseTowerConfigRecord({
      id: '1', revision, version: null, remark: 'saved', config: { difficulty: 2 },
    }, 'main')).toEqual({
      id: '1', revision, version: null, remark: 'saved', config: { difficulty: 2 },
    });
  });

  it('parses anchors and recoveries by explicit keys', () => {
    expect(parseTowerAnchors({ items: [
      { open_uid: 'anchor-1', nickname: '主播一', config_id: 9 },
    ] })[0]).toEqual({ open_uid: 'anchor-1', nickname: '主播一', config_id: '9' });
    expect(parseTowerRecoveries({ items: [{
      id: 4,
      open_uid: 'anchor-1',
      nickname: '主播一',
      config: { currentLevel: '8' },
      is_used: false,
      created_at: '2026-08-08T00:00:00.000Z',
    }] })[0]).toMatchObject({ id: '4', config: { currentLevel: '8' } });
  });
});

describe('compact tower main editing', () => {
  it('imports either a raw compact main config or a config wrapper', () => {
    const raw = {
      unknown: { kept: true },
      healthParams: [1],
      countParams: [1],
      speedParams: [1],
      attackParams: [1],
      level2Exp: ['10'],
      monsterConfig: [{ ld1: '', ld2: 0, ld3: 1, ld4: [{ d1: 5, d2: 1, d8: 99 }] }],
    };

    expect(serializeTowerMainEditor(parseTowerMainImport(raw))).toEqual(raw);
    expect(serializeTowerMainEditor(parseTowerMainImport({ config: raw }))).toEqual(raw);
  });

  it('rejects expanded imports instead of silently replacing the current draft', () => {
    expect(() => parseTowerMainImport({ levels: [] })).toThrow(/expanded levels/u);
    expect(() => parseTowerMainImport({ config: 'not-an-object' })).toThrow(/config/u);
    expect(() => parseTowerMainImport({ foo: 'bar' })).toThrow(/monsterConfig/u);
    expect(() => parseTowerMainImport({ main: {}, welfare: null })).toThrow(/monsterConfig/u);
  });

  it('preserves unknown fields and legacy string/number types while editing known paths', () => {
    const editor = createTowerMainEditor({
      levelTime: '60',
      difficulty: 1,
      customTop: { keep: true },
      healthParams: ['1.2', 1.4],
      monsterConfig: [{
        ld1: '第一关', ld2: 1, ld3: '1', customLevel: 'keep',
        ld4: [{ d1: 2, d2: 1, d3: '3', d4: 2, customMonster: 99 }],
      }],
    });
    expect(editor.editable).toBe(true);
    editor.basic.find(field => field.key === 'levelTime')!.value = '75';
    editor.basic.find(field => field.key === 'difficulty')!.value = '1.5';
    editor.population[0]!.values[0]!.value = '1.25';
    editor.levels[0]!.monsters[0]!.fields.d3.value = '5';

    expect(serializeTowerMainEditor(editor)).toEqual({
      levelTime: '75',
      difficulty: 1.5,
      customTop: { keep: true },
      healthParams: ['1.25', 1.4],
      monsterConfig: [{
        ld1: '第一关', ld2: 1, ld3: '1', customLevel: 'keep',
        ld4: [{ d1: 2, d2: 1, d3: '5', d4: 2, customMonster: 99 }],
      }],
    });
  });

  it('adds compact levels without inventing optional gem fields', () => {
    const editor = createTowerMainEditor({ monsterConfig: [] });
    addTowerLevel(editor);
    const config = serializeTowerMainEditor(editor);
    const monster = (config.monsterConfig as Array<{ ld4: Array<Record<string, unknown>> }>)[0]!
      .ld4[0]!;
    expect(monster.d1).toBe(0);
    expect(monster.d20).toBe(0);
    expect(monster).not.toHaveProperty('d21');
    expect(monster).not.toHaveProperty('d22');
  });

  it('keeps unproven expanded schemas read-only', () => {
    const editor = createTowerMainEditor({
      levels: [{ level: 1, monsters: [] }],
    });
    expect(editor.editable).toBe(false);
    expect(editor.warning).toContain('只读');
    expect(() => serializeTowerMainEditor(editor)).toThrow('禁止自动覆盖');
  });

  it('does not turn a numeric list item into an empty string', () => {
    const editor = createTowerMainEditor({ healthParams: [1.2] });
    editor.population[0]!.values[0]!.value = '';
    expect(() => serializeTowerMainEditor(editor)).toThrow('血量系数第 1 项 不能为空');
  });
});

describe('welfare and recovery editing', () => {
  it('round-trips optional Douyin gem fields and unknown welfare data', () => {
    const editor = createTowerWelfareEditor({
      maxCount: '3', extra: 'keep',
      ld4: [{ d1: 10, d2: 3, d21: '2', d22: 15 }],
    });
    editor.monsters[0]!.fields.d22.value = '20';
    expect(serializeTowerWelfareEditor(editor)).toEqual({
      maxCount: '3', extra: 'keep',
      ld4: [{ d1: 10, d2: 3, d21: '2', d22: 20 }],
    });
  });

  it('patches recovery fields on a clone and keeps unknown audit data', () => {
    const editor = createTowerRecoveryEditor({ currentLevel: '5', custom: true });
    editor.fields.find(field => field.key === 'currentLevel')!.value = '6';
    editor.fields.find(field => field.key === 'relicHealth')!.value = '1000';
    editor.fields.find(field => field.key === 'relicMaxHealth')!.value = '1200';
    editor.fields.find(field => field.key === 'reviveCount')!.value = '0';
    editor.fields.find(field => field.key === 'boss1Health')!.value = '500';
    editor.fields.find(field => field.key === 'boss2Health')!.value = '700';
    expect(serializeTowerRecoveryEditor(editor)).toEqual({
      currentLevel: '6',
      relicHealth: '1000',
      relicMaxHealth: '1200',
      reviveCount: '0',
      boss1Health: '500',
      boss2Health: '700',
      custom: true,
    });
  });

  it('uses the verified legacy defaults and rejects an incomplete recovery record', () => {
    const editor = createTowerRecoveryEditor();
    expect(editor.fields.map(field => [field.key, field.value])).toEqual([
      ['currentLevel', '1'],
      ['relicHealth', ''],
      ['relicMaxHealth', ''],
      ['reviveCount', '0'],
      ['boss1Health', '0'],
      ['boss2Health', '0'],
    ]);
    expect(() => serializeTowerRecoveryEditor(editor)).toThrow('基地当前血量不能为空');
  });
});

describe('monster catalog', () => {
  it('uses stable explicit ids and the canonical local asset path', () => {
    expect(TOWER_MONSTER_CATALOG).toHaveLength(63);
    expect(monsterCatalogItem('0')).toEqual({
      id: 0, name: 'bat_0', imageUrl: `${import.meta.env.BASE_URL}tower-monsters/bat_0.png`,
    });
    expect(monsterCatalogItem('62')).toEqual({
      id: 62,
      name: 'Orc_Spearman_A_62',
      imageUrl: `${import.meta.env.BASE_URL}tower-monsters/Orc_Spearman_A_62.png`,
    });
  });
});
