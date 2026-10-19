# Etapa 2 — Clientes, sessões e pedidos

## Escopo e suposições

O cadastro demonstrativo cria um cliente, três pedidos e uma sessão inicial de maneira atômica. Nome e e-mail não comprovam identidade nem posse do endereço. Um e-mail existente gera conflito e nunca cria uma sessão para essa conta. Não há login, senha, verificação de e-mail ou recuperação: ao perder, revogar ou deixar expirar a sessão, não há reentrada na conta nesta etapa.

Os UUIDs são gerados pelo sistema. E-mail é normalizado com trim e lowercase, sem remover pontos, sufixos `+` ou inferir aliases de provedores. A unicidade também será garantida no PostgreSQL. A sessão tem duração absoluta padrão de 24 horas, configurável, sem renovação automática.

Os pedidos demonstrativos possuem itens com referência numérica de produto, descrição e preço sintéticos, quantidade e moeda USD. Uma tabela de itens preserva a associação futura com produtos, sem consultar ou validar a Fake Store API nesta etapa. Não são preços ou dados obtidos de uma loja real.

## Endpoints implementados

| Método | Caminho | Finalidade |
| --- | --- | --- |
| POST | `/customers` | Cadastrar e abrir sessão somente para o novo cliente |
| GET | `/sessions/current` | Recuperar identidade demonstrativa, expiração e token CSRF |
| DELETE | `/sessions/current` | Revogar sessão atual e remover cookie |
| GET | `/orders` | Listar somente pedidos do cliente da sessão, com paginação |
| GET | `/orders/{orderId}` | Consultar pedido próprio |
| POST | `/orders/{orderId}/cancel` | Cancelar pedido próprio em PROCESSING |

Cancelamento é uma operação já autorizada pelo fluxo chamador. A API sempre valida sessão, CSRF, titularidade e estado. **O endpoint não implementa nem comprova a confirmação conversacional**, que pertence à etapa do agente. Nenhuma chamada à IA, integração de loja ou conversa será criada aqui.

Pedidos inexistentes e pertencentes a outro cliente têm o mesmo 404. O cancelamento usa atualização condicional atômica por ID, titular e estado PROCESSING: somente uma requisição concorrente altera o pedido. SHIPPED e CANCELLED retornam conflito e não são alterados.

## Persistência e relacionamentos

- `customers`: UUID, nome, e-mail normalizado único e data de criação.
- `sessions`: UUID, FK de cliente, hash SHA-256 único do token, criação, expiração e revogação. Índices por cliente e expiração.
- `orders`: UUID, FK de cliente, enum de status, moeda, criação, atualização e cancelamento. Índice por cliente/criação/ID para paginação estável.
- `order_items`: UUID, FK de pedido, productId, título sintético, quantidade e preço inteiro em centavos. Combinação pedido/produto única. Totais são calculados, sem duplicar valores derivados no banco.

Cliente tem várias sessões e pedidos; pedido tem vários itens. UUIDs são gerados pelo Prisma no backend. A migration adiciona todas as estruturas em uma transação SQL e inclui checks de normalização, coerência de cancelledAt e valores positivos dos itens. As FKs têm cascata para exclusão administrativa; a API não expõe exclusão de clientes ou pedidos.

A escrita aninhada do cadastro é uma única transação Prisma, incluindo sessão e itens. Em violação de unicidade, o repository confirma a existência do e-mail após a falha para classificar 409, sem depender do formato interno de `meta.target` do adapter e sem conceder acesso. Não há pré-consulta usada como garantia de unicidade: a constraint PostgreSQL protege a concorrência.

O cancelamento executa `UPDATE ... WHERE order_id = ? AND customer_id = ? AND status = 'PROCESSING'`, seguido da leitura dos dados dentro da mesma transação. Um resultado sem atualização só consulta o pedido no escopo do cliente para distinguir conflitos de estado. A titularidade também faz parte do predicado atômico, nunca depende somente de uma consulta anterior.

## Sessão, cookies e CSRF

O token de sessão tem 32 bytes aleatórios criptograficamente seguros, codificados em base64url. Somente seu hash SHA-256 é persistido; o segredo bruto sai da API exclusivamente no Set-Cookie e não aparece no JSON, Swagger como exemplo, logs ou URLs. Senhas não são usadas.

No HTTP local, o cookie chama-se `support_session`. Em HTTPS configurado por `API_PUBLIC_URL`, usa `__Host-support_session` com Secure. Ambos têm HttpOnly, SameSite=Lax, Path=/, expiração absoluta e nenhum Domain. O uso de origem pública explícita evita confiar em headers de proxy fornecidos pelo cliente. Ao terminar TLS em um proxy, configure `API_PUBLIC_URL` com a URL HTTPS externa. O Compose continua usando HTTP local e não implementa TLS nesta etapa.

O CSRF é um HMAC-SHA256 do contexto fixo `support-agent:csrf:v1`, usando o segredo da sessão como chave. A separação de domínio impede derivá-lo a partir do hash armazenado. Ele pode ser recuperado por uma sessão válida em `GET /sessions/current`, sem armazenar outro segredo em plaintext ou trocar o token entre abas. A comparação usa timingSafeEqual. CSRF não autentica por si só: o cookie e a sessão ativa continuam obrigatórios.

Cancelamento e revogação sempre exigem `X-CSRF-Token` correto. O cadastro, que ainda não tem sessão nova, aceita somente application/json, impossibilitando formulários cross-site simples. As rotas de dados rejeitam Origin não autorizado, incluindo `null`, antes de analisar o corpo. Fetch Metadata cross-site sem Origin também é rejeitado. Preflight autoriza apenas os métodos e headers usados e retorna a origem exata, nunca `*`. Essa combinação protege também contra cadastro forçado/troca de cookie por outro site.

O frontend local deve usar `credentials: 'include'` e o header CSRF nas mutações. Postman/curl sem Origin são aceitos, pois não dependem da política de origem do navegador; ainda precisam guardar o cookie e enviar CSRF. Use o mesmo hostname e esquema em todos os acessos. Os ambientes suportados usam frontend e API no mesmo site, ainda que em portas diferentes; um deploy em sites distintos exigirá uma decisão futura sobre cookies e CORS.

As respostas de dados usam Cache-Control: no-store. Headers, corpo, query strings, e-mails, cookies e tokens não são registrados pelo logger HTTP. Erros de drivers são registrados somente por tipo, sem mensagem, SQL, stack ou connection string.

Expiração é conferida a cada requisição, sem renovação. Logout marca revokedAt antes de remover o cookie; o segredo antigo não pode ser reutilizado. Requisições já autenticadas em andamento podem concluir antes de observar uma revogação concorrente. Sessões expiradas/revogadas permanecem no banco; não há job de limpeza, listagem de sessões ou recuperação de conta nesta etapa.

Um novo cadastro bem-sucedido em um navegador substitui o cookie pelo da conta recém-criada. Não recupera nem seleciona a conta anterior, nem revoga outras sessões implicitamente. O cliente pode revogar explicitamente a sessão atual antes de iniciar outro cadastro.

## Erros públicos

Erros seguem `{ "error": { "code": "...", "message": "..." } }`, preservando os contratos da Etapa 1. Não são retornadas as mensagens do banco ou os valores rejeitados pelo Zod.

| HTTP | Código | Condição |
| --- | --- | --- |
| 400 | VALIDATION_ERROR | Dados, parâmetros ou campos extras inválidos |
| 400 | INVALID_REQUEST | JSON malformado |
| 401 | UNAUTHENTICATED | Sessão ausente, inválida, expirada ou revogada |
| 403 | CSRF_INVALID | CSRF ausente, inválido ou de outra sessão |
| 403 | ORIGIN_NOT_ALLOWED | Origem não autorizada |
| 404 | ORDER_NOT_FOUND | Pedido inexistente ou de outro cliente, indistinguíveis |
| 404 | NOT_FOUND | Rota inexistente |
| 409 | EMAIL_ALREADY_REGISTERED | E-mail normalizado já cadastrado, sem novo cookie |
| 409 | ORDER_ALREADY_CANCELLED | Pedido já cancelado, sem alteração |
| 409 | ORDER_NOT_CANCELLABLE | Estado não cancelável, incluindo SHIPPED |
| 413 | PAYLOAD_TOO_LARGE | JSON acima de 16 KiB |
| 415 | UNSUPPORTED_MEDIA_TYPE | Cadastro/cancelamento sem application/json |
| 500 | INTERNAL_ERROR | Falha técnica inesperada, inclusive persistência |
| 503 | DATABASE_UNAVAILABLE | Falhas conhecidas de conexão, timeout ou pool do Prisma |

O `/health` mantém seu contrato original próprio: 200 `{status:"ok",database:"up"}` ou 503 `{status:"error",database:"down"}`. Ele verifica conexão; migrations permanecem uma operação explícita de implantação.

## Plano de testes

Todos os casos têm como condição uma aplicação configurada; casos de integração utilizam um banco exclusivo de testes com migrations aplicadas. Nenhum teste deve truncar, resetar ou apagar o banco existente. Apenas registros criados pelo próprio teste poderão ser removidos.

| Caso / objetivo | Cenário e condições | Resultado esperado |
| --- | --- | --- |
| Preservar Etapa 1 | Executar testes existentes | Healthcheck, erros HTTP e Swagger mantidos |
| Cadastro | Nome/e-mail válidos e inéditos | 201, UUID, sessão e exatamente três pedidos |
| Normalização | E-mail com espaços/case diferentes | Valor normalizado e conflito em duplicação |
| Corrida de cadastro | Duas requisições do mesmo e-mail | Um 201, um 409 e somente um conjunto de dados |
| Atomicidade | Forçar falha de persistência na criação da sessão | Cliente e pedidos não persistem |
| Validação | Campos ausentes, inválidos ou customerId extra | 400 sem dados internos |
| Cookie | Cadastro HTTP/HTTPS | HttpOnly, SameSite=Lax, host-only; Secure no HTTPS |
| Hash | Inspecionar sessão persistida | Token bruto ausente; somente hash SHA-256 |
| Sessão inválida | Ausente, malformada, desconhecida ou duplicada | 401 com o mesmo erro |
| Expiração/revogação | Sessão expirada ou revogada | 401 em leitura e mutação |
| CSRF | Token ausente, incorreto ou de outra sessão | 403, nenhuma alteração |
| Cadastro/CSRF | Origem externa ou formulário simples | Rejeitado; nenhuma sessão concedida |
| Compatibilidade | Origem web permitida e Postman sem Origin | CORS com credenciais; Postman usa cookie + header |
| Isolamento | Cliente B consulta/cancela pedido de A | Mesmo 404 de pedido inexistente |
| Consulta | Sessão válida, lista e UUID próprio | Dados apenas do titular e paginação válida |
| Cancelamento | PROCESSING próprio com CSRF | 200, CANCELLED e cancelledAt preenchido |
| Enviado | SHIPPED próprio | 409, estado e timestamps preservados |
| Já cancelado | CANCELLED próprio | 409, nenhuma nova alteração |
| Concorrência | Cancelamentos simultâneos do mesmo pedido | Uma transição; demais 409 |
| Banco indisponível | Falha no repository/driver | Erro técnico genérico, sem dados ou stack |
| Logout | Revogar com CSRF e reutilizar cookie antigo | 204; cookie removido e token antigo inválido |

## Como executar e inspecionar

As instruções de inicialização, variáveis, Swagger/Postman, fetch do frontend e DBeaver estão no [README](../README.md). Para a integração, crie uma vez `support_agent_test`, configure TEST_DATABASE_URL e execute `npm run test:integration`. O comando recusa o nome de banco da aplicação e aplica migrations somente no banco terminado em `_test`. Não existe comando de reset no fluxo de testes.

No DBeaver, conecte a `localhost:5434`, banco `support_agent`, usuário/senha do seu `.env`, e atualize as tabelas do schema public. Cadastre um cliente via Swagger/Postman para criar registros visíveis; testes de integração e smoke limpam seus próprios dados. Uma consulta somente de leitura para conferir os vínculos:

```sql
SELECT c.customer_id, c.email, o.order_id, o.status,
       i.product_id, i.quantity, i.unit_price_cents
FROM customers c
JOIN orders o ON o.customer_id = c.customer_id
JOIN order_items i ON i.order_id = o.order_id
ORDER BY c.created_at DESC, o.created_at DESC;
```

## Arquivos desta etapa

Criados:

```text
apps/api/prisma/migrations/202610190001_stage2_customers_sessions_orders/migration.sql
apps/api/scripts/migrate-test.ts
apps/api/vitest.integration.config.ts
apps/api/src/docs/support.openapi.ts
apps/api/src/errors/app-error.ts
apps/api/src/middlewares/browser-security.ts
apps/api/src/modules/support.routes.ts
apps/api/src/modules/customers/
  customer.controller.ts
  customer.repository.ts
  customer.routes.ts
  customer.schemas.ts
  customer.service.ts
apps/api/src/modules/sessions/
  session.controller.ts
  session.cookie.ts
  session.middleware.ts
  session.repository.ts
  session.routes.ts
  session.service.ts
  session.tokens.ts
apps/api/src/modules/orders/
  order.controller.ts
  order.repository.ts
  order.routes.ts
  order.schemas.ts
  order.service.ts
apps/api/tests/security.test.ts
apps/api/tests/orders.service.test.ts
apps/api/tests/environment-security.test.ts
apps/api/tests/helpers/test-database.ts
apps/api/tests/integration/support.test.ts
docs/stage-2.md
```

Alterados: `package.json`, `compose.yaml`, `.env.example`, `README.md`, `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/vitest.config.ts`, `apps/api/prisma/schema.prisma`, `apps/api/src/app.ts`, `apps/api/src/server.ts`, `apps/api/src/config/env-schema.ts`, `apps/api/src/middlewares/error-handler.ts` e `apps/api/src/docs/openapi.ts`. Não foram alterados os arquivos dos testes da Etapa 1, a configuração de conexão Prisma, o Dockerfile, o volume ou a interface web.

## Resultado de validação — 19/10/2026

- 34 testes da suíte padrão aprovados, incluindo os 12 originais.
- 35 testes HTTP de integração com PostgreSQL real aprovados, incluindo rollback, duplicação concorrente e oito cancelamentos simultâneos com uma única alteração.
- Typecheck e build dos dois workspaces aprovados; npm ci da imagem com auditoria sem vulnerabilidades reportadas.
- Migration aplicada nos bancos principal e separado de testes, sem reset, truncate ou remoção do volume. Prisma migrate status atualizado e migrate diff sem diferenças de schema.
- Compose validado; API reconstruída e os três serviços saudáveis. Porta PostgreSQL mantida em 5434.
- Smoke HTTP contra a API compilada em Docker: cadastro, e-mail duplicado, isolamento, quatro cancelamentos simultâneos, revogação e healthcheck aprovados. Apenas os dois clientes sintéticos desse smoke e seus dependentes foram removidos ao final.
- Swagger renderizou as sete operações no navegador, sem erros ou avisos no console. A autenticação continua por cookie automático; o usuário informa somente CSRF no Authorize para mutações.
- git diff --check sem erros. Nenhuma branch, commit ou push criado.

Não há integração OpenAI/Fake Store, chat ou histórico. TLS e comprovação de identidade não são implementados. A confirmação conversacional é uma pendência intencional da etapa futura do agente, não uma garantia deste endpoint de cancelamento.
