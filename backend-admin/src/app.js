import cors from '@fastify/cors';
import Fastify from 'fastify';
import { parseJson } from './lib/json.js';
import { InputError } from './lib/values.js';
import { adminV1Routes } from './routes/admin-v1.js';
import { healthRoutes } from './routes/health.js';
import { failure } from './routes/shared.js';

const LOOPBACK_ADMIN_ORIGIN = /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/u;

export async function buildApp({ config, services, logger } = {}) {
  if (!config) throw new Error('config is required');
  if (!services) throw new Error('services are required');

  const loggerOptions = logger === false ? false : {
    ...logger,
    level: logger?.level ?? config.logLevel,
    serializers: {
      ...logger?.serializers,
      req(request) {
        return { method: request.method, url: request.url.split('?', 1)[0] };
      },
    },
    redact: logger?.redact ?? {
      paths: [
        'req.headers.authorization',
        'req.headers.x-admin-token',
        'access_token',
        '*.access_token',
      ],
      censor: '[REDACTED]',
    },
  };

  const app = Fastify({ logger: loggerOptions, bodyLimit: 1024 * 1024 });
  app.decorateRequest('adminContext', null);
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) => {
    try {
      done(null, parseJson(body.toString('utf8')));
    } catch (error) {
      error.statusCode = 400;
      done(error);
    }
  });

  await app.register(cors, {
    origin: config.adminAuthDisabled ? LOOPBACK_ADMIN_ORIGIN : '*',
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['accept', 'content-type', 'x-admin-token', 'x-project-id'],
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof InputError || error.statusCode === 400) {
      return reply.code(400).send(failure(400, error.message));
    }
    request.log.error({ err: error }, 'request failed');
    return reply.code(500).send(failure(500, 'internal server error'));
  });

  const options = { config, services };
  await app.register(healthRoutes, options);
  await app.register(adminV1Routes, options);
  return app;
}
