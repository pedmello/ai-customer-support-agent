import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app.js";
import { createDatabase } from "../../src/integrations/database/prisma.js";
import type { RecoveryEmail } from "../../src/integrations/email/email.client.js";
import { defaultAuthOptions } from "../../src/modules/auth/auth.policy.js";
import { createAuthRepository } from "../../src/modules/auth/auth.repository.js";
import { createAuthService } from "../../src/modules/auth/auth.service.js";
import { defaultSessionPolicy } from "../../src/modules/sessions/session.service.js";
import { testDatabaseUrl } from "../helpers/test-database.js";

const database = createDatabase(testDatabaseUrl());
const sendRecovery = vi
  .fn<(input: RecoveryEmail) => Promise<void>>()
  .mockResolvedValue(undefined);
const auth = {
  ...defaultAuthOptions,
  email: { sendRecovery },
  hmacSecret: "test-only-secret-with-more-than-32-characters",
  emailTimeoutMs: 1,
  registrationLimit: 1000,
  rateLimitNamespace: randomUUID(),
};
const app = createApp({
  checkDatabase: async () => {},
  support: {
    database,
    sessionPolicy: defaultSessionPolicy,
    allowedOrigins: ["http://localhost:5173"],
    auth,
    agent: {
      model: { interpret: vi.fn() },
      products: { getProduct: vi.fn() },
      confirmationTtlSeconds: 300,
    },
  },
});
const password = "A secure test password!";
const nextPassword = "A different test password!";
const emails: string[] = [];
const email = () => {
  const value = `auth-${randomUUID()}@example.test`;
  emails.push(value);
  return value;
};
const cookie = (res: request.Response) =>
  (res.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
async function register() {
  const address = email();
  const result = await request(app)
    .post("/customers")
    .send({
      name: "Ana Auth",
      email: address,
      password,
      passwordConfirmation: password,
    });
  expect(result.status).toBe(201);
  return {
    address,
    result,
    id: result.body.customer.customerId as string,
    cookie: cookie(result),
    csrf: result.body.csrfToken as string,
  };
}
const login = (address: string, value = password) =>
  request(app).post("/sessions").send({ email: address, password: value });
const recover = (address: string) =>
  request(app).post("/password-recovery/request").send({ email: address });
const reset = (address: string, code: string) =>
  request(app)
    .post("/password-recovery/reset")
    .send({
      email: address,
      code,
      password: nextPassword,
      passwordConfirmation: nextPassword,
    });
async function sentCode(address: string) {
  expect((await recover(address)).status).toBe(202);
  return sendRecovery.mock.calls.findLast(
    ([message]) => message.to === address,
  )![0];
}
afterEach(() => {
  vi.restoreAllMocks();
  sendRecovery.mockClear();
  sendRecovery.mockResolvedValue(undefined);
});
afterAll(async () => {
  try {
    await database.customer.deleteMany({ where: { email: { in: emails } } });
  } finally {
    await database.$disconnect();
  }
});

describe("password registration and returning sessions", () => {
  it("requires confirmation and policy without issuing a session", async () => {
    for (const fields of [
      {},
      { password: "short", passwordConfirmation: "short" },
      { password, passwordConfirmation: "different" },
    ]) {
      const result = await request(app)
        .post("/customers")
        .send({ name: "Ana", email: email(), ...fields });
      expect(result.status).toBe(400);
      expect(result.headers["set-cookie"]).toBeUndefined();
    }
  });
  it("stores a hash, leaves email unverified, and returns no credentials", async () => {
    const c = await register();
    const stored = await database.customer.findUniqueOrThrow({
      where: { customerId: c.id },
    });
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
    expect(stored.emailVerifiedAt).toBeNull();
    expect(sendRecovery).not.toHaveBeenCalled();
    for (const key of [
      "password",
      "passwordHash",
      "token",
      "credentialVersion",
    ])
      expect(c.result.body).not.toHaveProperty(key);
    const duplicate = await request(app)
      .post("/customers")
      .send({
        name: "Other",
        email: c.address.toUpperCase(),
        password,
        passwordConfirmation: password,
      });
    expect(duplicate.status).toBe(409);
    expect(duplicate.headers["set-cookie"]).toBeUndefined();
  });
  it("logs out and returns to identical orders and conversation history with no new orders", async () => {
    const c = await register();
    const orders = (await request(app).get("/orders").set("Cookie", c.cookie))
      .body;
    const conversation = await request(app)
      .post("/conversations")
      .set("Cookie", c.cookie)
      .set("X-CSRF-Token", c.csrf)
      .send({});
    expect(conversation.status).toBe(201);
    await database.conversationTurn.create({
      data: {
        conversationId: conversation.body.data.conversationId,
        clientMessageId: randomUUID(),
        inputHash: "b".repeat(64),
        result: {},
        messages: {
          create: [
            { role: "USER", content: "Mensagem anterior ao logout." },
            { role: "ASSISTANT", content: "Histórico preservado." },
          ],
        },
      },
    });
    expect(
      (
        await request(app)
          .delete("/sessions/current")
          .set("Cookie", c.cookie)
          .set("X-CSRF-Token", c.csrf)
      ).status,
    ).toBe(204);
    const result = await login(` ${c.address.toUpperCase()} `);
    expect(result.status).toBe(201);
    expect(result.body.customer.customerId).toBe(c.id);
    expect(cookie(result)).not.toBe(c.cookie);
    expect(
      (await request(app).get("/orders").set("Cookie", cookie(result))).body,
    ).toEqual(orders);
    const history = await request(app)
      .get(`/conversations/${conversation.body.data.conversationId}`)
      .set("Cookie", cookie(result));
    expect(history.status).toBe(200);
    expect(
      history.body.data.turns[0].messages.map(
        (message: { content: string }) => message.content,
      ),
    ).toEqual(["Mensagem anterior ao logout.", "Histórico preservado."]);
    expect(await database.order.count({ where: { customerId: c.id } })).toBe(6);
  });
  it("uses identical generic errors for wrong, unknown and legacy credentials", async () => {
    const c = await register();
    const legacy = email();
    await database.customer.create({ data: { name: "Legacy", email: legacy } });
    const results = await Promise.all([
      login(c.address, "incorrect password"),
      login(email()),
      login(legacy),
    ]);
    expect(results.map((r) => r.status)).toEqual([401, 401, 401]);
    expect(results[0]!.body).toEqual(results[1]!.body);
    expect(results[1]!.body).toEqual(results[2]!.body);
    expect(results.every((r) => !r.headers["set-cookie"])).toBe(true);
  });
  it("limits login attempts persistently even after constructing a new service", async () => {
    const address = email();
    for (let i = 0; i < 10; i++)
      expect((await login(address)).status).toBe(401);
    expect((await login(address)).status).toBe(429);
    const service = createAuthService(createAuthRepository(database), 60, auth);
    await expect(
      service.login({ email: address, password }, "another-origin"),
    ).rejects.toMatchObject({ code: "AUTH_RATE_LIMITED" });
  });
  it("rejects login and recovery from disallowed browser origins or form content types", async () => {
    for (const path of [
      "/sessions",
      "/password-recovery/request",
      "/password-recovery/reset",
    ]) {
      expect(
        (
          await request(app)
            .post(path)
            .set("Origin", "https://evil.test")
            .send({})
        ).status,
      ).toBe(403);
      expect(
        (await request(app).post(path).type("form").send({ email: email() }))
          .status,
      ).toBe(415);
    }
  });
});

describe("one-time emailed recovery", () => {
  it("returns the same generic response for existing, missing, resend-limited and provider-failure accounts", async () => {
    const c = await register();
    const known = await recover(c.address);
    const missing = await recover(email());
    const repeated = await recover(c.address);
    expect(known.status).toBe(202);
    expect(known.body).toEqual(missing.body);
    expect(repeated.body).toEqual(known.body);
    expect(sendRecovery).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(known.body)).not.toMatch(/\d{8}/);
    const other = await register();
    sendRecovery.mockRejectedValueOnce(new Error("private provider details"));
    const failed = await recover(other.address);
    expect(failed.body).toEqual(known.body);
    expect(
      await database.passwordResetChallenge.count({
        where: { customerId: other.id, consumedAt: null },
      }),
    ).toBe(0);
  });
  it("stores only a context-bound verifier and never exposes the code in public responses", async () => {
    const c = await register();
    const sent = await sentCode(c.address);
    expect(sent.code).toMatch(/^\d{8}$/);
    const stored = await database.passwordResetChallenge.findUniqueOrThrow({
      where: { challengeId: sent.challengeId },
    });
    expect(stored.verifier).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(sent.code);
    expect(stored.expiresAt.getTime() - stored.createdAt.getTime()).toBe(
      600000,
    );
  });
  it("requires CSRF when an active session is supplied, but allows expired-cookie recovery", async () => {
    const c = await register();
    expect(
      (
        await request(app)
          .post("/password-recovery/request")
          .set("Cookie", c.cookie)
          .send({ email: c.address })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post("/password-recovery/request")
          .set("Cookie", c.cookie)
          .set("X-CSRF-Token", c.csrf)
          .send({ email: c.address })
      ).status,
    ).toBe(202);
    await database.session.updateMany({
      where: { customerId: c.id },
      data: { expiresAt: new Date(0) },
    });
    expect(
      (
        await request(app)
          .post("/password-recovery/request")
          .set("Cookie", c.cookie)
          .send({ email: c.address })
      ).status,
    ).toBe(202);
  });
  it("atomically resets once, revokes all sessions, and permits only the new password", async () => {
    const c = await register();
    const second = await login(c.address);
    const sent = await sentCode(c.address);
    const responses = await Promise.all([
      reset(c.address, sent.code),
      reset(c.address, sent.code),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([204, 400]);
    for (const value of [c.cookie, cookie(second)])
      expect(
        (await request(app).get("/sessions/current").set("Cookie", value))
          .status,
      ).toBe(401);
    expect((await login(c.address)).status).toBe(401);
    expect((await login(c.address, nextPassword)).status).toBe(201);
    expect((await reset(c.address, sent.code)).status).toBe(400);
    const customer = await database.customer.findUniqueOrThrow({
      where: { customerId: c.id },
    });
    expect(customer.credentialVersion).toBe(1);
    expect(customer.emailVerifiedAt).not.toBeNull();
  });
  it("rejects stale login verification after credentials change and mismatched session versions", async () => {
    const c = await register();
    const old = await database.customer.findUniqueOrThrow({
      where: { customerId: c.id },
    });
    const sent = await sentCode(c.address);
    expect((await reset(c.address, sent.code)).status).toBe(204);
    const repository = createAuthRepository(database);
    expect(
      await repository.issueSession(
        c.id,
        old.credentialVersion,
        old.passwordHash!,
        { tokenHash: "a".repeat(64), expiresAt: new Date(Date.now() + 60000) },
      ),
    ).toBeNull();
    // Version check independently protects even if a stale session's revocation flag is cleared.
    await database.session.updateMany({
      where: { customerId: c.id },
      data: { revokedAt: null },
    });
    expect(
      (await request(app).get("/sessions/current").set("Cookie", c.cookie))
        .status,
    ).toBe(401);
  });
  it("blocks an expired code without changing credentials", async () => {
    const c = await register();
    const sent = await sentCode(c.address);
    await database.passwordResetChallenge.update({
      where: { challengeId: sent.challengeId },
      data: { expiresAt: new Date(0) },
    });
    expect((await reset(c.address, sent.code)).status).toBe(400);
    expect((await login(c.address)).status).toBe(201);
  });
  it("consumes a challenge after five wrong attempts and never accepts another customer code", async () => {
    const c = await register();
    const sent = await sentCode(c.address);
    const other = await register();
    const otherSent = await sentCode(other.address);
    let incorrect = sent.code === "00000000" ? "00000001" : "00000000";
    expect(
      (
        await reset(
          c.address,
          otherSent.code === sent.code ? incorrect : otherSent.code,
        )
      ).status,
    ).toBe(400);
    for (let i = 0; i < 4; i++)
      expect((await reset(c.address, incorrect)).status).toBe(400);
    expect((await reset(c.address, sent.code)).status).toBe(400);
    expect(
      (
        await database.passwordResetChallenge.findUniqueOrThrow({
          where: { challengeId: sent.challengeId },
        })
      ).attempts,
    ).toBe(5);
  });
  it("enforces resend cooldown and invalidates an earlier code after resending", async () => {
    const c = await register();
    const sent = await sentCode(c.address);
    await recover(c.address);
    expect(sendRecovery).toHaveBeenCalledTimes(1);
    await database.passwordResetChallenge.update({
      where: { challengeId: sent.challengeId },
      data: { createdAt: new Date(Date.now() - 61000) },
    });
    const next = await sentCode(c.address);
    expect(next.challengeId).not.toBe(sent.challengeId);
    expect(
      (
        await database.passwordResetChallenge.findUniqueOrThrow({
          where: { challengeId: sent.challengeId },
        })
      ).consumedAt,
    ).not.toBeNull();
    expect((await reset(c.address, next.code)).status).toBe(204);
  });
  it("activates a legacy account only through mailbox proof and preserves its data", async () => {
    const address = email();
    const legacy = await database.customer.create({
      data: {
        email: address,
        name: "Legacy",
        orders: { create: { status: "SHIPPED", currency: "USD" } },
        conversations: { create: {} },
      },
      include: { orders: true, conversations: true },
    });
    expect((await login(address)).status).toBe(401);
    const sent = await sentCode(address);
    expect((await reset(address, sent.code)).status).toBe(204);
    const session = await login(address, nextPassword);
    expect(session.status).toBe(201);
    expect(session.body.customer.customerId).toBe(legacy.customerId);
    expect(
      await database.order.findMany({
        where: { customerId: legacy.customerId },
      }),
    ).toEqual(legacy.orders);
    expect(
      await database.conversation.count({
        where: { customerId: legacy.customerId },
      }),
    ).toBe(1);
  });
  it("serializes concurrent recovery requests to at most one outgoing code", async () => {
    const c = await register();
    const result = await Promise.all([recover(c.address), recover(c.address)]);
    expect(result.map((r) => r.status)).toEqual([202, 202]);
    expect(sendRecovery).toHaveBeenCalledTimes(1);
  });
  it("rejects a login actually paused between verification and session creation when reset wins the race", async () => {
    const c = await register();
    const sent = await sentCode(c.address);
    const repository = createAuthRepository(database);
    const issue = repository.issueSession;
    let release!: () => void;
    let reached!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const verified = new Promise<void>((resolve) => {
      reached = resolve;
    });
    repository.issueSession = async (...args) => {
      reached();
      await barrier;
      return issue(...args);
    };
    const service = createAuthService(repository, 600, auth);
    const attempt = service.login({ email: c.address, password }, randomUUID());
    const checked = expect(attempt).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
    await verified;
    try {
      expect((await reset(c.address, sent.code)).status).toBe(204);
    } finally {
      release();
    }
    await checked;
  });
  it("caps recovery requests per account with the same public response", async () => {
    const c = await register();
    const origin = randomUUID();
    const service = createAuthService(createAuthRepository(database), 60, auth);
    const first = await service.requestRecovery(c.address, origin);
    for (let index = 0; index < 5; index++)
      expect(await service.requestRecovery(c.address, origin)).toEqual(first);
    expect(sendRecovery).toHaveBeenCalledTimes(1);
  });
  it("caps recovery requests by origin even when account identities vary", async () => {
    const service = createAuthService(createAuthRepository(database), 60, auth);
    const origin = randomUUID();
    for (let index = 0; index < 30; index++)
      await service.requestRecovery(email(), origin);
    await expect(
      service.requestRecovery(email(), origin),
    ).rejects.toMatchObject({ status: 429, code: "AUTH_RATE_LIMITED" });
    expect(sendRecovery).not.toHaveBeenCalled();
  });
});
