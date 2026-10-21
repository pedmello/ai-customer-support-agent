// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { Chat } from "./Chat";
import { Orders } from "./Orders";
import { useSupport } from "../hooks/useSupport";
import { ApiError, type SupportApi } from "../services/api";
import type { History, Order } from "../types";

const history: History = {
  conversationId: "conversation",
  state: "AWAITING_CONFIRMATION",
  createdAt: "2026-10-19T12:00:00Z",
  updatedAt: "2026-10-19T12:00:00Z",
  pendingConfirmation: {
    confirmationId: "private-challenge",
    orderId: "order", orderNumber: 48213,
    expiresAt: "2099-01-01T00:00:00Z",
  },
  turns: [],
};
function clientWithHistory(value: History) {
  return {
    setCsrf: vi.fn(),
    login: vi.fn(), requestRecovery: vi.fn(), resetPassword: vi.fn(),
    orderByNumber: vi.fn(),
    current: vi
      .fn()
      .mockResolvedValue({ customer: { name: "Ana" }, csrfToken: "csrf" }),
    orders: vi.fn().mockResolvedValue([]),
    conversations: vi.fn().mockResolvedValue([value]),
    history: vi.fn().mockResolvedValue(value),
    send: vi.fn().mockImplementation(() => new Promise(() => {})),
    register: vi.fn(),
    logout: vi.fn(),
    createConversation: vi.fn(),
    handoff: vi.fn(),
  } satisfies SupportApi;
}
function Harness({ client }: { client: SupportApi }) {
  const support = useSupport(client);
  return <Chat support={support} onOrder={() => {}} />;
}
// jsdom does not implement scrolling; layout/scrolling is verified separately in Chromium.
beforeAll(() =>
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: () => {},
  }),
);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("Rascunho ao selecionar conversa", () => {
  // Reproduces the real ordering without act(): the selection commits from a resolved promise and the
  // customer types before React's scheduler runs passive effects. The draft reset must not erase that text.
  it("preserva o texto digitado logo após a conversa ser selecionada", async () => {
    const previous = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    try {
      const client = clientWithHistory({ ...history, state: "ACTIVE", pendingConfirmation: null });
      const selected = new Promise<void>((resolve) => {
        const observer = new MutationObserver(() => {
          if (!container.querySelector(".chat-heading h1")?.textContent?.includes("Conversa de")) return;
          observer.disconnect();
          resolve();
        });
        observer.observe(container, { childList: true, subtree: true, characterData: true });
      });
      root.render(<Harness client={client} />);
      await selected;
      const field = container.querySelector("textarea")!;
      // Native input event, as a browser emits it, without act() flushing pending effects first.
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, "Consultar meu pedido");
      field.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(field.value).toBe("Consultar meu pedido");
    } finally {
      root.unmount();
      container.remove();
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = previous;
    }
  });
});
describe("Interações de confirmação e pedidos", () => {
  it('grows the composer to its cap, shrinks after clearing and preserves multiline keyboard input', async () => {
    const client = clientWithHistory({ ...history, state: 'ACTIVE', pendingConfirmation: null });
    render(<Harness client={client} />);
    await screen.findByRole('heading', { name: /Conversa de/ });
    const field = await screen.findByRole('textbox', { name: 'Sua mensagem' }) as HTMLTextAreaElement;
    Object.defineProperty(field, 'scrollHeight', { configurable: true, value: 96 });
    fireEvent.change(field, { target: { value: 'Primeira linha\nSegunda linha' } });
    expect(field.style.height).toBe('98px');
    fireEvent.keyDown(field, { key: 'Enter', shiftKey: true });
    expect(client.send).not.toHaveBeenCalled();
    Object.defineProperty(field, 'scrollHeight', { configurable: true, value: 500 });
    fireEvent.change(field, { target: { value: 'Longa mensagem'.repeat(100) } });
    expect(field.style.height).toBe('132px');
    fireEvent.change(field, { target: { value: '' } });
    expect(field.style.height).toBe('42px');
  });
  it.each([true, false])("envia consentimento humano %s com a oferta atual, sem cliques duplicados", async accept => {
    const client = clientWithHistory({ ...history, pendingConfirmation: null, state: "ACTIVE",
      pendingHandoff: { offerId: "private-offer", expiresAt: "2099-01-01T00:00:00Z" } });
    render(<Harness client={client} />);
    const button = await screen.findByRole("button", { name: accept ? "Sim, solicitar atendimento" : "Não, obrigado" });
    expect(document.body.textContent).not.toContain("private-offer");
    fireEvent.click(button); fireEvent.click(button);
    await waitFor(() => expect(client.send).toHaveBeenCalledTimes(1));
    expect(client.send.mock.calls[0]![1]).toMatchObject({
      handoffOfferId: "private-offer", content: accept ? "Sim, solicitar atendimento" : "Não, obrigado",
    });
    expect(client.handoff).not.toHaveBeenCalled();
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
  it("não permite aceitar uma oferta humana expirada", async () => {
    const client = clientWithHistory({ ...history, pendingConfirmation: null, state: "ACTIVE",
      pendingHandoff: { offerId: "private-offer", expiresAt: "2000-01-01T00:00:00Z" } });
    render(<Harness client={client} />);
    await screen.findByText("Esta oferta expirou");
    expect(screen.queryByRole("button", { name: "Sim, solicitar atendimento" })).toBeNull();
    expect(client.send).not.toHaveBeenCalled();
  });
  it("mantém a mensagem visível quando o envio fica sem resultado confirmado", async () => {
    const client = clientWithHistory({ ...history, state: "ACTIVE", pendingConfirmation: null });
    client.send.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR"));
    render(<Harness client={client} />);
    await screen.findByRole("heading", { name: /Conversa de/ });
    fireEvent.change(screen.getByRole("textbox", { name: "Sua mensagem" }), { target: { value: "Consultar meu pedido" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar mensagem" }));
    await screen.findByRole("button", { name: "Tentar novamente" });
    expect(screen.getByText("Consultar meu pedido")).toBeTruthy();
    expect(screen.getByText("Envio aguardando confirmação")).toBeTruthy();
  });
  it("confirma por botão sem mostrar o identificador técnico e bloqueia duplo clique", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollTo").mockImplementation(() => {});
    const client = clientWithHistory(history);
    render(<Harness client={client} />);
    const button = await screen.findByRole("button", {
      name: "Cancelar pedido",
    });
    expect(document.body.textContent).not.toContain("private-challenge");
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(client.send).toHaveBeenCalledTimes(1));
    expect(client.send.mock.calls[0]![1]).toMatchObject({
      content: "CONFIRMAR CANCELAMENTO",
      confirmationId: "private-challenge",
    });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
  it("desiste usando DESISTIR com o desafio atual", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollTo").mockImplementation(() => {});
    const client = clientWithHistory(history);
    render(<Harness client={client} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Manter pedido" }),
    );
    expect(client.send.mock.calls[0]![1]).toMatchObject({
      content: "DESISTIR",
      confirmationId: "private-challenge",
    });
  });
  it("não oferece confirmação de desafio expirado", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollTo").mockImplementation(() => {});
    const client = clientWithHistory({
      ...history,
      pendingConfirmation: {
        ...history.pendingConfirmation!,
        expiresAt: "2000-01-01T00:00:00Z",
      },
    });
    render(<Harness client={client} />);
    await screen.findByText("Esta confirmação expirou");
    expect(
      screen.queryByRole("button", { name: "Cancelar pedido" }),
    ).toBeNull();
    expect(client.send).not.toHaveBeenCalled();
  });
  it("busca e filtra somente os dados disponíveis e inicia a ação no chat", async () => {
    const order: Order = {
      orderId: "order-123", orderNumber: 48213,
      status: "PROCESSING",
      currency: "USD",
      createdAt: "2026-10-19T12:00:00Z",
      updatedAt: "2026-10-19T12:00:00Z",
      cancelledAt: null,
      totalCents: 2500,
      items: [
        {
          productId: 1,
          title: "Mochila demonstrativa",
          quantity: 1,
          unitPriceCents: 2500,
        },
      ],
    };
    const onAsk = vi.fn();
    render(
      <Orders
        orders={[order]}
        onSelect={() => {}}
        onAsk={onAsk}
        busy={false}
      />,
    );
    fireEvent.change(
      screen.getByRole("textbox", {
        name: "Buscar pedido por produto ou número",
      }),
      { target: { value: "inexistente" } },
    );
    expect(screen.getByText("Nenhum pedido encontrado")).toBeTruthy();
    fireEvent.change(
      screen.getByRole("textbox", {
        name: "Buscar pedido por produto ou número",
      }),
      { target: { value: "Mochila" } },
    );
    expect(screen.getAllByText("Mochila demonstrativa").length).toBeGreaterThan(
      0,
    );
    fireEvent.click(screen.getByRole("button", { name: "Enviado" }));
    expect(screen.getByText("Nenhum pedido encontrado")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Todos" }));
    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: "Solicitar cancelamento" }),
      ),
    );
    expect(onAsk).toHaveBeenCalledWith(48213, true);
  });
});
