# Mobile, tipografia e consulta do conjunto de pedidos

Atualização posterior: [consultas de pedidos](order-query-improvements.md) documenta a correção do reconhecimento local, consultas sem dependência do modelo, rankings adicionais e contexto individual. As descrições de inferência e medições abaixo registram a implementação inicial.

## Resultado

Padronização visual posterior: no mobile, títulos usam 14px e demais textos usam 12px, incluindo o campo de mensagem, campos de autenticação, botões e etiquetas. Os tokens `--mobile-title-size` e `--mobile-text-size` centralizam essa escala; ícones mantêm suas dimensões próprias. Atendimento, Conversas e Meus pedidos têm 12px de padding lateral no mobile. O ícone de copiar fica dentro de `official-status`, à direita, com 22px e área de toque mínima de 44×44px. O crescimento automático continua ativo. O desktop não foi alterado por essa padronização. As descrições de posição anteriores abaixo registram a versão inicial.

O atendimento agora interpreta consultas gerais dos pedidos do cliente autenticado. Novos cadastros recebem seis pedidos, com seis produtos distintos. Clientes anteriores não recebem pedidos adicionais e conservam valores, moeda, histórico e identificadores originais. Não há migration nova nesta alteração.

No mobile, o rodapé demonstrativo e o padding externo foram removidos. Cabeçalho, formulários e cards mantêm seus espaçamentos internos. A página usa altura dinâmica de viewport com fallback `100vh`; os painéis flexíveis usam `min-height: 0` e rolagem própria. Pedidos, conversas e histórico permanecem acessíveis em telas altas.

O campo de mensagem usa 12px, cresce de 42px a 132px e passa a rolar internamente no limite. A altura é recalculada ao digitar, limpar ou alterar a largura. Enter envia; Shift+Enter mantém múltiplas linhas; composição de teclado não dispara envio. O foco está no campo ou botão, sem contorno de foco envolvendo o formulário inteiro.

O destaque de toque do navegador foi desabilitado nos controles. Estados selecionados, hover e `:focus-visible` continuam disponíveis. No pedido expandido, há apenas um ícone de cópia no cabeçalho, ao lado dos dados oficiais, com nome acessível, tooltip e feedback por 2,5 segundos. O antigo bloco isolado de identificação não é renderizado no mobile; o resumo precede as ações.

## Fontes e ícones

`apps/web/public/fonts/` contém as fontes WOFF2 e licenças; `apps/web/index.html` carrega os estilos locais. Não há dependência de Google Fonts em tempo de execução nem nova dependência npm.

- Geist, pesos 400–700: títulos, texto, botões e campos, com fallbacks de sistema.
- Geist Mono: token `--font-mono`, reservado à classe `technical-label`. Nenhuma etiqueta técnica fictícia foi adicionada às telas.
- Material Symbols Rounded: única família de ícones, peso 300, sem preenchimento. O arquivo contém somente os 15 símbolos utilizados.

Fontes: [Geist/Vercel](https://vercel.com/font), [licença OFL da Geist](https://raw.githubusercontent.com/google/fonts/main/ofl/geist/OFL.txt), [guia oficial Material Symbols](https://developers.google.com/fonts/docs/material_symbols) e [licença Apache 2.0](https://raw.githubusercontent.com/google/material-design-icons/master/LICENSE). As licenças completas também acompanham os arquivos locais.

## Causa das perguntas gerais

O orquestrador resolvia ORDER_STATUS e ORDER_PRODUCTS por `referencedOrder`, que depende de um número ou de um pedido no contexto. Uma pergunta como “Quantos pedidos eu tenho?” acabava em ORDER_ID_REQUIRED. A solução acrescenta ORDER_COLLECTION ao contrato Zod compartilhado por Gemini e OpenAI, sem substituir o fluxo individual.

O modelo classifica a intenção; não recebe a lista completa para inventar respostas e não calcula valores. O backend interpreta a pergunta atual, consulta a fonte oficial por customerId da sessão e compõe os fatos.

Perguntas atendidas:

| Pergunta | Cálculo/apresentação |
| --- | --- |
| Quais são meus pedidos? | Lista com número público, produtos, quantidades, status, moeda, valor e data |
| Quantos pedidos eu tenho? | Contagem de todos os pedidos próprios |
| Quais estão em processamento? | Filtro PROCESSING |
| Tenho algum pedido enviado? | Filtro SHIPPED |
| Quantos pedidos foram cancelados? | Contagem CANCELLED |
| Quais produtos comprei? | Itens dos pedidos próprios, sem consultar preços externos |
| Qual foi o valor dos meus pedidos? | Soma dos valores oficiais por moeda |
| Qual é meu pedido mais recente? | Data decrescente, desempate pelo número público |

A soma inclui pedidos cancelados, salvo filtro explícito, e a resposta informa isso. É soma de valores dos pedidos, não de pagamentos ou reembolsos. BRL e USD nunca são combinados nem convertidos. A lista textual mostra no máximo dez pedidos; contagens e totais consideram todos os pedidos encontrados. ORDER_COLLECTION retorna também `collection.count`, `collection.totals` e os pedidos apresentados. Não cria encaminhamento humano automaticamente.

Uma pergunta sobre um número específico continua usando a resolução existente, com titularidade e proteção contra referências inventadas. Uma classificação ORDER_COLLECTION sem pergunta reconhecível solicita esclarecimento. OUT_OF_SCOPE e falhas do provedor conservam o fluxo seguro de oferta humana, com consentimento obrigatório.

## Cancelamento em lote

`bulkCancellation` verifica a mensagem antes da inferência. Expressões de cancelamento com “todos”, “pedidos” ou múltiplos números são rejeitadas com BULK_CANCELLATION_NOT_ALLOWED. A execução limpa uma confirmação individual anterior e pede a escolha de um único pedido. Não chama o serviço de cancelamento nem faz inferência nesse caminho.

Mesmo fora dessa detecção, o caminho de escrita existente aceita somente um pedido, uma confirmação e uma atualização atômica. Nenhum laço de cancelamento, endpoint em lote ou confirmação coletiva foi criado. A confirmação individual, expiração, uso único, idempotência e CSRF foram preservados. “Solicitar cancelamento” no frontend continua enviando uma mensagem ao agente.

## Catálogo e novos cadastros

`support-brl-v3` possui sete produtos com IDs Fake Store 2, 3, 4, 9, 10, 11 e 12. A seleção embaralha o catálogo e escolhe seis sem reposição. Há variação probabilística; dois cadastros podem coincidir. O gerador aleatório continua injetável em testes.

Os IDs 10, 11 e 12 tiveram nome, descrição, categoria e imagem conferidos na API HTTP real. Os preços demonstrativos oficiais são independentes dos preços da Fake Store: respectivamente 44990, 17990 e 69990 centavos BRL. As imagens continuam sendo URLs externas com fallback; fotografias não foram redistribuídas. A integração HTTP complementar continua existente.

`demoOrders` associa dois PROCESSING, dois SHIPPED e dois CANCELLED. A escrita aninhada existente do repository cria cliente, sessão, seis pedidos e seus snapshots em uma única transação. Login não chama `demoOrders`. Nada repovoa contas anteriores. Pedidos USD existentes continuam em USD.

## Guia de código e depuração

| Caminho no projeto | Funções e responsabilidade |
| --- | --- |
| `apps/api/src/modules/agent/agent.collection.ts` | `collectionQuery` extrai tipo/filtro da pergunta atual; `bulkCancellation` bloqueia lote; `collectionResponse` conta, filtra, soma por moeda e redige a resposta oficial. |
| `apps/api/src/modules/agent/agent.orchestrator.ts` | `plan` classifica uma vez, dispensa Fake Store em consultas agregadas e bloqueia lote antes do modelo; `execute` usa o service no mesmo transaction client que persiste o turno. |
| `apps/api/src/modules/orders/order.repository.ts` | `listForSummary(customerId)` consulta somente pedidos do titular e seus itens, usando o transaction client quando fornecido. |
| `apps/api/src/modules/orders/order.service.ts` | `listForSummary` reutiliza `orderView`, apresentação dos produtos antigos e cálculo oficial do total de cada pedido. |
| `apps/api/src/integrations/ai/intent-model.ts` | Enum ORDER_COLLECTION; ambos os SDKs geram o JSON Schema a partir deste Zod e validam a resposta antes do agente. |
| `apps/api/src/integrations/openai/agent.prompt.ts` | Prompt compartilhado: consultas gerais não exigem número, múltiplas referências ambíguas não autorizam escolha e cancelamento em lote é proibido. Prompt integral sincronizado em `docs/stage-3.md`. |
| `apps/api/src/modules/customers/demo-catalog.ts` e `demo-catalog.data.json` | Seleção de seis produtos reais do snapshot local, metadados e preços BRL oficiais. |
| `apps/api/src/modules/customers/customer.service.ts` | `demoOrders` cria as seis entradas; `register` conserva hash de senha e escrita transacional existente. |
| `apps/web/src/components/Chat.tsx` | ResizeObserver e layout effect ajustam o textarea. Envio continua em `useSupport.send`, com estado por conversa e atualização automática. |
| `apps/web/src/components/Orders.tsx` | No mobile, OrderDetails renderiza CopyOrderNumber dentro de `official-status`, alinhado à direita. Layout geral e ações conversacionais preservados. |
| `apps/web/src/components/CopyOrderNumber.tsx` | `copy` usa Clipboard API; `iconOnly` mantém somente o ícone no mobile. Timer limpa o feedback, inclusive no unmount. |
| `apps/web/src/components/Icon.tsx` | Mapeia os nomes existentes de ícones para Material Symbols. `ui.tsx` reexporta para manter imports existentes. ProductImage usa esse módulo sem dependência circular. |
| `apps/web/src/styles.css` | Tipografia, foco, toque, overflow, rodapé mobile e geometria do cabeçalho de pedidos. |

Fluxo: `Chat.submit` → `useSupport.send/deliver` → `api.send` → middleware de sessão/CSRF → controller existente → `orchestrator.send` → `plan`/Gemini ou OpenAI → `execute` → `orders.listForSummary` → repository/PostgreSQL → `collectionResponse` → persistência de turno → resposta HTTP → merge de estado React → histórico.

No VS Code, coloque breakpoints em `collectionQuery`, no ramo de coleção de `execute`, em `orderView` e em `collectionResponse`. Observe customerId da sessão, filtro, array de pedidos e mapa de totais. Nunca inspecione ou compartilhe segredos em capturas. Para a interface, depure o layout effect de Chat e `CopyOrderNumber.copy`; use DevTools para observar altura, scrollHeight, `:focus-visible` e a fonte efetivamente carregada.

## Validação

- Backend unitário: 158 testes aprovados, incluindo 23 novos casos de coleção, filtros, totais, limite de apresentação e proibição de lote.
- Frontend: 60 testes aprovados, incluindo crescimento/limite/limpeza do textarea, Shift+Enter e posicionamento/acessibilidade da cópia.
- Integração PostgreSQL: suíte completa final com 112 aprovados, incluindo timeout em consulta agregada sem encaminhamento automático, isolamento, confirmação e idempotência.
- Typecheck e builds dos dois workspaces aprovados. Compose válido e serviços saudáveis; `/health` HTTP 200. Nenhuma migration nova nesta alteração; cinco migrations existentes aplicadas no banco de testes.
- Chrome com API simulada para estresse visual: três abas em 320×568, 360×640, 375×667, 390×844, 440×956, 440×740, 768×1024, 1024×768 e 1440×900, sem overflow horizontal. Rodapé oculto e padding externo zero no mobile. Rolagem comprovada com seis cards, 25 conversas e 20 turnos. Textarea com 132px e rolagem interna; cópia funcional; fontes Geist e Material Symbols carregadas; zero erros JavaScript.
- Conferência final da imagem Docker atualizada: mudança de largura 440→320px recalculou o textarea de 130px para 132px, com conteúdo rolável; os quatro filtros apresentaram tap highlight transparente, a cópia permaneceu dentro do viewport e seu feedback desapareceu após 2,5 segundos. Filtros e recolhimento funcionaram. Geist Mono também carregou com sucesso no teste, sem ser aplicado a texto comum.
- Fluxo real Chrome → API Docker → PostgreSQL → Gemini `gemini-3.5-flash-lite`: cadastro HTTP 201 criou seis produtos distintos; consulta geral respondeu ORDER_COLLECTION/6 em 14,473s; soma respondeu ORDER_COLLECTION em 13,920s; contagem de cancelados respondeu ORDER_COLLECTION/2 em 12,969s. Três inferências reais, sem chamadas extras para redação.
- As duas primeiras respostas reais foram observadas no chat sem recarregar, inclusive após navegar entre abas durante a primeira inferência. A checagem instantânea da terceira usou o primeiro texto correspondente, que pode ser a prévia oculta no mobile; não é uma medida conclusiva de visibilidade dessa mensagem. O resultado HTTP correto e os fluxos de atualização automática são cobertos separadamente.
- “Cancele todos os meus pedidos” respondeu BULK_CANCELLATION_NOT_ALLOWED em 144ms, sem confirmação pendente. Os seis status permaneceram dois de cada. Logout/login reais HTTP 201 recuperaram os mesmos seis números, sem pedidos adicionais. Conta fictícia `Validação mobile e pedidos` preservada; nenhuma conta anterior foi alterada.

## Limitações

Chrome com viewport/touch emulado não substitui um iPhone físico/Safari, especialmente quanto ao teclado e zoom de campos de 12px. Não afirmamos essa validação física. O ambiente ainda possui outro servidor em localhost/IPv6: o teste isolado resolveu localhost para 127.0.0.1, preservando a origem configurada, sem alterar aquele servidor.

A interpretação linguística depende do modelo e das cotas/latência do provedor. A extração determinística aceita as construções documentadas; outras formulações podem pedir esclarecimento. Não houve mudança nos limites existentes de 2000 caracteres, contexto de seis turnos ou 30 turnos recentes por cliente/minuto antes da inferência. A consulta de resumo lê todos os pedidos do titular para calcular os totais; é adequada ao cadastro demonstrativo de seis pedidos, mas um catálogo de grande escala exigiria agregação paginada/no banco. Atendimento humano continua simulado e exige consentimento.
