import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { api, type SupportApi } from "../services/api";
import { AuthLayout } from "./AuthLayout";
import { Registration } from "./Registration";
import { PasswordField } from "./PasswordField";
import { ErrorBanner } from "./ui";
import { PendingIndicator } from './PendingIndicator';

type Mode = "login" | "register" | "request" | "reset";
export function Authentication({
  busy,
  error,
  onLogin,
  onRegister,
  dismissError,
  client = api,
}: {
  busy: boolean;
  error: string;
  dismissError: () => void;
  onLogin: (email: string, password: string) => Promise<unknown>;
  onRegister: (
    name: string,
    email: string,
    password: string,
    confirmation: string,
  ) => Promise<unknown>;
  client?: SupportApi;
}) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [code, setCode] = useState("");
  const [localError, setLocalError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const locked = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [mode]);
  useEffect(() => {
    if (!resendAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [resendAt]);
  function navigate(next: Mode) {
    setMode(next);
    setPassword("");
    setConfirmation("");
    setCode("");
    setNotice("");
    setLocalError("");
    dismissError();
  }
  async function requestCode() {
    const result = await client.requestRecovery(email);
    const until = Date.now() + result.resendAfterSeconds * 1000;
    setNow(Date.now());
    setResendAt(until);
    setMode("reset");
    setNotice(result.message);
    setCode("");
  }
  async function perform(action: () => Promise<unknown>) {
    if (busy || locked.current) return;
    locked.current = true;
    setSubmitting(true);
    setLocalError("");
    dismissError();
    try {
      await action();
    } catch (cause) {
      setLocalError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível concluir a solicitação.",
      );
    } finally {
      locked.current = false;
      setSubmitting(false);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await perform(async () => {
      if (mode === "login") {
        try {
          await onLogin(email, password);
        } finally {
          setPassword("");
        }
      } else if (mode === "request") await requestCode();
      else {
        if (password !== confirmation) {
          setLocalError("As senhas precisam ser iguais.");
          return;
        }
        if (
          !/^\d{8}$/.test(code) ||
          password.length < 12 ||
          password.length > 128
        ) {
          setLocalError("Confira o código e a política de senha.");
          return;
        }
        await client.resetPassword(email, code, password, confirmation);
        client.setCsrf();
        navigate("login");
        setNotice("Senha redefinida. Entre com sua nova senha.");
      }
    });
  }
  const disabled = busy || submitting;
  const seconds = Math.max(0, Math.ceil((resendAt - now) / 1000));
  if (mode === "register")
    return (
      <Registration
        busy={disabled}
        error={error}
        onSubmit={onRegister}
        onLogin={() => navigate("login")}
      />
    );
  const title =
    mode === "login"
      ? "Bem-vindo de volta"
      : mode === "request"
        ? "Recuperar acesso"
        : "Redefinir senha";
  return (
    <AuthLayout>
      <form onSubmit={submit}>
        <h2 ref={heading} tabIndex={-1}>
          {title}
        </h2>
        <p className="muted intro">
          {mode === "login"
            ? "Entre para continuar seus pedidos e conversas."
            : "Enviaremos um código temporário para o e-mail da sua conta, se ela for elegível."}
        </p>
        <label htmlFor="auth-email">E-mail</label>
        <input
          id="auth-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={254}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={disabled || mode === "reset"}
        />
        {mode === "reset" && (
          <>
            <label htmlFor="recovery-code">Código de 8 dígitos</label>
            <input
              id="recovery-code"
              name="code"
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]{8}"
              required
              minLength={8}
              maxLength={8}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              disabled={disabled}
            />
          </>
        )}
        {mode !== "request" && (
          <PasswordField
            id="auth-password"
            label={mode === "reset" ? "Nova senha" : "Senha"}
            value={password}
            onChange={setPassword}
            disabled={disabled}
            current={mode === "login"}
          />
        )}
        {mode === "reset" && (
          <>
            <p id="password-policy" className="field-help">
              Use de 12 a 128 caracteres. O código expira em até 10 minutos e
              tem uso único.
            </p>
            <PasswordField
              id="auth-confirmation"
              label="Confirmar nova senha"
              value={confirmation}
              onChange={setConfirmation}
              disabled={disabled}
            />
          </>
        )}
        <button className="primary continue" disabled={disabled}>
          <PendingIndicator active={disabled} compact />
          {disabled
            ? "Aguarde…"
            : mode === "login"
              ? "Entrar"
              : mode === "request"
                ? "Enviar código"
                : "Redefinir senha"}
        </button>
        {notice && (
          <p className="banner info auth-notice" role="status">
            {notice}
          </p>
        )}
        {(localError || error) && <ErrorBanner message={localError || error} />}
        {mode === "login" ? (
          <>
            <button
              className="auth-link"
              type="button"
              disabled={disabled}
              onClick={() => navigate("register")}
            >
              Primeiro acesso
            </button>
            <button
              className="auth-link"
              type="button"
              disabled={disabled}
              onClick={() => navigate("request")}
            >
              Esqueci minha senha
            </button>
          </>
        ) : (
          <>
            {mode === "reset" && (
              <>
                <button
                  className="auth-link"
                  type="button"
                  disabled={disabled || seconds > 0}
                  onClick={() => void perform(requestCode)}
                >
                  <PendingIndicator active={submitting} compact />
                  {seconds > 0
                    ? `Reenviar código em ${seconds}s`
                    : "Reenviar código"}
                </button>
                <button
                  className="auth-link"
                  type="button"
                  disabled={disabled}
                  onClick={() => navigate("request")}
                >
                  Corrigir e-mail
                </button>
              </>
            )}
            <button
              className="auth-link"
              type="button"
              disabled={disabled}
              onClick={() => navigate("login")}
            >
              Voltar ao login
            </button>
          </>
        )}
      </form>
    </AuthLayout>
  );
}
