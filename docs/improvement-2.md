# Implementação 2 — Cadastro, login e recuperação

> Registro da implementação original. Veja [funcionamento atual](current-behavior.md). Pendências e resultados abaixo se referem àquela rodada, não ao ambiente de cada avaliador.

## Escopo e compatibilidade

Cadastro com senha e confirmação, login, logout e recuperação por código enviado via Resend. Pedidos continuam fictícios. Cadastro não verifica posse do e-mail; apenas uma recuperação bem-sucedida registra `emailVerifiedAt`. Contas antigas foram preservadas, sem senha inventada, exclusão ou alteração de pedidos/conversas. Para ativá-las, o proprietário precisa receber e apresentar um código válido.

A mudança intencional de contrato é `POST /customers`: agora exige `password` e `passwordConfirmation`. O restante do atendimento mantém seus contratos, números públicos, valores históricos USD/novos BRL, catálogo, CSRF, idempotência e confirmação de cancelamento. Não há chamada direta de cancelamento no frontend.

## Persistência e migration

Migration aditiva: `apps/api/prisma/migrations/202610210001_password_authentication/migration.sql`.

- `Customer.passwordHash`: nullable para compatibilidade com contas legadas; Argon2id para novos cadastros.
- `Customer.passwordChangedAt`: data da definição mais recente de credenciais.
- `Customer.emailVerifiedAt`: null no cadastro; preenchida após comprovação pelo código.
- `Customer.credentialVersion`: incrementada em cada redefinição.
- `Session.credentialVersion`: versão no momento de emissão. Toda leitura autenticada compara com a versão atual.
- `PasswordResetChallenge`: UUID interno, cliente, verificador HMAC, tentativas, criação, expiração e consumo. Nunca código bruto.
- `AuthRateLimit`: chave SHA-256 por escopo/identidade/janela, contador atômico e expiração. Não armazena IP/e-mail em texto puro.

Chaves estrangeiras e UUIDs anteriores permanecem. Há índices por cliente/data, expiração e um índice parcial que permite apenas um desafio não consumido por cliente. As views administrativas anteriores permanecem sem campos de credenciais.

Sessões legadas permanecem fisicamente no banco, mas não autorizam acesso enquanto a conta não tiver senha. Após recuperação, todas as sessões anteriores são revogadas. Faça a atualização conjunta de API e frontend, sem manter servidores antigos atendendo durante a mudança de autenticação.

Foi criado backup completo em `.temp/support-improvement-2.dump`, ignorado pelo Git/Docker. Com a API pausada, `apps/api/scripts/verify-auth-migration.ts before/after` comparou contagens e fingerprints dos campos preexistentes em oito tabelas. Todos foram preservados. A migration foi aplicada nos bancos principal e de testes, sem reset.

## Contratos HTTP

| Método e rota | Entrada | Resultado |
| --- | --- | --- |
| `POST /customers` | `name`, `email`, `password`, `passwordConfirmation` | 201, cookie HttpOnly, cliente público, expiração e CSRF; seis pedidos em transação na versão atual, sem alterar contas anteriores |
| `POST /sessions` | `email`, `password` | 201, nova sessão; nenhum pedido adicional |
| `GET /sessions/current` | cookie | 200, cliente público, expiração e CSRF |
| `DELETE /sessions/current` | cookie e CSRF | 204, revogação da sessão atual |
| `POST /password-recovery/request` | `email` | 202 genérico com `message` e `resendAfterSeconds`; nenhum código |
| `POST /password-recovery/reset` | `email`, `code`, `password`, `passwordConfirmation` | 204, revoga todas as sessões; retorno ao login |

Todos os POSTs exigem JSON e passam pela validação de origem existente. Recuperação é pública; quando há cookie de sessão **ativa**, também exige o CSRF dessa sessão. Cookies expirados/legados não impedem a recuperação. Sem cookie, JSON e a política de origem protegem contra submissões cross-site no navegador. Postman permanece compatível sem `Origin`; não há bypass de sessão ou CSRF nas operações autenticadas.

Erros públicos seguem `{ "error": { "code": "...", "message": "..." } }`:

- 400 `VALIDATION_ERROR` ou `PASSWORD_RESET_INVALID` (inexistente/incorreto/expirado/consumido/bloqueado são indistinguíveis).
- 401 `INVALID_CREDENTIALS`: senha errada, usuário inexistente e conta legada têm a mesma resposta, sem cookie.
- 409 `EMAIL_ALREADY_REGISTERED`: cadastro duplicado não concede acesso.
- 429 `AUTH_RATE_LIMITED`: limite de abuso atingido.
- Demais falhas reutilizam o handler central, sem detalhes de banco ou fornecedor.

## Senhas, concorrência e limites

Senha de 12–128 unidades de comprimento JavaScript, sem trim, normalização ou truncamento. Não há exigência artificial de tipos de caracteres. Nome/e-mail continuam normalizados independentemente. Argon2id usa memória 19456 KiB, duas iterações, paralelismo 1 e salt aleatório da biblioteca. O login de conta inexistente/legada executa verificação contra hash fictício para reduzir diferenças evidentes de tempo.

Login verifica a senha e depois bloqueia a linha de cliente (`FOR UPDATE`) para conferir novamente hash e versão antes de criar a sessão. A redefinição usa o mesmo bloqueio. Se login vencer, sua sessão será revogada pelo reset; se reset vencer, a verificação antiga não poderá emitir sessão. O middleware também compara versões em toda autenticação. Isso não desfaz uma operação já autorizada e em execução antes da redefinição.

O código é gerado com `crypto.randomInt`, tem oito dígitos (incluindo zeros iniciais), validade padrão de dez minutos e no máximo cinco erros. O verificador é HMAC-SHA256 de domínio + customerId + challengeId + código, usando segredo exclusivo do backend. A comparação usa `timingSafeEqual`.

Novo código invalida o anterior; reenvio exige 60s por padrão. O bloqueio de cliente serializa criação e consumo. Erro de código incrementa tentativas em uma transação que **é confirmada**; lançar a exceção antes do commit desfaria a proteção. Sucesso consome o desafio, atualiza senha/versão/e-mail verificado e revoga sessões na mesma transação.

| Operação | Conta | Origem (IP visto pelo Express) | Janela |
| --- | --- | --- | --- |
| Cadastro | e-mail único no banco | 20 | 15 minutos |
| Login | 10 | 50 | 15 minutos |
| Solicitar código | 5, com resposta 202 genérica | 30 | 1 hora |
| Redefinir | 20 | 50 | 15 minutos |

São janelas fixas persistidas, independentes da existência da conta; os limites não são zerados no login. Requisições durante cooldown também contam. `trust proxy` permanece desabilitado: não se confia em `X-Forwarded-For`. No Docker/NAT, vários clientes podem compartilhar a origem; revisar proxy confiável somente no contexto de uma implantação real.

Solicitar recuperação espera pelo menos `EMAIL_TIMEOUT_MS + 100ms` em todas as respostas normais. Redefinir espera pelo menos 250ms, incluindo falhas. Isso reduz diferenças triviais, sem prometer tempo constante sob carga/falhas do banco. Falha do Resend invalida o desafio, mantém resposta genérica e registra apenas categoria/duração/status. Não há retry automático de e-mail nem fila durável; se houver interrupção entre gravação e envio, solicite novamente após o cooldown.

## Configuração real do Resend

O backend local carrega **o `.env` da raiz** por caminho absoluto em `apps/api/src/config/env.ts`; o Compose lê esse arquivo para interpolação e repassa explicitamente as variáveis à API. Não configure segredos em `apps/web` nem com prefixo `VITE_`.

1. Crie uma chave de envio no Resend, com permissão restrita quando possível.
2. Configure e verifique um domínio/remetente sob seu controle no painel. Siga os registros DNS pedidos pelo provedor. O remetente de teste do Resend possui restrições de destinatários; não substitui domínio verificado para utilização geral.
3. No `.env` local, configure:

```dotenv
EMAIL_PROVIDER=resend
EMAIL_FROM=suporte@seu-dominio.example
RESEND_API_KEY=
PASSWORD_RESET_HMAC_SECRET=
EMAIL_TIMEOUT_MS=3000
PASSWORD_RESET_TTL_SECONDS=600
PASSWORD_RESET_MAX_ATTEMPTS=5
PASSWORD_RESET_RESEND_SECONDS=60
```

Preencha chave e segredo apenas localmente. O segredo HMAC deve ser aleatório, exclusivo e ter no mínimo 32 caracteres. Para gerar diretamente no `.env`, **somente se a variável ainda não estiver preenchida**, use na raiz (não imprime o segredo):

```powershell
node -e "const fs=require('node:fs');const p='.env';let s=fs.readFileSync(p,'utf8');if(/^PASSWORD_RESET_HMAC_SECRET=.+$/m.test(s))throw Error('Segredo ja configurado');s=s.replace(/^PASSWORD_RESET_HMAC_SECRET=.*\r?\n?/m,'');fs.writeFileSync(p,s+'\nPASSWORD_RESET_HMAC_SECRET='+require('node:crypto').randomBytes(32).toString('hex')+'\n')"
```

4. Recrie a API: `docker compose up --build -d --wait api web` (ou reinicie o processo local).
5. Cadastre uma conta com caixa de e-mail sob seu controle, faça logout, peça um código pela interface e use o e-mail recebido. Verifique a senha antiga recusada, a nova aceita e as sessões anteriores revogadas.

Nesta execução, as variáveis ausentes foram acrescentadas ao `.env` local sem substituir as configurações existentes. Um segredo HMAC aleatório foi gerado diretamente nesse arquivo, sem impressão ou versionamento. Permanecem pendentes `RESEND_API_KEY`, `EMAIL_FROM` e a mudança de `EMAIL_PROVIDER=disabled` para `resend` após verificar o remetente.

Sem configuração, `EMAIL_PROVIDER=disabled` mantém cadastro e login operantes. A solicitação de recuperação continua genérica e não envia e-mail. Configuração incompleta com `resend` impede inicialização e informa somente nomes das variáveis inválidas.

O client chama a API HTTPS oficial com `fetch`, timeout e chave de idempotência por desafio, isolado pela interface `EmailClient`. Resposta de aceitação não comprova entrega na caixa; não implementamos webhook de entrega. Na rodada original, a entrega real ficou pendente. Posteriormente, o usuário confirmou recebimento do código via Resend e conclusão da redefinição pela interface. Esse relato não representa novo teste nesta revisão nem comprova sozinho todos os cenários de login/revogação. Cada avaliador configura suas próprias credenciais/remetente.

Fontes consultadas em 20/10/2026: [envio via API](https://resend.com/docs/api-reference/emails/send-email), [domínios verificados](https://resend.com/docs/dashboard/domains/introduction), [limites](https://resend.com/docs/knowledge-base/account-quotas-and-limits), [Argon2id/OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). Na documentação consultada, o plano gratuito transacional tinha 100 e-mails/dia e 3.000/mês, incluindo envios/recebimentos; confirme cotas no painel antes do uso.

## Testes e validação

Os testes unitários e de frontend não fazem chamadas externas. Testes de integração usam PostgreSQL real separado (`*_test`) e e-mail/IA/Fake Store simulados; testes de migration criam schemas exclusivos e removem somente os próprios fixtures.

| Objetivo | Cenário/condição | Resultado esperado |
| --- | --- | --- |
| Cadastro | senha válida, confirmação idêntica | hash Argon2id, sessão e exatamente seis pedidos na versão atual |
| Validação | ausente, curta, longa, confirmação diferente | 400, sem sessão |
| Duplicação | mesmo e-mail com caixa/espaços diferentes | 409, sem conceder acesso |
| Retorno | logout seguido de login | mesmos pedidos e conversas, sem novas compras |
| Credenciais | senha incorreta, conta ausente, legada | mesmo 401 genérico |
| Abuso | limites por conta e origem | 429 ou 202 genérico conforme contrato |
| Recuperação | conta válida, ausente, cooldown ou falha de envio | mesmo corpo 202, sem código |
| Armazenamento | código enviado ao mock | somente HMAC vinculado ao cliente/desafio no banco |
| Expiração | código expirado | erro genérico, senha anterior preservada |
| Tentativas | cinco erros, depois código correto | desafio inutilizado |
| Reenvio | antes/depois de 60s | bloqueio silencioso / substituição do código anterior |
| Concorrência | dois resets ou duas solicitações simultâneas | um consumo / um envio |
| Corrida login/reset | login pausado após verificação, reset confirmado | login antigo não emite sessão |
| Sessões | reset com vários cookies anteriores | todos recusados; comparação de versão independente da revogação |
| Legado | comprovação por e-mail | senha definida sem apagar histórico ou pedido USD |
| Navegador/CSRF | origem indevida, form-urlencoded, cookie ativo sem CSRF | rejeição segura |
| Frontend | mostrar senha, navegar, confirmar, recuperar, reenviar | validações, bloqueio de duplo envio, retorno ao login |
| Regressão | agente, confirmação, pedidos e isolamento | comportamentos anteriores preservados |

Comandos: `npm run typecheck`, `npm run build`, `npm test`, `npm run test:integration`, `npm run db:validate`, `npm run db:status`, `docker compose config --quiet`.

Resultados finais: **121 testes unitários/API + 40 testes frontend + 98 testes de integração PostgreSQL = 259 testes aprovados**. Typecheck e build dos dois workspaces passaram; Prisma validate/status e comparação schema/banco passaram sem divergências. `npm audit` informou zero vulnerabilidades. Docker Compose foi validado e os três serviços passaram nos healthchecks.

No navegador, cadastro e login reais retornaram 201; logout e retorno recuperaram os mesmos três números públicos e valores. O cadastro fictício exclusivo `Cliente browser melhoria 2` foi mantido no banco para inspeção; nenhum registro anterior foi removido. O fluxo de recuperação visual foi validado com interceptação HTTP simulada; o backend completo foi validado separadamente com e-mail simulado e PostgreSQL real. Não houve envio real Resend nem novas chamadas reais Gemini/OpenAI.

Login, cadastro, solicitação e redefinição foram medidos em 320, 360, 375, 390 e 1440px: vinte combinações sem overflow horizontal, com títulos visíveis. Capturas foram inspecionadas visualmente e mantidas somente em `.temp`, fora do Git. Console sem exceções JavaScript; a consulta inicial sem sessão retorna 401 esperado. O navegador precisou recarregar a página com URL sem cache para abandonar o bundle anterior ao rebuild.

Nunca rode testes de integração contra o banco principal.

## Limitações operacionais

- É um demonstrativo com senha; não inclui MFA, aprovação prévia do e-mail no cadastro ou painel de sessões.
- Contas antigas com e-mail fictício/inacessível permanecem preservadas, mas não podem ser ativadas sem comprovação. Não foi criado bypass administrativo.
- Não existe entrega real validada, fila durável ou webhook do Resend nesta entrega.
- Hashes, códigos HMAC e credenciais não aparecem nas views administrativas, na API pública, nos prompts ou nos logs.
- Contadores expirados e desafios consumidos continuam armazenados. Não foi executada limpeza de registros anteriores. Uma rotina futura pode remover apenas contadores já expirados e desafios após uma política explícita de retenção.
- A troca do segredo HMAC invalida os códigos pendentes; não altera senhas ou sessões.
