import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import type { Logger } from 'pino';
import { AGENT_SYSTEM_PROMPT } from './agent.prompt.js';

export const intentSchema = z.object({
  intent: z.enum(['ORDER_STATUS', 'ORDER_PRODUCTS', 'REQUEST_CANCEL', 'CONFIRM_CANCEL', 'DECLINE_CANCEL', 'HUMAN', 'OUT_OF_SCOPE', 'UNKNOWN']),
  orderId: z.string().nullable(),
  opening: z.enum(['GREETING', 'ACKNOWLEDGE', 'NONE']),
}).strict();
export type AgentIntent = z.infer<typeof intentSchema>;
export interface ModelInput { content: string; history: Array<{ role: 'USER' | 'ASSISTANT'; content: string }> }
export interface IntentModel { interpret(input: ModelInput): Promise<AgentIntent> }
export class AiFailure extends Error {
  constructor(public readonly code: 'AI_UNAVAILABLE' | 'AI_TIMEOUT' | 'AI_INVALID_RESPONSE') { super(code); }
}

export function createOpenAiModel(options: { apiKey?: string; model: string; timeoutMs: number; logger: Logger }): IntentModel {
  const client = options.apiKey ? new OpenAI({ apiKey: options.apiKey, timeout: options.timeoutMs, maxRetries: 0 }) : null;
  return {
    async interpret(input) {
      if (!client) throw new AiFailure('AI_UNAVAILABLE');
      try {
        const response = await client.responses.parse({
          model: options.model, store: false, max_output_tokens: 300,
          input: [
            { role: 'system', content: AGENT_SYSTEM_PROMPT },
            // Historical messages never become system/developer instructions.
            { role: 'user', content: JSON.stringify({ untrustedHistory: input.history, currentMessage: input.content }) },
          ],
          text: { format: zodTextFormat(intentSchema, 'support_intent') },
        });
        const parsed = intentSchema.safeParse(response.output_parsed);
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
