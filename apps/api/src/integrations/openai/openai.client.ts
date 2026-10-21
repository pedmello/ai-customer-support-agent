import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import type { Logger } from 'pino';
import { AGENT_SYSTEM_PROMPT } from './agent.prompt.js';
import { AiFailure, providerIntentSchema, type IntentModel } from '../ai/intent-model.js';
// Preserve existing imports while both providers share the same contract.
export { AiFailure, intentSchema, type AgentIntent, type ModelInput, type IntentModel } from '../ai/intent-model.js';

export function createOpenAiModel(options: { apiKey?: string; model: string; timeoutMs: number; logger: Logger }): IntentModel {
  const client = options.apiKey ? new OpenAI({ apiKey: options.apiKey, timeout: options.timeoutMs, maxRetries: 0 }) : null;
  return {
    async interpret(input) {
      if (!client) throw new AiFailure('AI_UNAVAILABLE');
      try {
        const response = await client.responses.parse({
          model: options.model, store: false, max_output_tokens: 600,
          input: [
            { role: 'system', content: AGENT_SYSTEM_PROMPT },
            // Historical messages never become system/developer instructions.
            { role: 'user', content: JSON.stringify({ untrustedHistory: input.history, currentMessage: input.content }) },
          ],
          text: { format: zodTextFormat(providerIntentSchema, 'support_intent') },
        });
        const parsed = providerIntentSchema.safeParse(response.output_parsed);
        if (response.status !== 'completed' || !parsed.success) throw new AiFailure('AI_INVALID_RESPONSE');
        return parsed.data;
      } catch (error) {
        const code = error instanceof AiFailure ? error.code : error instanceof OpenAI.APIConnectionTimeoutError ? 'AI_TIMEOUT' : 'AI_UNAVAILABLE';
        options.logger.warn({ integration: 'openai', code }, 'Intent interpretation failed');
        throw new AiFailure(code);
      }
    },
  };
}
