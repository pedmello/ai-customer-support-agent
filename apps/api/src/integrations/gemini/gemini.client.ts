import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import type { Logger } from 'pino';
import { AiFailure, intentSchema, type IntentModel } from '../ai/intent-model.js';
import { AGENT_SYSTEM_PROMPT } from '../openai/agent.prompt.js';

function classifyFailure(error: unknown, aborted: boolean) {
  const value = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
  const status = typeof value === 'number' && Number.isInteger(value) && value >= 400 && value <= 599 ? value : undefined;
  if (error instanceof AiFailure) return { code: error.code, category: 'INVALID_RESPONSE', status };
  if (aborted || (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name))) {
    return { code: 'AI_TIMEOUT' as const, category: 'DEADLINE', status };
  }
  if (status === 504 || status === 408) return { code: 'AI_TIMEOUT' as const, category: 'PROVIDER_TIMEOUT', status };
  return { code: 'AI_UNAVAILABLE' as const,
    category: status === 429 ? 'RATE_LIMIT' : status === 401 || status === 403 ? 'AUTHORIZATION' : status ? 'PROVIDER_HTTP' : 'NETWORK_OR_SDK', status };
}

export function createGeminiModel(options: { apiKey?: string; model: string; timeoutMs: number; logger: Logger }): IntentModel {
  const client = options.apiKey ? new GoogleGenAI({
    apiKey: options.apiKey, vertexai: false,
    httpOptions: { timeout: options.timeoutMs, retryOptions: { attempts: 1 } },
  }) : null;
  return {
    async interpret(input) {
      if (!client) throw new AiFailure('AI_UNAVAILABLE');
      const started = Date.now();
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), options.timeoutMs).unref();
      const { signal } = controller;
      try {
        for (let attempt = 1; attempt <= 2; attempt++) {
          const attemptStarted = Date.now();
          try {
            const response = await client.models.generateContent({
              model: options.model,
              contents: [{ role: 'user', parts: [{ text: JSON.stringify({ untrustedHistory: input.history, currentMessage: input.content }) }] }],
              config: {
                systemInstruction: AGENT_SYSTEM_PROMPT,
                responseMimeType: 'application/json',
                responseJsonSchema: z.toJSONSchema(intentSchema, { target: 'draft-7' }),
                maxOutputTokens: 1024,
                candidateCount: 1,
                automaticContinuation: false,
                abortSignal: signal,
              },
            });
            if (response.promptFeedback?.blockReason || response.candidates?.length !== 1 ||
                response.candidates[0]?.finishReason !== 'STOP' || !response.text) {
              throw new AiFailure('AI_INVALID_RESPONSE');
            }
            let value: unknown;
            try { value = JSON.parse(response.text); } catch { throw new AiFailure('AI_INVALID_RESPONSE'); }
            const parsed = intentSchema.safeParse(value);
            if (!parsed.success) throw new AiFailure('AI_INVALID_RESPONSE');
            options.logger.info({ integration: 'gemini', provider: 'gemini', model: options.model, attempt,
              durationMs: Date.now() - attemptStarted, totalDurationMs: Date.now() - started, category: 'SUCCESS' }, 'Intent interpretation completed');
            return parsed.data;
          } catch (error) {
            const failure = classifyFailure(error, signal.aborted);
            const retry = attempt === 1 && !signal.aborted && [502, 503, 504].includes(failure.status ?? 0) &&
              Date.now() - started + 250 < options.timeoutMs;
            // Only allowlisted metadata; never SDK messages, headers, prompts or raw errors.
            options.logger.warn({ integration: 'gemini', provider: 'gemini', model: options.model, attempt,
              durationMs: Date.now() - attemptStarted, totalDurationMs: Date.now() - started,
              ...failure, retry }, 'Intent interpretation failed');
            if (!retry) throw new AiFailure(failure.code);
            // Retry only inference; the orchestrator has not executed any database operation.
            await new Promise<void>((resolve) => {
              const timer = setTimeout(done, 250);
              function done() { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); }
              signal.addEventListener('abort', done, { once: true });
            });
            if (signal.aborted) throw new AiFailure('AI_TIMEOUT');
          }
        }
        throw new AiFailure('AI_UNAVAILABLE');
      } finally {
        clearTimeout(deadline);
      }
    },
  };
}
