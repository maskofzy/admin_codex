import { describe, expect, it } from 'vitest';
import { resolveRouteAccess } from './access';

describe('route access', () => {
  it('sends unauthenticated feature routes to the project list first', () => {
    expect(resolveRouteAccess({
      routeName: 'tower-config',
      fullPath: '/tower-config',
      requiresAuth: true,
      authenticated: false,
      capability: 'tower_config',
      capabilityAllowed: false,
    })).toEqual({ name: 'projects', query: { redirect: '/tower-config' } });
  });

  it('keeps authenticated users out of the token form and guards capabilities', () => {
    expect(resolveRouteAccess({
      routeName: 'login',
      fullPath: '/login',
      requiresAuth: false,
      authenticated: true,
      capabilityAllowed: true,
    })).toEqual({ name: 'overview' });
    expect(resolveRouteAccess({
      routeName: 'tower-config',
      fullPath: '/tower-config',
      requiresAuth: true,
      authenticated: true,
      capability: 'tower_config',
      capabilityAllowed: false,
    })).toEqual({ name: 'overview' });
  });

  it('allows public project selection and authorized feature routes', () => {
    expect(resolveRouteAccess({
      routeName: 'projects',
      fullPath: '/projects',
      requiresAuth: false,
      authenticated: false,
      capabilityAllowed: true,
    })).toBe(true);
    expect(resolveRouteAccess({
      routeName: 'tower-config',
      fullPath: '/tower-config',
      requiresAuth: true,
      authenticated: true,
      capability: 'tower_config',
      capabilityAllowed: true,
    })).toBe(true);
  });
});
