// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Authentication } from "./Authentication";
import { Registration } from "./Registration";
import { createApi } from "../services/api";

afterEach(cleanup);
function setup() {
  const client = {
    ...createApi(""),
    requestRecovery: vi
      .fn()
      .mockResolvedValue({
        message: "Se houver uma conta elegível, enviaremos um código.",
        resendAfterSeconds: 60,
      }),
    resetPassword: vi.fn().mockResolvedValue(undefined),
  };
  const onLogin = vi.fn().mockResolvedValue(undefined);
  const onRegister = vi.fn().mockResolvedValue(undefined);
  render(
    <Authentication
      busy={false}
      error=""
      dismissError={() => {}}
      onLogin={onLogin}
      onRegister={onRegister}
      client={client}
    />,
  );
  return { client, onLogin, onRegister };
}
const fill = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label, { exact: true }), {
    target: { value },
  });
describe("authentication screens", () => {
  it("shows the three access options without legacy account instructions", () => {
    setup();
    for (const name of ["Entrar", "Primeiro acesso", "Esqueci minha senha"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    expect(document.body.textContent).not.toMatch(/conta anterior sem senha|contas legadas/i);
  });
  it("logs in once, permits password visibility and does not write browser storage", async () => {
    const storage = vi.spyOn(Storage.prototype, "setItem");
    const { onLogin } = setup();
    fill("E-mail", "ana@example.test");
    fill("Senha", "  password with spaces  ");
    fireEvent.click(screen.getByRole("button", { name: "Mostrar senha" }));
    expect(
      (screen.getByLabelText("Senha", { exact: true }) as HTMLInputElement)
        .type,
    ).toBe("text");
    const button = screen.getByRole("button", { name: "Entrar" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(onLogin).toHaveBeenCalledTimes(1));
    expect(onLogin).toHaveBeenCalledWith(
      "ana@example.test",
      "  password with spaces  ",
    );
    expect(storage).not.toHaveBeenCalled();
    storage.mockRestore();
  });
  it("navigates to registration and validates confirmation before sending", async () => {
    const { onRegister } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Primeiro acesso" }));
    fill("Nome completo", "Ana");
    fill("E-mail", "ana@example.test");
    fill("Senha", "a secure password");
    fill("Confirmar senha", "different password");
    fireEvent.click(screen.getByRole("button", { name: "Criar conta" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "As senhas precisam ser iguais.",
    );
    expect(onRegister).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Já tenho uma conta" }));
    expect(screen.getByRole("button", { name: "Entrar" })).toBeTruthy();
  });
  it("first access registers immediately without requesting an email code", async () => {
    const { client, onRegister } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Primeiro acesso" }));
    fill("Nome completo", "Ana");
    fill("E-mail", "ana@example.test");
    fill("Senha", "a secure password");
    fill("Confirmar senha", "a secure password");
    fireEvent.click(screen.getByRole("button", { name: /^Criar conta/ }));
    await waitFor(() => expect(onRegister).toHaveBeenCalledTimes(1));
    expect(onRegister).toHaveBeenCalledWith("Ana", "ana@example.test", "a secure password", "a secure password");
    expect(client.requestRecovery).not.toHaveBeenCalled();
    expect(client.resetPassword).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Código de 8 dígitos")).toBeNull();
  });
  it("completes recovery with simulated delivery, cooldown and return to login", async () => {
    const { client } = setup();
    fireEvent.click(
      screen.getByRole("button", { name: "Esqueci minha senha" }),
    );
    fill("E-mail", "ana@example.test");
    fireEvent.click(screen.getByRole("button", { name: "Enviar código" }));
    await screen.findByLabelText("Código de 8 dígitos");
    expect(client.requestRecovery).toHaveBeenCalledWith("ana@example.test");
    expect(
      (
        screen.getByRole("button", {
          name: /Reenviar código em/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fill("Código de 8 dígitos", "12345678");
    fill("Nova senha", "my new secure password");
    fill("Confirmar nova senha", "my new secure password");
    fireEvent.click(screen.getByRole("button", { name: "Redefinir senha" }));
    await screen.findByRole("button", { name: "Entrar" });
    expect(client.resetPassword).toHaveBeenCalledWith(
      "ana@example.test",
      "12345678",
      "my new secure password",
      "my new secure password",
    );
    expect(
      screen.getByText("Senha redefinida. Entre com sua nova senha."),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Código de 8 dígitos")).toBeNull();
  });
  it("keeps invalid codes on the reset form and displays a safe error", async () => {
    const { client } = setup();
    client.resetPassword.mockRejectedValueOnce(
      new Error("Código inválido ou expirado."),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Esqueci minha senha" }),
    );
    fill("E-mail", "ana@example.test");
    fireEvent.click(screen.getByRole("button", { name: "Enviar código" }));
    await screen.findByLabelText("Código de 8 dígitos");
    fill("Código de 8 dígitos", "12345678");
    fill("Nova senha", "my new secure password");
    fill("Confirmar nova senha", "my new secure password");
    fireEvent.click(screen.getByRole("button", { name: "Redefinir senha" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Código inválido ou expirado.",
    );
    expect(screen.getByLabelText("Código de 8 dígitos")).toBeTruthy();
  });
  it("registration sends the original password and blocks concurrent submissions", async () => {
    const onSubmit = vi.fn().mockImplementation(() => new Promise(() => {}));
    render(<Registration busy={false} error="" onSubmit={onSubmit} />);
    fill("Nome completo", "Ana");
    fill("E-mail", "ana@example.test");
    fill("Senha", "  my new password  ");
    fill("Confirmar senha", "  my new password  ");
    const button = screen.getByRole("button", { name: /Criar conta/ });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(
      "Ana",
      "ana@example.test",
      "  my new password  ",
      "  my new password  ",
    );
  });
});
