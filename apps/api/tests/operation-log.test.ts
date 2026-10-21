import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../src/config/logger.js';
import { observeOperation, requestCorrelation } from '../src/config/operation-log.js';
import { AppError } from '../src/errors/app-error.js';
import { createFakeStoreClient } from '../src/integrations/fake-store/fake-store.client.js';

describe('allowlisted operation logs', () => {
  it('keeps concurrent request correlation isolated and never logs operation payloads', async () => {
    const logger = createLogger('silent'), info = vi.spyOn(logger, 'info');
    await Promise.all(['request-a', 'request-b'].map(requestId => requestCorrelation.run(requestId, () =>
      observeOperation(logger, 'agent.turn', async () => { await Promise.resolve(); return { password: 'never-log-this' }; },
        () => ({ result: 'ORDER_STATUS', replayed: false })))));
    expect(info.mock.calls.map(call => call[0])).toEqual(expect.arrayContaining([
      expect.objectContaining({ requestId: 'request-a', event: 'agent.turn', durationMs: expect.any(Number) }),
      expect.objectContaining({ requestId: 'request-b', event: 'agent.turn' }),
    ]));
    expect(JSON.stringify(info.mock.calls)).not.toContain('never-log-this');
    expect(requestCorrelation.getStore()).toBeUndefined();
  });
  it('preserves exceptions, hides their messages and logs only controlled failure codes', async () => {
    const logger = createLogger('silent'), warn = vi.spyOn(logger, 'warn');
    const error = new AppError(409, 'ORDER_ALREADY_CANCELLED', 'private detail');
    await expect(observeOperation(logger, 'orders.cancel', async () => { throw error; }, () => ({ result: 'impossible' }))).rejects.toBe(error);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ result: 'ORDER_ALREADY_CANCELLED' }), expect.any(String));
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private detail');
  });
  it('records successful and degraded Fake Store lookups without external text', async () => {
    const logger = createLogger('silent'), info = vi.spyOn(logger, 'info'), warn = vi.spyOn(logger, 'warn');
    const http = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ id: 2, title: 'private external text',
      description: 'private description', category: 'demo', image: 'https://fakestoreapi.com/image.jpg' }))
      .mockRejectedValueOnce(new DOMException('private network detail', 'TimeoutError'));
    const client = createFakeStoreClient({ logger, timeoutMs: 100, fetch: http });
    await requestCorrelation.run('request-test', async () => { await client.getProduct(2); await client.getProduct(2); });
    expect(info).toHaveBeenCalledWith(expect.objectContaining({ event: 'fake_store.lookup', result: 'AVAILABLE', requestId: 'request-test', durationMs: expect.any(Number) }), expect.any(String));
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ result: 'PRODUCT_TIMEOUT' }), expect.any(String));
    expect(JSON.stringify([info.mock.calls, warn.mock.calls])).not.toMatch(/private/);
  });
});
