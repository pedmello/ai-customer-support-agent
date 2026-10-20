import { useState } from "react";
import { useSupport } from "./hooks/useSupport";
import { Registration } from "./components/Registration";
import { Navigation, type Section } from "./components/Navigation";
import { ContextPanel, ConversationsPage } from "./components/Conversations";
import { Orders } from "./components/Orders";
import { Chat } from "./components/Chat";
import { Brand, ErrorBanner, Icon } from "./components/ui";

export function App() {
  const support = useSupport();
  const [section, setSection] = useState<Section>("chat");
  const [orderId, setOrderId] = useState<string>();
  function openOrder(id: string) {
    setOrderId(id || undefined);
    setSection("orders");
  }
  if (support.booting)
    return (
      <main className="startup" role="status">
        <Brand />
        <p>Preparando seu atendimento…</p>
        <span className="loading-line" />
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
      <Registration
        busy={!!support.busy}
        error={support.error}
        onSubmit={async (name, email) => {
          await support.register(name, email);
          setSection("chat");
        }}
      />
    );
  return (
    <div className="app-shell">
      <Navigation
        customer={support.session.customer}
        section={section}
        onNavigate={setSection}
        onLogout={() => void support.logout()}
        busy={!!support.busy}
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
        <div className="workspace-toolbar">
          <span role="status">
            {support.busy || "Ambiente demonstrativo · pedidos fictícios"}
          </span>
          <button
            disabled={!!support.busy}
            onClick={() => void support.refresh()}
          >
            <Icon name="refresh" size={13} />
            Atualizar
          </button>
        </div>
        <div className="workspace-content">
          {section === "chat" ? (
            <>
              <ContextPanel
                support={support}
                onAll={() => setSection("conversations")}
                onOrder={openOrder}
              />
              <Chat support={support} onOrder={openOrder} />
            </>
          ) : section === "orders" ? (
            <Orders
              orders={support.orders}
              selectedId={orderId}
              onSelect={setOrderId}
              busy={!!support.busy || !!support.retry}
              onAsk={(id, cancel) => {
                setSection("chat");
                void support.askOrder(id, cancel);
              }}
            />
          ) : (
            <ConversationsPage
              support={support}
              onSelect={async (id) => {
                await support.select(id);
                setSection("chat");
              }}
            />
          )}
        </div>
      </main>
    </div>
  );
}
