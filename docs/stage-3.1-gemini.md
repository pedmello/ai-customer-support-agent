# Etapa 3.1 — Provedores OpenAI e Gemini

> Documento com resultados históricos por rodada. Contrato atual: [funcionamento atual](current-behavior.md) e [planos coletivos](collective-query-plans.md). Falhas oferecem atendimento, sem registro automático.

**Estado atualizado após revisão pontual: validação real ponta a ponta concluída.** Os seis cenários solicitados passaram com Gemini real, e a Fake Store respondeu normalmente. O 504 anterior foi localizado na comunicação HTTPS de saída, sem evidência suficiente para distinguir serviço Gemini de gateway externo. Veja a revisão final ao fim deste documento; as seções anteriores preservam o histórico das verificações.

## Estado e configuração local

Na inspeção inicial deste checkout existia somente o adaptador OpenAI. Foram acrescentados o SDK oficial Google Gen AI, um adaptador Gemini e a seleção explícita de provedor. O contrato HTTP, os modelos Prisma, as migrations, o frontend, a autorização e as regras de cancelamento permanecem os mesmos.

Arquivo local para inserir a chave: `C:\Users\Adm\Desktop\Teste\ai-customer-support-agent\.env`. Ele foi criado a partir de `.env.example`, com a chave vazia.

```dotenv
AI_PROVIDER=gemini
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.5-flash-lite
GEMINI_TIMEOUT_MS=10000
```

O exemplo seleciona Gemini para a demonstração. O default do validador, quando AI_PROVIDER está ausente, continua `openai` para preservar instalações anteriores executadas no host. No Docker Compose, a variável ausente resulta em `gemini`, alinhado ao `.env.example`. Para voltar ao provedor alternativo, use `AI_PROVIDER=openai` e configure OPENAI_API_KEY/OPENAI_MODEL. Não há fallback automático entre empresas: isso evita enviar dados a um provedor diferente do selecionado sem uma decisão explícita.

`apps/api/src/config/env.ts` resolve `../../../../.env` a partir do próprio módulo, tanto em `src/config` quanto em `dist/config`. Portanto, lê o `.env` da raiz independentemente do diretório atual. `dotenv` não sobrescreve variáveis já presentes no processo.

O Docker Compose usa o `.env` da raiz para interpolar `compose.yaml`. O serviço `api` recebe explicitamente as variáveis dos provedores em `environment`; o `.env` não é copiado para a imagem. O frontend recebe somente VITE_API_URL. Um `--env-file` explícito ou variáveis exportadas no shell podem mudar a configuração efetiva. Evite executar `docker compose config` sem `--quiet`, pois a saída completa contém segredos interpolados.

`.gitignore` ignora `.env` e `.env.*`, exceto `.env.example`; `.dockerignore` tem a mesma proteção. `git check-ignore .env` confirmou a exclusão e `git ls-files .env` não encontrou arquivo rastreado. Isso protege o fluxo normal de Git; não use `git add -f .env`.

## Modelo e fontes oficiais

Consulta em 19/10/2026. O [catálogo oficial](https://ai.google.dev/gemini-api/docs/models) lista, para texto, Gemini 3.8 Flash, 3.6 Flash, 3.5 Flash-Lite e 3.1 Flash-Lite estáveis; Gemini 3 Flash está em preview. A família 2.5 ainda aparece, mas com acesso restrito a usuários anteriores: não é uma escolha adequada para um novo projeto. Modelos de áudio/imagem não são necessários aqui.

Escolha: **`gemini-3.5-flash-lite`**, identificador estável oficial, voltado a baixa latência e tarefas simples. É uma escolha de engenharia para classificar intenções curtas, não uma alegação de superioridade medida em benchmark deste projeto. O agente continua produzindo fatos e resultados das operações de forma determinística.

A [tabela de preços](https://ai.google.dev/gemini-api/docs/pricing.md) informa nível gratuito para entrada e saída de 3.8 Flash, 3.6 Flash, 3.5 Flash-Lite e 3.1 Flash-Lite. Gratuidade depende das cotas, região, projeto e condições da conta; possuir uma chave não garante cota disponível nem impede cobrança em um projeto pago. O nível gratuito pode usar conteúdo para melhorar produtos do Google: use somente dados fictícios nesta demonstração.

O [guia de saídas estruturadas](https://ai.google.dev/gemini-api/docs/generate-content/structured-output) inclui 3.5 Flash-Lite entre os modelos com JSON Schema. SDK oficial instalado: **`@google/genai` 2.30.0**, fixado no package-lock, compatível com Node 24. A versão foi conferida no [repositório oficial](https://github.com/googleapis/js-genai). O método `models.generateContent` permanece disponível; o Google o documenta atualmente na seção Generate Content (Legacy). Não usamos armazenamento de contexto em Interactions nem ferramentas com execução automática.

## Mapa didático dos arquivos

Leia nesta ordem, após o [guia do agente](code-walkthrough-stage-3.md):

| Arquivo dentro do projeto                           | Responsabilidade e comunicação                                                                                                                                    |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.env` / `.env.example`                             | Configuração local secreta e exemplo público sem chave. Não são código executável.                                                                                |
| `apps/api/src/config/env.ts`                        | Carrega o arquivo local e chama parseEnv. Usado por server.ts.                                                                                                    |
| `apps/api/src/config/env-schema.ts`                 | parseEnv valida AI_PROVIDER, modelos e timeouts com Zod. Erros exibem somente nomes dos campos.                                                                   |
| `apps/api/src/integrations/ai/intent-model.ts`      | Define IntentModel.interpret, ModelInput, AgentIntent, intentSchema e AiFailure. É o contrato comum, sem SDK nem acesso ao banco.                                 |
| `apps/api/src/integrations/ai/model.factory.ts`     | createIntentModel escolhe exatamente um adaptador conforme AI_PROVIDER. Recebe configuração e logger de server.ts.                                                |
| `apps/api/src/integrations/gemini/gemini.client.ts` | createGeminiModel implementa interpret usando GoogleGenAI.models.generateContent. Converte falhas externas nos mesmos códigos internos já conhecidos pelo agente. |
| `apps/api/src/integrations/openai/openai.client.ts` | createOpenAiModel continua usando Responses/Structured Outputs. Reexporta os tipos antigos para preservar imports existentes.                                     |
| `apps/api/src/integrations/openai/agent.prompt.ts`  | AGENT_SYSTEM_PROMPT é compartilhado pelos dois adaptadores, sem alterações. O texto integral permanece documentado em stage-3.md.                                 |
| `apps/api/src/server.ts`                            | Monta a aplicação: chama a factory e injeta o modelo no agente, junto com os outros serviços.                                                                     |
| `apps/api/src/modules/agent/agent.orchestrator.ts`  | send → plan → interpret → execute. Usa o contrato comum, não precisa conhecer SDKs. Mantém sessão, titularidade, estado e confirmação no backend.                 |
| `apps/api/src/modules/agent/agent.safety.ts`        | explicitDecision exige frase e desafio atuais; resolveOrderId impede IDs inventados; redactSensitive agora reconhece também o formato usual de chave Google.      |
| `apps/api/src/config/logger.ts`                     | createLogger remove GEMINI_API_KEY de campos estruturados, além dos segredos já protegidos. O adaptador não registra erros brutos do SDK.                         |
| `compose.yaml`                                      | Repassa somente ao backend a escolha de provedor e a chave. Volume e portas continuam iguais.                                                                     |
| `apps/api/tests/gemini.test.ts`                     | Respostas controladas do SDK, validação de JSON, bloqueios, falhas, seleção de provedor e ausência de chave. Não chama APIs externas.                             |
| `apps/api/tests/agent-safety.test.ts`               | Acrescenta verificação de remoção de chaves Google fictícias.                                                                                                     |

### Como ocorre uma chamada

1. `server.ts` carrega env e chama `createIntentModel(env, logger)`.
2. A factory chama `createGeminiModel` se AI_PROVIDER=gemini. Sem chave, interpret retorna AI_UNAVAILABLE sem construir SDK nem fazer rede.
3. Uma requisição de mensagem atravessa as rotas/middlewares/controllers existentes e chega a `agent.orchestrator.ts`, método `send`.
4. `plan` remove dados sensíveis, limita o histórico e chama `model.interpret`.
5. O adaptador envia AGENT_SYSTEM_PROMPT em `systemInstruction`. Histórico e mensagem atual ficam em um objeto JSON no conteúdo de usuário, como dados não confiáveis.
6. `z.toJSONSchema(providerIntentSchema, { target: 'draft-7' })` gera o schema enviado em `responseJsonSchema`; `responseMimeType` exige JSON. Não existem tools, nem acesso do modelo ao PostgreSQL.
7. Ao receber a resposta, interpret exige uma candidata com finishReason=STOP, sem bloqueio e com texto. `JSON.parse` transforma texto em objeto; `providerIntentSchema.safeParse` valida campos, enums e rejeita propriedades extras. JSON Schema orienta o provedor; Zod verifica novamente dentro da aplicação.
8. O orquestrador valida a intenção novamente e chama os serviços de domínio. Somente esses serviços autorizam consultas ou alterações.

Limites Gemini: 1024 tokens de saída, uma candidata e prazo total de 10 segundos por padrão (30 segundos no `.env` local usado na validação). Após a revisão, somente HTTP 502/503/504 permitem uma repetição, após 250 ms e dentro do mesmo prazo total. O SDK permanece com uma tentativa própria, evitando multiplicação de retries. O AbortController compartilhado cancela a requisição no prazo; o timer é liberado em finally. Não há repetição em autenticação, cota/429, JSON inválido ou prazo total esgotado. A continuação automática do SDK fica desligada. Saídas incompletas, bloqueadas ou inválidas viram AI_INVALID_RESPONSE; timeout local e HTTP 408/504 viram AI_TIMEOUT; as demais falhas preservam AI_UNAVAILABLE. A causa externa bruta não é devolvida nem registrada. O encaminhamento humano continua simulado.

### Cancelamento continua independente da IA

REQUEST_CANCEL apenas prepara o desafio depois das verificações existentes. A mensagem seguinte precisa conter a frase exata `CONFIRMAR CANCELAMENTO` e o confirmationId vigente da mesma conversa. `plan` não chama modelo nesse caso; `execute` verifica prazo, titularidade, status e consome a confirmação. Uma intenção CONFIRM_CANCEL produzida pelo Gemini, sozinha, nunca cancela pedido. O endpoint REST direto foi preservado.

Para estudar no VS Code, coloque breakpoints em `createIntentModel`, `interpret` antes/depois de generateContent, na variável `parsed` e em `agent.orchestrator.ts` nos métodos plan/execute. Inspecione códigos e intenções, evitando expandir objetos SDK/configuração que contêm a chave ou copiar depurações com dados sensíveis.

## Protocolo de validação real

Na preparação inicial, nenhuma chamada real havia sido realizada. O usuário posteriormente inseriu a chave e autorizou os testes. Os resultados reais estão registrados na seção final deste documento; build e mocks, isoladamente, não comprovam integração externa.

Após inserir a chave no editor, confirme no chat apenas que ela foi configurada e autorize o teste. Não envie o valor. Na continuação, recriar somente a API com o novo código/configuração:

```powershell
docker compose up -d --build --no-deps api
```

Reiniciar um container antigo sem recriar não recarrega as variáveis. Na validação autorizada, somente a API foi reconstruída e recriada; frontend e PostgreSQL foram preservados.

Plano econômico de validação real, com dados fictícios: uma consulta de pedido, uma solicitação de cancelamento e uma mensagem fora do escopo, total inicial de três chamadas ao modelo. Confirmar o cancelamento e repetir a mesma mensagem com clientMessageId idêntico devem funcionar sem nova chamada ao modelo. Conferir JSON validado, resultado real do pedido e fallback seguro. Falhas de autenticação, cota, timeout e conteúdo inválido são testadas com mocks; não desperdiçar chamadas reais provocando esses erros.

No Swagger/Postman, os endpoints e os cabeçalhos permanecem os mesmos: cadastrar cliente fictício, preservar cookie, enviar X-CSRF-Token, criar conversa e POST /conversations/:conversationId/messages com clientMessageId UUID novo. A chave Gemini nunca é enviada nessas requisições; é utilizada somente no servidor. Para confirmar, usar o confirmationId retornado na conversa e a frase exata.

Nenhuma migration foi criada ou executada, e nenhum dado do banco da aplicação foi alterado nesta preparação. Testes de integração usam exclusivamente o PostgreSQL separado terminado em `_test` e limpam apenas seus dados fictícios.

## Resultados da preparação

- `vitest run --root apps/api`: 79 testes passaram, incluindo 20 novos casos Gemini/configuração e um novo caso de remoção de chave Google.
- `vitest run --root apps/api --config vitest.integration.config.ts`: 67 testes passaram com PostgreSQL real dedicado; OpenAI/Gemini e Fake Store não foram chamados. A suíte existente verifica confirmação explícita, expiração, isolamento, concorrência, fora do escopo e falhas do provedor por respostas controladas.
- `npm run typecheck` e `npm run build`: passaram nos dois workspaces.
- `docker compose config --quiet`: passou. Os três serviços existentes estavam saudáveis; GET /health retornou HTTP 200. Esse healthcheck corresponde à imagem anterior já em execução, não comprova o adaptador novo.
- Importação da configuração do backend compilado: provider=gemini, model=gemini-3.5-flash-lite, timeout=10000 e chave ainda não configurada; nenhum segredo foi impresso.
- Instalação do SDK: auditoria npm reportou zero vulnerabilidades. `git diff --check` passou.
- Nenhuma chamada real Gemini, nenhuma migration e nenhuma operação de branch/commit/push.

Arquivos novos: `apps/api/src/integrations/ai/intent-model.ts`, `apps/api/src/integrations/ai/model.factory.ts`, `apps/api/src/integrations/gemini/gemini.client.ts`, `apps/api/tests/gemini.test.ts`, este documento e o `.env` local ignorado.

Arquivos alterados: `.env.example`, `README.md`, `compose.yaml`, `package-lock.json`, `apps/api/package.json`, `apps/api/src/config/env-schema.ts`, `apps/api/src/config/logger.ts`, `apps/api/src/integrations/openai/openai.client.ts`, `apps/api/src/modules/agent/agent.orchestrator.ts`, `apps/api/src/modules/agent/agent.safety.ts`, `apps/api/src/server.ts`, `apps/api/tests/agent-safety.test.ts`.

## Validação real autorizada — 19/10/2026

**Resultado parcial: credencial, acesso ao modelo e JSON estruturado comprovados; fluxo HTTP completo ainda não validado com sucesso.**

- O container da API foi reconstruído com o SDK instalado e recriado com AI_PROVIDER=gemini e GEMINI_MODEL=gemini-3.5-flash-lite. A chave foi detectada sem impressão do valor. Não houve fallback para OpenAI.
- `models.get` respondeu com sucesso, identificando `models/gemini-3.5-flash-lite` e suporte a generateContent.
- Duas chamadas reais a `models.generateContent`, com o mesmo system prompt e JSON Schema usados pela aplicação, responderam com finishReason=STOP. O JSON foi validado por intentSchema e classificado como ORDER_STATUS para uma mensagem fictícia com UUID de pedido. Uma delas incluiu também o AbortSignal do adaptador; durou aproximadamente 25 segundos. Isso comprova autenticação e compatibilidade da saída estruturada, mas não comprova todos os fluxos do orquestrador.
- As três tentativas de consulta pelo endpoint de mensagens da API terminaram em fallback seguro: uma AI_TIMEOUT e duas AI_UNAVAILABLE, todas com HTTP 200, conforme o contrato conversacional. Os pedidos fictícios permaneceram sem cancelamento. A proteção CSRF foi verificada antes dessas chamadas e rejeitou as requisições sem cabeçalho com HTTP 403.
- Os diagnósticos adicionais do adaptador reproduziram indisponibilidade/timeout. A última captura do transporte recebeu **HTTP 504** na chamada ao provedor. A causa raiz do 504 não pôde ser determinada nesta execução; não foi confirmado erro de chave, schema ou cota. As respostas bem-sucedidas impedem classificar a chave como inválida.
- Foram feitas oito tentativas de geração ao todo, incluindo os diagnósticos, e uma consulta de metadados. Duas gerações tiveram sucesso. Não foram habilitados retries automáticos, nem feitas novas tentativas após identificar o 504. Não se afirma consumo/custo zero para requisições que falharam ou expiraram.
- GEMINI_TIMEOUT_MS foi ampliado somente no `.env` local, de 10000 para **30000**, e a API foi recriada com esse valor. O limite geral aceito pela aplicação foi preservado; o exemplo público permanece com 10000.
- Solicitação de cancelamento, confirmação e fora do escopo **não chegaram a ser executados com Gemini real**, pois o roteiro interrompeu cada tentativa na primeira consulta mal sucedida para limitar requisições. As proteções desses fluxos continuam cobertas pelos testes simulados existentes; isso não equivale à validação real do modelo nesses cenários.
- Foram criados três clientes fictícios isolados para os smoke tests. Cada um foi removido no finally pelo e-mail aleatório exclusivo e customerId correspondente, incluindo apenas seus próprios registros dependentes. Não houve migration, reset ou alteração de dados anteriores.
- Os 24 testes focados (`gemini.test.ts` e `agent-safety.test.ts`) passaram novamente nesta execução, sem chamadas externas. Build da API dentro do Docker também passou. Os 79 testes unitários e 67 testes de integração completos passaram na preparação anterior; não foram todos repetidos nesta execução, pois não houve mudança no código da aplicação.

Naquela execução ficou pendente repetir o fluxo completo. Essa pendência foi resolvida na revisão abaixo; nenhum commit/push foi realizado.

## Revisão pontual final — 19/10/2026

### Diagnóstico e limites da conclusão

O HTTP 504 anterior foi capturado na resposta HTTPS de saída para o SDK Gemini, não na resposta HTTP da aplicação. O orquestrador converte falhas da IA em turno persistido e resposta conversacional HTTP 200 com código de falha. No fluxo atual, isso oferece atendimento humano sem registrar encaminhamento automaticamente. Não existe código que gere 504 nesse caminho. O serviço web Nginx não participa dessa chamada: o teste acessa diretamente a API Express na porta 3000.

No container, DNS para generativelanguage.googleapis.com resolveu IPv4. Não havia HTTP_PROXY, HTTPS_PROXY, ALL_PROXY ou NODE_USE_ENV_PROXY configurados. O Compose mantém a rede bridge padrão, sem proxy de saída próprio. A consulta autenticada de metadados levou 418 ms e confirmou `models/gemini-3.5-flash-lite` com generateContent. O suporte a JSON Schema foi conferido no [guia oficial](https://ai.google.dev/gemini-api/docs/generate-content/structured-output) e comprovado pelos cinco resultados reais validados pelo Zod nesta rodada.

**Origem comprovada: fronteira HTTPS externa. Origem interna exata: indeterminada.** Não há evidência preservada suficiente para distinguir timeout dentro do serviço Google de um gateway externo no trajeto. Saúde do Docker e DNS funcionando não excluem toda falha transitória de rede. Não foi observado 504 nesta revisão, portanto não há correlação de headers/códigos do upstream que permita uma conclusão mais específica. Também não há evidência de chave inválida, schema incompatível ou cota excedida. A [documentação de troubleshooting](https://ai.google.dev/gemini-api/docs/troubleshooting) trata 504 como deadline excedido; essa classificação não identifica qual intermediário respondeu.

Comparação dos caminhos: a chamada direta anterior e o agente usam o mesmo modelo, system prompt, JSON Schema, limite de tokens e SDK. No agente, `plan` acrescenta histórico limitado e sanitizado. A consulta inicial tem histórico vazio, portanto essa diferença não explica sozinha a falha inicial. Não existe laço de ferramentas ou múltiplas inferências em plan. A consulta externa ocorre antes da transação de `finish`; os 10 segundos de timeout da transação Prisma não limitam a chamada Gemini. A lease de conversa tem 120 segundos, acima do prazo máximo de 30 segundos da inferência, mais os até 5 segundos da consulta paralela de produtos. Confirmações e mensagens concluídas repetidas desviam do modelo antes de qualquer inferência.

Os cinco sucessos desta revisão ocorreram na **primeira tentativa**, com 815–1170 ms no adaptador. Portanto, não se atribui a recuperação observada ao retry nem ao aumento anterior do timeout. A hipótese de indisponibilidade externa transitória é compatível com os resultados, mas não foi comprovada uma causa interna do provedor. O timeout local foi mantido em 30000 ms, sem novo aumento.

### Correções e funções alteradas

Foram alterados nesta revisão somente:

- `apps/api/src/integrations/gemini/gemini.client.ts`;
- `apps/api/tests/gemini.test.ts`;
- `README.md`;
- `docs/stage-3.1-gemini.md`.

`classifyFailure(error, aborted)` é uma função nova dentro do client. Extrai apenas status HTTP inteiro entre 400 e 599, nunca mensagem/corpo/header do erro. Distingue DEADLINE, PROVIDER_TIMEOUT, RATE_LIMIT, AUTHORIZATION, PROVIDER_HTTP, NETWORK_OR_SDK e INVALID_RESPONSE. HTTP 504 agora é AI_TIMEOUT; antes era AI_UNAVAILABLE genérico.

`createGeminiModel().interpret(input)` mantém o contrato IntentModel e agora:

1. Cria um AbortController e um único timer para o prazo total da interpretação.
2. Chama generateContent com o mesmo schema e dados já utilizados; o SDK fica com retries próprios desabilitados.
3. Em sucesso, valida STOP, JSON e intentSchema; registra somente provider, model, attempt, durationMs, totalDurationMs e category=SUCCESS.
4. Em falha, chama classifyFailure e registra os mesmos campos seguros, mais code, status quando disponível e retry. Nunca registra chave, cookies, IDs de clientes, conteúdo, histórico, headers ou erro bruto.
5. Para 502/503/504, permite no máximo mais uma inferência após 250 ms, se ainda houver prazo. O AbortSignal é compartilhado, portanto a segunda tentativa não ganha mais 30 segundos. Não há retry de erro 429, autenticação, validação ou cancelamento por deadline.
6. Libera o timer em finally. Depois do erro final, o orquestrador continua usando o fallback persistido existente.

Fluxo para estudo: `send` → `plan` → `IntentModel.interpret` → `createGeminiModel().interpret` → SDK → JSON.parse → intentSchema.safeParse → `execute`. A repetição está inteiramente dentro de interpret, antes de execute. Não envolve mainOrders.cancel, transação, persistência de turno ou confirmação. Não foi introduzido circuit breaker nem retry de mutações. Routes/controllers, DTOs, orquestrador e serviços de pedidos não precisaram de alteração.

No VS Code, use breakpoints na criação de controller/deadline, antes de generateContent, em classifyFailure, no cálculo de retry e em safeParse. Em seguida acompanhe execute no orquestrador. Inspecione metadados seguros e evite expandir o cliente SDK, headers e configuração secreta.

### Testes automatizados

Os testes novos foram executados antes da correção: cinco casos falharam reproduzindo classificação incorreta de 504 e ausência da repetição limitada. Após a correção:

| Verificação                                          | Resultado                                        |
| ---------------------------------------------------- | ------------------------------------------------ |
| gemini.test.ts, incluindo configuração               | 31 testes passaram; 11 casos novos nesta revisão |
| Suíte unitária completa                              | 90 testes passaram                               |
| Integração Express/Supertest com PostgreSQL dedicado | 67 testes passaram                               |
| Typecheck da API                                     | passou                                           |
| Build da API dentro do Docker                        | passou                                           |

Novos casos cobrem classificação 504, logs sem segredos, recuperação de 502/503/504, máximo de duas tentativas, ausência de retry em 400/401/403/429 e JSON inválido, cancelamento no prazo e prazo total compartilhado. O teste de 504 persistente comprova o limite de duas chamadas e o erro final. Todas as falhas/repetições foram simuladas; não foram provocadas falhas reais nem gasto de cota para esse fim. A suíte de integração preserva cobertura de concorrência, uso único/expiração de confirmação, isolamento, idempotência, rollback e fallback. Total: **157 testes**, com APIs externas simuladas.

### Resultados reais pela API em Docker

Foram criados dois clientes com e-mails aleatórios exclusivos terminados em example.test. Cookie HttpOnly e X-CSRF-Token foram usados normalmente, sem imprimir valores. Nenhum dado pré-existente foi alterado. Foram enviadas exatamente cinco mensagens que exigem inferência; os logs da API mostram cinco eventos SUCCESS, todos attempt=1, sem retry.

| Cenário                                | Resultado real                                                   | HTTP/API ms |   Gemini ms |
| -------------------------------------- | ---------------------------------------------------------------- | ----------: | ----------: |
| Consultar PROCESSING                   | ORDER_STATUS, titular e status corretos                          |        1260 |        1170 |
| Solicitar cancelamento PROCESSING      | CONFIRMATION_REQUIRED; pedido continuou PROCESSING no PostgreSQL |         967 |         926 |
| Confirmar com frase e desafio vigentes | ORDER_CANCELLED; alteração persistida                            |          40 | sem chamada |
| Consultar novamente após confirmar     | ORDER_STATUS com CANCELLED, confirmado também no PostgreSQL      |        1153 |        1107 |
| Solicitar cancelamento SHIPPED         | ORDER_NOT_CANCELLABLE; PostgreSQL continuou SHIPPED              |         940 |         911 |
| Mensagem fora do escopo                | OUT_OF_SCOPE com encaminhamento humano simulated=true            |         869 |         815 |

Verificações adicionais reais, sem inferência:

- Outra sessão não acessou a conversa: 404.
- Escrita sem X-CSRF-Token: 403.
- Desafio de outra conversa: CONFIRMATION_INVALID, 25 ms.
- Confirmação ambígua com desafio correto: CONFIRMATION_INVALID, 32 ms.
- Repetição da confirmação com mesmo clientMessageId: resposta idêntica, 12 ms, sem nova operação.
- Tentativa de reutilizar o desafio consumido com nova mensagem: CONFIRMATION_INVALID, 25 ms.
- Pedido permaneceu PROCESSING até a confirmação explícita válida.

Fake Store foi testada pelo client real dentro do mesmo container: produto 1 AVAILABLE em 937 ms, validado e sem preço externo no resultado. Não se fez uma sexta inferência para consultar produtos; essa chamada comprova o adaptador HTTP externo, enquanto o fluxo de enriquecimento do agente permanece coberto pelos testes de integração simulados.

Ao final, foram excluídos somente os dois clientes exclusivos desta revisão e seus registros dependentes, filtrando por e-mail exclusivo e customerId. Nenhuma migration/reset foi executada. Os três serviços continuaram saudáveis; frontend e PostgreSQL não foram recriados. O roteiro temporário de smoke foi removido.

### Conclusão e limitações

**Etapa 3.1 pronta para revisão manual e para iniciar a Etapa 4 quando solicitado.** Nenhuma implementação da Etapa 4 foi realizada. Não houve branch, commit ou push.

O nível gratuito continua sujeito a cotas e capacidade, sem garantia de latência/disponibilidade. Esta rodada não retornou 429 e não mede capacidade sustentada ou custo. Timeout não garante que o processamento remoto deixe de consumir cota, e uma repetição pode consumir outra inferência. Por isso o limite é uma repetição somente de inferência e sem repetir operações de negócio. O sucesso desta amostra não garante ausência de futuros 504; agora eles têm classificação e metadados suficientes para investigação sem vazamento de informações sensíveis.
