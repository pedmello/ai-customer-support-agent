import type { CookieOptions, Request, Response } from 'express';
import type { SessionPolicy } from './session.service.js';

export const sessionCookieName = (policy: SessionPolicy) => policy.secure ? '__Host-support_session' : 'support_session';

export function readSessionCookie(req: Request, policy: SessionPolicy): string | undefined {
  const name = sessionCookieName(policy);
  const entries = (req.headers.cookie ?? '').split(';').map((entry) => entry.trim())
    .filter((entry) => entry.startsWith(`${name}=`));
  // Não escolher silenciosamente entre cookies duplicados ou ambíguos.
  return entries.length === 1 ? entries[0]!.slice(name.length + 1) : undefined;
}

const cookieOptions = (policy: SessionPolicy): CookieOptions => ({
  httpOnly: true, secure: policy.secure, sameSite: 'lax', path: '/',
});

export function setSessionCookie(res: Response, policy: SessionPolicy, token: string, expiresAt: Date) {
  res.cookie(sessionCookieName(policy), token, { ...cookieOptions(policy), expires: expiresAt });
}

export function clearSessionCookie(res: Response, policy: SessionPolicy) {
  res.clearCookie(sessionCookieName(policy), cookieOptions(policy));
}
