import { z } from 'zod';

export const registerCustomerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
}).strict();

export type RegisterCustomerInput = z.infer<typeof registerCustomerSchema>;
