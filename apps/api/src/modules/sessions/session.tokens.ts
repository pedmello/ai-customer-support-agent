import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const newSessionToken = () => randomBytes(32).toString('base64url');
export const hashSessionToken = (token: string) => createHash('sha256').update(token).digest('hex');

// Derivação com domínio separado: o hash persistido da sessão não permite obter o CSRF.
export const csrfForToken = (token: string) =>
  createHmac('sha256', token).update('support-agent:csrf:v1').digest('base64url');

export function validCsrf(token: string, supplied: string | undefined): boolean {
  if (!supplied || !/^[A-Za-z0-9_-]{43}$/.test(supplied)) return false;
  return timingSafeEqual(Buffer.from(csrfForToken(token)), Buffer.from(supplied));
}
