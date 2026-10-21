import { z } from 'zod';
import { collectionPlanSchema } from './collection-plan.js';

// Provider-neutral contract: interpretation is data, never authorization.
export const intentSchema = z.object({
  intent: z.enum(['ORDER_STATUS', 'ORDER_PRODUCTS', 'ORDER_COLLECTION', 'REQUEST_CANCEL', 'CONFIRM_CANCEL', 'DECLINE_CANCEL', 'HUMAN', 'OUT_OF_SCOPE', 'UNKNOWN']),
  orderId: z.string().nullable(),
  orderNumber: z.number().int().min(10000).max(2147483647).nullable(),
  opening: z.enum(['GREETING', 'ACKNOWLEDGE', 'NONE']),
  // Optional internally for old adapters/test doubles; real providers must supply null or a plan.
  collectionPlan: collectionPlanSchema.nullable().optional(),
}).strict();
export const providerIntentSchema = intentSchema.extend({ collectionPlan: collectionPlanSchema.nullable() });
export type AgentIntent = z.infer<typeof intentSchema>;
export interface ModelInput { content: string; history: Array<{ role: 'USER' | 'ASSISTANT'; content: string }> }
export interface IntentModel { interpret(input: ModelInput): Promise<AgentIntent> }
export class AiFailure extends Error {
  constructor(public readonly code: 'AI_UNAVAILABLE' | 'AI_TIMEOUT' | 'AI_INVALID_RESPONSE') { super(code); }
}
