# Handoff — kruzer-dashboards (sessão 2026-07-09)

Kickstart pra outro agente do Claude Code. Lê isto inteiro antes de mexer.

---

## 0. TL;DR

App de dashboards (Cloudflare Worker) do JIRA da Kruzer. Nesta sessão entraram:
consolidação do KRZR numa view única, pivot de priorização no KRZR, feature de
**sobreposição de demandas no capacity** (detecção + concorrência por track), e
2 fixes de report (PDF com áreas escuras + KPIs quebrando linha).

**Prod recebeu só os 2 fixes de report.** KRZR consolidação/pivot + capacity
overlap estão **só em HML**, aguardando validação. **Próximo passo real:** o
usuário disse que o capacity overlap "não pareceu funcionar" — precisa de
specifics dele (ver §5) antes de mexer.

---

## 1. Repo, run, deploy

- **Path:** `/Users/vgiono/Desktop/Kruzer/kruzer-dashboards`
- **Stack:** Cloudflare Worker (`src/worker.js` = router/proxy/MCP/OAuth; `src/mcp.js`).
  Front = HTML/JS estáticos em `public/` servidos pelo binding ASSETS.
- **Rodar local:** `npm run dev` (wrangler dev na :8787). `.dev.vars` tem as
  secrets reais (JIRA_EMAIL/API_TOKEN/CLOUD_ID, DASHBOARD_USER=`kruzer`,
  DASHBOARD_PASSWORD=`kruzer@2026`).
- **Deploy:** `npm run deploy` (PROD, worker `kruzer-dashboards`) ·
  `npm run deploy:hml` (HML, env `hml`, worker `kruzer-dashboards-hml`).
- **Auth:** Basic Auth em TUDO. No preview headless, semeie a credencial
  navegando primeiro pra `http://kruzer:kruzer%402026@localhost:8787/api/health`
  e depois pra URL limpa (o `fetch` relativo quebra se a URL tiver userinfo).
- **Goldens (OBRIGATÓRIO manter verde):** `npm run test:capacity` → 22 ok.
  Protegem a engine de capacity. Rode antes de commitar qualquer mudança em
  `shared/capacity.js`, `shared/report.js`, `shared/planner.js`.
- **Git:** branch `feat/ops-cockpit-and-d1` (HEAD `4748560`, pushada em
  `origin` = `git@github.com:kruzer-corp/kruzer-reports.git`).
  ⚠️ **`main` é história ÓRFÃ (site de reports estáticos legado) — NÃO TOCAR.**
  Commite/push só na branch feat.

---

## 2. Estado de deploy (prod ALINHADA com a branch — cutover feito em 2026-07-20)

| Ambiente | URL | Version | Conteúdo |
|---|---|---|---|
| **PROD** | kruzer-dashboards.matheus-mereb.workers.dev | `8187d150` | **branch HEAD inteira** (deploy cheio `npm run deploy`). Inclui TUDO: consolidação/pivot do KRZR (view única `/krzr/`; `/krzr/hml`→404), capacity overlap, cockpit (To-dos + semáforo + HyperCare fora de atraso), timeline (filtro multi-recurso por chips + roster do JIRA + gaps + KPIs em linha + sem disclaimers). |
| **HML** | kruzer-dashboards-hml.matheus-mereb.workers.dev | `176899fc` | branch HEAD inteira — igual à prod. |

**2026-07-20: prod deixou de ser seletiva.** O usuário aprovou publicar tudo, então
`npm run deploy` (cheio) subiu a branch inteira. Prod = HML = HEAD. Não há mais
divergência: daqui pra frente `npm run deploy` sobe tudo normalmente.

<details><summary>Técnica de DEPLOY SELETIVO (arquivada — só se um dia precisar subir só alguns arquivos)</summary>

```bash
git checkout <baseline> -- public/                                # tree = baseline da prod
git checkout HEAD -- public/<arquivos que vão>                    # sobrepõe só o que vai
git diff <baseline> --stat -- public/                             # CONFIRA
npm run deploy
git checkout HEAD -- public/                                      # restaura a tree pra HEAD
git status --short                                                # tem que ficar vazio
```
</details>

---

## 3. O que foi feito nesta sessão (commits `1479ea5..HEAD`)

Ordem cronológica. "HML" = só em HML; "PROD+HML" = nos dois.

1. **`0043310` feat(krzr): pivot de priorização** — 1ª versão (tinha colunas de status). *(superado pelos ajustes abaixo)* — HML.
2. **`2f181e1` refactor(krzr): consolida numa view única (v2/ITIL)** — havia 2 dashboards KRZR dessincronizados: `/krzr/` (antigo "Operations") e `/krzr/hml` (v2 ITIL, superset). Promoveu a v2 pra `public/krzr/index.html` (rota `/krzr/`), **deletou `public/krzr/hml.html`**, removeu banner de homologação, repontou links (landing 1 card só; cockpit `/krzr/hml`→`/krzr/`). — HML.
3. **`a55519b` + `764efa0` fix(krzr-pivot)** — pivot "Priorização do cliente" virou: **só tickets ABERTOS** por prioridade (sem colunas de status, sem concluídos), da menor→maior criticidade, dots de cor + barra proporcional, **todos os níveis sempre exibidos** (Low mesmo com 0), tabela **preenche a altura do card** (linhas distribuídas). É a 3ª coluna na row do "Open tickets by status" (grid-3). — HML.
4. **`85ab47f` feat(capacity): sobreposição** (engine + planner fst/pgm) — ver §4. — HML.
5. **`606abc3` feat(vena-capacity): sobreposição** — mesma feature portada pro `public/vena/capacity.html`. — HML.
6. **`e4babc6` fix(report-pdf): áreas escuras** — `report.js exportPDF`: html2canvas capturava com `backgroundColor:null` → JPEG (sem canal alfa) → transparente virava PRETO. Fix: captura com `#F4F4F8` + fill opaco no canvas de fatia. — **PROD+HML**.
7. **`4748560` fix(report-kpis): linha única** — `report.css .kpis`: era `repeat(5,1fr)` com 6 buckets → Hyper Care quebrava pra 2ª linha. Vira `repeat(6,1fr)` (linha única; media query <900px quebra em tela estreita). — **PROD+HML**.

**Já estava em prod (antes desta sessão, baseline 1479ea5):** rename Pague Menos
PGM→**PMD** (rotas `/pgm/` mantidas, marca "Pague Menos"), explosão hierárquica
nos reports+capacity, Gantt do report com cascata+setas de dependência, view
`/tempo` (timesheet), cockpit `/ops/`, D1, MCP+OAuth.

---

## 4. Feature de SOBREPOSIÇÃO no capacity (o tópico "quente")

**Problema que endereça:** o planner ignorava overlaps reais — flutuantes eram
serializados à força (`avoid()`), âncoras podiam colidir sem sinal. O usuário
quer prever/visualizar/manobrar sobreposições. Escolha dele: **(1) visibilidade
+ (2) concorrência planejada**, gatilho **"automático pelas datas reais + toggle
por track"**.

**Motor (`public/shared/capacity.js` `computeSchedule`)** — default `P=1`
INTOCADO (goldens 22/22):
- **Detecção de contenção:** pares na mesma track cujas janelas agendadas se
  cruzam **E** cuja soma de taxas semanais estoura o `throughputPerTrack` viram
  `sched.overlaps` (com `loadPct`) e marcam `e.overlapped`. Coexistência benigna
  e concorrência balanceada **não** alertam.
- **Concorrência por track:** `state.trackParallelism[ti] = P` → a track vira P
  sub-esteiras (throughput/P); flutuantes ficam P× mais lentos e **se
  sobrepõem**. `whatIfMode` força serial.

**UI (`shared/planner.js` fst/pgm + `vena/capacity.html`):**
- Toggle **"⇄ sobrepor / ×N"** por track no lane-head (cicla 1→2→3, grava em
  `trackParallelism`).
- **Heatmap POR TRACK** (linha por faixa vs sua capacidade + "Carga total") — era
  só agregado.
- Callout **"⚠ Sobreposições"** (par · track · período · % da faixa).
- Blocos em contenção com ⚠ + borda vermelha.

**Verificado (local):** mock serial vs ×2 → durações dobram, itens sobrepõem,
`concurrent=true`; `/pgm/capacity` (dados PMD) detecta **26 contenções reais**
(PMD sub-alocado em 2 tracks). Toggle persiste.

⚠️ **`vena/capacity.html` é arquivo SEPARADO** (duplica o padrão do planner.js).
Toda mudança no planner.js precisa ser portada nele à mão. A engine
(`capacity.js`) é compartilhada.

⚠️ **O board (esteira) é EMPACOTADO POR ESFORÇO** (largura do bloco = horas/SP),
**não é Gantt por data**. Então sobreposição NÃO aparece como barras
posicionalmente sobrepostas no board — aparece no **heatmap por track**, no
**callout** e nas **datas**. O único Gantt posicionado por data é o
`renderGantt` do status report (`shared/report.js`).

---

## 5. PENDENTE / próximos passos

1. **🔴 IMEDIATO — "capacity overlap não pareceu funcionar" (feedback do usuário).**
   A feature está verificada funcionando localmente. Hipóteses do porquê ele não
   viu efeito: (a) testou um planner sem contenção (FST/VENA bem gerenciados → 0
   overlaps → alerta oculto, que é correto); (b) esperava ver as barras se
   sobreporem no board (que é empacotado por esforço, não calendário — ver §4).
   **NÃO mude nada antes de obter do usuário:** qual planner testou, o que
   esperava vs o que apareceu (alerta/heatmap sumido? toggle ⇄ não mudou nada?),
   e erro do console (F12). Aí ataque o ponto certo.
2. **Promover HML→prod** quando validado: KRZR consolidação+pivot + capacity
   overlap. (Hoje prod só tem os fixes de report.)
3. **Backlog antigo** (de `docs/HANDOFF.md`): alertas cron→Slack (`assessRisks`
   já existe), intake do Sustain, paridade DCT no capacity, status×ciclos nativo,
   identidade por pessoa, setar `INSIGHTS_TOKEN`/`OAUTH_USERS` de prod, id do
   campo "Due Date Dev" no JIRA.

---

## 6. Arquitetura — o que um agente precisa saber

- **Módulos compartilhados:** `shared/report.js` (`KruzerReport.mount(CFG)`) e
  `shared/planner.js` (`KruzerPlanner.mount(CFG)`) servem os shells fst/pgm/vena
  via config. `shared/capacity.js` = engine única (`KruzerCapacity.*`).
  **`vena/capacity.html` é self-contained** (não usa planner.js) — porta as
  mudanças à mão.
- **Pague Menos = projeto JIRA `PMD`** (histórico: PGM→SAN→J4PM→revert→PGM→PMD).
  Rotas `/pgm/` mantidas; scope de remarks `pgm-report`; scope de capacity `pmd`
  (derivado da chave — MCP/report/cockpit dependem disso baterem).
- **KRZR:** em HML é **view única** (v2/ITIL) em `/krzr/` (`public/krzr/index.html`);
  `hml.html` foi deletado. Em **prod** ainda são 2 views (`/krzr/` antigo +
  `/krzr/hml`) — a consolidação não subiu.
- **Persistência:** D1 via `/api/state` (`shared/state.js`). Scopes: `*-capacity`
  (schedule publicado + cenários), `*-report` (remarks/followups). O report
  espelha o schedule PUBLICADO pelo planner (reabrir o planner republica).
- **Gotchas:**
  - html2canvas + JPEG: transparente → PRETO (foi o bug do PDF; fix = bg sólido).
  - **Screenshots do preview voltam EM BRANCO neste ambiente** — verifique via
    `preview_inspect` / evals de DOM, não por screenshot.
  - Goldens comparam a SAÍDA da engine (datas/tracks), não o objeto inteiro —
    campos aditivos (ex.: `sched.overlaps`) não dão drift.
  - **Cache de edge da Cloudflare** logo após deploy: use `?cb=$RANDOM` no curl
    pra confirmar conteúdo novo (o 1º fetch pode vir stale).
  - `zsh` não faz word-split de variável sem aspas (`for f in $VAR` roda 1×).
  - BSD `sed` (macOS) não tem `\b`.
- **Memória do agente** (fora do repo, mas é o log corrido da evolução):
  `~/.claude/projects/-Users-vgiono-Desktop-Kruzer/memory/ops-cockpit-d1-hml.md`
  e `krzr-hml-v2.md`.

---

## 7. Como validar rápido

```bash
npm run test:capacity                      # 22 ok, 0 drift
npm run dev                                # :8787
# no preview: seed auth em /api/health com userinfo, depois URL limpa
# curl com cache-bust:
set -a; . ./.dev.vars; set +a
U="$DASHBOARD_USER:$DASHBOARD_PASSWORD"
curl -s -u "$U" "https://kruzer-dashboards.matheus-mereb.workers.dev/shared/capacity.js?cb=$RANDOM" | grep -c trackParallelism   # PROD deve ser 0
```

Superfícies do capacity overlap (em HML): `/pgm/capacity`, `/fst/capacity`,
`/vena/capacity` → toggle ⇄ no cabeçalho de cada track, heatmap por track,
callout "⚠ Sobreposições".
