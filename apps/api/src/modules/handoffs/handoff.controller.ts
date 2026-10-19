import type { RequestHandler } from 'express';
import { currentSession } from '../sessions/session.middleware.js';
import { handoffSchema } from './handoff.schemas.js';
import type { createHandoffService } from './handoff.service.js';
export function createHandoffController(service: ReturnType<typeof createHandoffService>) {
  const register: RequestHandler = async (req, res) => {
    const input = handoffSchema.parse(req.body);
    res.status(201).json({ data: await service.register(currentSession(res).customerId, input.reason, input.conversationId) });
  };
  return { register };
}
