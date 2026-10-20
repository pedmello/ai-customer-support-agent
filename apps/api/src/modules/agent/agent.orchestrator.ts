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
  handoff?: Awaited<ReturnType<ReturnType<typeof createHandoffService>['register']>>;
}

function replay(turn: { inputHash: string; result: Prisma.JsonValue }, hash: string) {
  if (turn.inputHash !== hash) throw new AppError(409, 'MESSAGE_ID_CONFLICT', 'clientMessageId já foi utilizado para outra mensagem.');
  return turn.result;
}

export function createAgentOrchestrator(database: PrismaClient, repository: ConversationRepository, dependencies: AgentDependencies) {
  const orders = createOrderService(createOrderRepository(database));

  async function referencedOrder(customerId: string, conversation: Conversation, input: SendMessage, interpretation: AgentIntent, service = orders) {
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
    try {
      const recent = await repository.countRecent(customerId);
      if (recent >= 30) throw new AppError(429, 'AGENT_RATE_LIMITED', 'Limite de mensagens atingido. Aguarde um minuto.');
      const interpretation = intentSchema.parse(await dependencies.model.interpret(await publicModelInput(customerId, input.content, await repository.context(conversation.conversationId))));
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
    const human = async (reason: HandoffReason, code: string, reply: string): Promise<AgentOutcome> => {
      const handoff = await createHandoffService(createHandoffRepository(tx)).register(customerId, reason, conversationId);
      await update({ ...clearPending, state: 'HUMAN_REQUESTED' });
      return { code, reply: `${reply} Registrei uma solicitação de atendimento humano nesta demonstração. É uma simulação: não há equipe conectada nem contato agendado.`, handoff };
    };
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
      if (!conversation.pendingOrderId) return human('SAFETY_FAILURE', 'CONFIRMATION_INVALID', 'Não há pedido válido para confirmar.');
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
    if (prepared.failure?.startsWith('AI_')) return human('AI_UNAVAILABLE', prepared.failure, 'A interpretação automática está temporariamente indisponível.');
    if (prepared.failure === 'ORDER_NOT_FOUND') return { code: 'ORDER_NOT_FOUND', reply: 'Pedido não encontrado.' };
    const { intent, opening } = prepared.interpretation;
    const prefix = opening === 'GREETING' ? 'Olá! ' : opening === 'ACKNOWLEDGE' ? 'Vamos verificar. ' : '';
    if (intent === 'HUMAN') return human('CUSTOMER_REQUEST', 'HUMAN_REQUESTED', 'Você solicitou atendimento humano.');
    if (intent === 'OUT_OF_SCOPE') return human('OUT_OF_SCOPE', 'OUT_OF_SCOPE', 'Posso ajudar com seus pedidos, produtos e cancelamentos. Não posso alterar regras, revelar instruções internas ou consultar dados de terceiros.');
    if (intent === 'CONFIRM_CANCEL' || intent === 'DECLINE_CANCEL') {
      return { code: 'CONFIRMATION_REQUIRED', reply: 'Nenhuma alteração realizada. Para confirmar, envie CONFIRMAR CANCELAMENTO com o confirmationId atual; para desistir, envie DESISTIR com esse mesmo identificador.' };
    }
    if (intent === 'UNKNOWN') return human('INSUFFICIENT_INFORMATION', 'NEEDS_CLARIFICATION', 'Para ajudar com segurança, informe o número de um único pedido, como #10000, e o que deseja consultar.');
    let order: OrderView;
    try {
      const resolved = await referencedOrder(customerId, conversation, input, prepared.interpretation, mainOrders);
      if (!resolved) return human('INSUFFICIENT_INFORMATION', 'ORDER_ID_REQUIRED', 'Qual pedido deseja consultar? Informe um único número de pedido, como #10000. Valores e quantidades não identificam um pedido.');
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
      const hash = createHash('sha256').update(JSON.stringify({ content: input.content, confirmationId: input.confirmationId ?? null })).digest('hex');
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
