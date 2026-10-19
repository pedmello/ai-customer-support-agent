import type { PrismaClient } from '../../generated/prisma/client.js';

export function createHealthRepository(database: PrismaClient) {
  return {
    async checkDatabase(): Promise<void> {
      await database.$queryRaw`SELECT 1`;
    },
  };
}
