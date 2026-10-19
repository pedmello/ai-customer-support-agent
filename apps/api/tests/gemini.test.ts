import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '../src/config/logger.js';
import { parseEnv } from '../src/config/env-schema.js';
import { createGeminiModel } from '../src/integrations/gemini/gemini.client.js';
import { createIntentModel } from '../src/integrations/ai/model.factory.js';

const { generateContent, construct } = vi.hoisted(() => ({ generateContent: vi.fn(), construct: vi.fn() }));
vi.mock('@google/genai', () => ({ GoogleGenAI: class {
  constructor(options: unknown) { construct(options); }
  models = { generateContent };
} }));
const logger = createLogger('silent');
const input = { content: 'Consultar pedido', history: [] };
const intent = { intent: 'ORDER_STATUS', orderId: null, opening: 'NONE' };
const model = () => createGeminiModel({ apiKey: 'fake-test-key', model: 'configured-model', timeoutMs: 1000, logger });
afterEach(() => { vi.resetAllMocks(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('Gemini SDK boundary (mocked, no external calls)', () => {
  it('uses the configured model and JSON Schema, keeping history in untrusted user data', async () => {
    generateContent.mockResolvedValue({ text: JSON.stringify(intent), candidates: [{ finishReason: 'STOP' }] });
    expect(await model().interpret(input)).toEqual(intent);
    expect(construct).toHaveBeenCalledWith(expect.objectContaining({ vertexai: false, httpOptions: { timeout: 1000, retryOptions: { attempts: 1 } } }));
    const request = generateContent.mock.calls[0]![0];
    expect(request).toMatchObject({ model: 'configured-model', config: { responseMimeType: 'application/json', maxOutputTokens: 1024, responseJsonSchema: { type: 'object' } } });
    expect(request.config.systemInstruction).toContain('Você interpreta');
    expect(request.contents[0]).toMatchObject({ role: 'user', parts: [{ text: JSON.stringify({ untrustedHistory: [], currentMessage: input.content }) }] });
    expect(request.config).not.toHaveProperty('tools');
  });
  it.each([
    {}, { text: 'not JSON', candidates: [{ finishReason: 'STOP' }] },
    { text: JSON.stringify({ ...intent, intent: 'RUN_SQL' }), candidates: [{ finishReason: 'STOP' }] },
    { text: JSON.stringify({ ...intent, extra: 'untrusted' }), candidates: [{ finishReason: 'STOP' }] },
    { text: JSON.stringify(intent), candidates: [{ finishReason: 'MAX_TOKENS' }] },
    { text: JSON.stringify(intent), candidates: [{ finishReason: 'SAFETY' }] },
    { text: JSON.stringify(intent), promptFeedback: { blockReason: 'SAFETY' }, candidates: [{ finishReason: 'STOP' }] },
  ])('rejects invalid, blocked or incomplete output', async (response) => {
    generateContent.mockResolvedValue(response);
    await expect(model().interpret(input)).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
  });
  it.each([401, 403, 429, 503])('normalizes upstream failure %i without leaking provider content', async (status) => {
    generateContent.mockRejectedValue(Object.assign(new Error('private-key-and-request'), { status }));
    await expect(model().interpret(input)).rejects.toMatchObject({ message: 'AI_UNAVAILABLE', code: 'AI_UNAVAILABLE' });
  });
  it('normalizes SDK timeout', async () => {
    generateContent.mockRejectedValue(new DOMException('private', 'TimeoutError'));
    await expect(model().interpret(input)).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
  });
  it('classifies HTTP 504 as a provider timeout, retaining only safe diagnostic fields', async () => {
    const warn = vi.spyOn(logger, 'warn');
    generateContent.mockRejectedValue(Object.assign(new Error('private-key-and-content'), { status: 504 }));
    await expect(model().interpret(input)).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ provider: 'gemini', model: 'configured-model', status: 504, category: 'PROVIDER_TIMEOUT', durationMs: expect.any(Number) }), expect.any(String));
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private-key-and-content');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('fake-test-key');
  });
  it.each([502, 503, 504])('retries HTTP %i once within inference and validates the successful response', async (status) => {
    generateContent.mockRejectedValueOnce(Object.assign(new Error('private'), { status }))
      .mockResolvedValueOnce({ text: JSON.stringify(intent), candidates: [{ finishReason: 'STOP' }] });
    expect(await model().interpret(input)).toEqual(intent);
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(generateContent.mock.calls[0]![0].config.abortSignal).toBe(generateContent.mock.calls[1]![0].config.abortSignal);
  });
  it.each([400, 401, 403, 429])('does not retry HTTP %i', async (status) => {
    generateContent.mockRejectedValue(Object.assign(new Error('private'), { status }));
    await expect(model().interpret(input)).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
  it('does not retry invalid output', async () => {
    generateContent.mockResolvedValue({ text: '{}', candidates: [{ finishReason: 'STOP' }] });
    await expect(model().interpret(input)).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
  it('aborts the SDK at the total deadline and does not start another attempt', async () => {
    vi.useFakeTimers();
    generateContent.mockImplementation(({ config }) => new Promise((_, reject) => {
      config.abortSignal.addEventListener('abort', () => reject(new Error('private wrapped abort')), { once: true });
    }));
    const result = model().interpret(input);
    const assertion = expect(result).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
  it('keeps a retry inside the original total deadline', async () => {
    vi.useFakeTimers();
    generateContent.mockImplementationOnce(async () => {
      await new Promise(resolve => setTimeout(resolve, 600));
      throw Object.assign(new Error('private'), { status: 503 });
    }).mockImplementationOnce(({ config }) => new Promise((_, reject) => {
      config.abortSignal.addEventListener('abort', () => reject(new Error('wrapped')), { once: true });
    }));
    const result = model().interpret(input);
    const assertion = expect(result).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(generateContent).toHaveBeenCalledTimes(2);
  });
  it('does not instantiate the SDK or call the API without a key', async () => {
    await expect(createGeminiModel({ model: 'any', timeoutMs: 100, logger }).interpret(input)).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
    expect(construct).not.toHaveBeenCalled();
    expect(generateContent).not.toHaveBeenCalled();
  });
});

describe('provider configuration', () => {
  const base = { DATABASE_URL: 'postgresql://user:example@localhost/support' };
  it('defaults to OpenAI for existing deployments and supports explicit Gemini selection', async () => {
    expect(parseEnv(base).AI_PROVIDER).toBe('openai');
    const config = parseEnv({ ...base, AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'fake-test-key' });
    generateContent.mockResolvedValue({ text: JSON.stringify(intent), candidates: [{ finishReason: 'STOP' }] });
    expect(await createIntentModel(config, logger).interpret(input)).toEqual(intent);
  });
  it('keeps OpenAI available without falling back automatically to another provider', async () => {
    const config = parseEnv({ ...base, AI_PROVIDER: 'openai', GEMINI_API_KEY: 'fake-test-key' });
    await expect(createIntentModel(config, logger).interpret(input)).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
    expect(construct).not.toHaveBeenCalled();
  });
  it.each([{ AI_PROVIDER: 'invalid' }, { GEMINI_MODEL: ' ' }, { GEMINI_TIMEOUT_MS: 0 }, { GEMINI_TIMEOUT_MS: 30001 }])('rejects invalid provider configuration', (extra) => {
    expect(() => parseEnv({ ...base, ...extra })).toThrow('Invalid environment variables:');
  });
});
