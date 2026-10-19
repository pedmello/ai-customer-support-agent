import type { RequestHandler } from 'express';
import { clearSessionCookie } from './session.cookie.js';
import { currentSession } from './session.middleware.js';
import type { SessionPolicy, SessionService } from './session.service.js';
import { csrfForToken } from './session.tokens.js';

export function createSessionController(service: SessionService, policy: SessionPolicy) {
  const get: RequestHandler = (_req, res) => {
    const session = currentSession(res);
    res.json({ customer: session.customer, session: { expiresAt: session.expiresAt }, csrfToken: csrfForToken(session.token) });
  };
  const revoke: RequestHandler = async (_req, res) => {
    await service.revoke(currentSession(res));
    clearSessionCookie(res, policy);
    res.sendStatus(204);
  };
  return { get, revoke };
}
