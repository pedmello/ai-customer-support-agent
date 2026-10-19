import { supportPaths, supportSchemas, supportSecuritySchemes } from './support.openapi.js';

export const openapi = {
  openapi: '3.0.3',
  info: {
    title: 'AI Customer Support Agent API',
    version: '0.2.0',
    description: 'Infraestrutura, clientes demonstrativos, sessões por cookie e pedidos. Não há verificação de e-mail, login ou confirmação conversacional. Cadastre um e-mail novo, deixe o navegador guardar o cookie e configure csrfToken no botão Authorize para mutações. Não preencha manualmente os campos de cookie.',
  },
  tags: [
    { name: 'Health', description: 'Disponibilidade da API e do PostgreSQL' },
    { name: 'Customers', description: 'Cadastro demonstrativo, sem comprovação de posse do e-mail' },
    { name: 'Sessions', description: 'Identificação por cookie HttpOnly, expiração, CSRF e revogação' },
    { name: 'Orders', description: 'Pedidos do titular; cancelamento sem confirmação conversacional' },
  ],
  paths: {
    ...supportPaths,
    '/health': {
      get: {
        tags: ['Health'],
        operationId: 'getHealth',
        summary: 'Verifica a API e executa SELECT 1 via Prisma',
        responses: {
          '200': {
            description: 'API e banco disponíveis',
            content: { 'application/json': {
              schema: { $ref: '#/components/schemas/Health' },
              example: { status: 'ok', database: 'up' },
            } },
          },
          '503': {
            description: 'Banco indisponível',
            content: { 'application/json': {
              schema: { $ref: '#/components/schemas/Health' },
              example: { status: 'error', database: 'down' },
            } },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: supportSecuritySchemes,
    schemas: {
      ...supportSchemas,
      Health: {
        type: 'object',
        required: ['status', 'database'],
        additionalProperties: false,
        properties: {
          status: { type: 'string', enum: ['ok', 'error'] },
          database: { type: 'string', enum: ['up', 'down'] },
        },
      },
    },
  },
};
