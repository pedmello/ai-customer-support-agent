# AI Customer Support Agent

Agente seguro de atendimento por mensagens de texto. **Etapas 1 a 3: infraestrutura, clientes, sessões, pedidos, conversas persistidas, integração OpenAI, catálogo Fake Store e encaminhamento humano simulado.** A interface visual do chat não foi implementada. Não há verificação de e-mail, login com senha ou recuperação de contas.

O cadastro cria cliente, sessão e três pedidos em uma transação. **A identidade é demonstrativa e não comprova posse do e-mail.** E-mail duplicado não concede acesso à conta existente. O cancelamento REST direto exige identidade, CSRF, titularidade e estado permitido; representa uma operação autorizada pelo fluxo chamador. **O fluxo do agente acrescenta confirmação explícita persistida, expiração e uso único**, sem modificar esse contrato direto.

## Requisitos

- Node.js **24 LTS** e npm **11+** (a versão principal está em `.nvmrc`).
- Docker Desktop com engine Linux e Docker Compose v2, usando WSL2 no Windows.
- Portas livres: `3000` (API), `5173` (web) e `5434` (PostgreSQL). Todas são configuráveis. A porta `5434` evita os serviços já existentes em `5432`/`5433` no ambiente de desenvolvimento.

Execute os comandos na raiz do repositório. No PowerShell, use `npm.cmd` se a política de execução bloquear `npm.ps1`. Evite compartilhar `node_modules` entre Windows e WSL; instale as dependências no ambiente em que executará o Node.

## Instalação e ambiente

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
npm install
npm run db:generate
```

No WSL/bash, o equivalente à cópia é `cp .env.example .env`. Para instalações reproduzíveis após o primeiro setup, use `npm ci`; o `package-lock.json` fixa as versões. Não versione `.env` nem altere o prefixo de uma variável secreta para `VITE_`.

| Variável | Exemplo | Uso |
| --- | --- | --- |
| `NODE_ENV` | `development` | Ambiente da API; o Compose define `production` |
| `API_HOST` | `0.0.0.0` | Interface de escuta da API |
| `API_PORT` | `3000` | Porta local/publicada da API |
| `WEB_PORT` | `5173` | Porta do Vite ou porta publicada do frontend no Docker |
| `LOG_LEVEL` | `info` | Nível do Pino: trace, debug, info, warn, error, fatal ou silent |
| `API_PUBLIC_URL` | `http://localhost:3000` | Origem pública da API; HTTPS ativa cookie Secure e prefixo `__Host-` |
| `WEB_ORIGIN` | `http://localhost:5173` | Origem exata autorizada para CORS com credenciais, sem barra final |
| `SESSION_TTL_SECONDS` | `86400` | Expiração absoluta da sessão; entre 60 e 604800 segundos |
| `POSTGRES_PORT` | `5434` | Porta do PostgreSQL no host |
| `POSTGRES_DB` | `support_agent` | Nome do banco |
| `POSTGRES_USER` | `support` | Usuário local do banco |
| `POSTGRES_PASSWORD` | `change-me-local` | Senha fictícia para desenvolvimento; substitua no seu `.env` |
| `DATABASE_URL` | Ver `.env.example` | Conexão da API/Prisma executados no host |
| `TEST_DATABASE_URL` | Ver `.env.example` | Banco exclusivo terminado em `_test` para integração; nunca reutilize o banco da aplicação |
| `VITE_API_URL` | `http://localhost:3000` | Endereço público da API usado pelos links do frontend |
| `OPENAI_API_KEY` | vazio | Segredo exclusivo da API; sem chave há fallback humano simulado |
| `OPENAI_MODEL` | `gpt-4.1-mini` | Modelo configurável compatível com Responses e Structured Outputs |
| `OPENAI_TIMEOUT_MS` | `10000` | Timeout OpenAI, entre 100 e 30000 ms; sem retries automáticos |
| `FAKE_STORE_TIMEOUT_MS` | `5000` | Timeout por produto, entre 100 e 10000 ms |
| `CONFIRMATION_TTL_SECONDS` | `300` | Validade da confirmação, entre 30 e 900 segundos |

A API valida o ambiente com Zod antes de iniciar. Mensagens de configuração inválida listam apenas nomes de campos. Variáveis já definidas no processo têm precedência sobre `.env`.

Ao alterar porta, usuário, senha ou banco, atualize também `DATABASE_URL` e a URL de testes. Ao alterar `API_PORT`, ajuste `VITE_API_URL` e `API_PUBLIC_URL`; ao alterar `WEB_PORT`, ajuste `WEB_ORIGIN`. O Vite incorpora variáveis `VITE_` no bundle: use apenas valores públicos e refaça o build após modificá-los. Se já possui `.env`, acrescente as novas variáveis sem sobrescrever sua configuração.

`DATABASE_URL` exige percent-encoding em caracteres reservados de usuário/senha. Nesta etapa o Compose monta a URL a partir de `POSTGRES_*`; use uma senha local com caracteres seguros para URL (letras, números, `-`, `_`) nesse fluxo. Valores de exemplo não são credenciais de produção.

## Desenvolvimento local

Inicie somente o banco no Docker e execute API/web com recarga automática no host:

```powershell
docker compose up -d --wait postgres
npm run db:deploy
npm run dev
```

Também é possível executar em terminais separados:

```powershell
npm run dev -w @support/api
npm run dev -w @support/web
```

Endereços padrão:

- Frontend: <http://localhost:5173>
- Backend/healthcheck: <http://localhost:3000/health>
- Swagger UI: <http://localhost:3000/docs/>
- Contrato OpenAPI: <http://localhost:3000/openapi.json>

O frontend inicial continua estático e contém links para documentação e healthcheck. Não representa disponibilidade em tempo real e não implementa o chat. A API está preparada para requisições JavaScript com cookies a partir de `WEB_ORIGIN`; o cliente deverá usar `credentials: 'include'`.

## Aplicação completa no Docker

Depois de copiar/configurar `.env`:

```powershell
docker compose config --quiet
docker compose build api
docker compose up -d --wait postgres
docker compose run --rm api npm run db:deploy -w @support/api
docker compose up --build -d --wait
docker compose ps
docker compose logs -f api
```

Após aplicar as migrations, os próximos inícios podem usar `npm run docker:up`. Migrations são explícitas e não são executadas por esse atalho nem no startup do servidor. O Compose constrói a API compilada e o frontend estático servido por Nginx, sem bind mounts ou dependências do host. Alterações de código exigem novo build. Os endereços publicados são os mesmos do desenvolvimento local. Não execute o Vite/API no host e seus equivalentes no Docker nas mesmas portas simultaneamente.

O banco tem volume nomeado persistente, `postgres_data`. A API aguarda o healthcheck do PostgreSQL e a web aguarda a API saudável. Dentro da rede Docker o banco é `postgres:5432`; a URL local com `localhost` não é reutilizada no container. A chave OpenAI é repassada exclusivamente ao backend, nunca ao build/frontend. Após mudar o `.env`, recrie a API com `docker compose up -d api`.

```powershell
docker compose down
```

Esse comando (ou `npm run docker:down`) preserva os dados. **`docker compose down -v` exclui o volume e os dados.** Alterar `POSTGRES_USER`, `POSTGRES_PASSWORD` ou `POSTGRES_DB` não reconfigura um volume já inicializado: ajuste o banco existente ou recrie-o conscientemente se os dados puderem ser descartados.

Os serviços são publicados em `127.0.0.1`. Esta configuração é para execução local, sem TLS, e não constitui um deploy de produção.

## PostgreSQL no DBeaver

Escolha o driver **PostgreSQL**, com o serviço `postgres` em execução:

| Campo | Valor padrão |
| --- | --- |
| Host | `localhost` |
| Porta | `5434` (ou o seu `POSTGRES_PORT`) |
| Database | `support_agent` |
| Username | `support` |
| Password | Valor de `POSTGRES_PASSWORD` no seu `.env` |
| SSL | Desativado para o banco local |
| JDBC URL | `jdbc:postgresql://localhost:5434/support_agent` |

Não use o hostname interno `postgres` para conectar pelo DBeaver no host.

## Prisma e migrations

O schema contém `Customer`, `Session`, `Order` e `OrderItem`. A migration versionada `202610190001_stage2_customers_sessions_orders` cria tabelas, enum, chaves, índices e checks de consistência, sem apagar dados. O client Prisma 7 usa o adapter PostgreSQL e é gerado em `apps/api/src/generated/prisma` (ignorado pelo Git).

```powershell
npm run db:generate
npm run db:validate
npm run db:status
npm run db:deploy
```

`db:deploy` aplica migrations versionadas ao banco configurado, preservando o volume. Para mudanças de schema em etapas futuras:

```powershell
npm run db:migrate -- --name descricao_da_alteracao
npm run db:generate
```

Revise e versione o SQL gerado em `apps/api/prisma/migrations`. `migrate dev` é apenas para desenvolvimento e requer permissão para criar o shadow database (o usuário local da imagem PostgreSQL a possui). Em ambientes de execução, use `db:deploy`. Migrations não são executadas automaticamente na inicialização da API.

Com a aplicação no Docker, os comandos de migrations podem usar o ambiente interno:

```powershell
docker compose run --rm api npm run db:deploy -w @support/api
docker compose run --rm api npm run db:status -w @support/api
```

Geração e build não precisam de um PostgreSQL disponível. Comandos que acessam o banco exigem a conexão configurada.

## Verificações e execução compilada

```powershell
npm run typecheck
npm test
npm run build
npm run db:validate
docker compose config --quiet
```

`npm test` executa Vitest + Supertest. Os testes HTTP injetam a verificação do banco, cobrindo respostas 200/503 sem exigir PostgreSQL, validação de ambiente, erros HTTP e acesso ao Swagger. O funcionamento real do banco pode ser confirmado pelo `GET /health` com o Compose iniciado.

A suíte padrão também cobre tokens, normalização, regras de pedidos e configurações de segurança, sem exigir banco. Para testes HTTP com PostgreSQL real, crie **uma única vez** o banco separado e execute:

```powershell
docker compose exec -T postgres createdb -U support support_agent_test
npm run test:integration
```

Use o seu `POSTGRES_USER` se tiver mudado o exemplo. Configure `TEST_DATABASE_URL` no `.env` ou no processo; no PowerShell: `$env:TEST_DATABASE_URL='postgresql://support:change-me-local@localhost:5434/support_agent_test?schema=public'`. Se o banco já existe, não repita `createdb`. No WSL, use `export TEST_DATABASE_URL='...'`.

O comando aplica migrations somente ao banco de testes e verifica o sufixo `_test` e a separação da URL principal antes de executar. Os testes usam e-mails únicos e limpam somente os próprios registros. Não há truncate, reset ou remoção do volume. Casos, objetivos, condições e resultados esperados estão em [docs/stage-2.md](docs/stage-2.md).

## Clientes, sessões e pedidos

| Método | Endpoint | Regra principal |
| --- | --- | --- |
| POST | `/customers` | Nome/e-mail novos; cria sessão e três pedidos atomicamente |
| GET | `/sessions/current` | Retorna cliente, expiração e `csrfToken` da sessão |
| DELETE | `/sessions/current` | Exige CSRF, revoga a sessão e remove cookie |
| GET | `/orders?page=1&pageSize=20` | Lista somente pedidos do cliente autenticado |
| GET | `/orders/{orderId}` | Consulta pedido próprio; inexistente/estrangeiro têm o mesmo 404 |
| POST | `/orders/{orderId}/cancel` | Corpo `{}`, sessão e CSRF; somente PROCESSING |

Os pedidos iniciais têm estados PROCESSING, SHIPPED e CANCELLED. Itens e valores são sintéticos em USD, com preços em centavos e IDs 1/2/3 associados ao catálogo demonstrativo Fake Store. SHIPPED e CANCELLED retornam 409 sem alterações; cancelamentos concorrentes produzem uma única transição. Nunca envie `customerId` para autorizar uma operação.

### Swagger e Postman

1. Abra <http://localhost:3000/docs/> ou configure o Postman para essa URL base.
2. Execute `POST /customers` com `Content-Type: application/json` e `{"name":"Ana Silva","email":"ana-unica@example.test"}`. Use um e-mail inédito. A resposta 201 contém `csrfToken`; o cookie HttpOnly é guardado pelo navegador/cookie jar do Postman. Não é necessário autenticar manualmente com e-mail ou customerId.
3. No Swagger, clique **Authorize** e preencha somente `csrfToken`. Deixe os campos de cookie vazios: o navegador envia o cookie emitido pelo servidor. No Postman, mantenha o cookie jar ativo e envie `X-CSRF-Token: <valor retornado>` nas mutações.
4. Consulte `/sessions/current` para obter novamente o CSRF e a identidade atual; consulte `/orders` e copie um `orderId` do resultado.
5. Execute `POST /orders/{orderId}/cancel` com corpo JSON `{}` e o header CSRF. Um PROCESSING retorna 200; SHIPPED ou CANCELLED retornam 409.
6. Execute `DELETE /sessions/current` com CSRF para revogar. O token antigo passa a retornar 401. Não há reentrada ou recuperação da conta nesta etapa.

Use sempre o mesmo hostname (`localhost`, por exemplo), sem alternar para `127.0.0.1`, e não misture HTTP/HTTPS. Quando `API_PUBLIC_URL` usa HTTPS, o cookie é Secure e o teste também deve usar HTTPS. CORS aceita somente a origem pública da API e `WEB_ORIGIN`; Postman/curl sem Origin continuam compatíveis, mas não dispensam cookie ou CSRF.

Exemplo para o frontend local, sem implementar interface:

```typescript
const response = await fetch('http://localhost:3000/customers', {
  method: 'POST', credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Ana Silva', email: 'ana-unica@example.test' }),
});
const { csrfToken } = await response.json();
// Em cancelamento/logout: credentials: 'include' e header 'X-CSRF-Token': csrfToken.
```

Para comparar isolamento entre clientes, use dois cookie jars/perfis separados. Um cadastro bem-sucedido em um navegador que já tem sessão substitui seu cookie pelo do novo cliente; não há seleção de contas ou recuperação da sessão anterior. A revogação é explícita pelo endpoint de saída.

No DBeaver, atualize `support_agent → Schemas → public → Tables` após aplicar a migration. As tabelas são `customers`, `sessions`, `orders`, `order_items` e `_prisma_migrations`. Relacione `customer_id` e `order_id` para consultar os dados; `sessions` contém `token_hash`, `expires_at` e `revoked_at`, nunca o token bruto. O banco `support_agent_test` é separado e seus registros de teste são limpos ao concluir a suíte. Cadastre um cliente via Swagger/Postman para criar dados que permanecerão visíveis no DBeaver.

```powershell
npm run test:watch
npm start
# Em outro terminal, para visualizar o bundle web construído:
npm run preview
```

`npm start` inicia apenas a API compilada, na porta configurada. `npm run preview` serve o frontend em <http://localhost:4173>; o build deve ter sido executado antes. O preview do Vite é uma ferramenta de verificação local. No Docker, Nginx serve o frontend.

## Estrutura e arquitetura

```text
apps/
  api/
    prisma/
      schema.prisma
      migrations/migration_lock.toml
    prisma.config.ts
    src/
      app.ts                 # composição Express, sem listen ou banco global
      server.ts              # ambiente, dependências, servidor e shutdown
      config/                # validação de ambiente e Pino
      docs/                  # contrato OpenAPI
      integrations/database/ # criação do Prisma Client
      integrations/openai/   # SDK oficial, intenção estruturada e prompt efetivo
      integrations/fake-store/ # HTTP isolado, timeout e validação
      middlewares/           # erros e 404
      errors/                # erros de aplicação tipados
      modules/
        health/              # módulo existente preservado
        customers/           # cadastro transacional
        sessions/            # cookie, token, autenticação, CSRF e revogação
        orders/              # consultas e cancelamento atômico
        conversations/       # histórico, estado, idempotência e transações
        agent/               # orquestração e decisões determinísticas
        handoffs/            # encaminhamento humano simulado
        support.routes.ts    # composição dos módulos
    scripts/migrate-test.ts
    tests/                   # unidade e integração em banco separado
    Dockerfile
  web/
    src/                     # página inicial React e estilos
    vite.config.ts
    Dockerfile
docs/
  stage-1.md
  stage-2.md
  stage-3.md
  code-walkthrough-stage-3.md
compose.yaml
.env.example
package.json
package-lock.json
tsconfig.base.json
```

As camadas ficam juntas por módulo. Controller trata HTTP; service coordena o caso de uso; repository executa acesso ao banco; integrations mantém clientes de infraestrutura. A injeção de uma função para o healthcheck permite testar a API sem singleton global ou framework de DI.

Logs são JSON em stdout com Pino/Pino HTTP, identificação de requisição e duração. Não são registrados corpos, headers, query strings, connection strings ou mensagens de erro dos drivers. Erros expõem apenas respostas genéricas. O servidor limita JSON a 16 KiB, aplica headers de segurança e encerra conexões no shutdown.

Detalhes históricos: [Etapa 1](docs/stage-1.md) e [Etapa 2](docs/stage-2.md). Implementação atual: [Etapa 3](docs/stage-3.md) e [guia didático do código](docs/code-walkthrough-stage-3.md).

## Agente: Swagger e Postman

O frontend continua sendo a página inicial. Use a API em <http://localhost:3000>, Swagger em <http://localhost:3000/docs/> e a mesma sessão/CSRF do cadastro.

| Método | Endpoint | Função |
| --- | --- | --- |
| POST | `/conversations` | Corpo `{}`; criar conversa própria |
| GET | `/conversations?page=1&pageSize=20` | Listar conversas próprias |
| GET | `/conversations/{conversationId}?page=1&pageSize=20` | Estado atual e histórico paginado por turnos |
| POST | `/conversations/{conversationId}/messages` | Mensagem com `clientMessageId`, `content` e, ao decidir, `confirmationId` |
| POST | `/handoffs` | Registrar encaminhamento humano simulado, com conversa opcional |

1. Configure `OPENAI_API_KEY` e `OPENAI_MODEL` no `.env` do backend. Reinicie a API. Sem chave, mensagens comuns retornam fallback com encaminhamento simulado; não há interpretação local fingindo ser OpenAI.
2. Cadastre um cliente, guarde CSRF, consulte `/orders` e copie um pedido PROCESSING. Crie conversa com `POST /conversations`, corpo `{}`, cookie e CSRF.
3. Envie a `/conversations/{conversationId}/messages`:

   ```json
   {"clientMessageId":"e3f7f4f9-f004-468b-b39b-ff56a74d086e","content":"Quero cancelar o pedido UUID_DO_PEDIDO"}
   ```

4. Copie `data.conversation.pendingConfirmation.confirmationId`. Confira o UUID do pedido e o prazo. O pedido ainda não foi cancelado.
5. Envie outra mensagem com **novo** `clientMessageId`, `content` exatamente `CONFIRMAR CANCELAMENTO` e `confirmationId` igual ao recebido. Para desistir, use `DESISTIR` e o mesmo identificador. “Sim” não executa a operação.
6. Somente `data.code=ORDER_CANCELLED` representa sucesso desta execução; consulte também `/orders/{orderId}`. Confirmação vencida exige nova solicitação. Não reutilize o identificador em outra conversa.
7. Para consultar produtos, envie `Quais os produtos do pedido UUID_DO_PEDIDO?`. `data.order` contém preços/status oficiais; `data.products` contém dados externos complementares ou indisponibilidade. As descrições externas são texto não confiável.
8. Para encaminhamento direto: `POST /handoffs` com `{"reason":"CUSTOMER_REQUEST","conversationId":"UUID_DA_CONVERSA"}`. Sem `conversationId` também é permitido. Há somente registro simulado, sem promessa de contato.

Gere UUIDs no Postman com `{{$guid}}` (resolva e conserve o valor para retries) ou PowerShell `[guid]::NewGuid()`. Cada mensagem lógica tem uma chave nova; **retries da mesma mensagem reutilizam o mesmo `clientMessageId` e conteúdo**. Duplicatas concluídas devolvem o resultado original; `409 CONVERSATION_BUSY` permite tentar novamente. Reutilização com outro conteúdo retorna `409 MESSAGE_ID_CONFLICT`. O resultado repetido é um retrato daquela execução, não uma consulta do estado atual; recupere o estado em GET da conversa.

Erros conversacionais tratados retornam HTTP 200 com `data.code` e histórico persistido. Validação, autenticação, CSRF, concorrência e falhas de persistência mantêm `{error:{code,message}}` e status HTTP apropriado. Não há chamada externa real nos testes automatizados. Execute `npm test`, `npm run test:integration`, `npm run typecheck` e `npm run build`; a integração usa somente PostgreSQL separado com mocks OpenAI/Fake Store.

No DBeaver, mantenha `localhost:5434`, banco `support_agent`, usuário/senha configurados. Atualize o schema `public` para ver `conversations`, `conversation_turns`, `messages` e `human_handoffs`, além das tabelas anteriores. Os relacionamentos e consultas de estudo estão em [docs/stage-3.md](docs/stage-3.md).
