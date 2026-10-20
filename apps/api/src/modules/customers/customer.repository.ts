import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import { AppError } from '../../errors/app-error.js';

export function createCustomerRepository(database: PrismaClient) {
  return {
    async register(input: { name: string; email: string; passwordHash: string; passwordChangedAt: Date }, session: { tokenHash: string; expiresAt: Date },
      orders: Prisma.OrderCreateWithoutCustomerInput[]) {
      try {
        // Nested write: cliente, sessão, pedidos e itens fazem parte da mesma transação.
        return await database.customer.create({
          data: { ...input, sessions: { create: session }, orders: { create: orders } },
          select: { customerId: true, name: true, email: true },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          // O formato de meta.target varia entre drivers. Confirmar o e-mail após
          // a violação evita depender desses detalhes e não substitui a constraint.
          const duplicate = await database.customer.findUnique({
            where: { email: input.email }, select: { customerId: true },
          });
          if (duplicate) throw new AppError(409, 'EMAIL_ALREADY_REGISTERED', 'Email already registered');
        }
        throw error;
      }
    },
  };
}

export type CustomerRepository = ReturnType<typeof createCustomerRepository>;
