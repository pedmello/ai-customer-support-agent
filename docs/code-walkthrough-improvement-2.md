# Guia de estudo — Implementação 2

## Ordem recomendada

Leia `apps/api/src/modules/auth/auth.schemas.ts`, depois `auth.service.ts`, `auth.repository.ts`, `password.ts` e `auth.controller.ts` no mesmo diretório. Em seguida siga o cadastro existente, a validação de sessão, o client de e-mail e a interface React. Essa ordem mostra primeiro quais dados entram, depois as decisões, a persistência e os detalhes de transporte.

## Mapa dos arquivos e métodos

| Caminho no projeto | Responsabilidade e métodos | Quem chama / dependências |
| --- | --- | --- |
| `apps/api/src/modules/auth/auth.schemas.ts` | `emailSchema`, `passwordSchema`, `matchingPasswords`, `loginSchema`, `recoveryRequestSchema`, `recoveryResetSchema` | Controllers e schema de cadastro; Zod valida limites e confirmação |
| `apps/api/src/modules/auth/password.ts` | `hashPassword`, `verifyPassword` | Cadastro e AuthService; usa Argon2id com salt automático e hash fictício para conta ausente |
| `apps/api/src/modules/auth/auth.policy.ts` | `AuthOptions`, `defaultAuthOptions` | Composição no servidor/testes; define provedor, segredo, expiração, tentativas e reenvio |
| `apps/api/src/modules/auth/auth.controller.ts` | `createAuthController`: `login`, `request`, `reset`; `requestOrigin` | Rotas; valida DTO, obtém IP confiável, chama serviço e configura cookie/resposta |
| `apps/api/src/modules/auth/auth.routes.ts` | `createRecoveryRouter` | SupportRouter; exige JSON, valida CSRF se houver sessão ativa, delega ao controller |
| `apps/api/src/modules/auth/auth.service.ts` | `createAuthService`: `registrationAllowed`, `login`, `requestRecovery`, `reset`; `codeVerifier` | Controllers/cadastro; coordena repository, Argon2id, criptografia e EmailClient |
| `apps/api/src/modules/auth/auth.repository.ts` | `findByEmail`, `issueSession`, `allow`, `newChallenge`, `invalidateChallenge`, `reset` | AuthService; Prisma/PostgreSQL, contadores atômicos, locks e transações |
| `apps/api/src/modules/customers/customer.schemas.ts` | `registerCustomerSchema` | CustomerController; nome/e-mail e campos de senha compartilhados |
| `apps/api/src/modules/customers/customer.routes.ts` | `createCustomerRouter` | SupportRouter; JSON e limite por origem antes do cadastro |
| `apps/api/src/modules/customers/customer.service.ts` | `register`, `demoOrders` | CustomerController; hash da senha e mesmo catálogo/gerador de três pedidos |
| `apps/api/src/modules/customers/customer.repository.ts` | `register` | CustomerService; nested write de cliente, sessão e pedidos, constraint de e-mail único |
| `apps/api/src/modules/sessions/session.routes.ts` | `createSessionRouter` | Adiciona POST público; preserva GET/DELETE autenticados |
| `apps/api/src/modules/sessions/session.repository.ts` | `findActive`, `revoke` | SessionService; filtra sessão ativa, conta com senha e versão correspondente; retorna apenas dados públicos |
| `apps/api/src/modules/sessions/session.service.ts` | `prepareSession`, `authenticate`, `revoke` (reutilizados) | AuthService e middleware; token opaco aleatório, hash, expiração absoluta |
| `apps/api/src/modules/sessions/session.tokens.ts` | `newSessionToken`, `hashSessionToken`, `csrfForToken`, `validCsrf` (reutilizados) | Sessões/controllers/middleware; autenticação e CSRF separados |
| `apps/api/src/integrations/email/email.client.ts` | `EmailClient`, `createResendClient`, `sendRecovery`, `recoveryTemplate` | AuthService por interface; HTTPS fixo, timeout, idempotência e template textual |
| `apps/api/src/modules/support.routes.ts` | `createSupportRouter` | `createApp`; injeta database, políticas, serviços e rotas |
| `apps/api/src/server.ts` | Composição de `auth` | Carrega env; seleciona Resend ou envio desabilitado; preserva Gemini/OpenAI |
| `apps/api/src/config/env-schema.ts` | `parseEnv` | Servidor; limites e configuração completa do Resend, erro sem valores secretos |
| `apps/api/src/config/logger.ts` | `createLogger` | Servidor/client; redação adicional e serialização segura de erros |
| `apps/api/src/docs/auth.openapi.ts` | `authPaths`, `authSchemas` | OpenAPI; contratos de login e recuperação |
| `apps/api/prisma/schema.prisma` | Customer/Session e novos PasswordResetChallenge/AuthRateLimit | Prisma; tipos e relacionamentos, não substitui regras de serviço |
| `apps/api/scripts/verify-auth-migration.ts` | comparação `before/after` | Execução administrativa; somente contagens/hashes de campos anteriores, arquivos em `.temp` |
| `apps/web/src/components/AuthLayout.tsx` | `AuthLayout` | As telas de acesso; mantém logo, benefícios, duas colunas e versão mobile |
| `apps/web/src/components/Registration.tsx` | `Registration`, `submit` | Authentication; valida confirmação, bloqueia duplo envio, encaminha senha exata ao callback |
| `apps/web/src/components/Authentication.tsx` | `Authentication`, `navigate`, `requestCode`, `perform`, `submit` | App; estados login/register/request/reset, cooldown, erros e retorno ao login |
| `apps/web/src/components/PasswordField.tsx` | `PasswordField` | Cadastro/login/reset; visibilidade, autocomplete e rótulos acessíveis |
| `apps/web/src/services/api.ts` | `register`, `login`, `requestRecovery`, `resetPassword`, `request` | Hooks/telas; cookies automáticos, CSRF em memória e erros amigáveis, sem alteração de senha/código |
| `apps/web/src/hooks/useSupport.ts` | `login`, `register`, `loadLists`, `loadHistory`, `clear` | App; carrega dados da mesma conta e descarta estado ao sair/receber 401 |
| `apps/web/src/App.tsx` | `App` | Exibe Authentication sem sessão; mantém atendimento/pedidos após autenticação |

## Cadastro, passo a passo

`Registration.submit` valida igualdade das senhas e chama `useSupport.register`. Este chama `api.register`, que normaliza apenas nome/e-mail e envia JSON com cookie habilitado. `browserSecurity` confere a origem e `requireJson` impede formulários cross-site comuns.

`createCustomerRouter` aplica o limite de origem. `createCustomerController` usa `registerCustomerSchema.parse`; o `createCustomerService.register` calcula `hashPassword`. `createCustomerRepository.register` recebe **somente hash**, nome, e-mail e data, nunca senha/confirmacão, e grava cliente/sessão/três pedidos em uma única transação. Se qualquer escrita falhar, todas são desfeitas.

O controller define o cookie HttpOnly e retorna apenas o cliente público, expiração e CSRF. O hook guarda CSRF em memória, carrega pedidos/conversas e a App passa para o atendimento. `emailVerifiedAt` continua null.

## Login e credentialVersion

`Authentication.submit` → `useSupport.login` → `api.login` → `POST /sessions` → `createAuthController.login` → `loginSchema` → `AuthService.login`.

`login` consulta os limites persistidos, busca o e-mail e executa `verifyPassword`. Conta ausente ou sem hash ainda executa Argon2id, mas recebe a mesma recusa. Para senha correta, `prepareSession` gera token e hash. O repository `issueSession` bloqueia o cliente e compara hash/versão novamente antes da criação.

Imagine `credentialVersion=3`. Toda sessão nova registra 3. Um reset muda o cliente para 4 e revoga as sessões. Mesmo que um registro antigo com versão 3 seja acidentalmente marcado como não revogado, `findActive` ainda o recusa. Esse segundo controle cobre a validade de credenciais independentemente do campo `revokedAt`.

O hash verificado fora da transação pode ter ficado antigo. Por isso o lock de `issueSession` e o lock de `reset` são o mesmo. Uma comparação feita apenas antes do lock não protegeria contra a corrida. O teste com barreira pausa realmente o login nesse intervalo para comprovar o comportamento.

## Recuperação e envio

`Authentication.requestCode` → `api.requestRecovery` → `createRecoveryRouter` → `createAuthController.request` → `AuthService.requestRecovery`.

O serviço aplica os limites, busca a conta elegível, gera UUID interno e oito dígitos e calcula `codeVerifier`. `newChallenge` bloqueia cliente, verifica cooldown, invalida desafio anterior e grava o novo HMAC. Só então `EmailClient.sendRecovery` recebe o código em memória para montar o e-mail.

`createResendClient` envia texto à URL HTTPS fixa do provedor. A chave fica no header de backend; não chega à interface. `AbortSignal.timeout` limita a rede. A chave de idempotência vem do UUID interno do desafio. Não há repetição automática de envios. Falha invalida o desafio e registra metadados seguros; a resposta pública permanece genérica.

O frontend muda para o formulário de código em qualquer 202. Isso não prova que a conta existe ou que o e-mail foi entregue. O cronômetro usa `resendAfterSeconds` informado pela API. O backend é quem efetivamente impõe o cooldown.

## Redefinição, passo a passo

`Authentication.submit` no estado reset → `api.resetPassword` → `recoveryResetSchema` → `AuthService.reset` → `AuthRepository.reset`.

No lock de cliente, o repository procura o desafio não consumido. Verifica validade e tentativas, e solicita ao serviço a comparação HMAC com `timingSafeEqual`. Um código incorreto incrementa as tentativas e retorna false; o erro público é lançado **depois** da transação para não desfazer esse incremento.

Um código correto é consumido junto com atualização de hash, data, versão e comprovação do e-mail, mais revogação de todas as sessões. Essa atomicidade impede que duas chamadas consumam o mesmo desafio. O controller remove o cookie e retorna 204. A interface limpa código/senhas/CSRF e volta ao login; não autentica automaticamente.

## Validação, service e repository na prática

- DTO/Zod decide se o formato pode entrar: campos, limites e senhas iguais. Não escolhe se uma conta pode acessar pedidos.
- Controller traduz HTTP: valida, lê contexto confiável, chama service, escreve cookie/status.
- Service decide o fluxo: verificar senha, aplicar limites, gerar código, pedir envio, definir resposta genérica.
- Repository garante operações persistidas: constraint, lock, contador e transação. Algumas regras ficam na transação porque dependem de leitura e escrita atômicas.
- Middleware decide origem/JSON/sessão/CSRF. Não recebe customerId livre como prova de identidade.
- Integração externa conhece HTTP do fornecedor; pode ser substituída por um mock que implementa `EmailClient`.
- Prisma models definem estrutura/relacionamentos; SQL da migration acrescenta o índice parcial e os checks necessários.

## Como depurar no VS Code

1. Execute `npm run dev` na raiz e abra o frontend no mesmo hostname da API.
2. Use um terminal JavaScript Debug Terminal do VS Code para iniciar o backend, ou anexe ao processo Node. Os source maps do ambiente TypeScript/tsx permitem breakpoints nos `.ts`.
3. No cadastro, pare em `registerCustomerSchema.parse` no controller, `hashPassword` no service e `repository.register` antes do nested write.
4. No login, pare em `AuthService.login` antes de `verifyPassword` e em `issueSession` após o `SELECT ... FOR UPDATE`. Observe apenas customerId, versão e expiração; não copie senha/hash/token para o Debug Console.
5. Na recuperação, pare antes de `newChallenge` e na entrada de `sendRecovery`. Para estudar sem envio real, use o teste com e-mail simulado; não adicione logs ou endpoints de códigos.
6. No reset, pare nos ramos de tentativa incorreta e consumo. Execute os testes de concorrência separadamente para acompanhar o lock; pausar transações por muito tempo pode provocar timeout legítimo.
7. No navegador, acompanhe `Authentication.submit`, `requestCode` e `useSupport.login`. Na aba Network observe método, URL e status; não compartilhe capturas de payloads que contenham senha/código.
8. Para estudar concorrência, leia `apps/api/tests/integration/auth.test.ts`. Para migration, leia `migration-auth.test.ts`. Para navegação, leia `apps/web/src/components/authentication.test.tsx`.

Não coloque código/token/senha no localStorage, histórico do chat, prompts, screenshots ou logs. Mensagens de suporte continuam passando pelo orquestrador existente: a autenticação apenas estabelece quem é o cliente; o backend de pedidos continua decidindo titularidade e cancelamento.
