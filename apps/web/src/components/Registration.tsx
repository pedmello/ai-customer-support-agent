import { useState } from "react";
import type { FormEvent } from "react";
import { Brand, ErrorBanner, Icon } from "./ui";

export function Registration({
  busy,
  error,
  onSubmit,
}: {
  busy: boolean;
  error: string;
  onSubmit: (name: string, email: string) => Promise<unknown>;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim()) await onSubmit(name, email);
  }
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
      <section className="registration-form">
        <form onSubmit={submit}>
          <h2>Vamos começar</h2>
          <p className="muted intro">
            Crie sua demonstração para consultar pedidos fictícios e falar com o
            assistente.
          </p>
          <label htmlFor="name">Nome completo</label>
          <input
            id="name"
            name="name"
            autoComplete="name"
            required
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={busy}
            pattern=".*\S.*"
          />
          <label htmlFor="email">E-mail</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={busy}
            aria-describedby="demo-note"
          />
          <p id="demo-note" className="field-help">
            O e-mail identifica este cadastro demonstrativo. Não verificamos sua
            posse nem localizamos compras reais.
          </p>
          <button className="primary continue" disabled={busy || !name.trim()}>
            {busy ? "Criando demonstração…" : "Continuar"}{" "}
            <span aria-hidden="true">→</span>
          </button>
          <p className="demo-disclosure">
            Você receberá três pedidos fictícios. Não envie dados sensíveis.
            Esta demonstração não possui login por senha nem recuperação de
            acesso.
          </p>
          {error && <ErrorBanner message={error} />}
        </form>
      </section>
    </main>
  );
}
