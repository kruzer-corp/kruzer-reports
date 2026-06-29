// ============================================================================
// Kruzer Capacity — helpers compartilhados de cronograma e persistência.
// Origem: refactor Fase B (2026-06-25, HANDOFF_OPS_CONTROL.md).
//
// Conteúdo:
//   · Helpers de tempo/string (MS_DAY, startOfDay, addDays, cleanName, keyNum)
//   · Cores de bloco por status (BLK_HEX)
//   · IO de persistência (readPublishedSchedule / publishSchedule)
//   · Engine de scheduling (ensureAssignments / computeSchedule) — FONTE ÚNICA
//
// Histórico: a engine `computeSchedule` vivia duplicada em 4 lugares (vena/fst ×
// planner/report). Consolidada aqui (2026-06-25, Fase C) após a suíte de golden
// tests (scripts/capacity-golden.js) garantir zero drift. As variantes por
// projeto (resolução de esforço, prioridades, track dedicada) entram via `cfg`.
// ============================================================================

window.KruzerCapacity = (function () {
  const MS_DAY = 86400000;

  // Id do custom field "Due Date Dev" (marco de ENTREGA DO DEV pra testes — o mais
  // importante pros recursos de dev, mas NÃO é o goal final do projeto, então NÃO
  // entra em cálculo de atraso/risco). Vazio = desligado (o JIRA ainda não tem o
  // campo). Quando o campo for criado, basta preencher o id aqui (ex.:
  // 'customfield_XXXXX') que todos os dashboards passam a ler/exibir. Enquanto
  // isso, os reports também aceitam "**Due Dev:** DD/MM" na descrição do épico.
  const DEV_DUE_FIELD = '';

  function startOfDay(d) {
    const r = new Date(d);
    r.setHours(0, 0, 0, 0);
    return r;
  }

  // setDate-based (calendário), idêntico ao addDays dos callers — evita drift de
  // hora em fronteiras de DST. A engine de scheduling depende disso.
  function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }

  // Remove prefixos DMND0000 |, P0 |, Onda 1 |, Done | etc.
  function cleanName(s) {
    return String(s || '').replace(/^(DMND\d+|P\d|Onda\s*\d+|Done)\s*\|\s*/i, '').trim();
  }

  // Paleta de blocos por status (alinhada à paleta Kruzer em /shared/tokens.css).
  const BLK_HEX = {
    's-dev':     '#12B76A', // success — em desenvolvimento
    's-uat':     '#7C3AED', // violeta — UAT (testes do cliente, antes da entrega)
    's-refin':   '#3151CE', // primary — refinamento
    's-warn':    '#F79009', // warning — atenção
    's-neutral': '#C6C9D9', // neutral — sem ação
    's-backlog': '#48507D', // navy-300 — backlog
    's-block':   '#F04438', // error   — bloqueado
  };

  // ── Persistência (Camada 1: D1 via /api/state, cache local).
  // Scope canônico: '<projeto>-capacity', key fixa 'schedule'.
  // KruzerState garante leitura síncrona (cache) + sync em background + escrita async.
  function legacyKey(scope) { return `kruzer:${scope}-capacity:schedule`; }
  function stateScope(scope) { return `${scope}-capacity`; }

  // Migração one-shot: se houver schedule na chave antiga, importa pra nova
  // estrutura sem sobrescrever. Idempotente.
  function ensureMigrated(scope) {
    if (typeof window === 'undefined' || !window.KruzerState) return;
    window.KruzerState.importLegacyKey(legacyKey(scope), stateScope(scope), 'schedule');
  }

  function readPublishedSchedule(scope) {
    ensureMigrated(scope);
    // Primeiro tenta state.js (cache local + sync server em background).
    if (typeof window !== 'undefined' && window.KruzerState) {
      const r = window.KruzerState.read(stateScope(scope), 'schedule');
      if (r && r.value && r.value.v === 1 && Array.isArray(r.value.lanes)) return r.value;
    }
    // Fallback duro: chave legacy direto no localStorage.
    try {
      const raw = localStorage.getItem(legacyKey(scope));
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || s.v !== 1 || !Array.isArray(s.lanes)) return null;
      return s;
    } catch { return null; }
  }

  function publishSchedule(scope, payload) {
    ensureMigrated(scope);
    // Mantém a chave legacy escrita também — durante a migração, outros tabs/dashboards
    // que ainda lêem direto continuam funcionando. Remover depois que todos migrarem.
    try { localStorage.setItem(legacyKey(scope), JSON.stringify(payload)); } catch {}
    // Escreve via state.js (otimista local + PUT pro D1).
    if (typeof window !== 'undefined' && window.KruzerState) {
      // Pega versão atual pra optimistic concurrency.
      const cur = window.KruzerState.read(stateScope(scope), 'schedule');
      window.KruzerState.write(stateScope(scope), 'schedule', payload, {
        expectedVersion: cur ? cur.version : undefined,
      }).catch(() => { /* mantém cache local; servidor pode estar offline */ });
    }
    return true;
  }

  // Sincronização proativa: chamar no boot da página pra puxar mudanças
  // feitas em outro navegador desde a última visita.
  async function syncSchedule(scope) {
    if (typeof window === 'undefined' || !window.KruzerState) return null;
    return window.KruzerState.sync(stateScope(scope), 'schedule');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Engine de scheduling — FONTE ÚNICA (esforço → cronograma).
  // Consolidada de 4 cópias (vena/fst × planner/report). O algoritmo de
  // alocação em tracks, sequência, dependências e flags vive SÓ aqui. As
  // variantes por projeto entram via `cfg`:
  //   cfg.resolveEffort(epic, state) -> { sp, source }   (SP, horas, rollup…)
  //   cfg.prioRank        -> mapa prioridade → rank (Highest/High… ou P0/P1…)
  //   cfg.dedicatedKey    -> épico de track dedicada (ou null/sentinela)
  //   cfg.defaultTrack    -> mapa epicKey → trackIdx fixo (ou {})
  //   cfg.heatmapWeeks    -> piso de semanas do board (default 26)
  // epic espera: { key, priority, isCommitted, done, jiraStart:Date|null, jiraDue:Date|null }
  // state espera: { devs, velocityPerDev, parallelTracks, horizonWeeks, whatIfMode,
  //                 trackAssignments, backlog, manualSp, dependencies }
  // Rede de segurança: scripts/capacity-golden.js (npm run test:capacity).
  // ══════════════════════════════════════════════════════════════════════════
  function keyNum(k) { const n = parseInt(String(k).split('-')[1]); return isNaN(n) ? 0 : n; }

  // Layout default: distribui épicos sem assignment válido nas tracks
  // (committed → prioridade → key), respeitando overrides e DEFAULT_TRACK.
  function ensureAssignments(epics, state, cfg) {
    const prioRank = cfg.prioRank || {};
    const defaultTrack = cfg.defaultTrack || {};
    const dedicatedKey = cfg.dedicatedKey;
    const p = state.parallelTracks;
    const inBacklog = new Set(state.backlog || []);
    const ordered = [...epics].sort((a, b) => {
      if (!!a.isCommitted !== !!b.isCommitted) return a.isCommitted ? -1 : 1;
      const pa = prioRank[a.priority] ?? 9, pb = prioRank[b.priority] ?? 9;
      if (pa !== pb) return pa - pb;
      return keyNum(a.key) - keyNum(b.key);
    });
    let rr = 0;
    for (const e of ordered) {
      if (e.key === dedicatedKey) { delete state.trackAssignments[e.key]; continue; }
      if (e.done) { delete state.trackAssignments[e.key]; continue; }
      if (inBacklog.has(e.key)) { delete state.trackAssignments[e.key]; continue; }
      const cur = state.trackAssignments[e.key];
      if (cur && cur.trackIdx < p) continue;
      let trackIdx;
      if (defaultTrack[e.key] != null && defaultTrack[e.key] < p) trackIdx = defaultTrack[e.key];
      else { trackIdx = rr % p; rr++; }
      const orderInTrack = Object.values(state.trackAssignments).filter(a => a.trackIdx === trackIdx).length;
      state.trackAssignments[e.key] = { trackIdx, orderInTrack };
    }
    // clamp: épicos em track >= p (reduziu tracks) vão p/ última track
    for (const k in state.trackAssignments) {
      if (state.trackAssignments[k].trackIdx >= p) state.trackAssignments[k].trackIdx = p - 1;
    }
  }

  // Engine pura: esforço → datas. Determinística dado (epics, state, cfg, hoje).
  function computeSchedule(epics, state, cfg) {
    const resolveEffort = cfg.resolveEffort;
    const dedicatedKey = cfg.dedicatedKey;
    const heatmapWeeks = cfg.heatmapWeeks || 26;
    const today = startOfDay(new Date());
    const squad = state.devs * state.velocityPerDev;
    const throughputPerTrack = squad / state.parallelTracks;

    const byKey = {};
    const list = epics.map(e => {
      const { sp, source } = resolveEffort(e, state);
      const committedLocked = e.isCommitted && !state.whatIfMode;
      const o = {
        ...e, effectiveSp: sp, spSource: source, committedLocked,
        trackIdx: state.trackAssignments[e.key]?.trackIdx ?? null,
        orderInTrack: state.trackAssignments[e.key]?.orderInTrack ?? 0,
        inBacklog: (state.backlog || []).includes(e.key),
        dependencies: (state.dependencies && state.dependencies[e.key]) || [],
        scheduledStart: null, scheduledEnd: null, overHorizon: false, late: false,
      };
      byKey[e.key] = o;
      return o;
    });

    // Track dedicada (fora da regra do squad): stream próprio, não consome o squad.
    const dedEpic = dedicatedKey ? (byKey[dedicatedKey] || null) : null;
    if (dedEpic) dedEpic.isDedicated = true;
    const dedThroughput = state.velocityPerDev;

    const placed = list.filter(e => !e.inBacklog && e.trackIdx != null && e.key !== dedicatedKey && !e.done);
    const tracks = Array.from({ length: state.parallelTracks }, () => []);
    placed.forEach(e => tracks[Math.min(e.trackIdx, state.parallelTracks - 1)].push(e));
    tracks.forEach(t => t.sort((a, b) => a.orderInTrack - b.orderInTrack));

    const horizonEnd = addDays(today, state.horizonWeeks * 7);

    function scheduleSequential(track, perTrack) {
      let cursor = today;
      track.forEach(e => {
        let startMin = cursor;
        if (e.committedLocked && e.jiraStart) {
          startMin = new Date(Math.max(startMin.getTime(), startOfDay(e.jiraStart).getTime()));
        }
        e.dependencies.forEach(depKey => {
          const dep = byKey[depKey];
          if (dep && dep.scheduledEnd) startMin = new Date(Math.max(startMin.getTime(), dep.scheduledEnd.getTime()));
        });
        const durDays = Math.max(1, Math.round((e.effectiveSp / perTrack) * 7));
        e.scheduledStart = startOfDay(startMin);
        e.scheduledEnd = addDays(e.scheduledStart, durDays);
        cursor = e.scheduledEnd;
      });
    }

    // resolução de dependências entre tracks: itera até estabilizar (grafo pequeno)
    for (let pass = 0; pass < placed.length + 2; pass++) {
      tracks.forEach(track => scheduleSequential(track, throughputPerTrack));
      if (dedEpic) scheduleSequential([dedEpic], dedThroughput);
    }

    const allScheduled = dedEpic ? placed.concat([dedEpic]) : placed;
    allScheduled.forEach(e => {
      e.overHorizon = e.scheduledStart >= horizonEnd;
      if (e.jiraDue && e.scheduledEnd > startOfDay(e.jiraDue)) e.late = true;
    });

    let maxEnd = horizonEnd;
    allScheduled.forEach(e => { if (e.scheduledEnd > maxEnd) maxEnd = e.scheduledEnd; });
    const totalWeeks = Math.max(heatmapWeeks, Math.ceil((maxEnd - today) / (MS_DAY * 7)) + 1);
    const totalCapacity = squad + (dedEpic ? dedThroughput : 0);

    return { today, squad, totalCapacity, throughputPerTrack, dedThroughput, tracks, dedEpic,
             byKey, epics: list, placed, allScheduled, horizonEnd, totalWeeks };
  }

  return { MS_DAY, startOfDay, addDays, cleanName, keyNum, BLK_HEX, DEV_DUE_FIELD,
           readPublishedSchedule, publishSchedule, syncSchedule,
           ensureAssignments, computeSchedule };
})();
