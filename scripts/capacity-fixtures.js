// ============================================================================
// Fixtures pros golden tests da engine de capacity (scripts/capacity-golden.js).
//
// Cada cenário é uma entrada FIXA pra `computeSchedule()` do planner. O harness
// roda a engine REAL extraída do .html contra estes inputs e compara a saída
// com o golden commitado. São inputs sintéticos escolhidos pra exercitar cada
// ramo da engine (round-robin de tracks, rollup/horas/placeholder, track
// dedicada, dependências, committed-lock, late e overHorizon).
//
// `today` é fixo pra determinismo — o harness congela o Date nesse instante.
// Datas de épico (jiraStart/jiraDue) são strings 'YYYY-MM-DD' (o harness
// converte pra Date local meia-noite, igual ao app).
// ============================================================================

const TODAY = '2026-06-01T12:00:00';

// VENA — esforço em Story Points, com rollup de filhos, conversão horas→SP
// (hoursPerSp) e track dedicada (99Food = VENA-145).
function venaScenarios() {
  const base = {
    name: 'Atual', schemaVersion: 3,
    devs: 2, velocityPerDev: 15, parallelTracks: 2, horizonWeeks: 12, hoursPerSp: 1.5,
    trackAssignments: {}, backlog: [], manualSp: {}, dependencies: {}, childDone: {}, whatIfMode: false,
  };
  const e = (key, priority, o = {}) => ({
    key, priority, isCommitted: false, done: false,
    jiraSp: null, jiraEstimateH: null, jiraStart: null, jiraDue: null, assignee: 'Dev', ...o,
  });
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
  ];
}

// FST — esforço em HORAS (sem SP, sem rollup, sem hoursPerSp), sem track
// dedicada (sentinela), prioridades P0-P3 e DEFAULT_TRACK pra FST-133.
function fstScenarios() {
  const base = {
    name: 'Atual', schemaVersion: 2,
    devs: 2, velocityPerDev: 30, parallelTracks: 2, horizonWeeks: 12,
    trackAssignments: {}, backlog: [], manualSp: {}, dependencies: {}, childDone: {}, whatIfMode: false,
  };
  const d = (key, priority, o = {}) => ({
    key, priority, isCommitted: false, done: false,
    jiraEstimateH: null, jiraStart: null, jiraDue: null, assignee: 'Dev', ...o,
  });
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
  ];
}

module.exports = {
  PLANNERS: [
    { project: 'vena', file: 'public/vena/capacity.html', scenarios: venaScenarios },
    { project: 'fst',  file: 'public/fst/capacity.html',  scenarios: fstScenarios },
  ],
};
