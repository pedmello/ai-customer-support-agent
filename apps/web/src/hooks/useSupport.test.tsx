// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSupport } from "./useSupport";
import { ApiError, type SupportApi } from "../services/api";
import type { Conversation, History, Outcome } from "../types";

const conversation: Conversation = {
  conversationId: "68a35c30-6527-4c5f-8f2c-d3c9c8fef99c",
  state: "ACTIVE",
  createdAt: "2026-10-19T12:00:00Z",
  updatedAt: "2026-10-19T12:00:00Z",
  pendingConfirmation: null,
};
const history: History = { ...conversation, turns: [] };
const session = {
  customer: { customerId: "customer", name: "Ana", email: "ana@example.test" },
  session: { expiresAt: "2099-01-01T00:00:00Z" },
  csrfToken: "csrf-test",
};
function mockApi() {
  return {
    setCsrf: vi.fn(),
    login: vi.fn(), requestRecovery: vi.fn(), resetPassword: vi.fn(),
    orderByNumber: vi.fn(),
    current: vi.fn().mockResolvedValue(session),
    register: vi.fn().mockResolvedValue(session),
    logout: vi.fn().mockResolvedValue(undefined),
    orders: vi.fn().mockResolvedValue([]),
    conversations: vi.fn().mockResolvedValue([conversation]),
    createConversation: vi.fn().mockResolvedValue(conversation),
    history: vi.fn().mockResolvedValue(history),
    send: vi
      .fn()
      .mockResolvedValue({
        clientMessageId: "message",
        code: "ORDER_STATUS",
        reply: "Pedido em processamento.",
        conversation,
      }),
    handoff: vi.fn().mockResolvedValue({}),
  } satisfies SupportApi;
}
async function setup(client = mockApi()) {
  const hook = renderHook(() => useSupport(client));
  await waitFor(() => expect(hook.result.current.booting).toBe(false));
  return { ...hook, client };
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe("Estado do atendimento e segurança", () => {
  it("mantém o envio restrito à conversa de origem e permite trocar a seleção durante a espera", async () => {
    const { result, client } = await setup();
    let release!: (value: Outcome) => void;
    client.send.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    let delivery!: Promise<unknown>;
    act(() => { delivery = result.current.send("Consultar pedido"); });
    expect(result.current.busy).toBe("");
    const other = { ...history, conversationId: "other" };
    client.history.mockResolvedValueOnce(other);
    await act(() => result.current.select("other"));
    expect(result.current.selectedId).toBe("other");
    expect(result.current.sending).toBeUndefined();
    await act(async () => {
      release({ clientMessageId: "result", code: "ORDER_STATUS", reply: "Resposta da primeira conversa", conversation });
      await delivery;
    });
    expect(result.current.selectedId).toBe("other");
    expect(result.current.histories[conversation.conversationId]!.turns.at(-1)?.messages.at(-1)?.content).toBe("Resposta da primeira conversa");
  });
  it("não apaga a resposta confirmada quando a sincronização devolve um histórico anterior", async () => {
    const { result } = await setup();
    await act(() => result.current.send("Consultar pedido"));
    expect(result.current.history?.turns.at(-1)?.messages.at(-1)?.content).toBe("Pedido em processamento.");
  });
  it("recupera por GET uma mensagem persistida quando o POST perde sua resposta", async () => {
    const { result, client } = await setup();
    client.send.mockImplementationOnce(async (_id, input) => {
      client.history.mockResolvedValue({ ...history, turns: [{
        turnId: "saved", clientMessageId: input.clientMessageId, createdAt: history.createdAt,
        messages: [{ messageId: "saved-reply", role: "ASSISTANT", content: "Resultado salvo", createdAt: history.createdAt }],
      }] });
      throw new ApiError(0, "NETWORK_ERROR");
    });
    await act(() => result.current.send("Consultar pedido"));
    expect(result.current.history?.turns.at(-1)?.messages.at(-1)?.content).toBe("Resultado salvo");
    expect(result.current.retry).toBeUndefined();
    expect(client.send).toHaveBeenCalledTimes(1);
  });
  it("ignora respostas atrasadas depois de encerrar a sessão", async () => {
    const { result, client } = await setup();
    let release!: (value: Outcome) => void;
    client.send.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    let delivery!: Promise<unknown>;
    act(() => { delivery = result.current.send("Consultar pedido"); });
    await act(() => result.current.logout());
    await act(async () => {
      release({ clientMessageId: "late", code: "ORDER_STATUS", reply: "Resposta antiga", conversation });
      await delivery;
    });
    expect(result.current.session).toBeNull();
    expect(result.current.histories).toEqual({});
  });
  it("atualiza a resposta imediatamente mesmo se o GET de sincronização continuar pendente", async () => {
    const { result, client } = await setup();
    client.history.mockImplementationOnce(() => new Promise(() => {}));
    await act(() => result.current.send("Consultar pedido"));
    expect(result.current.sending).toBeUndefined();
    expect(result.current.history?.turns.at(-1)?.messages.at(-1)?.content).toBe("Pedido em processamento.");
  });
  it("permite envios em conversas independentes e restringe erros e retries à origem", async () => {
    const { result, client } = await setup();
    let rejectFirst!: (reason: unknown) => void;
    client.send.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject; }));
    let first!: Promise<unknown>;
    act(() => { first = result.current.send("Primeira conversa"); });
    const other = { ...history, conversationId: "other" };
    client.history.mockResolvedValueOnce(other);
    await act(() => result.current.select("other"));
    client.send.mockResolvedValueOnce({ clientMessageId: "second", code: "AI_TIMEOUT", reply: "Fallback seguro", conversation: other });
    await act(() => result.current.send("Outra conversa"));
    expect(client.send).toHaveBeenCalledTimes(2);
    expect(result.current.history?.turns.at(-1)?.messages.at(-1)?.content).toBe("Fallback seguro");
    await act(async () => { rejectFirst(new ApiError(0, "NETWORK_ERROR")); await first; });
    expect(result.current.selectedId).toBe("other");
    expect(result.current.retry).toBeUndefined();
    expect(result.current.messageError).toBeFalsy();
    expect(result.current.error).toBe("");
    await act(() => result.current.select(conversation.conversationId));
    expect(result.current.retry?.input.content).toBe("Primeira conversa");
  });
  it("sincroniza automaticamente um resultado persistido depois do timeout sem reenviar POST", async () => {
    const { result, client } = await setup();
    vi.useFakeTimers();
    client.send.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR"));
    await act(() => result.current.send("Consultar pedido"));
    const input = client.send.mock.calls[0]![1];
    expect(result.current.retry).toBeDefined();
    client.history.mockResolvedValue({ ...history, turns: [{
      turnId: "late", clientMessageId: input.clientMessageId, createdAt: history.createdAt,
      messages: [{ messageId: "late-reply", role: "ASSISTANT", content: "Resposta recuperada automaticamente", createdAt: history.createdAt }],
    }] });
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(result.current.history?.turns.at(-1)?.messages.at(-1)?.content).toBe("Resposta recuperada automaticamente");
    expect(result.current.retry).toBeUndefined();
    expect(result.current.messageError).toBe("");
    expect(client.send).toHaveBeenCalledTimes(1);
  });
  it("restaura sessão e histórico a partir da API sem persistir tokens no browser", async () => {
    const storage = vi.spyOn(Storage.prototype, "setItem");
    const { result, client } = await setup();
    expect(result.current.session?.customer.name).toBe("Ana");
    expect(result.current.history?.conversationId).toBe(
      conversation.conversationId,
    );
    expect(client.setCsrf).toHaveBeenCalledWith("csrf-test");
    expect(storage).not.toHaveBeenCalled();
  });
  it("trata 401 como sessão encerrada e diferencia falha técnica na inicialização", async () => {
    const client = mockApi();
    client.current.mockRejectedValueOnce(new ApiError(401, "UNAUTHENTICATED"));
    const { result } = await setup(client);
    expect(result.current.session).toBeNull();
    expect(result.current.bootError).toBe("");
    client.current.mockRejectedValueOnce(
      new ApiError(503, "DATABASE_UNAVAILABLE"),
    );
    await act(() => result.current.boot());
    expect(result.current.bootError).not.toBe("");
  });
  it("não concede acesso quando o cadastro retorna e-mail duplicado", async () => {
    const client = mockApi();
    client.current.mockRejectedValue(new ApiError(401, "UNAUTHENTICATED"));
    client.register.mockRejectedValue(
      new ApiError(409, "EMAIL_ALREADY_REGISTERED"),
    );
    const { result } = await setup(client);
    await act(() => result.current.register("Ana", "ana@example.test", "Test-password-123!", "Test-password-123!"));
    expect(result.current.session).toBeNull();
    expect(result.current.error).toContain("já está cadastrado");
  });
  it("mantém a sessão se o logout falhar e limpa dados depois de revogação confirmada", async () => {
    const { result, client } = await setup();
    client.logout.mockRejectedValueOnce(
      new ApiError(503, "DATABASE_UNAVAILABLE"),
    );
    await act(() => result.current.logout());
    expect(result.current.session).not.toBeNull();
    await act(() => result.current.logout());
    expect(result.current.session).toBeNull();
    expect(result.current.conversations).toEqual([]);
    expect(result.current.histories).toEqual({});
  });
  it("bloqueia envios concorrentes antes mesmo do próximo render", async () => {
    const { result, client } = await setup();
    let release!: (value: Outcome) => void;
    client.send.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    let first: Promise<unknown>;
    act(() => {
      first = result.current.send("Status do pedido");
      void result.current.send("Outra mensagem");
    });
    expect(client.send).toHaveBeenCalledTimes(1);
    await act(async () => {
      release({
        clientMessageId: "id",
        code: "ORDER_STATUS",
        reply: "ok",
        conversation,
      });
      await first;
    });
  });
  it("repete a mensagem incerta com mesma chave e mesmo conteúdo", async () => {
    const { result, client } = await setup();
    client.send.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR"));
    await act(() => result.current.send("Consultar pedido"));
    const input = client.send.mock.calls[0]![1];
    expect(result.current.retry?.input).toEqual(input);
    await act(() => result.current.retrySend());
    expect(client.send.mock.calls[1]![1]).toEqual(input);
    expect(result.current.retry).toBeUndefined();
  });
  it("não transforma falha de atualização posterior em repetição de uma operação já confirmada", async () => {
    const { result, client } = await setup();
    client.history.mockRejectedValueOnce(
      new ApiError(503, "DATABASE_UNAVAILABLE"),
    );
    await act(() => result.current.send("Consultar pedido"));
    expect(result.current.retry).toBeUndefined();
    expect(result.current.notice).toContain("Resposta recebida");
    expect(client.send).toHaveBeenCalledTimes(1);
  });
  it("envia confirmação exata vinculada ao desafio da conversa", async () => {
    const client = mockApi();
    client.history.mockResolvedValue({
      ...history,
      state: "AWAITING_CONFIRMATION",
      pendingConfirmation: {
        confirmationId: "challenge-test",
        orderId: "order",
        expiresAt: "2099-01-01T00:00:00Z",
      },
    });
    const { result } = await setup(client);
    await act(() => result.current.decide(true));
    expect(client.send.mock.calls[0]![1]).toMatchObject({
      content: "CONFIRMAR CANCELAMENTO",
      confirmationId: "challenge-test",
    });
  });
  it("inicia cancelamento de pedido por mensagem em conversa nova", async () => {
    const { result, client } = await setup();
    await act(() => result.current.askOrder(48213, true));
    expect(client.createConversation).toHaveBeenCalledTimes(1);
    expect(client.send.mock.calls[0]![1].content).toBe(
      "Quero cancelar o pedido #48213",
    );
  });
  it("registra atendimento humano sem pedir inferência à IA", async () => {
    const { result, client } = await setup();
    await act(() => result.current.handoff());
    expect(client.handoff).toHaveBeenCalledWith(conversation.conversationId);
    expect(client.send).not.toHaveBeenCalled();
    expect(result.current.notice).toContain("simulação");
  });
  it("remove os dados locais se uma operação autenticada retornar 401", async () => {
    const { result, client } = await setup();
    client.orders.mockRejectedValueOnce(new ApiError(401, "UNAUTHENTICATED"));
    await act(() => result.current.refresh());
    expect(result.current.session).toBeNull();
    expect(result.current.histories).toEqual({});
  });
});
