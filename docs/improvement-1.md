# Implementação 1 — Pedidos, catálogo e atendimento

Entrega exclusiva de números públicos, views administrativas, catálogo demonstrativo resiliente e melhorias de atendimento/apresentação. Cadastro demonstrativo, sessão HttpOnly, CSRF e política de identidade foram preservados. Senhas, login e recuperação por e-mail pertencem integralmente à Implementação 2 e não foram iniciados.

## Contratos e identificação

`Order.orderId` continua UUID e chave primária. `orderNumber` é um inteiro único PostgreSQL, inicializado em 10000, adicionado a pedidos existentes sem renumeração posterior. As respostas novas incluem os dois campos; o UUID fica restrito ao transporte técnico e aos relacionamentos. A interface mostra e copia o número público.

Endpoints:

- `GET /orders`: lista própria, agora com orderNumber e snapshots do catálogo.
- `GET /orders/by-number/:orderNumber`: consulta própria por número; sessão obrigatória.
- `GET /orders/:orderId`: preservado para compatibilidade.
- `POST /orders/:orderId/cancel`: preservado, com autenticação, CSRF, titularidade e transição atômica. Não é chamado pelo frontend.
- Endpoints de conversas, mensagens, cadastro, sessões e encaminhamento mantidos.

O número previsível não concede acesso. Outro titular e pedido inexistente retornam o mesmo 404. Parâmetro público precisa ser inteiro decimal entre 10000 e 2147483647; decimais, expoentes e valores fora da faixa são rejeitados.

`pendingConfirmation` acrescenta orderNumber, mantendo orderId/confirmationId como vínculo técnico. A confirmação permanece exatamente `CONFIRMAR CANCELAMENTO` ou `DESISTIR`, com confirmationId em campo separado, prazo, vínculo à conversa/cliente e uso único.

## Banco e preservação

Migration nova: `apps/api/prisma/migrations/202610200001_public_orders_catalog_views/migration.sql`.

- Bloqueio exclusivo curto sobre orders para serializar o backfill contra gravações.
- Sequência integer, números estáveis para registros anteriores, default, unicidade e check.
- Default BRL apenas para novos pedidos.
- Colunas opcionais em order_items: image_url, catalog_version, description e category.
- Três views versionadas descritas em [database-readability.md](database-readability.md).
- Nenhuma migration anterior foi editada, nenhuma PK/FK substituída e nenhum banco/volume recriado.

Aplicada primeiro no banco de testes. Um teste adicional cria um schema exclusivo temporário dentro do banco `_test`, instala as duas migrations anteriores, insere um pedido USD com mensagens/resultado antigo e aplica a nova migration. Verifica identidade, preços, datas, texto/hash/JSON, views, primeiro número e próximo número. Remove somente seu próprio schema.

Na aplicação: API pausada, backup pg_dump salvo em `.temp/support-improvement-1.dump` (ignorado pelo Git), fingerprints dos campos anteriores coletados, migration aplicada e fingerprints comparados. A comparação confirmou preservação dos campos anteriores de oito tabelas. A API foi atualizada e reiniciada depois. O script reproduzível é `apps/api/scripts/verify-improvement-migration.ts`, com comandos before/after; deve ser usado sem escritores concorrentes. Ele não imprime nem exporta conteúdo de linhas.

O backup contém dados do banco e deve permanecer local e protegido; não deve ser anexado a PRs ou relatórios públicos.

## Catálogo real da Fake Store, snapshot local

Arquivos: `demo-catalog.data.json` e `demo-catalog.ts`, no módulo customers. Snapshot verificado pela API real em 20/10/2026. Versão atual: **support-brl-v2**.

| Fake Store ID | Nome canônico | Preço oficial demonstrativo |
| --- | --- | --- |
| 9 | WD 2TB Elements Portable External Hard Drive - USB 3.0 | R$ 399,90 |
| 2 | Mens Casual Premium Slim Fit T-Shirts | R$ 89,90 |
| 3 | Mens Cotton Jacket | R$ 189,90 |
| 4 | Mens Casual Slim Fit | R$ 59,90 |

O JSON mantém nomes canônicos (inclusive eventual espaço final recebido), descrições, categorias e URLs de imagens correspondentes aos IDs externos. Estes metadados não são traduções inventadas. unitPriceCents é uma decisão demonstrativa própria da API, não preço externo nem conversão de USD. A mochila ID 1 foi retirada da seleção após a correção solicitada; snapshots já criados não são alterados retroativamente. A versão v1 foi usada somente antes desse ajuste e pode existir em registros anteriores.

O cadastro usa seleção embaralhada sem reposição. Na atualização documentada em [mobile-orders-improvements.md](mobile-orders-improvements.md), passou a escolher seis produtos distintos entre sete opções, com dois pedidos de cada status. Aleatoriedade criptográfica padrão; função injetável para testes determinísticos. Variação é probabilística: não há promessa de que dois cadastros consecutivos terão conjuntos diferentes. Registros e resultados históricos de validação abaixo referem-se à versão original de três pedidos; contas anteriores não são repovoadas.

O cadastro transacional existente copia nome, referência da foto, descrição, categoria, versão, quantidade e preço para o item. Não faz chamada HTTP à Fake Store. Login não foi adicionado e nenhum fluxo de leitura gera novos pedidos.

### Fotos e condições de uso

A fonte oficial consultada foi https://fakestoreapi.com e o repositório https://github.com/keikaavousi/fake-store-api. O repositório informa licença MIT para software/documentação, mas não encontramos uma autorização específica e independente para redistribuir as fotografias de produtos. Por isso **não copiamos fotos para o repositório nem afirmamos possuir seus direitos**. As referências continuam sendo as URLs HTTPS da própria API; React usa no-referrer, carregamento lazy, domínio permitido e fallback quando a foto falta/falha. Não há proxy ou cache de fotografias nesta entrega. Antes de redistribuição comercial das fotos, confirmar autorização aplicável.

Referência consultada: https://github.com/keikaavousi/fake-store-api/blob/master/LICENSE.

### Indisponibilidade externa

A integração HTTP real em `integrations/fake-store/fake-store.client.ts` foi preservada: timeout, limite de corpo, validação Zod, tratamento de NOT_FOUND/UNAVAILABLE e descarte de preço/rating externos.

- Sem Fake Store: cadastro, listagem, consulta e cancelamento continuam disponíveis pelos snapshots da API principal.
- Consulta de produtos pelo agente continua tentando o client HTTP real, quando autorizada.
- Falha externa produz PRODUCTS_PARTIALLY_UNAVAILABLE, mantém pedido/preço e informa degradação; não inventa disponibilidade.
- Se o servidor de imagens também falhar, aparece ícone neutro; nome, quantidade, preço, moeda e ações continuam acessíveis.
- Pedido antigo em USD permanece USD, com nome/preço antigos e sem imagem inventada. Não trocamos apenas o símbolo da moeda.

## Atendimento e segurança

`resolveOrderReference` aceita número isolado, #número e pedido número. Identifica múltiplos pedidos, rejeita números inventados pelo modelo e evita extrair valores monetários/quantidades como pedidos. Referência sem contexto suficiente pede esclarecimento. IDs UUID atuais ainda podem ser resolvidos internamente para compatibilidade, mas nunca são solicitados nas respostas.

Antes da inferência, UUIDs reconhecidos de pedidos próprios no texto/contexto são apresentados ao modelo como números públicos. UUIDs desconhecidos viram referência indisponível. Esse processo não altera mensagem persistida nem hash. O modelo recebe uma única chamada por interpretação; confirmação explícita segue dispensando inferência.

`intentSchema` acrescenta orderNumber nullable. orderId permanece como campo legado; o prompt exige null nas novas interações. A interpretação não é autorização: o serviço resolve sempre com customerId da sessão e revalida o pedido dentro da execução.

`agent.responses.ts` compõe número, nome do produto, status em português e moeda oficial. Não foi adicionada chamada à IA para redação. Encaminhamento usa linguagem mais natural e informa que não há equipe conectada nem contato agendado.

Replays antigos retornam exatamente o JSON original, mesmo que não incluam novos campos. Mensagens e snapshots não foram reescritos. No frontend, `publicOrderText` substitui UUIDs conhecidos apenas na apresentação, usando pedidos próprios; referências desconhecidas ficam indisponíveis. Isso também vale para títulos/prévias. Dados técnicos continuam disponíveis aos consumidores legados da API e à investigação administrativa, sem exibição ao cliente na UI.

## Frontend sem redesenho

Mantidas sidebar, painel intermediário, chat, listagem e detalhes responsivos. Ajustes pontuais: número público, copiar, orientação de uso no atendimento, fotos e fallback, busca por número/nome, nomes canônicos e formatação da moeda registrada. Ação de cancelamento continua criando conversa e enviando mensagem real com número público. Os botões de decisão continuam encapsulando o desafio técnico.

Os cards de respostas antigas continuam sendo snapshots históricos. Uma consulta nova devolve status atual; listas/detalhes sincronizam após o envio e a confirmação. Reabrir histórico não inventa cards que o contrato histórico não fornece.

## Verificação

Comandos da raiz:

```powershell
npm run typecheck
npm run build
npm test
npm run test:integration
npm run db:status
docker compose up -d --build --wait api web
```

Os testes automatizados não consomem Gemini/Fake Store reais. Integração usa PostgreSQL `_test` com clientes externos simulados. Casos novos incluem sequência concorrente (18 números), catálogo/snapshots, consulta pública isolada, referências ambíguas/inventadas, mensagens naturais, confirmação e replay, indisponibilidade externa, migração legada, fotos/fallback, cópia e moedas.

Os resultados finais e a validação real estão registrados ao final deste documento. O guia de responsabilidades e depuração está em [code-walkthrough-improvement-1.md](code-walkthrough-improvement-1.md).

## Limites

Identidade continua demonstrativa, sem senha nem comprovação de e-mail. Não há autenticação nova nesta entrega. Fotos dependem de servidor externo, com fallback. Catálogo novo não altera retroativamente títulos ou moeda dos pedidos antigos. Números de sequência podem ter lacunas; não são sigilosos nem credenciais. Views são administrativas. A Implementação 2 não foi iniciada. Nenhum branch, commit, stash ou push foi executado.

## Resultado final da validação — 20/10/2026

| Verificação | Resultado |
| --- | --- |
| Typecheck API/web | Aprovado |
| Build API/web, incluindo catálogo JSON no dist | Aprovado |
| Vitest unidade API | 104 aprovados |
| Vitest frontend | 34 aprovados |
| Integração PostgreSQL real, externos simulados | 78 aprovados |
| Total automatizado | 216 aprovados |
| Migration principal e banco de testes | Aplicada; três migrations, nenhuma pendente |
| Preservação após migration principal | Fingerprints de campos anteriores idênticos nas oito tabelas |
| Docker API/web/PostgreSQL | Saudáveis; sem alteração de Compose, portas ou volume |
| Swagger | HTTP 200; endpoint/schema novos presentes; referências e protocolo cobertos por teste |
| Health real | HTTP 200, database up |

Validação real pelo navegador, sem mocks de IA:

- Cadastro de fixture exclusiva criou três pedidos BRL, com números públicos e itens fotografados.
- Consulta pelo Gemini ao pedido público: resposta natural com produto, status e preço; cerca de 1.773 ms ponta a ponta.
- Solicitação de cancelamento pelo botão da tela de pedidos: desafio com número público, sem revelar confirmationId; cerca de 1.906 ms.
- Confirmação pelo botão do chat: sucesso real, cerca de 71 ms, sem nova inferência. Nenhuma requisição ao cancelamento REST direto foi emitida.
- Releitura dos detalhes confirmou CANCELLED e o preço oficial preservado.
- Consulta de produtos pelo agente acionou a Fake Store real e retornou informações complementares disponíveis; cerca de 7.205 ms incluindo navegação/verificações do smoke. Fotografias carregadas no navegador.
- Três chamadas reais de inferência no total; não houve chamada extra para redação. OpenAI foi preservado/testado com mocks, sem validação real adicional nesta entrega.
- O smoke de IA ocorreu antes da substituição da mochila. Depois da troca, um segundo cadastro real validou support-brl-v2, três produtos distintos, ausência do ID 1 e presença do HD WD ID 9 com sua URL correspondente. Não repetimos inferências só por essa alteração de catálogo.
- Lista/chat sem overflow horizontal em 320, 360, 375, 390 e 1440 px; versão final v2 da lista também conferida nas quatro larguras mobile.
- Logout realizado e somente as duas fixtures exclusivas removidas (com cascatas dos próprios registros). Nenhum dado anterior foi removido.

Os testes automatizados preservam os cenários anteriores de sessão, CSRF, concorrência, confirmação e rollback. Não dependem de serviços externos. Tempos acima são observações pontuais, não SLA.

## Arquivos desta implementação

Novos: migration incremental; `apps/api/scripts/verify-improvement-migration.ts`; `apps/api/src/modules/customers/demo-catalog.ts` e `demo-catalog.data.json`; `apps/api/src/modules/agent/agent.responses.ts`; testes `public-orders.test.ts` e `integration/migration-public-orders.test.ts`; `apps/web/src/services/order-presentation.ts`; componentes `ProductImage.tsx` e `CopyOrderNumber.tsx`; teste `components/improvement-orders.test.tsx`; os três documentos desta entrega.

Alterados: schema Prisma; módulo orders (repository/service/schemas/controller/routes); fábrica de pedidos em customer.service; schema de intenção/prompt comum aos provedores; orquestrador/safety; repository de conversas; OpenAPI de suporte/agente; fixtures e cenários dos testes existentes; tipos/HTTP/hook e componentes de pedidos, chat, conversas e UI; pequenos estilos de imagem/cópia; bloco do prompt em docs/stage-3.md e README.

Havia alterações anteriores da Etapa 4 e de docs/stage-3.1-gemini.md no workspace. Foram preservadas; a lista acima descreve as mudanças desta implementação, não atribui todo o diff acumulado a ela. Nenhuma dependência de execução foi adicionada.

Revis?o final: preservado tamb?m o contexto quando o modelo resolve um pronome (por exemplo, ?esse pedido?) para o mesmo n?mero do ?ltimo pedido pr?prio persistido. Um n?mero diferente, pre?o ou quantidade n?o pode trocar esse contexto. Teste de regress?o reproduziu a incompatibilidade e passou ap?s o ajuste. Prisma validate aprovado; migrate diff n?o detectou diferen?a entre banco e schema. Ap?s limpar as duas fixtures de navegador, os fingerprints das oito tabelas continuaram iguais ? linha de base anterior ? migration.
