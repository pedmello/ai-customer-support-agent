import { Router } from "express";
import { requireJson } from "../../middlewares/browser-security.js";
import type { AuthService } from "./auth.service.js";
import { createAuthController } from "./auth.controller.js";
import type {
  SessionPolicy,
  SessionService,
} from "../sessions/session.service.js";
import { authenticate, requireCsrf } from "../sessions/session.middleware.js";
import { readSessionCookie } from "../sessions/session.cookie.js";
import { AppError } from "../../errors/app-error.js";

export function createRecoveryRouter(
  service: AuthService,
  policy: SessionPolicy,
  sessions: SessionService,
) {
  const router = Router();
  const controller = createAuthController(service, policy);
  router.use(requireJson);
  // Public recovery is origin+JSON protected. If a session cookie is supplied, require its CSRF as well.
  router.use((req, res, next) => {
    if (!readSessionCookie(req, policy)) {
      next();
      return;
    }
    void (async () => {
      try {
        await authenticate(sessions, policy)(req, res, () => {});
      } catch (error) {
        // Expired/legacy cookies must not prevent a public recovery request.
        if (error instanceof AppError && error.code === "UNAUTHENTICATED") {
          next();
          return;
        }
        throw error;
      }
      requireCsrf(req, res, next);
    })().catch(next);
  });
  router.post("/request", controller.request);
  router.post("/reset", controller.reset);
  return router;
}
