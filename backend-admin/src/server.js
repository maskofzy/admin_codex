import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createProjectServices } from './services/project-services.js';

const config = loadConfig();
const services = createProjectServices(config);
const app = await buildApp({ config, services });

app.addHook('onClose', async () => {
  await services.close();
});

const close = async signal => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
};
process.once('SIGINT', () => void close('SIGINT'));
process.once('SIGTERM', () => void close('SIGTERM'));

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
