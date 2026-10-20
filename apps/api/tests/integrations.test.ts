import { describe, expect, it, vi, afterEach } from 'vitest';
import { createLogger } from '../src/config/logger.js';
import OpenAI from 'openai';
import { createFakeStoreClient } from '../src/integrations/fake-store/fake-store.client.js';
import { AiFailure, createOpenAiModel } from '../src/integrations/openai/openai.client.js';

const parse = vi.hoisted(() => vi.fn());
vi.mock('openai', async (importOriginal) => {
  const original = await importOriginal<typeof import('openai')>();
  class Client { responses = { parse }; static APIConnectionTimeoutError = original.default.APIConnectionTimeoutError; }
  return { ...original, default: Client };
});
const logger = createLogger('silent');
afterEach(() => vi.resetAllMocks());

describe('OpenAI SDK boundary (mocked)', () => {
  const model = () => createOpenAiModel({ apiKey: 'fake-test-key', model: 'configurable-test-model', timeoutMs: 1000, logger });
  it('uses structured intent, configured model, no server-side storage or tools', async () => {
    const intent = { intent: 'ORDER_STATUS', orderId: null, orderNumber: null, opening: 'GREETING' };
    parse.mockResolvedValue({ status: 'completed', output_parsed: intent });
    expect(await model().interpret({ content: 'pedido', history: [] })).toEqual(intent);
    expect(parse.mock.calls[0]![0]).toMatchObject({ model: 'configurable-test-model', store: false, max_output_tokens: 300 });
    expect(parse.mock.calls[0]![0]).not.toHaveProperty('tools');
    expect(parse.mock.calls[0]![0].input[0].role).toBe('system');
  });
  it.each([null, { intent: 'RUN_SQL', orderId: null, orderNumber: null, opening: 'NONE' }, { intent: 'HUMAN' }])('rejects missing/invalid structured output', async (output) => {
    parse.mockResolvedValue({ status: 'completed', output_parsed: output });
    await expect(model().interpret({ content: 'x', history: [] })).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
  });
  it('handles provider errors without exposing their content', async () => {
    parse.mockRejectedValue(new Error('private-api-key-and-request'));
    await expect(model().interpret({ content: 'x', history: [] })).rejects.toEqual(new AiFailure('AI_UNAVAILABLE'));
  });
  it('does not call an external service without a key', async () => {
    await expect(createOpenAiModel({ model: 'any', timeoutMs: 100, logger }).interpret({ content: 'x', history: [] })).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
    expect(parse).not.toHaveBeenCalled();
  });
  it('classifies SDK timeout separately', async () => {
    parse.mockRejectedValue(new OpenAI.APIConnectionTimeoutError());
    await expect(model().interpret({ content: 'x', history: [] })).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
  });
  it('rejects incomplete responses even with a parseable body', async () => {
    parse.mockResolvedValue({ status: 'incomplete', output_parsed: { intent: 'HUMAN', orderId: null, orderNumber: null, opening: 'NONE' } });
    await expect(model().interpret({ content: 'x', history: [] })).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
  });
});

describe('Fake Store HTTP boundary (mocked)', () => {
  function client(response: Response) {
    const http = vi.fn<typeof fetch>().mockResolvedValue(response);
    return { http, api: createFakeStoreClient({ timeoutMs: 1000, logger, fetch: http }) };
  }
  const product = { id: 1, title: 'Produto', description: 'Descrição', category: 'roupas', image: 'https://example.test/image.jpg', price: 99999 };
  it('validates the product and excludes external prices', async () => {
    const { api, http } = client(Response.json(product));
    const result = await api.getProduct(1);
    expect(result).toMatchObject({ status: 'AVAILABLE', product: { id: 1, title: 'Produto' } });
    expect(result).toHaveProperty('product');
    expect(JSON.stringify(result)).not.toContain('99999');
    expect(http.mock.calls[0]![0]).toBe('https://fakestoreapi.com/products/1');
    expect(http.mock.calls[0]![1]).toMatchObject({ redirect: 'error' });
  });
  it.each([new Response(null, { status: 404 }), Response.json(null)])('handles missing products', async (response) => {
    expect(await client(response).api.getProduct(1)).toMatchObject({ status: 'NOT_FOUND' });
  });
  it.each([Response.json({ ...product, id: 2 }), Response.json({ ...product, image: 'javascript:alert(1)' }), Response.json({}), new Response('not JSON'), new Response('x'.repeat(33000)), new Response(null, { status: 503 })])('degrades safely on invalid/unavailable responses', async (response) => {
    expect(await client(response).api.getProduct(1)).toMatchObject({ status: 'UNAVAILABLE' });
  });
  it('handles timeout without leaking an upstream error', async () => {
    const http = vi.fn<typeof fetch>().mockRejectedValue(new DOMException('private', 'TimeoutError'));
    const api = createFakeStoreClient({ timeoutMs: 100, logger, fetch: http });
    expect(await api.getProduct(1)).toMatchObject({ status: 'UNAVAILABLE', code: 'PRODUCT_TIMEOUT' });
  });
});
