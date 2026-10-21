# Atendimento humano com consentimento

## Problema e decisão

O helper human de agent.orchestrator.ts registrava HumanHandoff nos ramos OUT_OF_SCOPE, UNKNOWN, referência insuficiente e falha da IA. O modelo apenas classificava a intenção, mas o backend transformava automaticamente essas classificações em registro.

Agora esses ramos chamam offerHuman, que persiste somente a oferta na conversa e pergunta: **Você gostaria de solicitar atendimento humano?** registerHuman só pode ser alcançado por uma decisão explícita vinculada à oferta atual ou por um pedido direto reconhecido deterministicamente.

A categoria HUMAN devolvida pelo modelo, isoladamente, também resulta em oferta. O modelo não autoriza registro. Frases diretas como Quero falar com um atendente, Preciso de atendimento humano e o botão Falar com atendente são solicitações explícitas e dispensam outra pergunta.

## Estado, persistência e protocolo

Migration nova: `apps/api/prisma/migrations/202610210002_handoff_consent/migration.sql`.

Três colunas opcionais em conversations: handoff_offer_id, handoff_offer_reason e handoff_offer_expires_at. Uma constraint exige os três valores completos ou todos nulos. Não há nova tabela nem alteração dos enums de estado; ACTIVE com pendingHandoff representa uma oferta, enquanto HUMAN_REQUESTED continua significando registro efetivo.

A relação já existente da conversa com o cliente vincula a oferta à identidade autenticada. A consulta usa o mesmo isolamento por customerId. O prazo usa CONFIRMATION_TTL_SECONDS, atualmente 300 segundos; não foi criada outra configuração equivalente.

As respostas e GETs de conversa acrescentam:

```json
{
  "pendingHandoff": {
    "offerId": "UUID_DA_OFERTA",
    "expiresAt": "2026-10-20T20:00:00.000Z"
  }
}
```

Quando não existe oferta ativa, pendingHandoff é null. O identificador fica na camada HTTP, sem exibição ao cliente.

Para aceitar pelo POST /conversations/{conversationId}/messages:

```json
{
  "clientMessageId": "NOVO_UUID_DA_MENSAGEM",
  "content": "Sim",
  "handoffOfferId": "UUID_DA_OFERTA_ATUAL"
}
```

Para recusar, envie Não ou Não, obrigado com o mesmo handoffOfferId e outra chave de mensagem. O frontend envia Sim, solicitar atendimento ou Não, obrigado ao clicar. Quando o cliente digita uma dessas decisões, useSupport.send anexa a oferta da conversa selecionada.

Um Sim sem handoffOfferId não registra nada na API, mesmo com oferta pendente: pede a decisão pelos controles atuais. Sem contexto, também não autoriza registro. Recusa simples pode encerrar uma oferta pendente, pois não autoriza nenhuma ação positiva. Respostas ambíguas curtas, como Talvez, pedem esclarecimento. Texto de outro assunto invalida a oferta antiga; se um cliente HTTP enviar outro assunto incorretamente com handoffOfferId, o backend encerra a oferta e pede uma mensagem válida.

Ofertas expiradas, consumidas, antigas ou de outra conversa não autorizam encaminhamento. Oferta humana e desafio de cancelamento usam campos separados; não podem ser enviados juntos. Criar oferta humana invalida o desafio anterior de cancelamento, mantendo a proteção que o fluxo anterior de encaminhamento já aplicava, sem cancelar pedido.

## Atomicidade e compatibilidade

O aceite passa pelo lease e pelo compare-and-swap já utilizados pelo orquestrador. Consumo da oferta, registro e persistência do turno ocorrem na mesma transação. Falhas fazem rollback. A unicidade existente de HumanHandoff.conversationId impede registros duplicados, inclusive entre aceite conversacional e endpoint direto.

O repository de handoffs agora também envolve a atualização da conversa e o upsert em uma transação quando chamado fora do orquestrador. Dentro de uma transação existente, ele a reutiliza.

clientMessageId e o hash incluem handoffOfferId quando presente. O cálculo antigo permanece exatamente igual quando esse campo não é enviado; hashes, mensagens e resultados de turnos anteriores não foram reescritos.

POST /handoffs permanece uma operação direta explicitamente solicitada pelo cliente autenticado. Não é fallback da IA. Na [atualização de feedback do frontend](frontend-feedback.md), o botão Falar com atendente passou a enviar um pedido direto pelo endpoint de mensagens, para que a confirmação seja persistida no histórico em vez de aparecer em um aviso fixo. A classificação é determinística e não depende da IA. Sem conversationId, o endpoint REST anterior permite solicitações independentes; os botões do frontend sempre usam uma conversa. Nenhuma equipe recebe contato: a confirmação informa que o encaminhamento é simulado.

Solicitações que já existiam antes da correção foram preservadas, mesmo que tenham sido geradas pelo comportamento antigo. O histórico não é reescrito.

## Arquivos e funções para estudar

| Arquivo | Responsabilidade |
| --- | --- |
| apps/api/src/modules/agent/agent.orchestrator.ts | plan evita inferência para decisões; offerHuman prepara oferta; execute valida e consome; registerHuman registra somente pelos caminhos autorizados. send preserva lease, idempotência e transação. |
| apps/api/src/modules/handoffs/handoff.consent.ts | handoffDecision reconhece decisões exatas; directHumanRequest reconhece pedidos diretos; ambiguousHandoffReply controla esclarecimento; clearHandoffOffer limpa os três campos juntos. |
| apps/api/src/modules/handoffs/handoff.repository.ts | register verifica titularidade, atualiza a conversa e usa upsert com unicidade, de forma atômica. Serviço e controller existentes continuam em uso. |
| apps/api/src/modules/conversations/conversation.schemas.ts | Validação Zod do campo opcional e rejeição de decisões de dois tipos na mesma mensagem. |
| apps/api/src/modules/conversations/conversation.repository.ts | conversationView expõe apenas ofertas ativas; histórico e listagem usam o mesmo estado. |
| apps/api/src/integrations/openai/agent.prompt.ts | Prompt efetivo compartilhado por Gemini/OpenAI; classificação não representa consentimento. A cópia integral em docs/stage-3.md também foi atualizada. |
| apps/api/src/docs/agent.openapi.ts | Swagger, campo pendingHandoff, exemplos de aceite/recusa e códigos de resultado. |
| apps/web/src/components/HandoffOffer.tsx | Pergunta, duas opções, expiração e bloqueio durante envio; reutiliza os estilos do chat. |
| apps/web/src/components/Chat.tsx | Inclui a oferta da conversa atual e mantém o aviso de simulação após registro. |
| apps/web/src/hooks/useSupport.ts | decideHandoff usa o identificador atual; envio digitado pode anexá-lo. O bloqueio por conversa e o retry da mesma mensagem continuam em uso. |
| apps/web/src/services/api.ts e types.ts | handoffDecisionMessage, reconhecimento das decisões e campos de transporte. |

Fluxo: HandoffOffer → useSupport.decideHandoff → handoffDecisionMessage → createApi.send → controller.send/Zod/CSRF → agent.send/plan/execute → handoffDecision → registerHuman → handoff.service.register → handoff.repository.register → PostgreSQL → estado e histórico React.

Coloque breakpoints em offerHuman antes de update, execute ao comparar input.handoffOfferId, registerHuman e repository.register antes do upsert. No frontend, acompanhe support.history.pendingHandoff, decideHandoff e deliver. Não acrescente logs de tokens, cookies ou conteúdo sensível.

## Intenções e limites atuais

O agente suporta status de pedidos próprios, produtos do pedido/Fake Store, solicitação de cancelamento, confirmação/desistência seguras e solicitação humana. UNKNOWN pede esclarecimento; OUT_OF_SCOPE explica a limitação e oferece atendimento. Não há troca de produto, cupom, reembolso, rastreamento detalhado ou equipe real.

| Controle | Valor atual |
| --- | --- |
| Mensagem recebida | 1–2000 caracteres após trim |
| Contexto do modelo | Últimos 6 turnos, até 12 mensagens, cada conteúdo limitado a 800 caracteres |
| Controle antes da inferência | 30 turnos persistidos recentes por cliente em 60 segundos; retorna 429 AGENT_RATE_LIMITED |
| Confirmações e pedido humano direto | Determinísticos, sem chamada ao modelo; não passam pelo contador de inferência |
| TTL da oferta e da confirmação de cancelamento | 300s na configuração local; CONFIRMATION_TTL_SECONDS aceita 30–900s |
| Gemini / OpenAI / Fake Store | 30000ms / 10000ms / 5000ms na configuração local |
| HTTP do frontend | 45000ms; falha incerta usa reconciliação e retry idempotente existentes |
| Produtos complementares | Até 10 por consulta de pedido |
| Paginação | Até 100 registros por página; frontend percorre as páginas |
| Concorrência | Um turno em execução por conversa; outras conversas continuam independentes |

Não existe limite de três perguntas por conversa. O contador de 30 considera turnos persistidos, inclusive os determinísticos quando uma inferência posterior consultar o total. Ele não representa um limitador distribuído estrito de requisições em voo entre várias conversas. Cotas adicionais do fornecedor continuam dependendo da conta Gemini/OpenAI; não foram alteradas nem presumidas.

## Casos e resultados

| Cenário e condições | Resultado esperado/verificado |
| --- | --- |
| Fora do escopo, UNKNOWN ou pedido ambíguo | Oferta persistida e zero HumanHandoff |
| IA indisponível, timeout ou JSON inválido | Explicação e oferta; zero registro automático |
| Sim com identificador atual | Um registro, oferta consumida e aviso de simulação |
| Não/Não, obrigado | Sem registro; conversa pode continuar consultando pedidos |
| Talvez ou Sim sem identificador | Esclarecimento; nenhuma autorização presumida |
| Expirada, outro titular/conversa ou oferta antiga | Nenhum registro; erro conversacional padronizado/404 quando aplicável |
| Mudança de assunto | Oferta anterior invalidada |
| Pedido direto reconhecido ou botão explícito | Registro sem depender da disponibilidade da IA |
| Replay, duplo clique e confirmações concorrentes | Idempotência, lease e unicidade mantêm um registro por conversa |
| Troca de abas/conversa | Oferta da origem preservada; não aparece em outra conversa |
| Cancelamento | Fluxos anteriores continuam testados, sem aceitar consentimento humano como cancelamento |

Validação automatizada: 135 testes unitários backend, 59 frontend e 109 de integração PostgreSQL; serviços externos simulados na suíte. Typecheck e builds dos dois workspaces aprovados. Swagger mantém referências e segurança validadas pelos testes.

No navegador, a oferta e a recusa foram verificadas com respostas HTTP simuladas, incluindo as sete larguras 320, 360, 375, 390, 768, 1024 e 1440px, sem overflow da página. Seleção de outra conversa não mostrou a oferta alheia; o retorno restaurou os controles.

Validação real: conta fictícia exclusiva, uma consulta Gemini retornou OUT_OF_SCOPE; a oferta apareceu, o aceite retornou HUMAN_REQUESTED e simulated=true; oferta consumida e registro preservado após reload. PostgreSQL confirmou um único HumanHandoff. Não houve nova inferência para aceitar. A conta e seus dados de teste foram mantidos.

Migration aplicada primeiro no banco de testes e depois na aplicação, com API pausada e backup em .temp/support-handoff-consent.dump, ignorado pelo Git. Contagens e fingerprints dos campos anteriores de dez tabelas conferiram antes/depois. Migrations anteriores, registros, histórico e hashes foram preservados.

Durante a validação, localhost:5173 via IPv6 apontava para outro servidor local, enquanto o Docker Support AI respondia por 127.0.0.1. Não encerramos nem alteramos esse outro projeto. O Chrome de teste foi iniciado isoladamente com localhost resolvendo para 127.0.0.1, preservando a origem configurada para cookies/CSRF. O conflito local precisa ser resolvido pelo gerenciamento dos servidores para voltar ao endereço habitual; não foram alteradas as configurações de autenticação ou CORS.
