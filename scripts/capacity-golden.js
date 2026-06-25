#!/usr/bin/env node
// ============================================================================
// Golden tests da engine de capacity (planner).
//
// POR QUÊ: `computeSchedule()` (esforço → cronograma) vive DUPLICADO entre
// planner e report, e entre VENA e FST. Antes de consolidar numa engine única
// (shared/capacity.js), precisamos de uma rede de segurança que prove "zero
// drift": a saída pra inputs fixos não pode mudar. Este harness captura o
// comportamento ATUAL da engine do planner.
//
// COMO: extrai a função real (e suas dependências) direto do .html — sem copiar
// nem reescrever a lógica —, congela o relógio num instante fixo, roda contra
// fixtures e compara com goldens commitados.
//
// USO:
//   node scripts/capacity-golden.js            # compara (CI / pré-refactor). Sai 1 se divergir.
//   node scripts/capacity-golden.js --update    # (re)grava os goldens. Use SÓ ao mudar a engine de propósito.
//
// QUANDO consolidar a engine: rode sem --update. Se passar, o refactor preservou
// o comportamento. Se falhar, o diff mostra exatamente onde o cronograma mudou.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { PLANNERS } = require('./capacity-fixtures');

const ROOT = path.resolve(__dirname, '..');
const GOLDEN_DIR = path.join(__dirname, '__goldens__');
const UPDATE = process.argv.includes('--update');

// Declarações da engine que o harness extrai de cada arquivo. União pros dois
// planners; ausentes são puladas (ex.: VENA não tem DEFAULT_TRACK; FST não tem
// childrenSpSum nem DEFAULT_HOURS_PER_SP). Ordem de extração não importa: tudo
// é declarado antes de computeSchedule() rodar.
const DECLS = [
  'PLACEHOLDER_SP', 'MS_DAY', 'HEATMAP_WEEKS', 'DEFAULT_HOURS_PER_SP',
  'DEDICATED', 'PRIO_RANK', 'DEFAULT_TRACK',
  'startOfDay', 'addDays', 'keyNum',
  'childrenSpSum', 'resolveSp', 'ensureAssignments', 'computeSchedule',
];

// ── Extração: pega o source de uma declaração sem reescrevê-la ───────────────
// Scanner que pula strings e comentários (as funções-alvo não têm chaves dentro
// de string/regex/comentário — verificado — então a contagem é segura).
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
function matchBrace(src, i) { // src[i] === '{'
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
function stmtEnd(src, i) { // até o ';' no depth 0
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
  if (m) { const start = m.index; const b = src.indexOf('{', start); return src.slice(start, matchBrace(src, b) + 1); }
  m = new RegExp('(?:const|let|var)\\s+' + name + '\\b').exec(src);
  if (m) { const start = m.index; return src.slice(start, stmtEnd(src, start) + 1); }
  return null;
}
function extractEngine(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const found = [], missing = [];
  for (const name of DECLS) {
    const s = declSource(src, name);
    if (s) found.push(s); else missing.push(name);
  }
  return { code: found.join('\n\n'), missing };
}

// ── Execução da engine real contra um fixture, com relógio congelado ─────────
function runEngine(engineCode, fx) {
  const pre = `
    const __ISO = ${JSON.stringify(fx.today)};
    const __RealDate = globalThis.Date;
    const Date = class extends __RealDate {
      constructor(...a) { a.length ? super(...a) : super(__ISO); }
      static now() { return new __RealDate(__ISO).getTime(); }
    };
    let STATE = ${JSON.stringify(fx.STATE)};
    let EPICS = ${JSON.stringify(fx.EPICS)};
    let CHILDREN_BY_EPIC = ${JSON.stringify(fx.CHILDREN || {})};
    EPICS.forEach(e => {
      e.jiraStart = e.jiraStart ? new Date(e.jiraStart + 'T00:00:00') : null;
      e.jiraDue   = e.jiraDue   ? new Date(e.jiraDue   + 'T00:00:00') : null;
    });
  `;
  const post = '\nensureAssignments();\nreturn computeSchedule();\n';
  // eslint-disable-next-line no-new-func
  return new Function(pre + '\n' + engineCode + post)();
}

// ── Normalização: projeção estável e legível do schedule pro golden ──────────
function isoDate(d) {
  if (!d) return null;
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function normalize(s) {
  return {
    squad: s.squad,
    throughputPerTrack: Number(s.throughputPerTrack.toFixed(4)),
    totalCapacity: s.totalCapacity,
    dedThroughput: s.dedThroughput,
    totalWeeks: s.totalWeeks,
    dedEpic: s.dedEpic ? s.dedEpic.key : null,
    tracks: s.tracks.map(t => t.map(e => e.key)),
    epics: Object.values(s.byKey).map(e => ({
      key: e.key,
      effectiveSp: e.effectiveSp,
      spSource: e.spSource,
      trackIdx: e.trackIdx,
      inBacklog: e.inBacklog,
      start: isoDate(e.scheduledStart),
      end: isoDate(e.scheduledEnd),
      durDays: (e.scheduledStart && e.scheduledEnd) ? Math.round((e.scheduledEnd - e.scheduledStart) / 86400000) : null,
      late: !!e.late,
      overHorizon: !!e.overHorizon,
    })).sort((a, b) => a.key.localeCompare(b.key)),
  };
}

// ── Comparação ───────────────────────────────────────────────────────────────
function firstDiff(a, b, p = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null)
    return `${p || '(raiz)'}: golden=${JSON.stringify(a)} atual=${JSON.stringify(b)}`;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const d = firstDiff(a[k], b[k], p ? `${p}.${k}` : k);
    if (d) return d;
  }
  return `${p}: estrutura diferente`;
}

// ── Run ──────────────────────────────────────────────────────────────────────
if (!fs.existsSync(GOLDEN_DIR)) fs.mkdirSync(GOLDEN_DIR, { recursive: true });

let pass = 0, fail = 0;
console.log(UPDATE ? '⟳ Atualizando goldens da engine de capacity…\n' : '🧪 Golden tests da engine de capacity\n');

for (const planner of PLANNERS) {
  const { code, missing } = extractEngine(planner.file);
  console.log(`▸ ${planner.project.toUpperCase()} (${planner.file})  [extraídas ${DECLS.length - missing.length}/${DECLS.length}; ausentes: ${missing.join(', ') || 'nenhuma'}]`);
  for (const fx of planner.scenarios()) {
    const goldenPath = path.join(GOLDEN_DIR, `${planner.project}__${fx.name}.json`);
    let out;
    try {
      out = normalize(runEngine(code, fx));
    } catch (e) {
      fail++; console.log(`  ❌ ${fx.name} — erro ao rodar a engine: ${e.message}`); continue;
    }
    if (UPDATE) {
      fs.writeFileSync(goldenPath, JSON.stringify(out, null, 2) + '\n');
      console.log(`  ✍️  ${fx.name} → golden gravado`);
      pass++; continue;
    }
    if (!fs.existsSync(goldenPath)) {
      fail++; console.log(`  ❌ ${fx.name} — golden ausente (rode com --update)`); continue;
    }
    const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
    const diff = firstDiff(golden, out);
    if (diff) { fail++; console.log(`  ❌ ${fx.name} — DRIFT: ${diff}`); }
    else { pass++; console.log(`  ✅ ${fx.name}`); }
  }
  console.log('');
}

console.log(`RESULTADO: ${pass} ok, ${fail} ${UPDATE ? 'gravados com erro' : 'com drift/erro'}`);
process.exit(fail ? 1 : 0);
