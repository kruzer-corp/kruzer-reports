# Handoff — De visualizadores a **controle de operação** Kruzer

**Data:** 2026-06-23
**Contexto:** os dashboards saíram de "visualizadores de JIRA" e já começaram a virar ferramenta de gestão (escrevem no JIRA). Este handoff mapeia o estado atual e propõe como evoluí-los para dar **controle real à operação** Kruzer.

---

## 1. Estado atual (inventário)

**Produção:** `https://kruzer-dashboards.matheus-mereb.workers.dev` · Basic Auth (`kruzer` / senha nos secrets do Worker).
**Stack:** Cloudflare Worker (gate de auth + proxy/escrita JIRA) + assets estáticos em `public/`. Sem framework — HTML/CSS/JS puro + Chart.js/GridJS via CDN.

| Rota | Arquivo | O que é |
|---|---|---|
| `/` | `public/index.html` | Landing com cards |
| `/krzr/` | `public/krzr/index.html` | Service Desk: open by status, lead time, aging, opened×resolved, filtro por organização |
| `/krzr/hml` | `public/krzr/hml.html` | KRZR v2 (ITIL): matriz SLA por prioridade, banner de alertas, breach na tabela, export CSV |
| `/vena/` | `public/vena/index.html` | Dev Venâncio: throughput, blocked, aging |
| `/vena/capacity` | `public/vena/capacity.html` | **Planner** de capacity (SP, rollup de filhos, track dedicada 99Food, drag-and-drop, cenários what-if) |
| `/vena/roadmap` | `public/vena/roadmap.html` | **Status report** VENA: timeline por capacity + tabela editável + followups + export PDF |
| `/fst/` | `public/fst/index.html` | **Status report** FST: timeline por capacity + tabela editável + followups + export PDF |
| `/fst/capacity` | `public/fst/capacity.html` | **Planner** de capacity FastShop (HORAS) |
| `/timeline/` | `public/timeline/index.html` | **Cross-projeto** (FST·VENA·DCT·J4PM): Gantt por recurso, datas reais Start/Due |
| — | `public/shared/api.js` | `KruzerAPI`: `fetchAll` (leitura) + `addComment` / `updateDueDate` / `updatePriority` (escrita) |

### Capacidades já entregues (a base do "controle")
- **Leitura ao vivo** do JIRA (proxy `/api/jira/jql`, cache 15min).
- **Escrita no JIRA** (Worker, com whitelist): `POST /api/jira/comment`, `POST /api/jira/issue-update` (só `duedate` e `priority`). Nos status reports: **Remark → comentário no épico**, **Due Date** e **Priority** editáveis com gravação direta no JIRA.
- **Motor de capacity**: esforço → duração → cronograma por track. O planner **publica** o cronograma (`localStorage['kruzer:<proj>-capacity:schedule']`) e o status report **espelha** (sem recálculo → visão unificada planner↔report).
- **Timeline de estado real**: épicos em andamento começam na Start date e terminam na Due date acordada; capacity só projeta o que não tem data real.
- **Regra Done**: épicos `statusCategory=done` saem do cálculo da esteira (em todos os 4 arquivos).
- **Export PDF** (snapshot semanal pra Downloads, paginado por bloco) e **Acompanhamentos/to-do** editáveis nos reports.

---

## 2. A tese: o que falta pra ser "controle de operação"

Hoje os dashboards **mostram** e já **editam pontualmente**. Controle de operação exige três saltos:

1. **Fonte única e compartilhada** — decisões precisam ser vistas por todos, não presas a um navegador.
2. **Sinal acionável** — não só "como está", mas "o que exige ação agora" (risco, gargalo, atraso, ociosidade).
3. **Loop fechado** — do sinal à ação à verificação do resultado, com rastro.

---

## 3. Roadmap de melhorias (priorizado)

### 🥇 Fundacional — Persistência compartilhada (destrava todo o resto)
**Problema:** Remarks, Acompanhamentos/to-do e **cenários de capacity** vivem em `localStorage` (por navegador). Dois gestores veem coisas diferentes; o cronograma "publicado" não atravessa máquinas. Isso quebra a premissa de controle de equipe.
**Proposta:** mover esse estado pra um backend leve no próprio Worker — **Cloudflare KV** (chave-valor, simples) ou **D1** (SQLite, se quiser query/histórico). Endpoints `GET/PUT /api/state/<scope>`.
- Cenário de capacity, remarks e followups passam a ser **compartilhados e versionados**.
- Mantém o fallback local pra resiliência.
**Impacto:** alto · **Esforço:** médio. É o pré-requisito pra "single source of truth".

### 🥈 Saúde do portfólio — KPIs acionáveis cross-projeto
**Proposta:** um painel "Kruzer Ops" consolidando FST·VENA·DCT·J4PM·KRZR:
- **On-track vs em risco vs atrasado** (capacity projeta fim > due → risco; já temos o flag `late`).
- **Utilização de capacity** por projeto/recurso (heatmap consolidado — o planner já calcula carga/semana).
- **Throughput** e tendência (VENA hoje ~17 SP/sem/dev — baixo; metrificar evolução).
- **WIP** por recurso (quantos épicos "em andamento" simultâneos — sinaliza dispersão).
- **Aging de bloqueados** e **épicos sem estimativa** (entram como placeholder e poluem a projeção).
**Impacto:** alto · **Esforço:** médio.

### 🥉 Alertas proativos (loop fechado)
**Proposta:** Worker com **cron** (Cloudflare Triggers) varrendo o JIRA e disparando alertas (Slack/e-mail):
- Due se aproximando ou estourado; projeção de capacity ultrapassa o due.
- Épico bloqueado há > N dias; épico sem estimativa entrando na esteira.
- SLA do KRZR caindo abaixo do limite (a matriz SLA já existe no `/krzr/hml`).
**Impacto:** alto · **Esforço:** médio. Transforma "olhar o dashboard" em "ser avisado".

### Governança — fechar a caixa-preta do Sustain
O report FST destacava o Sustain como **caixa-preta** (sem fluxo de entrada, sem registro no JIRA, prioridade no peito). Controle exige:
- **Intake estruturado** (form → cria issue no JIRA via o endpoint de escrita que já temos).
- Visão de Sustain com volume, tipo, esforço e SLA próprios.
**Impacto:** alto (risco operacional) · **Esforço:** médio.

### Forecasting com confiança
- Faixas de confiança no fim projetado (otimista/realista) em vez de data única.
- Capacity **por recurso** (hoje é squad genérico); refletir férias/alocação parcial.
- Recalcular e **avisar** quando a Due acordada ficar incompatível com a projeção.

### Rastreabilidade & permissão
- Hoje toda escrita usa **um único token** (aparece como o mesmo usuário no JIRA) e **uma senha compartilhada** de dashboard — sem atribuição nem perfis.
- Evoluir pra **identidade por usuário** (OAuth JIRA ou login próprio) → quem mudou due/priority, quem comentou; e perfis (leitura vs gestão).
**Impacto:** médio-alto · **Esforço:** alto.

### Qualidade como KPI de operação
A discussão de release expôs **cobertura de testes nula** e ausência de Code Review — risco grave já sinalizado. Vale um indicador de qualidade/saúde de entrega no painel Ops (ainda que manual no início).

---

## 4. Quick wins (baixo esforço, bom retorno)
- **Consolidar a Timeline cross-projeto** como "home" da operação (já cruza 4 projetos; falta KRZR e os KPIs de saúde).
- **Filtro por recurso** na `/timeline/` (ver carga de uma pessoa across projetos).
- **Indicador de "sem estimativa"** e **"sem due"** nas tabelas (já tratados como placeholder; só falta destacar como pendência de gestão).
- **Auto-refresh** / `storage`-event nos reports (já há listener parcial) pra refletir mudanças do planner sem reload.
- **Link do épico no JIRA** em todo lugar (maioria já tem).

---

## 5. Riscos & dívidas técnicas conhecidas
- **localStorage por navegador** (remarks/followups/cenários não são compartilhados) — maior bloqueio pra "controle".
- **Credencial única** de dashboard (Basic Auth) + **token JIRA único** → sem perfis nem auditoria por pessoa.
- ⚠️ **Token Cloudflare `cfut_…`** usado nos deploys deste ciclo deve ser **revogado** (foi colado em chat).
- **Migração pro GitHub pendente**: branch `import/cloudflare-dashboards` está commitada localmente (segredos já removidos: `deploy.sh` lê de env, docs limpos, `.gitignore` cobre `.dev.vars`/`scripts/dev/`). O push pra `github.com/kruzer-corp/kruzer-reports` foi **negado por permissão** (`matheusmereb-krzr` sem write). Assim que liberarem acesso: `git push -u origin import/cloudflare-dashboards` e abrir PR pra `main`.
- **Engine de capacity duplicada** (planner vs report) — mitigada pelo padrão publish/mirror, mas ainda são dois caminhos; um módulo compartilhado (`/shared/capacity.js`) reduziria drift.
- **Deploy depende de token local** (`CLOUDFLARE_API_TOKEN`); idealmente CI no GitHub pós-migração.

---

## 6. Sequência sugerida pra próxima sessão
1. **Persistência compartilhada (KV/D1)** — destrava remarks/followups/cenários compartilhados. (fundacional)
2. **Painel "Kruzer Ops"** cross-projeto com KPIs de saúde (on-track/risco/atraso, utilização, WIP).
3. **Alertas via cron** (due/risco/bloqueio/SLA).
4. **Intake do Sustain** (form → issue JIRA).
5. **Identidade/perfis** + auditoria de escrita.

---

## 7. Mapa rápido pro próximo dev
- **Escrita JIRA:** `src/worker.js` (`handleAddComment`, `handleUpdateIssue` com whitelist) + `public/shared/api.js`.
- **Motor capacity + publish:** `public/<proj>/capacity.html` (`computeSchedule`, `publishSchedule`).
- **Timeline espelho:** `public/fst/index.html` e `public/vena/roadmap.html` (`readPublishedSchedule`/`localPlan`/`renderGantt`).
- **Timeline cross-projeto:** `public/timeline/index.html` (`PROJ_COLOR`, `PROJECTS`, `windowFor`).
- **Deploy:** `CLOUDFLARE_API_TOKEN=… npm run deploy` (ou `scripts/deploy.sh` lendo env).
- **Segredos:** `.dev.vars` (local, gitignored) e `wrangler secret` (prod). Nunca commitar.
