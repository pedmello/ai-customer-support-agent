import type { PrismaClient, Prisma, Conversation } from '../../generated/prisma/client.js';
import { AppError } from '../../errors/app-error.js';

export const conversationNotFound = () => new AppError(404, 'CONVERSATION_NOT_FOUND', 'Conversa não encontrada.');
export const conversationBusy = () => new AppError(409, 'CONVERSATION_BUSY', 'Há uma mensagem em processamento. Tente novamente com o mesmo clientMessageId.');

export function conversationView(conversation: Conversation, orderNumber: number | null = null) {
  const active = conversation.confirmationExpiresAt && conversation.confirmationExpiresAt > new Date();
  return {
    conversationId: conversation.conversationId,
    state: conversation.state === 'AWAITING_CONFIRMATION' && !active ? 'ACTIVE' : conversation.state,
    createdAt: conversation.createdAt, updatedAt: conversation.updatedAt,
    pendingConfirmation: active && conversation.confirmationId ? {
      confirmationId: conversation.confirmationId, orderId: conversation.pendingOrderId,
      orderNumber,
      expiresAt: conversation.confirmationExpiresAt,
    } : null,
    pendingHandoff: conversation.handoffOfferId && conversation.handoffOfferExpiresAt && conversation.handoffOfferExpiresAt > new Date()
      ? { offerId: conversation.handoffOfferId, expiresAt: conversation.handoffOfferExpiresAt }
      : null,
  };
}

export async function conversationPublicView(client: Pick<Prisma.TransactionClient, 'order'>, conversation: Conversation) {
  const order = conversation.pendingOrderId ? await client.order.findFirst({
    where: { orderId: conversation.pendingOrderId, customerId: conversation.customerId }, select: { orderNumber: true },
  }) : null;
  return conversationView(conversation, order?.orderNumber ?? null);
}

export function createConversationRepository(database: PrismaClient) {
  return {
    create(customerId: string) { return database.conversation.create({ data: { customerId } }); },
    async getOwn(customerId: string, conversationId: string) {
      const result = await database.conversation.findFirst({ where: { customerId, conversationId } });
      if (!result) throw conversationNotFound();
      return result;
    },
    async listOwn(customerId: string, page: number, pageSize: number) {
      const [data, totalItems] = await database.$transaction([
        database.conversation.findMany({ where: { customerId }, orderBy: [{ createdAt: 'desc' }, { conversationId: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
        database.conversation.count({ where: { customerId } }),
      ], { isolationLevel: 'RepeatableRead' });
      const pendingIds = data.flatMap(conversation => conversation.pendingOrderId ? [conversation.pendingOrderId] : []);
      const pendingOrders = pendingIds.length ? await database.order.findMany({ where: { customerId, orderId: { in: pendingIds } }, select: { orderId: true, orderNumber: true } }) : [];
      const numbers = new Map(pendingOrders.map(order => [order.orderId, order.orderNumber]));
      return { data: data.map(conversation => conversationView(conversation, numbers.get(conversation.pendingOrderId ?? '') ?? null)), pagination: { page, pageSize, totalItems, totalPages: Math.ceil(totalItems / pageSize) } };
    },
    findTurn(conversationId: string, clientMessageId: string) {
      return database.conversationTurn.findUnique({ where: { conversationId_clientMessageId: { conversationId, clientMessageId } } });
    },
    countRecent(customerId: string) {
      return database.conversationTurn.count({ where: {
        conversation: { customerId }, createdAt: { gte: new Date(Date.now() - 60000) },
      } });
    },
    updateState(tx: Prisma.TransactionClient, conversationId: string, data: Prisma.ConversationUpdateInput) {
      return tx.conversation.update({ where: { conversationId }, data });
    },
    getCurrent(tx: Prisma.TransactionClient, customerId: string, conversationId: string) {
      return tx.conversation.findFirstOrThrow({ where: { customerId, conversationId } });
    },
    saveTurn(tx: Prisma.TransactionClient, input: {
      conversationId: string; clientMessageId: string; inputHash: string;
      result: Prisma.InputJsonObject; userContent: string; reply: string;
    }) {
      const { userContent, reply, ...data } = input;
      return tx.conversationTurn.create({ data: { ...data, messages: {
        create: [{ role: 'USER', content: userContent }, { role: 'ASSISTANT', content: reply }],
      } } });
    },
    async history(customerId: string, conversationId: string, page: number, pageSize: number) {
      // Ownership is included in both reads; a guessed conversation ID cannot reveal messages.
      const conversation = await this.getOwn(customerId, conversationId);
      const [turns, totalItems] = await database.$transaction([
        database.conversationTurn.findMany({ where: { conversationId, conversation: { customerId } },
          orderBy: [{ createdAt: 'asc' }, { turnId: 'asc' }], skip: (page - 1) * pageSize, take: pageSize,
          select: { turnId: true, clientMessageId: true, createdAt: true,
            messages: { select: { messageId: true, role: true, content: true, createdAt: true } } } }),
        database.conversationTurn.count({ where: { conversationId, conversation: { customerId } } }),
      ], { isolationLevel: 'RepeatableRead' });
      return { data: { ...await conversationPublicView(database, conversation), turns: turns.map((turn) => ({ ...turn,
        messages: turn.messages.sort((a, b) => a.role === b.role ? 0 : a.role === 'USER' ? -1 : 1) })) },
        pagination: { page, pageSize, totalItems, totalPages: Math.ceil(totalItems / pageSize) } };
    },
    async context(conversationId: string) {
      const turns = await database.conversationTurn.findMany({ where: { conversationId }, take: 6,
        orderBy: [{ createdAt: 'desc' }, { turnId: 'desc' }], include: { messages: true } });
      return turns.reverse().flatMap((turn) => ['USER', 'ASSISTANT'].flatMap((role) => turn.messages
        .filter((message) => message.role === role).map(({ role, content }) => ({ role, content: content.slice(0, 800) }))));
    },
    async acquire(customerId: string, conversationId: string, leaseId: string) {
      const now = new Date();
      const changed = await database.conversation.updateMany({
        where: { customerId, conversationId, OR: [{ busyUntil: null }, { busyUntil: { lt: now } }] },
        data: { leaseId, busyUntil: new Date(now.getTime() + 120000) },
      });
      if (!changed.count) throw conversationBusy();
    },
    release(customerId: string, conversationId: string, leaseId: string) {
      return database.conversation.updateMany({ where: { customerId, conversationId, leaseId }, data: { leaseId: null, busyUntil: null } });
    },
    async finish<T>(customerId: string, conversationId: string, leaseId: string,
      execute: (tx: Prisma.TransactionClient, conversation: Conversation) => Promise<T>) {
      return database.$transaction(async (tx) => {
        // Atomic compare-and-swap obtains a row lock and fences an expired worker.
        const changed = await tx.conversation.updateMany({
          where: { customerId, conversationId, leaseId, busyUntil: { gt: new Date() } },
          data: { leaseId: null, busyUntil: null },
        });
        if (!changed.count) throw conversationBusy();
        const conversation = await tx.conversation.findFirstOrThrow({ where: { customerId, conversationId } });
        return execute(tx, conversation);
      }, { timeout: 10000 });
    },
  };
}
export type ConversationRepository = ReturnType<typeof createConversationRepository>;
