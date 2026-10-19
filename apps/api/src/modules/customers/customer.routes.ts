import { Router } from 'express';
import { requireJson } from '../../middlewares/browser-security.js';
import type { SessionPolicy } from '../sessions/session.service.js';
import { createCustomerController } from './customer.controller.js';
import type { createCustomerService } from './customer.service.js';

export function createCustomerRouter(service: ReturnType<typeof createCustomerService>, policy: SessionPolicy) {
  const router = Router();
  router.post('/', requireJson, createCustomerController(service, policy));
  return router;
}
