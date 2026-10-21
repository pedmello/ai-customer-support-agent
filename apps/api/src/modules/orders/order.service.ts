import { AppError } from '../../errors/app-error.js';
import type { OrderRecord, OrderRepository } from './order.repository.js';
import { presentOrderItem } from './legacy-product.js';

function orderView(order: OrderRecord) {
  return {
    orderId: order.orderId,
    orderNumber: order.orderNumber,
    status: order.status,
    currency: order.currency,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    cancelledAt: order.cancelledAt,
    items: order.items.map(presentOrderItem),
    totalCents: order.items.reduce((total, item) => total + item.quantity * item.unitPriceCents, 0),
  };
}

const orderNotFound = () => new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');

export function createOrderService(repository: OrderRepository) {
  return {
    async listForSummary(customerId: string) {
      return (await repository.listForSummary(customerId)).map(orderView);
    },
    async getOwnByNumber(customerId: string, orderNumber: number) {
      const order = await repository.findOwnByNumber(customerId, orderNumber);
      if (!order) throw orderNotFound();
      return orderView(order);
    },
    async listOwn(customerId: string, page: number, pageSize: number) {
      const { orders, totalItems } = await repository.listOwn(customerId, page, pageSize);
      return {
        data: orders.map(orderView),
        pagination: { page, pageSize, totalItems, totalPages: Math.ceil(totalItems / pageSize) },
      };
    },
    async getOwn(customerId: string, orderId: string) {
      const order = await repository.findOwn(customerId, orderId);
      if (!order) throw orderNotFound();
      return orderView(order);
    },
    async cancel(customerId: string, orderId: string) {
      const updated = await repository.cancelProcessing(customerId, orderId, new Date());
      if (updated) return orderView(updated);
      // Consultar somente dentro do escopo do titular, inclusive no caminho de erro.
      const existing = await repository.findOwn(customerId, orderId);
      if (!existing) throw orderNotFound();
      if (existing.status === 'CANCELLED') {
        throw new AppError(409, 'ORDER_ALREADY_CANCELLED', 'Order already cancelled');
      }
      throw new AppError(409, 'ORDER_NOT_CANCELLABLE', 'Order cannot be cancelled');
    },
  };
}
