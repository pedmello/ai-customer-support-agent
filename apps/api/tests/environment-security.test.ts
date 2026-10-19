import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseEnv } from '../src/config/env-schema.js';
import { prepareSession } from '../src/modules/sessions/session.service.js';
import { testDatabaseUrl } from './helpers/test-database.js';

afterEach(() => vi.unstubAllEnvs());

describe('session configuration', () => {
  const valid = { DATABASE_URL: 'postgresql://user:password@localhost/support' };

  it.each([
    { ...valid, DATABASE_URL: 'private-invalid-secret' },
    { ...valid, API_PUBLIC_URL: 'private-invalid-secret' },
    { ...valid, WEB_ORIGIN: 'private-invalid-secret' },
    { ...valid, WEB_ORIGIN: 'https://example.test/path' },
    { ...valid, SESSION_TTL_SECONDS: '0' },
    { ...valid, SESSION_TTL_SECONDS: '604801' },
  ])('rejects invalid session/environment values without echoing secrets', (input) => {
    expect(() => parseEnv(input)).toThrow('Invalid environment variables:');
    try { parseEnv(input); } catch (error) { expect(String(error)).not.toContain('private-invalid-secret'); }
  });

  it('sets absolute expiration without relying on the database clock', () => {
    const now = new Date('2026-10-19T12:00:00.000Z');
    expect(prepareSession(86400, now).expiresAt.toISOString()).toBe('2026-10-20T12:00:00.000Z');
  });
});

describe('integration database safeguards', () => {
  it('rejects the application database before migrations or cleanup', () => {
    vi.stubEnv('TEST_DATABASE_URL', 'postgresql://user:secret@localhost/support_agent');
    expect(() => testDatabaseUrl()).toThrow('dedicated PostgreSQL database ending in _test');
  });

  it('rejects using the same configured database for application and tests', () => {
    const url = 'postgresql://user:secret@localhost/support_test';
    vi.stubEnv('DATABASE_URL', url);
    vi.stubEnv('TEST_DATABASE_URL', url);
    expect(() => testDatabaseUrl()).toThrow('must differ');
  });

  it('also detects the same database when credentials, default port or query differ', () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://app:secret@localhost/support_test?schema=public');
    vi.stubEnv('TEST_DATABASE_URL', 'postgresql://tests:other@localhost:5432/support_test');
    expect(() => testDatabaseUrl()).toThrow('must differ');
  });
});
