import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

export function testDatabaseUrl(): string {
  config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)), quiet: true });
  const value = process.env.TEST_DATABASE_URL;
  if (!value) throw new Error('TEST_DATABASE_URL is required; use a dedicated database ending in _test');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Invalid TEST_DATABASE_URL'); }
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !/^[a-zA-Z0-9_]+_test$/.test(database)) {
    throw new Error('Integration tests require a dedicated PostgreSQL database ending in _test');
  }
  if (process.env.DATABASE_URL) {
    let application: URL | undefined;
    try { application = new URL(process.env.DATABASE_URL); } catch { /* Validada separadamente pela API. */ }
    if (application && application.hostname === url.hostname &&
        (application.port || '5432') === (url.port || '5432') &&
        decodeURIComponent(application.pathname.slice(1)) === database) {
      throw new Error('TEST_DATABASE_URL must differ from DATABASE_URL');
    }
  }
  return value;
}
