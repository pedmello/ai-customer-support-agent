# Etapa 4 — Frontend Support AI

Implementação React/TypeScript do cadastro demonstrativo, atendimento, conversas e pedidos. As quatro referências aprovadas orientam cores, tipografia, proporções, cards, navegação e adaptação mobile. Nenhuma regra do backend, migration, integração de IA ou configuração do Compose foi alterada nesta etapa.

## Executar

Na raiz, com `.env` já configurado:

```powershell
npm ci
npm run dev
```

Não execute Vite/API e os respectivos containers nas mesmas portas. Para usar a aplicação inteira no Docker já provisionado:

```powershell
docker compose up -d --build --wait
```

Para atualizar exclusivamente a interface:

```powershell
docker compose up -d --build --no-deps web
```

Frontend: http://localhost:5173 · API: http://localhost:3000 · Swagger: http://localhost:3000/docs/.

Variáveis existentes: `VITE_API_URL` é pública e incorporada no build; `WEB_ORIGIN` precisa corresponder à origem do navegador; `API_PUBLIC_URL` controla a política do cookie. Use o mesmo hostname (localhost) em ambos. Nunca coloque chaves Gemini/OpenAI em variáveis `VITE_`. Nenhuma nova variável é necessária. Em acesso HTTPS, mantenha API e frontend em HTTPS e preserve o cookie Secure. Publicação em origens de sites diferentes depende da política SameSite existente; esta etapa utiliza as origens locais já suportadas.

## Contratos inspecionados e utilizados

| Operação | Endpoint existente | Comportamento da interface |
| --- | --- | --- |
| Cadastro | POST /customers | Nome/e-mail; recebe cliente, sessão e CSRF; backend cria três pedidos |
| Recuperar sessão | GET /sessions/current | Restaura cliente/CSRF ao recarregar; 401 abre cadastro |
| Sair | DELETE /sessions/current | Cookie + CSRF; limpa memória somente após revogação confirmada |
| Pedidos | GET /orders | Carrega páginas; busca e filtros são locais |
| Conversas | GET /conversations | Carrega páginas; exibe lista completa na seção Conversas |
| Criar conversa | POST /conversations | Corpo vazio; novo contexto independente |
| Histórico | GET /conversations/:id | Percorre todas as páginas de turnos em ordem cronológica |
| Mensagens | POST /conversations/:id/messages | UUID por mensagem lógica; conteúdo até 2.000 caracteres |
| Atendimento humano | POST /handoffs | Motivo CUSTOMER_REQUEST e conversa; encaminhamento simulado |

Não há chamada do frontend a `/orders/:id/cancel`. Não foram criadas APIs, chamadas diretas ao provedor de IA ou chamadas diretas ao catálogo no navegador (exceto imagens HTTPS autorizadas retornadas pelo backend).

## Telas e comparação com as referências

1. Cadastro desktop: área cinza de apresentação à esquerda e formulário branco à direita. Mobile: logo, benefícios e formulário em coluna única. Texto explica a demonstração e a ausência de verificação de e-mail. Não promete localizar compras reais.
2. Atendimento desktop: sidebar, painel de conversas/pedidos e chat. Mensagens azuis à direita e cinzas à esquerda, cards de pedidos, sugestões, compositor inferior e estado de processamento. Mobile: cabeçalho compacto e navegação por seções; painel intermediário substituído pelas seções Pedidos/Conversas.
3. Pedidos desktop: lista com busca e filtros; detalhes com status, itens, total e identificação. Mobile: lista e detalhe em visualizações separadas, com botão de retorno. As ações levam ao chat em uma nova conversa.
4. Estados: inicialização, envio, atualização, cadastro, erro de rede/API, vazio, sessão encerrada, confirmação expirada, encaminhamento simulado e repetição de mensagem incerta.

Adaptações intencionais:

- O backend cria três pedidos e usa USD; não reproduzimos os quatro produtos, nomes, valores em reais e datas ilustrativas das imagens.
- Sem endereço, pagamento, frete, previsão de entrega, reembolso ou etapas inventadas de rastreamento. O painel informa apenas status e datas existentes.
- Imagens não são armazenadas no pedido. Usamos um ícone neutro; consultas de produtos pelo agente podem mostrar a imagem real recebida do catálogo. Imagens são limitadas a HTTPS em fakestoreapi.com, sem referrer e com fallback visual.
- Atendimento humano é simulado, sem promessa de contato nem equipe online. O indicador do assistente não representa disponibilidade monitorada do provedor.
- Sem anexos, menus sem ação, termos/políticas inexistentes ou recuperação de conta.
- A fonte utiliza a pilha Inter/sistema sem download externo; a família exata da referência não foi identificada. Os ícones são SVG locais.
- No mobile os detalhes são uma visualização própria, alternativa aprovada ao painel inferior da imagem.

## Estado e segurança

`useSupport` concentra sessão, pedidos, conversas, históricos por ID e resultados de mensagens. Não há Redux, router ou biblioteca de cache em produção. A seção e seleção atuais são estado React; recarregar retorna ao atendimento e abre a conversa mais recente. O backend continua sendo a fonte persistente de histórico e estados.

Sessão: cookie HttpOnly gerenciado pelo navegador, `credentials: include`, CSRF em memória. Nenhum token em localStorage/sessionStorage, URL ou logs do frontend. O cliente nunca envia customerId para autorizar uma operação.

Confirmação:

1. `askOrder(orderId, true)` cria conversa e envia uma solicitação real.
2. O backend devolve `pendingConfirmation` com pedido, desafio e validade.
3. `ConfirmationPanel` apresenta Manter pedido / Cancelar pedido e não renderiza o desafio.
4. `decisionMessage` produz `content: CONFIRMAR CANCELAMENTO` ou `DESISTIR`, com o desafio no campo `confirmationId` e UUID próprio de mensagem.
5. O backend valida titularidade, conversa, expiração, uso único e status. A UI só apresenta o resultado retornado.
6. Bloqueio síncrono por ref evita duplo clique/envios paralelos. Relógio local desabilita desafio expirado como auxílio visual; a validação decisiva é sempre no servidor.

Falha incerta de mensagem (rede, timeout, 5xx, ocupação ou rate limit) mantém exatamente o corpo/UUID para repetição manual. Não há repetição automática de mutações. Novas mensagens/ações ficam bloqueadas enquanto essa repetição aguarda resolução. Um envio confirmado não é reenviado por falha posterior na atualização das listas.

O HTTP tem prazo de 45 segundos. Abortar uma espera não garante cancelamento da operação no servidor. A confirmação e a idempotência existentes continuam obrigatórias.

React renderiza textos como texto, sem HTML/Markdown executável. Mensagens do modelo e dados externos não modificam o fluxo de autorização. Erros HTTP são traduzidos por código; detalhes internos enviados pelo servidor não são exibidos.

## Histórico e cards

O endpoint de histórico fornece mensagens, estado e confirmação atual, mas não inclui os snapshots estruturados de pedido/produto de cada turno. Nesta etapa:

- textos e estado persistidos são restaurados integralmente, percorrendo as páginas;
- cards recebidos durante a sessão em memória acompanham os turnos correspondentes;
- após recarregar, textos permanecem e esses cards históricos não são reconstruídos artificialmente;
- um card representa o status na resposta em que foi recebido; lista e detalhes são sincronizados com a API após cada envio;
- títulos e prévias são derivados de mensagens já carregadas. Conversas ainda não abertas usam a data como título, pois o contrato não oferece título/resumo.

## Verificações realizadas em 19/10/2026

| Verificação | Resultado |
| --- | --- |
| Typecheck dos dois workspaces | Aprovado |
| Build dos dois workspaces | Aprovado |
| Vitest API (mocks externos) | 90 aprovados |
| Vitest frontend (HTTP simulado, React Testing Library/jsdom e renderização) | 29 aprovados |
| Integração API com PostgreSQL de testes real, IA/catálogo simulados | 67 aprovados |
| Total automatizado | 186 aprovados |
| Migrations do banco de testes | Duas existentes; nenhuma pendente; nenhuma migration nova |
| Docker web | Build e atualização exclusiva do frontend |
| API healthcheck real | HTTP 200, database up |

Comandos:

```powershell
npm run typecheck
npm run build
npm test
npm run test:integration
npm run test -w @support/web
```

### Navegador com serviços reais

Chromium automatizado via Playwright, aplicação servida pelo Nginx/Docker e API/PostgreSQL existentes:

- cadastro de um único cliente fictício exclusivo e leitura dos três pedidos;
- consulta de status pelo agente Gemini real;
- solicitação de cancelamento de PROCESSING pela tela de pedidos;
- exibição do desafio sem expor confirmationId;
- confirmação pelos botões e resposta real de sucesso;
- pedido CANCELLED nos detalhes e resposta persistida após recarregar;
- leitura do catálogo complementar Fake Store pelo agente, com resultado disponível;
- solicitação de atendimento humano pelo endpoint próprio;
- navegação de pedidos/conversas, filtros e adaptação mobile;
- encerramento de sessão e rejeição de novo cadastro com e-mail já existente.

Foram três mensagens que exigiram inferência real (status, solicitação de cancelamento e produtos). Confirmar e solicitar encaminhamento pelo botão não exigem inferência. Testes automatizados não dependem dessas APIs externas. Registro exclusivo do teste removido ao final; dados anteriores preservados.

Cadastro, chat e pedidos foram verificados sem rolagem horizontal em 320, 360, 375 e 390 px. Pedidos também em 768, 1024 e 1440 px. Screenshots desktop/mobile foram comparados individualmente com as quatro referências; corrigida sobreposição de status/data no resumo lateral. Não houve teste em dispositivo físico, teclado virtual real ou Safari. Uma resposta 401 na sondagem inicial de sessão sem cookie é esperada e pode aparecer no console de rede; não representa exceção JavaScript.

### Casos de teste documentados

| Objetivo | Cenário/condição | Resultado esperado |
| --- | --- | --- |
| Proteger identidade | Cadastro com e-mail duplicado | Mensagem amigável, sem sessão concedida |
| Restaurar atendimento | Sessão válida ao recarregar | Cliente, pedidos e histórico recuperados |
| Distinguir indisponibilidade | Inicialização retorna 503 | Erro com tentativa novamente; não tratar como visitante |
| Encerrar sessão | DELETE falha / depois tem sucesso | Dados mantidos na falha; removidos após sucesso |
| Evitar duplicação | Dois envios no mesmo instante | Uma única operação em andamento |
| Recuperar envio incerto | Falha de rede e repetição manual | Mesmo UUID e conteúdo; sem nova operação lógica |
| Preservar sucesso real | POST bem-sucedido e GET posterior falha | Resposta mantida; nenhum retry de mutação |
| Confirmar com segurança | Desafio válido e clique duplo | Frase exata/campo separado; um único envio |
| Desistir | Botão Manter pedido | DESISTIR com o desafio atual |
| Impedir uso expirado | Data do desafio no passado | Nenhum botão de execução; solicitar novo fluxo |
| Evitar cancelamento direto | Ação no detalhe de PROCESSING | Nova conversa + mensagem, sem endpoint REST de cancelamento |
| Respeitar status | SHIPPED/CANCELLED | Sem botão de solicitação no detalhe |
| Filtrar | Busca local e filtros de status | Apenas correspondências; vazio informativo |
| Evitar XSS | Título com script / imagem fora do catálogo | Texto escapado / imagem rejeitada |
| Preservar valores | Pedido em USD | Formatação em USD, sem conversão inventada |
| Encaminhar | Botão de atendente | Registro simulado, sem inferência ou promessa de contato |

## Limites e continuidade

Identidade continua demonstrativa, sem posse de e-mail comprovada. Retorno a conta após revogar/perder o cookie não é implementado. O histórico pode conter dados enviados pelo próprio usuário; a UI orienta não enviar dados sensíveis, e o backend preserva sua redação de credenciais.

Não há streaming: o backend retorna um turno completo. Não há upload, busca remota, edição de pedidos, sincronização por websocket ou persistência local de rascunhos/retries. Uma recarga durante envio incerto perde a chave local; consulte o histórico e atualize antes de iniciar outra operação. O backend mantém uso único do desafio e status atômico mesmo nessa situação. Listas e históricos completos em memória são adequados à demonstração; volumes grandes exigirão paginação visual/virtualização em etapa própria.

Nenhuma alteração em frontend pode garantir disponibilidade ou cota Gemini; falhas usam o resultado seguro do backend. Não foi iniciado trabalho de Etapa 5. Não foram executados branch, commit, stash ou push. A Etapa 4 está pronta para revisão e commit manual.

## Arquivos desta entrega

Criados:

- `apps/web/src/types.ts`
- `apps/web/src/services/api.ts` e `api.test.ts`
- `apps/web/src/hooks/useSupport.ts` e `useSupport.test.tsx`
- `apps/web/src/components/Registration.tsx`, `Navigation.tsx`, `Conversations.tsx`, `Chat.tsx`, `Orders.tsx`, `ExternalProducts.tsx` e `ui.tsx`
- `apps/web/src/components/presentation.test.tsx` e `interactions.test.tsx`
- `docs/stage-4.md` e `docs/code-walkthrough-stage-4.md`

Alterados: `apps/web/src/App.tsx`, `apps/web/src/styles.css`, `apps/web/index.html`, `apps/web/package.json`, `package.json`, `package-lock.json` e `README.md`. A entrada `main.tsx` mantém seu conteúdo original. `docs/stage-3.1-gemini.md` já estava modificado antes desta tarefa e não foi editado nesta etapa.

Capturas de cadastro, atendimento, confirmação e pedidos em desktop e mobile foram usadas na revisão visual. Elas permanecem apenas localmente em `docs/assets/stage-4/`, pasta ignorada pelo Git e excluída do contexto de build do Docker. As imagens de referência do layout também não fazem parte da entrega versionada.

As capturas de confirmação registram o momento anterior à execução. As capturas finais de listas e histórico registram o estado posterior; não são dados de clientes reais.
