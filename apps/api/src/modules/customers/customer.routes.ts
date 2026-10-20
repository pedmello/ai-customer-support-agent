import { Router } from 'express';
import { requireJson } from '../../middlewares/browser-security.js';
import type { SessionPolicy } from '../sessions/session.service.js';
import { createCustomerController } from './customer.controller.js';
import type { createCustomerService } from './customer.service.js';
import type { AuthService } from '../auth/auth.service.js';
import { requestOrigin } from '../auth/auth.controller.js';

export function createCustomerRouter(service: ReturnType<typeof createCustomerService>, policy: SessionPolicy, auth: AuthService) {
  const router = Router();
  router.post('/', requireJson, async (req, _res, next) => {
    await auth.registrationAllowed(requestOrigin(req));
    next();
  }, createCustomerController(service, policy));
  return router;
}
