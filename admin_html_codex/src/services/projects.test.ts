import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assertProjectContext,
  loadProjectRegistry,
  parseAdminContext,
  projectRegistryUrl,
} from './projects';

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const contextValue = {
  project_id: 'cars',
  project_name: '个人赛车乱斗',
  platform: 'dy',
  mock_mode: false,
  config_key: 'version1',
  capabilities: {
    leaderboards: true,
    gift_compensation: true,
    guilds: true,
    gift_debug: false,
    configs: true,
    platform_tokens: true,
    tower_config: true,
  },
  gift_catalog: [{ id: 'nitro', name: '仙女棒', value: 1 }],
};

describe('loadProjectRegistry', () => {
  it('publishes the three local test projects through the explicit project list', () => {
    const registry = JSON.parse(readFileSync(
      new URL('../../public/projects.json', import.meta.url),
      'utf8',
    )) as { projects: Array<{ id: string; authRequired?: boolean }> };

    expect(registry.projects).toEqual([
      { id: 'cars', name: '个人赛车乱斗', authRequired: false },
      { id: 'tower-dy', name: '塔防（抖音）', authRequired: false },
      { id: 'tower-ks', name: '塔防（快手）', authRequired: false },
    ]);
  });

  it('loads one management API base and minimal project metadata', async () => {
    const registry = await loadProjectRegistry(async () => response({
      apiBase: 'http://127.0.0.1:8121',
      projects: [
        { id: 'cars', name: '个人赛车乱斗', authRequired: false },
        { id: 'islands', name: '海岛争夺' },
      ],
    }));

    expect(registry).toEqual({
      apiBase: 'http://127.0.0.1:8121',
      projects: [
        { id: 'cars', name: '个人赛车乱斗', authRequired: false },
        { id: 'islands', name: '海岛争夺', authRequired: true },
      ],
    });
  });

  it('rejects duplicate project ids and empty project lists', async () => {
    const item = { id: 'cars', name: '赛车' };
    await expect(loadProjectRegistry(async () => response({
      apiBase: 'http://127.0.0.1:8121',
      projects: [item, item],
    }))).rejects.toThrow('玩法 id 不能重复');
    await expect(loadProjectRegistry(async () => response({
      apiBase: 'http://127.0.0.1:8121',
      projects: [],
    }))).rejects.toThrow('至少需要一个项目');
  });

  it('rejects a shared apiBase that could expose the admin token', async () => {
    await expect(loadProjectRegistry(async () => response({
      apiBase: 'https://admin:secret@example.com',
      projects: [{ id: 'unsafe', name: '不安全玩法' }],
    }))).rejects.toThrow('不得包含凭据');
  });

  it('requires TLS when the shared apiBase is not a loopback address', async () => {
    await expect(loadProjectRegistry(async () => response({
      apiBase: 'http://admin.example.com',
      projects: [{ id: 'remote', name: '远程玩法' }],
    }))).rejects.toThrow('非本机地址必须使用 https');
  });

  it('does not accept the retired per-project API registry shape', async () => {
    await expect(loadProjectRegistry(async () => response({
      projects: [{ id: 'cars', name: '赛车', apiBase: 'http://127.0.0.1:8120' }],
    }))).rejects.toThrow('apiBase 不能为空');
  });

  it('defaults production-style projects to token authentication and validates overrides', async () => {
    const registry = await loadProjectRegistry(async () => response({
      apiBase: 'https://admin.example.com',
      projects: [{ id: 'production', name: '正式玩法' }],
    }));
    expect(registry.projects[0]?.authRequired).toBe(true);

    await expect(loadProjectRegistry(async () => response({
      apiBase: 'http://127.0.0.1:8121',
      projects: [{ id: 'test', name: '测试玩法', authRequired: 'false' }],
    }))).rejects.toThrow('authRequired 必须是布尔值');
  });
});

describe('projectRegistryUrl', () => {
  it('keeps projects.json under the configured static base path', () => {
    expect(projectRegistryUrl('./')).toBe('./projects.json');
    expect(projectRegistryUrl('/tools/admin/')).toBe('/tools/admin/projects.json');
  });
});

describe('admin context', () => {
  const project = { id: 'cars', name: '赛车', authRequired: true };

  it('parses server-authoritative metadata and accepts the selected project', () => {
    const context = parseAdminContext(contextValue);
    expect(context).toMatchObject({
      project_id: 'cars',
      platform: 'dy',
      config_key: 'version1',
      capabilities: { tower_config: true },
      gift_catalog: [{ id: 'nitro', name: '仙女棒', value: 1 }],
    });
    expect(() => assertProjectContext(project, context)).not.toThrow();
  });

  it('rejects project mismatches before a token is stored', () => {
    const context = parseAdminContext({ ...contextValue, project_id: 'other' });
    expect(() => assertProjectContext(project, context)).toThrow('后端玩法标识不匹配');
  });

  it('rejects malformed authoritative capabilities and gift values', () => {
    expect(() => parseAdminContext({
      ...contextValue,
      capabilities: { ...contextValue.capabilities, guilds: 'yes' },
    })).toThrow('context.capabilities.guilds 必须是布尔值');
    expect(() => parseAdminContext({
      ...contextValue,
      gift_catalog: [{ id: 'bad', name: '错误礼物', value: 0 }],
    })).toThrow('必须是正整数');
  });
});
