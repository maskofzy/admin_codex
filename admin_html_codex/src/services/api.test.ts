import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, buildApiUrl } from './api';

describe('ApiClient', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends admin and project identity headers without leaking them into the URL', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ code: 200, data: { ok: true }, message: 'success' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new ApiClient('http://127.0.0.1:8121/', 'secret-admin-token', 'cars');
    await expect(client.request('/admin/v1/leaderboards', {
      query: { period: 'current_week', empty: '' },
    })).resolves.toEqual({ ok: true });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe('http://127.0.0.1:8121/admin/v1/leaderboards?period=current_week');
    expect(String(url)).not.toContain('secret-admin-token');
    expect(String(url)).not.toContain('cars');
    expect(new Headers(init?.headers).get('x-admin-token')).toBe('secret-admin-token');
    expect(new Headers(init?.headers).get('x-project-id')).toBe('cars');
    expect(init?.cache).toBe('no-store');
  });

  it('serializes write bodies once and rejects non-success envelopes', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ code: 409, data: null, message: 'version conflict' }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient('https://admin.example.com/api', 'token', 'cars');

    await expect(client.request('/admin/v1/guilds/g-1', {
      method: 'PATCH',
      body: { version: 2, enabled: false },
    })).rejects.toMatchObject({ status: 409, code: 409, message: 'version conflict' });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init?.body).toBe('{"version":2,"enabled":false}');
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
  });

  it('omits the admin token header for an explicitly tokenless project', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ code: 200, data: { ok: true }, message: 'success' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new ApiClient('http://127.0.0.1:8121', '', 'cars');
    await client.request('/admin/v1/context');

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);
    expect(headers.has('x-admin-token')).toBe(false);
    expect(headers.get('x-project-id')).toBe('cars');
  });

  it('reports malformed responses instead of silently accepting them', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>bad gateway</html>', { status: 502 })));
    const client = new ApiClient('http://127.0.0.1:8121', 'token', 'cars');
    await expect(client.request('/health')).rejects.toThrow('无法解析');
  });
});

describe('buildApiUrl', () => {
  it('preserves an api base path and URL-encodes query values', () => {
    expect(buildApiUrl('https://example.com/game-api', '/admin/v1/users', { q: '张 三' }))
      .toBe('https://example.com/game-api/admin/v1/users?q=%E5%BC%A0+%E4%B8%89');
  });
});
