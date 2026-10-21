import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { ErrorBanner } from "./ui";
import { AuthLayout } from "./AuthLayout";
import { PasswordField } from "./PasswordField";
import { PendingIndicator } from './PendingIndicator';

export function Registration({
  busy,
  error,
  onSubmit,
  onLogin,
}: {
  busy: boolean;
  error: string;
  onSubmit: (
    name: string,
    email: string,
    password: string,
    passwordConfirmation: string,
  ) => Promise<unknown>;
  onLogin?: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [validation, setValidation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const locked = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current || busy) return;
    setValidation("");
    if (password !== confirmation) {
      setValidation("As senhas precisam ser iguais.");
      return;
    }
    if (password.length < 12 || password.length > 128 || !name.trim()) {
      setValidation("Confira os campos e a política de senha.");
      return;
    }
    locked.current = true;
    setSubmitting(true);
    try {
      await onSubmit(name, email, password, confirmation);
    } finally {
      locked.current = false;
      setSubmitting(false);
      setPassword("");
      setConfirmation("");
    }
  }
  const disabled = busy || submitting;
  return (
    <AuthLayout>
      <form onSubmit={submit}>
        <h2>Vamos começar</h2>
        <p className="muted intro">
          Crie sua conta para consultar pedidos fictícios e falar com o
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
          disabled={disabled}
          pattern={String.raw`.*\S.*`}
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
          disabled={disabled}
          aria-describedby="demo-note"
        />
        <PasswordField
          id="password"
          label="Senha"
          value={password}
          onChange={setPassword}
          disabled={disabled}
        />
        <p id="password-policy" className="field-help">
          Use de 12 a 128 caracteres. Espaços fazem parte da senha.
        </p>
        <PasswordField
          id="passwordConfirmation"
          label="Confirmar senha"
          value={confirmation}
          onChange={setConfirmation}
          disabled={disabled}
        />
        <p id="demo-note" className="field-help">
          O cadastro não verifica a posse do e-mail nem localiza compras reais.
          Use um endereço ao qual você tenha acesso para recuperar sua conta.
        </p>
        <button
          className="primary continue"
          disabled={disabled || !name.trim()}
        >
          <PendingIndicator active={disabled} compact />
          {disabled ? "Criando conta…" : "Criar conta"}{" "}
          <span aria-hidden="true">→</span>
        </button>
        <button
          type="button"
          className="auth-link"
          disabled={disabled}
          onClick={onLogin}
        >
          Já tenho uma conta
        </button>
        <p className="demo-disclosure">
          Você receberá seis pedidos fictícios. Não envie dados sensíveis no
          atendimento.
        </p>
        {(validation || error) && <ErrorBanner message={validation || error} />}
      </form>
    </AuthLayout>
  );
}
