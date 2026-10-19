import { z } from 'zod';

export const orderParamsSchema = z.object({ orderId: z.uuid() }).strict();
export const orderListSchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
export const cancelOrderSchema = z.object({}).strict();
