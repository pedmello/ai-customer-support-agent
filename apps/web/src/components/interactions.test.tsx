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
import { Chat } from "./Chat";
import { Orders } from "./Orders";
import { useSupport } from "../hooks/useSupport";
import type { SupportApi } from "../services/api";
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
describe("Interações de confirmação e pedidos", () => {
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
