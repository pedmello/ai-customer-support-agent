import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  ApiError,
  decisionMessage,
  type SupportApi,
} from "../services/api";
import type {
  Conversation,
  History,
  Order,
  Outcome,
  SendMessage,
  Session,
} from "../types";

export function useSupport(client: SupportApi = api) {
  const [session, setSession] = useState<Session | null>(null);
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const locked = useRef(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [histories, setHistories] = useState<Record<string, History>>({});
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [selectedId, setSelectedId] = useState<string>();
  const [retry, setRetry] = useState<{
    conversationId: string;
    input: SendMessage;
  }>();
  const [sending, setSending] = useState<SendMessage>();

  const clear = useCallback(() => {
    client.setCsrf();
    setSession(null);
    setOrders([]);
    setConversations([]);
    setHistories({});
    setOutcomes({});
    setSelectedId(undefined);
    setRetry(undefined);
    setSending(undefined);
  }, [client]);
  const loadLists = useCallback(async () => {
    const [newOrders, newConversations] = await Promise.all([
      client.orders(),
      client.conversations(),
    ]);
    setOrders(newOrders);
    setConversations(newConversations);
    return newConversations;
  }, [client]);
  const loadHistory = useCallback(
    async (id: string) => {
      const history = await client.history(id);
      setHistories((old) => ({ ...old, [id]: history }));
      setConversations((old) =>
        old.map((item) => (item.conversationId === id ? history : item)),
      );
      return history;
    },
    [client],
  );
  const boot = useCallback(async () => {
    setBooting(true);
    setBootError("");
    try {
      const current = await client.current();
      client.setCsrf(current.csrfToken);
      setSession(current);
      const list = await loadLists();
      if (list[0]) {
        await loadHistory(list[0].conversationId);
        setSelectedId(list[0].conversationId);
      }
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) clear();
      else
        setBootError(
          cause instanceof Error
            ? cause.message
            : "Não foi possível carregar a aplicação.",
        );
    } finally {
      setBooting(false);
    }
  }, [client, clear, loadLists, loadHistory]);
  useEffect(() => {
    void boot();
  }, [boot]);

  async function perform<T>(
    label: string,
    action: () => Promise<T>,
  ): Promise<T | undefined> {
    if (locked.current) return;
    locked.current = true;
    setBusy(label);
    setError("");
    setNotice("");
    try {
      return await action();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) clear();
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível concluir a operação.",
      );
    } finally {
      locked.current = false;
      setBusy("");
    }
  }
  async function newConversation() {
    const conversation = await client.createConversation();
    setConversations((old) => [conversation, ...old]);
    setHistories((old) => ({
      ...old,
      [conversation.conversationId]: { ...conversation, turns: [] },
    }));
    setSelectedId(conversation.conversationId);
    return conversation.conversationId;
  }
  async function deliver(conversationId: string, input: SendMessage) {
    setSending(input);
    setRetry(undefined);
    try {
      const result = await client.send(conversationId, input);
      setSending(undefined);
      setOutcomes((old) => ({ ...old, [input.clientMessageId]: result }));
      // Commit the confirmed result locally before refreshing. A failed refresh must never resend a successful mutation.
      setHistories((old) => {
        const previous = old[conversationId];
        const turns =
          previous?.turns.filter(
            (turn) => turn.clientMessageId !== input.clientMessageId,
          ) ?? [];
        const now = new Date().toISOString();
        return {
          ...old,
          [conversationId]: {
            ...result.conversation,
            turns: [
              ...turns,
              {
                turnId: input.clientMessageId,
                clientMessageId: input.clientMessageId,
                createdAt: now,
                messages: [
                  {
                    messageId: `${input.clientMessageId}-user`,
                    role: "USER",
                    content: input.content,
                    createdAt: now,
                  },
                  {
                    messageId: `${input.clientMessageId}-agent`,
                    role: "ASSISTANT",
                    content: result.reply,
                    createdAt: now,
                  },
                ],
              },
            ],
          },
        };
      });
      setConversations((old) =>
        old.map((item) =>
          item.conversationId === conversationId ? result.conversation : item,
        ),
      );
      if (result.order)
        setOrders((old) =>
          old.map((order) =>
            order.orderId === result.order!.orderId ? result.order! : order,
          ),
        );
      try {
        await loadHistory(conversationId);
        await loadLists();
      } catch {
        setNotice(
          "Resposta recebida. Não foi possível atualizar todos os dados; use Atualizar para sincronizar.",
        );
      }
    } catch (cause) {
      if (
        cause instanceof ApiError &&
        (cause.status === 0 ||
          cause.status >= 500 ||
          cause.status === 429 ||
          cause.code === "CONVERSATION_BUSY")
      ) {
        setRetry({ conversationId, input });
      }
      throw cause;
    } finally {
      setSending(undefined);
    }
  }
  return {
    session,
    booting,
    bootError,
    boot,
    error,
    notice,
    busy,
    orders,
    conversations,
    histories,
    outcomes,
    selectedId,
    history: selectedId ? histories[selectedId] : undefined,
    retry,
    sending,
    dismissError: () => setError(""),
    register: (name: string, email: string) =>
      perform("Criando sua demonstração…", async () => {
        const current = await client.register(name, email);
        client.setCsrf(current.csrfToken);
        setSession(current);
        try {
          await loadLists();
        } catch {
          setNotice(
            "Cadastro concluído. Use Atualizar para carregar seus pedidos.",
          );
        }
      }),
    logout: () =>
      perform("Encerrando sessão…", async () => {
        await client.logout();
        clear();
      }),
    refresh: () =>
      perform("Atualizando…", async () => {
        await loadLists();
        if (selectedId) await loadHistory(selectedId);
      }),
    select: (id: string) =>
      perform("Carregando conversa…", async () => {
        await loadHistory(id);
        setSelectedId(id);
      }),
    create: () => perform("Criando conversa…", newConversation),
    send: (content: string) =>
      perform("Consultando o assistente…", async () => {
        if (retry) return;
        const id = selectedId ?? (await newConversation());
        await deliver(id, {
          clientMessageId: crypto.randomUUID(),
          content: content.trim(),
        });
      }),
    askOrder: (orderNumber: number, cancel: boolean) =>
      perform("Consultando o assistente…", async () => {
        if (retry) return;
        // A fresh conversation gives this order action an unambiguous, independent context.
        const id = await newConversation();
        await deliver(id, {
          clientMessageId: crypto.randomUUID(),
          content: cancel
            ? `Quero cancelar o pedido #${orderNumber}`
            : `Qual o status do pedido #${orderNumber}?`,
        });
      }),
    decide: (confirm: boolean) =>
      perform("Processando sua decisão…", async () => {
        const pending = selectedId
          ? histories[selectedId]?.pendingConfirmation
          : null;
        if (!selectedId || !pending || retry) return;
        await deliver(
          selectedId,
          decisionMessage(pending.confirmationId, confirm),
        );
      }),
    retrySend: () =>
      perform("Reenviando a mesma mensagem…", async () => {
        if (retry) {
          setSelectedId(retry.conversationId);
          await deliver(retry.conversationId, retry.input);
        }
      }),
    handoff: () =>
      perform("Registrando solicitação…", async () => {
        const id = selectedId ?? (await newConversation());
        await client.handoff(id);
        setNotice(
          "Solicitação de atendimento humano registrada em simulação. Não há equipe conectada nem contato agendado.",
        );
        try {
          await loadHistory(id);
          await loadLists();
        } catch {
          setNotice(
            "Solicitação simulada registrada. Use Atualizar para sincronizar a conversa.",
          );
        }
      }),
  };
}
export type SupportState = ReturnType<typeof useSupport>;
