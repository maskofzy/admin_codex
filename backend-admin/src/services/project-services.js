import { AdminRepository } from './admin-repository.js';
import { CompensationWorker } from './compensation-worker.js';
import { createRedis, EventStore } from './event-store.js';
import { PlatformGateway } from './platform-gateway.js';
import { createRepository } from './repository.js';
import { TowerConfigRepository } from './tower-config-repository.js';

export function createProjectServices(config, factories = {}) {
  const repositoryFactory = factories.repositoryFactory ?? createRepository;
  const redisFactory = factories.redisFactory ?? createRedis;
  const eventStoreFactory = factories.eventStoreFactory ?? ((redis, project) =>
    new EventStore(redis, project.eventStore));
  const adminRepositoryFactory = factories.adminRepositoryFactory ?? (repository =>
    new AdminRepository(repository.pool));
  const platformGatewayFactory = factories.platformGatewayFactory ?? ((project, redis) =>
    new PlatformGateway({ config: project, redis }));
  const compensationWorkerFactory = factories.compensationWorkerFactory
    ?? ((repository, eventStore) => new CompensationWorker({ repository, eventStore }));
  const towerConfigRepositoryFactory = factories.towerConfigRepositoryFactory
    ?? ((repository, project) => new TowerConfigRepository(repository.pool, project.tower));
  const projects = new Map();

  for (const project of config.projects) {
    const repository = repositoryFactory(project.mysql, project);
    const usesEventStore = project.capabilities.compensations ||
      project.capabilities.debug || project.capabilities.operations;
    const usesAdminRepository = project.capabilities.leaderboards ||
      project.capabilities.compensations || project.capabilities.guilds ||
      project.capabilities.operations;
    const redis = usesEventStore ? redisFactory(project.redis, project) : null;
    const eventStore = usesEventStore ? eventStoreFactory(redis, project) : null;
    const adminRepository = usesAdminRepository
      ? adminRepositoryFactory(repository, project)
      : null;
    const compensationWorker = project.capabilities.compensations
      ? compensationWorkerFactory(adminRepository, eventStore, project)
      : null;
    const towerConfigRepository = project.capabilities.towerConfig
      ? towerConfigRepositoryFactory(repository, project)
      : null;
    const projectServices = {
      repository,
      adminRepository,
      eventStore,
      platformGateway: project.capabilities.operations
        ? platformGatewayFactory(project, redis)
        : null,
      compensationWorker,
      towerConfigRepository,
    };
    projects.set(project.id, projectServices);
    compensationWorker?.start();
  }

  return {
    projects,
    async close() {
      await Promise.allSettled(
        [...projects.values()].map(projectServices => projectServices.compensationWorker?.stop()),
      );
      const closers = [];
      for (const projectServices of projects.values()) {
        closers.push(projectServices.repository.close());
        if (projectServices.eventStore) closers.push(projectServices.eventStore.close());
      }
      await Promise.allSettled(closers);
    },
  };
}
