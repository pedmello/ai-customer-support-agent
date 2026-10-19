import { Router } from 'express';
import { requireJson } from '../../middlewares/browser-security.js';
import { authenticate, requireCsrf } from '../sessions/session.middleware.js';
import type { SessionPolicy, SessionService } from '../sessions/session.service.js';
import type { createHandoffController } from './handoff.controller.js';
export function createHandoffRouter(controller: ReturnType<typeof createHandoffController>, sessions: SessionService, policy: SessionPolicy) {
  const router = Router();
  router.use(authenticate(sessions, policy));
  router.post('/', requireCsrf, requireJson, controller.register);
  return router;
}
