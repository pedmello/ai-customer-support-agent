import type { Order } from "../types";

// Presentation only: persisted messages and idempotency results are never rewritten.
export function publicOrderText(text: string, orders: Order[]) {
  const own = new Map(
    orders.map((order) => [order.orderId.toLowerCase(), order.orderNumber]),
  );
  return text.replace(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
    (id) =>
      own.has(id.toLowerCase())
        ? `#${own.get(id.toLowerCase())}`
        : "[pedido indisponível]",
  );
}
export function publicOrderLabel(order: Pick<Order, "orderNumber">) {
  return order.orderNumber ? `#${order.orderNumber}` : "Pedido";
}
