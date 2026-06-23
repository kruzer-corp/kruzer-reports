# Handoff — VENA Roadmap & Capacity v2

Cole esse briefing no Claude Code (cmd `claude` no terminal, dentro deste repo) com o repo aberto.

---

## TL;DR

Existe um v1 em `public/vena/roadmap.html` que projeta épicos do VENA num Gantt usando velocity × tracks paralelos. **Ele não atende o propósito de negócio porque trata a escala visual como calendário, não como esforço.** Reescreva como **v2** num arquivo novo (`public/vena/capacity.html`) mantendo o v1 intacto pra comparação. Quando o v2 estiver validado, o v1 pode ser arquivado.

A diferença mental: o v1 responde "quando cada épico cai no calendário". O v2 precisa responder "**quanto espaço cada épico ocupa na esteira e onde tem folga pra encaixar mais coisa**" — o tamanho visual do bloco vira a unidade de raciocínio do PD/PO.

---

## Contexto de negócio

Quem vai usar: PD do VENA (Matheus Mereb) e stakeholders pra planejamento de roadmap. Hoje no JIRA quase nenhum épico tem start/due date preenchido (só 2 de 23). Estimar SP por épico também está incompleto (só 4 épicos têm SP somados de stories). Isso **não vai melhorar tão cedo** — o sistema tem que funcionar bem com dados parciais e ajudar a tornar o esforço de estimativa **visual e iterativo**, não documental.

Job-to-be-done: "Eu, PD, quero olhar minha esteira de épicos abertos, ver de relance o tamanho relativo de cada um, arrastar pra reordenar prioridades, e ver imediatamente como minha entrega total escorrega ou adianta. Eu quero descobrir se a esteira está sobrecarregada antes de assumir mais um compromisso."

Não é Gantt tradicional. É **mais próximo de um Tetris de capacity**.

---

## Modelo conceitual (importante ler antes de codar)

### A unidade primária é esforço, não tempo

Cada épico tem um "tamanho" em story points (SP). Quando não tem SP no JIRA, o operador define o tamanho via uma de três fontes, em ordem de preferência:

1. **SP somado das histórias-filhas** (já temos via JQL `"Epic Link" in (...)` retornando children — checar `customfield_10016`)
2. **SP do próprio épico** se estiver preenchido em `customfield_10016`
3. **T-shirt size manual no UI**: XS=8, S=20, M=40, L=80, XL=160 — controle no card do épico permitindo o operador clicar e escolher, **persistindo no `localStorage`** (chave por épico-key). Sem precisar editar o JIRA.

Mostrar visivelmente a fonte (badge "real" / "rollup" / "manual"). Se nada disso existe, mostra um "?" e o épico fica **bloqueado** (ocupa um slot na esteira mas com hachura cinza dizendo "estimar antes de prometer").

### Capacidade é uma esteira contínua, não dates

Pense em "linhas de produção" (tracks). Cada track tem uma vazão de SP/semana. O operador configura:

- **Devs ativos** (default 4) e **velocity por dev** (default 5 SP/sem) → squad total
- **Tracks paralelos** (default 2) — número de épicos que podem rodar em paralelo
- **Throughput por track** = (devs × velocity) / tracks paralelos

A esteira de cada track é uma fila horizontal de blocos onde **largura do bloco em pixels é proporcional ao SP**, não à data. Calendário aparece como overlay (uma régua em cima mostrando "se você começar dia X, esse bloco termina dia Y") mas a régua se move sozinha quando você arrasta — datas são *consequência*, não premissa.

### Drag-and-drop é a interação central

O operador pode:

- **Arrastar épico verticalmente** entre tracks (muda quem trabalha em quê)
- **Arrastar horizontalmente** dentro do mesmo track pra reordenar (prioridade)
- **Arrastar épico do "Backlog não escalado"** (lateral direita) pra dentro da esteira
- **Arrastar de volta pro Backlog** pra tirar do plano
- **Resize do bloco** segurando uma "alça" lateral pra ajustar o SP manualmente (snap a múltiplos de 4 SP)

Toda interação reescreve **datas projetadas em tempo real** e atualiza a régua de calendário.

### Épicos comprometidos são imutáveis (com escape hatch)

Épicos que têm start date real no JIRA (`customfield_10015`) e/ou estão em "Em Desenvolvimento" são marcados como **committed** — bloco com borda sólida, não arrastável. Toggle "Modo what-if" no header destrava tudo e permite simular cenários alternativos sem persistir.

### Conflito visual de overload

Se a esteira é arrastada/preenchida de modo que um track fica com épicos que vão além de um horizonte definido (ex.: 12 semanas), os blocos excedentes ganham **overlay vermelho diagonal** com tooltip "estoura horizonte em N semanas". Isso é o sinal de "você prometeu demais".

### Heatmap de capacity

Embaixo do Gantt, uma barra horizontal mostra "carga por semana" pelas próximas 26 semanas (~6 meses). Verde se sub-100% capacity, amarelo se 100–110%, vermelho se >110%. Esse é o "termômetro" — se a barra vira vermelho em alguma semana, alguém vai estar afogado.

---

## Requisitos funcionais (priorizados)

### Must-have (P0)

1. **Carregar épicos não-resolvidos do VENA** via JQL `project = VENA AND issuetype = Epic AND resolution is EMPTY ORDER BY rank ASC`. Campos: `summary, status, priority, assignee, customfield_10015 (start), customfield_10016 (SP), duedate, labels`.
2. **Carregar children stories** dos épicos via `"Epic Link" in (...)` ou `parent in (...)`, agregando `customfield_10016` por parent. (Hoje, o JQL "Epic Link" funciona — testei.)
3. **Resolver tamanho do épico** usando hierarquia: rollup de stories → SP do épico → manual (localStorage) → "?" placeholder.
4. **Renderizar tracks horizontais** com blocos cuja largura é proporcional ao SP. Régua de tempo em cima (semanas + meses) derivada da posição × throughput.
5. **Drag-and-drop** entre tracks, reordenação dentro do track, e backlog↔track. Use lib HTML5 nativa ou SortableJS via CDN.
6. **Recalcular datas projetadas instantaneamente** ao arrastar — sem botão "recalcular".
7. **Persistir alterações manuais** (ordem, T-shirt sizes, assignee override) em `localStorage` por épico-key. Botão "Resetar pro JIRA" pra limpar overrides.
8. **Heatmap de capacity** semanal embaixo do Gantt, com cores conforme overload.
9. **Painel lateral de detalhe** ao clicar num épico: dados do JIRA + override manual + lista de stories-filho + link pro JIRA.
10. **Marcador "HOJE"** vertical na régua, com data e dia da semana.

### Should-have (P1)

11. **Modo what-if** — toggle que destrava épicos committed. Auto-volta pro modo "real" ao recarregar (não persiste).
12. **Cenários salvos** — operador pode salvar o estado atual com um nome (ex: "cenário pessimista", "cenário com FastShop priorizado") em localStorage e alternar entre eles.
13. **Export PNG do Gantt** — botão que gera screenshot do estado atual via `html2canvas` (CDN) pra colar em apresentação.
14. **Dependências entre épicos** — operador pode declarar "VENA-X depende de VENA-Y" e o sistema reordena automaticamente. UI: arrastar do bloco A pro bloco B com tecla Shift. Persist no localStorage.
15. **Comparação "promised vs actual"** — se um épico committed tem due date no JIRA, mostrar uma linha de "due date prometido" no bloco; se a projeção ultrapassar o due date, o bloco fica vermelho.

### Nice-to-have (P2)

16. **Simulação Monte Carlo** — ao invés de velocity fixa, usar distribuição (ex: 12–25 SP/sem normal) e mostrar P50/P85 do fim do roadmap.
17. **Diff entre cenários** — escolhe dois cenários salvos e mostra delta de épicos e datas.
18. **Print-friendly view** — `@media print` que reorganiza o Gantt pra caber em A3 paisagem.

### Out of scope (não fazer)

- Edição que persiste de volta no JIRA. Tudo local. (Risco: confusão sobre source of truth.)
- Login por usuário ou sync entre dispositivos. O `localStorage` é "memória do PD que olhou".
- Mobile / responsive deep. É ferramenta de desktop, design pra ≥1280px.
- Outros projetos. Esse dashboard é específico do VENA. Se generalizar depois, pensar numa abstração — não agora.

---

## Acceptance criteria (definição de pronto)

- [ ] Abro `http://localhost:8787/vena/capacity`, vejo 23 épicos do VENA distribuídos em 2 tracks por default, com tamanhos de bloco proporcionais ao SP.
- [ ] Épicos sem SP aparecem com placeholder "?" e bloco hachurado.
- [ ] Clico no "?" e abro um picker T-shirt (XS/S/M/L/XL) — escolho, bloco redimensiona, persiste após reload.
- [ ] Arrasto épico VENA-205 do track 2 pro track 1 e vejo todas as datas projetadas se atualizarem instantaneamente.
- [ ] Heatmap embaixo mostra alguma semana em vermelho/amarelo se eu empilhar épicos demais num track.
- [ ] Régua de calendário em cima mostra "HOJE" e os meses corretos.
- [ ] Clico em qualquer bloco e abre painel lateral com: status JIRA, assignee, lista de stories-filho com checkbox de done/não, link pro JIRA.
- [ ] Toggle "What-if mode" desbloqueia VENA-145 (Em Desenvolvimento) e VENA-161 (Em Refinamento) e me deixa arrastá-los.
- [ ] Botão "Resetar pro JIRA" limpa todos os overrides do localStorage e a UI volta ao estado base.
- [ ] Botão "Export PNG" gera um arquivo `vena-capacity-<timestamp>.png` com o Gantt visível.
- [ ] Refresh: clique em "Atualizar dados" puxa de novo do JIRA mas **preserva** os overrides locais (não sobrescreve T-shirt sizes nem reordenação).

---

## Arquitetura sugerida

```
public/vena/capacity.html              # arquivo principal — self-contained
public/vena/capacity-engine.js         # opcional: pode ficar inline ou separado. Tem schedule(), tshirtMap, persistência localStorage. ~300 LOC.
public/vena/capacity-styles.css        # opcional: pode ficar inline. Estilos do Gantt.
```

**Prefira manter tudo num único `public/vena/capacity.html`** seguindo o padrão dos outros dashboards (`public/vena/index.html`, `public/fst/index.html`). Só extrai se passar de ~1.500 linhas. Se extrair, mantenha tudo sob `public/vena/` — não polua `public/shared/` (esse fica só pra coisas usadas por mais de um projeto, como o `api.js`).

### Bibliotecas externas (via CDN — todas já validadas no Worker)

- `gridjs@5.0.2` — tabela de detalhe (já usado no v1).
- `chart.js@4.5.0` — pro heatmap, opcional. Gráfico custom de barra também serve.
- **`sortablejs@1.15.x`** — drag-and-drop entre tracks. **Adicionar**. CDN: `https://cdn.jsdelivr.net/npm/sortablejs@1.15.2/Sortable.min.js`.
- **`html2canvas@1.4.x`** — pro Export PNG, lazy-load. CDN: `https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js`.
- Inline o `KruzerAPI` helper (mesmo padrão que apliquei no v1) — evita dependência de `/api.js`.

### Modelo de dados em memória

```ts
type Epic = {
  // dados do JIRA (imutáveis no client)
  key: string;
  summary: string;
  status: 'Backlog' | 'Em Refinamento' | 'Em Desenvolvimento' | 'Bloqueado';
  priority: 'Highest' | 'High' | 'Medium' | 'Low';
  assignee: string | null;
  jiraStart: Date | null;       // customfield_10015
  jiraDue: Date | null;          // duedate
  jiraSp: number | null;         // customfield_10016 no épico
  childrenSpSum: number | null;  // soma dos customfield_10016 das stories-filho
  childrenCount: number;
  isCommitted: boolean;          // true se jiraStart != null OU status == 'Em Desenvolvimento'

  // estado computado (mutável via UI)
  manualSpOverride: number | null;  // do localStorage
  effectiveSp: number;              // resolvido pela hierarquia
  spSource: 'rollup' | 'epic-jira' | 'manual' | 'placeholder';
  trackIdx: number;                 // qual track ocupa (mutável)
  orderInTrack: number;             // posição na fila do track
  scheduledStart: Date;             // derivado
  scheduledEnd: Date;               // derivado
  dependencies: string[];           // keys de épicos que precisam terminar antes
};

type ScenarioState = {
  name: string;
  velocity: number;
  parallelTracks: number;
  trackAssignments: Record<string /*epicKey*/, { trackIdx: number; orderInTrack: number }>;
  manualSp: Record<string /*epicKey*/, number>;
  dependencies: Record<string /*epicKey*/, string[]>;
  whatIfMode: boolean;
  createdAt: string;
};

// localStorage keys
// kruzer:vena-capacity:current-scenario  → ScenarioState
// kruzer:vena-capacity:saved-scenarios   → Array<ScenarioState>
```

### Algoritmo de scheduling (substitui o do v1)

Dado um state e a lista de épicos:

1. Pra cada épico, calcula `effectiveSp` via hierarquia rollup→jira→manual→placeholder.
2. Pra cada track:
   - `cursor = max(today, earliest committed start in track)`
   - Pra cada épico na ordem `orderInTrack`:
     - Se tem dependência em outro épico (em qualquer track), `cursor = max(cursor, dep.scheduledEnd)`.
     - `scheduledStart = cursor`
     - `duration_weeks = effectiveSp / throughputPerTrack`
     - `scheduledEnd = scheduledStart + duration_weeks * 7 dias`
     - `cursor = scheduledEnd`
3. Pra épicos committed com `jiraStart` real e modo what-if off: força `scheduledStart = jiraStart`, ajusta `cursor` do track.

Função pura, retorna lista de épicos com `scheduledStart/scheduledEnd` populados. Re-roda em cada interação.

### Heatmap (overload por semana)

```
totalWeeks = 26 (configurável)
para cada semana W em [today, today+26 weeks]:
  loadInWeek = soma dos SP dos épicos cujo [scheduledStart, scheduledEnd] cruzam W,
               proporcional à fração da semana ocupada
  capacityInWeek = velocity * devs
  pct = loadInWeek / capacityInWeek
  cor = pct < 1 ? 'green' : pct < 1.1 ? 'yellow' : 'red'
```

Renderiza como 26 retângulos de altura fixa, largura igual à do calendário, alinhados com a régua.

### Persistência: o que vai no localStorage

Tudo que é override do operador. **Nunca** dados do JIRA (esses recarregam a cada refresh). A cada interação que muda estado: `debounce(saveScenario, 300ms)`.

Ao carregar a página:
1. Fetch JIRA.
2. Merge com `localStorage:current-scenario` — se a key do épico existe no override, aplica; se não, usa default (track 1 ou 2 alternando por prioridade).
3. Re-roda scheduling, renderiza.

---

## Decisões já tomadas (não revisitar)

- **Cada dashboard self-contained** — não criar shared.js novo. KruzerAPI inline.
- **Sem framework JS** — vanilla, CDN, zero build step. (Já testei SortableJS e html2canvas via CDN, ambos funcionam.)
- **Worker assets binding** — não mexer em `wrangler.toml`.
- **JQL puxa universo, filtros são client-side** — manter.
- **Datas de calendário derivam do esforço** — esse é o ponto-chave do v2. Não voltar pra abordagem do v1.

## Decisões que você precisa tomar

- **Bibliotecas de UI**: se quiser usar uma lib de Gantt pronta (Frappe Gantt, dhtmlxGantt, Bryntum) pra economizar trabalho — fique à vontade, **desde que** ela suporte largura de bloco proporcional ao esforço (não data) e drag-and-drop. Se nenhuma encaixa bem, vai de SVG custom igual ao v1. Avalie e justifique no commit message.
- **T-shirt sizing**: os valores que sugeri (8/20/40/80/160) são ponto de partida. Se a análise dos épicos com SP real (VENA-161=80, VENA-205=69, VENA-284=25, VENA-40=7 do v1) sugerir outra escala, ajuste e comente.
- **Default velocity**: comecei com 20 SP/sem no v1, mas o squad VENA hoje tem 2 devs (Hernandes Bom Jardim Falcão, Gabriel Sola — Matheus é PD, não conta como dev). Recalcule um default razoável. Se houver dados históricos de throughput em outros lugares (KRZR? VENA resolvido?), use.

---

## Como testar

```bash
npm install
cp .dev.vars.example .dev.vars       # se ainda não existe
# preenche com token Atlassian real
npm run dev
# abre http://localhost:8787/vena/capacity
# Basic Auth: DASHBOARD_USER / DASHBOARD_PASSWORD do .dev.vars
```

Testes manuais a fazer antes de marcar acceptance criteria:

1. **Smoke test** — todos os 23 épicos aparecem, sem erro no console.
2. **Override persistence** — define T-shirt size em VENA-222, dá refresh, valor persiste.
3. **Drag entre tracks** — VENA-205 do track 1 pro track 2, datas mudam, heatmap recalcula.
4. **What-if toggle** — VENA-145 vira arrastável, depois toggle off, volta a bloquear.
5. **Reset** — clica "Resetar pro JIRA", todos os overrides somem.
6. **Refresh** — clica "Atualizar dados", overrides persistem mas dados do JIRA recarregam (testa mudando algo no JIRA via UI e refresheando).
7. **Export PNG** — gera arquivo, abre, dá pra ler.
8. **Performance** — interação de drag não deve travar. Se o scheduling demora >100ms em 30 épicos, otimizar.

## Index e navegação

Atualizar `public/index.html`: substituir o card "VENA — Roadmap & Capacity" (que aponta pra `/vena/roadmap` do v1) por um card pro `/vena/capacity` v2, ou criar ambos lado a lado até validar. **Sugestão**: deixe os dois links por 1 semana, com badge "BETA" no v2; quando o Matheus validar, remove o v1 (`public/vena/roadmap.html`).

## Contexto JIRA (referência)

- Cloud ID: `dd987a38-5d13-4230-ab43-7141dc3695e1`
- Cloud URL: `https://kruzer.atlassian.net`
- Projeto: VENA
- Campos custom relevantes: `customfield_10015` (Start date), `customfield_10016` (Story Points)
- Total épicos não-resolvidos hoje (18/06/2026): **23**
- Épicos com SP somado de stories: 4 (VENA-161=80, VENA-205=69, VENA-284=25, VENA-40=7 — esse último resolvido na prática mas com status "Bloqueado", caso isolado)
- Épicos com start/due date: VENA-145 (start+due), VENA-161 (start+due), VENA-40 (só start)
- Resto: backlog puro, sem dates nem SP.

## Quando estiver pronto

Commit/push, valida no Worker em produção (`npm run deploy`), manda URL pro Matheus pra ele testar o fluxo de drag-and-drop com a esteira real.

Se travar em algo conceitual (ex: "como mostrar que um épico atrasado bloqueia 3 outros"), abra issue no repo com screenshot e pergunte. Não tente resolver sozinho — esse dashboard é uma ferramenta de raciocínio do PD, então pequenas decisões de UI mudam o uso.
