# Handoff — Progresso atual + regras de negócio de Status/Exibição

**Data:** 2026-06 · **Próxima frente:** rever a lógica de **status × ciclos** e a **exibição de projetos** nos reports.
**Audiência:** quem for pegar a próxima frente (e Claude Code em sessões futuras).

Este doc tem duas partes: (A) **estado atual** do projeto (o que existe, onde, como validar) e (B) **as regras de negócio vigentes** de status e exibição — que são o ponto de partida a ser revisto.

---

## A. Estado atual

### Onde roda
| Ambiente | URL | Código |
|---|---|---|
| **Prod** | `kruzer-dashboards.matheus-mereb.workers.dev` | branch `feat/ops-cockpit-and-d1` (versão `c4da810c`) |
| **HML** | `kruzer-dashboards-hml.matheus-mereb.workers.dev` | mesma branch (env `hml`, D1 isolado) |

Cloudflare Worker (Basic Auth + proxy JIRA + D1) servindo assets estáticos em `public/`. HTML/CSS/JS puro, sem framework. Prod e HML **sincronizados**.

### Rotas
| Rota | Arquivo | Tipo |
|---|---|---|
| `/` | `public/index.html` | Landing |
| `/ops/` | `public/ops/index.html` | Cockpit executivo (saúde por projeto-cliente + Service Desk KRZR + riscos + marcos) |
| `/krzr/`, `/krzr/hml` | `public/krzr/*` | Service Desk (não é projeto-cliente) |
| `/vena/`, `/vena/roadmap`, `/vena/capacity` | `public/vena/*` | Dev · **Status Report** · **Capacity Planner** (modelo **SP**) |
| `/fst/`, `/fst/capacity` | `public/fst/*` | **Status Report** · **Capacity Planner** (modelo **HORAS**) |
| `/pgm/`, `/pgm/capacity` | `public/pgm/*` | idem FST (Pague Menos, modelo HORAS) |
| `/timeline/` | `public/timeline/index.html` | Cross-projeto (FST·VENA·DCT·PGM) por recurso |

### Módulos compartilhados (`public/shared/`)
- `tokens.css` — paleta/design tokens.
- `api.js` — `KruzerAPI` (proxy JQL: leitura).
- `state.js` — `KruzerState` (persistência D1 + cache local, optimistic concurrency).
- `capacity.js` — `KruzerCapacity`: **engine de scheduling consolidada** (`ensureAssignments`, `computeSchedule`), helpers de data (`startOfDay`, `addDays`, `keyNum`), `BLK_HEX`, IO de publish, e `DEV_DUE_FIELD` (id do campo "Due Date Dev", **vazio hoje**).
- `report.js` — **`KruzerReport.mount(CFG)`**: Status Report inteiro (dados+render+wiring). FST/PGM/VENA são shells de ~131 linhas que chamam `mount(cfg)`.
- `report.css` — CSS dos reports.
- `planner.js` — **`KruzerPlanner.mount(CFG)`**: Capacity Planner FST/PGM (modelo horas). VENA capacity é separado (modelo SP).
- `planner.css` — CSS dos planners FST/PGM.

### Redes de segurança (rodar SEMPRE antes/depois de mexer em status/exibição)
1. **`npm run test:capacity`** — golden tests da engine de scheduling (`scripts/capacity-golden.js` + `scripts/__goldens__/`). Determinístico. 18 cenários.
2. **`scripts/render-snapshot.js`** — igualdade de render das 6 páginas (3 reports + 3 planners). `--baseline` captura o estado atual; sem flag compara. Zero diff = zero drift visual/funcional. Precisa de `wrangler dev` local. `__snapshots__/` é gitignored (baseline de sessão, depende de dados vivos do JIRA).

> Fluxo pra qualquer refactor de status/exibição: `wrangler dev` → `render-snapshot --baseline` → mexer → `render-snapshot` (alvo 0 drift) + `npm run test:capacity`.

### Pendências operacionais
- **`INSIGHTS_TOKEN` em prod não setado** → integração read-only (`/api/krzr/insights`) dorme até `wrangler secret put INSIGHTS_TOKEN`.
- **Campo "Due Date Dev"** não existe no JIRA ainda → `DEV_DUE_FIELD=''` (inerte). Setar o id em `shared/capacity.js` quando criado; interino aceita `**Due Dev:** DD/MM` na descrição.
- **Push pro GitHub** bloqueado (`matheusmereb-krzr` sem write em `kruzer-corp/kruzer-reports`); branch + `feat-ops-cockpit-and-d1.bundle` prontos.

---

## B. Regras de negócio vigentes — STATUS

**⚠️ Esta é a área a ser revista.** O modelo atual é um **workaround de transição**: o status não vem (ainda) do workflow do board — vem de **labels** e **texto na descrição** transcritos manualmente (originalmente de planilhas), com o status nativo do JIRA só como fallback.

### B.1. Taxonomia de buckets (o "status" exibido)
Ordem de maturidade (conclusão → início):

| Bucket | id | Significado | Cor |
|---|---|---|---|
| Hyper Care | `hyper` | Entregue / suporte pós-entrega (efetivamente "done") | verde `#12B76A` |
| **UAT (cliente)** | `uat` | **Testes do cliente antes da entrega final** (novo) | violeta `#7C3AED` |
| Em Execução | `execucao` | Em desenvolvimento / review | azul `#3151CE` |
| Ag. Aprovação | `aprovacao` | Aguardando aprovação | âmbar `#F79009` |
| Ag. Estimativa | `estimativa` | Aguardando refinamento/estimativa | cinza `#C6C9D9` |
| Backlog | `backlog` | Não iniciado | navy `#48507D` |

### B.2. Como o bucket é resolvido (`resolveBucket` em `shared/report.js`)
**Precedência (revisada 2026-07 — NATIVO-FIRST com carve-out):**
1. **Labels semânticas `uat` / `hyper-care`** — estados que o workflow nativo do JIRA
   ainda NÃO expressa; enquanto não virarem status nativos, a label prevalece
   (`semanticLabelBucket`). `uat`→uat, `hyper-care`→hyper.
2. **Status nativo do JIRA** — `issue.status.name` mapeado (fonte primária pro resto).
3. **Demais labels** — `em-execucao`, `aguardando-aprovacao`, `aguardando-estimativa`, `backlog`.
4. **Texto na descrição** — `**Status:** <valor>` (último recurso do workaround manual).
5. Fallback → `backlog`.

> Mudou de `label → descrição → nativo` (workaround) para nativo-first: o status vivo
> do board passa a mandar, corrigindo épicos que a descrição stale mis-bucketava (ex.
> FST-137 Canceled aparecia como "Aguardando Aprovação"). As labels `uat`/`hyper-care`
> ficam como exceção só porque o JIRA não tem esses status nativos ainda.

**Há DUAS variantes de `statusTextToBucket`/`resolveBucket`**, selecionadas por `CFG.statusVariant`:

- **`'fst'`** (FST + PGM — modelo labels/horas): `hyper`→hyper, `uat`/`homolog`→uat, `execu`→execucao, `aprova`→aprovacao, `estimativa`→estimativa, `backlog`→backlog. Fallback nativo cobre `uat/homolog`, `hyper/done/conclu/closed`, `aprova`, `estimativa/refin`, `progress/review/execu/desenvolv`.
- **`'vena'`** (VENA — modelo status nativos PT, superset): igual + reconhece `pronto`, `desenvolvimento`, `bloqueado/blocked`, `refinamento/refinement/grooming`.

> ⚠️ **As duas variantes existem porque unificar mudava o bucket de alguns épicos** (o harness pegou: ex. "Desenvolvendo" no PGM caía em Backlog sob a lógica VENA porque ela checa `desenvolvimento`, não `desenvolv`). Isso é sintoma do workaround — com status reais do board, uma lógica única resolveria.

### B.3. Regra "Done" / Encerrados (saem da LISTAGEM inteira)
`out.done = (status.statusCategory.key === 'done')`. **Revisado 2026-07:** épicos
encerrados (statusCategory=Done → Done/Resolved/Closed/Canceled/Expired/Duplicate…)
**não são mais listados** em lugar nenhum — nem report (KPIs/swimlane/tabela/timeline),
nem planner, nem MCP `get_project_status` — via filtro `isClosedNotHyper` no ponto de
ingestão (`RAW=…` / `EPICS=…`). **EXCEÇÃO: Hyper Care permanece** (label `hyper-care`
ou status ~`hyper care`) — é acompanhamento ativo pós-entrega. Antes, encerrados
apareciam bucketizados (Cancelado virava "Hyper Care" no planner / bucket stale no report).

### B.4. Prioridade
`priorityTier(priority.name)`: Highest→`P0`, High→`P1`, Medium→`P2`, Low/resto→`P3`. Exibida como tier P0-P3 nos reports (mesmo pra projetos que usam prioridades padrão do JIRA, como PGM — leitura funciona; a edição de prioridade assume P0-P3).

### B.5. "Committed"
`out.committed = !!startDate || bucket === 'execucao'`. Committed ancora o épico na Start date real no cronograma e é travado fora do modo what-if.

### B.6. Planner (`shared/planner.js` e `vena/capacity.html`)
`bucketFor(labels, jiraStatus, catKey)`: labels primeiro; senão status nativo (UAT antes da categoria); senão categoria (`done`→Hyper Care, `indeterminate`→Em Execução); senão Backlog. Buckets do planner mapeiam pra cores de bloco (`BLK_HEX`: `s-dev`, `s-uat`, `s-refin`, `s-warn`, `s-neutral`, `s-backlog`).

### B.7. Cockpit (`ops/index.html`)
Status helpers próprios (derivados do status nativo, não labels): `isDone` = `/done|cancel|expired|duplicat|hyper.?care/`; `isBlocked` = `/bloque|blocked|impediment/`; `isInProgress` = categoria `indeterminate` ou nome com `progress|doing|desenvolv|execução|uat|homolog`. UAT conta como **em andamento** (não done).

---

## C. Regras de negócio vigentes — EXIBIÇÃO nos reports

### C.1. Tabela de controle
- Colunas: Key · DMND · Name · Status (badge do bucket) · Priority (P0-P3) · Start Date · Due Date (editável → grava no JIRA) · Remarks (editável → comentário no JIRA).
- **Ordenação (`TABLE_ORDER`)**: `hyper → uat → execucao → aprovacao → estimativa → backlog` (conclusão → início); dentro do bucket, por Priority e depois Due Date.
- Filtros: busca (Key/DMND/Name) + filtro por status + por priority.
- Due Date sub-linha "🔧 dev DD/MM" quando `devDue` presente (Due Date Dev — inerte até o campo existir).

### C.2. Swimlane
- **Ordem (`LANE_ORDER`)**: `backlog → estimativa → aprovacao → execucao → uat → hyper` (início → conclusão, esq→dir). 6 colunas.

### C.3. Timeline (cronograma por capacity)
- **Espelha o cronograma publicado** pelo planner (via D1, `readPublishedSchedule`). Sem publish, cai no **fallback local** (`localPlan` → engine de `shared/capacity.js`).
- Barras coloridas por bucket (`BUCKET_COLOR`). Borda vermelha = estoura o due do JIRA (`scheduledEnd > startOfDay(jiraDue)`, estritamente depois — **alcançar o due não conta**). Hachura = data estimada.
- Épicos em andamento começam na Start date real e terminam na Due acordada; sem datas reais, a esteira projeta pelo esforço.

### C.4. Cockpit
- Semáforo por **projeto-cliente** (FST·VENA·DCT·PGM): verde/amarelo/vermelho derivado da contagem de riscos. Cada card mostra **drivers** (o que puxa o alerta) e, no vermelho, a **decisão executiva**.
- KRZR tem **banda própria** (Service Desk), com KPIs de SLA/fila/aging — não entra no semáforo de projetos.
- Riscos: `ATRASO` (due < hoje), `ATRASO PROJETADO` (esteira publicada projeta fim > due, comparado por dia), `BLOQUEIO`, `WIP` (assignee com ≥3 em andamento), `SEM ESTIMATIVA`, `SEM DUE`, `SUSTAIN` (informativo). Thresholds: atraso crítico >7d; bloqueio 5d/crítico 10d; WIP 3/crítico 4.

---

## D. A próxima frente — Status × Ciclos

**Motivação:** a exibição de projetos precisa mudar, e a lógica de status atual é frágil/manual (ver §B). O objetivo é relacionar **status** a **ciclos** de entrega e mudar a exibição de acordo.

### Tensões conhecidas (o que motiva a revisão)
1. **Status é manual** (labels + descrição), não vem do workflow do board → retrabalho, divergência do JIRA real, duas variantes de mapeamento.
2. **A app já está preparada pra status nativo** (`resolveBucket`/`bucketFor` têm fallback status-first) — falta migrar a fonte de verdade pro board e aposentar labels/descrição (§B.2). Isso é majoritariamente **config no JIRA** (definir os status do workflow por projeto) + colapsar as 2 variantes numa só.
3. **Taxonomia flat vs ciclos**: hoje o status é um bucket único (Backlog…Hyper Care). "Ciclos" (ex.: sprints — PGM já usa `customfield_10020` Sprint 1/2/3; ou fases de projeto/ondas) não são representados. A frente deve decidir como **status se relaciona a ciclo** (ex.: status dentro de um ciclo/sprint, ou fase do projeto × status da entrega) e como isso muda a **exibição** (agrupar por ciclo? timeline por ciclo? colunas por fase?).
4. **UAT** foi adicionado como status próprio (etapa de testes do cliente antes da entrega) — precisa caber no novo modelo de ciclos.
5. **Due Date Dev** (marco de entrega do dev, ≠ goal final) já tem plumbing — deve entrar no modelo de exibição por ciclo quando o campo existir.

### Direção recomendada (a validar na frente)
- **Migrar status pro workflow do board** de cada projeto (definir/alinhar os status no JIRA), ler `status.name`/`statusCategory` como fonte única, e **aposentar labels + parsing de descrição**. Colapsar `statusVariant` fst/vena numa lógica só.
- **Modelar "ciclo"** explicitamente (sprint do JIRA e/ou fase/onda do projeto) e redesenhar a exibição dos reports em torno disso (a decisão de produto da frente).
- Manter os invariantes: regra Done (categoria nativa), timeline espelha o publicado, cockpit lê status nativo.

### Como mexer com segurança
- Antes: `render-snapshot.js --baseline` (captura o atual) + `npm run test:capacity`.
- Toda mudança de bucket/exibição: rodar o harness (esperar drift **intencional** e revisá-lo) + goldens.
- Pontos de código a tocar: `resolveBucket`/`statusTextToBucket`/`BUCKETS`/`TABLE_ORDER`/`LANE_ORDER` em `shared/report.js`; `bucketFor`/`BUCKETS` em `shared/planner.js` e `vena/capacity.html`; helpers de status + `assessRisks` em `ops/index.html`; cores em `report.css`/`planner.css`/`BLK_HEX`.
- Se o novo modelo divergir por projeto, usar `CFG` (já é o padrão dos shells) em vez de duplicar.

---

## E. Mapa rápido de arquivos
- **Regras de status (report):** `public/shared/report.js` (BUCKETS, statusTextToBucket*, resolveBucket*, priorityTier, normalize, TABLE_ORDER, LANE_ORDER).
- **Regras de status (planner):** `public/shared/planner.js` (BUCKETS/bucketFor — FST/PGM) e `public/vena/capacity.html` (VENA/SP).
- **Engine de scheduling:** `public/shared/capacity.js` (`computeSchedule`, late/overHorizon).
- **Cockpit (saúde/riscos/status nativo):** `public/ops/index.html`.
- **Shells (config por projeto):** `public/{fst,pgm}/index.html` + `vena/roadmap.html` (reports); `public/{fst,pgm}/capacity.html` (planners).
- **Testes:** `scripts/capacity-golden.js` + `scripts/capacity-fixtures.js` + `scripts/__goldens__/`; `scripts/render-snapshot.js`.
- **Docs relacionados:** `docs/CAPACITY_GOLDEN_TESTS.md`, `docs/INTEGRATION_KRZR_INSIGHTS.md`, `docs/HANDOFF_OPS_CONTROL.md`.
