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
import { createConversationRepository } from './conversations/conversation.repository.js';
import { createConversationService } from './conversations/conversation.service.js';
import { createConversationController } from './conversations/conversation.controller.js';
import { createConversationRouter } from './conversations/conversation.routes.js';
import { createAgentOrchestrator, type AgentDependencies } from './agent/agent.orchestrator.js';
import { createHandoffRepository } from './handoffs/handoff.repository.js';
import { createHandoffService } from './handoffs/handoff.service.js';
import { createHandoffController } from './handoffs/handoff.controller.js';
import { createHandoffRouter } from './handoffs/handoff.routes.js';

export interface SupportDependencies {
  database: PrismaClient;
  sessionPolicy: SessionPolicy;
  allowedOrigins: readonly string[];
  agent?: AgentDependencies;
}

export function createSupportRouter({ database, sessionPolicy, agent }: SupportDependencies) {
  const router = Router();
  const sessions = createSessionService(createSessionRepository(database));
  const customers = createCustomerService(createCustomerRepository(database), sessionPolicy.ttlSeconds);
  const orders = createOrderService(createOrderRepository(database));
  router.use('/customers', createCustomerRouter(customers, sessionPolicy));
  router.use('/sessions', createSessionRouter(sessions, sessionPolicy));
  router.use('/orders', createOrderRouter(orders, sessions, sessionPolicy));
  const handoffs = createHandoffService({
    register: (customerId, reason, conversationId) => database.$transaction((tx) =>
      createHandoffRepository(tx).register(customerId, reason, conversationId)),
  });
  router.use('/handoffs', createHandoffRouter(createHandoffController(handoffs), sessions, sessionPolicy));
  if (agent) {
    const repository = createConversationRepository(database);
    const controller = createConversationController(createConversationService(repository), createAgentOrchestrator(database, repository, agent));
    router.use('/conversations', createConversationRouter(controller, sessions, sessionPolicy));
  }
  return router;
}
