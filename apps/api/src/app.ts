import { randomUUID } from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { createLogger } from './config/logger.js';
import { openapi } from './docs/openapi.js';
import { errorHandler, notFound } from './middlewares/error-handler.js';
import { createHealthRouter } from './modules/health/health.routes.js';
import type { CheckDatabase } from './modules/health/health.service.js';
import { createSupportRouter, type SupportDependencies } from './modules/support.routes.js';
import { browserSecurity } from './middlewares/browser-security.js';

interface AppDependencies {
  checkDatabase: CheckDatabase;
  logger?: ReturnType<typeof createLogger>;
  support?: SupportDependencies;
}

export function createApp({ checkDatabase, logger = createLogger('silent'), support }: AppDependencies) {
  const app = express();
  app.disable('x-powered-by');
  app.use(pinoHttp({
    logger,
    genReqId: (_req, res) => {
      const id = randomUUID();
      res.setHeader('X-Request-Id', id);
      return id;
    },
    serializers: {
      req: (req) => ({ id: req.id, method: req.method, path: req.url?.split('?')[0] }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  }));
  app.use(helmet({ contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } } }));
  if (support) app.use(['/customers', '/sessions', '/orders', '/conversations', '/handoffs', '/password-recovery'], browserSecurity(support.allowedOrigins));
  app.use(express.json({ limit: '16kb' }));
  app.use(createHealthRouter(checkDatabase));
  if (support) app.use(createSupportRouter(support));
  app.get('/openapi.json', (_req, res) => res.json(openapi));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi, {
    swaggerOptions: { validatorUrl: null, withCredentials: true, persistAuthorization: false },
  }));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
