// Fictitious values only. Never copy sessions, credentials or production responses here.
const id = '41d0bbe7-cf9e-4f53-99f1-1febbf22802f';
const date = '2026-10-21T12:00:00.000Z';
const cancelledDate = '2026-10-21T12:05:00.000Z';
const pagination = { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 };
const conversation = { conversationId: id, state: 'ACTIVE', createdAt: date, updatedAt: date,
  pendingConfirmation: null, pendingHandoff: null };
const order = { orderId: id, orderNumber: 10000, status: 'PROCESSING', currency: 'BRL',
  createdAt: date, updatedAt: date, cancelledAt: null, totalCents: 12990,
  items: [{ productId: 2, title: 'Mens Casual Premium Slim Fit T-Shirts', quantity: 1, unitPriceCents: 12990,
    imageUrl: null, description: null, category: null, catalogVersion: null }] };
export const responseExamples: Record<string, unknown> = {
  CurrentSession: { customer: { customerId: id, name: 'Cliente Exemplo', email: 'cliente@example.test' },
    session: { expiresAt: '2026-10-22T12:00:00.000Z' }, csrfToken: 'A'.repeat(43) },
  OrderResponse: { data: order }, OrderPage: { data: [order], pagination },
  CancelledOrderResponse: { data: { ...order, status: 'CANCELLED', updatedAt: cancelledDate, cancelledAt: cancelledDate } },
  ConversationResponse: { data: conversation }, ConversationPage: { data: [conversation], pagination },
  ConversationHistory: { data: { ...conversation, turns: [{ turnId: id, clientMessageId: id, createdAt: date,
    messages: [{ messageId: id, role: 'USER', content: 'Quantos pedidos tenho?', createdAt: date },
      { messageId: 'e3f7f4f9-f004-468b-b39b-ff56a74d086e', role: 'ASSISTANT', content: 'Você tem 6 pedidos.', createdAt: date }] }] }, pagination },
  AgentMessageResponse: { data: { clientMessageId: id, code: 'ORDER_STATUS',
    reply: 'O pedido #10000 está em processamento.', conversation, order } },
  HandoffResponse: { data: { handoffId: id, conversationId: id, reason: 'CUSTOMER_REQUEST', status: 'OPEN', createdAt: date, simulated: true } },
  RecoveryAccepted: { message: 'Se houver uma conta elegível, enviaremos um código.', resendAfterSeconds: 60 },
};

export function errorExample(description: string) {
  return { error: { code: description.match(/\b[A-Z]+(?:_[A-Z]+)+\b/)?.[0] ?? 'INVALID_REQUEST',
    message: 'Não foi possível concluir a solicitação.' } };
}
