# Logs estruturados

Pino gera JSON em stdout. `app.ts` cria um X-Request-Id por requisição e `requestCorrelation` o mantém em AsyncLocalStorage durante chamadas assíncronas. Não se aceita um ID livre do cliente como identidade/autorização. Integrações invocadas fora de HTTP podem não ter requestId.

`observeOperation` registra event, result e durationMs. Falhas usam código interno controlado, nunca mensagem/stack do erro. O agente registra o resultado após o commit; replayed=true identifica devolução de um turno persistido, sem nova execução. Um log ORDER_CANCELLED com replayed=true não representa outro cancelamento. Controllers registram consultas e cancelamento REST; Fake Store registra resultado AVAILABLE, PRODUCT_NOT_FOUND, PRODUCT_TIMEOUT, PRODUCT_INVALID_RESPONSE ou PRODUCT_UNAVAILABLE. Degradação externa usa nível warn.

Os adaptadores Gemini/OpenAI incluem requestId, modelo, duração e categoria/código seguro. No Gemini, o código seguro aparece em `failureCode` e `result`: a configuração do logger censura qualquer chave `code` para proteger códigos de recuperação de senha. Gemini preserva tentativa e prazo total. Não se registram mensagens, prompts, resposta bruta do modelo/catálogo, e-mails, nome de cliente, senha, código de recuperação, hashes, cookies, CSRF ou chaves. O logger HTTP existente limita a requisição a ID, método e caminho sem query string.

## Exemplos sanitizados

As linhas abaixo são **ilustrativas**, com IDs e tempos fictícios, não evidências de execução. Campos do logger HTTP podem acompanhar as operações REST; foram omitidos aqui para destacar os eventos.

```json
{"level":30,"time":1792584000000,"service":"support-api","event":"orders.query","requestId":"example-request-1","result":"ORDER_FOUND","durationMs":4,"msg":"Operation completed"}
{"level":30,"time":1792584000010,"service":"support-api","event":"agent.turn","requestId":"example-request-2","result":"CONFIRMATION_REQUIRED","replayed":false,"durationMs":950,"msg":"Operation completed"}
{"level":30,"time":1792584000020,"service":"support-api","event":"agent.turn","requestId":"example-request-3","result":"ORDER_CANCELLED","replayed":false,"durationMs":12,"msg":"Operation completed"}
{"level":30,"time":1792584000030,"service":"support-api","event":"agent.turn","requestId":"example-request-4","result":"ORDER_CANCELLED","replayed":true,"durationMs":2,"msg":"Operation completed"}
{"level":40,"time":1792584000040,"service":"support-api","event":"orders.cancel","requestId":"example-request-5","result":"ORDER_NOT_CANCELLABLE","durationMs":5,"msg":"Operation failed"}
{"level":30,"time":1792584000050,"service":"support-api","event":"fake_store.lookup","requestId":"example-request-6","result":"AVAILABLE","durationMs":130,"msg":"Operation completed"}
{"level":40,"time":1792584000055,"service":"support-api","requestId":"example-request-8","integration":"gemini","provider":"gemini","model":"gemini-3.5-flash-lite","attempt":1,"durationMs":296,"totalDurationMs":296,"category":"RATE_LIMIT","status":429,"failureCode":"AI_UNAVAILABLE","result":"AI_UNAVAILABLE","retry":false,"msg":"Intent interpretation failed"}
{"level":40,"time":1792584000060,"service":"support-api","event":"fake_store.lookup","requestId":"example-request-7","result":"PRODUCT_TIMEOUT","durationMs":5000,"msg":"Operation completed"}
```

## Diagnóstico

Use `docker compose logs -f api` e procure o X-Request-Id recebido na resposta. No mesmo ID, `fake_store.lookup` explica o catálogo e `agent.turn` informa o resultado persistido. AI_TIMEOUT é um resultado atendido com fallback, não sucesso de cancelamento. MESSAGE_ID_CONFLICT e CONVERSATION_BUSY aparecem como falhas da operação, mantendo o HTTP original.

Logs não substituem o estado atual no PostgreSQL nem o histórico retornado pela API. As durações são observações, não SLA. Não há métricas, tracing distribuído ou armazenamento central nesta demonstração; a correlação é local à requisição. Testes de logs verificam isolamento concorrente, payload ausente, códigos de erro, resultados Fake Store e replay após confirmação.
