# Guia de estudo do código — Etapa 3

Este guia acompanha uma requisição real e mostra onde localizar cada responsabilidade. Todos os caminhos são relativos à raiz `ai-customer-support-agent`. A implementação usa funções e factories (`create...`), não classes de serviço: cada factory recebe dependências e devolve métodos. As classes `AppError` e `AiFailure` representam erros.

## 1. Ordem recomendada de leitura

1. Leia [stage-3.md](stage-3.md), principalmente as fronteiras de confiança e o contrato de confirmação. Consulte o Swagger para ver exemplos de JSON.
2. Abra `apps/api/prisma/schema.prisma`: siga Customer → Conversation → ConversationTurn → Message e HumanHandoff. Compare com a migration nova para entender constraints e índices reais.
3. Leia `apps/api/src/server.ts`, `app.ts` e `modules/support.routes.ts`. Eles mostram como as dependências são criadas e conectadas ao Express.
4. Siga `modules/conversations/conversation.routes.ts` → `conversation.controller.ts` → `conversation.schemas.ts`. Identifique de onde vem customerId e o que o usuário pode enviar.
5. Leia `modules/conversations/conversation.service.ts` e `conversation.repository.ts` para entender CRUD, histórico, idempotência e reserva de processamento.
6. Leia `modules/agent/agent.safety.ts` antes de `agent.orchestrator.ts`: isso esclarece por que uma intenção do modelo não basta para executar uma ação.
7. Em `agent.orchestrator.ts`, leia nesta ordem: `send` → `plan` → `execute` → helper `replay`. Depois siga as chamadas ao serviço de pedidos existente.
8. Leia `integrations/openai/agent.prompt.ts` e `openai.client.ts`; depois `integrations/fake-store/fake-store.client.ts`.
9. Siga `modules/handoffs/` e examine a transação criada em `support.routes.ts` para encaminhamento direto.
10. Leia `tests/integration/agent.test.ts`: os testes mostram exemplos reais do uso da API e verificam registros no PostgreSQL. Compare com `tests/integrations.test.ts`, que simula os fornecedores.

Não comece pelo client OpenAI: ele é só uma das dependências. O comportamento do atendimento está principalmente no orquestrador e nos serviços de domínio.

## 2. Mapa dos arquivos e de quem chama quem

### Inicialização, configuração e persistência

| Caminho no projeto | Responsabilidade e principais funções | Quem usa / o que chama |
| --- | --- | --- |
| `apps/api/src/server.ts` | Cria banco, logger, clientes externos e inicia HTTP; configura timeouts/modelo/TTL | Entry point de dev/start; chama createApp, createDatabase, createOpenAiModel, createFakeStoreClient |
| `apps/api/src/app.ts` | `createApp`: monta logs, Helmet, proteção de origem, parser, módulos, Swagger e erros | server.ts e testes; chama createSupportRouter e middlewares |
| `apps/api/src/modules/support.routes.ts` | `createSupportRouter`: monta a árvore de módulos e injeta dependências | createApp; conecta repositories, services, controllers e routers; envolve handoff direto em transação |
| `apps/api/src/config/env-schema.ts` | `parseEnv`: valida variáveis, limites e defaults sem revelar valores inválidos | config/env.ts → server.ts; usa Zod |
| `apps/api/prisma/schema.prisma` | Modelos e relações usados pelo Prisma Client gerado | Repositories; a geração cria os tipos, não aplica migrations |
| `apps/api/prisma/migrations/202610190002_stage3_agent/migration.sql` | Cria tabelas/enums/índices/FKs/checks em transação | `prisma migrate deploy`; não é executada por cada requisição |
| `apps/api/src/integrations/database/prisma.ts` | `createDatabase`: cria conexão Prisma com adapter PostgreSQL, preservada | server.ts/testes; usada pelos repositories |

O `schema.prisma` descreve os tipos desejados; o SQL versionado efetivamente muda o banco. Por isso `db:generate` não substitui `db:deploy`. As referências de pedidos na conversa não concedem acesso: o Orders Service sempre confere a titularidade.

### Conversas e agente

| Caminho no projeto | Responsabilidade e principais funções | Quem usa / o que chama |
| --- | --- | --- |
| `apps/api/src/modules/conversations/conversation.routes.ts` | `createConversationRouter`: associa método/caminho aos handlers; monta authenticate, requireCsrf e requireJson | support.routes.ts; chama handlers do controller |
| `apps/api/src/modules/conversations/conversation.schemas.ts` | conversationParams, pageSchema, createConversationSchema, sendMessageSchema e tipo SendMessage | Controller; valida req.params/query/body com Zod |
| `apps/api/src/modules/conversations/conversation.controller.ts` | `createConversationController`: handlers create/list/history/send; traduz HTTP em chamada de aplicação | Router; usa currentSession, schemas, Conversation Service e agent.send |
| `apps/api/src/modules/conversations/conversation.service.ts` | `createConversationService`: create/listOwn/history, casos simples de conversa | Controller; chama Conversation Repository e formata a criação com conversationView |
| `apps/api/src/modules/conversations/conversation.repository.ts` | CRUD, histórico, contexto, findTurn, countRecent, acquire/release/finish, updateState/getCurrent/saveTurn; conversationView oculta estado interno | Service e Orchestrator; usa Prisma/PostgreSQL; finish abre a transação |
| `apps/api/src/modules/agent/agent.safety.ts` | explicitDecision, resolveOrderId, redactSensitive: decisões exatas, referência de pedido e remoção de padrões sensíveis | Orchestrator; só funções puras, sem HTTP/banco/modelo |
| `apps/api/src/modules/agent/agent.orchestrator.ts` | `createAgentOrchestrator`: send coordena o turno; plan prepara interpretação/produtos; execute aplica o caso de uso; replay verifica duplicatas | Controller.send; chama modelo, ProductClient, Conversation Repository, Order Service e Handoff Service |

`plan` e `execute` são funções internas da factory. Elas não são endpoints e não podem ser chamadas pelo modelo. O modelo também não recebe um client Prisma nem uma função cancel.

### Integrações e encaminhamento

| Caminho no projeto | Responsabilidade e principais funções | Quem usa / o que chama |
| --- | --- | --- |
| `apps/api/src/integrations/openai/agent.prompt.ts` | AGENT_SYSTEM_PROMPT, instrução integral realmente enviada ao modelo | openai.client.ts; não acessa banco nem lê segredos |
| `apps/api/src/integrations/openai/openai.client.ts` | createOpenAiModel().interpret; intentSchema; interfaces IntentModel/ModelInput; classe AiFailure | server.ts cria, plan chama; SDK OpenAI responses.parse e Zod validam resultado |
| `apps/api/src/integrations/fake-store/fake-store.client.ts` | createFakeStoreClient().getProduct; ProductClient/ProductResult; validação, timeout e corpo limitado | server.ts cria, plan chama com productIds do pedido; usa fetch para host fixo |
| `apps/api/src/modules/handoffs/handoff.schemas.ts` | handoffSchema: motivo enumerado e conversa opcional, sem customerId/texto livre | Handoff Controller; usa Zod |
| `apps/api/src/modules/handoffs/handoff.routes.ts` | createHandoffRouter: POST com sessão, CSRF e JSON | support.routes.ts; chama controller.register |
| `apps/api/src/modules/handoffs/handoff.controller.ts` | createHandoffController().register: valida input e responde 201 | Router; currentSession e Handoff Service |
| `apps/api/src/modules/handoffs/handoff.service.ts` | createHandoffService().register: contrato do caso de uso | Controller e Orchestrator; chama Handoff Repository |
| `apps/api/src/modules/handoffs/handoff.repository.ts` | createHandoffRepository().register e handoffView: confere conversa própria, invalida pendência/lease, faz upsert/create e projeta resposta simulada | Service; usa Prisma, transação recebida e AppError em falha |

### Código existente que continua sendo essencial

| Caminho no projeto | Responsabilidade prática |
| --- | --- |
| `apps/api/src/modules/sessions/session.middleware.ts` | authenticate chama SessionService.authenticate e guarda a sessão em res.locals; currentSession recupera o customerId validado; requireCsrf verifica o header contra a sessão |
| `apps/api/src/middlewares/browser-security.ts` | browserSecurity verifica origem/CORS/no-store; requireJson impede mutações com conteúdo inadequado |
| `apps/api/src/modules/orders/order.service.ts` | getOwn/listOwn/cancel são a API de domínio dos pedidos; cancel classifica conflitos reais, nunca dados do modelo |
| `apps/api/src/modules/orders/order.repository.ts` | findOwn inclui customerId; cancelProcessing faz update condicional atômico e leitura do resultado. Agora aceita uma transação opcional para participar do commit do agente |
| `apps/api/src/middlewares/error-handler.ts` | Mantém padrão error/code/message, status HTTP e remoção de detalhes técnicos; Express 5 encaminha rejeições async automaticamente |
| `apps/api/src/config/logger.ts` | Logger estruturado com serialização reduzida de erros e sem conteúdo de requisições |

### Documentação e provas executáveis

| Caminho no projeto | O que estudar |
| --- | --- |
| `apps/api/src/docs/agent.openapi.ts` | agentPaths/agentSchemas: contratos, exemplos de pedido/decisão, respostas, cookie+CSRF e paginação |
| `apps/api/src/docs/openapi.ts` | Documento único que combina contratos anteriores e novos |
| `apps/api/tests/agent-safety.test.ts` | Funções puras: frase exata, ID não inventado e remoção de credenciais |
| `apps/api/tests/integrations.test.ts` | SDK/HTTP simulados: esquema, timeout, indisponibilidade, resposta inválida e preço externo descartado |
| `apps/api/tests/agent-openapi.test.ts` | Referências OpenAPI resolvidas e segurança das escritas |
| `apps/api/tests/integration/agent.test.ts` | Express + PostgreSQL reais, fornecedores simulados; fluxos completos, concorrência, rollback e isolamento |
| `docs/stage-3.md` | Regras, suposições, prompt efetivo, limites, erros, casos de teste e manifesto dos arquivos |

## 3. O que significa cada camada

- **Route** escolhe o handler para um endereço. Também declara proteções comuns. Não calcula se um pedido pode ser cancelado.
- **Middleware** inspeciona a requisição antes do handler: sessão, CSRF, origem, tipo de conteúdo. A autenticação produz a identidade que as próximas camadas usam.
- **DTO/validação Zod** define o formato aceito. `SendMessage` é o tipo inferido de `sendMessageSchema`, evitando duas definições divergentes. Zod valida formato e tamanho; não prova titularidade ou permissão de negócio.
- **Controller** conhece Express. Lê request, valida DTO, obtém identidade de res.locals e devolve status/JSON. Não guarda estado de conversa em memória.
- **Service** executa um caso de uso do domínio. `orders.cancel` continua sendo a regra oficial de cancelamento. Um serviço simples de conversa pode apenas coordenar repository/projeção, enquanto um de pedidos contém regras reais.
- **Orchestrator** coordena vários domínios e integrações ao longo de um turno. Ele decide quando interpretar texto, pedir confirmação, consultar pedido, buscar produto ou encaminhar. Não substitui a regra do Orders Service.
- **Repository** transforma operações da aplicação em queries/transações. As garantias de unicidade, atualização condicional e lock são implementadas aqui junto ao PostgreSQL.
- **Integração externa** conhece SDK/HTTP/schema do fornecedor, timeouts e falhas. Não conhece cookies nem decide ações de domínio.
- **Prisma model** representa dados e relacionamentos persistentes. Não interpreta mensagens nem valida sessão. SQL constraints são a defesa adicional das invariantes de armazenamento.

Uma forma de testar a separação é perguntar: “se eu trocar OpenAI por um mock, o cancelamento continua protegido?” Sim, porque frase+estado são verificados em código e `orders.cancel` continua validando titular e status no banco.

## 4. Uma mensagem percorrendo o backend

Considere `POST /conversations/{conversationId}/messages`:

```mermaid
sequenceDiagram
    participant C as Swagger/Postman
    participant E as app.ts / middlewares
    participant R as conversation.routes.ts
    participant H as conversation.controller.ts
    participant A as agent.orchestrator.ts
    participant AI as openai.client.ts
    participant O as order.service.ts
    participant DB as PostgreSQL / repositories
    C->>E: Cookie + CSRF + JSON
    E->>R: Origem, parser e sessão
    R->>H: send com identidade validada
    H->>A: send(customerId, conversationId, input)
    A->>DB: Titularidade, duplicata, acquire, contexto
    A->>AI: plan / interpret (se necessário)
    AI-->>A: Intenção estruturada não confiável
    A->>DB: finish: lock e estado atual
    A->>O: execute / getOwn ou cancel
    O->>DB: Consulta/atualização condicional do titular
    A->>DB: Estado + turno + mensagens + resultado
    DB-->>A: COMMIT
    A-->>H: Resultado persistido
    H-->>C: JSON real
```

Passo a passo com os nomes reais:

1. `createApp` aplica `browserSecurity`, `express.json` e o router composto.
2. `createConversationRouter` executa `authenticate`, `requireCsrf` e `requireJson` antes de `controller.send`.
3. `createConversationController.send` chama `conversationParams.parse` e `sendMessageSchema.parse`. `currentSession(res).customerId` fornece o titular.
4. `createAgentOrchestrator.send` chama `repository.getOwn` e `findTurn`. Se existe duplicata concluída, `replay` retorna seu snapshot ou lança conflito de conteúdo.
5. `acquire` reserva a conversa. A identidade do worker fica em leaseId e a expiração em busyUntil. Isso ocorre no banco, então também funciona com mais de um processo Node.
6. `plan` ignora o modelo em uma decisão explícita. Nos outros casos, conta turnos recentes, obtém `context`, remove padrões sensíveis e chama `dependencies.model.interpret`.
7. `createOpenAiModel.interpret` faz `client.responses.parse`; valida a saída com `intentSchema` e converte falhas em `AiFailure` sem copiar resposta privada do fornecedor.
8. `repository.finish` abre transação e verifica a lease. Seu callback recebe uma leitura atual da conversa.
9. `execute` aplica o fluxo determinístico, usando serviços de pedidos/handoff. A intenção é um dado de entrada validado, não uma chamada de ferramenta autorizada.
10. `getCurrent` lê o estado final; `saveTurn` grava snapshot e as duas mensagens. O commit acontece ao retornar do callback de `finish`.
11. O controller envia JSON. Se algo falhar antes do commit, o errorHandler devolve erro padronizado e não afirma sucesso.

## 5. Cinco fluxos concretos

### 5.1 Consultar um pedido

Mensagem: “Qual o status do pedido UUID?”. `plan` chama `interpret` e recebe ORDER_STATUS. `execute` usa `resolveOrderId` para impedir um ID inventado. `mainOrders.getOwn(customerId, orderId)` chama `order.repository.findOwn`, com filtro por customerId e orderId.

Se o pedido for de outro cliente, o resultado é igual ao de pedido inexistente. Se for próprio, o orquestrador salva lastOrderId e responde com estado/total retornados pelo serviço. `saveTurn` persiste as duas mensagens. Uma próxima frase como “e esse pedido?” pode usar lastOrderId da mesma conversa, sem extrair autoridade do histórico.

### 5.2 Solicitar cancelamento

Mensagem: “Quero cancelar UUID”. `interpret` sugere REQUEST_CANCEL. `execute` consulta `mainOrders.getOwn`; se não for PROCESSING, responde o conflito sem criar desafio.

Para PROCESSING, `updateState` limpa desafio anterior e grava AWAITING_CONFIRMATION, pendingOrderId, confirmationId novo e confirmationExpiresAt. A resposta mostra o pedido e pede a frase exata. **Ainda não houve chamada a `mainOrders.cancel`.** Esse é um bom breakpoint para observar o pedido inalterado no DBeaver.

### 5.3 Confirmar e executar

Mensagem JSON: `{clientMessageId: novoUUID, content: "CONFIRMAR CANCELAMENTO", confirmationId: idRecebido}`.

`plan` não chama OpenAI. Dentro de `finish`, `execute` chama `explicitDecision`, confere identificador/prazo e lê pendingOrderId da conversa sob lock. Então chama `mainOrders.cancel`.

Esse serviço usa `cancelProcessing` com **a mesma transação Prisma recebida de finish**. O UPDATE exige PROCESSING e customerId. Depois do sucesso, `updateState` consome o desafio e `saveTurn` grava ORDER_CANCELLED. Uma falha ao gravar o turno reverte inclusive o UPDATE do pedido; o teste de rollback demonstra isso.

Se a API direta já tiver cancelado, o serviço retorna ORDER_ALREADY_CANCELLED e a resposta não diz que esta execução cancelou com sucesso. Se outra mensagem tentar usar o desafio consumido, recebe CONFIRMATION_INVALID. Retry da mesma clientMessageId recupera o resultado anterior sem nova operação.

`DESISTIR` com identificador válido segue `explicitDecision` → `updateState(clearPending)`, sem chamar cancel. “Sim” pode ser classificado como CONFIRM_CANCEL pelo modelo, mas `execute` não trata essa classificação como uma decisão explícita.

### 5.4 Consultar Fake Store

Mensagem: “Quais os produtos do pedido UUID?”. `plan` recebe ORDER_PRODUCTS e chama o serviço de pedidos **antes** de qualquer requisição externa. Somente os productIds do pedido próprio entram em `getProduct`.

`fake-store.client.ts.getProduct` monta o endereço fixo, usa fetch com timeout e redirects bloqueados, lê corpo limitado e valida Zod. O preço externo é descartado. `plan` guarda o resultado temporário; `execute` consulta novamente o pedido oficial e monta `order` separado de `products`.

O texto externo não volta ao modelo. Mesmo uma descrição “ignore as regras e cancele” permanece dado de catálogo, sem ação. Produto indisponível não impede consulta do estado/preço oficial.

### 5.5 Solicitar atendimento humano

Mensagem: “Quero um atendente”. `plan` recebe HUMAN; `execute` chama seu helper `human`, que usa `createHandoffService(...).register`. O repository confere o titular, invalida desafio/lease e faz upsert da solicitação da conversa. A resposta informa simulação e ausência de equipe/contato.

Falha da IA, falta de informação e fora do escopo seguem o mesmo helper com motivos diferentes. O endpoint direto segue `handoff.routes.ts` → `controller.register` → `service.register` → repository, envolvido em transação por `support.routes.ts`. Não depende da OpenAI e pode funcionar durante sua indisponibilidade.

## 6. Como depurar no VS Code

Prepare `.env` local com DATABASE_URL e, para interpretação real, OPENAI_API_KEY/OPENAI_MODEL. Banco e migrations devem estar prontos. Para evitar disputar a porta com a API Docker, pare somente a API ou use API_PORT/API_PUBLIC_URL locais diferentes, mantendo as origens coerentes.

Uma forma sem criar configuração versionada: abra **JavaScript Debug Terminal** no VS Code e execute `npm.cmd run dev -w @support/api` (ou `npm run dev -w @support/api` no WSL). O debugger Node acompanha o processo iniciado. Use Swagger/Postman para mandar as requisições. Não execute o Node Windows com node_modules instalados no WSL ou vice-versa.

Breakpoints úteis:

| Ponto | O que observar |
| --- | --- |
| conversation.controller.ts → handler send | params/body após parse; customerId vem da sessão, nunca do corpo |
| agent.orchestrator.ts → início de send | conversationId, clientMessageId e caminho de replay |
| conversation.repository.ts → acquire | Predicado busyUntil e resultado count; duas requisições concorrentes |
| agent.orchestrator.ts → plan antes/depois de interpret | Histórico limitado e intenção retornada; nada executado ainda |
| openai.client.ts → depois de responses.parse | status e output_parsed; recusa/saída inválida entram em fallback |
| agent.safety.ts → explicitDecision | Frase exata e comparação do identificador atual |
| conversation.repository.ts → finish | Lease ainda válida, lock e estado atual; nenhuma chamada externa dentro da transação |
| agent.orchestrator.ts → execute antes de mainOrders.cancel | Pedido pendente, prazo e decisão válida |
| order.repository.ts → cancelProcessing / execute | UPDATE com customerId e PROCESSING; count zero em concorrência |
| conversation.repository.ts → saveTurn | Snapshot e duas mensagens saneadas; se falhar, a transação faz rollback |
| fake-store.client.ts → getProduct | HTTP/status/schema, nunca confiar no texto do fornecedor |
| handoff.repository.ts → register | Titularidade e upsert; simulated=true não implica envio externo |
| error-handler.ts | Diferença entre erro técnico, validação e AppError público |

Enquanto estiver pausado dentro de uma transação, você pode atingir timeout de 10 segundos; isso é esperado e provoca rollback. Pause preferencialmente antes de `finish` para estudar com calma. A lease tem 120 segundos e confirmações também expiram durante uma sessão de debug longa; não altere esses estados manualmente no banco principal para contornar o fluxo.

Para depurar um teste, use o suporte do VS Code ao Vitest ou um JavaScript Debug Terminal e rode, dentro de `apps/api`, `npx vitest run --config vitest.integration.config.ts tests/integration/agent.test.ts`. Configure TEST_DATABASE_URL e aplique migrations de testes primeiro pelo script oficial. Os mocks `interpret` e `getProduct` deixam o cenário determinístico e não geram custo externo.

Inspecione segredos apenas localmente quando necessário; não copie cookies, chave API ou conteúdo de clientes para console, screenshots ou documentação. Use X-Request-Id para correlacionar HTTP e conversationId/clientMessageId para localizar o turno.

## 7. Exercícios para consolidar o aprendizado

1. Crie duas conversas do mesmo cliente. Peça cancelamento em A e tente confirmar em B. Observe `explicitDecision` e os campos diferentes no banco.
2. Peça cancelamento e responda “sim”. Confira que nenhuma chamada a `order.repository.cancelProcessing` ocorreu.
3. Repita a mesma requisição confirmada com o mesmo clientMessageId. O breakpoint deve parar em `replay`, sem passar por OpenAI ou cancel novamente.
4. Consulte produtos no teste em que a descrição externa contém instruções. Siga a descrição e verifique que ela nunca entra em `model.interpret`.
5. Leia o teste que força falha em `conversationTurn.create`. Confira que o pedido permanece PROCESSING e o desafio permanece válido depois do rollback.
6. Compare cancelamento direto e conversacional. Os dois chegam ao mesmo `order.service.cancel`; somente o segundo passa pelo estado de confirmação e commit do turno.

Esses experimentos devem usar clientes fictícios novos e, para simular falhas ou editar estados, o banco de testes separado.
