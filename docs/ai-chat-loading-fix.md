# Correção do bloqueio durante o atendimento

## Diagnóstico

O caminho foi conferido de Chat.submit até createApi.send, o controller de mensagens, agent.send, persistência da resposta e retorno ao hook.

Havia dois problemas reproduzíveis no frontend:

1. send/askOrder/decide usavam perform, que mantinha locked e busy globais durante o POST e a sincronização posterior. Navigation e ConversationList desabilitavam seus botões a partir desse busy.
2. deliver inseria a resposta recebida no estado, mas loadHistory substituía o histórico inteiro. Um GET anterior podia apagar temporariamente a resposta confirmada. Esperar os GETs seguintes também mantinha o composer bloqueado depois do POST concluído.

Os quatro primeiros testes de regressão falharam no código anterior: bloqueio global, resposta sobrescrita, resultado persistido não recuperado após falha de rede e logout bloqueado pelo envio.

Separadamente, os logs existentes mostravam Gemini com categoria PROVIDER_TIMEOUT e duração aproximada de 29,9s. O container estava configurado com GEMINI_TIMEOUT_MS=30000. Isso explica uma espera no provedor, mas não justifica bloquear as abas ou perder a resposta. Não foi aumentado o timeout nem alterada a integração de IA.

## Correção e arquivos

| Arquivo | Papel |
| --- | --- |
| apps/web/src/hooks/useSupport.ts | Envio, retry, erro e processamento por conversationId; merge de históricos; sincronização em background e proteção contra respostas de sessão encerrada. |
| apps/web/src/components/Chat.tsx | Indicador, bloqueio do composer e erro somente da conversa selecionada; mantém visível o texto cujo envio ainda está sem confirmação. |
| apps/web/src/components/Navigation.tsx | Abas continuam navegáveis; logout mantém sua proteção durante operações globais de sessão. |
| apps/web/src/components/Conversations.tsx | Seleção permitida durante inferência; mostra Assistente respondendo apenas na linha correspondente. |
| apps/web/src/App.tsx | Uma mensagem incerta de outra conversa não bloqueia ações que criam um fluxo independente para pedidos. |
| apps/web/src/hooks/useSupport.test.tsx | Regressões de concorrência, isolamento do processamento, sincronização e logout. |
| apps/web/src/components/interactions.test.tsx | Texto do cliente preservado na interface após erro de rede. |
| apps/web/src/components/layout.test.tsx | Navegação permanece acessível com uma operação em andamento. |
| apps/web/src/services/api.test.ts | Deadline HTTP de 45s e ausência de repetição automática de mutações. |

services/api.ts e o backend não precisaram de alterações nesta correção.

## Como estudar o fluxo

Chat.submit chama support.send. O hook captura a conversa de origem e deliver registra o envio em pendingRef antes do próximo render, impedindo duplo clique naquela conversa. Outras conversas mantêm seus próprios estados.

Quando o POST responde, deliver atualiza imediatamente o histórico, os outcomes e o pedido retornado. mergeHistory conserva turnos já confirmados que estejam ausentes em um GET antigo e substitui versões locais pelo turno persistido de mesmo clientMessageId quando ele chega. A navegação não altera a conversa à qual a resposta pertence.

Os GETs de sincronização passam a ocorrer em background. Uma revisão dos dados evita que uma listagem iniciada antes de outra operação concluída sobrescreva seu resultado. storeHistory reúne as atualizações de histórico sem apagar uma resposta confirmada.

Se o resultado do POST for incerto, reconcile consulta o histórico e procura o clientMessageId exato. Há uma leitura imediata e até três novas leituras, com intervalos de 1,5s, 3s e 6s entre tentativas. Não há reenvio automático de POST. Depois desse limite, continua disponível o retry manual com a mesma chave, conteúdo e confirmationId.

Os intervalos não substituem o timeout HTTP: cada GET segue o limite já existente de 45s. A recuperação é limitada e pode não concluir automaticamente durante uma indisponibilidade prolongada; isso não bloqueia as abas.

epoch invalida resultados antigos ao encerrar a sessão ou desmontar o hook. clear remove os estados de mensagens e cancela os timers. Nenhuma resposta atrasada pode repovoar o histórico da conta após logout.

Breakpoints úteis: Chat.submit; useSupport.deliver antes/depois de client.send; storeHistory e mergeHistory; reconcile na comparação de clientMessageId; clear ao sair da sessão. Inspecione os IDs apenas no debugger, sem registrar cookies, tokens, senhas ou conteúdo sensível.

## Segurança preservada

Continuam iguais cookies HttpOnly, CSRF, autorização, confirmação explícita, expiração, idempotência e regras determinísticas de cancelamento. Uma falha de transporte não é tratada como operação desfeita. O resultado persistido ou a resposta confirmada da API continuam sendo necessários para afirmar sucesso. Nenhuma resposta artificial foi adicionada à produção.

## Validação em 20/10/2026

- 55 testes do frontend aprovados, incluindo confirmação, desistência, expiração, bloqueio de duplo clique, retry, autenticação e novas regressões.
- Typecheck e build aprovados nos dois workspaces.
- Navegador desktop 1440px e mobile touch 390px: resposta simulada com atraso de 6s, abas utilizáveis, seleção de outra conversa sem spinner indevido e resposta exibida sem reload. Um POST por cenário; nenhum erro JavaScript.
- Teste real no mobile com backend, PostgreSQL e Gemini: uma consulta de status, HTTP 200, code ORDER_STATUS, aproximadamente 13s. As três abas foram utilizadas durante a espera; a resposta apareceu automaticamente e o composer foi liberado. Uma conta fictícia exclusiva foi criada e mantida para esse teste.
- Timeout HTTP, recuperação de resultado persistido e fallback foram cobertos com mocks controlados. Não foi provocada indisponibilidade real do provedor.
- Docker: apenas a web foi reconstruída; nenhuma migration, exclusão de registros ou reset do banco.

Não houve branch, commit, push ou stash.
