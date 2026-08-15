import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router';
import AdminLayout from '@/layouts/AdminLayout.vue';
import { resolveRouteAccess } from '@/router/access';
import { adminSession } from '@/services/session';
import type { ProjectCapability } from '@/types/project';
import CompensationPage from '@/views/CompensationPage.vue';
import CurrentWeekPage from '@/views/CurrentWeekPage.vue';
import DebugEventsPage from '@/views/DebugEventsPage.vue';
import GuildsPage from '@/views/GuildsPage.vue';
import LoginPage from '@/views/LoginPage.vue';
import OperationsPage from '@/views/OperationsPage.vue';
import OverviewPage from '@/views/OverviewPage.vue';
import PlayerDetailPage from '@/views/PlayerDetailPage.vue';
import PreviousWeekPage from '@/views/PreviousWeekPage.vue';
import ProjectsPage from '@/views/ProjectsPage.vue';
import TowerConfigPage from '@/views/TowerConfigPage.vue';

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean;
    capability?: ProjectCapability;
  }
}

const routes: RouteRecordRaw[] = [
  { path: '/projects', name: 'projects', component: ProjectsPage },
  { path: '/login', name: 'login', component: LoginPage },
  {
    path: '/',
    component: AdminLayout,
    meta: { requiresAuth: true },
    children: [
      { path: '', redirect: { name: 'projects' } },
      { path: 'overview', name: 'overview', component: OverviewPage },
      {
        path: 'leaderboards/current',
        name: 'current-week',
        component: CurrentWeekPage,
        meta: { capability: 'leaderboards' },
      },
      {
        path: 'leaderboards/previous',
        name: 'previous-week',
        component: PreviousWeekPage,
        meta: { capability: 'leaderboards' },
      },
      {
        path: 'leaderboards/:period/players/:userId',
        name: 'player-detail',
        component: PlayerDetailPage,
        meta: { capability: 'leaderboards' },
      },
      {
        path: 'compensations',
        name: 'compensations',
        component: CompensationPage,
        meta: { capability: 'compensations' },
      },
      {
        path: 'guilds',
        name: 'guilds',
        component: GuildsPage,
        meta: { capability: 'guilds' },
      },
      {
        path: 'debug',
        name: 'debug',
        component: DebugEventsPage,
        meta: { capability: 'debug' },
      },
      {
        path: 'operations',
        name: 'operations',
        component: OperationsPage,
        meta: { capability: 'operations' },
      },
      {
        path: 'tower-config',
        name: 'tower-config',
        component: TowerConfigPage,
        meta: { capability: 'tower_config' },
      },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: { name: 'projects' } },
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
});

router.beforeEach(async to => {
  await adminSession.initialize();
  return resolveRouteAccess({
    routeName: to.name,
    fullPath: to.fullPath,
    requiresAuth: Boolean(to.meta.requiresAuth),
    authenticated: adminSession.authenticated.value,
    capability: to.meta.capability,
    capabilityAllowed: !to.meta.capability || adminSession.can(to.meta.capability),
  });
});
