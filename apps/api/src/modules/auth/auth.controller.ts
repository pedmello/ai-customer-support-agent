import type { RequestHandler } from "express";
import type { AuthService } from "./auth.service.js";
import {
  loginSchema,
  recoveryRequestSchema,
  recoveryResetSchema,
} from "./auth.schemas.js";
import {
  setSessionCookie,
  clearSessionCookie,
} from "../sessions/session.cookie.js";
import { csrfForToken } from "../sessions/session.tokens.js";
import type { SessionPolicy } from "../sessions/session.service.js";

// Express trust proxy stays disabled. Never trust arbitrary X-Forwarded-For.
export const requestOrigin = (req: Parameters<RequestHandler>[0]) =>
  req.ip ?? req.socket.remoteAddress ?? "unknown";
export function createAuthController(
  service: AuthService,
  policy: SessionPolicy,
) {
  const login: RequestHandler = async (req, res) => {
    const result = await service.login(
      loginSchema.parse(req.body),
      requestOrigin(req),
    );
    setSessionCookie(res, policy, result.token, result.expiresAt);
    res
      .status(201)
      .json({
        customer: result.customer,
        session: { expiresAt: result.expiresAt },
        csrfToken: csrfForToken(result.token),
      });
  };
  const request: RequestHandler = async (req, res) => {
    res
      .status(202)
      .json(
        await service.requestRecovery(
          recoveryRequestSchema.parse(req.body).email,
          requestOrigin(req),
        ),
      );
  };
  const reset: RequestHandler = async (req, res) => {
    await service.reset(
      recoveryResetSchema.parse(req.body),
      requestOrigin(req),
    );
    clearSessionCookie(res, policy);
    res.sendStatus(204);
  };
  return { login, request, reset };
}
