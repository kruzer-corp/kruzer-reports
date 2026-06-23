# Handoff — Dashboard KRZR (avaliação de produção)

**Data**: 18/06/2026
**Status**: ✅ Em produção
**Versão atual (Cloudflare)**: `462aa815-daa5-47b9-a096-a3094009ad25`

---

## 🔎 Para o Cowork avaliar

**URL de produção**: https://kruzer-dashboards.matheus-mereb.workers.dev/krzr.html
**Login**: usuário `kruzer` · senha `<senha — ver secrets do Worker>` (Basic Auth no próprio Worker)

O que olhar primeiro (roteiro de avaliação):
1. **Filtros** — trocar **Período** (dropdown custom) e **Organização** e confirmar que KPIs, gráficos e tabela reagem.
2. **KPIs (linha 1)** — Resolvidos × Cancelados (com total), gauges de Lead time & SLA, Opened (período).
3. **KPIs (linha 2)** — box "Por tipo de issue" (Bugs vs Outros) + gráfico Opened × Resolved (12 semanas).
4. **Tabela de Aging** — ordenação por coluna, larguras, reticências, tooltip no hover.
5. **Métricas de tempo** (Backlog/Blocked/Lead) — ver definições abaixo e validar contra alguns tickets reais no Jira.

---

## 📊 Layout atual

### KPIs — 1ª linha (3 boxes)
1. **Resolved × Cancelados (período)** — dois números em evidência + rodapé "Total: N issues fechadas no período". Resolvidos = status `Done`; Cancelados = `Expired`, `Duplicated`, `Canceled`.
2. **Lead time & SLA** — dois gauges semicirculares no mesmo box.
3. **Opened (período)** — tickets criados no período selecionado.

### KPIs — 2ª linha (2 boxes, 50/50, mesma altura)
- **Por tipo de issue** — comparativo **Incidentes (Bugs)** vs **Outros**, em 4 métricas (ver definições). Bug/Incidente = issue type com "bug" ou "incident" no nome.
- **Opened × Resolved (12 semanas)** — gráfico de tendência semanal.

### Gráficos
- **Open tickets by status** (barras horizontais)
- **Tickets by aging bracket** (0–3d, 4–7d, 8–14d, 15–30d, 30+d)

### Tabela de Aging (tickets abertos)
- Colunas: Key, Summary, Organização, Status, Prioridade, Responsável, Idade.
- **Key**: 1 linha, sem corte. **Organização/Status/Prioridade/Idade**: largura fixa igual (131px), 1 linha, overflow com reticências. **Summary/Responsável**: até 2 linhas com reticências. Altura de linha uniforme; texto completo no `title` (hover).
- Ordenação por clique (numérica em Idade, alfabética nas demais), busca e paginação (25/página).

---

## 📐 Definições de métricas (importante para avaliação)

- **Lead time** (gauge, workdays): `(resolução − criação)` **menos o tempo em Blocked**. Reflete o tempo de atuação do time. Escala 0–5d, target ≤ 1.5d.
- **SLA (≤1.5d)**: % de resolvidos no período com **lead BRUTO** (sem desconto de Blocked) ≤ 1.5 workdays. Target ≥ 95%.
- **Avg. first response**: média de `(1ª resposta − criação)` — campo JSM `customfield_10024`.
- **Avg. time in Backlog / Avg. time Blocked**: tempo acumulado por status, reconstruído do **changelog** (workdays).
- **Box "Por tipo de issue"**: as 4 métricas (Open tickets, first response, Backlog, Blocked) são calculadas **somente sobre tickets abertos**.

### Mapeamento de status do board KRZR
- **Backlog**: `Pending`, `On Queue`, `Waiting for Support`
- **Blocked**: `Blocked`, `Waiting for Customer`
- **Resolvido (Done)**: `Done`
- **Cancelado**: `Expired`, `Duplicated`, `Canceled`
- Tickets em qualquer status resolutivo são excluídos de "open" (tabela e contagens).

Notas de negócio embutidas:
- O desconto de Blocked no Lead time cobre **Blocked + Waiting for Customer** (espera do cliente).
- **Waiting for Support** é tratado como **Backlog** (downtime do time) → **pesa** no Lead time (não é descontado).

---

## 🏗️ Arquitetura

```
Browser (Basic Auth) → Cloudflare Worker (src/worker.js)
   ├─ /krzr.html, /api.js, ...   (assets estáticos do public/)
   ├─ POST /api/jira/jql          (proxy autenticado p/ Atlassian, cache 15min)
   └─ GET  /api/health
        ↓
Atlassian Cloud  /rest/api/3/search/jql  (expand=changelog)
```

- **Frontend**: Vanilla JS + Chart.js + GridJS (CDN). Toda a lógica em `public/krzr.html`.
- **Backend**: Cloudflare Worker. Secrets via `wrangler secret`: `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_CLOUD_ID`, `DASHBOARD_USER`, `DASHBOARD_PASSWORD` (token do Jira **não** reproduzido aqui — está nos secrets do Cloudflare).
- **JQL**: `project = KRZR AND (resolution is EMPTY OR resolved >= -120d OR created >= -120d) ORDER BY created DESC` (~2600 tickets), com `expand: changelog` (enviado como **string**, não array — o endpoint `/search/jql` rejeita array).
- **Campos**: summary, status, statusCategory, priority, issuetype, created, resolutiondate, updated, assignee, customfield_10002 (Organização), customfield_10024 (1ª resposta JSM).

---

## 🚀 Deploy

```bash
cd kruzer-dashboards
export CLOUDFLARE_API_TOKEN=<token>
npm run deploy
```

---

## ⚠️ Pontos de atenção / validar com dados reais

1. **Backlog/Blocked dependem do changelog**: tickets sem histórico de transições de status retornam `null` (excluídos da média, não contam como 0). Vale conferir alguns tickets reais.
2. **Volume**: ~2600 tickets com changelog → payload maior; o primeiro carregamento pode levar alguns segundos (cache de 15min no Worker ajuda nas recargas).
3. **Classificação Bug/Incidente** por nome do issue type ("bug"/"incident"). Se houver outro tipo que deva contar como incidente, ajustar `isBugType`.
4. **Custom domain / multi-tenant / alertas / export CSV** seguem como melhorias futuras (não implementados).

---

## 🧪 Como validar localmente sem o Jira

Servir `public/` com um server Node e **mockar só `/api.js`** (definir `window.KruzerAPI.fetchAll` retornando issues mock com `.changelog`); o dashboard real roda inteiro. Foi assim que cada mudança desta esteira foi validada antes do deploy (incluindo o cálculo de Backlog/Blocked a partir de changelog mock).
