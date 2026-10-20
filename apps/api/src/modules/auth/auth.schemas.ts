import { z } from "zod";
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email());
// Do not trim/normalize passwords. Reject excess length instead of truncating.
export const passwordSchema = z.string().min(12).max(128);
export const passwordFields = {
  password: passwordSchema,
  passwordConfirmation: z.string().max(128),
};
export const matchingPasswords = (value: {
  password: string;
  passwordConfirmation: string;
}) => value.password === value.passwordConfirmation;
export const loginSchema = z
  .object({ email: emailSchema, password: z.string().min(1).max(128) })
  .strict();
export const recoveryRequestSchema = z.object({ email: emailSchema }).strict();
export const recoveryResetSchema = z
  .object({
    email: emailSchema,
    code: z.string().regex(/^\d{8}$/),
    ...passwordFields,
  })
  .strict()
  .refine(matchingPasswords, {
    path: ["passwordConfirmation"],
    message: "Passwords must match",
  });
