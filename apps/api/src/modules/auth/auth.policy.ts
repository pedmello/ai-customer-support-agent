import type { EmailClient } from "../../integrations/email/email.client.js";
import { unavailableEmail } from "../../integrations/email/email.client.js";
import type { Logger } from "pino";

export interface AuthOptions {
  email: EmailClient;
  hmacSecret?: string;
  emailTimeoutMs: number;
  resetTtlSeconds: number;
  resetMaxAttempts: number;
  resetResendSeconds: number;
  registrationLimit?: number;
  rateLimitNamespace?: string;
  logger?: Logger;
}
export const defaultAuthOptions: AuthOptions = {
  email: unavailableEmail,
  emailTimeoutMs: 3000,
  resetTtlSeconds: 600,
  resetMaxAttempts: 5,
  resetResendSeconds: 60,
};
