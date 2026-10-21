# Consultas de pedidos: interpretação e respostas oficiais

Atualização: [planos coletivos e negações](collective-query-plans.md) amplia o fluxo abaixo. Perguntas indiretas agora podem ser executadas pelo plano estruturado validado de Gemini/OpenAI; perguntas diretas continuam locais. O diagnóstico a seguir registra a implementação anterior.

## Diagnóstico

A resposta genérica vinha do ramo `ORDER_COLLECTION` sem uma pergunta reconhecida por `collectionQuery`. O parser anterior rejeitava variantes como “Quantos estão cancelados?”, não distinguia corretamente “Qual o status do meu pedido?” de uma coleção e não implementava os critérios mais antigo/maior valor/elegibilidade. Além disso, `plan` consultava o modelo antes de usar o parser: uma classificação divergente ou falha do provedor impedia uma consulta que a API sabia responder.

Os dois exemplos completos “Quantos pedidos estão enviados?” e “Quais são meus pedidos cancelados?” foram reconhecidos pelo parser do container anterior. Sem rastreamento da requisição histórica, não é possível atribuir com certeza a resposta observada desses exemplos a uma única causa. A correção cobre as variantes reproduzidas e remove a dependência do modelo para as perguntas reconhecidas.

## Fluxo e funções para estudar

1. `apps/api/src/modules/agent/agent.orchestrator.ts`: `send` preserva autenticação, titularidade da conversa, hash/idempotência, lease e persistência transacional dos turnos.
2. `plan` mantém o limite de 30 mensagens recentes por minuto/cliente. Antes da inferência, chama `collectionQuery` e `individualOrderQuery`. Leituras reconhecidas são resolvidas sem Gemini/OpenAI; demais mensagens continuam no SDK existente, com validação Zod e fallback seguro.
3. `apps/api/src/modules/agent/agent.collection.ts`: `collectionQuery` normaliza acentos e identifica listagem, contagem, filtros, produtos, total e ordenação. `eligibilityQuestion` distingue uma pergunta sobre elegibilidade de um comando de cancelamento. Uma pergunta não autoriza escrita.
4. `execute` chama `mainOrders.listForSummary(customerId)` dentro da transação existente. O service utiliza os snapshots oficiais e calcula os valores dos itens; o repository filtra por `customerId` da sessão, nunca pelo texto do cliente.
5. `collectionResponse` filtra, conta, ordena e soma em centavos no backend. A IA não fornece fatos, números públicos nem valores. A resposta é persistida no histórico e retornada pelo contrato existente.
6. `individualOrderQuery` reconhece perguntas singulares de status/detalhes/situação. `referencedOrder` só reutiliza `lastOrderId` sem número quando `explicitOrderContext` encontra uma referência como “desse pedido”. O pedido ainda passa pelo service de titularidade. Uma resposta coletiva limpa o contexto singular antigo para evitar que “esse pedido” selecione um pedido anterior após uma lista.
7. `apps/web/src/components/Orders.tsx`: somente o parágrafo “Sobre os produtos” mudou; informa a origem complementar da Fake Store e a autoridade do Support AI. Não existe consulta livre ao catálogo nem endpoint novo.

Para depurar no VS Code, coloque breakpoints em `plan`, `collectionQuery`, `referencedOrder`, no ramo coletivo de `execute`, em `order.service.ts/listForSummary` e `collectionResponse`. Observe intenção local, filtros, cliente autenticado e totais por moeda; não compartilhe cookies ou segredos.

## Perguntas e limites

| Pergunta | Comportamento |
| --- | --- |
| Quantos pedidos tenho? / Quais são meus pedidos? | Contagem ou lista dos pedidos próprios |
| Quantos estão enviados? / Quais são meus pedidos cancelados? | Filtro oficial por SHIPPED/CANCELLED/PROCESSING |
| Quantos pedidos estão enviados ou cancelados? | União dos status e contagem discriminada por status |
| Quais produtos comprei? | Produtos e quantidades registrados nos itens |
| Qual meu pedido mais recente/mais antigo? | Data de criação; desempate pelo número público |
| Qual meu pedido de maior valor? | Um maior por moeda; desempate por data e número, sem câmbio artificial |
| Qual o valor total dos meus pedidos? | Soma oficial por moeda, incluindo cancelados quando não há filtro; não é valor pago ou reembolso |
| Tenho pedidos elegíveis para cancelamento? / Quais pedidos posso cancelar? | Lista PROCESSING, sem criar confirmação ou cancelar |
| Qual o status do meu pedido? | Solicita número público e orienta a aba Meus Pedidos; não escolhe pedido nem oferece humano desnecessariamente |
| Qual o status desse pedido? | Usa contexto singular autorizado, se inequívoco; caso contrário solicita número |
| Qual meu pedido mais recente e mais antigo? | Esclarece critério de ordenação, sem escolher arbitrariamente |
| Cancele todos os meus pedidos | Recusa lote, invalida confirmação individual anterior e solicita escolha de um pedido |

Listas textuais mostram até dez pedidos; contagens/totais consideram todos os registros correspondentes. Ordenações retornam somente os selecionados; `collection.count` continua representando o conjunto filtrado, preservando o contrato anterior. Ausência de resultados informa zero. O reconhecimento local não é um interpretador irrestrito de linguagem natural: frases não reconhecidas passam pelo modelo e podem pedir esclarecimento. Nenhum novo rastreamento, pagamento, frete ou reembolso é inferido.

Não houve alteração de autenticação, layout, migrations ou regras do cancelamento individual. Consultas não modificam pedidos. Cancelamento continua exigindo número/contexto autorizado, titularidade, PROCESSING e confirmação explícita de uso único na conversa. Falhas de IA fora das leituras locais mantêm oferta de atendimento humano com consentimento; não registram encaminhamento automaticamente.

## Validação

- Regressões de interpretação, status simples/múltiplos, moedas, total, rankings, vazio, contexto individual e recusa de lote.
- Integração com PostgreSQL dedicado de testes, mocks do modelo/Fake Store: isolamento, idempotência, limite de mensagens, persistência, confirmação e concorrência anteriores preservados.
- Frontend: teste do novo parágrafo e preservação da apresentação compacta/desktop.
- Chrome real, frontend Docker em `http://localhost:5174`, API e PostgreSQL reais: conta fictícia exclusiva com seis pedidos; consulta digitada no chat apareceu automaticamente (431 ms), enviados/cancelados retornaram dois cada, produtos/rankings/totais/elegibilidade retornaram sucesso. Pergunta singular pediu número, lote foi recusado; nenhum status foi alterado e nenhum encaminhamento criado. Chamadas coletivas HTTP observadas: 38–94 ms.
- Uma inferência real Gemini `gemini-3.5-flash-lite` para status por número público: HTTP 200, `ORDER_STATUS`, pedido oficial correto; log do SDK com `SUCCESS`, tentativa 1, duração 1200 ms. Leituras coletivas não fizeram inferências. A conta de teste foi preservada, sem limpeza de registros anteriores.

Resultados finais: 175 testes unitários de backend, 115 testes de integração PostgreSQL e 66 testes de frontend aprovados. Typecheck e build dos dois workspaces aprovados; imagens Docker reconstruídas e serviços saudáveis, com `/health` HTTP 200. A verificação de migrations no banco dedicado de testes informou nenhuma pendência; nenhuma migration foi criada ou alterada, e o banco da aplicação não passou por deploy de migrations.
