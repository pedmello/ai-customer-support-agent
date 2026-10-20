import { createHash } from "node:crypto";
import type { PrismaClient } from "../../generated/prisma/client.js";

export function createAuthRepository(database: PrismaClient) {
  return {
    findByEmail(email: string) {
      return database.customer.findUnique({ where: { email } });
    },
    async issueSession(
      customerId: string,
      credentialVersion: number,
      passwordHash: string,
      session: { tokenHash: string; expiresAt: Date },
    ) {
      return database.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT customer_id FROM customers WHERE customer_id = ${customerId}::uuid FOR UPDATE`;
        const customer = await tx.customer.findUnique({
          where: { customerId },
        });
        if (
          !customer ||
          customer.credentialVersion !== credentialVersion ||
          customer.passwordHash !== passwordHash
        )
          return null;
        await tx.session.create({
          data: { customerId, credentialVersion, ...session },
        });
        return {
          customerId: customer.customerId,
          name: customer.name,
          email: customer.email,
        };
      });
    },
    // Atomic fixed windows work across processes/restarts. Keys contain no raw emails/IPs.
    async allow(
      scope: string,
      identity: string,
      limit: number,
      seconds: number,
      now = new Date(),
    ) {
      const window = Math.floor(now.getTime() / (seconds * 1000));
      const key = createHash("sha256")
        .update(JSON.stringify([scope, identity, window]))
        .digest("hex");
      const entry = await database.authRateLimit.upsert({
        where: { key },
        create: {
          key,
          count: 1,
          expiresAt: new Date((window + 1) * seconds * 1000),
        },
        update: { count: { increment: 1 } },
        select: { count: true },
      });
      return entry.count <= limit;
    },
    async newChallenge(
      customerId: string,
      create: {
        challengeId: string;
        verifier: string;
        expiresAt: Date;
        createdAt: Date;
      },
      resendSeconds: number,
    ) {
      return database.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT customer_id FROM customers WHERE customer_id = ${customerId}::uuid FOR UPDATE`;
        const last = await tx.passwordResetChallenge.findFirst({
          where: { customerId },
          orderBy: { createdAt: "desc" },
        });
        if (
          last &&
          create.createdAt.getTime() - last.createdAt.getTime() <
            resendSeconds * 1000
        )
          return false;
        await tx.passwordResetChallenge.updateMany({
          where: { customerId, consumedAt: null },
          data: { consumedAt: create.createdAt },
        });
        await tx.passwordResetChallenge.create({
          data: { customerId, ...create },
        });
        return true;
      });
    },
    invalidateChallenge(challengeId: string) {
      return database.passwordResetChallenge.updateMany({
        where: { challengeId, consumedAt: null },
        data: { consumedAt: new Date() },
      });
    },
    async reset(
      customerId: string,
      verify: (challengeId: string, verifier: string) => boolean,
      hash: () => Promise<string>,
      maxAttempts: number,
    ) {
      return database.$transaction(
        async (tx) => {
          // Same lock as login/issuance: an old verified password cannot create a session after reset.
          await tx.$queryRaw`SELECT customer_id FROM customers WHERE customer_id = ${customerId}::uuid FOR UPDATE`;
          const now = new Date();
          const challenge = await tx.passwordResetChallenge.findFirst({
            where: { customerId, consumedAt: null },
          });
          if (
            !challenge ||
            challenge.expiresAt <= now ||
            challenge.attempts >= maxAttempts
          )
            return false;
          if (!verify(challenge.challengeId, challenge.verifier)) {
            await tx.passwordResetChallenge.update({
              where: { challengeId: challenge.challengeId },
              data: {
                attempts: { increment: 1 },
                ...(challenge.attempts + 1 >= maxAttempts
                  ? { consumedAt: now }
                  : {}),
              },
            });
            return false; // Commit failed attempts; do not throw inside the transaction.
          }
          await tx.passwordResetChallenge.update({
            where: { challengeId: challenge.challengeId },
            data: { consumedAt: now },
          });
          await tx.customer.update({
            where: { customerId },
            data: {
              passwordHash: await hash(),
              passwordChangedAt: now,
              credentialVersion: { increment: 1 },
              emailVerifiedAt: now,
            },
          });
          await tx.session.updateMany({
            where: { customerId, revokedAt: null },
            data: { revokedAt: now },
          });
          return true;
        },
        { timeout: 10000 },
      );
    },
  };
}
export type AuthRepository = ReturnType<typeof createAuthRepository>;
