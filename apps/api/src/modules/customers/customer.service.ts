import type { Prisma } from '../../generated/prisma/client.js';
import { prepareSession } from '../sessions/session.service.js';
import type { CustomerRepository } from './customer.repository.js';
import type { RegisterCustomerInput } from './customer.schemas.js';

export function demoOrders(now: Date): Prisma.OrderCreateWithoutCustomerInput[] {
  return (['PROCESSING', 'SHIPPED', 'CANCELLED'] as const).map((status, index) => ({
    status,
    currency: 'USD',
    createdAt: now,
    updatedAt: now,
    cancelledAt: status === 'CANCELLED' ? now : null,
    items: { create: [{
      productId: index + 1,
      title: `Item demonstrativo ${index + 1}`,
      quantity: 1,
      unitPriceCents: [2500, 4000, 1500][index]!,
    }] },
  }));
}

export function createCustomerService(repository: CustomerRepository, ttlSeconds: number) {
  return {
    async register(input: RegisterCustomerInput) {
      const now = new Date();
      const session = prepareSession(ttlSeconds, now);
      const customer = await repository.register(input, {
        tokenHash: session.tokenHash, expiresAt: session.expiresAt,
      }, demoOrders(now));
      return { customer, token: session.token, expiresAt: session.expiresAt };
    },
  };
}
