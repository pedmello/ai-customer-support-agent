import { useState } from "react";
import { useCompactLayout } from "../hooks/useCompactLayout";
import { ProductImage } from "./ProductImage";
import { CopyOrderNumber } from "./CopyOrderNumber";
import { PendingIndicator } from './PendingIndicator';
import { publicOrderLabel } from "../services/order-presentation";
import type { Order, OrderStatus } from "../types";
import {
  date,
  EmptyState,
  Icon,
  money,
  OrderSummary,
  Status,
  statusLabels,
} from "./ui";

export function OrderCard({
  order,
  onDetails,
}: {
  order: Order;
  onDetails: () => void;
}) {
  return (
    <div className="chat-order-card">
      <div>
        <ProductImage
          imageUrl={order.items[0]?.imageUrl}
          title={order.items[0]?.title ?? "Pedido"}
        />
        <span>
          <strong>{order.items[0]?.title ?? "Pedido"}</strong>
          <small>
            Pedido {publicOrderLabel(order)} ·{" "}
            {money(order.totalCents, order.currency)}
          </small>
        </span>
        <Status status={order.status} />
      </div>
      <footer>
        <span>Status nesta resposta</span>
        <button onClick={onDetails}>Ver detalhes ›</button>
      </footer>
    </div>
  );
}
export function OrderDetails({
  order,
  busy,
  onAsk,
  onBack,
  compact = false,
}: {
  order: Order;
  busy: boolean;
  onAsk: (cancel: boolean) => void;
  onBack: () => void;
  compact?: boolean;
}) {
  return (
    <section className={`order-details ${compact ? "compact-order-details" : ""}`} aria-label="Detalhes do pedido">
      <header className="order-heading">
        {compact && <button className="collapse-order" onClick={onBack}>Recolher detalhes</button>}
        <div>
          <h1>
            Pedido {publicOrderLabel(order)} <Status status={order.status} />
          </h1>
          <p className="muted">Criado em {date(order.createdAt)}</p>
        </div>
        <div className="order-actions">
          {order.status === "PROCESSING" && (
            <button
              className="danger-outline"
              disabled={busy}
              onClick={() => onAsk(true)}
            >
              <Icon name="cancel" size={16} /> Solicitar cancelamento
            </button>
          )}
          <button
            className="primary"
            disabled={busy}
            onClick={() => onAsk(false)}
          >
            <Icon name="chat" size={15} />
            Perguntar no chat
          </button>
        </div>
      </header>
      <div className="details-grid">
        <div className="details-main">
          <div className="info-banner">
            <Icon name="shield" size={16} />
            <span>
              {order.status === "PROCESSING"
                ? "Este pedido está em processamento. O cancelamento exige confirmação no chat."
                : order.status === "SHIPPED"
                  ? "Este pedido foi enviado e não pode ser cancelado."
                  : "Este pedido está cancelado."}
            </span>
          </div>
          <section className="card">
            <h2>Situação do pedido</h2>
            <div className="official-status">
              <span className="status-icon">
                <Icon name="box" size={20} />
              </span>
              <div>
                <strong>{statusLabels[order.status]}</strong>
                <p className="muted">
                  Última atualização: {date(order.updatedAt)}
                </p>
              </div>
              {compact && <CopyOrderNumber orderNumber={order.orderNumber} iconOnly />}
            </div>
            {!compact && order.cancelledAt && (
              <p className="muted">Cancelado em {date(order.cancelledAt)}</p>
            )}
            <p className="fine-print">
              A demonstração não fornece rastreamento ou previsão de entrega.
            </p>
          </section>
          <section className="card">
            <h2>Itens</h2>
            {order.items.map((item) => (
              <div key={item.productId} className="detail-item">
                <ProductImage imageUrl={item.imageUrl} title={item.title} />
                <div>
                  <strong>{item.title}</strong>
                  {!compact && item.category && <small>{item.category}</small>}
                  <small>
                    Produto #{item.productId} · Quantidade: {item.quantity}
                  </small>
                  {!compact && <small>
                    Unidade: {money(item.unitPriceCents, order.currency)}
                  </small>}
                </div>
                <strong>
                  {money(item.unitPriceCents * item.quantity, order.currency)}
                </strong>
              </div>
            ))}
          </section>
        </div>
        <div className="details-extra">
          <section className="card">
            <h2>Resumo</h2>
            <div className="total">
              <strong>Total dos itens</strong>
              <strong>{money(order.totalCents, order.currency)}</strong>
            </div>
            <p className="fine-print">
              Valores oficiais do pedido, na moeda registrada.
            </p>
          </section>
          {!compact && <section className="card">
            <h2>Identificação</h2>
            <small className="muted">Número do pedido</small>
            <p className="public-order-number">{publicOrderLabel(order)}</p>
            {order.orderNumber && (
              <CopyOrderNumber orderNumber={order.orderNumber} />
            )}
            <p className="fine-print">
              Use este número para falar sobre o pedido no atendimento.
            </p>
            <p className="fine-print">
              Pedido fictício criado para esta demonstração.
            </p>
          </section>}
          <section className="card">
            <h2>Sobre os produtos</h2>
            <p className="muted">
              As informações dos produtos são baseadas no catálogo da Fake Store API,
              utilizado como fonte complementar. Os valores, pedidos e status
              apresentados são definidos pelo Support AI.
            </p>
          </section>
        </div>
      </div>
    </section>
  );
}
export function Orders({
  orders,
  selectedId,
  onSelect,
  onAsk,
  busy,
  loading = false,
}: {
  orders: Order[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onAsk: (orderNumber: number, cancel: boolean) => void;
  busy: boolean;
  loading?: boolean;
}) {
  const compact = useCompactLayout();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<OrderStatus | "ALL">("ALL");
  const [showDetails, setShowDetails] = useState(true);
  const normalized = query.trim().toLocaleLowerCase("pt-BR");
  const filtered = orders.filter(
    (order) =>
      (filter === "ALL" || order.status === filter) &&
      `${order.orderNumber} ${order.items.map((item) => item.title).join(" ")}`
        .toLocaleLowerCase("pt-BR")
        .includes(normalized),
  );
  const selected =
    orders.find((order) => order.orderId === selectedId) ?? filtered[0];
  return (
    <div className="orders-page">
      <section className="orders-list-panel">
        <header>
          <h1>Meus pedidos</h1>
          <PendingIndicator active={loading} label="Carregando pedidos…" />
          <span className="muted">{orders.length} pedidos</span>
        </header>
        <div className="search-field">
          <Icon name="search" size={16} />
          <input
            aria-label="Buscar pedido por produto ou número"
            placeholder="Buscar por produto ou número"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="filters" aria-label="Filtrar por status">
          {(["ALL", "PROCESSING", "SHIPPED", "CANCELLED"] as const).map(
            (status) => (
              <button
                aria-pressed={filter === status}
                className={filter === status ? "active" : ""}
                key={status}
                onClick={() => setFilter(status)}
              >
                {status === "ALL" ? "Todos" : statusLabels[status]}
              </button>
            ),
          )}
        </div>
        <div className="orders-list">
          {filtered.map((order) => (
            <div key={order.orderId} className={`order-entry ${compact && showDetails && order.orderId === selected?.orderId ? "expanded" : ""}`}>
              <OrderSummary
                  order={order}
                  active={order.orderId === selected?.orderId}
                  onClick={() => {
                    onSelect(order.orderId);
                    setShowDetails(order.orderId === selected?.orderId ? !showDetails : true);
                  }}
              />
              {compact && showDetails && order.orderId === selected?.orderId && (
                <OrderDetails
                  compact order={order} busy={busy}
                  onAsk={cancel => onAsk(order.orderNumber, cancel)}
                  onBack={() => setShowDetails(false)}
                />
              )}
            </div>
          ))}
          {!filtered.length && (
            <EmptyState title="Nenhum pedido encontrado">
              <p>Experimente outra busca ou filtro.</p>
            </EmptyState>
          )}
        </div>
      </section>
      {!compact && selected ? (
        <OrderDetails
          order={selected}
          busy={busy}
          onAsk={(cancel) => onAsk(selected.orderNumber, cancel)}
          onBack={() => setShowDetails(false)}
        />
      ) : !compact ? (
        <EmptyState title="Seus pedidos aparecerão aqui" />
      ) : null}
    </div>
  );
}
