#!/usr/bin/env node
// ============================================================================
// Golden tests da engine de capacity (consolidada).
//
// POR QUÊ: `computeSchedule()` (esforço → cronograma) era DUPLICADO em 4 lugares
// (vena/fst × planner/report). Foi consolidado numa engine única em
// shared/capacity.js. Estes goldens são a rede de segurança que provou "zero
// drift" na consolidação e protege contra regressões futuras.
//
// COMO: carrega a engine REAL de shared/capacity.js, extrai de cada caller a sua
// resolução de esforço REAL (resolveSp/effortH) + constantes, congela o relógio
// e roda contra fixtures fixas. Compara com os goldens commitados.
//
// USO:
//   node scripts/capacity-golden.js            # compara. Sai 1 se houver drift.
//   node scripts/capacity-golden.js --update    # (re)grava os goldens.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { ENGINES } = require('./capacity-fixtures');

const ROOT = path.resolve(__dirname, '..');
const GOLDEN_DIR = path.join(__dirname, '__goldens__');
const UPDATE = process.argv.includes('--update');

// ── Carrega a engine consolidada de shared/capacity.js ───────────────────────
function loadSharedEngine() {
  const code = fs.readFileSync(path.join(ROOT, 'public/shared/capacity.js'), 'utf8');
  const window = {};
  const localStorage = { getItem() { return null; }, setItem() {} };
  void localStorage; // usado só por funções de IO (não pela engine)
  // eslint-disable-next-line no-eval
  eval(code); // popula window.KruzerCapacity (closure no `window` local)
  return window.KruzerCapacity;
}

// ── Extração do source real de uma declaração (sem reescrever) ───────────────
function skip(src, i) {
  const two = src.substr(i, 2);
  if (two === '//') { let j = i + 2; while (j < src.length && src[j] !== '\n') j++; return j; }
  if (two === '/*') { let j = i + 2; while (j < src.length && src.substr(j, 2) !== '*/') j++; return j + 2; }
  const c = src[i];
  if (c === '"' || c === "'" || c === '`') {
    let j = i + 1;
    while (j < src.length) { if (src[j] === '\\') { j += 2; continue; } if (src[j] === c) { j++; break; } j++; }
    return j;
  }
  return i + 1;
}
function matchBrace(src, i) {
  let depth = 0;
  while (i < src.length) {
    const two = src.substr(i, 2);
    if (two === '//' || two === '/*') { i = skip(src, i); continue; }
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') { i = skip(src, i); continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i; }
    i++;
  }
  throw new Error('chave não balanceada');
}
function stmtEnd(src, i) {
  let depth = 0;
  while (i < src.length) {
    const two = src.substr(i, 2);
    if (two === '//' || two === '/*') { i = skip(src, i); continue; }
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') { i = skip(src, i); continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ';' && depth === 0) return i;
    i++;
  }
  throw new Error('sem ponto-e-vírgula');
}
function declSource(src, name) {
  let m = new RegExp('function\\s+' + name + '\\s*\\(').exec(src);
  if (m) { const b = src.indexOf('{', m.index); return src.slice(m.index, matchBrace(src, b) + 1); }
  m = new RegExp('(?:const|let|var)\\s+' + name + '\\b').exec(src);
  if (m) { return src.slice(m.index, stmtEnd(src, m.index) + 1); }
  return null;
}

// ── Monta o contexto de um caller: STATE/EPICS + resolveEffort + cfg ─────────
function buildContext(spec, fx) {
  const src = fs.readFileSync(path.join(ROOT, spec.file), 'utf8');
  const pieces = [];
  for (const c of spec.consts) { const s = declSource(src, c); if (s) pieces.push(s); }
  for (const d of spec.effortDeps) { const s = declSource(src, d); if (s) pieces.push(s); }
  const effortSrc = declSource(src, spec.effortFn);
  if (!effortSrc) throw new Error(`não achei ${spec.effortFn} em ${spec.file}`);
  pieces.push(effortSrc);

  const epics = (spec.adapter ? fx.EPICS.map(spec.adapter) : fx.EPICS);
  const pre = `
    let STATE = ${JSON.stringify(fx.STATE)};
    let EPICS = ${JSON.stringify(epics)};
    let CHILDREN_BY_EPIC = ${JSON.stringify(fx.CHILDREN || {})};
    EPICS.forEach(e => {
      e.jiraStart = e.jiraStart ? new Date(e.jiraStart + 'T00:00:00') : null;
      e.jiraDue   = e.jiraDue   ? new Date(e.jiraDue   + 'T00:00:00') : null;
    });
  `;
  const post = `
    return {
      STATE, EPICS,
      effort: ${spec.effortFn},
      prioRank:     (typeof PRIO_RANK    !== 'undefined') ? PRIO_RANK     : {},
      dedicatedKey: (typeof DEDICATED    !== 'undefined') ? DEDICATED.epic : null,
      defaultTrack: (typeof DEFAULT_TRACK!== 'undefined') ? DEFAULT_TRACK : {},
      heatmapWeeks: (typeof HEATMAP_WEEKS!== 'undefined') ? HEATMAP_WEEKS : 26,
    };
  `;
  // eslint-disable-next-line no-new-func
  return new Function(pre + '\n' + pieces.join('\n') + '\n' + post)();
}

// ── Normalização da saída pro golden ─────────────────────────────────────────
function isoDate(d) {
  if (!d) return null;
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function normalize(s, kind) {
  const epics = Object.values(s.byKey).map(e => {
    const o = {
      key: e.key, effectiveSp: e.effectiveSp, spSource: e.spSource, trackIdx: e.trackIdx,
      inBacklog: e.inBacklog, start: isoDate(e.scheduledStart), end: isoDate(e.scheduledEnd),
      durDays: (e.scheduledStart && e.scheduledEnd) ? Math.round((e.scheduledEnd - e.scheduledStart) / 86400000) : null,
      late: !!e.late,
    };
    if (kind === 'planner') o.overHorizon = !!e.overHorizon;
    return o;
  }).sort((a, b) => a.key.localeCompare(b.key));
  // Ordem das chaves fixada (estabilidade do golden / diffs limpos).
  const out = { squad: s.squad, throughputPerTrack: Number(s.throughputPerTrack.toFixed(4)) };
  if (kind === 'planner') {
    out.totalCapacity = s.totalCapacity;
    out.dedThroughput = s.dedThroughput;
    out.totalWeeks = s.totalWeeks;
    out.dedEpic = s.dedEpic ? s.dedEpic.key : null;
  }
  out.tracks = s.tracks.map(t => t.map(e => e.key));
  out.epics = epics;
  return out;
}

// ── Execução com relógio congelado ───────────────────────────────────────────
function runFixture(ENGINE, spec, fx) {
  const realDate = global.Date;
  global.Date = class extends realDate {
    constructor(...a) { a.length ? super(...a) : super(fx.today); }
    static now() { return new realDate(fx.today).getTime(); }
  };
  try {
    const ctx = buildContext(spec, fx);
    const cfg = {
      resolveEffort: (epic, st) => { const r = ctx.effort(epic, st); return ('sp' in r) ? r : { sp: r.h, source: r.src }; },
      prioRank: ctx.prioRank, dedicatedKey: ctx.dedicatedKey, defaultTrack: ctx.defaultTrack, heatmapWeeks: ctx.heatmapWeeks,
    };
    ENGINE.ensureAssignments(ctx.EPICS, ctx.STATE, cfg);
    return normalize(ENGINE.computeSchedule(ctx.EPICS, ctx.STATE, cfg), spec.kind);
  } finally {
    global.Date = realDate;
  }
}

// ── Diff ─────────────────────────────────────────────────────────────────────
function firstDiff(a, b, p = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null)
    return `${p || '(raiz)'}: golden=${JSON.stringify(a)} atual=${JSON.stringify(b)}`;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const d = firstDiff(a[k], b[k], p ? `${p}.${k}` : k);
    if (d) return d;
  }
  return null; // mesmas chaves/valores, só ordem difere → iguais (objetos JS)
}

// ── Run ──────────────────────────────────────────────────────────────────────
if (!fs.existsSync(GOLDEN_DIR)) fs.mkdirSync(GOLDEN_DIR, { recursive: true });
const ENGINE = loadSharedEngine();
let pass = 0, fail = 0;
console.log(UPDATE ? '⟳ Atualizando goldens (engine consolidada)…\n' : '🧪 Golden tests — engine de capacity consolidada (shared/capacity.js)\n');

for (const spec of ENGINES) {
  console.log(`▸ ${spec.project} [${spec.kind}] (${spec.file})`);
  for (const fx of spec.scenarios()) {
    const goldenPath = path.join(GOLDEN_DIR, `${spec.project}__${fx.name}.json`);
    let out;
    try { out = runFixture(ENGINE, spec, fx); }
    catch (e) { fail++; console.log(`  ❌ ${fx.name} — erro: ${e.message}`); continue; }
    if (UPDATE) { fs.writeFileSync(goldenPath, JSON.stringify(out, null, 2) + '\n'); console.log(`  ✍️  ${fx.name}`); pass++; continue; }
    if (!fs.existsSync(goldenPath)) { fail++; console.log(`  ❌ ${fx.name} — golden ausente (rode --update)`); continue; }
    const diff = firstDiff(JSON.parse(fs.readFileSync(goldenPath, 'utf8')), out);
    if (diff) { fail++; console.log(`  ❌ ${fx.name} — DRIFT: ${diff}`); }
    else { pass++; console.log(`  ✅ ${fx.name}`); }
  }
  console.log('');
}
console.log(`RESULTADO: ${pass} ok, ${fail} ${UPDATE ? 'gravados com erro' : 'com drift/erro'}`);
process.exit(fail ? 1 : 0);
