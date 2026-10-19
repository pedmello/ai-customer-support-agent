import type { RequestHandler } from 'express';
import { currentSession } from '../sessions/session.middleware.js';
import { cancelOrderSchema, orderListSchema, orderParamsSchema } from './order.schemas.js';
import type { createOrderService } from './order.service.js';

export function createOrderController(service: ReturnType<typeof createOrderService>) {
  const list: RequestHandler = async (req, res) => {
    const { page, pageSize } = orderListSchema.parse(req.query);
    res.json(await service.listOwn(currentSession(res).customerId, page, pageSize));
  };
  const get: RequestHandler = async (req, res) => {
    const { orderId } = orderParamsSchema.parse(req.params);
    res.json({ data: await service.getOwn(currentSession(res).customerId, orderId) });
  };
  const cancel: RequestHandler = async (req, res) => {
    const { orderId } = orderParamsSchema.parse(req.params);
    cancelOrderSchema.parse(req.body ?? {});
    res.json({ data: await service.cancel(currentSession(res).customerId, orderId) });
  };
  return { list, get, cancel };
}
