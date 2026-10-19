import type { RequestHandler } from 'express';
import { setSessionCookie } from '../sessions/session.cookie.js';
import type { SessionPolicy } from '../sessions/session.service.js';
import { csrfForToken } from '../sessions/session.tokens.js';
import { registerCustomerSchema } from './customer.schemas.js';
import type { createCustomerService } from './customer.service.js';

export function createCustomerController(service: ReturnType<typeof createCustomerService>, policy: SessionPolicy): RequestHandler {
  return async (req, res) => {
    const result = await service.register(registerCustomerSchema.parse(req.body));
    setSessionCookie(res, policy, result.token, result.expiresAt);
    res.status(201).json({
      customer: result.customer,
      session: { expiresAt: result.expiresAt },
      csrfToken: csrfForToken(result.token),
    });
  };
}
