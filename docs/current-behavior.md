# Funcionamento atual do Support AI

Este documento consolida o contrato vigente após as correções da auditoria. Os documentos `stage-*` e `improvement-*` conservam o contexto e os resultados de cada entrega; contagens e limitações históricas não substituem este resumo nem o código atual.

## Regras confirmadas

- Cadastro: nome, e-mail normalizado, senha de 12–128 caracteres e confirmação. Argon2id, unicidade no PostgreSQL e criação transacional de cliente, sessão e **seis pedidos**, com seis produtos distintos, dois por status. Cadastro não verifica posse do e-mail.
- Login: e-mail e senha; reutiliza pedidos e conversas existentes, sem gerar novos pedidos. Sessão opaca em cookie HttpOnly, expiração, revogação e CSRF nas mutações. Nenhum token em localStorage.
- Recuperação: código numérico de oito dígitos enviado por Resend, verificador HMAC vinculado a cliente/desafio, dez minutos por padrão, até cinco tentativas e reenvio após sessenta segundos. Sucesso consome o código, troca a senha, incrementa credentialVersion, registra comprovação do e-mail e revoga sessões.
- Pedidos: UUID interno e número público único. Atendimento e interface usam `#10000`; `/orders/by-number/{orderNumber}` verifica titularidade. Rotas por UUID permanecem compatíveis.
- Somente PROCESSING pode ser cancelado. SHIPPED e CANCELLED não sofrem alteração. Atualização condicional inclui pedido, cliente e status.
- Cancelamento no agente exige pedido individual próprio, desafio atual da conversa, prazo, frase explícita e uso único. Só após sucesso e commit existe resposta ORDER_CANCELLED. A API REST direta mantém o contrato autorizado pelo chamador, sem desafio conversacional.
- Consultas coletivas são de leitura: listar, contar, verificar existência, produtos, totais e seleção por data/valor. Totais e rankings monetários separam moedas. Cancelamento em lote é recusado.
- Atendimento humano é oferecido, sem registro, em falhas/fora do escopo. Oferta exige consentimento contextual; pedido direto reconhecido já é explícito. Após registro, a resposta informa a simulação, sem equipe conectada ou contato agendado. Se a conversa já tem uma solicitação, novos pedidos de atendente recebem `HUMAN_REQUESTED` com o mesmo registro e o aviso de que nada novo foi registrado; não há nova oferta.

## Comportamento conversacional vigente

| Mensagem | Comportamento | Depende da IA? |
| --- | --- | --- |
| `Qual o status do pedido #10003?`, `Quero cancelar o pedido #10003`, `Quais os produtos do pedido #10003?` e variações próximas (botões do frontend incluídos) | Reconhecimento por modelos fixos (`simpleOrderRequest`); depois, titularidade, status e confirmação como antes | Não |
| `Quero cancelar meu pedido`, `Quero cancelar um dos meus pedidos` | `ORDER_ID_REQUIRED`: pergunta qual pedido cancelar, sem oferecer atendente | Não |
| `Cadê meu pedido?` | `ORDER_ID_REQUIRED`: pede o número; contexto anterior não é usado sem referência explícita | Não |
| `Tenho mais de um pedido?` | Responde com a quantidade real (`Sim, você tem 6 pedidos.`) | Não |
| `oi, tudo bem?` | Saudação curta com o que o agente faz, sem oferta de atendente | Não |
| `...comprei no pedido #10000?`, `...comprei no 10000?` | O número após "no/do/nº/número" é referência explícita | Interpretação do pedido de produtos: sim |
| Mesmo número repetido na frase | Um único pedido, não cancelamento em lote | — |
| Assunto inofensivo fora do escopo | Resposta natural e oferta de atendente; o aviso sobre regras/instruções aparece apenas em tentativas de manipulação (`manipulationAttempt`) | Classificação: sim |
| `SHIPPED` | "Enviado" significa saída para entrega; o agente informa que não há confirmação oficial de entrega | — |
| "sim" digitado com cancelamento pendente | Nenhuma ação; orienta a usar as opções da solicitação atual, sem citar identificadores técnicos | Classificação: sim |
| Fake Store totalmente indisponível | Mensagem de indisponibilidade do catálogo complementar; código `PRODUCTS_PARTIALLY_UNAVAILABLE` mantido por compatibilidade (cobre falha parcial ou total) | — |

Os modelos fixos aceitam apenas frases curtas com um único número e sem negação, múltiplos pedidos ou instruções adicionais; o restante segue para o modelo. Nunca há cancelamento automático ou em lote.

## IA e critérios de consulta

Gemini é o provedor demonstrativo no `.env.example`, com `GEMINI_MODEL=gemini-3.5-flash-lite`; OpenAI é alternativa configurável (`gpt-4.1-mini`). A factory, os SDKs oficiais e o prompt compartilhado permanecem reais. Disponibilidade, autorização e cotas dependem da conta: no nível gratuito do Gemini, mensagens em sequência rápida podem receber HTTP 429 e resultar em `AI_UNAVAILABLE` com oferta de atendimento. O Docker Compose usa `gemini` quando `AI_PROVIDER` está ausente; a API executada no host mantém `openai` nesse caso, por compatibilidade. Veja a seção "Provedores de IA" do README.

O parser responde apenas a construções conhecidas. Qualificadores desconhecidos passam para interpretação do modelo; critérios conhecidos que não cabem no contrato, como pagamento, entrega concluída e períodos, retornam **QUERY_UNSUPPORTED**, sem consultar uma coleção irrestrita. `queryFromPlan` aplica a mesma barreira: mesmo um plano bem formado da IA não pode apagar esses critérios. “Enviado” não significa “entregue”. Datas de criação são exibidas e usadas em mais recente/antigo; filtro por período não foi implementado.

O plano é validado com Zod e regras semânticas, sem SQL ou campos livres. Autorização, cálculos e cancelamento permanecem determinísticos. O modelo não executa ferramentas nem produz texto livre de sucesso. O prompt integral efetivo continua em `apps/api/src/integrations/openai/agent.prompt.ts`, reproduzido e testado em `stage-3.md`.

## Suposições adotadas

- Dados representam compras fictícias; cadastro não localiza compras reais pelo e-mail.
- O catálogo local versionado referencia IDs, nomes, descrições, categorias e imagens da Fake Store. Preços oficiais BRL são demonstrativos, definidos pelo Support AI, não conversões de preços externos. USD histórico é preservado.
- Consulta HTTP real da Fake Store complementa somente produtos de pedidos próprios. Falha externa não impede consulta/cancelamento oficial; imagens externas têm fallback. Não redistribuímos fotografias locais sem autorização específica.
- Soma sem filtro considera todos os status, inclusive cancelados, e não representa valor pago ou reembolso.
- Confirmação e oferta humana expiram conforme CONFIRMATION_TTL_SECONDS (300s por padrão). Não há cancelamento automático por tempo.
- Uma conversa tem no máximo um encaminhamento simulado. Reenvio de mensagem lógica usa o mesmo clientMessageId e devolve o resultado persistido; mensagem diferente usa outro identificador.

## Dúvidas para negócio/produto

Estas questões pertencem a uma evolução real, não autorizam novas regras nesta demonstração:

| Questão | Decisão provisória vigente |
| --- | --- |
| Existe prazo adicional ou exceção para cancelar? | Nenhum: somente PROCESSING, conforme desafio. |
| Qual é o efeito financeiro do cancelamento? | Não há processamento ou promessa de reembolso. |
| Qual equipe recebe encaminhamento e em qual SLA? | Nenhuma equipe integrada; somente registro simulado com consentimento. |
| Qual sistema comprova entrega, pagamento e rastreamento? | Não disponível; não inferir esses fatos de SHIPPED. |
| Como verificar e-mail no cadastro e administrar sessões? | Cadastro não verifica e-mail; recuperação comprova acesso naquele momento. Sem painel de sessões. |
| Qual política de retenção/exclusão e base para dados enviados à IA? | Ainda precisa ser definida antes de produção; não há garantia de detecção universal de dados pessoais. |

## Limitações técnicas e reprodução

Mensagens têm até 2000 caracteres; contexto limitado aos seis últimos turnos, até 800 caracteres por mensagem. Há contenção de 30 turnos recentes por cliente/minuto antes da interpretação normal, não um limitador distribuído estritamente atômico. Confirmações e pedido humano direto preservam seus caminhos existentes.

Não há interpretação universal de linguagem natural. Zod limita estrutura e o backend verifica critérios conhecidos; perguntas ambíguas devem ser esclarecidas. Não há filtros genéricos por período/produto/valor, pagamento, endereço, frete, entrega concluída, troca ou reembolso. Listas textuais mostram até dez pedidos; cálculos incluem todo o conjunto oficial filtrado.

Sem chave de IA (ou com cota esgotada), leituras coletivas reconhecidas, os modelos fixos de pedido individual, saudações e decisões explícitas continuam funcionando; outras interpretações recebem fallback e oferta humana, sem registro automático. Sem Resend configurado, cadastro/login funcionam, mas recuperação não envia e-mail. Respostas 202 não comprovam entrega nem existência da conta. O remetente de teste restringe destinatários; configuração de domínio/remetente é responsabilidade de quem executa.

O usuário confirmou recebimento de código e conclusão da redefinição numa validação anterior. Isso não constitui novo teste real nesta rodada, nem substitui verificação de cada ambiente. Testes automatizados usam IA/Fake Store/e-mail simulados, com integração PostgreSQL em banco separado. Os comandos de instalação e execução estão no README; [logs e exemplos](structured-logs.md) descrevem o diagnóstico seguro.

## Guia das alterações da auditoria

`agent.collection.ts`: `unsupportedOrderCriteria` identifica limites conhecidos; `collectionQuery` restringe reconhecimento local; `queryFromPlan` impede descarte dos critérios pelo modelo. `agent.orchestrator.ts.plan/execute` devolvem a limitação com histórico persistido e sem alterações em pedidos.

`operation-log.ts`: `observeOperation` mede duração e registra somente resultado/correlação; `requestCorrelation` usa AsyncLocalStorage para manter requisições concorrentes isoladas. O wrapper do agente observa o retorno após a transação e marca replay; controllers de pedidos observam operações REST; Fake Store registra sucesso e degradação.

`response-examples.ts` centraliza respostas fictícias do Swagger. `support.openapi.ts`, `agent.openapi.ts` e `auth.openapi.ts` reutilizam exemplos; o contrato proíbe os dois identificadores de decisão juntos e descreve campos obrigatórios de histórico e coleção.

### Correções da avaliação técnica

`agent.collection.ts`: `simpleOrderRequest` (modelos fixos de status, produtos e cancelamento com um número), `cancellationWithoutOrder`, `greetingOnly`, `manipulationAttempt`; `bulkCancellation` trata "um dos meus pedidos" como singular e conta números distintos; `unsupportedOrderCriteria`/`collectionQuery` aceitam "mais de um pedido" (`minimum: 2`); `individualOrderQuery` reconhece "cadê meu pedido". `agent.safety.ts.resolveOrderReference`: número após "no/do/nº/número" é explícito. `agent.responses.ts.orderStatusReply`: SHIPPED informa ausência de confirmação de entrega. `agent.orchestrator.ts`: `plan` usa os novos reconhecedores antes do modelo; `execute` ajusta pedidos de número para cancelamento, saudação, fora do escopo, confirmação sem identificadores técnicos, solicitação humana existente e Fake Store totalmente indisponível. `gemini.client.ts` registra `failureCode` (a chave `code` continua censurada pelo logger para proteger códigos de recuperação). `Chat.tsx` reinicia o rascunho em `useLayoutEffect`, evitando apagar texto digitado logo após a seleção da conversa. Testes: `tests/evaluation-regressions.test.ts`, bloco "evaluation regressions" em `tests/integration/agent.test.ts` e "Rascunho ao selecionar conversa" em `interactions.test.tsx`.

Para depurar, coloque breakpoints em `collectionQuery`, `unsupportedOrderCriteria`, `plan`, `queryFromPlan` e `execute`; inspecione a intenção/plano e o código de resultado. Em `observeOperation`, acompanhe requestId, resultado e duração, sem abrir ou copiar credenciais do SDK.
