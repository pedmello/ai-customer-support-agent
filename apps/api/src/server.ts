import { createApp } from './app.js';
import { env } from './config/env.js';
import { createLogger } from './config/logger.js';
import { createDatabase } from './integrations/database/prisma.js';
import { createHealthRepository } from './modules/health/health.repository.js';
import { createIntentModel } from './integrations/ai/model.factory.js';
import { createFakeStoreClient } from './integrations/fake-store/fake-store.client.js';

const logger = createLogger(env.LOG_LEVEL);
const database = createDatabase(env.DATABASE_URL);
const repository = createHealthRepository(database);
const app = createApp({
  checkDatabase: repository.checkDatabase, logger,
  support: {
    database,
    sessionPolicy: { ttlSeconds: env.SESSION_TTL_SECONDS, secure: new URL(env.API_PUBLIC_URL).protocol === 'https:' },
    allowedOrigins: [new URL(env.API_PUBLIC_URL).origin, env.WEB_ORIGIN],
    agent: {
      model: createIntentModel(env, logger),
      products: createFakeStoreClient({ timeoutMs: env.FAKE_STORE_TIMEOUT_MS, logger }),
      confirmationTtlSeconds: env.CONFIRMATION_TTL_SECONDS,
    },
  },
});
const server = app.listen(env.API_PORT, env.API_HOST, () => {
  logger.info({ host: env.API_HOST, port: env.API_PORT }, 'API listening');
});

server.on('error', (error) => {
  logger.fatal({ err: error }, 'HTTP server failed');
  void database.$disconnect().finally(() => process.exit(1));
});

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');
  const timeout = setTimeout(() => {
    logger.error('Shutdown timed out');
    process.exit(1);
  }, 10000).unref();

  server.close(() => {
    void database.$disconnect().then(() => {
      clearTimeout(timeout);
      process.exitCode = 0;
    }).catch((error: unknown) => {
      logger.error({ err: error }, 'Database disconnect failed');
      process.exit(1);
    });
  });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
