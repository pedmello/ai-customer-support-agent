import { z } from 'zod';

// Provider-neutral contract: interpretation is data, never authorization.
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
