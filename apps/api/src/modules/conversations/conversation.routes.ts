import { Router } from 'express';
import { requireJson } from '../../middlewares/browser-security.js';
import { authenticate, requireCsrf } from '../sessions/session.middleware.js';
import type { SessionPolicy, SessionService } from '../sessions/session.service.js';
import type { createConversationController } from './conversation.controller.js';
export function createConversationRouter(controller: ReturnType<typeof createConversationController>, sessions: SessionService, policy: SessionPolicy) {
  const router = Router();
  router.use(authenticate(sessions, policy));
  router.post('/', requireCsrf, requireJson, controller.create);
  router.get('/', controller.list);
  router.get('/:conversationId', controller.history);
  router.post('/:conversationId/messages', requireCsrf, requireJson, controller.send);
  return router;
}
