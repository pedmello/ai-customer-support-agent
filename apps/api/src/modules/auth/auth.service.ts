import {
  createHmac,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { AppError } from "../../errors/app-error.js";
import type { AuthRepository } from "./auth.repository.js";
import type { AuthOptions } from "./auth.policy.js";
import { hashPassword, verifyPassword } from "./password.js";
import { prepareSession } from "../sessions/session.service.js";

const invalidCredentials = () =>
  new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
const invalidCode = () =>
  new AppError(
    400,
    "PASSWORD_RESET_INVALID",
    "Invalid or expired recovery code",
  );
export const recoveryAccepted = {
  message:
    "Se houver uma conta elegível, enviaremos um código. Verifique seu e-mail e aguarde antes de solicitar novamente.",
};
export const codeVerifier = (
  secret: string,
  customerId: string,
  challengeId: string,
  code: string,
) =>
  createHmac("sha256", secret)
    .update(
      JSON.stringify([
        "support:password-reset:v1",
        customerId,
        challengeId,
        code,
      ]),
    )
    .digest("hex");

export function createAuthService(
  repository: AuthRepository,
  ttlSeconds: number,
  options: AuthOptions,
) {
  async function throttle(
    action: string,
    email: string,
    origin: string,
    accountLimit: number,
    originLimit: number,
    seconds: number,
  ) {
    const [account, source] = await Promise.all([
      repository.allow(
        `${options.rateLimitNamespace ?? ""}:${action}:account`,
        email,
        accountLimit,
        seconds,
      ),
      repository.allow(
        `${options.rateLimitNamespace ?? ""}:${action}:origin`,
        origin,
        originLimit,
        seconds,
      ),
    ]);
    return { account, source };
  }
  return {
    async registrationAllowed(origin: string) {
      if (
        !(await repository.allow(
          "registration:origin",
          origin,
          options.registrationLimit ?? 20,
          900,
        ))
      )
        throw new AppError(
          429,
          "AUTH_RATE_LIMITED",
          "Too many attempts; try again later",
        );
    },
    async login(input: { email: string; password: string }, origin: string) {
      const limit = await throttle("login", input.email, origin, 10, 50, 900);
      if (!limit.account || !limit.source)
        throw new AppError(
          429,
          "AUTH_RATE_LIMITED",
          "Too many attempts; try again later",
        );
      const customer = await repository.findByEmail(input.email);
      const valid = await verifyPassword(
        customer?.passwordHash ?? null,
        input.password,
      );
      if (!customer?.passwordHash || !valid) throw invalidCredentials();
      const session = prepareSession(ttlSeconds);
      const publicCustomer = await repository.issueSession(
        customer.customerId,
        customer.credentialVersion,
        customer.passwordHash,
        { tokenHash: session.tokenHash, expiresAt: session.expiresAt },
      );
      if (!publicCustomer) throw invalidCredentials();
      return {
        customer: publicCustomer,
        token: session.token,
        expiresAt: session.expiresAt,
      };
    },
    async requestRecovery(email: string, origin: string) {
      const started = performance.now();
      const accepted = {
        ...recoveryAccepted,
        resendAfterSeconds: options.resetResendSeconds,
      };
      // Every branch has the same bounded latency budget, including unknown accounts and delivery failures.
      try {
        const limit = await throttle(
          "recovery-request",
          email,
          origin,
          5,
          30,
          3600,
        );
        if (!limit.source)
          throw new AppError(
            429,
            "AUTH_RATE_LIMITED",
            "Too many attempts; try again later",
          );
        if (!limit.account || !options.hmacSecret) return accepted;
        const customer = await repository.findByEmail(email);
        if (!customer) return accepted;
        const now = new Date();
        const challengeId = randomUUID();
        const code = String(randomInt(0, 100000000)).padStart(8, "0");
        if (
          !(await repository.newChallenge(
            customer.customerId,
            {
              challengeId,
              verifier: codeVerifier(
                options.hmacSecret,
                customer.customerId,
                challengeId,
                code,
              ),
              createdAt: now,
              expiresAt: new Date(
                now.getTime() + options.resetTtlSeconds * 1000,
              ),
            },
            options.resetResendSeconds,
          ))
        )
          return accepted;
        try {
          await options.email.sendRecovery({
            to: customer.email,
            code,
            challengeId,
            expiresInMinutes: options.resetTtlSeconds / 60,
          });
        } catch {
          await repository.invalidateChallenge(challengeId);
          options.logger?.warn(
            { category: "email_unavailable" },
            "Recovery delivery unavailable",
          );
        }
        return accepted;
      } finally {
        await delay(
          Math.max(
            0,
            options.emailTimeoutMs + 100 - (performance.now() - started),
          ),
        );
      }
    },
    async reset(
      input: { email: string; code: string; password: string },
      origin: string,
    ) {
      const started = performance.now();
      try {
        const limit = await throttle(
          "recovery-reset",
          input.email,
          origin,
          20,
          50,
          900,
        );
        if (!limit.account || !limit.source)
          throw new AppError(
            429,
            "AUTH_RATE_LIMITED",
            "Too many attempts; try again later",
          );
        const customer = await repository.findByEmail(input.email);
        if (!customer || !options.hmacSecret) throw invalidCode();
        const secret = options.hmacSecret;
        const updated = await repository.reset(
          customer.customerId,
          (id, verifier) =>
            timingSafeEqual(
              Buffer.from(verifier, "hex"),
              Buffer.from(
                codeVerifier(secret, customer.customerId, id, input.code),
                "hex",
              ),
            ),
          () => hashPassword(input.password),
          options.resetMaxAttempts,
        );
        if (!updated) throw invalidCode();
      } finally {
        await delay(Math.max(0, 250 - (performance.now() - started)));
      }
    },
  };
}
export type AuthService = ReturnType<typeof createAuthService>;
