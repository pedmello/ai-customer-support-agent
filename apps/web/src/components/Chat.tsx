import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useLayoutEffect } from "react";
import type { SupportState } from "../hooks/useSupport";
import { conversationTitle } from "./Conversations";
import { date, EmptyState, ErrorBanner, Icon, time } from "./ui";
import { OrderCard } from "./Orders";
import { ExternalProducts } from "./ExternalProducts";
import { HandoffOffer } from "./HandoffOffer";
import { PendingIndicator } from './PendingIndicator';
import { publicOrderText } from "../services/order-presentation";
import type { Order } from "../types";

// Adapt presentation only; the persisted server history and confirmation protocol stay unchanged.
export function displayMessage(
  content: string,
  role: "USER" | "ASSISTANT" = "ASSISTANT",
  orders: Order[] = [],
) {
  content = publicOrderText(content, orders);
  if (role === "USER") {
    if (content === "CONFIRMAR CANCELAMENTO") return "Confirmar cancelamento";
    if (content === "DESISTIR") return "Manter pedido";
    return content;
  }
  if (/confirmationId/.test(content)) {
    if (content.includes("Deseja cancelar o pedido"))
      return (
        content.split("Envie CONFIRMAR")[0] +
        " Use os botões de confirmação abaixo. Nenhum cancelamento foi executado."
      );
    return "Nenhuma alteração realizada. Use os botões da confirmação atual para confirmar ou manter o pedido.";
  }
  return content
    .replace(/\bPROCESSING\b/g, "em processamento")
    .replace(/\bSHIPPED\b/g, "enviado")
    .replace(/\bCANCELLED\b/g, "cancelado");
}
function ConfirmationPanel({ support }: { support: SupportState }) {
  const pending = support.history?.pendingConfirmation;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!pending) return null;
  const expired = new Date(pending.expiresAt).getTime() <= now;
  return (
    <section
      className="confirmation card"
      aria-label="Confirmação de cancelamento"
    >
      <strong>
        {expired ? "Esta confirmação expirou" : "Deseja cancelar este pedido?"}
      </strong>
      <p>
        Pedido #
        {pending.orderNumber ??
          support.orders.find((order) => order.orderId === pending.orderId)
            ?.orderNumber ??
          "selecionado"}
      </p>
      <p className="confirmation-warning">
        {expired
          ? "Solicite o cancelamento novamente pelo chat. Nenhuma alteração é feita apenas pela expiração."
          : "Ao confirmar, verificaremos se o pedido ainda pode ser cancelado. O cancelamento exige sua aprovação explícita."}
      </p>
      {!expired && (
        <>
          <small>Válida até {time(pending.expiresAt)}</small>
          <div>
            <button
              disabled={!!support.busy || !!support.messageBusy || !!support.retry}
              onClick={() => void support.decide(false)}
            >
              <PendingIndicator active={!!support.sending && support.sending.content === 'DESISTIR'} compact />
              Manter pedido
            </button>
            <button
              className="danger"
              disabled={!!support.busy || !!support.messageBusy || !!support.retry}
              onClick={() => void support.decide(true)}
            >
              <PendingIndicator active={!!support.sending && support.sending.content === 'CONFIRMAR CANCELAMENTO'} compact />
              Cancelar pedido
            </button>
          </div>
        </>
      )}
    </section>
  );
}
export function Chat({
  support,
  onOrder,
}: {
  support: SupportState;
  onOrder: (id: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const field = textarea.current;
    if (!field) return;
    const resize = () => {
      field.style.height = 'auto';
      const height = draft ? Math.max(42, Math.min(field.scrollHeight + 2, 132)) : 42;
      field.style.height = `${height}px`;
      field.style.overflowY = height >= 132 ? 'auto' : 'hidden';
    };
    resize();
    if (typeof ResizeObserver === 'undefined') return;
    let width = field.clientWidth;
    const observer = new ResizeObserver(() => {
      if (field.clientWidth !== width) { width = field.clientWidth; resize(); }
    });
    observer.observe(field);
    return () => observer.disconnect();
  }, [draft]);
  const scroll = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const history = support.history;
  const outgoing = support.sending ?? support.retry?.input;
  // Layout effect: the reset commits with the newly selected conversation. A passive effect could
  // run after the composer became visible and erase text the customer had already typed.
  useLayoutEffect(() => {
    setDraft("");
    nearBottom.current = true;
    scroll.current?.scrollTo({ top: scroll.current.scrollHeight });
  }, [support.selectedId]);
  useEffect(() => {
    if (nearBottom.current)
      scroll.current?.scrollTo({
        top: scroll.current.scrollHeight,
        behavior: "smooth",
      });
  }, [history, support.sending, support.busy]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim() || support.busy || support.messageBusy || support.retry) return;
    const content = draft.trim();
    setDraft("");
    nearBottom.current = true;
    await support.send(content);
  }
  return (
    <section className="chat-panel" aria-busy={!!support.sending}>
      <header className="chat-heading">
        <span className="assistant-icon">
          <Icon name="spark" />
        </span>
        <div>
          <h1>
            {history
              ? conversationTitle(history, history, support.orders)
              : "Como podemos ajudar?"}
          </h1>
          <small>
            <span className="online-dot" />
            Assistente Support AI · demonstração
          </small>
        </div>
        <button
          disabled={!!support.busy || !!support.messageBusy || !!support.retry}
          onClick={() => void support.handoff()}
        >
          <PendingIndicator active={!!support.sending && support.sending.content === 'Quero falar com um atendente'} compact />
          <Icon name="headset" size={15} />
          <span>Falar com atendente</span>
        </button>
      </header>
      <div
        className="message-scroll"
        ref={scroll}
        onScroll={() => {
          const node = scroll.current;
          if (node)
            nearBottom.current =
              node.scrollHeight - node.scrollTop - node.clientHeight < 100;
        }}
        role="log"
        aria-label="Histórico da conversa"
        aria-live="polite"
        aria-relevant="additions"
      >
        <PendingIndicator active={!!support.historyLoading} label="Carregando histórico…" />
        {!history?.turns.length && !outgoing && !support.historyLoading && (
          <EmptyState title="Seu atendimento começa aqui">
            <p>
              Consulte um pedido, conheça seus produtos ou solicite um
              cancelamento com confirmação.
            </p>
            <p className="fine-print">
              Use a lista de pedidos para selecionar qual deseja consultar.
            </p>
          </EmptyState>
        )}
        {history?.turns.map((turn, index) => (
          <div className="turn" key={turn.turnId}>
            {(index === 0 ||
              date(turn.createdAt) !==
                date(history.turns[index - 1]!.createdAt)) && (
              <div className="day-divider">{date(turn.createdAt)}</div>
            )}
            {turn.messages.map((message) => (
              <div
                className={`message-row ${message.role === "USER" ? "user" : "assistant"}`}
                key={message.messageId}
              >
                {message.role === "ASSISTANT" && (
                  <span className="message-avatar">
                    <Icon name="spark" size={13} />
                  </span>
                )}
                <div className="message-content">
                  <div className="bubble">
                    {displayMessage(
                      message.content,
                      message.role,
                      support.orders,
                    )}
                  </div>
                  {message.role === "ASSISTANT" &&
                    support.outcomes[turn.clientMessageId]?.order && (
                      <OrderCard
                        order={{
                          ...support.outcomes[turn.clientMessageId]!.order!,
                          orderNumber:
                            support.outcomes[turn.clientMessageId]!.order!
                              .orderNumber ??
                            support.orders.find(
                              (order) =>
                                order.orderId ===
                                support.outcomes[turn.clientMessageId]!.order!
                                  .orderId,
                            )?.orderNumber!,
                        }}
                        onDetails={() =>
                          onOrder(
                            support.outcomes[turn.clientMessageId]!.order!
                              .orderId,
                          )
                        }
                      />
                    )}
                  {message.role === "ASSISTANT" && (
                    <ExternalProducts
                      products={
                        support.outcomes[turn.clientMessageId]?.products ?? []
                      }
                    />
                  )}
                  <time>{time(message.createdAt)}</time>
                </div>
              </div>
            ))}
          </div>
        ))}
        {outgoing && !history?.turns.some(turn => turn.clientMessageId === outgoing.clientMessageId) && (
          <>
            <div className="message-row user">
              <div className="message-content">
                <div className="bubble">
                  {displayMessage(
                    outgoing.content,
                    "USER",
                    support.orders,
                  )}
                </div>
                {!support.sending && <small className="muted">Envio aguardando confirmação</small>}
              </div>
            </div>
            {support.sending && <div className="message-row assistant">
              <span className="message-avatar">
                <Icon name="spark" size={13} />
              </span>
              <PendingIndicator active={!!support.sending} label={support.messageBusy || 'Consultando o assistente…'} />
            </div>}
          </>
        )}
        <ConfirmationPanel support={support} />
        <HandoffOffer support={support} />
      </div>
      <div className="composer-area">
        {support.messageError && <ErrorBanner message={support.messageError} />}
        {support.retry && (
          <div className="retry-notice" role="status">
            <p>
              O resultado desta mensagem ainda não foi confirmado. Reenvie com
              segurança usando a mesma identificação.
            </p>
            <button
              disabled={!!support.busy || !!support.messageBusy}
              onClick={() => void support.retrySend()}
            >
              <PendingIndicator active={!!support.messageBusy} compact />
              Tentar novamente
            </button>
          </div>
        )}
        <div className="quick-actions">
          <button
            disabled={!!support.busy || !!support.messageBusy || !!support.retry}
            onClick={() => setDraft("Qual o status do pedido ")}
          >
            Onde está meu pedido?
          </button>
          <button
            disabled={!!support.busy || !!support.messageBusy || !!support.retry}
            onClick={() => setDraft("Quero cancelar o pedido ")}
          >
            Cancelar um pedido
          </button>
          <button
            disabled={!!support.busy || !!support.messageBusy || !!support.retry}
            onClick={() => void support.handoff()}
          >
            <PendingIndicator active={!!support.sending && support.sending.content === 'Quero falar com um atendente'} compact />
            Falar com atendente
          </button>
        </div>
        <form className="composer" onSubmit={submit}>
          <button type="button" className="mobile-handoff" aria-label="Solicitar atendimento humano simulado" disabled={!!support.busy || !!support.messageBusy || !!support.retry} onClick={() => void support.handoff()}>
            <PendingIndicator active={!!support.sending && support.sending.content === 'Quero falar com um atendente'} compact />
            <Icon name="headset" />
          </button>
          <textarea
            ref={textarea}
            aria-label="Sua mensagem"
            placeholder="Escreva sua mensagem…"
            rows={1}
            maxLength={2000}
            value={draft}
            disabled={!!support.busy || !!support.messageBusy || !!support.retry}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void submit(event);
              }
            }}
          />
          <button
            className="primary send"
            aria-label="Enviar mensagem"
            disabled={!!support.busy || !!support.messageBusy || !!support.retry || !draft.trim()}
          >
            <PendingIndicator active={!!support.messageBusy || support.activity === 'create'} compact />
            <Icon name="arrow" />
          </button>
        </form>
        <div className="composer-note">
          <span>
            O assistente pode cometer erros. Não envie dados sensíveis.
          </span>
          <span>{draft.length}/2000</span>
        </div>
      </div>
    </section>
  );
}
