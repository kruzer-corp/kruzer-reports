// Capacity Planner compartilhado (FST · PGM — modelo HORAS). VENA tem o seu
// próprio (modelo SP). Extraído da duplicação (PGM era clone do FST) —
// consolidação item 2. Uso: KruzerPlanner.mount(CFG). Engine de scheduling
// vem de shared/capacity.js. Rede de segurança: scripts/render-snapshot.js.
window.KruzerPlanner = { mount: function (CFG) {
// ============================================================================
// Inline KruzerAPI (mesmo helper de /api.js, embarcado).
// ============================================================================
window.KruzerAPI = window.KruzerAPI || (function(){
  async function jqlPage({ jql, fields, maxResults = 100, nextPageToken, expand }){
    const res = await fetch('/api/jira/jql', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ jql, fields, maxResults, nextPageToken, expand }),
    });
    if (!res.ok){ const text = await res.text(); throw new Error(`JIRA proxy ${res.status}: ${text}`); }
    return res.json();
  }
  async function fetchAll({ jql, fields, expand, onProgress, maxPages = 60 }){
    let all=[], token=null, page=0;
    while (page < maxPages){
      const data = await jqlPage({ jql, fields, expand, nextPageToken: token, maxResults: 100 });
      const issues = data.issues || [];
      all = all.concat(issues); page++;
      if (onProgress) onProgress(all.length, page);
      if (data.isLast === true || !data.nextPageToken) break;
      token = data.nextPageToken;
    }
    return all;
  }
  return { jqlPage, fetchAll };
})();

// ============================================================================
// Constantes & helpers
// ============================================================================
const PROJECT = CFG.project, JIRA_BASE = 'https://kruzer.atlassian.net';
// FastShop estima em HORAS (não tem story points). A unidade de esforço aqui é hora.
const EPIC_FIELDS = ['summary','status','priority','labels','duedate','customfield_10015','timeoriginalestimate','aggregatetimeoriginalestimate','assignee'];
// customfield_10015 = Start date · timeoriginalestimate = estimativa em segundos

const TSHIRT = { XS:8, S:20, M:40, L:80, XL:160 };   // em HORAS
const PLACEHOLDER_SP = 20;  // horas nominais que uma demanda sem estimativa ocupa
const MS_DAY = 86400000;
const PX_PER_SP = 1.5;      // px por hora (escala visual do esforço)
const HEATMAP_WEEKS = 26;

const LS = {
  current: CFG.lsCurrent,
  saved:   CFG.lsSaved,
};
const SCHEMA_VERSION = 3; // bump descarta overrides antigos (aplica DEFAULT_TRACK novo)
// FST não tem track dedicada — sentinela que nunca casa com nenhum épico.
const DEDICATED = { epic: CFG.dedicatedEpic, label: '' };
// Posição default de track por épico (índice 0-based). Pick & Pack começa na Track 2.
const DEFAULT_TRACK = CFG.defaultTrack || {};

// Status derivado das labels da demanda (mesma lógica do dashboard FST kanban).
// blk = classe de cor do bloco · cls = classe do badge.
const BUCKETS = [
  { id:'Hyper Care',     match:'hyper-care',             blk:'s-dev',     cls:'status-dev' },
  { id:'UAT',            match:'uat',                    blk:'s-uat',     cls:'status-uat' },
  { id:'Em Execução',    match:'em-execucao',            blk:'s-refin',   cls:'status-refin' },
  { id:'Ag. Aprovação',  match:'aguardando-aprovacao',   blk:'s-warn',    cls:'status-aprov' },
  { id:'Ag. Estimativa', match:'aguardando-estimativa',  blk:'s-neutral', cls:'status-estim' },
  { id:'Backlog',        match:'backlog',                blk:'s-backlog', cls:'status-backlog' },
];
const STATUS_MAP = Object.fromEntries(BUCKETS.map(b => [b.id, { cls:b.cls, blk:b.blk }]));
const PRIO_RANK = { 'P0':0, 'P1':1, 'P2':2, 'P3':3 };

function bucketFor(labels, jiraStatus, catKey){
  const ls = labels || [];
  for (const b of BUCKETS){ if (ls.includes(b.match)) return b.id; }
  // Sem label: deriva do STATUS nativo (preparado pra labels caírem). UAT vem
  // ANTES da categoria — status real de UAT é "in progress", mas é UAT.
  const s = (jiraStatus || '').toLowerCase();
  if (s.includes('uat') || s.includes('homolog')) return 'UAT';
  if (s === 'in progress' || s === 'in review') return 'Em Execução';
  if (s === 'done' || s === 'concluído' || s === 'closed') return 'Hyper Care';
  if (catKey === 'done') return 'Hyper Care';
  if (catKey === 'indeterminate') return 'Em Execução';
  return 'Backlog';
}
function priorityTier(name){
  const n = (name || '').toLowerCase();
  if (n.includes('highest')) return 'P0';
  if (n.includes('high'))    return 'P1';
  if (n.includes('medium'))  return 'P2';
  return 'P3';
}

function parseDate(s){ if(!s) return null; const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s+'T00:00:00' : s); return isNaN(d) ? null : d; } // date-only → meia-noite LOCAL (evita shift de fuso)
function startOfDay(d){ const x=new Date(d); x.setHours(0,0,0,0); return x; }
function addDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
function fmtBR(d){ return d ? d.toLocaleDateString('pt-BR',{day:'2-digit',month:'short',year:'2-digit'}) : '—'; }
function fmtWeekday(d){ return d ? d.toLocaleDateString('pt-BR',{weekday:'short'}).replace('.','') : ''; }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function keyNum(k){ const n = parseInt(String(k).split('-')[1]); return isNaN(n) ? 0 : n; }
function clampNum(v, lo, hi, def){ v = Number(v); if (isNaN(v)) return def; return Math.min(hi, Math.max(lo, v)); }

let toastTimer = null;
function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> t.classList.remove('show'), 2200);
}

// ============================================================================
// Estado
// ============================================================================
let EPICS = [];                 // dados do JIRA normalizados (imutáveis no client)
let CHILDREN_BY_EPIC = {};      // epicKey -> [{key, summary, done, sp}]
let STATE = null;               // ScenarioState corrente (overrides do operador)
let LAST_SCHEDULE = null;       // resultado do schedule() mais recente p/ render auxiliar
let saveTimer = null;

function defaultState(){
  return {
    name: 'Atual (não salvo)',
    schemaVersion: SCHEMA_VERSION,
    devs: 2, velocityPerDev: 30, parallelTracks: 2, horizonWeeks: 12,
    trackAssignments: {},   // demandKey -> { trackIdx, orderInTrack }
    backlog: [],            // demandKeys fora do plano
    manualSp: {},           // demandKey -> horas (override manual)
    dependencies: {},       // epicKey -> [epicKeys]
    trackParallelism: {},   // trackIdx -> grau de paralelismo (2+ = sobreposição permitida)
    childDone: {},          // childKey -> bool (override manual de done)
    dateOverride: {},       // demandKey -> { start:'YYYY-MM-DD'|null, due:'YYYY-MM-DD'|null } (replaneja no cenário)
    assigneeOverride: {},   // demandKey -> { accountId, name } | null (null = tira o responsável)
    whatIfMode: false,
    createdAt: new Date().toISOString(),
  };
}

// Estado e cenários salvos passam por KruzerState (D1 + cache local).
// Imports one-shot dos legacy keys preservam continuidade pros usuários atuais.
KruzerState.importLegacyKey(LS.current, CFG.stateScope, 'scenario:current');
KruzerState.importLegacyKey(LS.saved,   CFG.stateScope, 'scenarios');

function loadState(){
  const r = KruzerState.read(CFG.stateScope, 'scenario:current');
  const s = r && r.value;
  if (s && typeof s === 'object'){
    if (s.schemaVersion !== SCHEMA_VERSION) { KruzerState.delete(CFG.stateScope, 'scenario:current'); return defaultState(); }
    s.whatIfMode = false;
    return Object.assign(defaultState(), s);
  }
  return defaultState();
}
function persist(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(()=>{
    const cur = KruzerState.read(CFG.stateScope, 'scenario:current');
    KruzerState.write(CFG.stateScope, 'scenario:current', STATE, { expectedVersion: cur.version })
      .catch(e => console.warn('state save failed:', e.message));
  }, 300);
}
function loadSavedScenarios(){
  const r = KruzerState.read(CFG.stateScope, 'scenarios');
  return Array.isArray(r && r.value) ? r.value : [];
}
function persistSavedScenarios(list){
  const cur = KruzerState.read(CFG.stateScope, 'scenarios');
  KruzerState.write(CFG.stateScope, 'scenarios', list, { expectedVersion: cur.version })
    .catch(e => console.warn('scenarios save failed:', e.message));
}
KruzerState.sync(CFG.stateScope, 'scenario:current');
KruzerState.sync(CFG.stateScope, 'scenarios');
KruzerCapacity.syncSchedule && KruzerCapacity.syncSchedule(CFG.capScope);

// ============================================================================
// Normalização do JIRA
// ============================================================================
function normalizeEpic(issue){
  const f = issue.fields || {};
  const labels = f.labels || [];
  const jiraStatus = f.status?.name || '';
  const catKey = f.status?.statusCategory?.key || '';
  const status = bucketFor(labels, jiraStatus, catKey);   // bucket FST (labels + categoria)
  const jiraStart = parseDate(f.customfield_10015);
  // Estimativa de horas: prefere a da demanda "em si" (timeoriginalestimate),
  // cai pro agregado (com filhas) se a da demanda estiver vazia.
  const origSec = f.timeoriginalestimate, aggSec = f.aggregatetimeoriginalestimate;
  const estSec = (origSec != null && origSec > 0) ? origSec : ((aggSec != null && aggSec > 0) ? aggSec : null);
  const dmndMatch = (f.summary || '').match(/^(DMND\d+)/);
  return {
    key: issue.key,
    url: `${JIRA_BASE}/browse/${issue.key}`,
    summary: f.summary || '',
    dmnd: dmndMatch ? dmndMatch[1] : null,
    status,
    jiraStatus,
    priority: priorityTier(f.priority?.name),   // P0..P3
    assignee: f.assignee?.displayName || 'Sem responsável',
    assigneeId: f.assignee?.accountId || null,  // p/ reatribuição e write-back no JIRA
    jiraStart,
    jiraDue: parseDate(f.duedate),
    jiraEstimateH: estSec != null ? Math.round(estSec / 3600 * 10) / 10 : null,
    labels,
    isCommitted: !!jiraStart || status === 'Em Execução',
    done: catKey === 'done',   // Done no JIRA → não entra no cálculo da esteira
  };
}

// Encerrado que NÃO deve ser listado: statusCategory=Done, EXCETO Hyper Care.
function isClosedNotHyper(e){
  const isHyper = (e.labels || []).includes('hyper-care') || /hyper.?care/i.test(e.jiraStatus || '');
  return e.done && !isHyper;
}

// esforço efetivo (HORAS) por hierarquia: manual -> horas estimadas no JIRA -> placeholder
function resolveSp(epic){
  const manual = STATE.manualSp[epic.key];
  if (manual != null && manual > 0) return { sp: manual, source: 'manual' };
  if (epic.jiraEstimateH != null && epic.jiraEstimateH > 0) return { sp: epic.jiraEstimateH, source: 'hours' };
  return { sp: PLACEHOLDER_SP, source: 'placeholder' };
}

// ============================================================================
// Explosão hierárquica (filtro de níveis na tabela "Épicos detalhados").
// Default: só épicos (GridJS intocado → esteira e goldens inalterados). Ligada,
// busca a árvore (issuetype != Epic) sob demanda, aninha por `parent` e mostra
// filhos indentados numa tabela custom. A ESTEIRA (board) segue épico-only.
// ============================================================================
const CHILD_HIER_FIELDS = EPIC_FIELDS.concat(['parent','issuetype']);
let CHILDREN_HIER = {};        // parentKey -> [filho normalizado]
let DISCOVERED_TYPES = [];     // tipos presentes (Epic primeiro)
let TYPE_ON = {};              // issueType -> bool
let EXPLODED = false, HIER_FETCHED = false, HIER_BUSY = false;
const EXPANDED = new Set();

function normalizeChild(issue){
  const f = issue.fields || {};
  const catKey = f.status?.statusCategory?.key || '';
  const o = f.timeoriginalestimate, a = f.aggregatetimeoriginalestimate;
  const estSec = (o != null && o > 0) ? o : ((a != null && a > 0) ? a : null);
  return {
    key: issue.key, url: `${JIRA_BASE}/browse/${issue.key}`,
    summary: f.summary || '',
    status: bucketFor(f.labels || [], f.status?.name || '', catKey),
    jiraStatus: f.status?.name || '',
    priority: priorityTier(f.priority?.name),
    jiraStart: parseDate(f.customfield_10015),
    jiraDue: parseDate(f.duedate),
    jiraEstimateH: estSec != null ? Math.round(estSec / 3600 * 10) / 10 : null,
    issueType: f.issuetype?.name || 'Task',
    parentKey: f.parent?.key || f.customfield_10014 || null,
    labels: f.labels || [], done: catKey === 'done',
  };
}
function childrenOf(key){ return CHILDREN_HIER[key] || []; }
function descendantsOf(key, depth, out){
  out = out || []; depth = depth || 1;
  for (const c of childrenOf(key)) { c._depth = depth; out.push(c); descendantsOf(c.key, depth + 1, out); }
  return out;
}
async function fetchHierarchy(){
  if (HIER_FETCHED) return;
  const jql = `project = ${PROJECT} AND issuetype != Epic ORDER BY rank ASC`;
  const issues = await KruzerAPI.fetchAll({ jql, fields: CHILD_HIER_FIELDS });
  const kids = issues.map(normalizeChild).filter(e => !isClosedNotHyper(e));
  CHILDREN_HIER = {};
  kids.forEach(k => { const p = k.parentKey || '__orphan__'; (CHILDREN_HIER[p] = CHILDREN_HIER[p] || []).push(k); });
  const set = new Set(['Epic']); kids.forEach(k => set.add(k.issueType || 'Task'));
  DISCOVERED_TYPES = [...set];
  DISCOVERED_TYPES.forEach(t => { if (!(t in TYPE_ON)) TYPE_ON[t] = true; });
  HIER_FETCHED = true;
}
function injectHierControl(){
  const bar = document.getElementById('toolbar');
  if (!bar || document.getElementById('hierToggle')) return;
  const wrap = document.createElement('div');
  wrap.className = 'hier-ctrl';
  wrap.innerHTML = `<label class="hier-main" title="Expande os épicos nos níveis abaixo (features, stories, sub-tasks) na tabela e na esteira"><input type="checkbox" id="hierToggle"> Expandir visão</label><span class="type-filters" id="typeFilters"></span>`;
  bar.appendChild(wrap);
  document.getElementById('hierToggle').addEventListener('change', onHierToggle);
}
function renderTypeFilters(){
  const c = document.getElementById('typeFilters'); if (!c) return;
  if (!EXPLODED){ c.innerHTML = ''; return; }
  c.innerHTML = '<span class="tf-lbl">níveis:</span>' + DISCOVERED_TYPES.filter(t => t !== 'Epic').map(t =>
    `<label class="type-chip"><input type="checkbox" data-type="${escapeHtml(t)}" ${TYPE_ON[t] !== false ? 'checked' : ''}> ${escapeHtml(t)}</label>`).join('');
  c.querySelectorAll('input[data-type]').forEach(inp => inp.addEventListener('change', () => { TYPE_ON[inp.dataset.type] = inp.checked; refreshChildVis(); }));
}
async function onHierToggle(e){
  const box = e.target;
  if (HIER_BUSY){ box.checked = EXPLODED; return; }   // ignora toggles durante o fetch
  EXPLODED = box.checked;
  if (EXPLODED && !HIER_FETCHED){
    HIER_BUSY = true; box.parentElement.classList.add('loading');
    try { await fetchHierarchy(); }
    catch (err){ toast('Falha na hierarquia: ' + err.message); EXPLODED = false; box.checked = false; }
    finally { HIER_BUSY = false; box.parentElement.classList.remove('loading'); }
  }
  // Liga/desliga a explosão. NÃO auto-expande tudo na esteira (centenas de blocos
  // inline travariam o board) — o toggle habilita os carets; o usuário expande
  // épico a épico (na esteira ou na tabela). Off recolhe tudo.
  EXPANDED.clear();
  renderTypeFilters();
  try { rerenderExpansion(); }
  catch (err){ console.error('[hier] render falhou:', err); toast('Erro ao renderizar hierarquia: ' + err.message); }
}
function refreshChildVis(){
  document.querySelectorAll('#epicTable tr.child-row').forEach(tr => {
    tr.style.display = (EXPANDED.has(tr.dataset.epic) && TYPE_ON[tr.dataset.type] !== false) ? '' : 'none';
  });
}
function wirePlannerCarets(){
  document.querySelectorAll('#epicTable .tree-caret').forEach(el => {
    const toggle = () => {
      const k = el.dataset.key;
      if (EXPANDED.has(k)) EXPANDED.delete(k); else EXPANDED.add(k);
      rerenderExpansion();   // atualiza tabela E esteira juntas
    };
    el.addEventListener('click', toggle);
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); toggle(); } });
  });
}
// Tabela custom aninhada (substitui o GridJS só quando explodido).
function renderTableExploded(sched){
  const rows = [];
  sched.epics.forEach(e => {
    const st = STATUS_MAP[e.status] || STATUS_MAP['Backlog'];
    const nDesc = descendantsOf(e.key).length;
    const caret = nDesc ? `<span class="tree-caret" data-key="${e.key}" role="button" tabindex="0" title="Expandir níveis"><span class="caret-ico">▶</span><span class="desc-count">${nDesc}</span></span>` : '';
    const sp = e.spSource === 'placeholder' ? '?' : e.effectiveSp + 'h';
    const loc = e.inBacklog ? 'Backlog' : (e.trackIdx != null ? 'T' + (e.trackIdx + 1) : '—');
    rows.push(`<tr class="epic-row" data-key="${e.key}">
      <td class="k">${caret}<a href="${e.url}" target="_blank" rel="noopener">${e.key}</a></td>
      <td class="s">${escapeHtml(e.summary)}</td>
      <td><span class="badge ${st.cls}">${escapeHtml(e.status)}</span></td>
      <td><span class="badge prio-${String(e.priority).toLowerCase()}">${e.priority}</span></td>
      <td class="num">${sp}</td><td class="loc">${loc}</td>
      <td class="dt">${e.scheduledStart ? fmtBR(e.scheduledStart) : '—'}</td>
      <td class="dt">${e.scheduledEnd ? fmtBR(e.scheduledEnd) : '—'}</td></tr>`);
    descendantsOf(e.key).forEach(ch => {
      const cst = STATUS_MAP[ch.status] || STATUS_MAP['Backlog'];
      const indent = 8 + (ch._depth || 1) * 18;
      rows.push(`<tr class="child-row" data-epic="${e.key}" data-type="${escapeHtml(ch.issueType)}" style="display:none">
        <td class="k child" style="padding-left:${indent}px"><span class="tree-guide">└</span><a href="${ch.url}" target="_blank" rel="noopener">${ch.key}</a></td>
        <td class="s child">${escapeHtml(ch.summary)}</td>
        <td><span class="badge ${cst.cls}">${escapeHtml(ch.status)}</span></td>
        <td><span class="type-badge">${escapeHtml(ch.issueType)}</span></td>
        <td class="num">${ch.jiraEstimateH != null ? ch.jiraEstimateH + 'h' : '—'}</td><td class="loc">—</td>
        <td class="dt">${ch.jiraStart ? fmtBR(ch.jiraStart) : '—'}</td>
        <td class="dt">${ch.jiraDue ? fmtBR(ch.jiraDue) : '—'}</td></tr>`);
    });
  });
  const c = document.getElementById('epicTable');
  c.innerHTML = `<div class="hier-note">Explodido: épicos → filhos (por parent). A esteira acima segue no nível de épico.</div>
    <table class="hier-table"><thead><tr><th>Key</th><th>Resumo</th><th>Status</th><th>Prio / Tipo</th><th>h</th><th>Local</th><th>Início</th><th>Fim</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
  wirePlannerCarets();
  refreshChildVis();
}

// ============================================================================
// Layout default (quando não há override): distribui por prioridade nas tracks
// ============================================================================
// Config da engine compartilhada pra este caller (FST: horas, sem dedicada,
// DEFAULT_TRACK pra FST-133).
function capacityCfg(){
  return {
    resolveEffort: resolveSp,          // manual → horas estimadas → placeholder
    prioRank: PRIO_RANK,
    dedicatedKey: DEDICATED.epic,      // sentinela __FST_NO_DEDICATED__ (nunca casa)
    defaultTrack: DEFAULT_TRACK,
    heatmapWeeks: HEATMAP_WEEKS,
  };
}
function ensureAssignments(){ KruzerCapacity.ensureAssignments(EPICS, STATE, capacityCfg()); }

// Engine de scheduling — FONTE ÚNICA em /shared/capacity.js (consolidada Fase C).
// Esforço → datas. Variantes do FST entram via capacityCfg(). Rede de segurança:
// scripts/capacity-golden.js (npm run test:capacity).
function computeSchedule(){ return KruzerCapacity.computeSchedule(EPICS, STATE, capacityCfg()); }

// ============================================================================
// Publish — grava o cronograma calculado pro Status Report (/fst/) renderizar
// EXATAMENTE o mesmo plano (espelho real, não recálculo).
// IO + helpers movidos pra /shared/capacity.js (Fase B do refactor 2026-06-25).
// ============================================================================
const BLK_HEX = KruzerCapacity.BLK_HEX;
function publishSchedule(sched){
  const cleanName = KruzerCapacity.cleanName;
  const itemize = e => {
    // Estado atual: começa na Start date real e termina na Due date real (gerida no
    // acompanhamento). Cai pro agendamento do capacity só quando não há data real.
    const ds = e.jiraStart ? startOfDay(e.jiraStart) : e.scheduledStart;
    let de = e.jiraDue ? startOfDay(e.jiraDue) : e.scheduledEnd;
    if (ds && de && de < ds) de = (e.scheduledEnd && e.scheduledEnd > ds) ? e.scheduledEnd : addDays(ds, 1);
    return {
      key: e.key, url: e.url, name: cleanName(e.summary),
      effort: e.effectiveSp, placeholder: e.spSource === 'placeholder',
      color: BLK_HEX[(STATUS_MAP[e.status]||{}).blk] || '#48507D',
      statusLabel: e.status,
      start: ds ? ds.toISOString() : null,
      end: de ? de.toISOString() : null,
      dueISO: e.jiraDue ? startOfDay(e.jiraDue).toISOString() : null,
      late: !!e.late,
    };
  };
  const lanes = [];
  if (sched.dedEpic) lanes.push({ label: `${DEDICATED.label} (dedicada)`, dedicated:true, items:[itemize(sched.dedEpic)] });
  sched.tracks.forEach((items, i) => lanes.push({ label:`Track ${i+1}`, dedicated:false, items: items.map(itemize) }));
  const payload = {
    v:1, generatedAt:new Date().toISOString(), unit:'h',
    today: sched.today.toISOString(), horizonEnd: sched.horizonEnd.toISOString(),
    params: { devs:STATE.devs, velocityPerDev:STATE.velocityPerDev, parallelTracks:STATE.parallelTracks, horizonWeeks:STATE.horizonWeeks, squad:sched.squad, throughputPerTrack:sched.throughputPerTrack, dedThroughput: sched.dedEpic ? (sched.dedThroughput || 0) : 0 },
    lanes, backlogCount: STATE.backlog.length, doneCount: sched.epics.filter(e=>e.done).length,
  };
  KruzerCapacity.publishSchedule(CFG.capScope, payload);
}

// ============================================================================
// Render
// ============================================================================
function render(){
  ensureAssignments();
  const sched = computeSchedule();
  LAST_SCHEDULE = sched;
  publishSchedule(sched);
  renderKPIs(sched);
  renderBoard(sched);
  renderBacklog(sched);
  renderHeatmap(sched);
  renderResourceTimeline(sched);
  renderTable(sched);
  wireSortables();
  document.getElementById('subtitle').textContent =
    `${EPICS.length} épicos • squad ${sched.squad} h/sem (${STATE.devs} pessoas × ${STATE.velocityPerDev}) · ${STATE.parallelTracks} tracks → ${sched.throughputPerTrack.toFixed(0)} h/sem por track`
    + (STATE.whatIfMode ? ' · ⚠ MODO WHAT-IF' : '');
}

function renderKPIs(sched){
  const total = EPICS.length;
  const sized = sched.epics.filter(e => e.spSource !== 'placeholder').length;
  const unsized = total - sized;
  const placedSp = sched.allScheduled.reduce((a,e)=> a + e.effectiveSp, 0);
  const horizonSp = Math.round(sched.totalCapacity * STATE.horizonWeeks);
  const lastEnd = sched.allScheduled.reduce((m,e)=> e.scheduledEnd && e.scheduledEnd>m ? e.scheduledEnd : m, sched.today);
  const weeksOut = ((lastEnd - sched.today)/(MS_DAY*7));
  const overflowing = sched.allScheduled.filter(e=>e.overHorizon).length;
  document.getElementById('kpis').innerHTML = `
    <div class="kpi k-open"><div class="label">Épicos</div><div class="value">${total}</div><div class="hint">${sched.allScheduled.length} na esteira · ${STATE.backlog.length} no backlog${sched.epics.filter(e=>e.done).length?` · ${sched.epics.filter(e=>e.done).length} concluído(s)`:''}</div></div>
    <div class="kpi k-sized"><div class="label">Estimados</div><div class="value">${sized}</div><div class="hint">horas (JIRA) · manual</div></div>
    <div class="kpi k-unsized"><div class="label">Sem estimativa</div><div class="value">${unsized}</div><div class="hint">usando placeholder ${PLACEHOLDER_SP}h</div></div>
    <div class="kpi k-capacity"><div class="label">Esforço na esteira</div><div class="value">${placedSp}<span style="font-size:14px"> h</span></div><div class="hint">cabem ${horizonSp}h em ${STATE.horizonWeeks} sem</div></div>
    <div class="kpi k-horizon"><div class="label">Fim projetado</div><div class="value">${weeksOut.toFixed(1)}<span style="font-size:14px"> sem</span></div><div class="hint">${fmtBR(lastEnd)}${overflowing? ' · '+overflowing+' fora do horizonte':''}</div></div>
  `;
}

function renderBoard(sched){
  const ppwk = sched.throughputPerTrack * PX_PER_SP; // px por semana (1 semana = throughput SP)
  const boardW = Math.max(sched.totalWeeks * ppwk, 600);

  // ---- Régua de tempo ----
  const ruler = document.getElementById('ruler');
  let rh = `<div class="ruler-pad lane-head-w"></div><div class="ruler-track" style="width:${boardW}px">`;
  for (let w = 0; w <= sched.totalWeeks; w++){
    const x = w * ppwk;
    const d = addDays(sched.today, w*7);
    const isMonth = d.getDate() <= 7; // primeira semana do mês
    const moLabel = isMonth ? `<span class="mo">${d.toLocaleDateString('pt-BR',{month:'short'}).replace('.','')}</span>` : '';
    rh += `<div class="wk ${isMonth?'month':''}" style="left:${x}px">${moLabel}${w%2===0?('S'+w):''}</div>`;
  }
  // marca de horizonte
  const hx = STATE.horizonWeeks * ppwk;
  rh += `<div class="horizon-mark" style="left:${hx}px"><span>horizonte ${STATE.horizonWeeks}sem</span></div>`;
  rh += `</div>`;
  ruler.innerHTML = rh;

  // ---- Lanes ----
  // Renderiza uma track: cada épico + (se expandido) os blocos-filho logo após.
  const strip = list => list.flatMap(e => (EXPLODED && EXPANDED.has(e.key))
    ? [blockHtml(e), ...descendantsOf(e.key).filter(c => TYPE_ON[c.issueType] !== false).map(childBlockHtml)]
    : [blockHtml(e)]).join('');
  const lanes = document.getElementById('lanes');
  let lh = '';
  // zona de horizonte (vermelho claro) e linha de HOJE atravessando as lanes
  lh += `<div class="today-line" style="left:${132}px"><span>HOJE ${fmtBR(sched.today)} (${fmtWeekday(sched.today)})</span></div>`;
  const horizonStartX = 132 + STATE.horizonWeeks * ppwk;
  lh += `<div class="horizon-zone" style="left:${horizonStartX}px; width:${Math.max(0, boardW - STATE.horizonWeeks*ppwk)}px"></div>`;

  // Track dedicada do 99Food primeiro (fora da regra de capacity do squad)
  if (sched.dedEpic){
    const e = sched.dedEpic;
    const lastEnd = e.scheduledEnd || sched.today;
    lh += `<div class="lane dedicated">
      <div class="lane-head">
        <div class="nm">${DEDICATED.label}</div>
        <div class="tag99">dedicada · sem recurso</div>
        <div class="mt">${e.spSource==='placeholder'?'? SP':e.effectiveSp+' SP'} · ${sched.dedThroughput}/sem</div>
        <div class="mt">→ ${fmtBR(lastEnd)}</div>
      </div>
      <div class="lane-strip" data-dedicated="1" style="min-width:${boardW}px">
        ${strip([e])}
      </div>
    </div>`;
  }

  for (let ti = 0; ti < STATE.parallelTracks; ti++){
    const items = sched.tracks[ti] || [];
    const sumSp = items.reduce((a,e)=>a+e.effectiveSp,0);
    const lastEnd = items.reduce((m,e)=> e.scheduledEnd&&e.scheduledEnd>m?e.scheduledEnd:m, sched.today);
    lh += `<div class="lane">
      <div class="lane-head">
        <div class="nm">Track ${ti+1}</div>
        <div class="mt">${items.length} épicos · ${sumSp}h</div>
        <div class="mt">→ ${fmtBR(lastEnd)}</div>
      </div>
      <div class="lane-strip" data-track="${ti}" style="min-width:${boardW}px">
        ${strip(items)}
      </div>
    </div>`;
  }
  lanes.innerHTML = lh;
  wireBoardCarets();
}
function wireLaneOverlap(){
  document.querySelectorAll('#lanes .lane-overlap').forEach(b => {
    b.addEventListener('click', ev => {
      ev.stopPropagation();
      const ti = +b.dataset.track;
      STATE.trackParallelism = STATE.trackParallelism || {};
      const cur = Math.max(1, STATE.trackParallelism[ti] || 1);
      const next = cur >= 3 ? 1 : cur + 1;           // cicla 1 → 2 → 3 → 1
      if (next <= 1) delete STATE.trackParallelism[ti]; else STATE.trackParallelism[ti] = next;
      persist(); render();
      toast(next > 1 ? `Track ${ti + 1}: sobreposição ×${next} (capacidade dividida)` : `Track ${ti + 1}: serial (sem sobreposição)`);
    });
  });
}

// Re-renderiza board + tabela juntos (mantém expansão sincronizada) + re-wire drag.
function rerenderExpansion(){
  if (!LAST_SCHEDULE) return;
  renderBoard(LAST_SCHEDULE);
  renderTable(LAST_SCHEDULE);
  wireSortables();
}
function wireBoardCarets(){
  document.querySelectorAll('#lanes .blk-caret').forEach(el => {
    el.addEventListener('click', ev => {
      ev.stopPropagation();
      const k = el.dataset.key;
      if (EXPANDED.has(k)) EXPANDED.delete(k); else EXPANDED.add(k);
      rerenderExpansion();
    });
  });
}

function blockHtml(e){
  const st = STATUS_MAP[e.status] || STATUS_MAP['Backlog'];
  const isPlaceholder = e.spSource === 'placeholder';
  const w = Math.max(30, e.effectiveSp * PX_PER_SP);
  const cls = ['block', isPlaceholder ? 'placeholder' : st.blk];
  if (e.committedLocked) cls.push('committed');
  if (e.overlapped) cls.push('overlapped');
  const srcLabel = { hours:'horas', manual:'manual', placeholder:'?' }[e.spSource];
  const truncSum = e.summary.length > 26 ? e.summary.slice(0,24)+'…' : e.summary;
  let overlays = '';
  if (e.overHorizon) overlays += `<div class="overflow-ov" title="Começa fora do horizonte de ${STATE.horizonWeeks} semanas"></div>`;
  if (e.late && !e.overHorizon) overlays += `<div class="late-ov" title="Projeção ultrapassa o due date do JIRA (${fmtBR(e.jiraDue)})"></div>`;
  // marca de due date prometido: posição relativa ao próprio bloco
  // (o bloco de largura w cobre a duração scheduledStart→scheduledEnd)
  let dueMark = '';
  if (e.jiraDue && e.scheduledStart && e.scheduledEnd && e.scheduledEnd > e.scheduledStart){
    const durDays = (e.scheduledEnd - e.scheduledStart)/MS_DAY;
    const offDays = (startOfDay(e.jiraDue) - e.scheduledStart)/MS_DAY;
    const offPx = (offDays / durDays) * w;
    if (offPx > 2 && offPx < w) dueMark = `<div class="due-mark" style="left:${offPx}px" title="Due prometido: ${fmtBR(e.jiraDue)}"></div>`;
  }
  const depFlag = (e.dependencies && e.dependencies.length) ? `<span class="dep-flag" title="Depende de ${e.dependencies.join(', ')}">⛓ ${e.dependencies.length}</span>` : '';
  const nDesc = EXPLODED ? descendantsOf(e.key).length : 0;
  const blkCaret = nDesc ? `<span class="blk-caret" data-key="${e.key}" title="Expandir níveis (${nDesc})"><span class="caret-ico">▶</span></span>` : '';
  return `<div class="${cls.join(' ')}${EXPANDED.has(e.key)?' open':''}" data-key="${e.key}" style="width:${w}px" title="${escapeHtml(e.key+' · '+e.summary)}">
    ${blkCaret}<span class="bk">${e.key}</span>
    <span class="bs">${escapeHtml(truncSum)}</span>
    <span class="sp-tag">${isPlaceholder ? '?' : e.effectiveSp}</span>
    <span class="src-dot">${srcLabel}</span>
    ${depFlag}${dueMark}${overlays}
    <div class="resize-handle" data-key="${e.key}"></div>
  </div>`;
}
// Bloco de filho (feature/story/…) na esteira — fino, marcado, não-arrastável.
// Largura ∝ horas estimadas do próprio filho (min 24px). Aparece logo após o pai.
function childBlockHtml(c){
  const st = STATUS_MAP[c.status] || STATUS_MAP['Backlog'];
  const w = Math.max(24, (c.jiraEstimateH || 0) * PX_PER_SP);
  const trunc = c.summary.length > 20 ? c.summary.slice(0,18)+'…' : c.summary;
  return `<div class="block child-block ${st.blk}" data-key="${c.key}" style="width:${w}px" title="${escapeHtml(c.key+' · '+(c.issueType||'')+' · '+c.summary)}">
    <span class="bk">└ ${c.key}</span>
    <span class="bs">${escapeHtml(trunc)}</span>
    <span class="ctype">${escapeHtml(c.issueType||'')}</span>
  </div>`;
}

function renderBacklog(sched){
  const el = document.getElementById('backlogList');
  const items = STATE.backlog.filter(k => k !== DEDICATED.epic).map(k => sched.byKey[k]).filter(Boolean);
  if (!items.length){
    el.innerHTML = `<div class="backlog-empty">Tudo escalado.<br>Arraste épicos pra cá para tirar do plano.</div>`;
    return;
  }
  el.innerHTML = items.map(e=>{
    const sp = e.spSource==='placeholder' ? '?' : e.effectiveSp;
    return `<div class="backlog-block" data-key="${e.key}">
      <div class="bk">${e.key} <span class="badge prio-${e.priority.toLowerCase()}" style="font-size:9px">${e.priority}</span></div>
      <div class="bs">${escapeHtml(e.summary)}</div>
      <div class="bm">${sp}h · ${e.status}</div>
    </div>`;
  }).join('');
}

function renderHeatmap(sched){
  const ppwk = sched.throughputPerTrack * PX_PER_SP;
  const el = document.getElementById('heatmap');
  const trackW = sched.totalWeeks * ppwk;
  const weekLoad = (items, wkStart, wkEnd) => {
    let load = 0;
    items.forEach(e => {
      if (!e.scheduledStart || !e.scheduledEnd) return;
      const ov = Math.min(e.scheduledEnd, wkEnd) - Math.max(e.scheduledStart, wkStart);
      if (ov <= 0) return;
      const durDays = Math.max(1, (e.scheduledEnd - e.scheduledStart) / MS_DAY);
      load += e.effectiveSp * (ov / MS_DAY) / durDays;
    });
    return load;
  };
  // Uma linha por TRACK (carga vs capacidade da própria faixa) → mostra em qual
  // track/semana estoura. Colisão de âncoras numa track = >100% (vermelho);
  // concorrência planejada ≈ 100% (capacidade dividida, não estoura). + linha Total.
  const rowHtml = (label, items, capRow, extraCls) => {
    let cells = '';
    for (let w = 0; w < sched.totalWeeks; w++){
      const wkStart = addDays(sched.today, w*7), wkEnd = addDays(wkStart, 7);
      const load = weekLoad(items, wkStart, wkEnd);
      const pct = capRow > 0 ? load/capRow : 0;
      const cls = pct < 0.05 ? 'lvl-free' : pct <= 1.0 ? 'lvl-ok' : pct <= 1.1 ? 'lvl-warn' : 'lvl-over';
      cells += `<div class="hm-cell ${cls}" style="left:${w*ppwk}px; width:${ppwk}px" title="${label} · Sem ${w+1} (${fmtBR(wkStart)}): ${load.toFixed(1)}/${capRow.toFixed(0)}h · ${(pct*100).toFixed(0)}%"></div>`;
    }
    return `<div class="hm-row ${extraCls||''}"><div class="hm-pad lane-head-w">${label}</div><div class="hm-track" style="width:${trackW}px">${cells}</div></div>`;
  };
  let html = '';
  sched.tracks.forEach((items, ti) => { html += rowHtml('Track ' + (ti+1), items, sched.throughputPerTrack); });
  if (sched.dedEpic) html += rowHtml('Dedicada', [sched.dedEpic], sched.dedThroughput);
  html += rowHtml('Carga total', sched.allScheduled, sched.totalCapacity, 'total');
  el.innerHTML = html;
}
// Callout de conflitos de sobreposição (injetado acima da esteira).
function ensureOverlapHost(){
  let h = document.getElementById('overlapAlert');
  if (!h){ h = document.createElement('div'); h.id = 'overlapAlert'; h.className = 'overlap-alert';
    const bs = document.getElementById('boardScroll'); if (bs && bs.parentNode) bs.parentNode.insertBefore(h, bs); }
  return h;
}
function renderOverlaps(sched){
  const h = ensureOverlapHost();
  const ov = (sched.overlaps || []);
  if (!ov.length){ h.style.display = 'none'; h.innerHTML = ''; return; }
  h.style.display = '';
  const li = ov.slice(0, 8).map(o => `<li>Track ${o.trackIdx+1}: <b>${escapeHtml(o.aKey)}</b> × <b>${escapeHtml(o.bKey)}</b> — ${fmtBR(new Date(o.fromISO))}–${fmtBR(new Date(o.toISO))} (${o.days}d)${o.loadPct?` · <b>${o.loadPct}%</b> da faixa`:''}</li>`).join('');
  const more = ov.length > 8 ? `<li>+ ${ov.length-8} outra(s)…</li>` : '';
  h.innerHTML = `<div class="ov-head">⚠ ${ov.length} sobreposição(ões) na esteira — demandas concorrentes disputando a mesma capacidade</div><ul>${li}${more}</ul>`;
}

// ── Alocação por recurso · sobreposição no tempo (visão compreensiva) ─────────
// Raia por RECURSO (assignee); demandas posicionadas por data real/projetada;
// faixa "carga" = nº de demandas concorrentes daquele recurso no período
// (×1 ok · ×2 dividido · ×3+ sobrecarga). Substitui o toggle ⇄ + callout.
const RT_STATUS_COLOR = {
  'Hyper Care':'#12B76A','Em Execução':'#3151CE','Aguardando Aprovação':'#F79009','Ag. Aprovação':'#F79009',
  'UAT':'#7C3AED','Aguardando Estimativa':'#C6C9D9','Ag. Estimativa':'#C6C9D9','Backlog':'#48507D',
};
function ensureRTHost(){
  let h = document.getElementById('resourceTimeline');
  if (!h){ h = document.createElement('div'); h.id = 'resourceTimeline'; h.className = 'rt-view';
    const bs = document.getElementById('boardScroll'); if (bs && bs.parentNode) bs.parentNode.insertBefore(h, bs); }
  return h;
}
function loadColor(n){ return n >= 3 ? '#EE6A5F' : n === 2 ? '#F5B54B' : '#86C99A'; }
// ---- Camada de override (replaneja no cenário, sem tocar no JIRA) -----------
let RT_EDIT = null; // geometria da timeline p/ traduzir arraste → dias
function isoDay(d){ return d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` : null; }
function ovStartD(e){ const o = STATE.dateOverride[e.key]; return (o && o.start) ? startOfDay(new Date(o.start + 'T00:00:00')) : e.jiraStart; }
function ovDueD(e){ const o = STATE.dateOverride[e.key]; return (o && o.due) ? startOfDay(new Date(o.due + 'T00:00:00')) : e.jiraDue; }
function effAssigneeName(e){ const o = STATE.assigneeOverride; return Object.prototype.hasOwnProperty.call(o, e.key) ? (o[e.key] ? o[e.key].name : 'Sem responsável') : ((e.assignee && e.assignee.trim()) || 'Sem responsável'); }
function effAssigneeId(e){ const o = STATE.assigneeOverride; return Object.prototype.hasOwnProperty.call(o, e.key) ? (o[e.key] ? o[e.key].accountId : null) : (e.assigneeId || null); }
function isEdited(k){ return !!STATE.dateOverride[k] || Object.prototype.hasOwnProperty.call(STATE.assigneeOverride, k); }
// Demandas cujo efetivo (cenário) difere do JIRA real → o que o "Aplicar no JIRA" grava.
function computePending(){
  const out = [];
  (EPICS || []).forEach(e => {
    const ch = {};
    const od = STATE.dateOverride[e.key];
    if (od){
      const curStart = isoDay(e.jiraStart), curDue = isoDay(e.jiraDue);
      if (od.start !== undefined && (od.start || null) !== curStart) ch.start = { from: curStart, to: od.start || null };
      if (od.due   !== undefined && (od.due   || null) !== curDue)   ch.due   = { from: curDue,   to: od.due   || null };
    }
    if (Object.prototype.hasOwnProperty.call(STATE.assigneeOverride, e.key)){
      const ov = STATE.assigneeOverride[e.key];
      const curId = e.assigneeId || null, newId = ov ? ov.accountId : null;
      if (newId !== curId) ch.assignee = { from: e.assignee || 'Sem responsável', to: ov ? ov.name : 'Sem responsável', accountId: newId };
    }
    if (Object.keys(ch).length) out.push({ key: e.key, summary: e.summary, ch });
  });
  return out;
}

function renderResourceTimeline(sched){
  const host = ensureRTHost();
  const all = sched.placed.concat(sched.dedEpic ? [sched.dedEpic] : []);
  // POSICIONA POR DATAS REAIS DO JIRA (start/due), com override de cenário por cima.
  // A projeção do engine é serial → parece "linear"; as datas reais revelam a
  // sobreposição verdadeira. Editar arrastando grava só no override (cenário).
  const dS = e => startOfDay(ovStartD(e) || e.scheduledStart);
  const dE = e => { const s = dS(e); let en = startOfDay(ovDueD(e) || e.scheduledEnd || addDays(s, 7)); if (+en <= +s) en = addDays(s, 7); return en; };
  const items = all.filter(e => (ovStartD(e) || e.scheduledStart) && (ovDueD(e) || e.scheduledEnd));
  if (!items.length){ host.style.display = 'none'; host.innerHTML = ''; RT_EDIT = null; return; }
  host.style.display = '';
  const minMs = Math.min(...items.map(e => +dS(e)));
  const maxMs = Math.max(...items.map(e => +dE(e)));
  const d0 = new Date(minMs), axisStart = new Date(d0.getFullYear(), d0.getMonth(), 1);
  const d1 = new Date(maxMs), axisEnd = new Date(d1.getFullYear(), d1.getMonth() + 1, 1);
  const totalDays = Math.max(30, (axisEnd - axisStart) / MS_DAY);
  const PX_DAY = Math.min(11, Math.max(4, Math.round(880 / totalDays)));
  const W = Math.round(totalDays * PX_DAY), LABEL = 168, ROWH = 26, LOADH = 12;
  const xOf = ms => Math.round(((startOfDay(new Date(ms)) - axisStart) / MS_DAY) * PX_DAY);
  RT_EDIT = { axisStartMs: +axisStart, pxDay: PX_DAY, W, label: LABEL };

  // AGRUPA POR RECURSO (assignee efetivo). "Sem responsável" fica por último.
  const byA = new Map();
  items.forEach(e => { const k = effAssigneeName(e); if (!byA.has(k)) byA.set(k, []); byA.get(k).push(e); });

  const segsOf = arr => { const ev = []; arr.forEach(e => { ev.push([+dS(e), 1]); ev.push([+dE(e), -1]); }); ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]); const out = []; let cur = 0, prev = null; ev.forEach(([t, d]) => { if (prev != null && t > prev && cur > 0) out.push([prev, t, cur]); cur += d; prev = t; }); return out; };
  const packRows = arr => { const its = arr.slice().sort((a, b) => +dS(a) - +dS(b)); const rowEnd = []; const placed = []; its.forEach(e => { let r = rowEnd.findIndex(end => +dS(e) >= end); if (r < 0) { r = rowEnd.length; rowEnd.push(0); } rowEnd[r] = +dE(e); placed.push({ e, r }); }); return { placed, nrows: Math.max(1, rowEnd.length) }; };
  const countCol = n => n >= 3 ? '#EE6A5F' : n === 2 ? '#F5B54B' : '#86C99A';

  let axis = ''; let m = new Date(axisStart);
  while (m < axisEnd) { axis += `<div class="rt-mo" style="left:${xOf(+m)}px">${m.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}</div>`; m = new Date(m.getFullYear(), m.getMonth() + 1, 1); }
  const todayX = xOf(+sched.today), todayInRange = sched.today >= axisStart && sched.today < axisEnd;

  const hasDate = e => !!(ovStartD(e) || ovDueD(e));
  const peakOf = arr => Math.max(1, ...segsOf(arr.filter(hasDate)).map(s => s[2]));
  const groups = [...byA.entries()].map(([label, arr]) => ({ label, arr, peak: peakOf(arr), acct: effAssigneeId(arr[0]) }));
  groups.sort((a, b) => (a.label === 'Sem responsável') - (b.label === 'Sem responsável') || b.peak - a.peak || a.label.localeCompare(b.label));

  const leitura = [];
  const lanes = groups.map(({ label, arr, peak, acct }) => {
    const { placed, nrows } = packRows(arr); const dated = arr.filter(hasDate); const segs = segsOf(dated); const bodyH = LOADH + 6 + nrows * ROWH;
    const nUndated = arr.length - dated.length;
    const splitKeys = new Set();
    for (let i = 0; i < dated.length; i++) for (let j = i + 1; j < dated.length; j++)
      if (+dS(dated[i]) < +dE(dated[j]) && +dS(dated[j]) < +dE(dated[i])) { splitKeys.add(dated[i].key); splitKeys.add(dated[j].key); }
    const loadHtml = segs.map(([f, t, n]) => `<div class="rt-load" style="left:${xOf(f)}px;width:${Math.max(2, xOf(t) - xOf(f))}px;background:${countCol(n)}" title="${fmtBR(new Date(f))}–${fmtBR(new Date(t))}: ${n} demanda${n>1?'s':''} ao mesmo tempo">${n >= 2 && xOf(t) - xOf(f) > 22 ? '×' + n : ''}</div>`).join('');
    if (peak >= 2 && label !== 'Sem responsável') { const seg = segs.filter(s => s[2] >= 2).sort((x, y) => (x[1]-x[0])-(y[1]-y[0])).pop(); const ks = [...splitKeys]; leitura.push(`<b>${escapeHtml(label)}</b>: ${ks.join(' + ')}${seg ? ` (${fmtBR(new Date(seg[0]))}→${fmtBR(new Date(seg[1]))}, ×${peak})` : ''}`); }
    let gm = new Date(axisStart), gl = ''; while (gm < axisEnd) { gl += `<div class="rt-gl" style="left:${xOf(+gm)}px"></div>`; gm = new Date(gm.getFullYear(), gm.getMonth() + 1, 1); }
    const bars = placed.map(({ e, r }) => {
      const left = xOf(+dS(e)), w = Math.max(10, xOf(+dE(e)) - left);
      const color = RT_STATUS_COLOR[e.status] || '#48507D';
      const nm = (e.summary || e.key).length > 26 ? e.summary.slice(0, 25) + '…' : (e.summary || e.key);
      const ed = isEdited(e.key);
      return `<div class="rt-bar${splitKeys.has(e.key) ? ' split' : ''}${hasDate(e) ? '' : ' est'}${ed ? ' edited' : ''}" data-key="${e.key}" style="left:${left}px;top:${LOADH + 6 + r * ROWH}px;width:${w}px;background:${color}" title="${escapeHtml(e.key + ' · ' + (e.summary || ''))}\n${fmtBR(dS(e))}–${fmtBR(dE(e))}${hasDate(e) ? '' : ' (estimado — sem data no JIRA)'}${ed ? ' · ✎ replanejado' : ''} · ${e.effectiveSp||0}h\n↔ arraste move · bordas redimensionam · solte em outra raia p/ reatribuir">` +
        `<b>${e.key}</b><span>${escapeHtml(nm)}</span></div>`;
    }).join('');
    const hot = peak >= 2;
    const sub = `<span class="rt-peak ${hot ? 'hot' : 'ok'}">${dated.length} c/ data${hot ? ` · ×${peak} simultâneas` : ''}${nUndated ? ` · +${nUndated} sem data` : ''}</span>`;
    return `<div class="rt-lane" data-name="${escapeHtml(label)}" data-acct="${acct || ''}"><div class="rt-head" style="width:${LABEL}px"><div class="rt-nm">${escapeHtml(label)}</div>${sub}</div>` +
      `<div class="rt-body" style="width:${W}px;height:${bodyH}px">${gl}${todayInRange ? `<div class="rt-today" style="left:${todayX}px"></div>` : ''}${loadHtml}${bars}</div></div>`;
  }).join('');

  const pend = computePending();
  const actions = pend.length
    ? `<div class="rt-actions"><button class="rt-apply" id="rtApply">Aplicar no JIRA (${pend.length})</button><button class="rt-revert" id="rtRevert">Reverter tudo</button><span class="rt-hint">${pend.length} demanda(s) replanejada(s) no cenário — nada foi gravado no JIRA ainda</span></div>`
    : `<div class="rt-actions"><span class="rt-hint">Arraste as barras p/ replanejar datas · solte em outra raia p/ reatribuir · nada é gravado no JIRA até você aplicar</span></div>`;

  host.innerHTML =
    `<div class="rt-title">Alocação por recurso · sobreposição real <span>— barras nas <b>datas reais do JIRA</b>; a faixa mostra quantas demandas o recurso toca ao mesmo tempo (×2 dividido · ×3+ sobrecarregado).</span></div>` +
    (leitura.length ? `<div class="rt-read">⚠ Recurso dividido: ${leitura.join(' · ')}</div>` : `<div class="rt-read ok">Nenhum recurso com demandas concorrentes no período.</div>`) +
    actions +
    `<div class="rt-legend"><span><i style="background:#86C99A"></i>×1</span><span><i style="background:#F5B54B"></i>×2 dividido</span><span><i style="background:#EE6A5F"></i>×3+ sobrecarga</span><span class="rt-est-lg">▨ estimado (sem data)</span></div>` +
    `<div class="rt-scroll"><div class="rt-axis" style="margin-left:${LABEL}px;width:${W}px;height:18px">${axis}${todayInRange ? `<div class="rt-today" style="left:${todayX}px"></div>` : ''}</div>${lanes}</div>`;

  wireTimelineEditing(host);
}

// ---- Edição por arraste (move / resize / reatribuição) ----------------------
function wireTimelineEditing(host){
  const applyBtn = host.querySelector('#rtApply'); if (applyBtn) applyBtn.onclick = openApplyModal;
  const revertBtn = host.querySelector('#rtRevert'); if (revertBtn) revertBtn.onclick = () => { if (confirm('Descartar todos os replanejamentos do cenário?')) { STATE.dateOverride = {}; STATE.assigneeOverride = {}; persist(); render(); } };
  const scroll = host.querySelector('.rt-scroll'); if (!scroll || !RT_EDIT) return;
  let drag = null;
  const laneAt = (x, y) => { for (const lane of host.querySelectorAll('.rt-lane')) { const r = lane.getBoundingClientRect(); if (y >= r.top && y <= r.bottom) return { el: lane, name: lane.dataset.name, acct: lane.dataset.acct }; } return null; };
  scroll.addEventListener('pointerdown', ev => {
    const bar = ev.target.closest('.rt-bar'); if (!bar) return;
    const r = bar.getBoundingClientRect(); const off = ev.clientX - r.left;
    const mode = off < 9 ? 'l' : off > r.width - 9 ? 'r' : 'move';
    drag = { key: bar.dataset.key, bar, mode, x0: ev.clientX, y0: ev.clientY, left0: parseFloat(bar.style.left) || 0, w0: parseFloat(bar.style.width) || 10, moved: false };
    bar.setPointerCapture(ev.pointerId); bar.classList.add('dragging'); ev.preventDefault();
  });
  scroll.addEventListener('pointermove', ev => {
    if (!drag) return;
    const dx = ev.clientX - drag.x0;
    if (Math.abs(dx) > 3 || Math.abs(ev.clientY - drag.y0) > 3) drag.moved = true;
    if (drag.mode === 'move') drag.bar.style.left = (drag.left0 + dx) + 'px';
    else if (drag.mode === 'l') { drag.bar.style.left = (drag.left0 + dx) + 'px'; drag.bar.style.width = Math.max(10, drag.w0 - dx) + 'px'; }
    else drag.bar.style.width = Math.max(10, drag.w0 + dx) + 'px';
    const lane = laneAt(ev.clientX, ev.clientY);
    host.querySelectorAll('.rt-lane.drop').forEach(l => l.classList.remove('drop'));
    if (lane && drag.mode === 'move') lane.el.classList.add('drop');
  });
  scroll.addEventListener('pointerup', ev => {
    if (!drag) return; const d = drag; drag = null; d.bar.classList.remove('dragging');
    host.querySelectorAll('.rt-lane.drop').forEach(l => l.classList.remove('drop'));
    if (!d.moved) { openDrawer(d.key); return; }               // clique curto → drawer (SP/deps)
    const dxDays = Math.round((ev.clientX - d.x0) / RT_EDIT.pxDay);
    commitTimelineEdit(d, dxDays, ev.clientX, ev.clientY, laneAt);
  });
}
function commitTimelineEdit(d, dxDays, clientX, clientY, laneAt){
  const e = LAST_SCHEDULE && LAST_SCHEDULE.byKey[d.key]; if (!e){ render(); return; }
  let cs = startOfDay(ovStartD(e) || e.scheduledStart);
  let ce = startOfDay(ovDueD(e) || e.scheduledEnd || addDays(cs, 7)); if (+ce <= +cs) ce = addDays(cs, 7);
  let ns = cs, nd = ce;
  if (d.mode === 'move'){ ns = addDays(cs, dxDays); nd = addDays(ce, dxDays); }
  else if (d.mode === 'l'){ ns = addDays(cs, dxDays); if (+ns >= +nd) ns = addDays(nd, -1); }
  else { nd = addDays(ce, dxDays); if (+nd <= +ns) nd = addDays(ns, 1); }
  STATE.dateOverride[d.key] = { start: isoDay(ns), due: isoDay(nd) };
  if (d.mode === 'move'){
    const lane = laneAt(clientX, clientY);
    if (lane && lane.name !== effAssigneeName(e)){
      if (lane.name === 'Sem responsável') STATE.assigneeOverride[d.key] = null;
      else STATE.assigneeOverride[d.key] = { accountId: lane.acct || null, name: lane.name };
    }
  }
  persist(); render();
}

// ---- Aplicar no JIRA (push em lote, com resumo e confirmação) ---------------
function openApplyModal(){
  const pend = computePending(); if (!pend.length) return;
  let host = document.getElementById('rtApplyModal');
  if (!host){ host = document.createElement('div'); host.id = 'rtApplyModal'; host.className = 'rt-modal'; document.body.appendChild(host); }
  const rows = pend.map(p => {
    const parts = [];
    if (p.ch.start) parts.push(`<div class="rt-df"><span class="lb">Início</span> <span class="old">${p.ch.start.from || '—'}</span> → <span class="new">${p.ch.start.to || '—'}</span></div>`);
    if (p.ch.due) parts.push(`<div class="rt-df"><span class="lb">Due</span> <span class="old">${p.ch.due.from || '—'}</span> → <span class="new">${p.ch.due.to || '—'}</span></div>`);
    if (p.ch.assignee) parts.push(`<div class="rt-df"><span class="lb">Responsável</span> <span class="old">${escapeHtml(p.ch.assignee.from)}</span> → <span class="new">${escapeHtml(p.ch.assignee.to)}</span></div>`);
    return `<div class="rt-prow"><div class="rt-pk"><b>${p.key}</b><span>${escapeHtml((p.summary||'').slice(0,44))}</span></div><div class="rt-pc">${parts.join('')}</div></div>`;
  }).join('');
  host.innerHTML = `<div class="rt-mbd"></div><div class="rt-mbox"><div class="rt-mhd">Aplicar no JIRA · ${pend.length} demanda(s)</div>` +
    `<div class="rt-mwarn">Isto grava as datas/responsável direto no JIRA. Revise antes de confirmar.</div>` +
    `<div class="rt-mlist">${rows}</div>` +
    `<div class="rt-mft"><button class="rt-cancel" id="rtCancel">Cancelar</button><button class="rt-apply" id="rtConfirm">Confirmar e gravar</button></div>` +
    `<div class="rt-mlog" id="rtLog"></div></div>`;
  host.style.display = 'block';
  host.querySelector('.rt-mbd').onclick = () => { host.style.display = 'none'; };
  host.querySelector('#rtCancel').onclick = () => { host.style.display = 'none'; };
  host.querySelector('#rtConfirm').onclick = () => applyPendingToJira(pend, host);
}
async function applyPendingToJira(pend, host){
  const log = host.querySelector('#rtLog'); const confirm = host.querySelector('#rtConfirm');
  confirm.disabled = true; confirm.textContent = 'Gravando…';
  let ok = 0, fail = 0;
  for (const p of pend){
    const fields = {};
    if (p.ch.start) fields.customfield_10015 = p.ch.start.to;
    if (p.ch.due) fields.duedate = p.ch.due.to;
    if (p.ch.assignee) fields.assignee = p.ch.assignee.accountId ? { accountId: p.ch.assignee.accountId } : null;
    try {
      await KruzerAPI.updateFields(p.key, fields);
      ok++;
      delete STATE.dateOverride[p.key]; delete STATE.assigneeOverride[p.key];
      const e = (EPICS || []).find(x => x.key === p.key);
      if (e){
        if (p.ch.start) e.jiraStart = p.ch.start.to ? startOfDay(new Date(p.ch.start.to + 'T00:00:00')) : null;
        if (p.ch.due) e.jiraDue = p.ch.due.to ? startOfDay(new Date(p.ch.due.to + 'T00:00:00')) : null;
        if (p.ch.assignee){ e.assignee = p.ch.assignee.to; e.assigneeId = p.ch.assignee.accountId; }
      }
      log.innerHTML += `<div class="ok">✓ ${p.key}</div>`;
    } catch (err){ fail++; log.innerHTML += `<div class="err">✗ ${p.key}: ${escapeHtml(String(err.message || err)).slice(0,120)}</div>`; }
  }
  persist(); render();
  confirm.textContent = fail ? `Concluído com ${fail} erro(s)` : 'Concluído';
  log.innerHTML += `<div class="sum">${ok} gravada(s)${fail ? `, ${fail} falha(s)` : ''}.</div>`;
  if (!fail) setTimeout(() => { host.style.display = 'none'; }, 1200);
}

let gridInst = null;
function renderTable(sched){
  if (EXPLODED) return renderTableExploded(sched);
  const esc = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const cell = (inner, titleText, cls) => gridjs.html(`<div class="${cls}" title="${esc(titleText)}">${inner}</div>`);

  const rows = sched.epics.map(e=>{
    const st = STATUS_MAP[e.status] || STATUS_MAP['Backlog'];
    const loc = e.inBacklog ? 'Backlog' : (e.trackIdx!=null ? 'T'+(e.trackIdx+1) : '—');
    const sp = e.spSource==='placeholder' ? '?' : String(e.effectiveSp);
    return [
      e.key, e.summary, e.status, e.priority, sp, e.spSource, loc,
      e.scheduledStart ? fmtBR(e.scheduledStart) : '—',
      e.scheduledEnd ? fmtBR(e.scheduledEnd) : '—',
      e.url, st.cls,
    ];
  });

  const c = document.getElementById('epicTable');
  c.innerHTML = '';
  const host = document.createElement('div');
  c.appendChild(host);
  gridInst = new gridjs.Grid({
    autoWidth: false,
    columns: [
      {name:'Key', width:'95px', formatter:(v,row)=>cell(`<a href="${row.cells[9].data}" target="_blank" rel="noopener">${esc(v)}</a>`, v, 'cl1')},
      {name:'Summary', formatter:v=>cell(esc(v), v, 'cl2')},
      {name:'Status', width:'150px', formatter:(v,row)=>cell(`<span class="badge ${row.cells[10].data}">${esc(v)}</span>`, v, 'cl1')},
      {name:'Prio', width:'90px', formatter:v=>cell(`<span class="badge prio-${String(v).toLowerCase()}">${esc(v)}</span>`, v, 'cl1')},
      {name:'h', width:'75px', sort:{compare:(a,b)=>(parseFloat(a)||0)-(parseFloat(b)||0)}, formatter:v=>cell(esc(v), v, 'cl1')},
      {name:'Fonte', width:'115px', formatter:v=>cell(`<span class="badge src-${esc(v)}">${esc(v)}</span>`, v, 'cl1')},
      {name:'Local', width:'85px', formatter:v=>cell(esc(v), v, 'cl1')},
      {name:'Início', width:'110px', formatter:v=>cell(esc(v), v, 'cl1')},
      {name:'Fim', width:'110px', formatter:v=>cell(esc(v), v, 'cl1')},
      {name:'_url', hidden:true},
      {name:'_stcls', hidden:true},
    ],
    data: rows, search: true, sort: true, pagination: {limit: 25},
    style: {table: {'font-size':'13px', 'table-layout':'fixed', 'width':'100%'}},
  }).render(host);
}

// ============================================================================
// Drag & drop (SortableJS) — entre tracks, reordenação, e backlog
// ============================================================================
let sortables = [];
function wireSortables(){
  sortables.forEach(s => { try { s.destroy(); } catch(e){} });
  sortables = [];
  const committedFilter = STATE.whatIfMode ? '' : '.committed';
  // só as tracks do squad são sortables; a track dedicada (99Food) é fixa
  document.querySelectorAll('.lane-strip[data-track]').forEach(strip => {
    sortables.push(new Sortable(strip, {
      group: 'epics',
      animation: 140,
      filter: committedFilter + (committedFilter?',':'') + '.resize-handle,.child-block,.blk-caret',
      preventOnFilter: false,
      draggable: '.block:not(.child-block)',
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      onEnd: onDragEnd,
    }));
  });
  const backlog = document.getElementById('backlogList');
  sortables.push(new Sortable(backlog, {
    group: 'epics', animation: 140, draggable: '.backlog-block',
    ghostClass: 'sortable-ghost', chosenClass: 'sortable-chosen',
    onEnd: onDragEnd,
  }));
}

function onDragEnd(){
  // Lê o DOM e reconstrói trackAssignments + backlog a partir da nova ordem.
  const newAssign = {};
  document.querySelectorAll('.lane-strip[data-track]').forEach(strip => {
    const ti = +strip.dataset.track;
    [...strip.querySelectorAll('.block')].forEach((blk, idx) => {
      newAssign[blk.dataset.key] = { trackIdx: ti, orderInTrack: idx };
    });
  });
  const newBacklog = [...document.querySelectorAll('#backlogList .backlog-block')].map(b => b.dataset.key);
  STATE.trackAssignments = newAssign;
  STATE.backlog = newBacklog;
  persist();
  render(); // reschedule + redraw (re-wires sortables)
}

// ============================================================================
// Resize de bloco (ajuste manual de SP, snap a múltiplos de 4)
// ============================================================================
let resizing = null;
document.addEventListener('mousedown', (ev)=>{
  const handle = ev.target.closest('.resize-handle');
  if (!handle) return;
  ev.preventDefault(); ev.stopPropagation();
  const key = handle.dataset.key;
  const epic = LAST_SCHEDULE.byKey[key];
  if (!epic || (epic.committedLocked)) { toast('Épico comprometido — ative What-if para reestimar.'); return; }
  const block = handle.closest('.block');
  resizing = { key, block, startX: ev.clientX, startW: block.offsetWidth };
  document.body.style.cursor = 'ew-resize';
}, true);
document.addEventListener('mousemove', (ev)=>{
  if (!resizing) return;
  const dw = ev.clientX - resizing.startX;
  let newSp = Math.round(((resizing.startW + dw) / PX_PER_SP) / 4) * 4;
  newSp = Math.max(4, Math.min(800, newSp));
  resizing.block.style.width = Math.max(30, newSp*PX_PER_SP)+'px';
  const tag = resizing.block.querySelector('.sp-tag'); if (tag) tag.textContent = newSp;
  resizing.preview = newSp;
});
document.addEventListener('mouseup', ()=>{
  if (!resizing) return;
  document.body.style.cursor = '';
  if (resizing.preview != null){
    STATE.manualSp[resizing.key] = resizing.preview;
    persist();
    toast(`${resizing.key} reestimado em ${resizing.preview}h (manual)`);
    resizing = null;
    render();
  } else { resizing = null; }
});

// ============================================================================
// Drawer de detalhe
// ============================================================================
let drawerKey = null;
document.getElementById('lanes').addEventListener('click', (ev)=>{
  if (ev.target.closest('.resize-handle')) return;
  const blk = ev.target.closest('.block');
  if (blk) openDrawer(blk.dataset.key);
});
document.getElementById('backlogList').addEventListener('click', (ev)=>{
  const blk = ev.target.closest('.backlog-block');
  if (blk) openDrawer(blk.dataset.key);
});
document.getElementById('drawerClose').addEventListener('click', closeDrawer);
document.getElementById('drawerBackdrop').addEventListener('click', closeDrawer);

function openDrawer(key){
  drawerKey = key;
  const e = LAST_SCHEDULE.byKey[key];
  if (!e) return;
  const st = STATUS_MAP[e.status] || STATUS_MAP['Backlog'];
  document.getElementById('drawerKey').innerHTML = `<a href="${e.url}" target="_blank">${e.key}</a> · ${escapeHtml(e.summary)}`;
  document.getElementById('drawerBadges').innerHTML =
    `<span class="badge ${st.cls}">${e.status}</span> <span class="badge prio-${e.priority.toLowerCase()}">${e.priority}</span> `
    + (e.isCommitted ? `<span class="badge prio-p2">comprometida</span>` : '');

  const otherEpics = EPICS.filter(x => x.key !== e.key);

  const tshirtBtns = Object.entries(TSHIRT).map(([sz,val])=>{
    const active = STATE.manualSp[e.key] === val ? 'active' : '';
    return `<button class="tshirt-btn ${active}" data-sp="${val}">${sz}<small>${val}h</small></button>`;
  }).join('');

  const depOptions = otherEpics.map(x=>`<option value="${x.key}">${x.key} · ${escapeHtml(x.summary.slice(0,40))}</option>`).join('');
  const curDeps = (STATE.dependencies[e.key]||[]);
  const depChips = curDeps.length ? curDeps.map(d=>`<span class="badge src-manual" style="cursor:pointer" data-rmdep="${d}" title="remover">${d} ✕</span>`).join(' ') : '<span style="color:var(--kruzer-neutral-700)">nenhuma</span>';

  document.getElementById('drawerBody').innerHTML = `
    <h4>JIRA</h4>
    <div class="dgrid">
      <span class="lbl">DMND</span><span>${e.dmnd || '—'}</span>
      <span class="lbl">Status</span><span>${e.status}${e.jiraStatus?` <span style="color:var(--kruzer-neutral-700)">(${e.jiraStatus})</span>`:''}</span>
      <span class="lbl">Prioridade</span><span>${e.priority}</span>
      <span class="lbl">Start (JIRA)</span><span>${fmtBR(e.jiraStart)}</span>
      <span class="lbl">Due (JIRA)</span><span>${fmtBR(e.jiraDue)}</span>
      <span class="lbl">Estimativa (h)</span><span>${e.jiraEstimateH!=null?e.jiraEstimateH+'h':'—'}</span>
      <span class="lbl">Labels</span><span>${e.labels.length?e.labels.join(', '):'—'}</span>
    </div>

    <h4>Esforço efetivo</h4>
    <div class="dgrid" style="margin-bottom:10px">
      <span class="lbl">Horas efetivas</span><span><b>${e.spSource==='placeholder'?'? ('+PLACEHOLDER_SP+'h placeholder)':e.effectiveSp+'h'}</b></span>
      <span class="lbl">Fonte</span><span><span class="badge src-${e.spSource}">${e.spSource==='hours'?'horas (JIRA)':e.spSource}</span></span>
    </div>
    <div class="tshirt-row">${tshirtBtns}</div>
    <div style="display:flex;gap:8px;align-items:center">
      <input type="number" id="manualSpInput" placeholder="horas" min="1" max="800" value="${STATE.manualSp[e.key]??''}" style="width:90px">
      <button class="ghost" id="applyManualSp">Aplicar</button>
      <button class="ghost" id="clearManualSp">Limpar override</button>
    </div>

    <h4>Plano</h4>
    <div class="dgrid">
      <span class="lbl">Local</span><span>${e.inBacklog?'Backlog':(e.trackIdx!=null?'Track '+(e.trackIdx+1):'—')}</span>
      <span class="lbl">Início projetado</span><span>${fmtBR(e.scheduledStart)}</span>
      <span class="lbl">Fim projetado</span><span>${fmtBR(e.scheduledEnd)}${e.late?' <span class="badge prio-p0">atrasa due</span>':''}</span>
      <span class="lbl">Duração</span><span>${e.scheduledStart&&e.scheduledEnd?(((e.scheduledEnd-e.scheduledStart)/(MS_DAY*7)).toFixed(1)+' sem'):'—'}</span>
    </div>

    <h4>Dependências (esse épico depende de…)</h4>
    <div style="margin-bottom:8px">${depChips}</div>
    <div style="display:flex;gap:8px">
      <select class="dep-select" id="depSelect"><option value="">+ adicionar dependência…</option>${depOptions}</select>
    </div>
  `;

  // wire drawer interactions
  document.querySelectorAll('.tshirt-btn').forEach(b=> b.addEventListener('click', ()=>{
    STATE.manualSp[e.key] = +b.dataset.sp; persist(); render(); openDrawer(e.key);
  }));
  document.getElementById('applyManualSp').addEventListener('click', ()=>{
    const v = +document.getElementById('manualSpInput').value;
    if (v>0){ STATE.manualSp[e.key] = v; persist(); render(); openDrawer(e.key); toast(`${e.key}: ${v}h (manual)`); }
  });
  document.getElementById('clearManualSp').addEventListener('click', ()=>{
    delete STATE.manualSp[e.key]; persist(); render(); openDrawer(e.key); toast(`${e.key}: override removido`);
  });
  document.getElementById('depSelect').addEventListener('change', (ev2)=>{
    const dep = ev2.target.value; if (!dep) return;
    const arr = STATE.dependencies[e.key] || [];
    if (dep !== e.key && !arr.includes(dep)){ arr.push(dep); STATE.dependencies[e.key] = arr; persist(); render(); openDrawer(e.key); }
  });
  document.querySelectorAll('[data-rmdep]').forEach(chip=> chip.addEventListener('click', ()=>{
    STATE.dependencies[e.key] = (STATE.dependencies[e.key]||[]).filter(d=>d!==chip.dataset.rmdep);
    persist(); render(); openDrawer(e.key);
  }));

  document.getElementById('drawer').classList.add('show');
  document.getElementById('drawerBackdrop').classList.add('show');
}
function closeDrawer(){
  drawerKey = null;
  document.getElementById('drawer').classList.remove('show');
  document.getElementById('drawerBackdrop').classList.remove('show');
}
document.addEventListener('keydown', e=>{ if (e.key==='Escape') closeDrawer(); });

// ============================================================================
// Controles do toolbar
// ============================================================================
function readConfigInputs(){
  STATE.devs = clampNum(document.getElementById('devsInput').value, 1, 20, 2);
  STATE.velocityPerDev = clampNum(document.getElementById('velInput').value, 1, 60, 15);
  STATE.parallelTracks = clampNum(document.getElementById('tracksInput').value, 1, 6, 2);
  STATE.horizonWeeks = clampNum(document.getElementById('horizonInput').value, 2, 52, 12);
}
function syncConfigInputs(){
  document.getElementById('devsInput').value = STATE.devs;
  document.getElementById('velInput').value = STATE.velocityPerDev;
  document.getElementById('tracksInput').value = STATE.parallelTracks;
  document.getElementById('horizonInput').value = STATE.horizonWeeks;
  document.getElementById('whatIfToggle').checked = STATE.whatIfMode;
}
['devsInput','velInput','tracksInput','horizonInput'].forEach(id=>{
  document.getElementById(id).addEventListener('change', ()=>{ readConfigInputs(); persist(); render(); });
});
document.getElementById('whatIfToggle').addEventListener('change', (e)=>{
  STATE.whatIfMode = e.target.checked; // não persiste (loadState força false)
  render();
  toast(STATE.whatIfMode ? 'What-if ON — épicos comprometidos destravados' : 'What-if OFF');
});
document.getElementById('resetBtn').addEventListener('click', ()=>{
  if (!confirm('Resetar todos os overrides locais (ordem, tracks, T-shirt sizes, dependências) e voltar ao estado base do JIRA?')) return;
  localStorage.removeItem(LS.current);
  STATE = defaultState();
  readConfigInputs(); // mantém config de squad do toolbar? não — usa defaults
  STATE = defaultState();
  syncConfigInputs();
  render();
  toast('Overrides limpos — estado base do JIRA restaurado');
});
document.getElementById('refreshBtn').addEventListener('click', ()=> loadData(true));

// cenários salvos
function refreshScenarioSelect(){
  const sel = document.getElementById('scenarioSelect');
  const saved = loadSavedScenarios();
  sel.innerHTML = `<option value="__current">Atual (não salvo)</option>` +
    saved.map((s,i)=>`<option value="${i}">${escapeHtml(s.name)}</option>`).join('');
}
document.getElementById('saveScenarioBtn').addEventListener('click', ()=>{
  const name = prompt('Nome do cenário (ex: "pessimista"):');
  if (!name) return;
  const saved = loadSavedScenarios();
  const snapshot = JSON.parse(JSON.stringify(STATE));
  snapshot.name = name; snapshot.createdAt = new Date().toISOString();
  saved.push(snapshot); persistSavedScenarios(saved); refreshScenarioSelect();
  document.getElementById('scenarioSelect').value = String(saved.length-1);
  toast(`Cenário "${name}" salvo`);
});
document.getElementById('scenarioSelect').addEventListener('change', (e)=>{
  const v = e.target.value;
  if (v === '__current'){ STATE = loadState(); }
  else {
    const saved = loadSavedScenarios();
    const s = saved[+v];
    if (s){ STATE = Object.assign(defaultState(), JSON.parse(JSON.stringify(s))); STATE.whatIfMode = false; persist(); }
  }
  syncConfigInputs(); render();
  toast('Cenário carregado');
});

// export PNG (html2canvas lazy)
document.getElementById('exportBtn').addEventListener('click', async ()=>{
  const btn = document.getElementById('exportBtn');
  btn.disabled = true; const old = btn.textContent; btn.textContent = 'Gerando…';
  try {
    if (!window.html2canvas){
      await new Promise((res,rej)=>{
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
        s.onload = res; s.onerror = ()=>rej(new Error('falha ao carregar html2canvas'));
        document.head.appendChild(s);
      });
    }
    const target = document.getElementById('boardSection');
    const canvas = await html2canvas(target, { backgroundColor: '#ffffff', scale: 2, scrollX: 0, scrollY: 0, windowWidth: target.scrollWidth+40 });
    const ts = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
    const a = document.createElement('a');
    a.download = `${CFG.pngName}-${ts}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
    toast('PNG exportado');
  } catch(err){ toast('Erro no export: '+err.message); }
  finally { btn.disabled = false; btn.textContent = old; }
});

// ============================================================================
// Carregamento de dados
// ============================================================================
async function loadData(isRefresh){
  document.getElementById('errorBox').innerHTML = '';
  const btn = document.getElementById('refreshBtn');
  if (isRefresh){ btn.disabled = true; btn.textContent = 'Atualizando…'; }
  else { document.getElementById('loadingBox').style.display = ''; document.getElementById('content').style.display = 'none'; }
  try {
    // 1) TODOS os épicos da FastShop — consultados por tipo de issue, não por nome DMND
    const epicJql = `project = ${PROJECT} AND issuetype = Epic ORDER BY rank ASC`;
    const issues = await KruzerAPI.fetchAll({ jql: epicJql, fields: EPIC_FIELDS });
    // Encerrados (Done/Resolved/Canceled…) não entram na esteira; Hyper Care permanece.
    EPICS = issues.map(normalizeEpic).filter(e => !isClosedNotHyper(e));
    CHILDREN_BY_EPIC = {}; // FastShop estima no próprio épico — sem rollup de filhas
    // Hierarquia (explosão de níveis) fica stale com dados novos; re-busca se ligada.
    HIER_FETCHED = false; CHILDREN_HIER = {}; EXPANDED.clear();
    if (EXPLODED) { try { await fetchHierarchy(); } catch (err) { toast('Falha na hierarquia: ' + err.message); } }

    // 3) merge com estado local (preserva overrides)
    if (!STATE) STATE = loadState();
    // remove de overrides épicos que não existem mais
    const liveKeys = new Set(EPICS.map(e=>e.key));
    STATE.backlog = STATE.backlog.filter(k=>liveKeys.has(k));
    Object.keys(STATE.trackAssignments).forEach(k=>{ if(!liveKeys.has(k)) delete STATE.trackAssignments[k]; });

    syncConfigInputs();
    refreshScenarioSelect();
    document.getElementById('loadingBox').style.display = 'none';
    document.getElementById('toolbar').style.display = '';
    document.getElementById('content').style.display = '';
    injectHierControl();
    renderTypeFilters();
    render();
  } catch (e){
    document.getElementById('loadingBox').style.display = 'none';
    document.getElementById('errorBox').innerHTML = `<div class="error"><b>Falha ao carregar dados:</b> ${escapeHtml(e.message)}</div>`;
  } finally {
    if (isRefresh){ btn.disabled = false; btn.textContent = 'Atualizar dados'; }
  }
}

STATE = loadState();
loadData(false);
} };
