import { Router } from 'express';
import type { PrismaClient } from '../generated/prisma/client.js';
import { createCustomerRepository } from './customers/customer.repository.js';
import { createCustomerRouter } from './customers/customer.routes.js';
import { createCustomerService } from './customers/customer.service.js';
import { createOrderRepository } from './orders/order.repository.js';
import { createOrderRouter } from './orders/order.routes.js';
import { createOrderService } from './orders/order.service.js';
import { createSessionRepository } from './sessions/session.repository.js';
import { createSessionRouter } from './sessions/session.routes.js';
import { createSessionService, type SessionPolicy } from './sessions/session.service.js';

export interface SupportDependencies {
  database: PrismaClient;
  sessionPolicy: SessionPolicy;
  allowedOrigins: readonly string[];
}

export function createSupportRouter({ database, sessionPolicy }: SupportDependencies) {
  const router = Router();
  const sessions = createSessionService(createSessionRepository(database));
  const customers = createCustomerService(createCustomerRepository(database), sessionPolicy.ttlSeconds);
  const orders = createOrderService(createOrderRepository(database));
  router.use('/customers', createCustomerRouter(customers, sessionPolicy));
  router.use('/sessions', createSessionRouter(sessions, sessionPolicy));
  router.use('/orders', createOrderRouter(orders, sessions, sessionPolicy));
  return router;
}
