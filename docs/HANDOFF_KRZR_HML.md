# Handoff — KRZR Service Desk Dashboard v2 (Homologação)

**Data:** 18/06/2026
**Autor da revisão:** Matheus (PD) + Cowork
**Executor:** Claude Code
**Base atual em prod:** `public/krzr.html` (v `462aa815-daa5-47b9-a096-a3094009ad25`)
**Objetivo:** implementar uma versão `v2` com práticas de Service Desk profissional (ITIL/ITSM) em uma **rota de homologação separada**, sem tocar na URL de produção até aprovação.

> **STATUS (18/06/2026): Sprints 1–4 implementados e publicados na HML** (`/krzr-hml.html`, deploy `716f9ab3`). Produção `/krzr.html` intocada. Snapshots por sprint em `snapshots/krzr-hml.sprintN.html` (revert/debug). Decisões aplicadas: SLA contratual P0–P3, Reopen via label, cancel breakdown, stale >3d, CSAT placeholder. **Pendente:** mapeamento real issue type→ITIL (#2) — regex provisório em `itilCategory()`. Aguardando validação final do Matheus para cutover.

---

## 🎯 Estratégia de homologação

### Regra de ouro
**Não sobrepor `public/krzr.html`.** Toda a evolução acontece em arquivos novos. A URL antiga continua respondendo o dashboard atual até o switch final.

### Topologia de arquivos

| Caminho | O que é |
|---|---|
| `public/krzr.html` | **Produção atual** — não tocar até o cutover. |
| `public/krzr-hml.html` | **Nova versão** — todo o trabalho desta esteira acontece aqui. |
| `public/index.html` | Página de índice — adicionar card "KRZR HML" linkando para `/krzr-hml.html`, com badge visual diferenciando. |

### URLs

| Ambiente | URL | Auth |
|---|---|---|
| Produção | `https://kruzer-dashboards.matheus-mereb.workers.dev/krzr.html` | mesmo Basic Auth atual |
| Homologação | `https://kruzer-dashboards.matheus-mereb.workers.dev/krzr-hml.html` | mesmo Basic Auth (Worker protege tudo) |

O Worker (`src/worker.js`) **não precisa de mudança** — ele já serve qualquer asset estático em `public/` atrás do gate de auth. Mesma `KruzerAPI`, mesmo proxy `/api/jira/jql`, mesmo cache de 15min.

### Indicador visual de HML
No `krzr-hml.html`, adicionar uma faixa fixa no topo (`position: sticky; top: 0`) em fundo amarelo claro: `🧪 Ambiente de homologação — dados reais, mudanças em validação`. Isso evita confusão se a aba ficar aberta junto com a prod.

### Cutover (quando aprovado)
1. `cp public/krzr-hml.html public/krzr.html`
2. Remover a faixa amarela de HML (ou tornar condicional via query param `?env=hml`).
3. Remover o card "KRZR HML" do `index.html`.
4. `npm run deploy`.

---

## 🗺️ Roadmap (4 sprints)

Cada sprint deve ser um commit (ou um conjunto pequeno) que deixe a HML em estado utilizável. Não juntar tudo num único PR.

### Sprint 1 — Acionabilidade (impacto/esforço mais alto)

**Objetivo:** transformar o dashboard de "visão executiva" em ferramenta operacional. Itens abaixo são pré-requisito para os demais sprints.

1. **Matriz SLA por prioridade** (substituir SLA único de 1.5d)
   - Criar `const SLA_MATRIX` no topo do script.
   - Default proposto (validar com o time antes — ver seção "Decisões pendentes"):
     ```js
     const SLA_MATRIX = {
       'Highest': { firstResponse: 0.5, resolution: 4 },   // horas
       'High':    { firstResponse: 2,   resolution: 8 },
       'Medium':  { firstResponse: 4,   resolution: 24 },
       'Low':     { firstResponse: 8,   resolution: 40 },  // 5d × 8h
       '_default':{ firstResponse: 4,   resolution: 24 },
     };
     ```
   - Função `slaTargetFor(priority)` retorna `{firstResponse, resolution}` em **horas**.
   - Função `slaBreached(ticket)` retorna `{firstResponseBreached, resolutionBreached, atRisk}` (at risk = ≥80% do target consumido).

2. **Banner de alertas no topo dos KPIs**
   - Componente novo, acima de `<div class="kpis">`.
   - Aparece apenas se houver alertas (não polui quando tudo OK).
   - Alertas a renderizar (cada um clica e filtra a tabela abaixo):
     - 🚨 `N P1 abertos em SLA breach` (count > 0)
     - ⚠️ `N tickets em risco de breach` (≥80% do target consumido, ainda dentro)
     - 🕓 `N tickets sem update há > 7d` (staleness — usar `updated`, não `created`)
     - 📈 `Backlog cresceu X% nas últimas 2 semanas` (Net flow negativo persistente)
   - Estilo: fundo claro da cor do nível (vermelho/laranja/amarelo/azul), borda lateral marcada, padding compacto.

3. **Badges coloridas de prioridade na tabela Aging**
   - Hoje a coluna `Prioridade` é texto plano.
   - Mudar para badge com cor:
     - `Highest`/`Critical` → vermelho (`bg:#fecaca color:#7f1d1d`)
     - `High` → laranja (`bg:#fed7aa color:#9a3412`)
     - `Medium` → amarelo (`bg:#fef9c3 color:#854d0e`)
     - `Low` → cinza (`bg:#e5e7eb color:#475569`)
   - Adicionar classes no `<style>` em linha com as `badge.aging-*` existentes.

4. **Destaque de SLA breach na tabela**
   - Linhas com `slaBreached.resolutionBreached === true` recebem fundo `rgba(220,38,38,0.05)` e borda esquerda 3px vermelha.
   - Adicionar coluna nova **SLA** com badge:
     - `OK` (verde) / `Risco` (laranja) / `Breach` (vermelho)
   - Implementar via `formatter` no GridJS (já em uso).

5. **Export CSV da tabela Aging**
   - Botão `⬇ Exportar CSV` ao lado do search da tabela.
   - Exportar **as colunas visíveis** + url do Jira + SLA status. Não exportar colunas hidden (`_url`, `_scls`, etc.).
   - Encoding UTF-8 com BOM (para abrir limpo no Excel BR).
   - Nome do arquivo: `KRZR-aging-YYYY-MM-DD.csv`.

**Critério de pronto Sprint 1:**
- [ ] Banner de alertas aparece se houver P1 breached, e desaparece se não.
- [ ] Filtros (período/org) continuam funcionando, e o banner reage ao filtro.
- [ ] Tabela mostra badge colorida de prioridade.
- [ ] Linha breached fica visualmente óbvia.
- [ ] CSV abre limpo no Excel/Google Sheets.

---

### Sprint 2 — Cobertura ITIL e qualidade

1. **Reclassificação issue type → categoria ITIL**
   - Substituir `isBugType` por `itilCategory(issueTypeName)`:
     ```js
     function itilCategory(name) {
       const n = (name || '').toLowerCase();
       if (/incident|bug|outage|falha/.test(n)) return 'incident';
       if (/request|solicitação|access|onboarding/.test(n)) return 'request';
       if (/problem|rca|root cause/.test(n)) return 'problem';
       if (/change|mudança|deploy/.test(n)) return 'change';
       return 'other';
     }
     ```
   - O mapeamento exato precisa ser validado contra os issue types reais do board KRZR (ver "Decisões pendentes" #2).
   - Box "Por tipo de issue" passa a comparar **Incidents vs Service Requests** (manter "Outros" como terceira coluna se houver volume relevante).

2. **Reopen Rate** (novo KPI)
   - Calcular do `changelog`: % de tickets `Done`/resolutivos que tiveram pelo menos uma transição saindo de `Done` para qualquer status não-resolutivo.
   - Função:
     ```js
     function wasReopened(changelog) {
       if (!changelog?.histories) return false;
       for (const h of changelog.histories) {
         for (const item of (h.items || [])) {
           if (item.field === 'status' &&
               DONE_STATUSES.has((item.fromString||'').toLowerCase()) &&
               !RESOLUTIVE_STATUSES.has((item.toString||'').toLowerCase())) {
             return true;
           }
         }
       }
       return false;
     }
     ```
   - Exibir como número + % no box "Por tipo de issue", segmentado por categoria ITIL.
   - Target: < 5% (sinalizar vermelho se acima).

3. **First Contact Resolution (FCR)**
   - % de tickets resolvidos **sem** entrar em `Blocked`/`Waiting for Customer` **e** sem reatribuição (changelog item `field === 'assignee'`).
   - Função `wasFCR(ticket)`:
     ```js
     function wasFCR(issue) {
       if (!issue.changelog?.histories) return false;
       let reassignments = 0, enteredBlocked = false;
       for (const h of issue.changelog.histories) {
         for (const item of (h.items || [])) {
           if (item.field === 'assignee' && item.fromString) reassignments++;
           if (item.field === 'status' &&
               BLOCKED_STATUSES.has((item.toString||'').toLowerCase())) enteredBlocked = true;
         }
       }
       return reassignments === 0 && !enteredBlocked;
     }
     ```
   - Exibir junto com Reopen Rate.

4. **p50/p90/p95 do Lead time**
   - Substituir gauge único de média por bloco com três valores: p50 / p90 / p95.
   - Função `percentile(arr, p)` (linear interpolation).
   - Manter a média em pequeno abaixo, mas como secundária.
   - Cor do bloco baseado em p90 vs target.

5. **Net flow no gráfico Opened × Resolved**
   - Adicionar terceira série **Net** (Opened − Resolved) como barra ou linha tracejada no eixo secundário.
   - Adicionar legenda inferior: `Backlog: +X esta semana / −Y mês`.
   - Cor: positivo (crescimento) em vermelho fraco, negativo (redução) em verde fraco.

6. **Cancel Rate** (métrica nova no box "Resolved × Cancelados")
   - `cancelRate = canceled / (resolved + canceled)`.
   - Mostrar em pequeno embaixo dos números: `Cancel rate: 12% (saudável ≤ 15%)`.
   - Sinalizar vermelho se > 20%.

**Critério de pronto Sprint 2:**
- [ ] Box "Por tipo" mostra Incidents vs Requests vs Outros com Open + FRT + Backlog + Blocked + Reopen + FCR.
- [ ] Lead time mostra p50/p90/p95 em vez de média única.
- [ ] Gráfico de 12 semanas mostra Net e tem texto de backlog growth.
- [ ] Cancel rate aparece e calcula corretamente.

---

### Sprint 3 — Profundidade

1. **Workload by assignee (novo card)**
   - Tabela compacta ou bar chart horizontal: assignee × open tickets × avg age × lead time p90.
   - Top 10 + agregado "Outros".
   - Identificar assignee sobrecarregado (>1.5× a média do time) com badge `⚠ overload`.

2. **Top 5 Organizations by open tickets**
   - Card lateral ao Workload, mesma altura.
   - Por org: open count, % SLA compliance, avg age.
   - Clicar em uma org **filtra o dashboard inteiro** por aquela org (atualiza o dropdown de Organização).

3. **MTTR por prioridade**
   - Faixa visual (4 barras horizontais) mostrando lead time médio + p90 por prioridade.
   - Marca de target SLA (linha vertical pontilhada).

4. **Coluna "Última atualização" na tabela Aging**
   - Mostrar dias desde `updated` (não `created`).
   - Badge colorida se > 7d sem update.

5. **CSAT (condicional)**
   - Só implementar se o JSM tiver pesquisa pós-resolução ativa (ver "Decisões pendentes" #3).
   - Se ativo: novo KPI primário "CSAT (período)" com valor + tendência (mês anterior).
   - Se não ativo: deixar placeholder/card "CSAT — não configurado" com link para ativar.

**Critério de pronto Sprint 3:**
- [ ] Workload by assignee identifica top 10 e flagging de overload funcionando.
- [ ] Top 5 Orgs clicáveis filtram o dashboard.
- [ ] MTTR por prioridade mostra que P1 < P4 (sanidade visual).
- [ ] Aging table tem coluna de staleness.

---

### Sprint 4 — UX / Polimento / Drill-down

1. **Drill-down nos KPIs**
   - Clicar em "Resolvidos (período)" filtra tabela para tickets resolvidos no período (toggle).
   - Clicar em "Opened (período)" filtra para criados no período.
   - Clicar numa barra do "Open by status" filtra por aquele status.
   - Clicar numa barra de aging bracket filtra por bracket.
   - Estado visual: KPI clicado fica com borda azul + label "Filtrando por: X (clear ✕)".

2. **Comparação automática vs período anterior**
   - Cada KPI numérico mostra delta % vs período anterior equivalente: `▲ 12%` (vermelho ou verde dependendo do sentido — pra Opened, alta é ruim; pra Resolved, alta é boa).
   - Texto pequeno embaixo do número.

3. **Mini-bars no box "Por tipo de issue"**
   - Em vez de tabela 3 colunas de números, usar mini-barras horizontais comparativas (Incidents vs Requests vs Outros).
   - Eixo proporcional ao maior valor da linha.

4. **Remover a faixa "Ambiente de homologação"**
   - Tornar condicional: só aparece se URL termina em `-hml.html` ou tem `?env=hml`. Facilita o cutover sem deletar nada.

5. **Acessibilidade básica**
   - Adicionar `aria-label` nos botões/dropdowns sem texto descritivo.
   - Garantir contraste WCAG AA nas badges novas.

**Critério de pronto Sprint 4:**
- [ ] Drill-down funciona em pelo menos 4 elementos (2 KPIs + 2 gráficos).
- [ ] Comparação vs período anterior aparece em todos os KPIs numéricos.
- [ ] Aprovação do Matheus pra cutover.

---

## 🧰 Especificações técnicas comuns

### Estado/refactor sugerido
O `krzr.html` atual concentra tudo em uma única `<script>` minificada. Antes de adicionar Sprint 2+, vale **refatorar** em blocos comentados (não criar arquivos separados — manter single-file). Sugestão de seções:

```
// ── CONFIG (matriz SLA, mapeamento de status, etc.)
// ── DATE/WORKDAY UTILS
// ── DATA NORMALIZATION (changelog → durações)
// ── METRICS (SLA, FCR, reopen, percentile)
// ── RENDER: ALERTS BANNER
// ── RENDER: KPIs
// ── RENDER: CHARTS (status, aging, trend, workload, mttr)
// ── RENDER: TABLES (aging, orgs)
// ── DRILL-DOWN STATE
// ── BOOT
```

### LocalStorage (cuidado)
O `krzr.html` atual já usa `localStorage` para `col-widths-*`. **OK manter para HML**, mas:
- Prefixar com `krzr-hml-` na HML para não conflitar com prod.
- No cutover, deixar `krzr-` (sem prefixo) para preservar UX dos usuários.

### CDN libs
Manter Chart.js + GridJS. Para o **Net flow** com eixo secundário e barra+linha mistas, Chart.js já suporta — não precisa de lib nova. Para **percentis**, escrever helper inline (sem lodash).

### Performance
~2600 tickets. Os novos cálculos (SLA por ticket, FCR, reopen, percentile) **são O(n)** sobre o array. Total adicionado: ~10–15ms no render. **Não precisa otimização** nesta esteira; só evitar recálculo a cada render — memoizar normalizado em `RAW` (que já é feito).

---

## ❓ Decisões pendentes (validar ANTES de Sprint 1/2)

Estas decisões devem ser confirmadas pelo Matheus/time antes de cravar valores no código. Marcar todas no início.

| # | Pergunta | Default proposto | Quem decide |
|---|---|---|---|
| 1 | SLAs reais por prioridade da Kruzer? | Highest 30min/4h · High 2h/8h · Med 4h/24h · Low 8h/5d | PD + Operações |
| 2 | Mapeamento exato dos issue types do board KRZR para ITIL (Incident/Request/Problem/Change)? | regex no `itilCategory()` | PD + Suporte |
| 3 | JSM da Kruzer tem pesquisa pós-resolução (CSAT) ativa? Qual customfield_*? | placeholder se não tiver | Suporte/Admin Jira |
| 4 | "Cancelados" deve continuar agregando Expired+Duplicated+Canceled, ou separar? | manter agregado, mostrar breakdown em tooltip | PD |
| 5 | Target de Reopen Rate, FCR? | Reopen ≤5%, FCR ≥70% | PD + Operações |
| 6 | Definição de "stale" (sem update há quanto tempo)? | >7d para tickets abertos | Operações |

Recomendação: criar uma issue/checklist no Jira ou Slack thread com essas 6 perguntas antes de Sprint 1.

---

## ✅ Validação e testes

### Como testar localmente
Conforme o `HANDOFF.md` original: servir `public/` com Node e mockar `KruzerAPI.fetchAll` com issues sintéticas que cubram:
- 1 ticket P1 em breach
- 1 ticket reopened (changelog com `Done → In Progress`)
- 1 ticket FCR (sem reatribuição, sem Blocked)
- 1 ticket com 3 reatribuições
- 1 ticket em backlog há > 30d

Os testes existentes (`test-*.js`) cobrem prod via Puppeteer. Replicar para HML:
- Copiar `test-krzr-fixes.js` → `test-krzr-hml.js` apontando para `/krzr-hml.html`.
- Adicionar asserções para: banner de alertas presente quando há P1 breach, badges de prioridade visíveis, CSV download dispara.

### Sanity checks manuais (cada sprint)
- Filtrar por org com poucos tickets → nenhum KPI quebra.
- Filtrar por "Ano atual" → trend de 12 semanas continua coerente.
- Trocar período enquanto a tabela está paginada → paginação reseta.
- Refresh hard (Ctrl+Shift+R) → cache do Worker renova.

### Critério de cutover (todos checados)
- [ ] Sprint 1–4 entregues.
- [ ] 6 decisões pendentes resolvidas e refletidas no código.
- [ ] Matheus aprovou em sessão de review.
- [ ] Pelo menos 2 dias de uso em paralelo sem regressão.
- [ ] Backup do `krzr.html` atual versionado no git antes de sobrepor.

---

## 🚀 Deploy

### HML (durante desenvolvimento)
```bash
cd kruzer-dashboards
export CLOUDFLARE_API_TOKEN=<token>
npm run deploy
# valida em https://kruzer-dashboards.matheus-mereb.workers.dev/krzr-hml.html
```

Nada muda no Worker — `env.ASSETS` serve `krzr-hml.html` automaticamente.

### Cutover (após aprovação)
```bash
cp public/krzr.html public/krzr.legacy.html      # backup local (não commitar)
git mv public/krzr.html public/krzr.v1-backup.html  # opcional, mantém versionado
cp public/krzr-hml.html public/krzr.html         # promove HML pra prod
# remover faixa amarela / ajustar condicional
# remover card "HML" do index.html
npm run deploy
git commit -am "feat(krzr): cutover v2 (ITIL + alerts + drill-down)"
```

---

## 📎 Anexos / referências

- Review original que motivou este handoff: conversa Cowork de 18/06/2026 (score atual ~36/100 → target pós-Sprint-1 ~55, pós-Sprint-4 ~80+).
- Arquivos centrais para mexer:
  - `public/krzr-hml.html` (criar copiando `krzr.html`)
  - `public/index.html` (adicionar/remover card HML)
  - `src/worker.js` (NÃO mexer — já compatível)
- Convenção de commit: `feat(krzr-hml): sprint-N — <item>` para rastrear o progresso por sprint.

---

**Próxima ação imediata:** Claude Code começa criando `public/krzr-hml.html` como cópia idêntica do `krzr.html`, adicionando a faixa amarela de HML e o card em `index.html`. A partir daí, Sprint 1 item por item, com commit por item ou por sub-bloco.
