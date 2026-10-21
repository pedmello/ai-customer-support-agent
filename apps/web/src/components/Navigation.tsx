import type { Customer } from "../types";
import { Brand, Icon } from "./ui";
import { PendingIndicator } from './PendingIndicator';
export type Section = "chat" | "orders" | "conversations";
export function Navigation({
  customer,
  section,
  onNavigate,
  onLogout,
  busy,
  loggingOut = false,
}: {
  customer: Customer;
  section: Section;
  onNavigate: (section: Section) => void;
  onLogout: () => void;
  busy: boolean;
  loggingOut?: boolean;
}) {
  return (
    <header className="app-header">
      <Brand />
      <div className="profile">
        <span className="avatar">
          {customer.name
            .split(/\s+/)
            .slice(0, 2)
            .map((part) => part[0])
            .join("")
            .toUpperCase()}
        </span>
        <span>
          <strong>{customer.name}</strong>
          <small>{customer.email}</small>
        </span>
      </div>
      <nav aria-label="Navegação principal">
        {(
          [
            { id: "chat", label: "Atendimento", icon: "chat" },
            { id: "orders", label: "Meus pedidos", icon: "box" },
            { id: "conversations", label: "Conversas", icon: "history" },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            className={section === item.id ? "active" : ""}
            aria-current={section === item.id ? "page" : undefined}
            onClick={() => onNavigate(item.id)}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      <button className="logout" aria-label="Sair" title="Sair" onClick={onLogout} disabled={busy}>
        <PendingIndicator compact active={loggingOut} />
        <Icon name="logout" />
      </button>
    </header>
  );
}
