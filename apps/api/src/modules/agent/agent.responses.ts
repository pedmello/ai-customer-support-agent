export interface ResponseOrder {
  orderNumber: number;
  status: string;
  currency: string;
  totalCents: number;
  items: Array<{ title: string }>;
}
export function orderLabel(order: ResponseOrder) {
  const name = order.items[0]?.title.trim();
  return `pedido #${order.orderNumber}${name ? `, referente a ${name}` : ""}`;
}
export function orderStatusReply(order: ResponseOrder) {
  const status =
    {
      PROCESSING: "em processamento",
      SHIPPED: "enviado",
      CANCELLED: "cancelado",
    }[order.status] ?? "com status indisponível";
  const total = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: order.currency,
  }).format(order.totalCents / 100);
  return `O ${orderLabel(order)} está ${status}. O total registrado é ${total}.`;
}
