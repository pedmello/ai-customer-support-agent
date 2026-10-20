import type { Conversation, History, Order } from "../types";
import { publicOrderText } from "../services/order-presentation";
import { date, EmptyState, Icon, OrderSummary } from "./ui";
import type { SupportState } from "../hooks/useSupport";

export function conversationTitle(
  conversation: Conversation,
  history?: History,
  orders: Order[] = [],
) {
  const first = history?.turns[0]?.messages.find(
    (message) => message.role === "USER",
  )?.content;
  if (!first) return `Conversa de ${date(conversation.createdAt)}`;
  const text = publicOrderText(first, orders);
  const order = orders.find((item) =>
    new RegExp(`(?:#|\\b)${item.orderNumber}\\b`).test(text),
  );
  return `${text}${order?.items[0] ? ` · ${order.items[0].title}` : ""}`.slice(
    0,
    120,
  );
}
export function ConversationList({
  support,
  full = false,
  onSelect,
}: {
  support: SupportState;
  full?: boolean;
  onSelect: (id: string) => void;
}) {
  const list = full ? support.conversations : support.conversations.slice(0, 5);
  return (
    <div className="conversation-list">
      {list.length ? (
        list.map((conversation) => {
          const history = support.histories[conversation.conversationId];
          const preview = history?.turns
            .at(-1)
            ?.messages.find((message) => message.role === "ASSISTANT")?.content;
          return (
            <button
              key={conversation.conversationId}
              disabled={!!support.busy || !!support.retry}
              onClick={() => onSelect(conversation.conversationId)}
              className={
                conversation.conversationId === support.selectedId
                  ? "selected"
                  : ""
              }
            >
              <strong>
                {conversationTitle(conversation, history, support.orders)}
              </strong>
              <small>
                {conversation.state === "AWAITING_CONFIRMATION"
                  ? "Aguardando sua confirmação"
                  : conversation.state === "HUMAN_REQUESTED"
                    ? "Encaminhamento simulado"
                    : preview
                      ? publicOrderText(preview, support.orders).slice(0, 85)
                      : "Abra para consultar o histórico"}
              </small>
              <time>{date(conversation.createdAt)}</time>
            </button>
          );
        })
      ) : (
        <p className="muted list-empty">Suas conversas aparecerão aqui.</p>
      )}
    </div>
  );
}
export function ContextPanel({
  support,
  onAll,
  onOrder,
}: {
  support: SupportState;
  onAll: () => void;
  onOrder: (id: string) => void;
}) {
  return (
    <aside className="context-panel">
      <button
        className="primary new-conversation"
        onClick={() => void support.create()}
        disabled={!!support.busy || !!support.retry}
      >
        <Icon name="plus" />
        Nova conversa
      </button>
      <div className="section-label">
        <span>Conversas recentes</span>
        <button onClick={onAll}>Ver todas</button>
      </div>
      <ConversationList
        support={support}
        onSelect={(id) => void support.select(id)}
      />
      <div className="section-label orders-label">
        <span>Seus pedidos</span>
        <button onClick={() => onOrder(support.orders[0]?.orderId ?? "")}>
          Ver todos
        </button>
      </div>
      {support.orders.slice(0, 4).map((order) => (
        <OrderSummary
          key={order.orderId}
          order={order}
          onClick={() => onOrder(order.orderId)}
        />
      ))}
      {!support.orders.length && (
        <p className="muted list-empty">Nenhum pedido disponível.</p>
      )}
    </aside>
  );
}
export function ConversationsPage({
  support,
  onSelect,
}: {
  support: SupportState;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="conversations-page">
      <header className="page-heading">
        <div>
          <h1>Suas conversas</h1>
          <p className="muted">
            Históricos independentes, sempre disponíveis nesta sessão.
          </p>
        </div>
        <button
          className="primary"
          disabled={!!support.busy || !!support.retry}
          onClick={async () => {
            const id = await support.create();
            if (id) onSelect(id);
          }}
        >
          <Icon name="plus" />
          Nova conversa
        </button>
      </header>
      {support.conversations.length ? (
        <ConversationList support={support} full onSelect={onSelect} />
      ) : (
        <EmptyState title="Vamos iniciar uma conversa">
          <p>Crie uma conversa para consultar seus pedidos.</p>
        </EmptyState>
      )}
    </section>
  );
}
