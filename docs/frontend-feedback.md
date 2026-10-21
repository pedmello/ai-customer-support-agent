# Feedback de operações e ajustes de interface

## Loaders locais

`apps/web/src/components/PendingIndicator.tsx` concentra o spinner, sua apresentação compacta em botões e o texto acessível nas regiões de carregamento. A animação respeita `prefers-reduced-motion`.

`apps/web/src/hooks/useVisualPending.ts` mantém somente a apresentação do indicador por no mínimo 180ms. Esse timer não envolve promises, não segura respostas, não atrasa erro/sucesso e não mantém botões desabilitados após a conclusão. Uma operação demorada não recebe tempo adicional. Cleanup cancela timers ao trocar estado ou desmontar.

`useSupport.ts` continua usando os bloqueios reais existentes: uma mensagem por conversa, identificador idempotente, retry da mesma mensagem e proteção de sessão. Agora expõe também:

- `activity`: operação administrativa corrente (criação, autenticação, atualização ou logout), sem comparar textos traduzidos nos componentes.
- `listsLoading`: leitura de pedidos/conversas, com contador para leituras sobrepostas.
- `loadingConversations`: leitura de histórico por conversa; não bloqueia outras conversas.

Os contadores são limpos na saída e protegidos pela mesma geração de sessão (`epoch`) que já impedia respostas antigas de repovoarem o estado. A navegação global permanece habilitada. Uma conversa selecionada abre imediatamente, com indicador local enquanto seu histórico carrega; conteúdo já disponível não é ocultado.

Os indicadores são reutilizados em App, Navigation, Authentication, Registration, Conversations, Orders, Chat, HandoffOffer e CopyOrderNumber. Isso cobre inicialização, listas, histórico, login/cadastro/recuperação, logout, criação, envio/retry, confirmação/desistência, consentimento humano e cópia. Busca e filtros locais continuam imediatos, pois não fazem requisições.

## Atendimento humano apenas no histórico

Antes, o botão chamava `POST /handoffs` e usava `setNotice` para exibir o aviso fixo. Esse endpoint registra o encaminhamento, mas não cria um turno de chat. Apenas apagar o aviso faria a confirmação sumir após a sincronização.

Agora `useSupport.handoff` envia a mensagem explícita “Quero falar com um atendente” pelo `deliver` existente. O backend já reconhece essa frase deterministicamente, sem inferência Gemini/OpenAI, e persiste a resposta junto com o registro. O histórico mostra a informação de simulação somente depois de sucesso confirmado. O bloco fixo `handoff-note` foi removido. O endpoint REST e todos os contratos existentes continuam disponíveis e não foram alterados.

O pedido direto já representa consentimento, conforme as regras existentes. Ofertas por falta de escopo continuam exigindo `handoffOfferId` e confirmação explícita. Bloqueios por conversa, retries e unicidade do HumanHandoff evitam duplicidades. Erros de transporte não afirmam sucesso e continuam com reconciliação segura.

## Visual e mobile

- Nova conversa: hover azul `#2563ef`, texto e ícone brancos; foco por teclado preservado. Regra limitada a `.new-conversation`.
- Atendimento mobile: padding lateral de 12px e inferior `max(12px, env(safe-area-inset-bottom))`. O composer não duplica a safe area já aplicada pelo contêiner.
- Faixa de pedidos: `OrderRail` apresenta todos os pedidos recebidos, sem `slice(0, 4)`. Continua horizontalmente rolável no mobile, inclusive para mais de seis itens. Textos dos chips usam 12px.
- Detalhes mobile: OrderDetails omite data de cancelamento, categoria externa e preço unitário redundante. Quantidade, nome, imagem, número, status e valor oficial permanecem. Desktop conserva os campos omitidos no mobile; banco e API não mudaram.
- Header mobile: padding de 16px no topo e nas laterais, com row-gap de 10px entre marca/perfil e navegação. Abaixo de 360px, somente padding/gap internos dos botões são reduzidos para acomodar os nomes sem diminuir o texto de 12px.
- Texto do cadastro corrigido para informar os seis pedidos já criados pelo backend.

## Tokens

`styles.css` define `--text-xs` (10px), `--text-small` (11px), `--text-body` (12px), `--text-base` (13px), `--text-title` (14px) e `--text-input` (16px). Declarações repetidas desses tamanhos passaram a usar os tokens, preservando seus valores no desktop.

`--mobile-title-size` e `--mobile-text-size` referenciam os tokens de 14px/12px. Os chips da faixa são a exceção explícita de 12px, conforme solicitado. Geist, Geist Mono e Material Symbols Rounded continuam servidos localmente e com suas responsabilidades anteriores.

## Testes e depuração

66 testes frontend passaram; typecheck e build passaram. Casos adicionados/atualizados:

- PendingIndicator: sucesso e erro rápidos, conteúdo disponível imediatamente, botão já desbloqueado, operação demorada sem atraso adicional e limpeza dos timers.
- useSupport: pedido direto persistido sem aviso fixo/POST separado; cliques repetidos durante a espera; troca de conversa sem perder o resultado. Testes existentes de timeout, reconciliação, CSRF, autenticação e cancelamento mantidos.
- OrderRail: oito pedidos apresentados, sem limite arbitrário de quatro ou seis.
- OrderDetails: dados redundantes ausentes apenas na apresentação compacta e preservados no desktop.

Chrome com API simulada: carregamento com latência de 900ms, navegação durante envio, resposta automática e falha HTTP 503 com erro local/retry e sem travar menus. Hover conferido após a transição: azul RGB(37,99,239), texto/ícone brancos. Desktop e mobile inspecionados visualmente.

Larguras 320, 360, 375, 390, 440, 768, 1024 e desktop 1440px: sem overflow de página; seis chips acessíveis pela rolagem; 12px nos chips e no padding inferior mobile. Alturas 568, 640, 667, 740, 844 e 956px incluídas. A revisão do header conferiu padding de 16px e separação real de 10px entre as linhas.

Validação real Chrome → API Docker → PostgreSQL: cadastro fictício `Validação de loaders e encaminhamento`, seguido de uma solicitação direta. Resultado HTTP 200/HUMAN_REQUESTED, `simulated: true`, exatamente um POST de mensagem e nenhum POST separado a `/handoffs`. Um turno foi persistido e a resposta continuou no histórico após recarregar; notificações fixas vazias antes/depois. A conta fictícia foi preservada. Nenhuma chamada real Gemini/OpenAI ou e-mail foi necessária.

Para depurar, coloque breakpoints no efeito de `useVisualPending`, em `loadLists`, `loadHistory`, `deliver` e `handoff` de `useSupport`. Observe o contador da conversa e a geração da sessão. No DevTools, simule rede lenta, alterne abas durante o POST e confira o histórico sem F5. O spinner pode permanecer brevemente após uma resposta rápida; o resultado e os controles devem já estar disponíveis. Nunca registre tokens, cookies ou conteúdo sensível durante a depuração.

Não houve alteração de backend, banco, migrations ou regras. Não foram executados Git branch, commit, push ou stash. A emulação Chrome não substitui teste físico em Safari/iPhone.
