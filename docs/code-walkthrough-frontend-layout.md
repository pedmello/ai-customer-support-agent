# Guia de estudo da navegação e do novo layout

## Ordem de leitura

1. **apps/web/src/App.tsx — App:** escolhe autenticação ou aplicação, guarda a aba atual, o pedido selecionado e a abertura do histórico no mobile. A composição muda, mas a instância de useSupport permanece no topo e preserva os dados ao alternar abas.
2. **apps/web/src/components/Navigation.tsx — Navigation:** recebe cliente, aba ativa, callbacks de navegação/logout e estado de processamento. Não autentica nem busca dados. aria-current identifica a aba selecionada.
3. **apps/web/src/components/Conversations.tsx:** conversationTitle apresenta o primeiro texto disponível, adaptando referências públicas. ConversationList renderiza a seleção; ContextPanel reúne conversas recentes; OrderRail reúne pedidos. ConversationsPage controla somente busca e filtro locais. Não há filtro fictício de conversas encerradas.
4. **apps/web/src/components/Chat.tsx — Chat:** renderiza histórico e respostas, controla rascunho e rolagem. ConfirmationPanel apresenta a confirmação que veio do servidor, observa a expiração e bloqueia ações durante processamento. O headset mobile chama o mesmo handoff do botão desktop.
5. **apps/web/src/components/Orders.tsx:** Orders filtra pedidos e seleciona o detalhe. OrderDetails é reutilizado no painel desktop e no card mobile. OrderCard é o resumo dentro do chat. Nenhum desses componentes decide se a API deve efetivar um cancelamento.
6. **apps/web/src/hooks/useCompactLayout.ts — useCompactLayout:** usa useSyncExternalStore para acompanhar matchMedia e reposicionar uma única instância de OrderDetails. O breakpoint é o mesmo de styles.css. Não acessa servidor ou credenciais.
7. **apps/web/src/hooks/useSupport.ts — useSupport:** concentra sessão, dados carregados, históricos, respostas, locks e mensagens pendentes. Os métodos existentes boot, select, create, send, askOrder, decide, deliver, retrySend e handoff continuam responsáveis pelos fluxos.
8. **apps/web/src/services/api.ts:** createApi envia requests com cookies e CSRF; decisionMessage encapsula o protocolo técnico. A interface visual não precisa exibir o identificador de confirmação.
9. **apps/web/src/styles.css:** tokens globais, autenticação, cabeçalho, painéis, chat, pedidos e conversas; media queries adaptam a composição. Os nomes de classe correspondem aos componentes acima.

## Percurso de uma consulta ou cancelamento

No card do pedido, Perguntar no chat chama onAsk(orderNumber, false); Solicitar cancelamento chama onAsk(orderNumber, true). App muda para Atendimento e chama useSupport.askOrder, que cria uma conversa independente e envia a mensagem pelo cliente HTTP.

A resposta real entra em deliver, atualiza o histórico e os resultados usados por Chat, OrderCard e ExternalProducts. As listas são sincronizadas pelo hook. Dados de produtos são complementares; o valor e o status continuam vindo da API principal.

Se o backend responder com pendingConfirmation, ConfirmationPanel mostra os botões. Cancelar pedido chama decide(true); Manter pedido chama decide(false). decisionMessage envia o confirmationId e o conteúdo exato esperado, com clientMessageId. O backend revalida sessão, titularidade, expiração, uso único e status. A interface só comunica sucesso quando recebe esse resultado.

No mobile, o lugar do detalhe do pedido muda. O callback onAsk e o protocolo acima são exatamente os mesmos. Para reduzir duplicação, não existe um segundo serviço de pedidos para mobile.

## Navegação e estado

App guarda section, orderId e conversationOpen. Estes são estados de apresentação. useSupport guarda os dados da API e a seleção de conversa. Essa separação permite abrir uma conversa na aba Conversas, voltar à lista e continuar no Atendimento sem descartar o histórico.

Em Conversas, a seleção chama support.select e abre o detalhe. No desktop ele fica ao lado da lista; no mobile conversation-open alterna os painéis. Voltar altera somente a apresentação, não encerra nem apaga uma conversa.

No cadastro/login/recuperação, Authentication mantém seus formulários existentes e usa AuthLayout e PasswordField. O novo CSS aplica a mesma identidade visual sem mudar endpoints, política de senha ou envio de e-mail.

## Como depurar no VS Code

- Em App, coloque breakpoint em openOrder, onNavigate e no callback onAsk: observe a troca de aba e o número público.
- Em Orders, acompanhe query, filter, selected e showDetails. Em useCompactLayout, acompanhe snapshot ao redimensionar o navegador.
- Em ConversationsPage, confira normalized, list e os estados reais da API. Uma conversa não carregada ainda não oferece texto completo para busca local.
- Em useSupport, pare em askOrder, deliver e decide. Confira ordem dos eventos e sincronização das listas; não copie tokens, códigos ou senhas para logs.
- Em api.ts, pare no request para verificar método, caminho e status. Inspecione os dados fictícios pelo painel Network; não exporte cookies ou credenciais.
- Use o modo responsivo do navegador em 320, 360, 375, 390, 768, 1024 e 1440px. Examine app-header, workspace-content, orders-page e composer no painel de estilos.

## Testes para acompanhar

layout.test.tsx cobre navegação, logout, busca/filtros e expansão mobile. interactions.test.tsx cobre confirmação, desistência, expiração e ação conversacional do pedido. authentication.test.tsx cobre os formulários; improvement-orders.test.tsx cobre imagens, número público e moedas; useSupport.test.tsx e api.test.ts cobrem a comunicação existente.

Os 96 testes PostgreSQL executados nesta revisão usam provedores externos simulados. O teste real da IA encontrou indisponibilidade, portanto não confunda a validação do protocolo e da interface com uma inferência real bem-sucedida nesta entrega.
