import type { HandoffReason } from '../../generated/prisma/client.js';
import type { createHandoffRepository } from './handoff.repository.js';
export function createHandoffService(repository: ReturnType<typeof createHandoffRepository>) {
  return { register: (customerId: string, reason: HandoffReason, conversationId?: string) => repository.register(customerId, reason, conversationId) };
}
