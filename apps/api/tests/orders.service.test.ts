import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createOrderService } from '../src/modules/orders/order.service.js';
import type { OrderRecord, OrderRepository } from '../src/modules/orders/order.repository.js';

function order(status: OrderRecord['status']): OrderRecord {
  return {
    orderId: randomUUID(), orderNumber: 48213, customerId: randomUUID(), status, currency: 'USD',
    createdAt: new Date(), updatedAt: new Date(), cancelledAt: status === 'CANCELLED' ? new Date() : null,
    items: [{ orderItemId: randomUUID(), orderId: randomUUID(), productId: 1, title: 'Demo', imageUrl: null, catalogVersion: null, description: null, category: null, quantity: 2, unitPriceCents: 2500 }],
  };
}

function repository(existing: OrderRecord | null, updated: OrderRecord | null = null): OrderRepository {
  return {
    listForSummary: vi.fn().mockResolvedValue(existing ? [existing] : []),
    findOwnByNumber: vi.fn().mockResolvedValue(existing),
    findOwn: vi.fn().mockResolvedValue(existing),
    cancelProcessing: vi.fn().mockResolvedValue(updated),
    listOwn: vi.fn().mockResolvedValue({ orders: existing ? [existing] : [], totalItems: existing ? 1 : 0 }),
  };
}

describe('order rules', () => {
  it('presents known legacy products with real catalog metadata without changing stored orders or USD amounts', async () => {
    const existing = order('PROCESSING');
    existing.items[0] = { ...existing.items[0]!, productId: 2, title: 'Item demonstrativo 2' };
    const stored = structuredClone(existing);
    const service = createOrderService(repository(existing));
    const result = await service.getOwn(existing.customerId, existing.orderId);
    expect(result.items[0]).toMatchObject({
      productId: 2, title: 'Mens Casual Premium Slim Fit T-Shirts ',
      imageUrl: 'https://fakestoreapi.com/img/71-3HjGNDUL._AC_SY879._SX._UX._SY._UY_t.png',
      quantity: 2, unitPriceCents: 2500,
    });
    expect(result.currency).toBe('USD');
    expect(result.totalCents).toBe(5000);
    expect(existing).toEqual(stored);
    const list = await service.listOwn(existing.customerId, 1, 100);
    expect(list.data[0]!.items).toEqual(result.items);
  });
  it('keeps a specific historical product title and photo untouched', async () => {
    const existing = order('PROCESSING');
    existing.items[0] = { ...existing.items[0]!, productId: 2, title: 'Historical product', imageUrl: 'https://fakestoreapi.com/img/historical.png' };
    const result = await createOrderService(repository(existing)).getOwn(existing.customerId, existing.orderId);
    expect(result.items[0]!.title).toBe('Historical product');
    expect(result.items[0]!.imageUrl).toBe(existing.items[0]!.imageUrl);
  });
  it.each([1, 3])('resolves legacy product %s without changing its product identity', async productId => {
    const existing = order('SHIPPED');
    existing.items[0] = { ...existing.items[0]!, productId, title: `Item demonstrativo ${productId}` };
    const result = await createOrderService(repository(existing)).getOwn(existing.customerId, existing.orderId);
    expect(result.items[0]!.productId).toBe(productId);
    expect(result.items[0]!.title).not.toMatch(/^Item demonstrativo/);
    expect(result.items[0]!.imageUrl).toMatch(/^https:\/\/fakestoreapi.com\/img\//);
    expect(existing.items[0]!.imageUrl).toBeNull();
  });
  it('does not reveal a missing or foreign order', async () => {
    const service = createOrderService(repository(null));
    await expect(service.getOwn(randomUUID(), randomUUID())).rejects.toMatchObject({ status: 404, code: 'ORDER_NOT_FOUND' });
    await expect(service.cancel(randomUUID(), randomUUID())).rejects.toMatchObject({ status: 404, code: 'ORDER_NOT_FOUND' });
  });

  it.each([
    ['SHIPPED', 'ORDER_NOT_CANCELLABLE'],
    ['CANCELLED', 'ORDER_ALREADY_CANCELLED'],
  ] as const)('refuses cancellation of %s', async (status, code) => {
    const existing = order(status);
    await expect(createOrderService(repository(existing)).cancel(existing.customerId, existing.orderId))
      .rejects.toMatchObject({ status: 409, code });
  });

  it('returns the atomic transition and computes integer totals without internal item IDs', async () => {
    const updated = order('CANCELLED');
    const result = await createOrderService(repository(null, updated)).cancel(updated.customerId, updated.orderId);
    expect(result.status).toBe('CANCELLED');
    expect(result.totalCents).toBe(5000);
    expect(result.items[0]).not.toHaveProperty('orderItemId');
    expect(result).not.toHaveProperty('customerId');
  });

  it('propagates unexpected database errors to the central handler', async () => {
    const repo = repository(null);
    vi.mocked(repo.findOwn).mockRejectedValue(new Error('private database details'));
    await expect(createOrderService(repo).getOwn(randomUUID(), randomUUID())).rejects.toThrow('private database details');
  });
});
