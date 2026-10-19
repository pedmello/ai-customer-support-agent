import type { RequestHandler } from 'express';
import { currentSession } from '../sessions/session.middleware.js';
import type { createAgentOrchestrator } from '../agent/agent.orchestrator.js';
import type { createConversationService } from './conversation.service.js';
import { conversationParams, createConversationSchema, pageSchema, sendMessageSchema } from './conversation.schemas.js';

export function createConversationController(service: ReturnType<typeof createConversationService>, agent: ReturnType<typeof createAgentOrchestrator>) {
  const create: RequestHandler = async (req, res) => {
    createConversationSchema.parse(req.body);
    res.status(201).json({ data: await service.create(currentSession(res).customerId) });
  };
  const list: RequestHandler = async (req, res) => {
    const { page, pageSize } = pageSchema.parse(req.query);
    res.json(await service.listOwn(currentSession(res).customerId, page, pageSize));
  };
  const history: RequestHandler = async (req, res) => {
    const { conversationId } = conversationParams.parse(req.params);
    const { page, pageSize } = pageSchema.parse(req.query);
    res.json(await service.history(currentSession(res).customerId, conversationId, page, pageSize));
  };
  const send: RequestHandler = async (req, res) => {
    const { conversationId } = conversationParams.parse(req.params);
    res.json(await agent.send(currentSession(res).customerId, conversationId, sendMessageSchema.parse(req.body)));
  };
  return { create, list, history, send };
}
