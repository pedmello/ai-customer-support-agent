import { describe, expect, it } from 'vitest';
import { csrfForToken, hashSessionToken, newSessionToken, validCsrf } from '../src/modules/sessions/session.tokens.js';
import { registerCustomerSchema } from '../src/modules/customers/customer.schemas.js';

describe('session secrets', () => {
  it('generates opaque 256-bit tokens and stores a distinct hash', () => {
    const first = newSessionToken();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newSessionToken()).not.toBe(first);
    expect(hashSessionToken(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashSessionToken(first)).not.toContain(first);
  });

  it('binds CSRF to the secret session token without exposing it', () => {
    const token = newSessionToken();
    const csrf = csrfForToken(token);
    expect(csrf).not.toBe(token);
    expect(csrf).not.toBe(hashSessionToken(token));
    expect(validCsrf(token, csrf)).toBe(true);
    expect(validCsrf(newSessionToken(), csrf)).toBe(false);
    expect(validCsrf(token, undefined)).toBe(false);
    expect(validCsrf(token, 'invalid')).toBe(false);
  });
});

describe('customer input', () => {
  it('trims names and normalizes email case and surrounding whitespace', () => {
    expect(registerCustomerSchema.parse({ name: '  Ana Silva  ', email: '  ANA@Example.COM  ' }))
      .toEqual({ name: 'Ana Silva', email: 'ana@example.com' });
  });

  it.each([
    { name: '', email: 'ana@example.com' },
    { name: '   ', email: 'ana@example.com' },
    { name: 'Ana', email: 'invalid' },
    { name: 'Ana', email: 'ana@example.com', customerId: 'supplied' },
  ])('rejects invalid or unexpected input', (input) => {
    expect(registerCustomerSchema.safeParse(input).success).toBe(false);
  });
});
