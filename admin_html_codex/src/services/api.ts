import type { ApiEnvelope } from '@/types/api';

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  signal?: AbortSignal;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: number;

  constructor(message: string, status: number, code = status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export class ApiClient {
  readonly baseUrl: string;
  private readonly token: string;
  private readonly projectId: string;

  constructor(baseUrl: string, token: string, projectId: string) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.token = token;
    this.projectId = projectId;
  }

  async request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
    const url = buildApiUrl(this.baseUrl, path, options.query);
    const headers = new Headers({
      accept: 'application/json',
      'x-project-id': this.projectId,
    });
    if (this.token) headers.set('x-admin-token', this.token);
    const init: RequestInit = {
      method: options.method ?? 'GET',
      headers,
      cache: 'no-store',
      signal: options.signal,
    };

    if (options.body !== undefined) {
      headers.set('content-type', 'application/json');
      init.body = JSON.stringify(options.body);
    }

    const response = await fetch(url, init);
    const envelope = await readEnvelope<T>(response);
    if (!response.ok || envelope.code !== 200) {
      throw new ApiError(
        envelope.message || `请求失败（HTTP ${response.status}）`,
        response.status,
        envelope.code,
      );
    }
    return envelope.data;
  }
}

export function buildApiUrl(
  baseUrl: string,
  path: string,
  query?: ApiRequestOptions['query'],
): string {
  const url = new URL(path.replace(/^\/+/, ''), `${normalizeBaseUrl(baseUrl)}/`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function readEnvelope<T>(response: Response): Promise<ApiEnvelope<T>> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new ApiError('服务返回了无法解析的响应', response.status);
  }
  if (!isEnvelope(value)) {
    throw new ApiError('服务响应格式不符合约定', response.status);
  }
  return value as ApiEnvelope<T>;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/u, '');
}

function isEnvelope(value: unknown): value is ApiEnvelope<unknown> {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.code === 'number' && 'data' in candidate &&
    typeof candidate.message === 'string';
}
