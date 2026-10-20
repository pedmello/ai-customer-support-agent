import type { Order, OrderStatus } from "../types";
import { ProductImage } from "./ProductImage";
import { publicOrderLabel } from "../services/order-presentation";

export function Icon({
  name,
  size = 18,
}: {
  name:
    | "headset"
    | "chat"
    | "box"
    | "history"
    | "logout"
    | "plus"
    | "arrow"
    | "search"
    | "shield"
    | "spark"
    | "back"
    | "refresh"
    | "copy";
  size?: number;
}) {
  const paths = {
    copy: (
      <>
        <rect x="8" y="8" width="12" height="13" rx="2" />
        <path d="M15 8V3H3v13h5" />
      </>
    ),
    headset: (
      <>
        <path d="M4 14v-3a8 8 0 0 1 16 0v3M4 12H3v6h4v-6ZM20 12h1v6h-4v-6ZM19 18c0 3-3 3-6 3" />
      </>
    ),
    chat: <path d="M3 4h18v13H8l-5 4V4Zm4 5h10M7 12h7" />,
    box: (
      <>
        <path d="m3 7 9-4 9 4v13H3V7Zm0 0 9 4 9-4M12 11v9M8 5l9 4" />
      </>
    ),
    history: <path d="M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v6l4 2" />,
    logout: <path d="M10 3H4v18h6M10 12h11m-4-4 4 4-4 4" />,
    plus: <path d="M12 4v16M4 12h16" />,
    arrow: <path d="m6 10 6-6 6 6M12 4v17" />,
    search: (
      <>
        <circle cx="10" cy="10" r="7" />
        <path d="m15 15 6 6" />
      </>
    ),
    shield: (
      <path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6l8-4Zm-4 9 3 3 5-6" />
    ),
    spark: (
      <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" />
    ),
    back: <path d="m14 5-7 7 7 7" />,
    refresh: <path d="M20 8a9 9 0 1 0 0 9M20 2v6h-6" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
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
          ×
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
