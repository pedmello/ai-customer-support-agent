import { supportPaths, supportSchemas, supportSecuritySchemes } from './support.openapi.js';
import { agentPaths, agentSchemas } from './agent.openapi.js';

export const openapi = {
  openapi: '3.0.3',
  info: {
    title: 'AI Customer Support Agent API',
    version: '0.3.0',
    description: 'Clientes demonstrativos, sessões por cookie, pedidos e agente com confirmação conversacional determinística. Não há verificação de e-mail nem login. Cadastre um e-mail novo, deixe o navegador guardar o cookie e configure csrfToken no botão Authorize para mutações. Não preencha manualmente os campos de cookie. Atendimento humano é simulado.',
  },
  tags: [
    { name: 'Health', description: 'Disponibilidade da API e do PostgreSQL' },
    { name: 'Customers', description: 'Cadastro demonstrativo, sem comprovação de posse do e-mail' },
    { name: 'Sessions', description: 'Identificação por cookie HttpOnly, expiração, CSRF e revogação' },
    { name: 'Orders', description: 'Pedidos do titular; cancelamento sem confirmação conversacional' },
    { name: 'Conversations', description: 'Agente, histórico próprio e confirmações de uso único' },
    { name: 'Handoffs', description: 'Encaminhamento simulado; sem equipe conectada' },
  ],
  paths: {
    ...supportPaths,
    ...agentPaths,
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
      ...agentSchemas,
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
