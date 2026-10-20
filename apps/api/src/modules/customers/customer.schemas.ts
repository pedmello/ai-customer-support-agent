import { z } from 'zod';
import { emailSchema, passwordFields, matchingPasswords } from '../auth/auth.schemas.js';

export const registerCustomerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: emailSchema,
  ...passwordFields,
}).strict().refine(matchingPasswords, { path: ['passwordConfirmation'], message: 'Passwords must match' });

export type RegisterCustomerInput = z.infer<typeof registerCustomerSchema>;
