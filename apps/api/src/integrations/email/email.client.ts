import type { Logger } from "pino";

export interface RecoveryEmail {
  to: string;
  code: string;
  challengeId: string;
  expiresInMinutes: number;
}
export interface EmailClient {
  sendRecovery(input: RecoveryEmail): Promise<void>;
}
export class EmailUnavailable extends Error {
  constructor() {
    super("Email delivery unavailable");
    this.name = "EmailUnavailable";
  }
}
export const unavailableEmail: EmailClient = {
  async sendRecovery() {
    throw new EmailUnavailable();
  },
};

export function recoveryTemplate(code: string, minutes: number) {
  // Only generated numeric codes enter this template; no user-supplied HTML.
  if (!/^\d{8}$/.test(code)) throw new EmailUnavailable();
  return `Seu código do Support AI é: ${code}\n\nEle expira em ${minutes} minutos e só pode ser usado uma vez.\nSe você não solicitou esta alteração, ignore este e-mail. Nunca compartilhe o código.`;
}

// HTTP client behind an interface; no provider dependency in business rules.
export function createResendClient(options: {
  apiKey?: string;
  from?: string;
  timeoutMs: number;
  logger: Logger;
  fetcher?: typeof fetch;
}): EmailClient {
  return {
    async sendRecovery(input) {
      if (!options.apiKey || !options.from) throw new EmailUnavailable();
      const started = performance.now();
      try {
        const response = await (options.fetcher ?? fetch)(
          "https://api.resend.com/emails",
          {
            method: "POST",
            signal: AbortSignal.timeout(options.timeoutMs),
            redirect: "error",
            headers: {
              Authorization: `Bearer ${options.apiKey}`,
              "Content-Type": "application/json",
              "Idempotency-Key": `password-recovery/${input.challengeId}`,
            },
            body: JSON.stringify({
              from: options.from,
              to: [input.to],
              subject: "Seu código de recuperação — Support AI",
              text: recoveryTemplate(input.code, input.expiresInMinutes),
            }),
          },
        );
        // Never log response bodies, recipient, code, or provider error details.
        if (!response.ok) {
          options.logger.warn(
            {
              provider: "resend",
              category: "http",
              status: response.status,
              durationMs: Math.round(performance.now() - started),
            },
            "Email delivery failed",
          );
          await response.body?.cancel();
          throw new EmailUnavailable();
        }
        await response.body?.cancel();
        options.logger.info(
          {
            provider: "resend",
            durationMs: Math.round(performance.now() - started),
          },
          "Email accepted",
        );
      } catch (error) {
        if (!(error instanceof EmailUnavailable))
          options.logger.warn(
            {
              provider: "resend",
              category: "transport",
              durationMs: Math.round(performance.now() - started),
            },
            "Email delivery failed",
          );
        throw new EmailUnavailable();
      }
    },
  };
}
