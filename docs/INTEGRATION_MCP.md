# Integração — Servidor MCP remoto (`/mcp`)

O Worker expõe os dashboards Kruzer como um **servidor MCP remoto** read-only.
Um cliente MCP (Claude Code / Desktop / claude.ai) registra **um único conector**
e ganha todas as tools de uma vez, sem conhecer URLs REST soltas.

- **Código:** `src/mcp.js` (protocolo + tools) + rota `/mcp` em `src/worker.js`.
- **Transporte:** Streamable HTTP, JSON-RPC 2.0, **stateless** (sem sessão, sem SSE).
- **Auth:** identidade `integration` — `Authorization: Bearer <INSIGHTS_TOKEN>`.
  Read-only garantido pela allow-list do worker (`integrationAllowed`).
- **Endpoints:**
  - HML: `https://kruzer-dashboards-hml.matheus-mereb.workers.dev/mcp`
  - Prod: `https://kruzer-dashboards.matheus-mereb.workers.dev/mcp` (futuro: `https://dashboards.kruzer.ai/mcp`)

## Tools (v1)

| Tool | Args | O que devolve |
|---|---|---|
| `list_projects` | — | Projetos rastreados (FST/VENA/DCT/PGM) + KRZR, modelo (horas/SP) e rotas. Discovery. |
| `get_service_desk_insights` | — | Saúde do KRZR: fila aberta, SLA breaches (Highest>1d, High>3d), aging, byStatus/byPriority, tickets. |
| `get_project_status` | `project` (FST/VENA/DCT/PGM) | Épicos com bucket de status, prioridade P0-P3, start/due, committed, overdue. Espelha o Status Report. |
| `search_jira` | `jql`, `fields?`, `maxResults?` | Busca JQL crua read-only (página única, teto 100). |
| `get_published_schedule` | `project` (FST/VENA/PGM) | Cronograma de capacity publicado (D1). null se nada publicado. |
| `get_operational_risks` | `project?` | Riscos do cockpit (ATRASO, ATRASO PROJETADO, BLOQUEIO, WIP, SEM ESTIMATIVA, SEM DUE, SUSTAIN) + decisão executiva sugerida. |

> ⚠️ A lógica de status (`resolveBucket*`) e de riscos (`assessRisks`) em `src/mcp.js` é
> **espelho** de `public/shared/report.js` e `public/ops/index.html`. Mudou a regra num
> lado → reflita no outro. Ver `HANDOFF_STATUS_CYCLES.md`.

## Como registrar no Claude Code

```bash
claude mcp add --transport http kruzer-dashboards \
  https://kruzer-dashboards-hml.matheus-mereb.workers.dev/mcp \
  --header "Authorization: Bearer <INSIGHTS_TOKEN>"
```

Trocar a URL pra prod quando migrar. O `<INSIGHTS_TOKEN>` é o mesmo secret da
integração read-only; se não souber o valor, rotacione:
`printf '%s' NOVO_TOKEN | npx wrangler secret put INSIGHTS_TOKEN --env hml`.

## Como registrar no Claude Desktop / claude.ai (conector customizado)

Adicionar um **remote MCP server** apontando pra URL `/mcp` e configurar o header
`Authorization: Bearer <INSIGHTS_TOKEN>`. (Auth por header/bearer; OAuth não é usado
nesta versão — ver decisão de arquitetura no handoff.)

## Smoke test manual

```bash
# handshake (sem token → 401; com token → serverInfo)
curl -s -X POST "$URL/mcp" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"cli","version":"0"}}}'

# lista as tools
curl -s -X POST "$URL/mcp" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# chama uma tool
curl -s -X POST "$URL/mcp" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_operational_risks","arguments":{}}}'
```
