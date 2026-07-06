// ============================================================================
// Fixtures pros golden tests da engine de capacity (scripts/capacity-golden.js).
//
// Pós-consolidação (Fase C), a engine de scheduling é ÚNICA (shared/capacity.js).
// O harness roda essa engine REAL contra estes inputs fixos, passando por cada
// caller a sua resolução de esforço (resolveEffort) e config (prioRank,
// dedicatedKey, defaultTrack). Compara com os goldens commitados.
//
// `today` é fixo pra determinismo — o harness congela o Date nesse instante.
// Datas de épico são 'YYYY-MM-DD' (o harness converte pra Date local meia-noite).
//
// Cada engine declara como extrair sua resolveEffort do arquivo real e como
// adaptar os épicos da fixture pro shape que a engine espera
// ({ key, priority, isCommitted, done, jiraStart, jiraDue }).
// ============================================================================

const TODAY = '2026-06-01T12:00:00';

// ── PLANNERS ────────────────────────────────────────────────────────────────
// Épicos já no shape da engine. resolveEffort = `resolveSp` extraída do arquivo
// (VENA: rollup+horas+placeholder; FST: horas+placeholder).
function venaPlannerScenarios() {
  const base = { devs: 2, velocityPerDev: 15, parallelTracks: 2, horizonWeeks: 12, hoursPerSp: 1.5,
    trackAssignments: {}, backlog: [], manualSp: {}, dependencies: {}, whatIfMode: false };
  const e = (key, priority, o = {}) => ({ key, priority, isCommitted: false, done: false,
    jiraSp: null, jiraEstimateH: null, jiraStart: null, jiraDue: null, assignee: 'Dev', ...o });
  return [
    { name: 'basic', today: TODAY, STATE: { ...base },
      EPICS: [ e('VENA-1','Highest',{jiraSp:30}), e('VENA-2','High',{jiraSp:15}), e('VENA-3','Medium',{jiraSp:45}), e('VENA-4','Low',{jiraSp:10}) ] },
    { name: 'rollup-hours-placeholder', today: TODAY, STATE: { ...base },
      EPICS: [ e('VENA-10','High'), e('VENA-11','Medium',{jiraEstimateH:30}), e('VENA-12','Low') ],
      CHILDREN: { 'VENA-10': [ {key:'V10a',sp:8}, {key:'V10b',sp:12} ] } },
    { name: 'dedicated-99food', today: TODAY, STATE: { ...base },
      EPICS: [ e('VENA-1','High',{jiraSp:30}), e('VENA-145','Medium',{jiraSp:45}) ] },
    { name: 'deps-committed', today: TODAY, STATE: { ...base, dependencies: { 'VENA-21': ['VENA-20'] } },
      EPICS: [ e('VENA-20','High',{jiraSp:15, isCommitted:true, jiraStart:'2026-06-15'}), e('VENA-21','High',{jiraSp:15}) ] },
    { name: 'late-horizon', today: TODAY, STATE: { ...base, horizonWeeks: 1 },
      EPICS: [ e('VENA-30','High',{jiraSp:30, jiraDue:'2026-06-05'}), e('VENA-31','High',{jiraSp:15}), e('VENA-32','High',{jiraSp:15}) ] },
    // Esteira: âncora start+due no futuro; flutuantes preenchem o gap antes e fluem depois.
    // Esperado: -50 fixo [06-15,07-01]; -51 backfill [06-01,~]; -52 pulado pra depois de 07-01.
    { name: 'anchored-flow', today: TODAY, STATE: { ...base, parallelTracks: 1 },
      EPICS: [ e('VENA-50','High',{jiraSp:15, isCommitted:true, jiraStart:'2026-06-15', jiraDue:'2026-07-01'}),
               e('VENA-51','High',{jiraSp:15}), e('VENA-52','High',{jiraSp:60}) ] },
  ];
}
function fstPlannerScenarios() {
  const base = { devs: 2, velocityPerDev: 30, parallelTracks: 2, horizonWeeks: 12,
    trackAssignments: {}, backlog: [], manualSp: {}, dependencies: {}, whatIfMode: false };
  const d = (key, priority, o = {}) => ({ key, priority, isCommitted: false, done: false,
    jiraEstimateH: null, jiraStart: null, jiraDue: null, assignee: 'Dev', ...o });
  return [
    { name: 'basic', today: TODAY, STATE: { ...base },
      EPICS: [ d('FST-1','P0',{jiraEstimateH:60}), d('FST-2','P1',{jiraEstimateH:30}), d('FST-3','P2',{jiraEstimateH:90}), d('FST-4','P3',{jiraEstimateH:20}) ] },
    { name: 'hours-placeholder', today: TODAY, STATE: { ...base },
      EPICS: [ d('FST-10','P1',{jiraEstimateH:45}), d('FST-11','P2') ] },
    { name: 'default-track', today: TODAY, STATE: { ...base },
      EPICS: [ d('FST-1','P0',{jiraEstimateH:60}), d('FST-133','P2',{jiraEstimateH:30}), d('FST-2','P1',{jiraEstimateH:30}) ] },
    { name: 'deps-committed', today: TODAY, STATE: { ...base, dependencies: { 'FST-21': ['FST-20'] } },
      EPICS: [ d('FST-20','P1',{jiraEstimateH:30, isCommitted:true, jiraStart:'2026-06-15'}), d('FST-21','P1',{jiraEstimateH:30}) ] },
    { name: 'late-horizon', today: TODAY, STATE: { ...base, horizonWeeks: 1 },
      EPICS: [ d('FST-30','P1',{jiraEstimateH:60, jiraDue:'2026-06-05'}), d('FST-31','P1',{jiraEstimateH:30}), d('FST-32','P1',{jiraEstimateH:30}) ] },
    // Esteira: âncora start+due no futuro; flutuantes preenchem o gap antes e fluem depois.
    { name: 'anchored-flow', today: TODAY, STATE: { ...base, parallelTracks: 1 },
      EPICS: [ d('FST-50','P1',{jiraEstimateH:30, isCommitted:true, jiraStart:'2026-06-15', jiraDue:'2026-07-01'}),
               d('FST-51','P1',{jiraEstimateH:30}), d('FST-52','P1',{jiraEstimateH:120}) ] },
  ];
}

// ── REPORTS ───────────────────────────────────────────────────────────────────
// Épicos no shape RAW do report (estH, committed, priorityTier, startDate,
// dueDate). O harness os adapta pro shape da engine. resolveEffort = `effortH`
// extraída do arquivo (horas: manual → estH → placeholder). Sem rollup, sem
// track dedicada. velocityPerDev default do report = 30.
function reportScenarios(prefix) {
  const base = { devs: 2, velocityPerDev: 30, parallelTracks: 2, horizonWeeks: 12,
    trackAssignments: {}, backlog: [], manualSp: {}, dependencies: {}, whatIfMode: false };
  const r = (key, priorityTier, o = {}) => ({ key, priorityTier, committed: false, done: false,
    estH: null, startDate: null, dueDate: null, name: key, url: '#', bucket: 'backlog', ...o });
  return [
    { name: 'basic', today: TODAY, STATE: { ...base },
      EPICS: [ r(`${prefix}-1`,'P0',{estH:60}), r(`${prefix}-2`,'P1',{estH:30}), r(`${prefix}-3`,'P2',{estH:90}), r(`${prefix}-4`,'P3',{estH:20}) ] },
    { name: 'hours-placeholder', today: TODAY, STATE: { ...base },
      EPICS: [ r(`${prefix}-10`,'P1',{estH:45}), r(`${prefix}-11`,'P2') ] },
    { name: 'committed-deps', today: TODAY, STATE: { ...base, dependencies: { [`${prefix}-21`]: [`${prefix}-20`] } },
      EPICS: [ r(`${prefix}-20`,'P1',{estH:30, committed:true, startDate:'2026-06-15'}), r(`${prefix}-21`,'P1',{estH:30}) ] },
    { name: 'late', today: TODAY, STATE: { ...base },
      EPICS: [ r(`${prefix}-30`,'P1',{estH:300, dueDate:'2026-06-05'}), r(`${prefix}-31`,'P1',{estH:30}) ] },
    // Esteira: âncora start+due no futuro; flutuantes preenchem o gap antes e fluem depois.
    { name: 'anchored-flow', today: TODAY, STATE: { ...base, parallelTracks: 1 },
      EPICS: [ r(`${prefix}-50`,'P1',{estH:30, committed:true, startDate:'2026-06-15', dueDate:'2026-07-01'}),
               r(`${prefix}-51`,'P1',{estH:30}), r(`${prefix}-52`,'P1',{estH:120}) ] },
  ];
}

// adaptador RAW(report) → épico da engine
function reportAdapter(e) {
  return {
    ...e,
    isCommitted: !!e.committed,
    priority: e.priorityTier,
    jiraStart: e.startDate || null,   // strings; harness converte
    jiraDue: e.dueDate || null,
  };
}

module.exports = {
  ENGINES: [
    { project: 'vena', kind: 'planner', file: 'public/vena/capacity.html',
      effortFn: 'resolveSp', effortDeps: ['childrenSpSum'],
      consts: ['PLACEHOLDER_SP', 'DEFAULT_HOURS_PER_SP', 'HEATMAP_WEEKS', 'DEDICATED', 'PRIO_RANK', 'DEFAULT_TRACK'],
      scenarios: venaPlannerScenarios },
    // FST/PGM planner consolidado em shared/planner.js (item 2). resolveSp + consts
    // vivem lá; DEDICATED/DEFAULT_TRACK viraram CFG → passados via spec.
    { project: 'fst', kind: 'planner', file: 'public/shared/planner.js',
      effortFn: 'resolveSp', effortDeps: [],
      consts: ['PLACEHOLDER_SP', 'HEATMAP_WEEKS', 'PRIO_RANK'],
      defaultTrack: { 'FST-133': 1 },
      scenarios: fstPlannerScenarios },
    // Reports: a engine foi consolidada em shared/report.js (fatia 2). effortH +
    // consts vivem lá agora. DEFAULT_TRACK virou CFG (não se extrai); o {} default
    // do harness casa com os goldens (os fixtures de report não têm FST-133).
    { project: 'vena-report', kind: 'report', file: 'public/shared/report.js',
      effortFn: 'effortH', effortDeps: [],
      consts: ['PLACEHOLDER_H', 'PRIO_RANK'],
      adapter: reportAdapter, scenarios: () => reportScenarios('VENA') },
    { project: 'fst-report', kind: 'report', file: 'public/shared/report.js',
      effortFn: 'effortH', effortDeps: [],
      consts: ['PLACEHOLDER_H', 'PRIO_RANK'],
      adapter: reportAdapter, scenarios: () => reportScenarios('FST') },
  ],
};
