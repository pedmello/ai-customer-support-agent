# Guia de estudo — Implementação 1

Esta entrega acrescenta referências públicas e snapshots reais de catálogo, mantendo os UUIDs internos e a operação determinística de pedidos. Leia este guia junto de `improvement-1.md` e `database-readability.md`.

## Ordem de leitura

1. `apps/api/prisma/schema.prisma` e a migration `202610200001_public_orders_catalog_views/migration.sql`.
2. `apps/api/src/modules/customers/demo-catalog.data.json`, `demo-catalog.ts` e `customer.service.ts`.
3. Módulo orders: repository → service → schemas/controller/routes.
4. `apps/api/src/modules/agent/agent.safety.ts`, `agent.responses.ts`, `agent.orchestrator.ts` e `integrations/ai/intent-model.ts`.
5. `apps/api/src/modules/conversations/conversation.repository.ts`.
6. Frontend: `types.ts` → `services/order-presentation.ts` → `hooks/useSupport.ts` → componentes.
7. Testes novos de referências, migration e apresentação.

## Mapa de responsabilidades

| Caminho real | Funções/elementos importantes | Quem usa e o que chama |
| --- | --- | --- |
| apps/api/prisma/schema.prisma | Order.orderNumber; snapshots adicionais de OrderItem | Prisma gera o client; UUIDs e relacionamentos existentes continuam |
| apps/api/prisma/migrations/202610200001_public_orders_catalog_views/migration.sql | Sequência, backfill, índice/check, campos e views | Prisma migrate deploy; não chama aplicação ou serviços externos |
| apps/api/scripts/verify-improvement-migration.ts | Fingerprints before/after | Ferramenta administrativa; lê DB e grava somente contagens/digests sob .temp |
| apps/api/src/modules/customers/demo-catalog.data.json | Metadados canônicos de IDs 9, 2, 3 e 4; preços próprios em centavos | demo-catalog.ts; não é carregado por HTTP no cadastro |
| apps/api/src/modules/customers/demo-catalog.ts | DEMO_CATALOG_VERSION, DEMO_CATALOG, selectDemoProducts | demoOrders usa a seleção sem reposição; fonte aleatória pode ser substituída em teste |
| apps/api/src/modules/customers/customer.service.ts | demoOrders; createCustomerService().register | register preserva prepareSession e repository.register; apenas a fábrica de pedidos mudou |
| apps/api/src/modules/orders/order.repository.ts | findOwnByNumber, findOwn, cancelProcessing | Service consulta DB; cancelProcessing continua com UPDATE condicionado a cliente/status |
| apps/api/src/modules/orders/order.service.ts | orderView; getOwnByNumber; getOwn; cancel | Controller e agente reutilizam os mesmos serviços; orderView calcula total e seleciona campos públicos |
| apps/api/src/modules/orders/order.schemas.ts | orderNumberParamsSchema | Controller valida número decimal seguro antes de chamar service |
| apps/api/src/modules/orders/order.controller.ts | getByNumber | Obtém customerId da sessão e chama service.getOwnByNumber |
| apps/api/src/modules/orders/order.routes.ts | /by-number/:orderNumber | Mantém authenticate e rotas por UUID; não altera o cancelamento direto |
| apps/api/src/integrations/ai/intent-model.ts | intentSchema | Ambos os provedores usam a mesma saída estruturada; acrescenta orderNumber |
| apps/api/src/integrations/openai/agent.prompt.ts | AGENT_SYSTEM_PROMPT | OpenAI e Gemini importam a mesma instrução; números são dados não confiáveis |
| apps/api/src/modules/agent/agent.safety.ts | resolveOrderReference; resolveOrderId legado; explicitDecision; redactSensitive | Orquestrador resolve referências sem conceder autorização; confirmação e redação existentes permanecem |
| apps/api/src/modules/agent/agent.responses.ts | orderLabel; orderStatusReply | execute usa número, produto e moeda oficial para formular respostas |
| apps/api/src/modules/agent/agent.orchestrator.ts | referencedOrder; publicModelInput; plan; execute; send | Coordena modelo, serviços de pedidos, client Fake Store e transação do turno |
| apps/api/src/modules/conversations/conversation.repository.ts | conversationView; conversationPublicView; listOwn; history | Acrescenta número pendente por consulta própria; listagem faz lookup em lote |
| apps/api/src/docs/support.openapi.ts e agent.openapi.ts | Novas propriedades, consulta pública e exemplos | Swagger e testes de referências documentais |
| apps/web/src/types.ts | Order.orderNumber; OrderItem metadata; Confirmation.orderNumber | Hook, componentes e HTTP |
| apps/web/src/services/api.ts | orderByNumber; send; decisionMessage existentes | HTTP com sessão/CSRF preservado; novo helper de consulta pública |
| apps/web/src/services/order-presentation.ts | publicOrderText; publicOrderLabel | Componentes adaptam referências antigas sem gravar no histórico |
| apps/web/src/hooks/useSupport.ts | askOrder agora recebe número; deliver e decide preservados | Ação de pedido cria conversa e envia referência pública; decide conserva protocolo exato |
| apps/web/src/components/ProductImage.tsx | ProductImage | Cards/detalhes mostram URL permitida e fallback; valida domínio por safeCatalogImage existente |
| apps/web/src/components/CopyOrderNumber.tsx | CopyOrderNumber; copy | Copia número com Clipboard API e informa falha sem exigir UUID |
| apps/web/src/components/ui.tsx | OrderSummary, Icon e formatadores | Lista usa foto, título e número; moeda continua Intl.NumberFormat com currency real |
| apps/web/src/components/Orders.tsx | Orders, OrderDetails, OrderCard | Busca local por número/nome; detalhes apresentam/copiável; ação envia número ao hook |
| apps/web/src/components/Chat.tsx | displayMessage; ConfirmationPanel; Chat | Texto legado adaptado, confirmação mostra número e cards recebem número atual quando snapshot antigo omite |
| apps/web/src/components/Conversations.tsx | conversationTitle; ConversationList | Títulos/prévias exibem números e produto conhecido, sem UUID de pedido |

Não foram criadas classes de domínio novas. A arquitetura usa funções de fábrica e funções puras, conforme os módulos existentes. Não houve alteração nas funções de autenticação/cadastro de identidade; customer.service apenas passou a fornecer os novos dados dos pedidos demonstrativos.

## Entenda os dois identificadores

Imagine uma linha com `orderId = UUID_INTERNO` e `orderNumber = 10042`.

- PostgreSQL e relações continuam usando o UUID.
- Cliente digita `pedido #10042`.
- getOwnByNumber procura `{ customerId: sessão, orderNumber: 10042 }`.
- O pedido encontrado fornece o UUID interno para operações e estados já existentes.
- A resposta mostra #10042 e o produto. Conhecer esse número não permite consultar outra conta.

Não há transformação matemática entre número e UUID. A sequência gera o número; a linha relaciona ambos. Não tente criar números no frontend ou com MAX + 1.

## Fluxo 1 — Cadastro e catálogo

`POST /customers` → controller existente → `createCustomerService().register()` → `demoOrders(now)` → `selectDemoProducts()` → `repository.register()`.

selectDemoProducts embaralha uma cópia do catálogo e pega três itens, sem repetir o produto no mesmo cliente. demoOrders associa os status e copia metadados/centavos/versão. O repository mantém uma única transação de cliente, sessão, pedidos e itens. PostgreSQL atribui os números durante a inserção.

O catálogo JSON tem preço próprio em BRL. Não contém o campo price externo. A descrição/categoria/foto identificam o produto de referência; não autorizam cancelamento. Uma indisponibilidade de rede não interfere no cadastro porque essa etapa não faz fetch.

A retirada da mochila resultou em support-brl-v2. Atualizar o arquivo afeta cadastros posteriores, nunca pedidos anteriores. Se um nome ou preço precisar mudar de novo, crie outra versão de catálogo e preserve os snapshots já registrados.

## Fluxo 2 — Consulta pública REST

`GET /orders/by-number/10042` → `authenticate` → `getByNumber` → `orderNumberParamsSchema.parse` → `getOwnByNumber(customerId, 10042)` → `findOwnByNumber` → `orderView` → JSON.

A validação Zod rejeita formato inadequado. O repository verifica titularidade junto do número. orderView calcula total por quantidade × centavos, preserva currency e não retorna IDs internos de itens nem customerId do pedido. orderId continua no contrato técnico para compatibilidade, mas não é apresentado na UI.

## Fluxo 3 — Mensagem de consulta

`OrderDetails` → callback de App → `useSupport.askOrder(orderNumber, false)` → nova conversa → `deliver` → `api.send` → middleware/controller existentes → `createAgentOrchestrator().send`.

1. send verifica titularidade, replay e lease.
2. plan prepara contexto com publicModelInput. UUIDs próprios de mensagens antigas viram números somente na entrada temporária do modelo; dados persistidos permanecem originais.
3. O SDK chama Gemini/OpenAI uma vez e valida intentSchema.
4. resolveOrderReference compara saída do modelo com a referência explícita. Mais de um número, valor monetário, quantidade ou número inventado não seleciona pedido.
5. referencedOrder usa getOwnByNumber para referências novas ou getOwn para contexto interno legado.
6. execute revalida dentro da transação e usa orderStatusReply para redigir fatos reais.
7. O turno e a resposta são persistidos; o frontend atualiza estado e apresenta número/foto/preço.

O modelo não é usado para tornar a frase mais bonita em outra chamada: orderLabel/orderStatusReply fazem isso deterministicamente.

## Fluxo 4 — Cancelamento

`askOrder(orderNumber, true)` envia solicitação por mensagem. execute consulta o pedido e, somente em PROCESSING, grava pendingOrderId UUID, confirmationId e expiração. A resposta apresenta número público e produto; conversationPublicView acrescenta o número ao desafio apresentado.

`ConfirmationPanel` → `decide(true)` → `decisionMessage` → `CONFIRMAR CANCELAMENTO` com confirmationId separado → backend valida estado/cliente/conversa/validade → `mainOrders.cancel` → `cancelProcessing` condicionado ao status → grava mensagem e resultado na mesma transação.

DESISTIR segue o mesmo protocolo sem cancelar. Repetição usa o mesmo clientMessageId e recebe o resultado persistido. Não há chamada do frontend ao endpoint REST direto de cancelamento. Atualizar o número visível não altera nenhum desses mecanismos.

## Fluxo 5 — Fake Store e falhas

Mensagem ORDER_PRODUCTS → plan consulta o pedido próprio → getProduct para cada ID autorizado → client HTTP real com timeout e Zod → execute retorna informações complementares junto do snapshot oficial.

Se o serviço externo falhar, execute informa degradação. Nome, referência da foto, preço, quantidade e descrição/categoria já registrados continuam disponíveis no pedido. O navegador pode falhar ao buscar a foto, e ProductImage substitui a imagem pelo ícone; isso não bloqueia consultas/cancelamentos. Dados externos nunca mudam preço oficial ou status.

Os IDs do snapshot correspondem exatamente aos IDs externos. Não use descrição ou imagem de um produto diferente quando uma consulta falhar. Também não substitua silenciosamente o client HTTP por um catálogo local: o snapshot e a consulta complementar têm responsabilidades diferentes.

## Compatibilidade do histórico

Um ConversationTurn antigo pode conter JSON sem orderNumber e texto com UUID. send verifica replay antes de inferência e devolve esse JSON original. Não acrescente propriedades ao resultado persistido nem recalcule inputHash para adaptar interface.

No React, publicOrderText monta um mapa dos pedidos próprios carregados e altera apenas a string apresentada. Se o UUID não estiver nesse mapa, mostra referência indisponível, sem inventar número ou consultar dados de terceiros. O card antigo pode receber seu número pelo pedido atual, sem substituir o preço/status histórico do snapshot.

## Testes para estudar

- `apps/api/tests/public-orders.test.ts`: referências, ambiguidades, modelo inventando número, seleção determinística e exclusão da mochila.
- `apps/api/tests/integration/migration-public-orders.test.ts`: instalação das versões anteriores e preservação de uma fixture legada em schema exclusivo.
- `apps/api/tests/integration/agent.test.ts`: lookup público por titular, geração concorrente, snapshots BRL, cancelamento confirmado, replay antigo e falha externa.
- `apps/api/tests/orders.service.test.ts`: regras existentes de negócio, com fixtures atualizadas para os novos campos.
- `apps/api/tests/gemini.test.ts` e `integrations.test.ts`: mesmo SDK/timeout e validação estruturada, agora incluindo orderNumber.
- `apps/web/src/components/improvement-orders.test.tsx`: fotos/fallback, cópia, número público, moeda e adaptação de histórico.
- Testes React anteriores permanecem; fixtures foram atualizadas para o contrato público.

## Depurar no VS Code

Use a API e Vite locais em terminais de depuração, mantendo somente PostgreSQL no Docker nas mesmas portas. Não suba API/Vite e seus containers simultaneamente nas portas 3000/5173. Use Debug: Open Link para http://localhost:5173.

Breakpoints recomendados:

| Local | Verificar |
| --- | --- |
| demo-catalog.ts / selectDemoProducts | Produtos distintos e versão; não há preço externo |
| customer.service.ts / demoOrders | Um status por pedido e valores em centavos |
| order.controller.ts / getByNumber | customerId obtido da sessão, não do corpo |
| order.repository.ts / findOwnByNumber | Predicado inclui cliente e número |
| agent.safety.ts / resolveOrderReference | Números candidatos, exclusão de preço/quantidade, rejeição de ambiguidades |
| agent.orchestrator.ts / publicModelInput | Somente referências próprias são traduzidas para o modelo |
| agent.orchestrator.ts / referencedOrder | Conversão de referência pública para pedido interno autorizado |
| agent.orchestrator.ts / execute | Estado atual revalidado antes da confirmação/execução |
| order.repository.ts / cancelProcessing | UPDATE condicional, sem nova regra de frontend |
| useSupport.ts / askOrder e decide | Número público na mensagem; desafio em campo separado |
| order-presentation.ts / publicOrderText | Texto exibido diferente da persistência, sem gravação no histórico |
| ProductImage.tsx / onError | URL permitida e fallback sem afetar nome/preço |

Exemplo: se #10042 não for encontrado, primeiro confira a sessão, depois o predicado de findOwnByNumber. Não remova customerId para fazer a consulta funcionar. Se uma mensagem duplicada retornar texto antigo, isso pode ser o replay correto: verifique clientMessageId antes de tentar alterar o JSON armazenado.

Não copie tokens, cookies, CSRF ou chaves para logs ou capturas compartilhadas. Os números públicos são legíveis, mas não substituem identidade. A implementação termina aqui; autenticação com senha e recuperação continuam para a Implementação 2.
