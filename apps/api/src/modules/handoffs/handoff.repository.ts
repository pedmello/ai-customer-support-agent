import type { Prisma, PrismaClient, HandoffReason } from '../../generated/prisma/client.js';
import { conversationNotFound } from '../conversations/conversation.repository.js';
import { AppError } from '../../errors/app-error.js';
import { clearHandoffOffer } from './handoff.consent.js';

export function handoffView(record: { handoffId: string; conversationId: string | null; reason: HandoffReason; status: string; createdAt: Date }) {
  return { handoffId: record.handoffId, conversationId: record.conversationId, reason: record.reason,
    status: record.status, createdAt: record.createdAt, simulated: true };
}

export function createHandoffRepository(database: PrismaClient | Prisma.TransactionClient) {
  return {
    async register(customerId: string, reason: HandoffReason, conversationId?: string) {
      const execute = async (client: Prisma.TransactionClient) => {
        if (conversationId) {
          const own = await client.conversation.findFirst({ where: { conversationId, customerId } });
          if (!own) throw conversationNotFound();
        }
        try {
          if (conversationId) await client.conversation.update({ where: { conversationId, customerId }, data: {
            ...clearHandoffOffer,
            state: 'HUMAN_REQUESTED', pendingOrderId: null, confirmationId: null, confirmationExpiresAt: null,
            leaseId: null, busyUntil: null,
          } });
          // A conversation has at most one simulated open handoff, including concurrent retries.
          const record = conversationId ? await client.humanHandoff.upsert({
            where: { conversationId }, update: {}, create: { customerId, conversationId, reason },
          }) : await client.humanHandoff.create({ data: { customerId, reason } });
          return handoffView(record);
        } catch {
          throw new AppError(503, 'HANDOFF_UNAVAILABLE', 'Não foi possível registrar a solicitação. Tente novamente. Nenhum contato foi agendado.');
        }
      };
      return '$transaction' in database ? database.$transaction(execute) : execute(database);
    },
  };
}
