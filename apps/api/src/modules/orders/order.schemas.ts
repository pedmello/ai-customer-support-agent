import { z } from 'zod';

export const orderParamsSchema = z.object({ orderId: z.uuid() }).strict();
export const orderNumberParamsSchema = z.object({ orderNumber: z.string().regex(/^[1-9]\d{4,9}$/).transform(Number).pipe(z.number().int().min(10000).max(2147483647)) }).strict();
export const orderListSchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
export const cancelOrderSchema = z.object({}).strict();
