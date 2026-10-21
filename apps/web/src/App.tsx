import { useState } from "react";
import { useSupport } from "./hooks/useSupport";
import { Authentication } from "./components/Authentication";
import { Navigation, type Section } from "./components/Navigation";
import {
  ContextPanel,
  ConversationsPage,
  OrderRail,
} from "./components/Conversations";
import { Orders } from "./components/Orders";
import { Chat } from "./components/Chat";
import { Brand, ErrorBanner, Icon } from "./components/ui";
import { PendingIndicator } from './components/PendingIndicator';

export function App() {
  const support = useSupport();
  const [section, setSection] = useState<Section>("chat");
  const [orderId, setOrderId] = useState<string>();
  const [conversationOpen, setConversationOpen] = useState(false);
  function openOrder(id: string) {
    setOrderId(id || undefined);
    setSection("orders");
  }
  if (support.booting)
    return (
      <main className="startup" role="status">
        <Brand />
        <p>Preparando seu atendimento…</p>
        <PendingIndicator active label="Carregando aplicação…" />
      </main>
    );
  if (support.bootError)
    return (
      <main className="startup">
        <Brand />
        <ErrorBanner message={support.bootError} />
        <button className="primary" onClick={() => void support.boot()}>
          Tentar novamente
        </button>
      </main>
    );
  if (!support.session)
    return (
      <Authentication
        busy={!!support.busy}
        error={support.error}
        dismissError={support.dismissError}
        onLogin={async (email, password) => {
          await support.login(email, password);
          setSection('chat');
        }}
        onRegister={async (name, email, password, confirmation) => {
          await support.register(name, email, password, confirmation);
          setSection("chat");
        }}
      />
    );
  return (
    <div className="app-shell">
      <Navigation
        customer={support.session.customer}
        section={section}
        onNavigate={(next) => {
          setSection(next);
          setConversationOpen(false);
        }}
        onLogout={() => void support.logout()}
        busy={!!support.busy}
        loggingOut={support.activity === 'logout'}
      />
      <main className="workspace">
        <div className="workspace-notifications">
          {support.error && (
            <ErrorBanner
              message={support.error}
              onClose={support.dismissError}
            />
          )}
          {support.notice && (
            <div className="banner info" role="status">
              {support.notice}
            </div>
          )}
        </div>
        <div className={`workspace-content section-${section} ${conversationOpen ? "conversation-open" : ""}`}>
          {section === "chat" ? (
            <>
              <ContextPanel
                support={support}
                onAll={() => setSection("conversations")}
              />
              <Chat support={support} onOrder={openOrder} />
              <OrderRail support={support} onOrder={openOrder} />
            </>
          ) : section === "orders" ? (
            <Orders
              orders={support.orders}
              selectedId={orderId}
              onSelect={setOrderId}
              busy={!!support.busy}
              loading={support.listsLoading}
              onAsk={(id, cancel) => {
                setSection("chat");
                void support.askOrder(id, cancel);
              }}
            />
          ) : (
            <>
              <ConversationsPage
                support={support}
                onSelect={(id) => {
                  setConversationOpen(true);
                  void support.select(id);
                }}
              />
              <div className="conversation-detail">
                <button className="mobile-back" onClick={() => setConversationOpen(false)}>
                  <Icon name="back" />Conversas
                </button>
                <Chat support={support} onOrder={openOrder} />
              </div>
            </>
          )}
        </div>
        <footer className="workspace-footer">
          <span role="status">{support.busy || "Ambiente demonstrativo · pedidos fictícios"}</span>
          <button disabled={!!support.busy} onClick={() => void support.refresh()}><PendingIndicator compact active={support.activity === 'refresh'} /><Icon name="refresh" size={12} />Atualizar</button>
        </footer>
      </main>
    </div>
  );
}
