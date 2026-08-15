import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('adminSession tokenless projects', () => {
  it('requires an explicit project selection even when there is one tokenless project', async () => {
    const fetchMock = registryAndContextFetch({
      apiBase: 'http://127.0.0.1:8121',
      projects: [{ id: 'cars', name: '测试赛车', authRequired: false }],
    });
    vi.stubGlobal('fetch', fetchMock);
    const { adminSession } = await import('./session');

    await adminSession.initialize();

    expect(adminSession.authenticated.value).toBe(false);
    expect(adminSession.state.project).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await adminSession.login('cars', 'ignored-token');
    expect(adminSession.authenticated.value).toBe(true);
    expect(adminSession.state.project?.id).toBe('cars');
    expect(adminSession.state.token).toBe('');
    expect(adminSession.can('tower_config')).toBe(true);
    const [, contextInit] = fetchMock.mock.calls[1] ?? [];
    const headers = new Headers(contextInit?.headers);
    expect(headers.get('x-project-id')).toBe('cars');
    expect(headers.has('x-admin-token')).toBe(false);
  });

  it('keeps project selection for multiple tokenless projects', async () => {
    const fetchMock = registryAndContextFetch({
      apiBase: 'http://127.0.0.1:8121',
      projects: [
        { id: 'cars', name: '测试赛车', authRequired: false },
        { id: 'arena', name: '测试竞技场', authRequired: false },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);
    const { adminSession } = await import('./session');

    await adminSession.initialize();
    expect(adminSession.authenticated.value).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await adminSession.login('arena', 'ignored-token');
    expect(adminSession.authenticated.value).toBe(true);
    expect(adminSession.state.project?.id).toBe('arena');
    expect(adminSession.state.token).toBe('');
    const [, contextInit] = fetchMock.mock.calls[1] ?? [];
    expect(new Headers(contextInit?.headers).has('x-admin-token')).toBe(false);
  });

  it('still requires a token when authRequired is omitted', async () => {
    const fetchMock = registryAndContextFetch({
      apiBase: 'https://admin.example.com',
      projects: [{ id: 'production', name: '正式玩法' }],
    });
    vi.stubGlobal('fetch', fetchMock);
    const { adminSession } = await import('./session');

    await adminSession.initialize();
    expect(adminSession.authenticated.value).toBe(false);
    await expect(adminSession.login('production', '')).rejects.toThrow('请输入管理员 token');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

function registryAndContextFetch(registry: unknown) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith('projects.json')) return jsonResponse(registry);
    const projectId = new Headers(init?.headers).get('x-project-id') ?? '';
    return jsonResponse({
      code: 200,
      message: 'success',
      data: adminContext(projectId),
    });
  });
}

function adminContext(projectId: string) {
  return {
    project_id: projectId,
    project_name: projectId === 'arena' ? '测试竞技场' : '测试赛车',
    platform: 'dy',
    mock_mode: true,
    config_key: 'version1',
    capabilities: {
      leaderboards: true,
      gift_compensation: true,
      guilds: true,
      gift_debug: true,
      configs: true,
      platform_tokens: true,
      tower_config: true,
    },
    gift_catalog: [{ id: 'nitro', name: '仙女棒', value: 1 }],
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
