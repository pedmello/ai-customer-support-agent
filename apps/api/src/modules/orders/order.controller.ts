import type { RequestHandler } from 'express';
import { observeOperation } from '../../config/operation-log.js';
import { currentSession } from '../sessions/session.middleware.js';
import { cancelOrderSchema, orderListSchema, orderParamsSchema, orderNumberParamsSchema } from './order.schemas.js';
import type { createOrderService } from './order.service.js';

export function createOrderController(service: ReturnType<typeof createOrderService>) {
  const list: RequestHandler = async (req, res) => {
    const { page, pageSize } = orderListSchema.parse(req.query);
    res.json(await observeOperation(req.log, 'orders.query', () => service.listOwn(currentSession(res).customerId, page, pageSize), () => ({ result: 'ORDER_LIST' })));
  };
  const get: RequestHandler = async (req, res) => {
    const { orderId } = orderParamsSchema.parse(req.params);
    res.json({ data: await observeOperation(req.log, 'orders.query', () => service.getOwn(currentSession(res).customerId, orderId), () => ({ result: 'ORDER_FOUND' })) });
  };
  const cancel: RequestHandler = async (req, res) => {
    const { orderId } = orderParamsSchema.parse(req.params);
    cancelOrderSchema.parse(req.body ?? {});
    res.json({ data: await observeOperation(req.log, 'orders.cancel', () => service.cancel(currentSession(res).customerId, orderId), () => ({ result: 'ORDER_CANCELLED' })) });
  };
  const getByNumber: RequestHandler = async (req, res) => {
    const { orderNumber } = orderNumberParamsSchema.parse(req.params);
    res.json({ data: await observeOperation(req.log, 'orders.query', () => service.getOwnByNumber(currentSession(res).customerId, orderNumber), () => ({ result: 'ORDER_FOUND' })) });
  };
  return { list, get, getByNumber, cancel };
}
