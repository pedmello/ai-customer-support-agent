import { createHash, randomUUID } from 'node:crypto';
import { AppError } from '../../errors/app-error.js';
import type { PrismaClient, Prisma, Conversation, HandoffReason } from '../../generated/prisma/client.js';
import { AiFailure, intentSchema, type AgentIntent, type IntentModel } from '../../integrations/ai/intent-model.js';
import type { ProductClient, ProductResult } from '../../integrations/fake-store/fake-store.client.js';
import { createOrderRepository } from '../orders/order.repository.js';
import { createOrderService } from '../orders/order.service.js';
import { createHandoffRepository } from '../handoffs/handoff.repository.js';
import { createHandoffService } from '../handoffs/handoff.service.js';
import { conversationPublicView, type ConversationRepository } from '../conversations/conversation.repository.js';
import type { SendMessage } from '../conversations/conversation.schemas.js';
import { explicitDecision, redactSensitive, resolveOrderReference } from './agent.safety.js';
import { orderLabel, orderStatusReply } from './agent.responses.js';
import { bulkCancellation, collectionQuery, collectionResponse, individualOrderQuery, explicitOrderContext, queryFromPlan, actionRefusal } from './agent.collection.js';
import { ambiguousHandoffReply, clearHandoffOffer, directHumanRequest, handoffDecision } from '../handoffs/handoff.consent.js';

export interface AgentDependencies {
  model: IntentModel;
  products: ProductClient;
  confirmationTtlSeconds: number;
}
type Plan = { interpretation: AgentIntent; products?: ProductResult[]; failure?: string };
const clearPending = { pendingOrderId: null, confirmationId: null, confirmationExpiresAt: null, state: 'ACTIVE' as const };
const unknown: AgentIntent = { intent: 'UNKNOWN', orderId: null, orderNumber: null, opening: 'NONE' };
type OrderView = Awaited<ReturnType<ReturnType<typeof createOrderService>['getOwn']>>;
export interface AgentOutcome {
  code: string;
  reply: string;
  order?: OrderView;
  products?: ProductResult[];
  collection?: ReturnType<typeof collectionResponse>['collection'];
  handoff?: Awaited<ReturnType<ReturnType<typeof createHandoffService>['register']>>;
}

function replay(turn: { inputHash: string; result: Prisma.JsonValue }, hash: string) {
  if (turn.inputHash !== hash) throw new AppError(409, 'MESSAGE_ID_CONFLICT', 'clientMessageId já foi utilizado para outra mensagem.');
  return turn.result;
}

export function createAgentOrchestrator(database: PrismaClient, repository: ConversationRepository, dependencies: AgentDependencies) {
  const orders = createOrderService(createOrderRepository(database));

  async function referencedOrder(customerId: string, conversation: Conversation, input: SendMessage, interpretation: AgentIntent, service = orders) {
    // An old lastOrderId alone does not make a new singular question unambiguous.
    if (!/\d/.test(input.content) && !explicitOrderContext(input.content)) return null;
    const reference = resolveOrderReference(input.content, interpretation.orderNumber, interpretation.orderId, conversation.lastOrderId);
    if (reference.kind === 'invalid') {
      // A model may repeat a public number from the persisted context, but cannot switch that context.
      const contextReference = resolveOrderReference(input.content, null, interpretation.orderId, conversation.lastOrderId);
      if (interpretation.orderNumber !== null && contextReference.kind === 'context' && !/\d/.test(input.content)) {
        const contextOrder = await service.getOwn(customerId, contextReference.orderId);
        if (contextOrder.orderNumber === interpretation.orderNumber) return contextOrder;
      }
      return null;
    }
    return reference.kind === 'number' ? service.getOwnByNumber(customerId, reference.orderNumber) : service.getOwn(customerId, reference.orderId);
  }

  async function publicModelInput(customerId: string, content: string, history: Array<{ role: 'USER' | 'ASSISTANT'; content: string }>) {
    const pattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
    const ids = [...new Set([content, ...history.map(message => message.content)].flatMap(text => text.match(pattern) ?? []).map(id => id.toLowerCase()))];
    const records = ids.length ? await database.order.findMany({ where: { customerId, orderId: { in: ids } }, select: { orderId: true, orderNumber: true } }) : [];
    const numbers = new Map(records.map(order => [order.orderId, order.orderNumber]));
    const present = (text: string) => redactSensitive(text.replace(pattern, id => numbers.has(id.toLowerCase()) ? `#${numbers.get(id.toLowerCase())}` : '[pedido indisponível]'));
    return { content: present(content), history: history.map(message => ({ ...message, content: present(message.content) })) };
  }

  async function plan(customerId: string, conversation: Conversation, input: SendMessage): Promise<Plan> {
    // The explicit decision is evaluated without asking the model, even during outages.
    if (input.confirmationId || /^(CONFIRMAR CANCELAMENTO|DESISTIR)$/i.test(input.content)) return { interpretation: unknown };
    if (input.handoffOfferId || (conversation.handoffOfferId && (handoffDecision(input.content) || ambiguousHandoffReply(input.content))))
      return { interpretation: unknown };
    if (directHumanRequest(input.content)) return { interpretation: { ...unknown, intent: 'HUMAN' } };
    if (bulkCancellation(input.content)) return { interpretation: unknown };
    try {
      const recent = await repository.countRecent(customerId);
      if (recent >= 30) throw new AppError(429, 'AGENT_RATE_LIMITED', 'Limite de mensagens atingido. Aguarde um minuto.');
      if (actionRefusal(input.content)) return { interpretation: unknown };
      // Recognized reads do not depend on model classification/availability. Keep the same quota.
      if (collectionQuery(input.content)) return { interpretation: { ...unknown, intent: 'ORDER_COLLECTION' } };
      if (individualOrderQuery(input.content)) return { interpretation: { ...unknown, intent: 'ORDER_STATUS' } };
      const interpretation = intentSchema.parse(await dependencies.model.interpret(await publicModelInput(customerId, input.content, await repository.context(conversation.conversationId))));
      if (interpretation.collectionPlan && (interpretation.intent !== 'ORDER_COLLECTION' || !queryFromPlan(interpretation, input.content)))
        return { interpretation: unknown, failure: 'QUERY_PLAN_INVALID' };
      if (interpretation.intent !== 'ORDER_PRODUCTS') return { interpretation };
      const order = await referencedOrder(customerId, conversation, input, interpretation);
      if (!order) return { interpretation };
      const products = await Promise.all(order.items.slice(0, 10).map(async (item) => {
        const result = await dependencies.products.getProduct(item.productId);
        if (result.status !== 'AVAILABLE') return result;
        return { ...result, product: { ...result.product, title: redactSensitive(result.product.title),
          description: redactSensitive(result.product.description), category: redactSensitive(result.product.category) } };
      }));
      return { interpretation, products };
    } catch (error) {
      if (error instanceof AppError) {
        if (error.code === 'ORDER_NOT_FOUND') return { interpretation: { ...unknown, intent: 'ORDER_PRODUCTS' }, failure: 'ORDER_NOT_FOUND' };
        throw error;
      }
      // Malformed model outputs are unsafe and cannot reach a business operation.
      if (error instanceof AiFailure || (error instanceof Error && error.name === 'ZodError')) {
        return { interpretation: unknown, failure: error instanceof AiFailure ? error.code : 'AI_INVALID_RESPONSE' };
      }
      throw error;
    }
  }

  async function execute(tx: Prisma.TransactionClient, conversation: Conversation, input: SendMessage, prepared: Plan): Promise<AgentOutcome> {
    const customerId = conversation.customerId;
    const conversationId = conversation.conversationId;
    const mainOrders = createOrderService(createOrderRepository(database, tx));
    const update = (data: Prisma.ConversationUpdateInput) => repository.updateState(tx, conversationId, data);
    const registerHuman = async (reason: HandoffReason, code: string, reply: string): Promise<AgentOutcome> => {
      const handoff = await createHandoffService(createHandoffRepository(tx)).register(customerId, reason, conversationId);
      await update({ ...clearPending, ...clearHandoffOffer, state: 'HUMAN_REQUESTED' });
      return { code, reply: `${reply} Registrei uma solicitação de atendimento humano nesta demonstração. É uma simulação: não há equipe conectada nem contato agendado.`, handoff };
    };
    const offerHuman = async (reason: HandoffReason, code: string, reply: string): Promise<AgentOutcome> => {
      const existing = await tx.humanHandoff.findUnique({ where: { conversationId } });
      if (existing) return { code, reply: `${reply} Já existe uma solicitação de atendimento humano nesta conversa. É uma simulação: não há equipe conectada nem contato agendado.` };
      await update({ ...clearPending, handoffOfferId: randomUUID(), handoffOfferReason: reason,
        handoffOfferExpiresAt: new Date(Date.now() + dependencies.confirmationTtlSeconds * 1000) });
      return { code, reply: `${reply} Você gostaria de solicitar atendimento humano?` };
    };
    if (input.handoffOfferId) {
      if (input.handoffOfferId !== conversation.handoffOfferId || !conversation.handoffOfferReason) {
        return { code: 'HANDOFF_CONFIRMATION_INVALID', reply: 'Esta oferta não está disponível nesta conversa. Nenhuma solicitação foi registrada.' };
      }
      if (!conversation.handoffOfferExpiresAt || conversation.handoffOfferExpiresAt <= new Date()) {
        await update(clearHandoffOffer);
        return { code: 'HANDOFF_CONFIRMATION_EXPIRED', reply: 'A oferta expirou. Você pode solicitar atendimento humano novamente. Nenhuma solicitação foi registrada.' };
      }
      const choice = handoffDecision(input.content);
      if (!choice) {
        if (!ambiguousHandoffReply(input.content)) {
          await update(clearHandoffOffer);
          return { code: 'HANDOFF_CONFIRMATION_INVALID', reply: 'A mensagem não é uma decisão da oferta atual. A oferta anterior foi encerrada; você pode continuar sua pergunta ou solicitar atendimento humano novamente. Nenhuma solicitação foi registrada.' };
        }
        return { code: 'HANDOFF_CONFIRMATION_REQUIRED', reply: 'Deseja solicitar atendimento humano? Selecione Sim, solicitar atendimento ou Não, obrigado. Nenhuma solicitação foi registrada.' };
      }
      const reason = conversation.handoffOfferReason;
      await update(clearHandoffOffer);
      if (choice === 'decline') return { code: 'HANDOFF_DECLINED', reply: 'Tudo bem. Nenhuma solicitação foi registrada. Podemos continuar por aqui com seus pedidos.' };
      return registerHuman(reason, 'HUMAN_REQUESTED', 'Você confirmou a solicitação de atendimento humano.');
    }
    const refusal = actionRefusal(input.content);
    if (refusal === 'cancel') {
      await update(clearPending);
      return { code: 'CANCELLATION_DECLINED', reply: 'Entendido. Não vou iniciar um cancelamento. Nenhum pedido foi alterado.' };
    }
    if (refusal === 'human') {
      await update(clearHandoffOffer);
      return { code: 'HANDOFF_DECLINED', reply: 'Tudo bem. Não registrei atendimento humano. Podemos continuar por aqui.' };
    }
    if (directHumanRequest(input.content)) return registerHuman('CUSTOMER_REQUEST', 'HUMAN_REQUESTED', 'Você solicitou atendimento humano.');
    if (conversation.handoffOfferId) {
      const expired = !conversation.handoffOfferExpiresAt || conversation.handoffOfferExpiresAt <= new Date();
      if (expired) await update(clearHandoffOffer);
      else if (handoffDecision(input.content) === 'decline') {
        await update(clearHandoffOffer);
        return { code: 'HANDOFF_DECLINED', reply: 'Tudo bem. Nenhuma solicitação foi registrada. Podemos continuar por aqui com seus pedidos.' };
      } else if (handoffDecision(input.content) || ambiguousHandoffReply(input.content)) {
        return { code: 'HANDOFF_CONFIRMATION_REQUIRED', reply: 'Você gostaria de solicitar atendimento humano? Use as opções da oferta atual para confirmar ou recusar. Nenhuma solicitação foi registrada.' };
      } else await update(clearHandoffOffer); // A new subject invalidates the old offer before executing the new intention.
    }
    const decision = explicitDecision(input, conversation.confirmationId);
    const explicitAttempt = input.confirmationId || /^(CONFIRMAR CANCELAMENTO|DESISTIR)$/i.test(input.content);
    if (explicitAttempt) {
      if (!conversation.confirmationId || input.confirmationId !== conversation.confirmationId || !decision) {
        return { code: 'CONFIRMATION_INVALID', reply: 'Confirmação inválida. Solicite o cancelamento nesta conversa e utilize a confirmação atual.' };
      }
      if (!conversation.confirmationExpiresAt || conversation.confirmationExpiresAt <= new Date()) {
        await update(clearPending);
        return { code: 'CONFIRMATION_EXPIRED', reply: 'A confirmação expirou. Solicite novamente o cancelamento; nenhum pedido foi alterado.' };
      }
      if (decision === 'decline') {
        await update(clearPending);
        return { code: 'CANCELLATION_DECLINED', reply: 'Você desistiu do cancelamento. Nenhum pedido foi alterado.' };
      }
      if (!conversation.pendingOrderId) return offerHuman('SAFETY_FAILURE', 'CONFIRMATION_INVALID', 'Não há pedido válido para confirmar.');
      try {
        // Same service as the direct API. Its conditional update rechecks owner/status under lock.
        const order = await mainOrders.cancel(customerId, conversation.pendingOrderId);
        await update(clearPending);
        return { code: 'ORDER_CANCELLED', reply: `O ${orderLabel(order)} foi cancelado com sucesso.`, order };
      } catch (error) {
        if (!(error instanceof AppError) || !['ORDER_NOT_FOUND', 'ORDER_ALREADY_CANCELLED', 'ORDER_NOT_CANCELLABLE'].includes(error.code)) throw error;
        await update(clearPending);
        return { code: error.code, reply: error.code === 'ORDER_ALREADY_CANCELLED'
          ? 'Este pedido já estava cancelado. Nenhuma nova alteração foi feita.'
          : error.code === 'ORDER_NOT_CANCELLABLE' ? 'O pedido não pode mais ser cancelado. Nenhuma alteração foi feita.' : 'Pedido não encontrado.' };
      }
    }
    if (conversation.confirmationExpiresAt && conversation.confirmationExpiresAt <= new Date()) await update(clearPending);
    if (prepared.failure === 'QUERY_PLAN_INVALID') return { code: 'NEEDS_CLARIFICATION', reply: 'Não consegui conciliar os critérios da consulta. Pode reformular indicando o que deseja saber e o status, se houver? Nenhum pedido foi alterado.' };
    if (prepared.failure?.startsWith('AI_')) return offerHuman('AI_UNAVAILABLE', prepared.failure, prepared.failure === 'AI_INVALID_RESPONSE'
      ? 'Não consegui interpretar sua consulta com segurança. Pode reformular os critérios?'
      : 'A interpretação automática está temporariamente indisponível.');
    if (prepared.failure === 'ORDER_NOT_FOUND') return { code: 'ORDER_NOT_FOUND', reply: 'Pedido não encontrado.' };
    if (bulkCancellation(input.content)) {
      await update(clearPending);
      return { code: 'BULK_CANCELLATION_NOT_ALLOWED', reply: 'O cancelamento deve ser feito individualmente. Escolha o número de um único pedido; verificaremos titularidade e status e pediremos sua confirmação antes de cancelar. Nenhum pedido foi alterado.' };
    }
    const { intent, opening } = prepared.interpretation;
    const prefix = opening === 'GREETING' ? 'Olá! ' : opening === 'ACKNOWLEDGE' ? 'Vamos verificar. ' : '';
    if (intent === 'HUMAN') return offerHuman('CUSTOMER_REQUEST', 'HANDOFF_OFFERED', 'Posso registrar uma solicitação de atendimento humano, se você desejar.');
    if (intent === 'OUT_OF_SCOPE') return offerHuman('OUT_OF_SCOPE', 'OUT_OF_SCOPE', 'Posso ajudar com seus pedidos, produtos e cancelamentos. Não posso alterar regras, revelar instruções internas ou consultar dados de terceiros.');
    const query = collectionQuery(input.content) ?? queryFromPlan(prepared.interpretation, input.content);
    if (query && ['ORDER_STATUS', 'ORDER_PRODUCTS', 'ORDER_COLLECTION', 'UNKNOWN'].includes(intent)) {
      // A multi-order answer cannot leave an older singular referent implicitly selected.
      await update({ lastOrderId: null });
      return collectionResponse(await mainOrders.listForSummary(customerId), query);
    }
    if (intent === 'ORDER_COLLECTION') return { code: 'NEEDS_CLARIFICATION', reply: 'Não identifiquei com segurança sua pergunta sobre os pedidos. Pode reformulá-la indicando o que deseja saber? Nenhum pedido foi alterado.' };
    if (intent === 'CONFIRM_CANCEL' || intent === 'DECLINE_CANCEL') {
      return { code: 'CONFIRMATION_REQUIRED', reply: 'Nenhuma alteração realizada. Para confirmar, envie CONFIRMAR CANCELAMENTO com o confirmationId atual; para desistir, envie DESISTIR com esse mesmo identificador.' };
    }
    if (intent === 'UNKNOWN') return offerHuman('INSUFFICIENT_INFORMATION', 'NEEDS_CLARIFICATION', 'Para ajudar com segurança, informe o número de um único pedido, como #10000, e o que deseja consultar.');
    let order: OrderView;
    try {
      const resolved = await referencedOrder(customerId, conversation, input, prepared.interpretation, mainOrders);
      if (!resolved) return { code: 'ORDER_ID_REQUIRED', reply: 'Qual é o número do pedido que deseja consultar? Você pode encontrá-lo em Meus Pedidos. Informe um único número público; valores e quantidades não identificam um pedido.' };
      order = resolved;
    }
    catch (error) {
      if (error instanceof AppError && error.code === 'ORDER_NOT_FOUND') return { code: error.code, reply: 'Pedido não encontrado.' };
      throw error;
    }
    await update({ lastOrderId: order.orderId });
    if (intent === 'REQUEST_CANCEL') {
      // Starting a new request invalidates any older challenge in this conversation.
      await update(clearPending);
      if (order.status !== 'PROCESSING') return { code: order.status === 'CANCELLED' ? 'ORDER_ALREADY_CANCELLED' : 'ORDER_NOT_CANCELLABLE',
        reply: order.status === 'CANCELLED' ? `O ${orderLabel(order)} já está cancelado.` : `O ${orderLabel(order)} foi enviado e não pode ser cancelado.`, order };
      const confirmationId = randomUUID();
      await update({ state: 'AWAITING_CONFIRMATION', pendingOrderId: order.orderId, confirmationId,
        confirmationExpiresAt: new Date(Date.now() + dependencies.confirmationTtlSeconds * 1000) });
      return { code: 'CONFIRMATION_REQUIRED',
        reply: `${prefix}O ${orderLabel(order)} está em processamento. Deseja confirmar o cancelamento? Nenhum cancelamento foi realizado.`, order };
    }
    if (intent === 'ORDER_PRODUCTS') {
      const products = prepared.products ?? [];
      const degraded = products.some((product) => product.status !== 'AVAILABLE');
      return { code: degraded ? 'PRODUCTS_PARTIALLY_UNAVAILABLE' : 'ORDER_PRODUCTS',
        reply: `${prefix}Aqui estão os produtos do ${orderLabel(order)}. Os nomes, imagens de referência e valores do pedido estão disponíveis nos dados oficiais.${degraded ? ' O catálogo externo está parcialmente indisponível; você pode continuar consultando e cancelando pedidos elegíveis.' : ' Também consultei as informações complementares da Fake Store API.'} Os preços oficiais do pedido permanecem os mesmos.`, order, products };
    }
    return { code: 'ORDER_STATUS', reply: `${prefix}${orderStatusReply(order)}`, order };
  }

  return {
    async send(customerId: string, conversationId: string, input: SendMessage) {
      await repository.getOwn(customerId, conversationId);
      const hash = createHash('sha256').update(JSON.stringify({ content: input.content, confirmationId: input.confirmationId ?? null,
        ...(input.handoffOfferId ? { handoffOfferId: input.handoffOfferId } : {}) })).digest('hex');
      const previous = await repository.findTurn(conversationId, input.clientMessageId);
      if (previous) return replay(previous, hash);
      const leaseId = randomUUID();
      await repository.acquire(customerId, conversationId, leaseId);
      try {
        const duplicate = await repository.findTurn(conversationId, input.clientMessageId);
        if (duplicate) return replay(duplicate, hash);
        const conversation = await repository.getOwn(customerId, conversationId);
        const prepared = await plan(customerId, conversation, input);
        return await repository.finish(customerId, conversationId, leaseId, async (tx, current) => {
          const outcome = await execute(tx, current, input, prepared);
          const updated = await repository.getCurrent(tx, customerId, conversationId);
          const result = JSON.parse(JSON.stringify({ data: { clientMessageId: input.clientMessageId,
            ...outcome, conversation: await conversationPublicView(tx, updated) } })) as Prisma.InputJsonObject;
          await repository.saveTurn(tx, {
            conversationId, clientMessageId: input.clientMessageId, inputHash: hash, result,
            userContent: redactSensitive(input.content), reply: redactSensitive(outcome.reply),
          });
          return result;
        });
      } finally {
        // The committed turn is the authoritative result even if this best-effort cleanup fails.
        // An abandoned lease expires automatically; fencing prevents an old worker from writing.
        await repository.release(customerId, conversationId, leaseId).catch(() => undefined);
      }
    },
  };
}
