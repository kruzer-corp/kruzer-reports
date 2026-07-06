# Kruzer Dashboards

Painel de **controle de operação** da Kruzer, com dados ao vivo do JIRA. Começou como
visualizadores standalone (Service Desk, dev) e evoluiu para uma ferramenta de gestão que
**lê, cruza, sinaliza e escreve** no JIRA — com estado compartilhado entre a equipe.

A tese que guia o produto (ver `docs/HANDOFF.md`): sair de "mostrar como está" para
**controle real** — fonte única de verdade, sinal acionável, e loop fechado (do sinal à
ação à verificação, com rastro).

```
Browser ─▶ Cloudflare Worker (Basic Auth + proxy/escrita JIRA)  ─▶ Atlassian Cloud API
                 ├─ serve os assets estáticos de public/
                 ├─ D1 (STATE_DB) ......... estado vivo compartilhado + audit trail
                 ├─ KV (OAUTH_KV) ......... store do OAuth do servidor MCP
                 └─ /mcp .................. servidor MCP read-only (Bearer + OAuth)
```

Stack: **Cloudflare Worker** + **D1** (SQLite) + **KV**, assets estáticos em `public/`.
Sem framework nem build step — HTML/CSS/JS puro, Chart.js/GridJS via CDN. O frontend nunca
toca no API token do JIRA (fica em secret do Worker).

---

## Funcionalidades

### Painel executivo — `/ops/` (Cockpit)
Saúde da operação em uma tela, 100% derivado de JQL ao vivo (sem persistência). Persona C-level.
- **Semáforo por projeto-cliente** (FST · VENA · DCT · PGM): verde/amarelo/vermelho derivado de
  atraso, bloqueio prolongado, WIP excessivo e falta de estimativa/due. No vermelho, aponta a
  **decisão executiva** a tomar.
- **Top riscos** priorizados por severidade, com a taxonomia: `ATRASO`, `ATRASO PROJETADO`
  (projeção da esteira estoura o due), `BLOQUEIO`, `WIP`, `SEM ESTIMATIVA`, `SEM DUE`, `SUSTAIN`.
- **Marcos próximos** (mini-gantt 4 semanas) — épicos com due na janela, por cliente.
- **Banda Service Desk KRZR** — KPIs próprios de sustentação (fila, fora de SLA, aging), separada
  do semáforo de projetos.
- Referências do JIRA são **clicáveis** em todo o painel (marcos, riscos) → abrem a issue.

### Timeline cross-projeto — `/timeline/`
Gantt de épicos por recurso, cruzando FST · VENA · DCT · PGM. Datas reais (Start/Due); a esteira
de capacity só projeta o que não tem data. Filtro por recurso, indicador de "sem due", labels de
key clicáveis.

### Por cliente — Status Report + Capacity Planner
Cada cliente tem duas visões espelhadas pela **engine de capacity**:

| Cliente | Status Report | Capacity Planner | Unidade |
|---|---|---|---|
| Venâncio | `/vena/roadmap` | `/vena/capacity` | Story Points |
| FastShop | `/fst/` | `/fst/capacity` | Horas |
| Pague Menos | `/pgm/` | `/pgm/capacity` | Horas |
| Decathlon | — (só no cockpit/timeline) | — | — |

- **Status Report**: timeline por capacity + tabela editável (remark → comentário no JIRA; Due
  Date e Priority gravam direto no épico) + acompanhamentos/to-do + export PDF.
- **Capacity Planner**: esforço → duração → cronograma por track. Drag-and-drop, resize de esforço,
  track dedicada (ex. 99Food no VENA), cenários what-if. **Publica** o cronograma no D1; o Status
  Report **espelha** (sem recalcular → visão unificada planner↔report).

O VENA também tem `/vena/` (dev): throughput, blocked, aging.

### Service Desk KRZR
- `/krzr/` — v1 em produção: open by status, lead time (dias úteis, exclui bloqueio), aging,
  opened×resolved, filtro por organização.
- `/krzr/hml` — v2 (ITIL): matriz SLA por prioridade, banner de alertas, breach na tabela,
  métricas ITIL (reopen rate, FCR, MTTR, lead p50/p90/p95), export CSV.

### Escrita no JIRA
Whitelist no Worker (`POST /api/jira/comment`, `POST /api/jira/issue-update` — só `duedate` e
`priority`). Usado pelos status reports.

### Integrações read-only
- **`GET /api/krzr/insights`** — saúde agregada do KRZR pra consumo externo (Bearer `INSIGHTS_TOKEN`
  ou `?token=`).
- **Servidor MCP em `/mcp`** — expõe os dashboards como tools MCP (JSON-RPC, stateless). Dois
  caminhos de auth, ambos read-only: Bearer estático (`INSIGHTS_TOKEN`, pra CLI) e OAuth 2.1
  (pra claude.ai/Desktop, com allowlist `OAUTH_USERS`). Tools: `list_projects`,
  `get_service_desk_insights`, `get_project_status`, `search_jira`, `get_published_schedule`,
  `get_operational_risks`.

---

## Módulos compartilhados (`public/shared/`)

| Arquivo | Papel |
|---|---|
| `api.js` | `KruzerAPI`: `fetchAll` (leitura paginada) + `addComment`/`updateDueDate`/`updatePriority` (escrita) |
| `state.js` | Cliente do D1 (`/api/state`) com cache local + fallback localStorage |
| `capacity.js` | `KruzerCapacity`: engine de scheduling (esforço → cronograma por track). Fonte única |
| `report.js` | Builder do Status Report (buckets, tabela, swimlane, timeline, wiring) |
| `planner.js` | Capacity planner FST/PGM (drag-and-drop, resize, cenários) |
| `components.js` | Primitivos visuais reusáveis (kpiCard, riskRow, e os helpers de link JIRA `jiraKey`/`jiraKeys`/`svgLink`) |
| `tokens.css` | Paleta e tokens do design system Kruzer |
| `report.css` / `planner.css` | CSS dos reports e planners |

**Convenção de links JIRA:** onde houver uma key, use `KruzerComponents.jiraKey/jiraKeys` (HTML)
ou `svgLink` (SVG). Não reinvente o `<a target="_blank">` caso a caso.

---

## Regras de negócio (invariantes)

- **Regra Done**: épico com `statusCategory=done` **não aparece em lugar nenhum** (report, planner,
  cockpit, MCP). **Exceção**: Hyper Care persiste (é pós-entrega ativo).
- **Buckets de status** (report): Hyper Care · UAT · Em Execução · Ag. Aprovação · Ag. Estimativa ·
  Backlog. Resolução **nativo-first com carve-out**: (1) labels semânticas `uat`/`hyper-care`,
  (2) status nativo do JIRA, (3) labels legadas, (4) texto `**Status:**` na descrição, (5) backlog.
  Há duas variantes (`fst` e `vena`) — unificação pendente (ver handoff).
- **Prioridade**: Highest→P0, High→P1, Medium→P2, resto→P3.
- **Committed** (travado fora do what-if): tem start date real ou está "Em Execução".
- **Estouro de due** (timeline/risco): `scheduledEnd` **estritamente após** o due — alcançar o due
  não conta como atraso.
- **SLA KRZR** (thresholds fixos): Highest aberto >1d, High aberto >3d.
- **Riscos do cockpit** (thresholds, `HANDOFF_OPS_CONTROL` fixado em 2026-06-25): atraso crítico >7d;
  bloqueio ≥5d (crítico ≥10d); WIP ≥3 épicos in-progress (crítico 4+).

---

## Persistência (D1 — Camada 1)

Estado vivo compartilhado (remarks, followups, cenários de capacity, schedule publicado) mora no
**D1**, substituindo o localStorage por-navegador. Fallback local para resiliência.

- `GET/PUT/DELETE /api/state/<scope>/<key>` — chave-valor por escopo, com optimistic concurrency
  (`version`).
- `GET /api/audit?scope=<scope>&limit=N` — audit trail de cada escrita (`state` + `audit_log`).
- Schema em `migrations/0001_init.sql`. D1 prod: `kruzer-state` · HML: `kruzer-state-hml` (isolados).

---

## Ambientes

| Ambiente | URL | D1 | KV |
|---|---|---|---|
| **PROD** | https://kruzer-dashboards.matheus-mereb.workers.dev | `kruzer-state` | prod |
| **HML** | https://kruzer-dashboards-hml.matheus-mereb.workers.dev | `kruzer-state-hml` | hml |

Assets em `public/` são compartilhados; a diferença é só backend (D1/KV/secrets por env). Basic
Auth em todas as páginas (`DASHBOARD_USER`/`DASHBOARD_PASSWORD`, secrets por env — HML usa senha
diferente da prod, de propósito).

---

## Setup (uma vez)

```bash
node -v && npm -v          # Node 18+
npm install
```

1. **API token do Atlassian** — https://id.atlassian.com/manage-profile/security/api-tokens
   (email: `matheus.mereb@kruzer.ai` · cloud ID: `dd987a38-5d13-4230-ab43-7141dc3695e1` ·
   `https://kruzer.atlassian.net`).
2. **Vars locais** — copie `.dev.vars.example` → `.dev.vars` e preencha `JIRA_EMAIL`,
   `JIRA_API_TOKEN`, `JIRA_CLOUD_ID`, `DASHBOARD_USER`, `DASHBOARD_PASSWORD`.
   `.dev.vars` está no `.gitignore` — **nunca commite credenciais**.
3. **Login Cloudflare** — `npx wrangler login`.
4. **Secrets em prod/HML** — para cada var acima (e `INSIGHTS_TOKEN`, `OAUTH_USERS` se usar
   integração): `npx wrangler secret put <NOME>` (prod) e `... --env hml` (HML).

---

## Rodar localmente

```bash
# D1 local (uma vez) — cria as tabelas no SQLite efêmero de .wrangler/
npx wrangler d1 execute kruzer-state --local --file=migrations/0001_init.sql

npm run dev        # http://localhost:8787 — pede Basic Auth (creds do .dev.vars)
```

## Deploy

```bash
npm run deploy:hml     # HML  (wrangler deploy --env hml)
npm run deploy         # PROD (wrangler deploy)
```

Fluxo recomendado: deploy em HML → validar → deploy em PROD. Verificação rápida pós-deploy:
`curl` sem auth deve dar `401` (worker no ar) e `curl -u user:pass .../shared/components.js` deve
servir o asset novo. Migrations de D1 novas rodam com
`npx wrangler d1 execute <db> [--env hml] --file=migrations/000N_*.sql --remote`.

## Testes / redes de segurança

```bash
npm run test:capacity          # 18 cenários golden da engine de scheduling
npm run test:capacity:update   # regrava goldens após mudança intencional (revisar diff no PR)
node scripts/render-snapshot.js --baseline   # snapshot visual/funcional (requer wrangler dev vivo)
```

Rode `test:capacity` antes/depois de mexer em lógica de scheduling ou buckets de status.

---

## Como adicionar um dashboard

**Mesmo cliente**: crie `public/<cliente>/<nome>.html`, mantenha `<script src="/shared/api.js">`,
adicione o link no `public/index.html`, deploy.

**Cliente novo**: replique o par report+capacity (use VENA/FST/PGM como template), plugue os
módulos `shared/`, adicione ao escopo do cockpit (`EPIC_PROJECTS` em `public/ops/index.html`) e o
card no `public/index.html`.

---

## Troubleshooting

- **Auth pede toda hora** — Basic Auth no Chrome às vezes não persiste; use Edge/Firefox ou logue
  uma vez no devtools.
- **401 na chamada JIRA** — token expirou: regenere e `npx wrangler secret put JIRA_API_TOKEN`.
- **`/ops/` fica carregando** — JQL falhou ou token expirou; cheque a aba Network (401).
- **Remarks somem no reload (local)** — a migration do D1 não rodou; re-execute o init local.
- **429** — rate limit da Atlassian; o proxy tem cache de 15min. Reduza a janela JQL.
- **Performance** — KRZR tem ~2.6k tickets; primeira carga demora ~10–20s (batches de 100).

---

## Roadmap & pendências

Tudo o que falta, decisões abertas e dívidas técnicas está consolidado em
**[`docs/HANDOFF.md`](docs/HANDOFF.md)**. Snapshots congelados de sprints do KRZR v2 ficam em
`docs/snapshots/` (referência de revert/debug).
