import { useState } from "react";
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
  conversations,
  onSelect,
}: {
  support: SupportState;
  full?: boolean;
  conversations?: Conversation[];
  onSelect: (id: string) => void;
}) {
  const list = conversations ?? (full ? support.conversations : support.conversations.slice(0, 5));
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
              disabled={!!support.busy}
              aria-busy={!!support.pendingConversations?.[conversation.conversationId]}
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
                {support.pendingConversations?.[conversation.conversationId]
                  ? "Assistente respondendo…"
                  : conversation.state === "AWAITING_CONFIRMATION"
                  ? "Aguardando sua confirmação"
                  : conversation.state === "HUMAN_REQUESTED"
                    ? "Solicitação registrada nesta demonstração"
                    : preview
                      ? publicOrderText(preview, support.orders).slice(0, 85)
                      : "Abra para consultar o histórico"}
              </small>
              <time>{date(conversation.createdAt)}</time>
              {full && <span className="conversation-state">{
                conversation.state === "HUMAN_REQUESTED" ? "Encaminhamento simulado" :
                conversation.state === "AWAITING_CONFIRMATION" ? "Aguardando confirmação" : "Em aberto"
              }</span>}
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
}: {
  support: SupportState;
  onAll: () => void;
}) {
  return (
    <aside className="context-panel">
      <button
        className="primary new-conversation"
        onClick={() => void support.create()}
        disabled={!!support.busy}
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
    </aside>
  );
}
export function OrderRail({ support, onOrder }: { support: SupportState; onOrder: (id: string) => void }) {
  return (
    <aside className="order-rail" aria-label="Seus pedidos">
      <div className="section-label">
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
      <p className="rail-hint">Clique em um pedido para ver os detalhes completos.</p>
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
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("ALL");
  const normalized = query.trim().toLocaleLowerCase("pt-BR");
  const list = support.conversations.filter(conversation => {
    const history = support.histories[conversation.conversationId];
    const text = conversationTitle(conversation, history, support.orders) + " " +
      (history?.turns.flatMap(turn => turn.messages.map(message => publicOrderText(message.content, support.orders))).join(" ") ?? "");
    return (filter === "ALL" || (filter === "HUMAN_REQUESTED" ? conversation.state === filter : conversation.state !== "HUMAN_REQUESTED")) &&
      text.toLocaleLowerCase("pt-BR").includes(normalized);
  });
  return (
    <section className="conversations-page">
      <header className="page-heading">
        <div>
          <h1>Conversas</h1>
        </div>
        <button
          className="primary"
          disabled={!!support.busy}
          onClick={async () => {
            const id = await support.create();
            if (id) onSelect(id);
          }}
        >
          <Icon name="plus" />
          Nova conversa
        </button>
      </header>
      <div className="search-field">
        <Icon name="search" size={16} />
        <input aria-label="Buscar nas conversas" placeholder="Buscar nas conversas" value={query} onChange={event => setQuery(event.target.value)} />
      </div>
      <div className="conversation-filters" aria-label="Filtrar conversas">
        {([["ALL", "Todas"], ["ACTIVE", "Em atendimento"], ["HUMAN_REQUESTED", "Encaminhadas"]] as const).map(([value, label]) =>
          <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}
      </div>
      <p className="list-caption">Histórico de atendimento</p>
      {list.length ? (
        <ConversationList support={support} conversations={list} full onSelect={onSelect} />
      ) : (
        <EmptyState title={support.conversations.length ? "Nenhuma conversa encontrada" : "Vamos iniciar uma conversa"}>
          <p>{support.conversations.length ? "Experimente outra busca ou filtro." : "Crie uma conversa para consultar seus pedidos."}</p>
        </EmptyState>
      )}
    </section>
  );
}
