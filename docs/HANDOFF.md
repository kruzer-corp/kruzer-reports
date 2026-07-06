# Handoff — Kruzer Dashboards (pendências e roadmap)

**Atualizado:** 2026-07-06
**O que é este doc:** a fonte única de tudo que **falta** — roadmap priorizado, decisões abertas,
dívidas técnicas e mapa pro próximo dev. O *como funciona hoje* está no [`README.md`](../README.md).
Consolida e substitui os handoffs antigos (initial, KRZR prod/hml, VENA roadmap v2, ops control,
status×cycles, integrações, capacity golden, deploy/local test).

---

## 1. Estado atual (o que já foi entregue)

A tese "de visualizadores a controle de operação" tem 3 saltos. Onde estão:

| Salto | Estado |
|---|---|
| **Fonte única compartilhada** | ✅ Feito — D1 (`state` + `audit_log`), substituiu localStorage |
| **Sinal acionável** | ✅ Feito — cockpit `/ops/` (semáforo, riscos, marcos, KRZR desk) |
| **Loop fechado** (sinal→ação→verificação com rastro) | ⚠️ Meio caminho — escreve no JIRA e tem audit trail, mas ainda é 100% *pull* |

Entregue além do roadmap original: **servidor MCP read-only + OAuth**, **integração
`/api/krzr/insights`**, **PGM** como cliente completo, **engine de capacity consolidada**
(`shared/capacity.js`, com goldens), **HML isolado** de prod, **links JIRA clicáveis** em todo
o cockpit/timeline/reports.

---

## 2. Roadmap priorizado

### 🥇 Alertas proativos (cron → Slack) — fecha o loop
Hoje não há `[triggers]`/`scheduled` no Worker. A inteligência de risco **já existe**
(`assessRisks()` em `public/ops/index.html`, espelhada em `src/mcp.js`). Falta: extrair pro
server, rodar num **Cloudflare Cron Trigger**, e empurrar crit/high pro Slack (webhook).
Transforma "olhar o painel" em "ser avisado" — é literalmente o item que falta pro salto 3.
Gatilhos: due estourando/estourado, projeção de capacity > due, bloqueio > N dias, sem estimativa
entrando na esteira, SLA KRZR caindo. **Impacto alto · esforço médio** (a detecção já está escrita).
> ⚠️ Ao extrair a lógica, cuidado com a **tripla duplicação** (ops/index.html, mcp.js, e agora o cron) —
> considere um módulo compartilhado de risco pra não divergir. Ver §4.

### 🥈 Intake do Sustain — mata a caixa-preta
O cockpit ainda carrega o card `SUSTAIN` hardcoded como "risco operacional sem intake". Falta um
form que cria issue no JIRA (`createIssue` no Worker — o padrão de escrita whitelist já existe) e
uma visão de Sustain com volume/tipo/esforço/SLA próprios. **Impacto alto · esforço médio.**

### 🥉 Paridade DCT (e decisão sobre J4PM)
DCT está no escopo do cockpit (card de saúde, marcos, riscos) mas **não tem dashboard próprio** —
`public/dct/` não existe; o drill manda pra `/timeline/?proj=DCT`. Inconsistência visível: o
C-level clica no card e não acha o report/planner que os outros clientes têm. Replicar o padrão
report+capacity. **Esforço baixo-médio.** J4PM está fora do escopo — decidir se volta (reinserir
em `EPIC_PROJECTS`).

### Status × Ciclos — migrar pra workflow nativo
Hoje o status é **manual** (labels + texto na descrição), não vem do workflow do board → retrabalho,
divergência do estado real e **duas variantes** (`fst`/`vena`) que existem só porque unificar mudava
o bucket de alguns épicos. Plano:
1. Definir status por projeto no JIRA (mudança majoritariamente de config no JIRA), ler
   `status.name`/`statusCategory` nativo, aposentar labels + parsing.
2. Modelar "ciclo" explicitamente (sprint do JIRA e/ou fase/onda) e redesenhar o report em torno dele.
3. Manter invariantes: Regra Done, timeline espelha o publicado, cockpit lê nativo.
Pontos de código: `shared/report.js` (BUCKETS, resolveBucket*, priorityTier, ordens), `shared/planner.js`
(bucketFor), `vena/capacity.html`, `ops/index.html`. Rode os goldens + render-snapshot antes/depois.

### Identidade por pessoa + auditoria real
Hoje é **1 Basic Auth + 1 token JIRA** compartilhados; o `audit_log.updated_by` grava sempre o mesmo
usuário e toda escrita no JIRA aparece como a mesma conta. Sem isso, o rastro do loop é anônimo.
Evoluir pra OAuth JIRA ou login próprio → quem mudou due/priority, quem comentou; e perfis
(leitura vs gestão). **Esforço alto.**

### Forecasting com confiança
Faixas otimista/realista no fim projetado (em vez de data única). Capacity **por recurso** (hoje é
squad genérico) refletindo férias/alocação parcial. Avisar quando o due acordado ficar incompatível
com a projeção. Ideias avançadas do briefing VENA v2: Monte Carlo P50/P85, diff de cenários.

### Qualidade como KPI de operação
A discussão de release expôs cobertura de testes baixa e ausência de Code Review. Vale um indicador
de qualidade/saúde de entrega no cockpit (mesmo manual no início).

### Quick wins
- **Auto-refresh no cockpit** (uso em telão) — hoje só recarrega em resize/click.
- **Campo Due Date Dev**: `DEV_DUE_FIELD` está `''` (inerte); o interino aceita `**Due Dev:** DD/MM`
  na descrição. Criar o custom field no JIRA e apontar.
- **Cache < 1s** configurável no Worker.

---

## 3. Decisões abertas (validar com o time antes de codar)

- **KRZR v2 SLA** — alvos exatos por prioridade (default hoje: Highest 30min/4h, High 2h/8h,
  Medium 4h/24h, Low 8h/5d).
- **Mapa issue type → ITIL** (regex em `itilCategory()` é provisório).
- **CSAT** — o JSM tem survey ativo? Qual `customfield_*`?
- **Cancelado** — manter agregado ou separar Expired/Duplicated/Canceled?
- **Metas** — Reopen Rate (proposto ≤5%), FCR (≥70%), stale threshold (>7d)?
- **Cutover KRZR v2** — quando aprovado: `cp krzr-hml.html krzr.html`, remover banner/​card HML, deploy.
- **J4PM** — reentra no escopo de roadmap?

---

## 4. Riscos & dívidas técnicas

- 🔴 **`origin/main` é uma história órfã (legado).** É o repositório antigo de reports estáticos
  (arquivos soltos `arc.html`/`dct.html`/…, pasta `history/` com snapshot diário auto-commitado por
  bot; ~200+ commits, **sem ancestral comum** com a branch do app). **Não fazer merge da branch do
  app (`feat/ops-cockpit-and-d1`) na `main`** sem um plano deliberado — juntaria dois projetos sem base
  comum, poluiria o histórico e provavelmente quebraria o bot de snapshot. Decisão pendente: promover
  a branch do app a novo default? Repo separado? Manter como está?
- **Duplicação de lógica de negócio.** `assessRisks`/`resolveBucket*` vivem em `public/ops/index.html`
  e `public/shared/report.js` e são **espelhados** em `src/mcp.js`. Mudou regra num lado → replicar no
  outro. Um módulo compartilhado (isomórfico worker/browser) resolveria — fica mais urgente com o cron
  de alertas (viraria triplicação).
- **Status manual** (labels + descrição) e as **duas variantes** `fst`/`vena` — ver §2 (Status × Ciclos).
- **Credencial única** (Basic Auth + token JIRA) — sem atribuição por pessoa. Ver §2 (Identidade).
- **Deploy depende do wrangler local autenticado** — sem CI. Ideal: CI no GitHub pós-decisão sobre `main`.
- ⚠️ **Token Cloudflare `cfut_…`** de ciclos antigos deve estar **revogado** (foi colado em chat).
- **Engine de capacity**: consolidada em `shared/capacity.js` (drift zerado por goldens), mas planner e
  report ainda são dois caminhos que a chamam — mantido pelo padrão publish/mirror.

---

## 5. Mapa rápido pro próximo dev

| Preciso mexer em… | Vá em… |
|---|---|
| Escrita no JIRA | `src/worker.js` (`handleAddComment`, `handleUpdateIssue`) + `public/shared/api.js` |
| Estado compartilhado / audit | `src/worker.js` (`/api/state`, `/api/audit`) + `public/shared/state.js` + `migrations/` |
| Engine de capacity + publish | `public/shared/capacity.js` + `public/<proj>/capacity.html` |
| Status Report (buckets/tabela/timeline) | `public/shared/report.js` (+ `report.css`) |
| Capacity planner FST/PGM | `public/shared/planner.js` |
| Cockpit (saúde/riscos/marcos) | `public/ops/index.html` |
| Timeline cross-projeto | `public/timeline/index.html` |
| Servidor MCP / tools | `src/mcp.js` (+ `src/oauth.js` pro OAuth) |
| Integração read-only KRZR | `src/worker.js` (`/api/krzr/insights`) |
| Cores/tokens do brand | `public/shared/tokens.css` |

Deploy, secrets, testes e URLs: ver [`README.md`](../README.md).
