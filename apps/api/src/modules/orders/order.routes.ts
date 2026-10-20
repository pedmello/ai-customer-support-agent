import { Router } from 'express';
import { requireJson } from '../../middlewares/browser-security.js';
import { authenticate, requireCsrf } from '../sessions/session.middleware.js';
import type { SessionPolicy, SessionService } from '../sessions/session.service.js';
import { createOrderController } from './order.controller.js';
import type { createOrderService } from './order.service.js';

export function createOrderRouter(service: ReturnType<typeof createOrderService>, sessions: SessionService, policy: SessionPolicy) {
  const router = Router();
  const controller = createOrderController(service);
  router.use(authenticate(sessions, policy));
  router.get('/', controller.list);
  router.get('/by-number/:orderNumber', controller.getByNumber);
  router.get('/:orderId', controller.get);
  router.post('/:orderId/cancel', requireCsrf, requireJson, controller.cancel);
  return router;
}
