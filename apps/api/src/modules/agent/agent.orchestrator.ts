import { createHash, randomUUID } from 'node:crypto';
import { AppError } from '../../errors/app-error.js';
import type { PrismaClient, Prisma, Conversation, HandoffReason } from '../../generated/prisma/client.js';
import { AiFailure, intentSchema, type AgentIntent, type IntentModel } from '../../integrations/openai/openai.client.js';
import type { ProductClient, ProductResult } from '../../integrations/fake-store/fake-store.client.js';
import { createOrderRepository } from '../orders/order.repository.js';
import { createOrderService } from '../orders/order.service.js';
import { createHandoffRepository } from '../handoffs/handoff.repository.js';
import { createHandoffService } from '../handoffs/handoff.service.js';
import { conversationView, type ConversationRepository } from '../conversations/conversation.repository.js';
import type { SendMessage } from '../conversations/conversation.schemas.js';
import { explicitDecision, redactSensitive, resolveOrderId } from './agent.safety.js';

export interface AgentDependencies {
  model: IntentModel;
  products: ProductClient;
  confirmationTtlSeconds: number;
}
type Plan = { interpretation: AgentIntent; products?: ProductResult[]; failure?: string };
const clearPending = { pendingOrderId: null, confirmationId: null, confirmationExpiresAt: null, state: 'ACTIVE' as const };
const unknown: AgentIntent = { intent: 'UNKNOWN', orderId: null, opening: 'NONE' };
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

  async function plan(customerId: string, conversation: Conversation, input: SendMessage): Promise<Plan> {
    // The explicit decision is evaluated without asking the model, even during outages.
    if (input.confirmationId || /^(CONFIRMAR CANCELAMENTO|DESISTIR)$/i.test(input.content)) return { interpretation: unknown };
    try {
      const recent = await repository.countRecent(customerId);
      if (recent >= 30) throw new AppError(429, 'AGENT_RATE_LIMITED', 'Limite de mensagens atingido. Aguarde um minuto.');
      const interpretation = intentSchema.parse(await dependencies.model.interpret({
        content: redactSensitive(input.content), history: await repository.context(conversation.conversationId),
      }));
      const orderId = resolveOrderId(input.content, interpretation.orderId, conversation.lastOrderId);
      if (interpretation.intent !== 'ORDER_PRODUCTS' || !orderId) return { interpretation };
      const order = await orders.getOwn(customerId, orderId);
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
      return { code, reply: `${reply} Solicitação de atendimento humano registrada em simulação; não há equipe conectada nem contato agendado.`, handoff };
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
        return { code: 'ORDER_CANCELLED', reply: `O pedido ${order.orderId} foi cancelado com sucesso.`, order };
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
    if (intent === 'UNKNOWN') return human('INSUFFICIENT_INFORMATION', 'NEEDS_CLARIFICATION', 'Não há informações suficientes para prosseguir com segurança. Informe o UUID do pedido e o que deseja consultar.');
    const orderId = resolveOrderId(input.content, prepared.interpretation.orderId, conversation.lastOrderId);
    if (!orderId) return human('INSUFFICIENT_INFORMATION', 'ORDER_ID_REQUIRED', 'Informe um único UUID de pedido válido.');
    let order: OrderView;
    try { order = await mainOrders.getOwn(customerId, orderId); }
    catch (error) {
      if (error instanceof AppError && error.code === 'ORDER_NOT_FOUND') return { code: error.code, reply: 'Pedido não encontrado.' };
      throw error;
    }
    await update({ lastOrderId: order.orderId });
    if (intent === 'REQUEST_CANCEL') {
      // Starting a new request invalidates any older challenge in this conversation.
      await update(clearPending);
      if (order.status !== 'PROCESSING') return { code: order.status === 'CANCELLED' ? 'ORDER_ALREADY_CANCELLED' : 'ORDER_NOT_CANCELLABLE',
        reply: order.status === 'CANCELLED' ? 'Este pedido já está cancelado.' : 'Este pedido foi enviado e não pode ser cancelado.', order };
      const confirmationId = randomUUID();
      await update({ state: 'AWAITING_CONFIRMATION', pendingOrderId: order.orderId, confirmationId,
        confirmationExpiresAt: new Date(Date.now() + dependencies.confirmationTtlSeconds * 1000) });
      return { code: 'CONFIRMATION_REQUIRED',
        reply: `${prefix}Deseja cancelar o pedido ${order.orderId}? Envie CONFIRMAR CANCELAMENTO e o confirmationId retornado, ou DESISTIR com o mesmo identificador. A solicitação ainda não foi executada.`, order };
    }
    if (intent === 'ORDER_PRODUCTS') {
      const products = prepared.products ?? [];
      const degraded = products.some((product) => product.status !== 'AVAILABLE');
      return { code: degraded ? 'PRODUCTS_PARTIALLY_UNAVAILABLE' : 'ORDER_PRODUCTS',
        reply: `${prefix}Os itens e preços registrados do pedido estão disponíveis nos dados oficiais.${degraded ? ' Parte do catálogo externo está indisponível ou não foi encontrada.' : ' As informações complementares vêm da Fake Store API.'} O catálogo externo não altera preços nem status.`, order, products };
    }
    return { code: 'ORDER_STATUS', reply: `${prefix}O pedido ${order.orderId} está ${order.status}. Total registrado: ${order.currency} ${(order.totalCents / 100).toFixed(2)}.`, order };
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
            ...outcome, conversation: conversationView(updated) } })) as Prisma.InputJsonObject;
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
