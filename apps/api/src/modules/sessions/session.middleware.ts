import type { RequestHandler, Response } from 'express';
import { AppError, unauthenticated } from '../../errors/app-error.js';
import { readSessionCookie } from './session.cookie.js';
import type { AuthenticatedSession, SessionPolicy, SessionService } from './session.service.js';
import { validCsrf } from './session.tokens.js';

export function authenticate(service: SessionService, policy: SessionPolicy): RequestHandler {
  return async (req, res, next) => {
    res.locals.session = await service.authenticate(readSessionCookie(req, policy));
    next();
  };
}

export function currentSession(res: Response): AuthenticatedSession {
  const session: AuthenticatedSession | undefined = res.locals.session;
  if (!session) throw unauthenticated();
  return session;
}

export const requireCsrf: RequestHandler = (req, res, next) => {
  if (!validCsrf(currentSession(res).token, req.get('X-CSRF-Token'))) {
    throw new AppError(403, 'CSRF_INVALID', 'Invalid CSRF token');
  }
  next();
};
