import type { ConversationRepository } from './conversation.repository.js';
import { conversationView } from './conversation.repository.js';
export function createConversationService(repository: ConversationRepository) {
  return {
    async create(customerId: string) { return conversationView(await repository.create(customerId)); },
    listOwn: (customerId: string, page: number, size: number) => repository.listOwn(customerId, page, size),
    history: (customerId: string, id: string, page: number, size: number) => repository.history(customerId, id, page, size),
  };
}
