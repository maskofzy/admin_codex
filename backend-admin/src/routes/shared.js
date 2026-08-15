import { safeEqual } from '../lib/crypto.js';

export function success(data, message = 'success') {
  return { code: 200, data, message };
}

export function failure(code, message, data = null) {
  return { code, data, message };
}

export function authenticateAdminProject(request, reply, config, services) {
  if (!config.adminAuthDisabled) {
    const suppliedToken = String(request.headers['x-admin-token'] ?? '');
    if (!safeEqual(config.adminToken, suppliedToken)) {
      reply.code(401).send(failure(401, 'invalid admin token'));
      return undefined;
    }
  }

  const projectId = String(request.headers['x-project-id'] ?? '').trim();
  if (!projectId) {
    reply.code(400).send(failure(400, 'x-project-id is required'));
    return undefined;
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(projectId)) {
    reply.code(400).send(failure(400, 'x-project-id is invalid'));
    return undefined;
  }
  const project = config.projectsById.get(projectId);
  if (!project) {
    reply.code(404).send(failure(404, 'project_not_found'));
    return undefined;
  }
  const projectServices = services.projects.get(projectId);
  if (!projectServices) {
    reply.code(503).send(failure(503, 'project services unavailable'));
    return undefined;
  }
  return { project, services: projectServices };
}

export function requireCapability(request, reply, capability) {
  if (request.adminContext.project.capabilities[capability]) return true;
  reply.code(403).send(failure(403, 'capability_disabled'));
  return false;
}
