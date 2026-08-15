import { computed, reactive, readonly } from 'vue';
import { ApiClient } from '@/services/api';
import {
  assertProjectContext,
  loadProjectRegistry,
  parseAdminContext,
} from '@/services/projects';
import type { AdminContext, ProjectCapability, ProjectDefinition } from '@/types/project';

const PROJECT_KEY = 'danmaku-admin.project';
const TOKEN_KEY = 'danmaku-admin.token';

interface SessionState {
  apiBase: string;
  projects: ProjectDefinition[];
  project: ProjectDefinition | null;
  token: string;
  context: AdminContext | null;
  initializing: boolean;
  initialized: boolean;
  initializationError: string;
}

const state = reactive<SessionState>({
  apiBase: '',
  projects: [],
  project: null,
  token: '',
  context: null,
  initializing: false,
  initialized: false,
  initializationError: '',
});

let initialization: Promise<void> | null = null;

export const adminSession = {
  state: readonly(state),
  authenticated: computed(() => Boolean(state.project && state.context)),

  async initialize(): Promise<void> {
    if (state.initialized) return;
    if (initialization) return initialization;
    state.initializing = true;
    initialization = (async () => {
      try {
        const registry = await loadProjectRegistry();
        state.apiBase = registry.apiBase;
        state.projects = registry.projects;
        const storage = getSessionStorage();
        const projectId = storage?.getItem(PROJECT_KEY) ?? '';
        const storedToken = storage?.getItem(TOKEN_KEY) ?? '';
        const project = state.projects.find(item => item.id === projectId) ?? null;
        if (project && (!project.authRequired || storedToken)) {
          try {
            const token = project.authRequired ? storedToken : '';
            const context = await fetchContext(project, token);
            setAuthenticatedSession(project, token, context);
          } catch {
            clearAuthentication();
          }
        }
      } catch (error) {
        state.initializationError = errorMessage(error);
      } finally {
        state.initializing = false;
        state.initialized = true;
      }
    })();
    return initialization;
  },

  async login(projectId: string, token: string): Promise<void> {
    const project = state.projects.find(item => item.id === projectId);
    if (!project) throw new Error('请选择有效玩法');
    const normalizedToken = project.authRequired ? token.trim() : '';
    if (project.authRequired && !normalizedToken) throw new Error('请输入管理员 token');
    const context = await fetchContext(project, normalizedToken);
    setAuthenticatedSession(project, normalizedToken, context);
  },

  logout(): void {
    clearAuthentication();
  },

  api(): ApiClient {
    if (!state.apiBase || !state.project || !state.context) {
      throw new Error('管理员会话尚未登录');
    }
    return new ApiClient(state.apiBase, state.token, state.project.id);
  },

  can(capability: ProjectCapability): boolean {
    if (!state.context) return false;
    const contextCapability = {
      leaderboards: state.context.capabilities.leaderboards,
      compensations: state.context.capabilities.gift_compensation,
      guilds: state.context.capabilities.guilds,
      debug: state.context.mock_mode && state.context.capabilities.gift_debug,
      operations: state.context.capabilities.configs &&
        state.context.capabilities.platform_tokens,
      tower_config: state.context.capabilities.tower_config,
    } satisfies Record<ProjectCapability, boolean>;
    return contextCapability[capability];
  },
};

async function fetchContext(
  project: ProjectDefinition,
  token: string,
): Promise<AdminContext> {
  if (!state.apiBase) throw new Error('管理服务地址尚未加载');
  const value = await new ApiClient(state.apiBase, token, project.id)
    .request<unknown>('/admin/v1/context');
  const context = parseAdminContext(value);
  assertProjectContext(project, context);
  return context;
}

function setAuthenticatedSession(
  project: ProjectDefinition,
  token: string,
  context: AdminContext,
): void {
  state.project = project;
  state.token = token;
  state.context = context;
  const storage = getSessionStorage();
  storage?.setItem(PROJECT_KEY, project.id);
  if (token) storage?.setItem(TOKEN_KEY, token);
  else storage?.removeItem(TOKEN_KEY);
}

function clearAuthentication(): void {
  state.project = null;
  state.token = '';
  state.context = null;
  const storage = getSessionStorage();
  storage?.removeItem(PROJECT_KEY);
  storage?.removeItem(TOKEN_KEY);
}

function getSessionStorage(): Storage | null {
  return typeof window === 'undefined' ? null : window.sessionStorage;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '玩法配置加载失败';
}
