import { Router } from 'express';
import { createSessionController } from './session.controller.js';
import { authenticate, requireCsrf } from './session.middleware.js';
import type { SessionPolicy, SessionService } from './session.service.js';
import type { AuthService } from '../auth/auth.service.js';
import { createAuthController } from '../auth/auth.controller.js';
import { requireJson } from '../../middlewares/browser-security.js';

export function createSessionRouter(service: SessionService, policy: SessionPolicy, auth: AuthService) {
  const router = Router();
  const controller = createSessionController(service, policy);
  router.post('/', requireJson, createAuthController(auth, policy).login);
  router.use(authenticate(service, policy));
  router.get('/current', controller.get);
  router.delete('/current', requireCsrf, controller.revoke);
  return router;
}
