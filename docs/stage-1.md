# Etapa 1 — Fundação do projeto

## Escopo e critérios de aceite

- Monorepo npm workspaces com `apps/api`, `apps/web` e documentação.
- Express 5 + TypeScript estrito; React + Vite com uma página inicial simples.
- PostgreSQL 17, Prisma 7 e infraestrutura de migrations, sem entidades de negócio.
- Build, typecheck, testes, inicialização e desenvolvimento disponíveis pela raiz.
- Compose com três serviços, volume persistente, portas configuráveis e healthchecks.
- API com validação Zod de ambiente, erros centralizados, Pino e Swagger UI.
- Nenhuma integração com OpenAI ou Fake Store API, chat, autenticação ou regras de pedidos.

## Contrato de disponibilidade

`GET /health` executa `SELECT 1` pelo Prisma. Não basta o servidor HTTP responder:

| HTTP | Corpo | Significado |
| --- | --- | --- |
| 200 | `{"status":"ok","database":"up"}` | Consulta ao banco concluída |
| 503 | `{"status":"error","database":"down"}` | Falha ao acessar o banco |

Respostas recebem `Cache-Control: no-store` e um `X-Request-Id` gerado pelo servidor. Não incluem versão do banco, configuração, credenciais ou mensagens internas. Conexão e consultas têm timeouts para limitar a espera em caso de indisponibilidade. O healthcheck é de prontidão: verifica a infraestrutura necessária, sem consultar serviços de IA.

Erros HTTP gerais seguem `{ "error": { "code": "...", "message": "..." } }`, com 400 para JSON inválido, 413 para JSON acima de 16 KiB, 404 para rota inexistente e 500 para falha inesperada. Disponibilidade usa o contrato próprio acima. A documentação inicial está em `/docs/` e `/openapi.json`.

## Decisões

1. **npm workspaces, sem orquestrador adicional:** dois apps não justificam ferramentas extras. Um lockfile torna a instalação reproduzível.
2. **Node 24 LTS, ESM e TypeScript:** mesma versão principal no host e nas imagens; backend usa NodeNext e imports compatíveis com o JavaScript compilado. As versões instaladas constam no lockfile. Prisma permanece na linha estável 7; não usa o release candidate 8.
3. **Módulos simples:** `routes → controller → service → repository`, com infraestrutura isolada. Não há microsserviços, classes base, repositórios genéricos ou containers de DI.
4. **Schema sem modelos artificiais:** migrations ficam preparadas; a primeira alteração SQL será criada com o primeiro requisito de negócio. A API já usa Prisma para verificar a conexão.
5. **Um `.env` na raiz:** API, Prisma CLI, Vite e Compose têm instruções consistentes. Somente variáveis `VITE_` chegam ao cliente; a chave futura de IA permanece exclusivamente no backend.
6. **Docker reproduzível no Windows/WSL2:** imagens constroem as próprias dependências Linux, sem montar `node_modules` do Windows. Para hot reload, o fluxo documentado roda Node/Vite no host e PostgreSQL no Docker.
7. **Segurança proporcional ao escopo:** a fronteira atual é HTTP/configuração/banco. Não há PII ou execução de ações de negócio. JSON é limitado; headers são protegidos; erros e logs não expõem dados sensíveis; portas Docker são restritas ao loopback. CORS não foi habilitado pois o frontend inicial usa somente links, sem requisições JavaScript entre origens.
8. **Ciclo de vida explícito:** o servidor aceita iniciar sem banco disponível e anuncia 503 no healthcheck. SIGINT/SIGTERM encerram o HTTP e o pool Prisma, com limite de dez segundos.

## Limites desta entrega

- A página inicial não é uma implementação do chat.
- Os testes automatizados isolam o banco. A verificação real é feita com Compose e `GET /health`.
- O Compose é para execução local. TLS, credenciais de produção, usuário de banco com permissões mínimas e políticas de deploy pertencem a uma etapa posterior.
- A imagem da API mantém a CLI Prisma e as ferramentas instaladas para permitir os comandos operacionais de migrations documentados. Otimização fina de imagem não faz parte desta etapa.
- Novas entidades, autenticação, políticas de autorização e integrações externas exigirão seus próprios contratos e testes nas próximas etapas.

## Validação realizada em 19/10/2026

- Instalação npm concluída; auditoria inicial completa e auditoria de runtime sem vulnerabilidades reportadas.
- Build e typecheck dos dois workspaces aprovados; 12 testes Vitest/Supertest aprovados.
- Schema Prisma validado e client gerado sem modelos de negócio.
- Compose validado e imagens construídas; os três serviços alcançaram estado saudável no Docker Desktop Linux sobre Windows.
- `migrate deploy` e `migrate status` executados no container: nenhuma migration pendente.
- Healthcheck real respondeu 200, passou a 503 com o PostgreSQL parado e voltou a 200 após a restauração.
- Código TypeScript executado com tsx acessou o PostgreSQL pelo host com sucesso.
- Página inicial conferida no navegador, incluindo viewport de 390 px sem overflow horizontal; página e Swagger sem erros ou avisos no console após corrigir a requisição de favicon.
- `git diff --check` sem erros. Nenhuma branch, commit ou push criado.

Os testes Docker usaram `--env-file .env.example`, somente com valores fictícios. Não foi criado `.env` com credenciais reais. As portas 5432/5433 já estavam ocupadas por outros projetos; o exemplo foi ajustado para 5434. A imagem da API inclui OpenSSL e certificados para suportar a CLI de migrations no Debian slim.
