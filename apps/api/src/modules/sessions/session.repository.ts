import type { PrismaClient } from '../../generated/prisma/client.js';

export function createSessionRepository(database: PrismaClient) {
  return {
    async findActive(tokenHash: string, now: Date) {
      const session = await database.session.findFirst({
        where: { tokenHash, revokedAt: null, expiresAt: { gt: now }, customer: { passwordHash: { not: null } } },
        select: {
          sessionId: true, customerId: true, expiresAt: true, credentialVersion: true,
          customer: { select: { customerId: true, name: true, email: true, credentialVersion: true } },
        },
      });
      if (!session || session.credentialVersion !== session.customer.credentialVersion) return null;
      const { credentialVersion: _version, customer, ...publicSession } = session;
      return { ...publicSession, customer: { customerId: customer.customerId, name: customer.name, email: customer.email } };
    },
    async revoke(sessionId: string, customerId: string, now: Date) {
      await database.session.updateMany({
        where: { sessionId, customerId, revokedAt: null },
        data: { revokedAt: now },
      });
    },
  };
}

export type SessionRepository = ReturnType<typeof createSessionRepository>;
