import { z } from 'zod';
export const handoffSchema = z.object({
  conversationId: z.uuid().optional(),
  reason: z.enum(['CUSTOMER_REQUEST', 'OUT_OF_SCOPE', 'AI_UNAVAILABLE', 'INSUFFICIENT_INFORMATION', 'SAFETY_FAILURE']),
}).strict();
