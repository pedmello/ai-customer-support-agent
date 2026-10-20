# Reformulação visual do Support AI

## Escopo

As seis referências aprovadas orientam o cabeçalho, as três abas e suas versões mobile. A reformulação usa o backend existente; não altera autenticação, IA, banco, migrations ou regras de cancelamento.

No desktop, o cabeçalho reúne marca, navegação central em cápsula, identificação e saída. Atendimento apresenta conversas à esquerda, chat ao centro e pedidos à direita. Conversas apresenta busca/filtros e histórico ao lado. Pedidos apresenta lista e detalhes oficiais.

No mobile, o cabeçalho tem duas linhas. Atendimento mostra pedidos em uma faixa horizontal e prioriza o chat; o botão de headset mantém acesso ao encaminhamento simulado. Conversas abre o histórico após seleção, com botão de retorno. Pedidos expande os dados dentro do card selecionado. Os componentes e dados são compartilhados entre as larguras.

## Arquivos desta reformulação

| Arquivo | Alteração |
| --- | --- |
| `apps/web/src/App.tsx` | Composição das abas, painel de histórico e retorno mobile; Atualizar no rodapé. |
| `apps/web/src/components/Navigation.tsx` | Antiga sidebar passa a ser cabeçalho compartilhado, com seção ativa e logout. |
| `apps/web/src/components/Conversations.tsx` | Conversas e pedidos separados em painéis; busca local, filtros por estados reais e seleção do histórico. |
| `apps/web/src/components/Chat.tsx` | Headset acessível no composer mobile, usando o encaminhamento existente. |
| `apps/web/src/components/Orders.tsx` | Mesmo detalhe no painel desktop ou dentro do card mobile; recolhimento dos detalhes. |
| `apps/web/src/components/ui.tsx` | Metadados de status nos resumos e remoção de helpers sem utilização. |
| `apps/web/src/hooks/useCompactLayout.ts` | Novo hook que acompanha o breakpoint de 760px via matchMedia. |
| `apps/web/src/styles.css` | Substituição do layout anterior, tokens preservados e estilos responsivos para as seis referências e autenticação. |
| `apps/web/src/components/layout.test.tsx` | Novos testes de filtros, navegação/logout e expansão/ação conversacional mobile. |

O working tree já continha alterações da autenticação da Implementação 2. Elas foram preservadas; não são todas parte desta reformulação.

## Contratos e segurança

O cliente HTTP continua usando cookies HttpOnly via credentials: include, CSRF em memória e os mesmos endpoints. O cancelamento começa por useSupport.askOrder(orderNumber, true). A decisão usa useSupport.decide, decisionMessage e o confirmationId persistido, sem mostrá-lo ao cliente. Não existe chamada de cancelamento REST direto no frontend.

O histórico, as informações oficiais de pedidos, o catálogo, os preços e os identificadores públicos não foram reescritos. Imagens externas continuam com validação de origem e fallback. As mensagens continuam sendo texto escapado pelo React.

## Diferenças necessárias em relação às imagens

- Não são exibidos endereço, frete, pagamento, reembolso, previsão de entrega ou etapas fictícias de rastreamento.
- A situação oficial substitui a linha do tempo ilustrativa. O card mobile inclui quantidade, preço e cópia do número, podendo ficar mais alto que o mockup.
- Conversas não têm encerramento ou atendente conectado na API. Os filtros são Todas, Em atendimento e Encaminhadas; o encaminhamento é identificado como simulado.
- A busca de conversas é local: considera o título disponível e os históricos já carregados. Não é pesquisa global no banco. Históricos ainda não abertos têm título por data, pois a API não retorna resumo de todas as conversas.
- A faixa de produtos e as sugestões podem rolar horizontalmente dentro de seu próprio espaço no mobile. A página não apresenta overflow horizontal.
- Controles Nova conversa, Atualizar, cópia e avisos demonstrativos foram mantidos, mesmo quando não aparecem nas referências.
- Nas larguras intermediárias de 761–1023px, o painel lateral de pedidos fica oculto; os pedidos continuam acessíveis pela aba.

## Limpeza segura

Após a implementação e as verificações, foram conferidas as referências no frontend. A sidebar antiga, a toolbar superior, as regras responsivas correspondentes e estilos antigos de UUID/layout foram substituídos. As funções exportadas shortId e ProductPlaceholder não tinham consumidores e foram removidas de ui.tsx; ProductImage continua fornecendo o fallback utilizado.

Nenhum arquivo de funcionalidade ou teste existente foi excluído. Nenhuma dependência foi adicionada/removida. AuthLayout, Registration, Authentication, PasswordField, ExternalProducts e CopyOrderNumber continuam utilizados. As fotos de referência não foram copiadas para o repositório; capturas de validação ficam somente em .temp, ignorado pelo Git.

## Validação em 20/10/2026

| Verificação | Resultado |
| --- | --- |
| Frontend Vitest | 45 testes aprovados, 7 arquivos. |
| Integração auth.test.ts, support.test.ts e agent.test.ts | 96 testes aprovados; PostgreSQL de teste real, IA e e-mail simulados. |
| Typecheck e build | Aprovados nos dois workspaces. |
| Docker web | Build e healthcheck aprovados; somente o serviço web foi recriado. API e PostgreSQL saudáveis. |
| Navegador, três abas | Sem overflow da página em 320, 360, 375, 390, 768, 1024 e 1440px; capturas desktop/mobile inspecionadas. |
| Navegador, quatro modos de autenticação | Sem overflow nas mesmas larguras; nenhum erro JavaScript observado nessa verificação. Pedido de código interceptado para não enviar e-mail real. |
| Cadastro, logout e login reais | Cadastro com três pedidos; nova conversa; retorno à conta preservou integralmente os mesmos pedidos e conversas. |
| Cancelamento no navegador com respostas simuladas | Um envio com protocolo correto, confirmationId oculto, nenhuma chamada REST de cancelamento e status atualizado após sucesso. |
| Tentativa real de cancelamento com IA | Provedor indisponível: fallback e encaminhamento simulado exibidos; nenhum cancelamento executado. |

Não foi validado um cancelamento completo com Gemini real nesta revisão. A integração foi preservada e o comportamento de indisponibilidade ficou visível. Não foram repetidas chamadas à IA para contornar a indisponibilidade.

Os testes de navegador criaram duas contas fictícias exclusivas, com pedidos e conversas; esses registros foram mantidos. Não houve exclusão de registros da aplicação, reset, alteração de migration ou envio de e-mail real.

Comandos principais: npm test -w @support/web; npm run typecheck; npm run build. Integração: npm exec -w @support/api -- vitest run --config vitest.integration.config.ts tests/integration/auth.test.ts tests/integration/support.test.ts tests/integration/agent.test.ts.

Veja o [guia didático](code-walkthrough-frontend-layout.md). Pronto para revisão e commit manual.

A correção posterior de processamento por conversa, respostas automáticas e navegação durante a inferência está documentada em [ai-chat-loading-fix.md](ai-chat-loading-fix.md).

## Correção posterior: pedidos antigos e toque nas abas

Pedidos anteriores ao catálogo tinham títulos Item demonstrativo e fotos nulas. A apresentação da API agora usa presentOrderItem, em apps/api/src/modules/orders/legacy-product.ts, para completar exclusivamente esses metadados genéricos pelo ID real da Fake Store. O snapshot atual fornece os IDs 2 e 3; um snapshot histórico do ID 1, conferido na API oficial, atende apenas aos pedidos antigos. O ID 1 não voltou à seleção de novos cadastros.

Não há atualização de linhas, migration ou chamada externa na leitura. Quantidades, preços, moeda, datas, status e IDs permanecem intactos. Nomes específicos e fotos já persistidos são preservados. O mesmo resultado serve listagem, detalhes, cancelamento e novas respostas do agente. O histórico de mensagens existente não é reescrito.

Nas abas, o destaque de toque nativo foi desativado e a transição de fundo removida. A seleção continua arredondada e o outline de foco por teclado foi preservado. A emulação touch confirmou tap highlight transparente, transição de 0s e border-radius de 24px.

Validação da correção: 9 testes do serviço de pedidos, 77 de integração pedidos/agente e 45 de frontend aprovados; typecheck e builds aprovados. A leitura real conferiu os seis pedidos antigos: todos receberam nome e referência de foto, mantendo moeda e preços; comparação dos registros antes/depois confirmou ausência de alteração no banco.
