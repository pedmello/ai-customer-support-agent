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

// A response already confirmed by POST must survive an older in-flight GET.
function mergeHistory(previous: History | undefined, incoming: History): History {
  if (!previous) return incoming;
  const incomingIds = new Set(incoming.turns.map(turn => turn.clientMessageId));
  const missing = previous.turns.filter(turn => !incomingIds.has(turn.clientMessageId));
  const older = new Date(incoming.updatedAt).getTime() < new Date(previous.updatedAt).getTime();
  return {
    ...(missing.length || older ? previous : incoming),
    turns: [...incoming.turns, ...missing].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  };
}

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
  const historiesRef = useRef<Record<string, History>>({});
  const epoch = useRef(0);
  const revision = useRef(0);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [selectedId, setSelectedId] = useState<string>();
  const pendingRef = useRef(new Map<string, SendMessage>());
  const [pending, setPending] = useState<Record<string, SendMessage>>({});
  const retryRef = useRef(new Map<string, SendMessage>());
  const [retries, setRetries] = useState<Record<string, SendMessage>>({});
  const [messageErrors, setMessageErrors] = useState<Record<string, string>>({});
  const [loadingHistories, setLoadingHistories] = useState<Record<string, boolean>>({});
  const recoveryTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => () => {
    epoch.current++;
    recoveryTimers.current.forEach(clearTimeout);
  }, []);

  const storeHistory = useCallback((incoming: History) => {
    const history = mergeHistory(historiesRef.current[incoming.conversationId], incoming);
    historiesRef.current = { ...historiesRef.current, [history.conversationId]: history };
    setHistories(historiesRef.current);
    setConversations(old => old.map(item => item.conversationId === history.conversationId ? history : item));
    return history;
  }, []);
  function forgetRetry(id: string) {
    retryRef.current.delete(id);
    setRetries(Object.fromEntries(retryRef.current));
    const timer = recoveryTimers.current.get(id);
    if (timer) clearTimeout(timer);
    recoveryTimers.current.delete(id);
  }

  const clear = useCallback(() => {
    epoch.current++;
    revision.current++;
    historiesRef.current = {};
    pendingRef.current.clear();
    retryRef.current.clear();
    recoveryTimers.current.forEach(clearTimeout);
    recoveryTimers.current.clear();
    setPending({});
    setRetries({});
    setMessageErrors({});
    setLoadingHistories({});
    locked.current = false;
    setBusy("");
    client.setCsrf();
    setSession(null);
    setOrders([]);
    setConversations([]);
    setHistories({});
    setOutcomes({});
    setSelectedId(undefined);
  }, [client]);
  const loadLists = useCallback(async () => {
    const scope = epoch.current, version = revision.current;
    const [newOrders, newConversations] = await Promise.all([
      client.orders(),
      client.conversations(),
    ]);
    if (scope === epoch.current && version === revision.current) {
      setOrders(newOrders);
      setConversations(newConversations);
    }
    return newConversations;
  }, [client]);
  const loadHistory = useCallback(
    async (id: string) => {
      const scope = epoch.current;
      const history = await client.history(id);
      if (scope !== epoch.current) return undefined;
      return storeHistory(history);
    },
    [client, storeHistory],
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
    const scope = epoch.current;
    const conversation = await client.createConversation();
    if (scope !== epoch.current) return undefined;
    revision.current++;
    setConversations((old) => [conversation, ...old]);
    storeHistory({ ...conversation, turns: [] });
    setSelectedId(conversation.conversationId);
    return conversation.conversationId;
  }
  async function reconcile(conversationId: string, input: SendMessage, scope: number) {
    const loaded = await client.history(conversationId);
    if (scope !== epoch.current || retryRef.current.get(conversationId)?.clientMessageId !== input.clientMessageId) return false;
    storeHistory(loaded);
    // Match the actual GET response, never the locally optimistic history.
    if (!loaded.turns.some(turn => turn.clientMessageId === input.clientMessageId)) return false;
    revision.current++;
    forgetRetry(conversationId);
    setMessageErrors(old => ({ ...old, [conversationId]: "" }));
    void loadLists().catch(cause => {
      if (scope === epoch.current && cause instanceof ApiError && cause.status === 401) clear();
    });
    return true;
  }
  function scheduleReconciliation(conversationId: string, input: SendMessage, scope: number, attempt = 0) {
    const delays = [1500, 3000, 6000];
    if (attempt >= delays.length) return;
    recoveryTimers.current.set(conversationId, setTimeout(async () => {
      if (scope !== epoch.current || retryRef.current.get(conversationId)?.clientMessageId !== input.clientMessageId) return;
      try { if (await reconcile(conversationId, input, scope)) return; }
      catch (cause) { if (cause instanceof ApiError && cause.status === 401) { clear(); return; } }
      scheduleReconciliation(conversationId, input, scope, attempt + 1);
    }, delays[attempt]));
  }
  async function deliver(conversationId: string, input: SendMessage, repeating = false) {
    if (pendingRef.current.has(conversationId) || (!repeating && retryRef.current.has(conversationId))) return;
    const scope = epoch.current;
    pendingRef.current.set(conversationId, input);
    setPending(Object.fromEntries(pendingRef.current));
    forgetRetry(conversationId);
    setMessageErrors(old => ({ ...old, [conversationId]: "" }));
    try {
      const result = await client.send(conversationId, input);
      if (scope !== epoch.current) return;
      revision.current++;
      setOutcomes((old) => ({ ...old, [input.clientMessageId]: result }));
      // Commit the confirmed result locally before refreshing. A failed refresh must never resend a successful mutation.
      {
        const previous = historiesRef.current[conversationId];
        const turns =
          previous?.turns.filter(
            (turn) => turn.clientMessageId !== input.clientMessageId,
          ) ?? [];
        const now = new Date().toISOString();
        storeHistory({
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
        });
      }
      if (result.order)
        setOrders((old) =>
          old.map((order) =>
            order.orderId === result.order!.orderId ? result.order! : order,
          ),
        );
      // POST already returned the authoritative result. Refresh in background, without holding the composer.
      void Promise.all([loadHistory(conversationId), loadLists()]).catch(cause => {
        if (scope !== epoch.current) return;
        if (cause instanceof ApiError && cause.status === 401) clear();
        else setNotice("Resposta recebida. Não foi possível atualizar todos os dados; use Atualizar para sincronizar.");
      });
    } catch (cause) {
      if (scope !== epoch.current) return;
      if (cause instanceof ApiError && cause.status === 401) { clear(); return; }
      if (
        cause instanceof ApiError &&
        (cause.status === 0 ||
          cause.status >= 500 ||
          cause.status === 429 ||
          cause.code === "CONVERSATION_BUSY")
      ) {
        retryRef.current.set(conversationId, input);
        setRetries(Object.fromEntries(retryRef.current));
        try { if (await reconcile(conversationId, input, scope)) return; }
        catch (readError) { if (readError instanceof ApiError && readError.status === 401) { clear(); return; } }
        if (scope !== epoch.current) return;
        scheduleReconciliation(conversationId, input, scope);
      }
      setMessageErrors(old => ({ ...old, [conversationId]: cause instanceof Error ? cause.message : "Não foi possível concluir a mensagem." }));
    } finally {
      if (scope === epoch.current) {
        pendingRef.current.delete(conversationId);
        setPending(Object.fromEntries(pendingRef.current));
      }
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
    retry: selectedId && retries[selectedId] ? { conversationId: selectedId, input: retries[selectedId]! } : undefined,
    sending: selectedId ? pending[selectedId] : undefined,
    messageBusy: selectedId && pending[selectedId] ? "Consultando o assistente…" : "",
    messageError: selectedId ? messageErrors[selectedId] : undefined,
    pendingConversations: pending,
    historyLoading: !!(selectedId && loadingHistories[selectedId]),
    dismissError: () => setError(""),
    login: (email: string, password: string) =>
      perform('Entrando…', async () => {
        const current = await client.login(email, password);
        client.setCsrf(current.csrfToken);
        setSession(current);
        try {
          const list = await loadLists();
          if (list[0]) await loadHistory(list[0].conversationId);
        } catch { setNotice('Login concluído. Use Atualizar para carregar seus dados.'); }
      }),
    register: (name: string, email: string, password: string, passwordConfirmation: string) =>
      perform("Criando sua demonstração…", async () => {
        const current = await client.register(name, email, password, passwordConfirmation);
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
    select: async (id: string) => {
      const scope = epoch.current;
      setSelectedId(id);
      setLoadingHistories(old => ({ ...old, [id]: true }));
      try {
        await loadHistory(id);
      } catch (cause) {
        if (scope !== epoch.current) return;
        if (cause instanceof ApiError && cause.status === 401) clear();
        else setMessageErrors(old => ({ ...old, [id]: cause instanceof Error ? cause.message : "Não foi possível carregar a conversa." }));
      } finally {
        if (scope === epoch.current) setLoadingHistories(old => ({ ...old, [id]: false }));
      }
    },
    create: () => perform("Criando conversa…", newConversation),
    send: async (content: string) => {
        const id = selectedId ?? (await perform("Criando conversa…", newConversation));
        if (!id) return;
        await deliver(id, {
          clientMessageId: crypto.randomUUID(),
          content: content.trim(),
        });
      },
    askOrder: async (orderNumber: number, cancel: boolean) => {
        // A fresh conversation gives this order action an unambiguous, independent context.
        const id = await perform("Criando conversa…", newConversation);
        if (!id) return;
        await deliver(id, {
          clientMessageId: crypto.randomUUID(),
          content: cancel
            ? `Quero cancelar o pedido #${orderNumber}`
            : `Qual o status do pedido #${orderNumber}?`,
        });
      },
    decide: async (confirm: boolean) => {
        const pending = selectedId
          ? histories[selectedId]?.pendingConfirmation
          : null;
        if (!selectedId || !pending) return;
        await deliver(
          selectedId,
          decisionMessage(pending.confirmationId, confirm),
        );
      },
    retrySend: async () => {
      const input = selectedId ? retryRef.current.get(selectedId) : undefined;
      if (selectedId && input) await deliver(selectedId, input, true);
    },
    handoff: () =>
      perform("Registrando solicitação…", async () => {
        const id = selectedId ?? (await newConversation());
        if (!id || pendingRef.current.has(id) || retryRef.current.has(id)) return;
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
