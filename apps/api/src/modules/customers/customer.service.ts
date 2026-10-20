import type { Prisma } from '../../generated/prisma/client.js';
import { prepareSession } from '../sessions/session.service.js';
import type { CustomerRepository } from './customer.repository.js';
import type { RegisterCustomerInput } from './customer.schemas.js';
import { DEMO_CATALOG_VERSION, selectDemoProducts } from './demo-catalog.js';

export function demoOrders(now: Date, random?: () => number): Prisma.OrderCreateWithoutCustomerInput[] {
  const products = selectDemoProducts(random);
  return (['PROCESSING', 'SHIPPED', 'CANCELLED'] as const).map((status, index) => ({
    status,
    currency: 'BRL',
    createdAt: now,
    updatedAt: now,
    cancelledAt: status === 'CANCELLED' ? now : null,
    items: { create: [{
      ...products[index]!, catalogVersion: DEMO_CATALOG_VERSION,
      quantity: 1,
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
