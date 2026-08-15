import type {
  AdminContext,
  GiftCatalogItem,
  ProjectDefinition,
  ProjectRegistry,
} from '@/types/project';

const CONTEXT_CAPABILITIES = [
  'leaderboards',
  'gift_compensation',
  'guilds',
  'gift_debug',
  'configs',
  'platform_tokens',
  'tower_config',
] as const;

export async function loadProjectRegistry(
  fetcher: typeof fetch = fetch,
): Promise<ProjectRegistry> {
  const response = await fetcher(projectRegistryUrl(import.meta.env.BASE_URL), { cache: 'no-store' });
  if (!response.ok) throw new Error(`玩法配置加载失败（HTTP ${response.status}）`);
  const value: unknown = await response.json();
  if (!isRecord(value) || !Array.isArray(value.projects)) {
    throw new Error('玩法配置必须包含 projects 数组');
  }
  const apiBase = requiredText(value.apiBase, 'apiBase');
  validateApiBase(apiBase);
  const projects = value.projects.map(parseProject);
  if (new Set(projects.map(project => project.id)).size !== projects.length) {
    throw new Error('玩法 id 不能重复');
  }
  if (!projects.length) throw new Error('玩法配置至少需要一个项目');
  return { apiBase, projects };
}

export function projectRegistryUrl(baseUrl: string): string {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${normalizedBase}projects.json`;
}

export function assertProjectContext(
  project: ProjectDefinition,
  context: AdminContext,
): void {
  if (context.project_id !== project.id) {
    throw new Error(`后端玩法标识不匹配：期望 ${project.id}，实际 ${context.project_id || '未提供'}`);
  }
}

function parseProject(value: unknown, index: number): ProjectDefinition {
  if (!isRecord(value)) throw new Error(`projects[${index}] 必须是对象`);
  if (value.authRequired !== undefined && typeof value.authRequired !== 'boolean') {
    throw new Error(`projects[${index}].authRequired 必须是布尔值`);
  }
  return {
    id: requiredText(value.id, `projects[${index}].id`),
    name: requiredText(value.name, `projects[${index}].name`),
    authRequired: value.authRequired ?? true,
  };
}

export function parseAdminContext(value: unknown): AdminContext {
  if (!isRecord(value)) throw new Error('管理服务 context 必须是对象');
  const platform = requiredText(value.platform, 'context.platform');
  if (platform !== 'dy' && platform !== 'ks') {
    throw new Error('context.platform 必须是 dy 或 ks');
  }
  if (typeof value.mock_mode !== 'boolean') {
    throw new Error('context.mock_mode 必须是布尔值');
  }
  if (!isRecord(value.capabilities)) {
    throw new Error('context.capabilities 必须是对象');
  }
  const rawCapabilities = value.capabilities;
  const capabilities = Object.fromEntries(CONTEXT_CAPABILITIES.map(capability => {
    const enabled = rawCapabilities[capability];
    if (typeof enabled !== 'boolean') {
      throw new Error(`context.capabilities.${capability} 必须是布尔值`);
    }
    return [capability, enabled];
  })) as AdminContext['capabilities'];
  if (!Array.isArray(value.gift_catalog)) {
    throw new Error('context.gift_catalog 必须是数组');
  }
  const giftCatalog = value.gift_catalog.map(parseGift);
  if (new Set(giftCatalog.map(gift => gift.id)).size !== giftCatalog.length) {
    throw new Error('context.gift_catalog 的礼物 id 不能重复');
  }
  return {
    project_id: requiredText(value.project_id, 'context.project_id'),
    project_name: requiredText(value.project_name, 'context.project_name'),
    platform,
    mock_mode: value.mock_mode,
    config_key: requiredText(value.config_key, 'context.config_key'),
    capabilities,
    gift_catalog: giftCatalog,
  };
}

function parseGift(value: unknown, giftIndex: number): GiftCatalogItem {
  if (!isRecord(value)) {
    throw new Error(`context.gift_catalog[${giftIndex}] 必须是对象`);
  }
  return {
    id: requiredText(value.id, `context.gift_catalog[${giftIndex}].id`),
    name: requiredText(value.name, `context.gift_catalog[${giftIndex}].name`),
    value: positiveNumber(value.value, `context.gift_catalog[${giftIndex}].value`),
  };
}

function positiveNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} 必须是正整数`);
  }
  return value;
}

function validateApiBase(apiBase: string): void {
  let url: URL;
  try {
    url = new URL(apiBase);
  } catch {
    throw new Error('apiBase 不是有效 URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('apiBase 只能使用 http 或 https');
  }
  const localHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
  if (url.protocol === 'http:' && !localHosts.has(url.hostname)) {
    throw new Error('apiBase 的非本机地址必须使用 https');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('apiBase 不得包含凭据、查询或片段');
  }
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} 不能为空`);
  }
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
