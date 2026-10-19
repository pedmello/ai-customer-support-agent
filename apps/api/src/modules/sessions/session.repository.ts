import type { PrismaClient } from '../../generated/prisma/client.js';

export function createSessionRepository(database: PrismaClient) {
  return {
    findActive(tokenHash: string, now: Date) {
      return database.session.findFirst({
        where: { tokenHash, revokedAt: null, expiresAt: { gt: now } },
        select: {
          sessionId: true, customerId: true, expiresAt: true,
          customer: { select: { customerId: true, name: true, email: true } },
        },
      });
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
