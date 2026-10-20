import type {
  Conversation,
  History,
  HistoryPage,
  Order,
  Outcome,
  Page,
  SendMessage,
  Session,
} from "../types";

const errors: Record<string, string> = {
  EMAIL_ALREADY_REGISTERED:
    "Este e-mail já está cadastrado. Use outro e-mail para criar uma demonstração. Informar um e-mail existente não recupera uma conta.",
  UNAUTHENTICATED:
    "Sua sessão expirou. Inicie uma nova demonstração com outro e-mail.",
  CSRF_INVALID:
    "A proteção da sessão foi atualizada. Recarregue a página antes de tentar novamente.",
  VALIDATION_ERROR: "Confira os dados informados e tente novamente.",
  CONVERSATION_BUSY:
    "Esta conversa ainda está processando uma mensagem. Aguarde e tente novamente.",
  AGENT_RATE_LIMITED: "Muitas mensagens em pouco tempo. Aguarde um minuto.",
  CONVERSATION_NOT_FOUND: "Esta conversa não está disponível para sua sessão.",
  ORDER_NOT_FOUND: "Este pedido não está disponível para sua sessão.",
  MESSAGE_ID_CONFLICT:
    "Esta mensagem não pode ser reutilizada com outro conteúdo. Recarregue a conversa.",
};
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(
      errors[code] ??
        "Não foi possível concluir a solicitação. Tente novamente em instantes.",
    );
  }
}
export function decisionMessage(
  confirmationId: string,
  confirm: boolean,
): SendMessage {
  return {
    clientMessageId: crypto.randomUUID(),
    content: confirm ? "CONFIRMAR CANCELAMENTO" : "DESISTIR",
    confirmationId,
  };
}
export function createApi(baseUrl: string, fetcher: typeof fetch = fetch) {
  let csrf: string | undefined;
  async function request<T>(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<T> {
    const controller = new AbortController();
    // Longer than the backend inference budget; abort never implies the operation failed to commit.
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
      const headers = new Headers({ Accept: "application/json" });
      if (body !== undefined) headers.set("Content-Type", "application/json");
      if (method !== "GET" && csrf) headers.set("X-CSRF-Token", csrf);
      const response = await fetcher(`${baseUrl.replace(/\/$/, "")}${path}`, {
        method,
        headers,
        credentials: "include",
        signal: controller.signal,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new ApiError(
          response.status,
          typeof payload?.error?.code === "string"
            ? payload.error.code
            : "HTTP_ERROR",
        );
      }
      return response.status === 204
        ? (undefined as T)
        : ((await response.json()) as T);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(0, "NETWORK_ERROR");
    } finally {
      clearTimeout(timer);
    }
  }
  async function all<T>(path: string): Promise<T[]> {
    const items: T[] = [];
    for (let page = 1; ; page++) {
      const result = await request<Page<T>>(
        `${path}?page=${page}&pageSize=100`,
      );
      items.push(...result.data);
      if (page >= result.pagination.totalPages) return items;
    }
  }
  return {
    setCsrf(token?: string) {
      csrf = token;
    },
    current: () => request<Session>("/sessions/current"),
    register: (name: string, email: string) =>
      request<Session>("/customers", "POST", {
        name: name.trim(),
        email: email.trim().toLowerCase(),
      }),
    logout: () => request<void>("/sessions/current", "DELETE"),
    orders: () => all<Order>("/orders"),
    orderByNumber: async (number: number) => (await request<{ data: Order }>(`/orders/by-number/${number}`)).data,
    conversations: () => all<Conversation>("/conversations"),
    createConversation: async () =>
      (await request<{ data: Conversation }>("/conversations", "POST", {}))
        .data,
    async history(id: string): Promise<History> {
      const first = await request<HistoryPage>(
        `/conversations/${id}?page=1&pageSize=100`,
      );
      for (let page = 2; page <= first.pagination.totalPages; page++) {
        const next = await request<HistoryPage>(
          `/conversations/${id}?page=${page}&pageSize=100`,
        );
        first.data.turns.push(...next.data.turns);
      }
      return first.data;
    },
    send: async (id: string, input: SendMessage) =>
      (
        await request<{ data: Outcome }>(
          `/conversations/${id}/messages`,
          "POST",
          input,
        )
      ).data,
    handoff: (conversationId: string) =>
      request("/handoffs", "POST", {
        conversationId,
        reason: "CUSTOMER_REQUEST",
      }),
  };
}
export const api = createApi(
  import.meta.env.VITE_API_URL || "http://localhost:3000",
);
export type SupportApi = ReturnType<typeof createApi>;
