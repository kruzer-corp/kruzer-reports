# Golden tests da engine de capacity

**Data:** 2026-06-25
**Arquivos:** `scripts/capacity-golden.js` (harness), `scripts/capacity-fixtures.js` (cenários), `scripts/__goldens__/*.json` (saídas esperadas commitadas).

## Por que isso existe

`computeSchedule()` — a engine que converte **esforço → cronograma** — está **duplicada** em 4 lugares:

| Arquivo | Papel | Unidade | Particularidades |
|---|---|---|---|
| `public/vena/capacity.html` | Planner (publica) | Story Points | rollup de filhos, conversão horas→SP (`hoursPerSp`), track dedicada 99Food (VENA-145) |
| `public/fst/capacity.html` | Planner (publica) | Horas | sem rollup, sem dedicada, `DEFAULT_TRACK` (FST-133), prioridades P0-P3 |
| `public/vena/roadmap.html` | Report (espelha) | — | engine **divergente** (fallback quando não há schedule publicado) |
| `public/fst/index.html` | Report (espelha) | — | idem |

O padrão **publish/mirror** esconde o risco no caso normal (o report renderiza o schedule **publicado** pelo planner no D1), mas qualquer mudança de regra precisa ser replicada manualmente, e o report cai na **própria** engine quando não há publish. Antes de **consolidar tudo numa engine única** em `shared/capacity.js`, precisamos de uma rede de segurança que prove **zero drift**.

Estes golden tests **fixam o comportamento atual** da engine do planner (a canônica, que publica). São a referência contra a qual o refactor de consolidação será validado.

## Como funciona

O harness **não reescreve** a engine: ele **extrai o source real** de `computeSchedule` (e dependências: `resolveSp`, `ensureAssignments`, helpers e constantes) direto do `.html`, **congela o relógio** num instante fixo, roda contra fixtures sintéticas e compara a saída normalizada (datas, durações, tracks, flags `late`/`overHorizon`, fonte do SP) com o golden commitado.

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

## Como usar na consolidação (o objetivo)

1. **Antes de mexer:** `npm run test:capacity` deve passar (baseline verde).
2. **Extraia** `computeSchedule` pra `shared/capacity.js`, parametrizando as dependências de closure (campo de esforço, `capacityPerWeek`, tracks dedicadas, `DEFAULT_TRACK`, `hoursPerSp`, prioridades) — VENA e FST passam sua **variante via config**, não via cópia.
3. **Aponte** os 4 callers pra engine compartilhada.
4. **Rode** `npm run test:capacity`. Se passar, o refactor preservou o comportamento — pode seguir. Se falhar, o diff mostra exatamente qual cronograma mudou.

> Quando uma mudança de comportamento for **intencional**, rode `test:capacity:update` e **revise o diff dos goldens** no PR — assim toda alteração de cronograma fica explícita e revisável.

## Achado: planner ≠ report (a divergência a resolver)

A engine do **report** (`vena/roadmap`, `fst/index`) é uma reimplementação **mais simples e divergente** da do planner:

- mede em **horas** com `effortH` + `PLACEHOLDER_H` — **sem** rollup de filhos, **sem** conversão `hoursPerSp`, **sem** track dedicada;
- usa `priorityTier` (P0-P3) e um `DEFAULT_TRACK` próprio;
- lê params do `localStorage` (`capParams`), não do `STATE` do planner.

Ou seja: **quando o report cai na própria engine** (sem schedule publicado), ele pode produzir um cronograma **diferente** do planner pros mesmos épicos. A consolidação precisa **decidir quais regras vencem** (as do planner, mais completas, são a escolha natural) e então fazer o report usar a mesma engine. Os goldens do planner são o alvo de comportamento; um próximo passo é adicionar fixtures/goldens pro report e provar a convergência.

## Limitações (honestas)

- Cobre a engine do **planner** (VENA + FST). As engines dos **reports** ainda não têm goldens — é o próximo passo natural (o harness já é multi-engine; falta declarar os arquivos de report em `PLANNERS` com o mapeamento de campos deles).
- Fixtures são **sintéticas** (não snapshot do JIRA real), por design: determinísticas e focadas nos ramos da engine.
- A extração assume que as funções-alvo não contêm `{`/`}` dentro de string/regex/comentário (verificado hoje). Se isso mudar, o scanner em `capacity-golden.js` precisa evoluir.
