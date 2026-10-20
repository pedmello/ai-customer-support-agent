import type { ReactNode } from "react";
import { Brand, Icon } from "./ui";
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="registration">
      <section className="welcome">
        <Brand />
        <div className="welcome-content">
          <h1>Atendimento para seus pedidos, a qualquer hora.</h1>
          <div className="benefit">
            <span>
              <Icon name="box" />
            </span>
            <div>
              <strong>Consulte seus pedidos</strong>
              <p>Status e itens dos pedidos, direto na conversa.</p>
            </div>
          </div>
          <div className="benefit">
            <span>
              <Icon name="shield" />
            </span>
            <div>
              <strong>Cancelamentos com confirmação</strong>
              <p>Nada é cancelado sem sua aprovação explícita.</p>
            </div>
          </div>
          <div className="benefit">
            <span>
              <Icon name="headset" />
            </span>
            <div>
              <strong>Atendimento humano quando precisar</strong>
              <p>Explore o encaminhamento simulado a um atendente.</p>
            </div>
          </div>
        </div>
        <footer>
          © {new Date().getFullYear()} Support AI · Ambiente demonstrativo
        </footer>
      </section>

      <section className="registration-form">{children}</section>
    </main>
  );
}
