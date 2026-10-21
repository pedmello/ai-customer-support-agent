import { z } from 'zod';

// Closed read vocabulary. No SQL, customer/order IDs, arbitrary fields or mutations.
export const collectionPlanSchema = z.object({
  operation: z.enum(['LIST', 'COUNT', 'EXISTS', 'PRODUCTS', 'TOTAL', 'SELECT']),
  statusFilter: z.object({
    mode: z.enum(['INCLUDE', 'EXCLUDE']),
    statuses: z.array(z.enum(['PROCESSING', 'SHIPPED', 'CANCELLED'])).min(1).max(3),
  }).strict().nullable(),
  selection: z.enum(['LATEST', 'OLDEST', 'HIGHEST']).nullable(),
}).strict();
export type CollectionPlan = z.infer<typeof collectionPlanSchema>;
