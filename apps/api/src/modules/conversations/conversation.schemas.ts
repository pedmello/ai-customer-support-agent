import { z } from 'zod';
export const conversationParams = z.object({ conversationId: z.uuid() }).strict();
export const createConversationSchema = z.object({}).strict();
export const pageSchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
export const sendMessageSchema = z.object({
  clientMessageId: z.uuid(),
  content: z.string().trim().min(1).max(2000),
  confirmationId: z.uuid().optional(),
  handoffOfferId: z.uuid().optional(),
}).strict().refine(input => !(input.confirmationId && input.handoffOfferId), {
  message: 'Envie apenas uma decisão por mensagem.',
});
export type SendMessage = z.infer<typeof sendMessageSchema>;
