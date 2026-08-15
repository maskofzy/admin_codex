import type { ProjectCapability } from '@/types/project';

export interface RouteAccessInput {
  routeName: string | symbol | null | undefined;
  fullPath: string;
  requiresAuth: boolean;
  authenticated: boolean;
  capability?: ProjectCapability;
  capabilityAllowed: boolean;
}

export type RouteAccessResult = true | {
  name: 'projects' | 'overview';
  query?: { redirect: string };
};

export function resolveRouteAccess(input: RouteAccessInput): RouteAccessResult {
  if (input.requiresAuth && !input.authenticated) {
    return { name: 'projects', query: { redirect: input.fullPath } };
  }
  if (input.routeName === 'login' && input.authenticated) {
    return { name: 'overview' };
  }
  if (input.capability && !input.capabilityAllowed) {
    return { name: 'overview' };
  }
  return true;
}
