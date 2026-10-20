# Leitura do banco no DBeaver

Esta documentação acompanha a Implementação 1. O banco mantém UUIDs nas chaves e relacionamentos; o número público de pedido é uma referência legível adicional, não uma credencial.

## Conexão

- PostgreSQL no host: `localhost:5434`.
- Banco padrão: `support_agent`.
- JDBC: `jdbc:postgresql://localhost:5434/support_agent`.
- Usuário e senha: valores locais de `POSTGRES_USER` e `POSTGRES_PASSWORD`, no `.env` da raiz.
- No DBeaver: atualize a conexão e abra `Schemas → public → Views`.

As views são administrativas e mostram dados de vários clientes. Não substituem autorização da API nem devem ser expostas como endpoints públicos. Para uso administrativo compartilhado, conceda acesso somente de leitura a usuários apropriados. Não há concessão pública de permissões nesta migration.

## Tabelas e relacionamentos

| Tabela | Conteúdo / vínculos |
| --- | --- |
| customers | Cliente demonstrativo; customer_id UUID é referenciado pelas demais entidades |
| orders | order_id UUID interno; order_number inteiro único; FK customer_id; status, moeda e datas |
| order_items | FK order_id; product_id da Fake Store; snapshot de nome, descrição, categoria, imagem, versão, quantidade e preço oficial em centavos |
| sessions | Sessões e hashes; não incluídos nas views |
| conversations | FK customer_id; IDs internos de último pedido e pedido pendente; estado conversacional |
| conversation_turns | Entrada lógica, hash de idempotência e resultado original persistido |
| messages | Mensagens USER/ASSISTANT vinculadas ao turno |
| human_handoffs | Solicitações simuladas de atendimento humano |

Os campos last_order_id/pending_order_id existentes são referências internas validadas pelo backend; esta entrega não os transforma em novas FKs nem modifica sua semântica. Os joins das views também exigem coincidência do cliente, evitando associação cruzada na leitura.

## Views versionadas

Criadas pela migration `202610200001_public_orders_catalog_views`:

- `v_support_orders`: nome do cliente, número público, status, moeda, total em centavos e datas. Uma linha por pedido, inclusive pedido sem itens (total zero).
- `v_support_order_items`: nome do cliente, número, status, moeda, referência externa, nome/imagem/categoria/versão do produto, quantidade, preço unitário e subtotal.
- `v_support_conversations`: nome do cliente, identificador da conversa, estado persistido, números dos pedidos de contexto/pendente, validade da confirmação e datas. Não mostra confirmationId.

Não incluem e-mails, senhas, hashes, tokens de sessão, cookies, chaves de IA, códigos de recuperação ou corpos de mensagens. Nomes de clientes continuam sendo dados pessoais; mantenha o acesso administrativo restrito. O estado é o estado persistido: uma confirmação vencida pode continuar registrada como AWAITING_CONFIRMATION até a próxima interação; verifique também confirmation_expires_at. A API calcula sua validade atual.

## Consultas úteis, somente leitura

```sql
SELECT customer_name, order_number, status, currency,
       total_cents, total_cents / 100.0 AS total,
       created_at, cancelled_at
FROM v_support_orders
ORDER BY order_number;
```

```sql
SELECT order_number, product_id, product_name, quantity,
       currency, unit_price_cents / 100.0 AS unit_price,
       subtotal_cents / 100.0 AS subtotal, catalog_version, image_url
FROM v_support_order_items
WHERE order_number = 10000;
```

```sql
SELECT customer_name, conversation_id, state,
       last_order_number, pending_order_number, confirmation_expires_at
FROM v_support_conversations
ORDER BY updated_at DESC;
```

```sql
SELECT currency, status, COUNT(*) AS orders,
       SUM(total_cents) / 100.0 AS total_in_that_currency
FROM v_support_orders
GROUP BY currency, status
ORDER BY currency, status;
```

Nunca some BRL e USD como se fossem a mesma moeda. Os valores permanecem oficiais em centavos; a divisão acima serve somente à visualização. Para seguir um relacionamento técnico, filtre orders por order_number e consulte o order_id original na tabela. Não edite manualmente status ou preços para testar fluxos: use os endpoints e o protocolo conversacional.

## Sequência e migração

A numeração começa em 10000. Pedidos anteriores recebem números ordenados por created_at/order_id dentro da migration; não são renumerados depois. O banco gera números novos automaticamente, com índice único e check mínimo. Lacunas são normais em sequências após rollback e não indicam perda de pedidos.

A migration preserva UUIDs, FKs, títulos e preços antigos, moeda USD, datas, mensagens e snapshots de idempotência. As novas colunas de catálogo ficam null nos itens antigos. Alterar o default de moeda para BRL não converte linhas existentes.

Para conferir instalação:

```sql
SELECT migration_name, finished_at
FROM _prisma_migrations
ORDER BY started_at;
```

O PostgreSQL e o volume persistente existentes foram mantidos. Não é necessário reset ou recriação do banco para usar as views.
