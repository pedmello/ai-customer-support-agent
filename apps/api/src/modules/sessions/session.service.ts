import { unauthenticated } from '../../errors/app-error.js';
import type { SessionRepository } from './session.repository.js';
import { hashSessionToken, newSessionToken } from './session.tokens.js';

export interface SessionPolicy {
  ttlSeconds: number;
  secure: boolean;
}

export const defaultSessionPolicy: SessionPolicy = { ttlSeconds: 86400, secure: false };

export type AuthenticatedSession = NonNullable<Awaited<ReturnType<SessionRepository['findActive']>>> & { token: string };

export function prepareSession(ttlSeconds: number, now = new Date()) {
  const token = newSessionToken();
  return {
    token,
    tokenHash: hashSessionToken(token),
    expiresAt: new Date(now.getTime() + ttlSeconds * 1000),
  };
}

export function createSessionService(repository: SessionRepository) {
  return {
    async authenticate(token: string | undefined) {
      if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw unauthenticated();
      const session = await repository.findActive(hashSessionToken(token), new Date());
      if (!session) throw unauthenticated();
      return { ...session, token };
    },
    async revoke(session: AuthenticatedSession) {
      await repository.revoke(session.sessionId, session.customerId, new Date());
    },
  };
}

export type SessionService = ReturnType<typeof createSessionService>;
