import type { Order, OrderStatus } from "../types";
import { ProductImage } from "./ProductImage";
import { publicOrderLabel } from "../services/order-presentation";

import { Icon } from './Icon';
export { Icon } from './Icon';

export function Brand() {
  return (
    <span className="brand">
      <span className="brand-icon">
        <Icon name="headset" />
      </span>
      Support AI
    </span>
  );
}
export const statusLabels: Record<OrderStatus, string> = {
  PROCESSING: "Processando",
  SHIPPED: "Enviado",
  CANCELLED: "Cancelado",
};
export function Status({ status }: { status: OrderStatus }) {
  return (
    <span className={`status status-${status.toLowerCase()}`}>
      <span aria-hidden="true">●</span> {statusLabels[status]}
    </span>
  );
}
export function money(cents: number, currency: string) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(
    cents / 100,
  );
}
export function date(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}
export function time(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
export function OrderSummary({
  order,
  onClick,
  active = false,
}: {
  order: Order;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      className={`order-summary ${active ? "selected" : ""}`}
      title={`Pedido ${publicOrderLabel(order)} · ${statusLabels[order.status]}`}
      data-status={order.status}
      onClick={onClick}
    >
      <ProductImage
        imageUrl={order.items[0]?.imageUrl}
        title={order.items[0]?.title ?? "Pedido"}
      />
      <span className="order-summary-body">
        <strong>{order.items[0]?.title ?? "Pedido"}</strong>
        <small>
          <b>{publicOrderLabel(order)}</b> · {date(order.createdAt)}
        </small>
      </span>
      <span className="order-summary-end">
        <strong>{money(order.totalCents, order.currency)}</strong>
        <Status status={order.status} />
      </span>
    </button>
  );
}
export function ErrorBanner({
  message,
  onClose,
}: {
  message: string;
  onClose?: () => void;
}) {
  return (
    <div className="banner error" role="alert">
      <span>{message}</span>
      {onClose && (
        <button aria-label="Fechar aviso" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      )}
    </div>
  );
}
export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name="chat" size={26} />
      </span>
      <h2>{title}</h2>
      {children}
    </div>
  );
}
