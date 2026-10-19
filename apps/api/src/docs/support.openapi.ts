const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (name: string) => ({ 'application/json': { schema: ref(name) } });
const error = (description: string) => ({ description, content: json('Error') });
const authenticated = [{ cookieSession: [] }, { secureCookieSession: [] }];
const mutationSecurity = [{ cookieSession: [], csrfToken: [] }, { secureCookieSession: [], csrfToken: [] }];
const protectedErrors = {
  '401': error('Sessão ausente, inválida, revogada ou expirada: UNAUTHENTICATED'),
  '403': error('Origem não permitida ou token CSRF inválido'),
  '500': error('Erro inesperado: INTERNAL_ERROR; nenhum detalhe interno é exposto'),
  '503': error('Banco indisponível: DATABASE_UNAVAILABLE'),
};
const orderId = { name: 'orderId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } };

export const supportPaths = {
  '/customers': {
    post: {
      tags: ['Customers'], operationId: 'registerCustomer', summary: 'Cadastrar novo cliente demonstrativo e abrir sessão',
      description: 'Cria cliente, três pedidos e sessão em uma transação. Não verifica posse do e-mail. E-mail duplicado nunca concede acesso à conta existente. Aceita somente application/json; cookies são definidos pelo servidor. O token de sessão não é retornado no JSON.',
      requestBody: { required: true, content: json('RegisterCustomer') },
      responses: {
        '201': {
          description: 'Cliente e sessão criados; guarde csrfToken para mutações. O navegador/Postman recebe o cookie HttpOnly automaticamente.',
          headers: { 'Set-Cookie': { description: 'support_session no HTTP ou __Host-support_session no HTTPS; HttpOnly; SameSite=Lax; Path=/; Expires; Secure no HTTPS', schema: { type: 'string' } } },
          content: json('CurrentSession'),
        },
        '400': error('VALIDATION_ERROR, INVALID_REQUEST ou campos extras como customerId'),
        '403': error('ORIGIN_NOT_ALLOWED'),
        '409': error('EMAIL_ALREADY_REGISTERED; nenhuma sessão é emitida'),
        '413': error('PAYLOAD_TOO_LARGE'),
        '415': error('UNSUPPORTED_MEDIA_TYPE; use application/json'),
        '500': protectedErrors['500'], '503': protectedErrors['503'],
      },
    },
  },
  '/sessions/current': {
    get: {
      tags: ['Sessions'], operationId: 'getCurrentSession', summary: 'Consultar identidade demonstrativa e obter CSRF',
      description: 'Usa somente o cookie HttpOnly. Não recebe customerId, não renova a expiração e não recupera contas sem sessão. Resposta Cache-Control: no-store.',
      security: authenticated,
      responses: { '200': { description: 'Sessão ativa', content: json('CurrentSession') }, ...protectedErrors },
    },
    delete: {
      tags: ['Sessions'], operationId: 'revokeCurrentSession', summary: 'Revogar a sessão atual',
      description: 'Exige X-CSRF-Token retornado no cadastro ou na consulta da sessão. Revoga no banco e remove o cookie. Não há login ou recuperação para reabrir a conta nesta etapa.',
      security: mutationSecurity,
      responses: { '204': { description: 'Sessão revogada e cookie removido' }, ...protectedErrors },
    },
  },
  '/orders': {
    get: {
      tags: ['Orders'], operationId: 'listOwnOrders', summary: 'Listar pedidos do cliente da sessão',
      security: authenticated,
      parameters: [
        { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 10000, default: 1 } },
        { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
      ],
      responses: { '200': { description: 'Pedidos do titular, com paginação', content: json('OrderPage') }, '400': error('VALIDATION_ERROR'), ...protectedErrors },
    },
  },
  '/orders/{orderId}': {
    get: {
      tags: ['Orders'], operationId: 'getOwnOrder', summary: 'Consultar um pedido próprio',
      security: authenticated, parameters: [orderId],
      responses: {
        '200': { description: 'Pedido do titular', content: json('OrderResponse') },
        '400': error('VALIDATION_ERROR: UUID inválido'),
        '404': error('ORDER_NOT_FOUND: pedido inexistente ou pertencente a outro cliente, com resposta idêntica'),
        ...protectedErrors,
      },
    },
  },
  '/orders/{orderId}/cancel': {
    post: {
      tags: ['Orders'], operationId: 'cancelOwnOrder', summary: 'Cancelar pedido próprio em PROCESSING',
      description: 'Operação já autorizada pelo fluxo chamador. NÃO implementa a confirmação conversacional do agente. A API sempre valida sessão, CSRF, titularidade e estado. Atualização condicional atômica; somente um cancelamento concorrente altera o pedido. Use corpo {} e X-CSRF-Token; customerId é rejeitado.',
      security: mutationSecurity, parameters: [orderId],
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false }, example: {} } } },
      responses: {
        '200': { description: 'Pedido alterado para CANCELLED com cancelledAt preenchido', content: json('OrderResponse') },
        '400': error('VALIDATION_ERROR: UUID inválido ou campos extras'),
        '404': error('ORDER_NOT_FOUND: pedido inexistente ou de outro cliente'),
        '409': error('ORDER_ALREADY_CANCELLED ou ORDER_NOT_CANCELLABLE (SHIPPED); nenhuma alteração'),
        '413': error('PAYLOAD_TOO_LARGE'), '415': error('UNSUPPORTED_MEDIA_TYPE'), ...protectedErrors,
      },
    },
  },
};

export const supportSecuritySchemes = {
  cookieSession: { type: 'apiKey', in: 'cookie', name: 'support_session', description: 'Cookie HttpOnly emitido pelo cadastro HTTP; o navegador o envia automaticamente. Não autorize com customerId ou e-mail.' },
  secureCookieSession: { type: 'apiKey', in: 'cookie', name: '__Host-support_session', description: 'Cookie host-only Secure emitido no ambiente HTTPS.' },
  csrfToken: { type: 'apiKey', in: 'header', name: 'X-CSRF-Token', description: 'Cole o csrfToken da resposta de cadastro ou GET /sessions/current. Obrigatório para cancelamento e revogação.' },
};

export const supportSchemas = {
  Error: {
    type: 'object', required: ['error'], additionalProperties: false,
    properties: { error: { type: 'object', required: ['code', 'message'], additionalProperties: false, properties: { code: { type: 'string' }, message: { type: 'string' } } } },
  },
  RegisterCustomer: {
    type: 'object', required: ['name', 'email'], additionalProperties: false,
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 120, example: 'Ana Silva' },
      email: { type: 'string', format: 'email', maxLength: 254, example: 'ana@example.test', description: 'Normalizado com trim e lowercase; sem verificação de posse.' },
    },
  },
  Customer: {
    type: 'object', required: ['customerId', 'name', 'email'], additionalProperties: false,
    properties: { customerId: { type: 'string', format: 'uuid' }, name: { type: 'string' }, email: { type: 'string', format: 'email' } },
  },
  CurrentSession: {
    type: 'object', required: ['customer', 'session', 'csrfToken'], additionalProperties: false,
    properties: {
      customer: ref('Customer'),
      session: { type: 'object', required: ['expiresAt'], additionalProperties: false, properties: { expiresAt: { type: 'string', format: 'date-time' } } },
      csrfToken: { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$', description: 'Token CSRF vinculado à sessão. Não é o token de autenticação e não o substitui.' },
    },
  },
  OrderItem: {
    type: 'object', required: ['productId', 'title', 'quantity', 'unitPriceCents'], additionalProperties: false,
    properties: {
      productId: { type: 'integer', minimum: 1, description: 'Referência reservada para associação futura; sem integração nesta etapa' },
      title: { type: 'string' }, quantity: { type: 'integer', minimum: 1 }, unitPriceCents: { type: 'integer', minimum: 0 },
    },
  },
  Order: {
    type: 'object', required: ['orderId', 'status', 'currency', 'createdAt', 'updatedAt', 'cancelledAt', 'items', 'totalCents'], additionalProperties: false,
    properties: {
      orderId: { type: 'string', format: 'uuid' }, status: { type: 'string', enum: ['PROCESSING', 'SHIPPED', 'CANCELLED'] },
      currency: { type: 'string', example: 'USD' }, totalCents: { type: 'integer', minimum: 0 },
      createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' },
      cancelledAt: { type: 'string', format: 'date-time', nullable: true },
      items: { type: 'array', items: ref('OrderItem') },
    },
  },
  OrderResponse: { type: 'object', required: ['data'], additionalProperties: false, properties: { data: ref('Order') } },
  OrderPage: {
    type: 'object', required: ['data', 'pagination'], additionalProperties: false,
    properties: {
      data: { type: 'array', items: ref('Order') },
      pagination: {
        type: 'object', required: ['page', 'pageSize', 'totalItems', 'totalPages'], additionalProperties: false,
        properties: {
          page: { type: 'integer' }, pageSize: { type: 'integer' }, totalItems: { type: 'integer' }, totalPages: { type: 'integer' },
        },
      },
    },
  },
};
