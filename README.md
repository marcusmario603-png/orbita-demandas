# Órbita · Fila de Demandas 

Versão mínima da fila de Demandas: API em Fastify + Zod + mysql2 (sem ORM) e frontend Angular 21
(standalone, OnPush, signals, formulários reativos; sem Ionic).

```
db/            esquema (01) e dados de exemplo (02: 5 usuários, 5 mil demandas)
backend/       API + testes (Vitest)
frontend/      Angular + testes (ng test / Vitest + jsdom)
docker-compose.yml
```

## Como rodar

Requisitos: Node 20.12+ (usa `process.loadEnvFile`) e Docker.

```bash
# 1) Banco (MySQL 8 com o esquema e as 5 mil demandas)
docker compose up -d
docker compose ps        # espere ficar "healthy"

# 2) API em http://localhost:3000
cd backend
cp .env.example .env
npm ci
npm run dev

# 3) Frontend em http://localhost:4200 (proxy /api -> :3000)
cd ../frontend
npm ci
npm start
```

Para recriar o banco do zero: `docker compose down -v && docker compose up -d`.

### Testes

```bash
cd backend  && npm test     # 23 testes; precisam do banco do docker-compose no ar
cd frontend && npm test     # 6 testes de componente (HttpTestingController + jsdom)
```

O teste exigido pelo enunciado está em `backend/test/reserve.test.ts`
("duas reservas simultâneas da mesma demanda: um 200 e um 409..."). Há também um com 25 usuários
disputando a mesma demanda. Os testes criam as próprias demandas (fila `qa-*`) e as apagam no final;
não mexem nas 5 mil de exemplo.

No frontend, a identidade é simulada no cabeçalho: escolha o usuário e marque "Supervisão" para
enviar `x-scopes: demands,demands:supervise`. Abra duas abas com usuários diferentes para ver o 409.

## API

Todas as rotas exigem `x-user-id`; `x-scopes` é uma lista separada por vírgula.

| Rota | Comportamento |
|---|---|
| `GET /demands` | `page`, `pageSize` (≤100), `queue`, `status` (1–3), `sort` (`id`\|`updated_at`), `order` (`asc`\|`desc`). Devolve `{items,total,page,pageSize}`. Qualquer parâmetro desconhecido ou valor inválido → **400**. |
| `POST /demands/:id/reserve` | 200 se reservou (ou se já era sua: `alreadyReserved: true`). **409** `already_reserved` com a mensagem "Demanda já reservada por *Nome*", `reservedBy` e a `demand` atual. 409 `demand_closed` se já encerrada. 404 se não existe. |
| `POST /demands/:id/finish` | Corpo Zod: `outcome`, `failureReason` (obrigatório no insucesso), `note` (opcional, aparado, ≤500). 403 se não é o dono nem tem `demands:supervise`; 409 se já encerrada ou não reservada; 404; 400 de validação. |
| `GET /users` | Apoio do seletor de usuário do frontend (não faz parte do enunciado). |

Erros têm o formato `{ error, message, ... }`; os de validação trazem `issues[]` com `path` e `message`.

## Decisões

**Reserva sem corrida.** O bug do enunciado é *ler e depois escrever*: duas requisições leem
`worker_id` nulo antes de qualquer UPDATE. Aqui a decisão está no próprio UPDATE:
`UPDATE ... WHERE id = ? AND status = 1 AND worker_id IS NULL`. O InnoDB serializa os dois UPDATEs
na linha, e o segundo, ao obter o lock, reavalia o WHERE sobre o dado já commitado e afeta 0 linhas
(`affectedRows`). Não há `SELECT ... FOR UPDATE` separado e o lock dura só a transação curta, nunca
enquanto a pessoa decide. Quem perde dá rollback (nada é gravado), lê o estado atual e responde 409
com o nome de quem ficou. Se o dono atual é o próprio usuário, a resposta é sucesso idempotente e
**não** grava um segundo trace (cobre as "duas abas").

**Encerrar.** Usa `SELECT ... FOR UPDATE` na linha porque aqui há várias checagens dependentes
(dono, estado) antes de escrever; tudo (checagem, UPDATE e trace) acontece na mesma transação, com
rollback se qualquer passo falhar (há teste com conexão falsa provando que, se o trace falha, não
há commit). Ordem das respostas: 404 → 403 → 409 → 200.

**Trace na mesma transação.** `reserve` e `finish` gravam `demand_trace` dentro da transação que
muda a demanda. O trace do `finish` registra quem encerrou (pode ser a supervisão).

**Validação.** Zod com `.strict()` nos parâmetros de consulta e no corpo do `finish`, o que dá o
400 para campo desconhecido. O `ORDER BY` usa um mapa fixo de colunas; nenhum texto do usuário vai
para o SQL. Autenticação em `onRequest` (um 401 vem antes de um 400).

**Frontend.** `switchMap` cancela a listagem anterior; o 409 do `reserve` traz a demanda atual e
só aquela linha é substituída (sem recarregar a página). O formulário de encerramento usa
`<dialog>` nativo (foco preso e Esc de graça) e validação condicional: o motivo só é obrigatório
no insucesso, e o botão "Concluir" acompanha a validade do formulário via signal.

## Suposições e pontos em aberto 

- Nomes dos parâmetros de ordenação: `sort` e `order`.
- `failureReason` enviado junto com `success` é ignorado (gravado como NULL), não rejeitado.
- Encerrar uma demanda **aberta** (sem reserva) dá 409, inclusive para a supervisão: reserva-se antes.
- Demanda encerrada não pode ser reservada de novo (409).
- Não verifico se `x-user-id` existe em `app_user`: o enunciado simplifica a autenticação.

## O que eu faria com mais tempo

- Testes de ponta a ponta no navegador (Playwright) cobrindo duas abas reservando ao mesmo tempo.
- Paginação por cursor (`id > ?`) para filas muito grandes: `OFFSET` degrada em páginas profundas.
- Rodar a suíte de concorrência também em CI contra MySQL 8, com mais disputantes e repetições.
- Atualização em tempo real da fila (SSE/pub-sub) em vez de depender do 409 para descobrir a mudança.
- Autenticação/JWT reais com escopos, logs estruturados e um índice pensado para o filtro + ordenação
  mais usados (hoje há só `ix_queue_status`, conforme o esquema fornecido).
- Testes de acessibilidade automatizados e `npm audit` no pipeline.

## Uso de IA


- **Ferramenta:** Claude (Anthropic), em conversa de chat, a pedido de Marcus.
- **Onde:** o código do backend (rotas, serviço, schemas), do frontend (componentes, serviços,
  estilos), os testes, o SQL de exemplo, o `docker-compose.yml` e este README foram escritos pela IA.
- **Como:** a IA escreveu e executou os testes no ambiente dela (backend: 23/23; frontend: 6/6) e
  chegou a corrigir problemas que os testes apontaram (rollback explícito em quem perde a corrida e a
  carga inicial da lista). Também verificou que o teste de corrida realmente falha quando o UPDATE
  perde a condição `status = 1 AND worker_id IS NULL`.
- **Limites da verificação:** o banco usado nos testes foi MariaDB 10.11, não MySQL 8.

