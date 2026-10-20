import { describe, expect, it } from 'vitest';
import { parseEnv } from '../src/config/env-schema.js';

describe('environment validation', () => {
  const valid = { DATABASE_URL: 'postgresql://user:password@localhost:5433/support' };

  it('accepts the initial setup without an OpenAI key', () => {
    expect(parseEnv(valid)).toMatchObject({ API_PORT: 3000, NODE_ENV: 'development' });
  });
  it('keeps email disabled until deliberately configured', () => {
    expect(parseEnv(valid)).toMatchObject({ EMAIL_PROVIDER: 'disabled', EMAIL_TIMEOUT_MS: 3000,
      PASSWORD_RESET_TTL_SECONDS: 600, PASSWORD_RESET_MAX_ATTEMPTS: 5, PASSWORD_RESET_RESEND_SECONDS: 60 });
  });
  it.each([
    { EMAIL_PROVIDER: 'resend' },
    { PASSWORD_RESET_HMAC_SECRET: 'short-secret' },
    { PASSWORD_RESET_MAX_ATTEMPTS: 6 },
    { PASSWORD_RESET_TTL_SECONDS: 601 },
    { PASSWORD_RESET_RESEND_SECONDS: 59 },
    { EMAIL_PROVIDER: 'resend', EMAIL_FROM: 'bad\r\nsender@example.test', RESEND_API_KEY: 'test-key', PASSWORD_RESET_HMAC_SECRET: 'x'.repeat(32) },
  ])('rejects incomplete or unsafe recovery configuration', (fields) => {
    expect(() => parseEnv({ ...valid, ...fields })).toThrow('Invalid environment variables:');
  });

  it.each([
    {},
    { ...valid, DATABASE_URL: 'https://example.com' },
    { ...valid, API_PORT: '0' },
    { ...valid, API_PORT: '65536' },
    { ...valid, LOG_LEVEL: 'invalid' },
  ])('rejects invalid configuration without including its values', (input) => {
    expect(() => parseEnv(input)).toThrow('Invalid environment variables:');
    try { parseEnv(input); } catch (error) {
      expect(String(error)).not.toContain('password');
    }
  });
});
