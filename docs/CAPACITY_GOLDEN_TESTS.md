# Golden tests da engine de capacity

**Data:** 2026-06-25 · **Status:** engine CONSOLIDADA (Fase C concluída).
**Arquivos:** `scripts/capacity-golden.js` (harness), `scripts/capacity-fixtures.js` (cenários), `scripts/__goldens__/*.json` (saídas esperadas commitadas).

## Por que isso existe

`computeSchedule()` — a engine que converte **esforço → cronograma** — estava **duplicada** em 4 lugares. Foi **consolidada numa engine única** em `public/shared/capacity.js` (`KruzerCapacity.ensureAssignments` / `KruzerCapacity.computeSchedule`). Estes golden tests foram a rede de segurança que **provou zero drift** na consolidação e seguem protegendo contra regressões.

| Arquivo | Papel | Unidade | Como usa a engine única |
|---|---|---|---|
| `public/vena/capacity.html` | Planner (publica) | Story Points | `cfg`: resolveEffort=`resolveSp` (rollup + horas→SP), dedicada 99Food (VENA-145) |
| `public/fst/capacity.html` | Planner (publica) | Horas | `cfg`: resolveEffort=`resolveSp` (horas), sem dedicada, `DEFAULT_TRACK` (FST-133) |
| `public/vena/roadmap.html` | Report (espelha) | Horas | `cfg`: resolveEffort=`effortH`, sem dedicada; adapta RAW→épico via `adaptReportEpic` |
| `public/fst/index.html` | Report (espelha) | Horas | idem |

A **variação por projeto** (resolução de esforço, prioridades Highest/High vs P0/P1, track dedicada, `DEFAULT_TRACK`) entra via `cfg`. O **algoritmo** de alocação em tracks, sequência, dependências e flags vive SÓ na engine compartilhada.

## Como funciona

O harness carrega a engine REAL de `shared/capacity.js`, extrai de cada caller a sua **resolução de esforço real** (`resolveSp`/`effortH`) + constantes direto do `.html`, **congela o relógio** num instante fixo, roda contra fixtures sintéticas e compara a saída normalizada (datas, durações, tracks, flags `late`/`overHorizon`, fonte do esforço) com o golden commitado.

Cobertura das fixtures (cada uma exercita ramos distintos): placement round-robin, **rollup** de filhos, **horas→SP**, **placeholder**, **track dedicada**, **dependências** entre tracks, **committed-lock** com `jiraStart`, **late** (due < fim projetado) e **overHorizon**.

## Uso

```bash
npm run test:capacity          # compara com os goldens. Sai 1 se houver drift.
npm run test:capacity:update   # (re)grava os goldens. Use SÓ ao mudar a engine de propósito.
```

Saída em drift aponta o caminho exato, ex.:
```
❌ basic — DRIFT: epics.0.durDays: golden=13 atual=14
```

## Manutenção / mudanças futuras de regra

1. **Antes de mexer:** `npm run test:capacity` deve passar (baseline verde — 18 cenários: VENA/FST × planner/report).
2. Mude a engine em `shared/capacity.js` (ou a `cfg`/`resolveEffort` de um caller).
3. **Rode** `npm run test:capacity`. Verde = comportamento preservado. Vermelho = o diff aponta exatamente qual cronograma mudou.
4. Quando a mudança for **intencional**, rode `npm run test:capacity:update` e **revise o diff dos goldens** no PR — toda alteração de cronograma fica explícita e revisável.

## Como a consolidação foi validada (zero drift)

- **Planners:** o harness passou a rodar a engine de `shared/capacity.js` contra os goldens que já tinham sido gerados pela engine antiga in-file. Bateram **byte a byte** → `shared ≡ planner antigo`.
- **Reports:** rodou-se a engine **antiga** do report (extraída do arquivo) contra as mesmas fixtures e comparou-se o schedule (track, datas, late, esforço) com a engine consolidada → **idêntico** nos 8 cenários.
- **Render:** as 4 páginas foram carregadas em browser headless após a migração — board (`.lane`) e Gantt (`#ganttSvg`) renderizam, **zero erro de engine** no console.

A divergência histórica planner≠report era no **algoritmo** (que agora é único). A diferença que **permanece de propósito** é só a **resolução de esforço**: o report mede em horas (`effortH`) porque seu dado de entrada é horas; o planner do VENA tem rollup + horas→SP porque tem esse dado. Isso é variação legítima de contexto, isolada em `cfg.resolveEffort` — não duplicação de lógica de scheduling. No caso normal o report **espelha** o schedule publicado pelo planner (D1); a engine só roda no fallback (`localPlan`).

## Limitações (honestas)

- Fixtures são **sintéticas** (não snapshot do JIRA real), por design: determinísticas e focadas nos ramos da engine.
- A extração da `resolveEffort` de cada arquivo assume que essas funções não contêm `{`/`}` dentro de string/regex/comentário (verificado). Se mudar, o scanner em `capacity-golden.js` precisa evoluir.
