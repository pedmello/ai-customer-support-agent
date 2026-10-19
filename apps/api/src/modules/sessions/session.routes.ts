import { Router } from 'express';
import { createSessionController } from './session.controller.js';
import { authenticate, requireCsrf } from './session.middleware.js';
import type { SessionPolicy, SessionService } from './session.service.js';

export function createSessionRouter(service: SessionService, policy: SessionPolicy) {
  const router = Router();
  const controller = createSessionController(service, policy);
  router.use(authenticate(service, policy));
  router.get('/current', controller.get);
  router.delete('/current', requireCsrf, controller.revoke);
  return router;
}
