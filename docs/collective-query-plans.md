# Consultas coletivas híbridas e negações

O Gemini/OpenAI pode interpretar consultas indiretas em um plano restrito. O parser continua atendendo perguntas simples; o backend continua responsável por autorização, fatos e cálculos. Não há endpoint novo, SQL gerado, alteração de layout, migration ou mudança das regras de cancelamento.

## Contrato e exemplo

`apps/api/src/integrations/ai/collection-plan.ts` define `collectionPlanSchema` com Zod estrito:

```json
{
  "operation": "COUNT",
  "statusFilter": { "mode": "EXCLUDE", "statuses": ["SHIPPED"] },
  "selection": null
}
```

Esse plano responde “Quantas compras ainda não foram enviadas?”. Excluir SHIPPED inclui PROCESSING e CANCELLED; não é sinônimo de selecionar apenas PROCESSING. Somente os status oficiais existentes são aceitos.

- `operation`: LIST, COUNT, EXISTS, PRODUCTS, TOTAL ou SELECT.
- `statusFilter`: null ou um conjunto de até três status com modo INCLUDE/EXCLUDE. Duplicatas são rejeitadas na validação semântica.
- `selection`: LATEST, OLDEST ou HIGHEST, obrigatório somente para SELECT; nas demais operações deve ser null.
- Não existem campos para cliente, SQL, tabelas, preços externos, ações ou identificadores de pedidos.

Em `intent-model.ts`, o contrato dos provedores exige `collectionPlan` presente, com plano ou null. O contrato interno aceita ausência para compatibilidade com adaptadores/test doubles anteriores. Consultas coletivas sem plano e sem reconhecimento local pedem esclarecimento. Gemini usa JSON Schema e `safeParse`; OpenAI usa `zodTextFormat` com o mesmo schema e nova validação da resposta. O limite de saída OpenAI passa de 300 para 600 tokens para acomodar a estrutura adicional; timeout/retry não foram alterados.

## Arquivos, métodos e fluxo

1. `agent.orchestrator.ts/send`: preserva titularidade, idempotência, lease e persistência transacional. Não aceita plano livre enviado pelo cliente HTTP.
2. `plan`: mantém os protocolos seguros de confirmação/consentimento e o limite de mensagens. Perguntas reconhecidas por `collectionQuery` dispensam IA; perguntas indiretas seguem para `model.interpret`. A resposta passa por Zod e por `queryFromPlan` antes de consultas do plano.
3. `agent.collection.ts/collectionQuery`: extrai perguntas diretas. Negações simples completas como “Quantos pedidos não estão enviados?” geram `excludedStatuses`. Negações compostas, “nunca”, “exceto”, “sem” e outras polaridades não reconhecidas são encaminhadas à IA, em vez de ignoradas.
4. `queryFromPlan`: revalida Zod, exige intenção ORDER_COLLECTION sem referências individuais inventadas e verifica operação/seleção, status duplicados, comandos proibidos e contradição com negação literal de status. Retorna o mesmo `CollectionQuery` já usado pelo backend, ou null.
5. `execute`: plano contraditório retorna NEEDS_CLARIFICATION, sem leitura de pedidos, criação de confirmação ou encaminhamento. Um plano válido utiliza `mainOrders.listForSummary(customerId)` e `collectionResponse`, sem Fake Store. Histórico e metadados da conversa continuam sendo persistidos pelo fluxo existente; os pedidos não são alterados.
6. `collectionResponse`: filtra inclusão/exclusão, conta, verifica existência, lista produtos, soma por moeda e seleciona por data/valor. Maior valor permanece separado por moeda; listas mostram até dez pedidos, mas totais/contagens consideram todos. Empates conservam os critérios determinísticos anteriores.
7. `actionRefusal`: trata “Não quero cancelar meu pedido” e “Não quero atendimento humano” antes de executar intenções do modelo. A recusa cancela o desafio/oferta pendente correspondente, sem cancelar pedidos nem criar HumanHandoff.

Para estudar, leia schema → parser/conversão → `plan` → `execute` → order service/repository → `collectionResponse`. No VS Code, use breakpoints em `collectionQuery`, `queryFromPlan`, `actionRefusal`, `model.interpret` e `mainOrders.listForSummary`. Observe plano, filtros e customerId da sessão, sem registrar tokens ou credenciais.

## Segurança e limites

- A IA interpreta linguagem; não fornece valores, contagens ou autorização.
- O plano é exclusivamente de leitura. ORDER_COLLECTION não chama `cancel`, não cria um desafio de cancelamento nem registra encaminhamento humano.
- Cancelamento em lote permanece bloqueado antes da inferência. Cancelamento individual conserva titularidade, PROCESSING, confirmação explícita vinculada à conversa, expiração, uso único e atualização atômica.
- Falha/timeout do provedor mantém o fallback seguro e apenas oferece atendimento humano. Resposta estruturalmente inválida pede reformulação e pode oferecer atendimento; nunca registra automaticamente. Contradição semântica do plano pede esclarecimento sem oferecer encaminhamento desnecessário.
- Falha da Fake Store não afeta esses resumos: produtos/preços/status vêm dos snapshots e dados oficiais.
- Não há interpretação universal de negações ou linguagem natural. Filtros fora do vocabulário, períodos de entrega, pagamentos e rastreamento não são suportados. O modelo é orientado a pedir esclarecimento; Zod limita a estrutura e o backend mantém os limites das operações.
- Não foi adicionada memória de filtros implícitos entre mensagens: contexto é enviado ao modelo, que deve produzir um plano completo a cada consulta. A referência individual autorizada segue o mecanismo anterior.

## Regressões e validação

Testes cobrem perguntas diretas/indiretas, inclusão/exclusão, existência positiva/negativa, produtos, soma por moeda, seleção, contradições, status/SQL/campos proibidos, recusas de ações, isolamento de clientes, idempotência e ausência de alterações nos pedidos. Integrações usam PostgreSQL dedicado e mocks controlados de IA/Fake Store; os testes dos SDKs validam os dois provedores sem chamadas externas.

Resultados finais: **196 testes de backend, 124 de integração PostgreSQL e 66 de frontend aprovados**, typecheck e build dos dois workspaces aprovados, imagem Docker da API reconstruída e healthcheck HTTP 200. A verificação do banco dedicado de testes encontrou cinco migrations sem pendências; nenhuma migration foi criada/alterada ou aplicada ao banco da aplicação nesta entrega.

Validação real limitada com `gemini-3.5-flash-lite`:

| Pergunta indireta | Plano e resultado |
| --- | --- |
| Será que alguma das minhas compras já saiu para entrega? | EXISTS, INCLUDE SHIPPED; respondeu existência corretamente |
| Você consegue me dizer o que já comprei por aqui? | PRODUCTS; listou os snapshots oficiais |
| Consegue contar as compras que ainda não foram enviadas? | COUNT, EXCLUDE SHIPPED; excluiu somente os enviados |
| Das minhas compras, qual veio primeiro? | SELECT, OLDEST; selecionou por data oficial |
| Você pode somar o que comprei, sem considerar compras canceladas? | TOTAL, EXCLUDE CANCELLED; somou o conjunto filtrado |

Esses cinco testes usaram o SDK real com repositórios em memória e Fake Store bloqueada, sem PostgreSQL; durações observadas de 920–2049 ms. Os casos diretos de negação, recusa de ações e bloqueio de lote usaram zero inferências.

Um sexto teste real pelo Chrome → frontend Docker → API → Gemini → PostgreSQL criou uma conta fictícia exclusiva `Validação de planos coletivos`: a pergunta indireta sobre produtos retornou os seis pedidos próprios e apareceu automaticamente no chat em 1788 ms. Em seguida, a pergunta direta sobre não enviados retornou quatro, sem confirmação ou encaminhamento, mantendo todos os status. O reenvio idempotente não criou novo turno: foram persistidos somente os dois turnos distintos e zero encaminhamentos. O teste inicial comparava JSON como string e observou ordem de chaves diferente no replay JSONB; a integração compara objetos e a conferência do banco confirmou ausência de duplicata. A conta fictícia foi preservada; nenhum dado anterior foi apagado ou alterado.

OpenAI foi validada com mocks e contrato JSON Schema, sem chamada real. O frontend não precisou de alteração: continua consumindo o mesmo resultado do endpoint de mensagens.
