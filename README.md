# Support AI — Agente seguro de atendimento por mensagens

Agente de atendimento por mensagens de texto que consulta pedidos e ajuda o cliente a solicitar cancelamentos dentro das regras de negócio. Um modelo de IA (Google Gemini ou OpenAI) interpreta as mensagens. Autorização, regras e execução das operações ficam no backend. A Fake Store API complementa os pedidos com dados de produtos.

**Principais garantias**

- Somente pedidos em processamento podem ser cancelados, com a regra validada no agente e na API.
- O cancelamento exige confirmação explícita, de uso único e com prazo, vinculada à conversa.
- O agente só informa que o pedido foi cancelado depois que a API principal confirma o sucesso.
- Cada cliente acessa apenas os próprios pedidos e conversas (sessão HttpOnly, CSRF e verificação de titularidade).
- Texto do cliente, saída do modelo e dados da Fake Store nunca substituem as regras de negócio.

## Sumário

- [Tecnologias](#tecnologias)
- [Arquitetura](#arquitetura)
- [Executar com Docker](#executar-com-docker)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Frontend e Swagger](#frontend-e-swagger)
- [Testes](#testes)
- [Regras de negócio](#regras-de-negócio)
- [Decisões técnicas](#decisões-técnicas)
- [Limitações](#limitações)
- [Documentação](#documentação)
- [Desenvolvimento local](#desenvolvimento-local)

## Tecnologias

| Camada | Tecnologias |
| --- | --- |
| API principal | Node.js 24, TypeScript, Express 5, Zod, Pino |
| Banco de dados | PostgreSQL 17, Prisma 7 (migrations versionadas) |
| IA | Google Gemini `gemini-3.5-flash-lite` (padrão, SDK `@google/genai`); OpenAI `gpt-4.1-mini` (alternativa, SDK `openai`) |
| API externa | [Fake Store API](https://fakestoreapi.com) |
| Frontend | React 19, Vite 8, servido por Nginx no Docker |
| Documentação da API | OpenAPI 3 e Swagger UI |
| Testes | Vitest, Supertest e Testing Library |
| Infraestrutura | Docker Compose (PostgreSQL, API e web) |

## Arquitetura

```text
Cliente (React) ──HTTP + cookie HttpOnly + CSRF──► API Express
                                                    │
     ┌──────────────────────────────────────────────┼───────────────────────────┐
     ▼                                              ▼                           ▼
 Agente (orquestrador)                     Pedidos / Clientes / Sessões     Fake Store API
  1. reconhecimento determinístico          (regras e PostgreSQL)           (produtos, somente
  2. IA: intenção + plano de leitura                                         complemento)
  3. backend autoriza, executa e responde
```

1. Mensagens simples (status, produtos ou cancelamento de um pedido com número, saudações e pedidos sem número) são reconhecidas por modelos fixos, sem chamar a IA.
2. Nas demais mensagens, o modelo devolve apenas uma **intenção estruturada** e, em consultas coletivas, um **plano de leitura**. Ambos são validados com JSON Schema e Zod. O modelo não executa ferramentas, SQL ou ações e não escreve as respostas.
3. O backend verifica titularidade, status e confirmação; consulta ou cancela o pedido em transação; e compõe a resposta a partir de modelos fixos.

```text
apps/
  api/                      # API principal (Express + Prisma)
    prisma/                 # schema e migrations
    src/
      config/               # validação de ambiente (Zod) e logger (Pino)
      docs/                 # contrato OpenAPI e exemplos
      integrations/         # Gemini, OpenAI (prompt), Fake Store, e-mail e banco
      modules/              # agent, orders, conversations, customers, sessions, auth, handoffs, health
    tests/                  # testes unitários e de integração
  web/                      # frontend React
docs/                       # documentação do projeto
compose.yaml                # PostgreSQL, API e web
```

Cada módulo separa controller (HTTP), service (caso de uso) e repository (banco).

## Executar com Docker

> **Antes de começar**
>
> - O projeto não inclui chaves de API. Gere sua própria chave do Gemini no [Google AI Studio](https://aistudio.google.com/apikey) e informe-a em `GEMINI_API_KEY`.
> - O Gemini tem um nível gratuito, sujeito a limites de uso. Mensagens em sequência rápida podem atingir a cota (HTTP 429).
> - O [`.env.example`](.env.example) é o modelo de configuração. Copie-o para `.env`, que guarda configurações e credenciais locais e **nunca deve ser enviado ao Git** (já está no `.gitignore`).

**Pré-requisitos:** Docker Desktop com Docker Compose v2 (no Windows, engine Linux com WSL2) e as portas `3000`, `5173` e `5434` livres.

```powershell
# 1. Configuração (no bash: cp .env.example .env)
Copy-Item .env.example .env
# Edite o .env: defina POSTGRES_PASSWORD e a chave do provedor de IA (GEMINI_API_KEY)

# 2. Banco e migrations (na primeira execução)
docker compose build api
docker compose up -d --wait postgres
docker compose run --rm api npm run db:deploy -w @support/api

# 3. Aplicação completa
docker compose up --build -d --wait
docker compose ps
```

| Serviço | Endereço |
| --- | --- |
| Frontend | <http://localhost:5173> |
| Swagger UI | <http://localhost:3000/docs/> |
| Contrato OpenAPI | <http://localhost:3000/openapi.json> |
| Healthcheck | <http://localhost:3000/health> |
| PostgreSQL | `localhost:5434` |

- Logs da API: `docker compose logs -f api`.
- Parar: `docker compose down`. Os dados ficam no volume `postgres_data`; **`docker compose down -v` apaga o banco.**
- Depois de alterar o `.env`, recrie a API com `docker compose up -d --no-deps api`. Depois de alterar o código, use `docker compose up --build -d --wait`.
- As migrations não rodam automaticamente: aplique-as com o comando do passo 2 sempre que houver novas.
- Os serviços são publicados em `127.0.0.1`, sem TLS. Esta configuração é para execução local, não para produção.

## Variáveis de ambiente

O arquivo [`.env.example`](.env.example) contém todos os valores de exemplo. A API valida o ambiente com Zod ao iniciar. As chaves são repassadas somente ao serviço `api`, nunca ao frontend; não use o prefixo `VITE_` em segredos.

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | `change-me-local` | Senha do banco local (obrigatória no Compose) |
| `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PORT` | `support_agent` / `support` / `5434` | Banco, usuário e porta publicada |
| `DATABASE_URL` / `TEST_DATABASE_URL` | ver `.env.example` | Conexões usadas fora do Docker; o banco de testes deve terminar em `_test` |
| `AI_PROVIDER` | `gemini` | `gemini` ou `openai` |
| `GEMINI_API_KEY` / `GEMINI_MODEL` / `GEMINI_TIMEOUT_MS` | vazio / `gemini-3.5-flash-lite` / `10000` | Credencial, modelo e prazo do Gemini |
| `OPENAI_API_KEY` / `OPENAI_MODEL` / `OPENAI_TIMEOUT_MS` | vazio / `gpt-4.1-mini` / `10000` | Credencial, modelo e prazo da OpenAI |
| `FAKE_STORE_TIMEOUT_MS` | `5000` | Prazo por produto na Fake Store |
| `CONFIRMATION_TTL_SECONDS` | `300` | Validade da confirmação de cancelamento e da oferta de atendimento |
| `API_PORT` / `WEB_PORT` | `3000` / `5173` | Portas publicadas da API e do frontend |
| `API_PUBLIC_URL` / `WEB_ORIGIN` / `VITE_API_URL` | `http://localhost:3000` / `http://localhost:5173` / `http://localhost:3000` | Origens públicas (CORS, cookie e build do frontend) |
| `SESSION_TTL_SECONDS` | `86400` | Expiração da sessão |
| `LOG_LEVEL` | `info` | Nível de log do Pino |
| `EMAIL_PROVIDER` | `disabled` | `resend` habilita a recuperação de senha por e-mail; exige `EMAIL_FROM`, `RESEND_API_KEY` e `PASSWORD_RESET_HMAC_SECRET` (32+ caracteres) |

Ao mudar portas, ajuste também as URLs correspondentes (`API_PUBLIC_URL`, `VITE_API_URL`, `WEB_ORIGIN` e `DATABASE_URL`). Não há fallback automático entre provedores de IA. Sem a chave do provedor selecionado, as mensagens simples continuam funcionando e as demais recebem a oferta de atendimento humano.

## Frontend e Swagger

**Frontend** (<http://localhost:5173>): crie uma conta. O cadastro gera seis pedidos demonstrativos com status variados. Depois, converse com o agente, por exemplo:

- `Qual o status do pedido #10003?`
- `Quais os produtos do pedido #10003?`
- `Quero cancelar o pedido #10003` (o pedido só é cancelado após o botão de confirmação)
- `Quantos pedidos não foram enviados?`

Use os números de pedido exibidos na aba de pedidos.

**Swagger UI** (<http://localhost:3000/docs/>):

1. Execute `POST /customers` com `name`, um `email` inédito (por exemplo `ana@example.test`), `password` de 12 caracteres ou mais e `passwordConfirmation` igual. O navegador guarda o cookie de sessão; copie o `csrfToken` da resposta.
2. Clique em **Authorize** e preencha somente `csrfToken`.
3. Use `GET /orders` para obter os pedidos.
4. Use `POST /conversations` (corpo `{}`) para criar uma conversa e envie mensagens em `POST /conversations/{conversationId}/messages`.

| Método | Endpoint | Função |
| --- | --- | --- |
| POST | `/customers` | Cadastro (cria sessão e seis pedidos) |
| POST / GET / DELETE | `/sessions`, `/sessions/current` | Login, sessão atual e logout |
| POST | `/password-recovery/request`, `/password-recovery/reset` | Recuperação de senha por código enviado por e-mail |
| GET | `/orders`, `/orders/{orderId}`, `/orders/by-number/{orderNumber}` | Consulta de pedidos próprios |
| POST | `/orders/{orderId}/cancel` | Cancelamento (somente `PROCESSING`; `SHIPPED`/`CANCELLED` → 409) |
| POST / GET | `/conversations`, `/conversations/{conversationId}` | Criação, lista e histórico de conversas |
| POST | `/conversations/{conversationId}/messages` | Mensagem para o agente |
| POST | `/handoffs` | Encaminhamento humano simulado |

**Cancelamento pelo agente via API:** a resposta a `Quero cancelar o pedido #N` traz `data.conversation.pendingConfirmation.confirmationId`. Envie uma nova mensagem com `content: "CONFIRMAR CANCELAMENTO"` (ou `"DESISTIR"`) e esse `confirmationId`. Só `data.code = ORDER_CANCELLED` indica sucesso. Cada mensagem lógica usa um `clientMessageId` novo. Uma nova tentativa da mesma mensagem reutiliza o mesmo id e devolve o resultado original.

Mutações exigem o cookie de sessão e o header `X-CSRF-Token`. Use sempre o mesmo hostname (`localhost`). As respostas distinguem sucesso, pedido não encontrado (404), pedido não cancelável (409) e erro técnico (5xx com `error.code`).

## Testes

Na raiz, com dependências instaladas (`npm ci`, Node.js 24 e npm 11+) e o PostgreSQL do Compose em execução:

```powershell
npm run typecheck
npm test                    # unitários da API e do frontend
docker compose exec -T postgres createdb -U support support_agent_test   # apenas na primeira vez
npm run test:integration    # HTTP + PostgreSQL real em support_agent_test
npm run build
```

| Suíte | Local | Dependências |
| --- | --- | --- |
| Unitários da API | `apps/api/tests/*.test.ts` | Sem banco; IA, Fake Store e e-mail simulados |
| Integração | `apps/api/tests/integration/*.test.ts` | PostgreSQL real em banco `_test`; IA e Fake Store simulados |
| Frontend | `apps/web/src/**/*.test.ts(x)` | jsdom; API simulada |

`TEST_DATABASE_URL` deve apontar para um banco terminado em `_test`, separado do banco da aplicação. Os testes usam e-mails únicos e removem apenas os próprios registros. Os testes automatizados não chamam serviços externos reais.

**Casos de teste documentados:** [docs/test-cases.md](docs/test-cases.md) e [docs/Support-AI-Suite-de-Testes.pdf](docs/Support-AI-Suite-de-Testes.pdf). Os dois registram 45 casos, com objetivo, pré-condições, passos, resultado esperado e obtido, a matriz de rastreabilidade com os requisitos do desafio e a origem de cada evidência (Gemini real, Fake Store real, PostgreSQL real ou simulação).

## Regras de negócio

| # | Regra do desafio | Como é garantida |
| --- | --- | --- |
| 1 | Consultar o status de um pedido | Consulta somente pedidos do cliente autenticado; pedido inexistente ou de terceiro retorna o mesmo 404 |
| 2 | Cancelar apenas pedidos em processamento | Atualização condicional no banco (`status = PROCESSING`) e verificação na API |
| 3 | Pedidos enviados não são cancelados | `SHIPPED` e `CANCELLED` retornam 409 sem alteração |
| 4 | Confirmar a intenção antes de cancelar | Confirmação persistida, de uso único, com prazo e vinculada à conversa; exige frase explícita ou botão |
| 5 | Informar cancelamento apenas com sucesso da API | A mensagem de sucesso é gerada pelo backend após o commit da transação |
| 6 | Não afirmar conclusão em falhas ou dúvidas | Falhas de IA, banco ou Fake Store e mensagens ambíguas geram resposta de indisponibilidade, erro técnico ou pedido de esclarecimento, nunca de sucesso |
| 7 | Oferecer atendimento humano | Oferta fora do escopo ou em falhas; registro somente com consentimento (simulado) |
| 8 | Dados do cliente ou externos não mudam as regras | Mensagens e dados da Fake Store são tratados como dados não confiáveis; tentativas de manipulação são recusadas |

Dúvidas para negócio/produto, suposições adotadas e quando o agente prossegue, pede esclarecimento, recusa ou encaminha: [docs/current-behavior.md](docs/current-behavior.md).

## Decisões técnicas

- **IA como intérprete, não como executor.** O modelo classifica a intenção e monta planos de leitura validados; o backend decide e escreve as respostas. Assim, um modelo manipulado não consegue cancelar pedidos nem afirmar ações não realizadas. Prompt e regras: [docs/agent-instructions.md](docs/agent-instructions.md).
- **Reconhecimento determinístico** das mensagens mais comuns. Reduz a dependência da cota do modelo e mantém o atendimento básico funcionando quando a IA está indisponível.
- **Fake Store como complemento.** Os pedidos usam um catálogo local versionado com IDs da Fake Store. A consulta HTTP real enriquece os produtos (nome, descrição, categoria e imagem), mas status, preços e cancelamento vêm sempre da API principal. Falhas, respostas inválidas e timeouts da Fake Store não bloqueiam consultas nem cancelamentos.
- **Idempotência e concorrência.** `clientMessageId` com hash do conteúdo, lease por conversa e atualização condicional evitam execuções duplicadas e cancelamentos concorrentes.
- **Segurança.** Sessão opaca em cookie HttpOnly, CSRF, Origin permitida, limite de 16 KiB por requisição, senhas com Argon2id e dados sensíveis mascarados antes da IA e da persistência.
- **Observabilidade.** Logs JSON (Pino) com `requestId`, evento, resultado e duração; sem mensagens, prompts, e-mails, senhas, tokens ou chaves. Exemplos em [docs/structured-logs.md](docs/structured-logs.md).

## Limitações

- Perguntas indiretas dependem do provedor de IA e da cota da conta; com falha ou HTTP 429, o agente oferece atendimento humano sem executar ações.
- O atendimento humano é simulado: há registro, mas nenhuma equipe ou contato real.
- Os pedidos são demonstrativos e o cadastro não verifica o e-mail. A posse do e-mail só é comprovada na recuperação de senha.
- Não há filtros por período, pagamento, rastreamento, entrega concluída ou reembolso. "Enviado" não significa "entregue".
- Configuração local sem TLS; o limite de mensagens por cliente não é distribuído.

Lista completa e riscos conhecidos: [docs/current-behavior.md](docs/current-behavior.md) e a seção de limitações de [docs/test-cases.md](docs/test-cases.md).

## Documentação

| Tema | Documento |
| --- | --- |
| Regras, dúvidas, suposições e comportamento atual do agente | [docs/current-behavior.md](docs/current-behavior.md) |
| Instruções do agente, função do modelo, prompt utilizado e regras de confiança | [docs/agent-instructions.md](docs/agent-instructions.md) |
| Modelo de IA, configuração do Gemini/OpenAI e validação real | [docs/stage-3.1-gemini.md](docs/stage-3.1-gemini.md) |
| Integração com a Fake Store | [docs/stage-3.md](docs/stage-3.md) (seção "Fake Store API") |
| Consultas coletivas e planos de leitura da IA | [docs/collective-query-plans.md](docs/collective-query-plans.md) |
| Atendimento humano com consentimento | [docs/human-handoff-consent.md](docs/human-handoff-consent.md) |
| Logs estruturados e exemplos | [docs/structured-logs.md](docs/structured-logs.md) |
| Casos de teste e resultados | [docs/test-cases.md](docs/test-cases.md) e [docs/Support-AI-Suite-de-Testes.pdf](docs/Support-AI-Suite-de-Testes.pdf) |
| Contrato da API | Swagger UI em `/docs/` e [`apps/api/src/docs/`](apps/api/src/docs/) |

Os demais documentos em `docs/` (`stage-*`, `improvement-*`, `code-walkthrough-*` e afins) registram o histórico de cada entrega. Quando divergirem, prevalece [docs/current-behavior.md](docs/current-behavior.md).

## Desenvolvimento local

Para executar a API e o frontend com recarga automática no host, mantendo apenas o banco no Docker:

```powershell
npm ci
npm run db:generate
docker compose up -d --wait postgres
npm run db:deploy
npm run dev
```

Não execute ao mesmo tempo a versão local e a do Docker nas mesmas portas. No PowerShell, use `npm.cmd` se a política de execução bloquear `npm.ps1`. Para mudanças no schema, use `npm run db:migrate -- --name descricao` e versione o SQL gerado em `apps/api/prisma/migrations`.
