import { describe, expect, it } from 'vitest';
import { parseEnv } from '../src/config/env-schema.js';

describe('environment validation', () => {
  const valid = { DATABASE_URL: 'postgresql://user:password@localhost:5433/support' };

  it('accepts the initial setup without an OpenAI key', () => {
    expect(parseEnv(valid)).toMatchObject({ API_PORT: 3000, NODE_ENV: 'development' });
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
