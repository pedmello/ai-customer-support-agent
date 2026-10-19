import type { Logger } from 'pino';
import type { parseEnv } from '../../config/env-schema.js';
import { createOpenAiModel } from '../openai/openai.client.js';
import { createGeminiModel } from '../gemini/gemini.client.js';
import type { IntentModel } from './intent-model.js';

export function createIntentModel(env: ReturnType<typeof parseEnv>, logger: Logger): IntentModel {
  if (env.AI_PROVIDER === 'gemini') {
    return createGeminiModel({ ...(env.GEMINI_API_KEY ? { apiKey: env.GEMINI_API_KEY } : {}), model: env.GEMINI_MODEL, timeoutMs: env.GEMINI_TIMEOUT_MS, logger });
  }
  return createOpenAiModel({ ...(env.OPENAI_API_KEY ? { apiKey: env.OPENAI_API_KEY } : {}), model: env.OPENAI_MODEL, timeoutMs: env.OPENAI_TIMEOUT_MS, logger });
}
