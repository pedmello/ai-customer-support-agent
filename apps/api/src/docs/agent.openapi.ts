const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (name: string) => ({ 'application/json': { schema: ref(name) } });
const uuid = { type: 'string', format: 'uuid' };
const date = { type: 'string', format: 'date-time' };
const readSecurity = [{ cookieSession: [] }, { secureCookieSession: [] }];
const writeSecurity = [{ cookieSession: [], csrfToken: [] }, { secureCookieSession: [], csrfToken: [] }];
const error = (description: string) => ({ description, content: json('Error') });
const errors = {
  '400': error('VALIDATION_ERROR / INVALID_REQUEST'), '401': error('UNAUTHENTICATED'),
  '403': error('CSRF_INVALID / ORIGIN_NOT_ALLOWED'), '404': error('CONVERSATION_NOT_FOUND; inexistente e outro titular são indistinguíveis'),
  '413': error('PAYLOAD_TOO_LARGE'), '415': error('UNSUPPORTED_MEDIA_TYPE'),
  '500': error('INTERNAL_ERROR; não há resultado confirmado; repetir com mesmo clientMessageId'),
  '503': error('DATABASE_UNAVAILABLE / HANDOFF_UNAVAILABLE; não promete sucesso nem contato'),
};
const idParam = { name: 'conversationId', in: 'path', required: true, schema: uuid };
const pages = [
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 10000, default: 1 } },
  { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
];
export const agentPaths = {
  '/conversations': {
    post: { tags: ['Conversations'], operationId: 'createConversation', summary: 'Criar conversa independente do cliente autenticado',
      security: writeSecurity, requestBody: { required: true, content: json('EmptyInput') },
      responses: { '201': { description: 'Conversa criada', content: json('ConversationResponse') }, ...errors } },
    get: { tags: ['Conversations'], operationId: 'listConversations', summary: 'Listar conversas próprias',
      security: readSecurity, parameters: pages,
      responses: { '200': { description: 'Página de conversas próprias', content: json('ConversationPage') }, ...errors } },
  },
  '/conversations/{conversationId}': {
    get: { tags: ['Conversations'], operationId: 'getConversationHistory', summary: 'Consultar estado atual e histórico paginado por turnos',
      description: 'Histórico em ordem cronológica, com usuário antes do assistente em cada turno. Um turno contém uma mensagem de entrada e a resposta. pageSize conta turnos. Confirmações expiradas não são apresentadas como ativas.',
      security: readSecurity, parameters: [idParam, ...pages],
      responses: { '200': { description: 'Histórico do titular', content: json('ConversationHistory') }, ...errors } },
  },
  '/conversations/{conversationId}/messages': {
    post: { tags: ['Conversations'], operationId: 'sendAgentMessage', summary: 'Enviar mensagem ao agente com idempotência',
      description: 'clientMessageId é um UUID novo por mensagem lógica. Ao repetir a mesma mensagem, reutilize-o: retorna o resultado original sem novas ações. Reutilizar com conteúdo diferente retorna 409. CONVERSATION_BUSY permite retry com a mesma chave. Para confirmar use content exatamente CONFIRMAR CANCELAMENTO e confirmationId retornado em data.conversation.pendingConfirmation. Para desistir use DESISTIR e o mesmo confirmationId. “Sim” e outras respostas ambíguas não cancelam. Identificador de confirmação expira e só vale nesta conversa. Fora do escopo e falha de IA apenas oferecem atendimento, sem registrar HumanHandoff. Aceite exige handoffOfferId da oferta atual e content Sim; recusa usa Não, obrigado. A oferta expira, é invalidada por mudança de assunto e não vale em outra conversa. Pedido direto de atendente e POST /handoffs representam intenção explícita. Erros conversacionais tratados e indisponibilidade da IA retornam HTTP 200 com data.code e resposta persistida; falhas técnicas/validação seguem error. O endpoint direto /orders/{orderId}/cancel continua autorizado por seu fluxo chamador e não exige esse desafio conversacional.',
      security: writeSecurity, parameters: [idParam],
      requestBody: { required: true, content: { 'application/json': { schema: ref('SendAgentMessage'), examples: {
        collection: { summary: 'Consultar todos os pedidos; totais separados por moeda', value: { clientMessageId: '86da26ca-2d5a-443d-a607-f4d50665304a', content: 'Quais são meus pedidos?' } },
        query: { summary: 'Consultar pedido', value: { clientMessageId: 'e3f7f4f9-f004-468b-b39b-ff56a74d086e', content: 'Qual o status do pedido #48213?' } },
        cancel: { summary: 'Solicitar cancelamento', value: { clientMessageId: 'cc38e1d2-70b9-43b0-a2da-775a24227068', content: 'Quero cancelar o pedido #48213' } },
        confirm: { summary: 'Confirmar usando o identificador recebido', value: { clientMessageId: 'c39d6a9e-bf51-4494-b4eb-f9e33f7f866b', content: 'CONFIRMAR CANCELAMENTO', confirmationId: '41d0bbe7-cf9e-4f53-99f1-1febbf22802f' } },
        decline: { summary: 'Desistir', value: { clientMessageId: '87ab7dad-c43d-4f0f-91ab-d912fd04fda4', content: 'DESISTIR', confirmationId: '41d0bbe7-cf9e-4f53-99f1-1febbf22802f' } },
        acceptHandoff: { summary: 'Aceitar a oferta humana atual', value: { clientMessageId: 'ac481312-302c-4e51-ab1f-15492ba61a80', content: 'Sim', handoffOfferId: '41d0bbe7-cf9e-4f53-99f1-1febbf22802f' } },
        declineHandoff: { summary: 'Recusar a oferta humana atual', value: { clientMessageId: '4cdad506-acf9-4abc-9fad-136abdb82711', content: 'Não, obrigado', handoffOfferId: '41d0bbe7-cf9e-4f53-99f1-1febbf22802f' } },
      } } } },
      responses: { '200': { description: 'Resultado real persistido; consulte data.code e estado', content: json('AgentMessageResponse') },
        '409': error('CONVERSATION_BUSY / MESSAGE_ID_CONFLICT'), '429': error('AGENT_RATE_LIMITED: 30 turnos recentes por cliente/minuto'), ...errors } },
  },
  '/handoffs': {
    post: { tags: ['Handoffs'], operationId: 'registerHumanHandoff', summary: 'Registrar encaminhamento humano simulado',
      description: 'Operação direta iniciada explicitamente pelo cliente; não utilizar como fallback automático. Sem equipe conectada, contato, SLA ou notificação externa. No máximo uma solicitação OPEN por conversa; repetições retornam o mesmo registro. Sem conversa, cada chamada cria uma solicitação independente. Quando há conversa própria, invalida confirmação pendente. Somente motivos enumerados; nenhum texto livre sensível.',
      security: writeSecurity, requestBody: { required: true, content: json('RegisterHandoff') },
      responses: { '201': { description: 'Solicitação simulada registrada ou já existente', content: json('HandoffResponse') }, ...errors } },
  },
};
const conversationProperties = {
  conversationId: uuid, state: { type: 'string', enum: ['ACTIVE', 'AWAITING_CONFIRMATION', 'HUMAN_REQUESTED'] },
  createdAt: date, updatedAt: date,
  pendingConfirmation: { type: 'object', nullable: true, required: ['confirmationId', 'orderId', 'expiresAt'],
    properties: { confirmationId: uuid, orderId: uuid, orderNumber: { type: 'integer', nullable: true, minimum: 10000 }, expiresAt: date } },
  pendingHandoff: { type: 'object', nullable: true, required: ['offerId', 'expiresAt'],
    description: 'Oferta humana sem registro. Aceite/recusa devem enviar handoffOfferId correspondente e conteúdo explícito. Expira, é consumida uma vez e só vale nesta conversa.',
    properties: { offerId: uuid, expiresAt: date } },
};
export const agentSchemas = {
  Pagination: { type: 'object', required: ['page', 'pageSize', 'totalItems', 'totalPages'], properties: {
    page: { type: 'integer' }, pageSize: { type: 'integer' }, totalItems: { type: 'integer' }, totalPages: { type: 'integer' },
  } },
  EmptyInput: { type: 'object', additionalProperties: false },
  SendAgentMessage: { type: 'object', required: ['clientMessageId', 'content'], additionalProperties: false,
    properties: { clientMessageId: uuid, content: { type: 'string', minLength: 1, maxLength: 2000 }, confirmationId: uuid,
      handoffOfferId: { ...uuid, description: 'Oferta retornada em pendingHandoff.offerId. Envie content Sim ou Não, obrigado. Não combinar com confirmationId de cancelamento.' } } },
  Conversation: { type: 'object', required: Object.keys(conversationProperties), properties: conversationProperties },
  ConversationResponse: { type: 'object', required: ['data'], properties: { data: ref('Conversation') } },
  ConversationPage: { type: 'object', required: ['data', 'pagination'], properties: {
    data: { type: 'array', items: ref('Conversation') }, pagination: ref('Pagination') } },
  ConversationHistory: { type: 'object', required: ['data', 'pagination'], properties: {
    data: { type: 'object', required: [...Object.keys(conversationProperties), 'turns'], properties: {
      ...conversationProperties, turns: { type: 'array', items: { type: 'object', properties: {
        turnId: uuid, clientMessageId: uuid, createdAt: date,
        messages: { type: 'array', items: { type: 'object', properties: { messageId: uuid, role: { type: 'string', enum: ['USER', 'ASSISTANT'] }, content: { type: 'string' }, createdAt: date } } },
      } } },
    } }, pagination: ref('Pagination') } },
  RegisterHandoff: { type: 'object', additionalProperties: false, required: ['reason'], properties: {
    conversationId: uuid, reason: { type: 'string', enum: ['CUSTOMER_REQUEST', 'OUT_OF_SCOPE', 'AI_UNAVAILABLE', 'INSUFFICIENT_INFORMATION', 'SAFETY_FAILURE'] },
  } },
  Handoff: { type: 'object', required: ['handoffId', 'conversationId', 'reason', 'status', 'createdAt', 'simulated'], properties: {
    handoffId: uuid, conversationId: { ...uuid, nullable: true }, reason: { type: 'string' }, status: { type: 'string', enum: ['OPEN'] }, createdAt: date, simulated: { type: 'boolean', enum: [true] },
  } },
  HandoffResponse: { type: 'object', properties: { data: ref('Handoff') } },
  ExternalProductResult: { type: 'object', required: ['productId', 'source', 'status'], properties: {
    productId: { type: 'integer' }, source: { type: 'string', enum: ['FAKE_STORE'] }, status: { type: 'string', enum: ['AVAILABLE', 'NOT_FOUND', 'UNAVAILABLE'] }, code: { type: 'string' },
    product: { type: 'object', properties: { id: { type: 'integer' }, title: { type: 'string' }, description: { type: 'string' }, category: { type: 'string' }, image: { type: 'string', format: 'uri' } } },
  } },
  AgentMessageResponse: { type: 'object', required: ['data'], properties: { data: { type: 'object', required: ['clientMessageId', 'code', 'reply', 'conversation'], properties: {
    clientMessageId: uuid, code: { type: 'string', description: 'ORDER_STATUS, ORDER_COLLECTION, BULK_CANCELLATION_NOT_ALLOWED, ORDER_PRODUCTS, PRODUCTS_PARTIALLY_UNAVAILABLE, CONFIRMATION_REQUIRED, CONFIRMATION_INVALID, CONFIRMATION_EXPIRED, CANCELLATION_DECLINED, ORDER_CANCELLED, ORDER_ALREADY_CANCELLED, ORDER_NOT_CANCELLABLE, ORDER_NOT_FOUND, ORDER_ID_REQUIRED, NEEDS_CLARIFICATION, HUMAN_REQUESTED, HANDOFF_OFFERED, HANDOFF_DECLINED, HANDOFF_CONFIRMATION_REQUIRED, HANDOFF_CONFIRMATION_INVALID, HANDOFF_CONFIRMATION_EXPIRED, OUT_OF_SCOPE, AI_UNAVAILABLE, AI_TIMEOUT ou AI_INVALID_RESPONSE' },
    reply: { type: 'string' }, conversation: ref('Conversation'), order: ref('Order'), handoff: ref('Handoff'), products: { type: 'array', items: ref('ExternalProductResult') },
    collection: { type: 'object', description: 'ORDER_COLLECTION: leitura híbrida por parser ou plano de IA validado, com operações list/count/exists/products/total/select e inclusão/exclusão de status. Cálculos determinísticos, somente do titular, valores separados por moeda. O plano é interno: não é aceito no corpo da requisição. Não cancela em lote; BULK_CANCELLATION_NOT_ALLOWED solicita escolha individual.', properties: {
      count: { type: 'integer' }, totals: { type: 'array', items: { type: 'object', properties: { currency: { type: 'string' }, totalCents: { type: 'integer' } } } },
      orders: { type: 'array', maxItems: 10, items: { type: 'object', properties: { orderNumber: { type: 'integer' }, status: { type: 'string' }, currency: { type: 'string' }, totalCents: { type: 'integer' }, createdAt: date,
        items: { type: 'array', items: ref('OrderItem') } } } },
    } },
  } } } },
};
