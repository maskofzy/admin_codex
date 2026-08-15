export async function healthRoutes(app, { config, services }) {
  app.get('/health', async (_request, reply) => {
    const projects = await Promise.all(config.projects.map(async project => {
      const projectServices = services.projects.get(project.id);
      if (!projectServices) {
        return { project_id: project.id, mysql: 'error', redis: 'error' };
      }
      const mysqlCheck = await Promise.allSettled([projectServices.repository.health()]);
      const redisCheck = projectServices.eventStore
        ? await Promise.allSettled([projectServices.eventStore.health()])
        : null;
      return {
        project_id: project.id,
        mysql: mysqlCheck[0].status === 'fulfilled' ? 'ok' : 'error',
        redis: redisCheck === null
          ? 'not_applicable'
          : redisCheck[0].status === 'fulfilled' ? 'ok' : 'error',
      };
    }));
    const healthy = projects.every(project => (
      project.mysql === 'ok' && project.redis !== 'error'
    ));
    return reply.code(healthy ? 200 : 503).send({ ok: healthy, projects });
  });
}
