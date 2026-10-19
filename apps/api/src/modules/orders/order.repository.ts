import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';

export type OrderRecord = Prisma.OrderGetPayload<{ include: { items: true } }>;

export function createOrderRepository(database: PrismaClient) {
  return {
    findOwn(customerId: string, orderId: string) {
      return database.order.findFirst({ where: { customerId, orderId }, include: { items: true } });
    },
    async listOwn(customerId: string, page: number, pageSize: number) {
      const [orders, totalItems] = await database.$transaction([
        database.order.findMany({
          where: { customerId }, include: { items: true },
          orderBy: [{ createdAt: 'desc' }, { orderId: 'asc' }], skip: (page - 1) * pageSize, take: pageSize,
        }),
        database.order.count({ where: { customerId } }),
      ], { isolationLevel: 'RepeatableRead' });
      return { orders, totalItems };
    },
    async cancelProcessing(customerId: string, orderId: string, now: Date) {
      // O PostgreSQL reavalia este predicado ao adquirir o lock da linha.
      // Uma segunda requisição concorrente não pode atualizar CANCELLED novamente.
      return database.$transaction(async (transaction) => {
        const updated = await transaction.order.updateMany({
          where: { customerId, orderId, status: 'PROCESSING' },
          data: { status: 'CANCELLED', cancelledAt: now, updatedAt: now },
        });
        if (updated.count === 0) return null;
        return transaction.order.findFirst({ where: { customerId, orderId }, include: { items: true } });
      });
    },
  };
}

export type OrderRepository = ReturnType<typeof createOrderRepository>;
