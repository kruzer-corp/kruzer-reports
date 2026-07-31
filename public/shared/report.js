// Status Report compartilhado (FST · PGM · VENA). Lógica + render + wiring
// extraídos da duplicação por página (consolidação item 2, fatia 2, 2026-06).
// Uso: KruzerReport.mount(CFG). Status unificado (superset que cobre as labels
// do FST e os status nativos do VENA). Rede de segurança: scripts/render-snapshot.js.
window.KruzerReport = { mount: function (CFG) {
const PROJECT = CFG.project, JIRA_BASE = 'https://kruzer.atlassian.net';
const FIELDS = ['summary','status','priority','issuetype','parent','issuelinks','created','resolutiondate','labels','duedate','description','customfield_10015','customfield_10423','timeoriginalestimate','aggregatetimeoriginalestimate'].concat(KruzerCapacity.DEV_DUE_FIELD ? [KruzerCapacity.DEV_DUE_FIELD] : []);
// customfield_10423 = Solicitante (texto livre). Editável no report (write-back JIRA).
const REQUESTER_FIELD = CFG.requesterField || null;

// Dependências (issuelinks): coleta as chaves que ESTE item bloqueia/precede
// (link outward do tipo "blocks"/"depends"). Uma aresta dirigida origem→alvo.
function parseLinks(links){
  const out = [];
  (links || []).forEach(l => {
    const nm = (l.type && l.type.name || '').toLowerCase();
    if (l.outwardIssue && /block|depend|precede/.test(nm)) out.push(l.outwardIssue.key);
  });
  return out;
}
const REMARK_STORE = CFG.remarkStore;

// Buckets de status, do mais maduro (conclusão) ao mais inicial.
const BUCKETS = [
  { id:'hyper',      label:'Hyper Care',           badgeCls:'badge-hyper',      laneCls:'hyper',      labelMatch:'hyper-care' },
  { id:'uat',        label:'UAT (cliente)',        badgeCls:'badge-uat',        laneCls:'uat',        labelMatch:'uat' },
  { id:'execucao',   label:'Em Execução',          badgeCls:'badge-execucao',   laneCls:'execucao',   labelMatch:'em-execucao' },
  { id:'aprovacao',  label:'Aguardando Aprovação', badgeCls:'badge-aprovacao',  laneCls:'aprovacao',  labelMatch:'aguardando-aprovacao' },
  { id:'estimativa', label:'Aguardando Estimativa',badgeCls:'badge-estimativa', laneCls:'estimativa', labelMatch:'aguardando-estimativa' },
  { id:'backlog',    label:'Backlog',              badgeCls:'badge-backlog',    laneCls:'backlog',    labelMatch:'backlog' },
];
const bucketById = id => BUCKETS.find(b => b.id === id);
// Ordem da tabela (top→down): conclusão → início.
const TABLE_ORDER = ['hyper','uat','execucao','aprovacao','estimativa','backlog'];
// Ordem da swimlane / KPIs (esq→dir): início → conclusão.
const LANE_ORDER = ['backlog','estimativa','aprovacao','execucao','uat','hyper'];

// JIRA priority name → P-tier.
function priorityTier(p){
  const n = (p||'').toLowerCase();
  if (n.includes('highest')) return 'P0';
  if (n.includes('high'))    return 'P1';
  if (n.includes('medium'))  return 'P2';
  if (n.includes('low'))     return 'P3';
  return 'P3';
}

// Texto de status (planilha/JIRA) → bucket id.
// Derivação de status → bucket. Precedência:
//   1. label `uat`/`hyper-care` (estados que o workflow nativo do JIRA ainda NÃO
//      expressa — enquanto não virarem status nativos, a label prevalece);
//   2. STATUS NATIVO do JIRA (fonte primária pro resto);
//   3. demais labels (em-execucao, aguardando-aprovacao…) — override manual;
//   4. descrição (**Status:**) — último recurso do workaround manual;
//   5. backlog.
// DUAS variantes: 'vena' (status nativos PT, superset) e 'fst' (mapa nativo rico +
// fallback). CFG.statusVariant seleciona.
// Labels semânticas que vencem o nativo (estados ausentes do workflow do JIRA).
function semanticLabelBucket(labels){
  if ((labels || []).includes('uat')) return 'uat';
  if ((labels || []).includes('hyper-care')) return 'hyper';
  return null;
}
function statusTextToBucketVena(txt){
  const s = (txt||'').toLowerCase();
  if (s.includes('uat') || s.includes('homolog'))                                       return 'uat';
  if (s.includes('hyper'))                                                              return 'hyper';
  if (s.includes('done') || s.includes('conclu') || s.includes('closed') || s.includes('pronto')) return 'hyper';
  if (s.includes('aprova'))                                                             return 'aprovacao';
  if (s.includes('execu') || s.includes('progress') || s.includes('review')
      || s.includes('desenvolvimento') || s.includes('bloqueado') || s.includes('blocked')) return 'execucao';
  if (s.includes('estimativa') || s.includes('refinamento') || s.includes('refinement') || s.includes('grooming')) return 'estimativa';
  if (s.includes('backlog'))                                                            return 'backlog';
  return null;
}
function resolveBucketVena(issue){
  const labels = issue.labels || [];
  const sem = semanticLabelBucket(labels);
  if (sem) return sem;
  const fromNative = statusTextToBucketVena(issue.statusName);
  if (fromNative) return fromNative;
  for (const b of BUCKETS) if (labels.includes(b.labelMatch)) return b.id;
  const fromDesc = statusTextToBucketVena(parseField(issue.description, 'Status'));
  if (fromDesc) return fromDesc;
  return 'backlog';
}
function statusTextToBucketFst(txt){
  const s = (txt||'').toLowerCase();
  if (s.includes('hyper'))                         return 'hyper';
  if (s.includes('uat') || s.includes('homolog'))  return 'uat';
  if (s.includes('execu'))                         return 'execucao';
  if (s.includes('aprova'))                        return 'aprovacao';
  if (s.includes('estimativa'))                    return 'estimativa';
  if (s.includes('backlog'))                       return 'backlog';
  return null;
}
// Mapa nativo rico da variante FST — retorna null se nada casar (cai pro label).
function nativeToBucketFst(statusName){
  const s = (statusName||'').toLowerCase();
  if (s.includes('uat') || s.includes('homolog'))                            return 'uat';
  if (s.includes('hyper') || s.includes('done') || s.includes('conclu') || s.includes('closed')) return 'hyper';
  if (s.includes('aprova'))                                                  return 'aprovacao';
  if (s.includes('estimativa') || s.includes('refin'))                       return 'estimativa';
  if (s.includes('progress') || s.includes('review') || s.includes('execu') || s.includes('desenvolv')) return 'execucao';
  return null;
}
function resolveBucketFst(issue){
  const labels = issue.labels || [];
  const sem = semanticLabelBucket(labels);
  if (sem) return sem;
  const fromNative = nativeToBucketFst(issue.statusName);
  if (fromNative) return fromNative;
  for (const b of BUCKETS) if (labels.includes(b.labelMatch)) return b.id;
  const fromDesc = statusTextToBucketFst(parseField(issue.description, 'Status'));
  if (fromDesc) return fromDesc;
  return 'backlog';
}
const statusTextToBucket = CFG.statusVariant === 'fst' ? statusTextToBucketFst : statusTextToBucketVena;
const resolveBucket      = CFG.statusVariant === 'fst' ? resolveBucketFst      : resolveBucketVena;

// Extrai "**Campo:** valor" da descrição (texto plano). Ignora travessão "—".
function parseField(desc, field){
  if (!desc) return '';
  const re = new RegExp('\\*\\*' + field + '[^:]*:\\*\\*\\s*(.+)');
  const m = desc.match(re);
  if (!m) return '';
  const v = m[1].trim();
  return (v === '—' || v === '-') ? '' : v;
}

// description pode vir como string ou ADF. Reduz a texto plano.
function descToText(d){
  if (!d) return '';
  if (typeof d === 'string') return d;
  // ADF: concatena textos recursivamente.
  let out = '';
  (function walk(node){
    if (!node) return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node.type === 'text' && node.text) {
      const strong = (node.marks || []).some(m => m.type === 'strong');
      out += strong ? `**${node.text}**` : node.text; // preserva negrito → casa com parseField
    }
    if (node.type === 'hardBreak' || node.type === 'paragraph') out += '\n';
    if (node.content) walk(node.content);
  })(d);
  return out;
}

function fmtDate(iso){
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function escapeHtml(s){
  return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function normalize(issue){
  const f = issue.fields || {};
  const descText = descToText(f.description);
  const out = {
    key: issue.key,
    url: `${JIRA_BASE}/browse/${issue.key}`,
    summary: f.summary || '',
    statusName: f.status?.name || '—',
    priority: f.priority?.name || '—',
    priorityTier: priorityTier(f.priority?.name),
    labels: f.labels || [],
    description: descText,
    startDate: f.customfield_10015 || parseDescDate(descText, 'Start'),
    dueDate: f.duedate || parseDescDate(descText, 'Due'),
    // Due Date Dev — entrega do dev p/ testes. Campo custom (quando existir) ou
    // "**Due Dev:** DD/MM" na descrição. NÃO é goal final → não vira atraso/risco.
    devDue: (KruzerCapacity.DEV_DUE_FIELD && f[KruzerCapacity.DEV_DUE_FIELD]) || parseDescDate(descText, 'Due Dev') || parseDescDate(descText, 'Due Date Dev') || '',
  };
  // DMND code + nome limpo.
  const dm = out.summary.match(/^(DMND\d+)\s*\|\s*(.*)$/);
  out.dmnd = dm ? dm[1] : '';
  out.name = dm ? dm[2].trim() : out.summary;
  out.bucket = resolveBucket(out);
  out.remarkDefault = parseField(descText, 'Remarks');
  // Solicitante (customfield_10423): texto livre; defensivo p/ formatos objeto.
  const rq = f.customfield_10423;
  out.requester = typeof rq === 'string' ? rq : ((rq && (rq.value || rq.displayName)) || '');
  // Insumos de capacity (mesmos do /fst/capacity): esforço em horas + flag "committed".
  const estSec = (f.timeoriginalestimate != null && f.timeoriginalestimate > 0) ? f.timeoriginalestimate
               : ((f.aggregatetimeoriginalestimate != null && f.aggregatetimeoriginalestimate > 0) ? f.aggregatetimeoriginalestimate : null);
  out.estH = estSec != null ? Math.round(estSec / 3600 * 10) / 10 : null;
  out.committed = !!out.startDate || out.bucket === 'execucao';
  out.done = (f.status?.statusCategory?.key === 'done'); // Done no JIRA → fora do cálculo da esteira
  // Hierarquia: tipo do issue + chave do pai (parent nativo ou epic-link legado).
  out.issueType = f.issuetype?.name || 'Task';
  out.parentKey = f.parent?.key || f.customfield_10014 || null;
  out.blocks = parseLinks(f.issuelinks);   // arestas de dependência (origem→alvo)
  return out;
}

// Start/Due podem vir "DD/MM/YYYY" na descrição; converte pra ISO pra unificar fmtDate.
function parseDescDate(desc, field){
  const v = parseField(desc, field);
  const m = v.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

// ---- Remarks (KruzerState — D1 + cache local; migra de REMARK_STORE legacy) ----
KruzerState.importLegacyKey(REMARK_STORE, CFG.scope, 'remarks');
function loadRemarks(){
  const r = KruzerState.read(CFG.scope, 'remarks');
  return (r && r.value && typeof r.value === 'object') ? r.value : {};
}
function saveRemarks(obj){
  const cur = KruzerState.read(CFG.scope, 'remarks');
  KruzerState.write(CFG.scope, 'remarks', obj, { expectedVersion: cur.version })
    .catch(e => console.warn('remarks save failed:', e.message));
}
let REMARK_OVERRIDES = loadRemarks();
// Sincroniza do servidor (e re-render no callback do listener)
KruzerState.sync(CFG.scope, 'remarks').then(() => { REMARK_OVERRIDES = loadRemarks(); });
KruzerState.subscribe(CFG.scope, 'remarks', () => { REMARK_OVERRIDES = loadRemarks(); if (typeof render === 'function') render(); });
function remarkFor(issue){
  if (Object.prototype.hasOwnProperty.call(REMARK_OVERRIDES, issue.key)) return REMARK_OVERRIDES[issue.key];
  return issue.remarkDefault || '';
}

// Épico "encerrado" que NÃO deve ser listado (nem report nem planner nem MCP):
// statusCategory = Done (Done/Resolved/Closed/Canceled/Expired/Duplicate…),
// EXCETO Hyper Care — que é acompanhamento ativo pós-entrega e permanece visível.
function isHyperCareEpic(e){
  return (e.labels || []).includes('hyper-care') || /hyper.?care/i.test(e.statusName || '');
}
function isClosedNotHyper(e){ return e.done && !isHyperCareEpic(e); }

let RAW = [];

// ===========================================================================
// Explosão hierárquica (filtro de níveis). Default: SÓ épicos (comportamento
// original intocado). Ligada, busca a árvore do projeto (issuetype != Epic),
// aninha por `parent` e deixa filtrar por tipo (descoberto dinamicamente).
// Escopo: só a TABELA de status. O gantt/computeSchedule seguem épico-only.
// ===========================================================================
let CHILDREN_BY_PARENT = {};   // parentKey -> [filho normalizado] (qualquer nível)
let DISCOVERED_TYPES = [];     // tipos presentes (Epic primeiro)
let TYPE_ON = {};              // issueType -> bool (Epic sempre on)
let EXPLODED = false;          // hierarquia ligada?
let HIER_FETCHED = false;      // já buscou os filhos deste RAW?
let HIER_BUSY = false;         // fetch em andamento (guard de reentrância)
const EXPANDED = new Set();    // épicos expandidos na tabela

function childrenOf(key){ return CHILDREN_BY_PARENT[key] || []; }
// Busca por key em épicos (RAW) OU em qualquer descendente (p/ editores de remark/solicitante nas filhas).
function issueByKey(key){
  const e = RAW.find(x => x.key === key); if (e) return e;
  for (const arr of Object.values(CHILDREN_BY_PARENT)) { const c = arr.find(x => x.key === key); if (c) return c; }
  return null;
}
function hasDescendants(key){ return childrenOf(key).length > 0; }
// Pré-ordem: todos os descendentes de um épico (feature → story → sub-task…).
function descendantsOf(key, depth, out){
  out = out || []; depth = depth || 1;
  for (const c of childrenOf(key)) { c._depth = depth; out.push(c); descendantsOf(c.key, depth + 1, out); }
  return out;
}

async function fetchHierarchy(){
  if (HIER_FETCHED) return;
  const jql = `project = ${PROJECT} AND issuetype != Epic ORDER BY rank ASC`;
  const issues = await KruzerAPI.fetchAll({ jql, fields: FIELDS });
  const kids = issues.map(normalize).filter(e => !isClosedNotHyper(e));
  CHILDREN_BY_PARENT = {};
  kids.forEach(k => { const p = k.parentKey || '__orphan__'; (CHILDREN_BY_PARENT[p] = CHILDREN_BY_PARENT[p] || []).push(k); });
  const set = new Set(['Epic']);
  RAW.forEach(e => set.add(e.issueType || 'Epic'));
  kids.forEach(k => set.add(k.issueType || 'Task'));
  DISCOVERED_TYPES = [...set];
  DISCOVERED_TYPES.forEach(t => { if (!(t in TYPE_ON)) TYPE_ON[t] = true; });
  HIER_FETCHED = true;
}

function injectHierControl(){
  const bar = document.querySelector('.toolbar');
  if (!bar || document.getElementById('hierToggle')) return;
  const wrap = document.createElement('div');
  wrap.className = 'hier-ctrl export-hide';
  wrap.innerHTML = `<label class="hier-main" title="Expande os épicos nos níveis abaixo (features, stories, sub-tasks) — aninhado por parent, na tabela e na timeline"><input type="checkbox" id="hierToggle"> Expandir visão</label><span class="type-filters" id="typeFilters"></span>`;
  bar.appendChild(wrap);
  document.getElementById('hierToggle').addEventListener('change', onHierToggle);
}
function renderTypeFilters(){
  const c = document.getElementById('typeFilters');
  if (!c) return;
  if (!EXPLODED){ c.innerHTML = ''; return; }
  c.innerHTML = '<span class="tf-lbl">níveis:</span>' + DISCOVERED_TYPES.filter(t => t !== 'Epic').map(t =>
    `<label class="type-chip"><input type="checkbox" data-type="${escapeHtml(t)}" ${TYPE_ON[t] !== false ? 'checked' : ''}> ${escapeHtml(t)}</label>`).join('');
  c.querySelectorAll('input[data-type]').forEach(inp => inp.addEventListener('change', () => {
    TYPE_ON[inp.dataset.type] = inp.checked; renderTable(); renderGantt();
  }));
}
async function onHierToggle(e){
  const box = e.target;
  // Ignora toggles enquanto um fetch está em andamento (evita dessincronizar o
  // estado). NÃO desabilita o checkbox — desabilitar o controle recém-clicado
  // dentro do próprio handler pode travar o toggle em alguns navegadores.
  if (HIER_BUSY){ box.checked = EXPLODED; return; }
  EXPLODED = box.checked;
  if (EXPLODED && !HIER_FETCHED){
    HIER_BUSY = true; box.parentElement.classList.add('loading');
    try { await fetchHierarchy(); }
    catch (err){ toast('Falha ao buscar hierarquia: ' + err.message, true); EXPLODED = false; box.checked = false; }
    finally { HIER_BUSY = false; box.parentElement.classList.remove('loading'); }
  }
  // "Expandir visão" = expande tudo (tabela E timeline). Ligar já mostra a
  // cascata; carets ainda permitem recolher épicos individuais depois.
  EXPANDED.clear();
  if (EXPLODED) RAW.forEach(e => { if (hasDescendants(e.key)) EXPANDED.add(e.key); });
  // Renders isolados em try/catch: um erro pontual não deixa o toggle num estado
  // quebrado (rejeição não tratada num handler async).
  try { renderTypeFilters(); renderTable(); renderGantt(); }
  catch (err){ console.error('[hier] render falhou:', err); toast('Erro ao renderizar hierarquia: ' + err.message, true); }
}

// ---- Render ----
function renderKPIs(){
  const counts = {}; BUCKETS.forEach(b => counts[b.id] = 0);
  RAW.forEach(i => counts[i.bucket]++);
  const c = document.getElementById('kpis'); c.innerHTML = '';
  LANE_ORDER.forEach(id => {
    const b = bucketById(id);
    c.innerHTML += `<div class="kpi k-${id}"><div class="label">${b.label}</div><div class="value">${counts[id]}</div></div>`;
  });
}

// Rank de prioridade: P0=0 (maior) … P3=3 (menor). Sem || pra não tratar P0 (0) como falsy.
function prioRank(t){ const n = parseInt(String(t||'').slice(1)); return isNaN(n) ? 9 : n; }
function sortWithin(arr){
  // FIFO (cliente): ordena por Due Date. Interno: por prioridade e depois due.
  if (REQUESTER_FIELD) return arr.sort((a,b) => {
    const da = a.dueDate || '9999', db = b.dueDate || '9999';
    if (da !== db) return da < db ? -1 : 1;
    return prioRank(a.priorityTier) - prioRank(b.priorityTier);
  });
  return arr.sort((a,b) => {
    const pa = prioRank(a.priorityTier), pb = prioRank(b.priorityTier);
    if (pa !== pb) return pa - pb; // maior prioridade (P0) primeiro
    const da = a.dueDate || '9999', db = b.dueDate || '9999';
    return da < db ? -1 : da > db ? 1 : 0;
  });
}

function epicRowEl(i, b){
  const tr = document.createElement('tr');
  tr.dataset.bucket = i.bucket; tr.dataset.prio = i.priorityTier; tr.dataset.key = i.key;
  if (EXPANDED.has(i.key)) tr.classList.add('open');
  tr.dataset.text = `${i.key} ${i.dmnd} ${i.name}`.toLowerCase();
  const start = fmtDate(i.startDate);
  const nDesc = EXPLODED ? descendantsOf(i.key).length : 0;
  const caret = (EXPLODED && nDesc)
    ? `<span class="tree-caret" data-key="${i.key}" role="button" tabindex="0" title="Expandir níveis"><span class="caret-ico">▶</span><span class="desc-count">${nDesc}</span></span>` : '';
  tr.innerHTML =
    `<td class="key">${caret}<a href="${i.url}" target="_blank" rel="noopener">${i.key}</a></td>` +
    `<td class="key">${i.dmnd || '<span class="empty">—</span>'}</td>` +
    `<td class="name">${escapeHtml(i.name)}</td>` +
    `<td><span class="badge ${b.badgeCls}">${b.label}</span></td>` +
    (REQUESTER_FIELD
      ? `<td class="requester"><input class="req-edit" data-key="${i.key}" value="${escapeHtml(i.requester||'')}" placeholder="—" title="Editar Solicitante → grava no JIRA"></td>`
      : `<td><select class="prio-edit prio-${i.priorityTier.toLowerCase()}" data-key="${i.key}" title="Editar prioridade → grava no JIRA">${['P0','P1','P2','P3'].map(p=>`<option value="${p}" ${p===i.priorityTier?'selected':''}>${p}</option>`).join('')}</select></td>`) +
    `<td class="date">${start || '<span class="empty">—</span>'}</td>` +
    `<td class="date">${ (i.dueDate||'').slice(0,10)
        ? `<input type="date" class="due-edit" data-key="${i.key}" value="${(i.dueDate||'').slice(0,10)}" title="Editar Due Date → grava no épico do JIRA">`
        : `<span class="empty due-empty" data-key="${i.key}" role="button" tabindex="0" title="Definir Due Date → grava no épico do JIRA">—</span>` }${ i.devDue ? `<div class="dev-due" title="Due Date Dev — entrega do desenvolvimento p/ testes (não é o goal final do projeto)">🔧 dev ${fmtDate(i.devDue)}</div>` : '' }</td>` +
    `<td class="remarks"><div class="remark-edit" contenteditable="true" data-key="${i.key}" title="Editar remark → adiciona comentário no épico do JIRA">${escapeHtml(remarkFor(i))}</div></td>`;
  return tr;
}
// Linha de descendente (feature/story/sub-task…) — read-only, indentada por nível.
function childRowEl(c, epicKey){
  const bk = bucketById(c.bucket) || bucketById('backlog');
  const tr = document.createElement('tr');
  tr.className = 'child-row';
  tr.dataset.epic = epicKey; tr.dataset.type = c.issueType || 'Task'; tr.dataset.depth = c._depth || 1;
  tr.dataset.text = `${c.key} ${c.name}`.toLowerCase();
  const indent = 10 + (c._depth || 1) * 18;
  const start = fmtDate(c.startDate), due = fmtDate(c.dueDate);
  tr.innerHTML =
    `<td class="key child" style="padding-left:${indent}px"><span class="tree-guide">└</span><a href="${c.url}" target="_blank" rel="noopener">${c.key}</a></td>` +
    `<td class="key"><span class="type-badge">${escapeHtml(c.issueType || 'Task')}</span></td>` +
    `<td class="name child">${escapeHtml(c.name)}</td>` +
    `<td><span class="badge ${bk.badgeCls}">${bk.label}</span></td>` +
    (REQUESTER_FIELD
      ? `<td class="requester"><span class="req-ro">${escapeHtml(c.requester || '') || '<span class="empty">—</span>'}</span></td>`
      : `<td><span class="prio-ro prio-${(c.priorityTier||'P3').toLowerCase()}">${c.priorityTier || '—'}</span></td>`) +
    `<td class="date">${start || '<span class="empty">—</span>'}</td>` +
    `<td class="date">${due || '<span class="empty">—</span>'}</td>` +
    `<td class="remarks"><div class="remark-edit" contenteditable="true" data-key="${c.key}" title="Editar remark → adiciona comentário no item do JIRA">${escapeHtml(remarkFor(c))}</div></td>`;
  return tr;
}
function renderTable(){
  const grouped = {}; TABLE_ORDER.forEach(id => grouped[id] = []);
  RAW.forEach(i => grouped[i.bucket].push(i));
  TABLE_ORDER.forEach(id => sortWithin(grouped[id]));

  const tb = document.getElementById('tbody'); tb.innerHTML = '';
  TABLE_ORDER.forEach(id => {
    const items = grouped[id]; if (!items.length) return;
    const b = bucketById(id);
    const dv = document.createElement('tr');
    dv.className = 'group-divider'; dv.dataset.bucket = id;
    dv.innerHTML = `<td colspan="8">${b.label} <span class="count">${items.length} ${items.length === 1 ? 'demanda' : 'demandas'}</span></td>`;
    tb.appendChild(dv);

    items.forEach(i => {
      tb.appendChild(epicRowEl(i, b));
      if (EXPLODED) descendantsOf(i.key).forEach(c => tb.appendChild(childRowEl(c, i.key)));
    });
  });
  wireRemarkEditors();
  wireRequesterEditors();
  wireDueEditors();
  wirePrioEditors();
  if (EXPLODED) wireCarets();
  applyFilter();
}
function wireCarets(){
  document.querySelectorAll('.tree-caret').forEach(el => {
    const toggle = () => {
      const key = el.dataset.key;
      if (EXPANDED.has(key)) EXPANDED.delete(key); else EXPANDED.add(key);
      el.closest('tr').classList.toggle('open', EXPANDED.has(key));
      applyFilter();
      renderGantt();   // reflete a cascata (barras-filho) na timeline
    };
    el.addEventListener('click', toggle);
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); toggle(); } });
  });
}

function wireRemarkEditors(){
  document.querySelectorAll('.remark-edit').forEach(el => {
    const key = el.dataset.key;
    const issue = issueByKey(key);
    const markDirty = () => {
      const cur = el.innerText.trim();
      const isOverride = Object.prototype.hasOwnProperty.call(REMARK_OVERRIDES, key) && REMARK_OVERRIDES[key] !== (issue?.remarkDefault || '');
      el.classList.toggle('dirty', isOverride || (cur !== (issue?.remarkDefault || '') && Object.prototype.hasOwnProperty.call(REMARK_OVERRIDES, key)));
    };
    el.addEventListener('focus', () => { el.dataset.baseline = el.innerText.trim(); });
    el.addEventListener('blur', async () => {
      const cur = el.innerText.replace(/ /g, ' ').trim();
      if (cur === (issue?.remarkDefault || '')) {
        delete REMARK_OVERRIDES[key]; // voltou ao default → não guarda override
      } else {
        REMARK_OVERRIDES[key] = cur;
      }
      saveRemarks(REMARK_OVERRIDES);
      markDirty();
      // Comentário no JIRA quando o texto mudou e não está vazio.
      const baseline = el.dataset.baseline || '';
      if (cur && cur !== baseline) {
        el.classList.add('saving');
        try { await KruzerAPI.addComment(key, `📋 Remark (Status Report): ${cur}`); toast(`Comentário adicionado em ${key}`); }
        catch (e) { toast(`Falha ao comentar em ${key}: ${e.message}`, true); }
        finally { el.classList.remove('saving'); }
      }
    });
    el.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); el.blur(); } });
    markDirty();
  });
}

// Solicitante (customfield_10423) editável → grava direto no campo do JIRA.
function wireRequesterEditors(){
  if (!REQUESTER_FIELD) return;
  document.querySelectorAll('.req-edit').forEach(inp => {
    const key = inp.dataset.key;
    inp.addEventListener('focus', () => { inp.dataset.baseline = inp.value.trim(); });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
    inp.addEventListener('blur', async () => {
      const cur = inp.value.trim();
      const baseline = inp.dataset.baseline != null ? inp.dataset.baseline : cur;
      if (cur === baseline) return;
      inp.disabled = true;
      try {
        await KruzerAPI.updateFields(key, { [REQUESTER_FIELD]: cur || null });
        const issue = issueByKey(key); if (issue) issue.requester = cur;
        toast(`Solicitante de ${key} ${cur ? 'atualizado' : 'limpo'} no JIRA`);
      } catch (e) {
        toast(`Falha ao gravar Solicitante de ${key}: ${e.message}`, true);
        inp.value = baseline;
      } finally { inp.disabled = false; }
    });
  });
}

// Due Date editável → grava no campo Due Date do épico no JIRA.
// Sem valor, mostra o mesmo "—" do Start Date (não o placeholder dd/mm/yyyy);
// clicar no "—" abre o date-picker.
function wireDueInput(inp){
  inp.addEventListener('change', async () => {
    const key = inp.dataset.key;
    const issue = RAW.find(x => x.key === key);
    const val = inp.value || null; // 'YYYY-MM-DD' ou null
    inp.disabled = true;
    try {
      await KruzerAPI.updateDueDate(key, val);
      if (issue) issue.dueDate = val || '';
      toast(`Due Date de ${key} ${val ? 'atualizado → ' + fmtDate(val) : 'limpo'} no JIRA`);
      if (!val) inp.replaceWith(makeDueEmpty(key)); // limpou → volta pro "—"
    } catch (e) {
      toast(`Falha ao atualizar Due de ${key}: ${e.message}`, true);
    } finally {
      inp.disabled = false;
    }
  });
  // abriu o picker mas saiu sem escolher data → volta pro "—"
  inp.addEventListener('blur', () => { if (!inp.value) inp.replaceWith(makeDueEmpty(inp.dataset.key)); });
}
function makeDueInput(key, value){
  const inp = document.createElement('input');
  inp.type = 'date'; inp.className = 'due-edit'; inp.dataset.key = key; inp.value = value || '';
  inp.title = 'Editar Due Date → grava no épico do JIRA';
  wireDueInput(inp);
  return inp;
}
function wireDueEmpty(span){
  const open = () => {
    const inp = makeDueInput(span.dataset.key, '');
    span.replaceWith(inp);
    inp.focus();
    if (inp.showPicker) { try { inp.showPicker(); } catch {} }
  };
  span.addEventListener('click', open);
  span.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
}
function makeDueEmpty(key){
  const span = document.createElement('span');
  span.className = 'empty due-empty'; span.dataset.key = key; span.setAttribute('role', 'button'); span.tabIndex = 0;
  span.title = 'Definir Due Date → grava no épico do JIRA'; span.textContent = '—';
  wireDueEmpty(span);
  return span;
}
function wireDueEditors(){
  document.querySelectorAll('.due-edit').forEach(wireDueInput);
  document.querySelectorAll('.due-empty').forEach(wireDueEmpty);
}

// Priority editável → grava no campo Priority do épico no JIRA.
const TIER_TO_JIRA = { P0:'Highest', P1:'High', P2:'Medium', P3:'Low' };
function wirePrioEditors(){
  document.querySelectorAll('.prio-edit').forEach(sel => {
    sel.addEventListener('change', async () => {
      const key = sel.dataset.key;
      const issue = RAW.find(x => x.key === key);
      const tier = sel.value;
      const name = TIER_TO_JIRA[tier] || 'Medium';
      sel.disabled = true;
      try {
        await KruzerAPI.updatePriority(key, name);
        if (issue) { issue.priorityTier = tier; issue.priority = name; }
        sel.className = `prio-edit prio-${tier.toLowerCase()}`;
        const tr = sel.closest('tr'); if (tr) tr.dataset.prio = tier;
        toast(`Prioridade de ${key} → ${tier} (${name}) no JIRA`);
      } catch (e) {
        toast(`Falha ao mudar prioridade de ${key}: ${e.message}`, true);
      } finally {
        sel.disabled = false;
      }
    });
  });
}

let _toastTimer;
function toast(msg, isErr){
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { t.className = 'toast'; }, 3200);
}

// ===========================================================================
// Timeline real — engine de capacity (réplica do /fst/capacity, sem track dedicada).
// Lê o MESMO cenário salvo pelo planejador (localStorage) pra unificar a visão:
// esforço (horas) → duração → datas, empacotado por track a partir de hoje.
// ===========================================================================
const CAP_STATE_KEY = CFG.capStateKey;
const CAP_SCHEMA = 2;
const PLACEHOLDER_H = 20;                 // horas nominais p/ épico sem estimativa
const DEFAULT_TRACK = CFG.defaultTrack || {};                 // sem overrides default — round-robin por prioridade
const GANTT_EXCLUDE = [];                 // hides manuais (vazio: a regra é status Done no JIRA)
// Épicos com status Done no JIRA NÃO entram no cálculo da esteira (mesma regra do /vena/capacity).
const ganttEpics = () => RAW.filter(e => !e.done && !GANTT_EXCLUDE.includes(e.key));
const MS_DAY = 86400000;
const CAP_DEFAULTS = { devs: 2, velocityPerDev: 30, parallelTracks: 2, horizonWeeks: 12 };
const PRIO_RANK = { P0:0, P1:1, P2:2, P3:3 };
const BUCKET_COLOR = { hyper:'#12B76A', uat:'#7C3AED', execucao:'#3151CE', aprovacao:'#F79009', estimativa:'#C6C9D9', backlog:'#48507D' };
const MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

function loadCapState(){
  try { const raw = localStorage.getItem(CAP_STATE_KEY); if (raw){ const s = JSON.parse(raw); if (s && s.schemaVersion === CAP_SCHEMA) return s; } } catch {}
  return null;
}
function capParams(){
  const s = loadCapState() || {};
  return {
    devs: s.devs ?? CAP_DEFAULTS.devs,
    velocityPerDev: s.velocityPerDev ?? CAP_DEFAULTS.velocityPerDev,
    parallelTracks: s.parallelTracks ?? CAP_DEFAULTS.parallelTracks,
    horizonWeeks: s.horizonWeeks ?? CAP_DEFAULTS.horizonWeeks,
    trackAssignments: Object.assign({}, s.trackAssignments || {}),
    backlog: Array.isArray(s.backlog) ? s.backlog.slice() : [],
    manualSp: s.manualSp || {},
    dependencies: s.dependencies || {},
  };
}
function startOfDay(d){ const x = new Date(d); x.setHours(0,0,0,0); return x; }
function addDays(d,n){ const x = new Date(d); x.setDate(x.getDate()+n); return x; }
function keyNum(k){ const n = parseInt(String(k).split('-')[1]); return isNaN(n) ? 0 : n; }
function fmtShort(d){ return d ? `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}` : '—'; }
function effortH(epic, P){
  const m = P.manualSp[epic.key];
  if (m != null && m > 0) return { h:m, src:'manual' };
  if (epic.estH != null && epic.estH > 0) return { h:epic.estH, src:'horas' };
  return { h:PLACEHOLDER_H, src:'placeholder' };
}
// Adapta o épico RAW do report pro shape da engine compartilhada.
function adaptReportEpic(e){
  return { ...e, isCommitted: !!e.committed, priority: e.priorityTier,
    jiraStart: e.startDate ? startOfDay(new Date(e.startDate + 'T00:00:00')) : null,
    jiraDue:   e.dueDate   ? startOfDay(new Date(e.dueDate   + 'T00:00:00')) : null };
}
// Engine de scheduling — FONTE ÚNICA em /shared/capacity.js (consolidada Fase C).
// O report não tem track dedicada; esforço em horas via effortH. É o fallback
// (localPlan) quando o planner ainda não publicou. Rede: scripts/capacity-golden.js.
function computeSchedule(){
  const P = capParams();
  P.whatIfMode = false;
  const epics = ganttEpics().map(adaptReportEpic);
  const cfg = {
    resolveEffort: (e, st) => { const r = effortH(e, st); return { sp: r.h, source: r.src }; },
    prioRank: PRIO_RANK, dedicatedKey: null, defaultTrack: DEFAULT_TRACK, heatmapWeeks: 26,
  };
  KruzerCapacity.ensureAssignments(epics, P, cfg);
  const sched = KruzerCapacity.computeSchedule(epics, P, cfg);
  sched.P = P;                                              // localPlan lê P.devs etc.
  sched.backlogCount = sched.epics.filter(e => e.inBacklog).length;
  return sched;
}

// Cronograma publicado pelo planner (fonte da verdade). Espelho real, sem recálculo.
// IO movido pra /shared/capacity.js (Fase B do refactor 2026-06-25).
function readPublishedSchedule(){
  const s = KruzerCapacity.readPublishedSchedule(CFG.capScope);
  if (!s) return null;
  const D = x => x ? new Date(x) : null;
  const unit = s.unit || 'h';
  const groups = s.lanes.map(L => ({
    label: L.label, dedicated: !!L.dedicated,
    items: (L.items||[]).filter(it => it.start && it.end).map(it => ({
      key: it.key, url: it.url, name: it.name || it.key,
      start: D(it.start), end: D(it.end), color: it.color || '#48507D',
      effort: it.effort, placeholder: !!it.placeholder,
      statusLabel: it.statusLabel || '', late: !!it.late, dueD: D(it.dueISO),
    })),
  })).filter(g => g.items.length);
  return { source:'planner', unit, today: D(s.today) || startOfDay(new Date()), horizonEnd: D(s.horizonEnd),
    params: s.params || {}, groups, backlogCount: s.backlogCount||0, doneCount: s.doneCount||0 };
}
// Fallback: engine local embarcada (em horas) quando o planner ainda não publicou.
function localPlan(){
  const sched = computeSchedule();
  const groups = sched.tracks.map((items, i) => ({
    label: `Track ${i+1}`, dedicated:false,
    items: items.filter(e=>e.scheduledStart).map(e => {
      const ds = e.jiraStart || e.scheduledStart;
      let de = e.jiraDue || e.scheduledEnd;
      if (ds && de && de < ds) de = (e.scheduledEnd && e.scheduledEnd > ds) ? e.scheduledEnd : addDays(ds, 1);
      return { key:e.key, url:e.url, name:e.name, start:ds, end:de,
        color: BUCKET_COLOR[e.bucket] || '#48507D', effort: e.effectiveSp, placeholder: e.spSource==='placeholder',
        statusLabel: (bucketById(e.bucket)||{}).label || '', late: e.late, dueD: e.jiraDue };
    }),
  })).filter(g=>g.items.length);
  return { source:'local', unit:'h', today: sched.today, horizonEnd: sched.horizonEnd,
    params: { devs:sched.P.devs, velocityPerDev:sched.P.velocityPerDev, parallelTracks:sched.P.parallelTracks, horizonWeeks:sched.P.horizonWeeks, squad:sched.squad, throughputPerTrack:sched.throughputPerTrack, dedThroughput:0 },
    groups, backlogCount: sched.backlogCount, doneCount: RAW.filter(e=>e.done).length };
}

function renderGantt(){
  const plan = readPublishedSchedule() || localPlan();
  const svg = document.getElementById('ganttSvg');
  const groups = plan.groups;
  const allItems = groups.flatMap(g => g.items);
  const unit = plan.unit, U = unit === 'SP' ? ' SP' : 'h';
  const effLabel = it => it.placeholder ? '?' : `${it.effort}${U}`;
  const pa = plan.params || {};

  const metaUnit = unit === 'SP' ? 'SP/sem' : 'h/sem';
  let metaTxt = '';
  if (pa.squad != null) {
    const tpt = Number(pa.throughputPerTrack);
    metaTxt = `squad ${pa.squad} ${metaUnit} (${pa.devs}×${pa.velocityPerDev}) · ${pa.parallelTracks} tracks → ${tpt.toFixed(tpt%1?1:0)} ${metaUnit} por track`;
    if (pa.dedThroughput) metaTxt += ` · +1 dedicada (${pa.dedThroughput} ${metaUnit})`;
  }
  metaTxt += (metaTxt?' · ':'') + (plan.source === 'planner' ? 'espelho do planner' : 'estimativa local (planner não publicado)');
  document.getElementById('ganttMeta').textContent = metaTxt;
  const ganttNotes = [];
  if (plan.backlogCount) ganttNotes.push(`${plan.backlogCount} no backlog do planejador`);
  if (plan.doneCount) ganttNotes.push(`${plan.doneCount} concluído(s) (Done no JIRA)`);
  document.getElementById('ganttNote').textContent = ganttNotes.length ? `* Fora da esteira: ${ganttNotes.join(' · ')}.` : '';

  if (!allItems.length){ svg.innerHTML=''; svg.setAttribute('height',0); return; }

  // Quando explodido, injeta barras dos FILHOS dos épicos EXPANDIDos (o mesmo
  // caret da tabela dirige a cascata na timeline). Filho com datas → barra pelas
  // suas datas; sem datas → barra tênue (hachura) no span do épico-pai.
  const D2 = s => s ? new Date(String(s).slice(0,10) + 'T00:00:00') : null;
  const childBar = (c, parent, depth) => {
    const s = D2(c.startDate) || parent.start;
    let e = D2(c.dueDate) || parent.end;
    if (s && e && e < s) e = addDays(s, 1);
    const undated = !c.startDate && !c.dueDate;
    return { key:c.key, url:c.url, name:c.name, start:s, end:e,
      color: BUCKET_COLOR[c.bucket] || '#48507D', placeholder: undated, undated,
      statusLabel: (bucketById(c.bucket)||{}).label || '', late:false,
      dueD: D2(c.dueDate), isChild:true, depth, issueType:c.issueType, effort:null };
  };
  const augmented = groups.map(g => {
    const list = [];
    [...g.items].sort((a,b)=> a.start - b.start).forEach(e => {
      list.push(Object.assign({ isChild:false, depth:0 }, e));
      if (EXPLODED && EXPANDED.has(e.key))
        descendantsOf(e.key).filter(c => TYPE_ON[c.issueType] !== false).forEach(c => list.push(childBar(c, e, c._depth || 1)));
    });
    return Object.assign({}, g, { items:list, epicCount:g.items.length });
  });
  const renderItems = augmented.flatMap(g => g.items);

  const today = plan.today;
  const starts = renderItems.map(it => it.start.getTime());
  const ends = renderItems.map(it => it.end.getTime());
  const aprFloor = new Date(today.getFullYear(), 3, 1).getTime();
  const minD = new Date(Math.max(Math.min(Math.min(...starts) - 3*MS_DAY, today.getTime() - 3*MS_DAY), aprFloor));
  const horizonMs = plan.horizonEnd ? plan.horizonEnd.getTime() : Math.max(...ends);
  const maxD = new Date(Math.max(horizonMs, ...ends) + 4*MS_DAY);
  const totalDays = Math.max(1, (maxD - minD)/MS_DAY);

  const LEFT = 270, TOP = 44, ROW = 30, GH = 28, PAD_B = 16;
  const wrap = document.getElementById('ganttWrap');
  const availW = (wrap && wrap.clientWidth ? wrap.clientWidth : 1100) - 1;
  const PX_DAY = Math.max(2.0, (availW - LEFT)/totalDays);
  const W = LEFT + totalDays*PX_DAY;
  const xd = d => LEFT + (d - minD)/MS_DAY * PX_DAY;

  let totalH = TOP;
  augmented.forEach(g => totalH += GH + g.items.length*ROW);
  totalH += PAD_B;

  let body = '<defs><pattern id="hh" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)"><rect width="6" height="6" fill="#c6cadb"/><rect width="3" height="6" fill="#eef0f6"/></pattern>'
    + '<marker id="depArrow" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="#8b93a7"/></marker></defs>';

  let m = new Date(minD.getFullYear(), minD.getMonth(), 1);
  while (m <= maxD){
    const mx = xd(m);
    if (mx >= LEFT){
      body += `<line class="g-grid-month" x1="${mx.toFixed(1)}" y1="${TOP-6}" x2="${mx.toFixed(1)}" y2="${totalH-PAD_B}"/>`;
      body += `<text class="g-axis bold" x="${(mx+4).toFixed(1)}" y="${TOP-14}">${MONTHS[m.getMonth()]} ${String(m.getFullYear()).slice(2)}</text>`;
    }
    m = new Date(m.getFullYear(), m.getMonth()+1, 1);
  }

  if (plan.horizonEnd && plan.horizonEnd >= minD && plan.horizonEnd <= maxD){
    const hx = xd(plan.horizonEnd);
    body += `<line x1="${hx.toFixed(1)}" y1="${TOP-6}" x2="${hx.toFixed(1)}" y2="${(totalH-PAD_B).toFixed(1)}" stroke="#F79009" stroke-width="1.5" stroke-dasharray="3 3"/>`;
    body += `<text class="g-axis" x="${(hx+4).toFixed(1)}" y="${(TOP-2).toFixed(1)}" fill="#F79009">horizonte ${pa.horizonWeeks||''}sem</text>`;
  }

  const barPos = {};   // key -> {x1,x2,y} p/ desenhar as setas de dependência
  let y = TOP;
  augmented.forEach(g=>{
    const sumEff = g.items.reduce((a,e)=> a + (e.isChild ? 0 : (e.effort||0)), 0);
    const lastEnd = g.items.reduce((mx,e)=> e.end>mx?e.end:mx, today);
    body += `<rect class="g-group-band" x="0" y="${y}" width="${W}" height="${GH}"/>`;
    body += `<text class="g-group-name" x="12" y="${y+GH/2+4}">${escapeHtml(g.label)}</text>`;
    body += `<text class="g-group-meta" x="200" y="${y+GH/2+4}">${g.epicCount} épicos · ${sumEff}${U} · → ${fmtShort(lastEnd)}</text>`;
    y += GH;
    g.items.forEach(e=>{
      const sx = xd(e.start), ex = xd(e.end);
      const clampedLeft = sx < LEFT;
      const bx = Math.max(sx, LEFT), bw = Math.max(6, ex - bx);
      const H = e.isChild ? 12 : 18;
      const by = y + (ROW-H)/2;
      const fill = e.placeholder ? 'url(#hh)' : e.color;
      const stroke = e.late ? '#F04438' : 'none', sw = e.late ? 2 : 0;
      const ind = (e.depth||0) * 14;
      const nm = e.name.length > 30 ? e.name.slice(0,29)+'…' : e.name;
      const keyCls = e.isChild ? 'g-key g-key-child' : 'g-key';
      body += KruzerComponents.svgLink(e.url, `<text class="${keyCls}" x="${12+ind}" y="${y+ROW/2+4}">${e.isChild?'└ ':''}${e.key}</text>`);
      body += `<text class="g-name" x="${88+ind}" y="${y+ROW/2+4}">${escapeHtml(nm)}</text>`;
      body += `<line class="g-rowsep" x1="0" y1="${y+ROW}" x2="${W}" y2="${y+ROW}"/>`;
      body += `<rect class="gantt-bar" x="${bx.toFixed(1)}" y="${by}" width="${bw.toFixed(1)}" height="${H}" rx="${e.isChild?3:4}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"`
        + ` data-key="${e.key}" data-name="${escapeHtml(e.name)}" data-status="${escapeHtml(e.statusLabel)}${e.isChild?' · '+escapeHtml(e.issueType||''):''}"`
        + ` data-eff="${e.isChild ? (e.undated?'sem data':'') : effLabel(e)}" data-start="${fmtShort(e.start)}" data-end="${fmtShort(e.end)}"`
        + ` data-due="${e.dueD?fmtShort(e.dueD):''}" data-late="${e.late?'1':''}" data-url="${e.url}"/>`;
      if (clampedLeft && bw > 16) body += `<polyline points="${(bx+8).toFixed(1)},${by+3} ${(bx+3).toFixed(1)},${by+H/2} ${(bx+8).toFixed(1)},${by+H-3}" fill="none" stroke="#fff" stroke-width="1.5"/>`;
      if (!e.isChild && bw > 46) body += `<text class="g-barlabel" x="${(bx+(clampedLeft?14:6)).toFixed(1)}" y="${by+13}" ${e.placeholder?'fill="#232534"':''}>${effLabel(e)}</text>`;
      barPos[e.key] = { x1: bx, x2: bx+bw, y: by + H/2 };
      y += ROW;
    });
  });

  // Setas de dependência (issuelinks "blocks"): origem→alvo entre barras visíveis.
  const edges = [];
  RAW.forEach(o => (o.blocks||[]).forEach(t => edges.push([o.key, t])));
  Object.values(CHILDREN_BY_PARENT).forEach(arr => arr.forEach(o => (o.blocks||[]).forEach(t => edges.push([o.key, t]))));
  let depCount = 0;
  edges.forEach(([from,to]) => {
    const a = barPos[from], bb = barPos[to];
    if (!a || !bb) return;
    depCount++;
    const x1 = a.x2, midx = Math.max(x1+9, bb.x1-9);
    body += `<path class="dep-link" d="M ${x1.toFixed(1)} ${a.y.toFixed(1)} L ${(x1+9).toFixed(1)} ${a.y.toFixed(1)} L ${(x1+9).toFixed(1)} ${bb.y.toFixed(1)} L ${(bb.x1-2).toFixed(1)} ${bb.y.toFixed(1)}" fill="none" stroke="#8b93a7" stroke-width="1.3" stroke-dasharray="4 3" marker-end="url(#depArrow)"/>`;
  });
  if (depCount) {
    const cur = document.getElementById('ganttNote').textContent;
    document.getElementById('ganttNote').textContent = (cur ? cur + ' ' : '') + `↝ ${depCount} dependência(s) (blocks) desenhada(s).`;
  }

  // Linha de hoje — por último (z-index acima das faixas/barras).
  if (today >= minD && today <= maxD){
    const tx = xd(today);
    body += `<line class="g-today" x1="${tx.toFixed(1)}" y1="16" x2="${tx.toFixed(1)}" y2="${(totalH-PAD_B).toFixed(1)}"/>`;
    body += `<rect x="${(tx-15).toFixed(1)}" y="2" width="30" height="15" rx="3" fill="#F04438"/>`;
    body += `<text x="${tx.toFixed(1)}" y="13" fill="#fff" text-anchor="middle" font-size="10" font-weight="700">hoje</text>`;
  }

  svg.setAttribute('viewBox', `0 0 ${W.toFixed(0)} ${totalH.toFixed(0)}`);
  svg.setAttribute('width', W.toFixed(0));
  svg.setAttribute('height', totalH.toFixed(0));
  svg.innerHTML = body;
  wireGanttTooltips();
}

function wireGanttTooltips(){
  const tip = document.getElementById('tooltip');
  document.querySelectorAll('#ganttSvg .gantt-bar').forEach(bar=>{
    bar.addEventListener('mousemove', e=>{
      const d = bar.dataset;
      tip.innerHTML = `<div class="t-title">${d.key} · ${escapeHtml(d.name)}</div>`
        + `<div class="t-meta">${d.status}</div>`
        + `<div class="t-grid">`
        + `<span class="lbl">Esforço</span><span>${d.eff}</span>`
        + `<span class="lbl">Início proj.</span><span>${d.start}</span>`
        + `<span class="lbl">Fim proj.</span><span>${d.end}</span>`
        + (d.due ? `<span class="lbl">Due JIRA</span><span>${d.due}${d.late?' · ⚠ estoura':''}</span>` : '')
        + `</div>`;
      tip.classList.add('show');
      let left = e.clientX+14, top = e.clientY+14;
      if (left+330 > window.innerWidth) left = e.clientX-330;
      tip.style.left = left+'px'; tip.style.top = top+'px';
    });
    bar.addEventListener('mouseleave', ()=> tip.classList.remove('show'));
    bar.addEventListener('click', ()=> window.open(bar.dataset.url, '_blank'));
  });
}

function applyFilter(){
  const q = (document.getElementById('search').value || '').toLowerCase().trim();
  const st = document.getElementById('filter-status').value;
  const pr = document.getElementById('filter-prio').value;
  const filtering = !!(q || st || pr);
  const tb = document.getElementById('tbody');
  const epicVisible = {};
  // Passo 1 — dividers + linhas de épico (regras originais).
  tb.querySelectorAll('tr').forEach(tr => {
    if (tr.classList.contains('group-divider')) { tr.style.display = filtering ? 'none' : ''; return; }
    if (tr.classList.contains('child-row')) return;
    const matchText = !q || (tr.dataset.text || '').includes(q);
    const matchStatus = !st || tr.dataset.bucket === st;
    const matchPrio = !pr || tr.dataset.prio === pr;
    const vis = matchText && matchStatus && matchPrio;
    tr.style.display = vis ? '' : 'none';
    if (tr.dataset.key) epicVisible[tr.dataset.key] = vis;
  });
  // Passo 2 — filhos: seguem tipo + épico visível + expandido; na busca, revelam plano.
  const revealEpic = {};
  tb.querySelectorAll('tr.child-row').forEach(tr => {
    const epic = tr.dataset.epic;
    const typeOn = TYPE_ON[tr.dataset.type] !== false;
    const matchText = !q || (tr.dataset.text || '').includes(q);
    const vis = q ? (typeOn && matchText) : (typeOn && !!epicVisible[epic] && EXPANDED.has(epic));
    tr.style.display = vis ? '' : 'none';
    if (vis && q) revealEpic[epic] = true;
  });
  // Busca que casou num filho → garante o épico-pai visível.
  if (q) Object.keys(revealEpic).forEach(epic => {
    const row = tb.querySelector(`tr[data-key="${CSS.escape(epic)}"]:not(.child-row)`);
    if (row) row.style.display = '';
  });
}

function renderAll(){
  renderKPIs();
  renderTypeFilters();
  renderTable();
  renderGantt();
  requestAnimationFrame(renderGantt); // re-mede a largura do Gantt após o layout assentar
  const now = new Date().toLocaleString('pt-BR');
  document.getElementById('metaTotal').textContent = RAW.length;
  document.getElementById('metaUpdated').textContent = now;
  document.getElementById('footerGen').textContent = `Gerado em ${now}`;
}

async function loadAndRender(){
  document.getElementById('errorBox').innerHTML = '';
  document.getElementById('loadingBox').style.display = '';
  document.getElementById('content').style.display = 'none';
  const btn = document.getElementById('refreshBtn'); btn.disabled = true; btn.textContent = 'Atualizando…';
  try {
    const jql = `project = ${PROJECT} AND issuetype = Epic ORDER BY created DESC`;
    const issues = await KruzerAPI.fetchAll({ jql, fields: FIELDS });
    REMARK_OVERRIDES = loadRemarks();
    // Encerrados (Done/Resolved/Canceled…) saem da listagem; Hyper Care permanece.
    RAW = issues.map(normalize).filter(e => !isClosedNotHyper(e));
    // Dados novos → hierarquia fica stale; re-busca se estiver explodida.
    HIER_FETCHED = false; CHILDREN_BY_PARENT = {}; EXPANDED.clear();
    if (EXPLODED) { try { await fetchHierarchy(); } catch (err) { toast('Falha ao buscar hierarquia: ' + err.message, true); } }
    document.getElementById('loadingBox').style.display = 'none';
    document.getElementById('content').style.display = '';
    renderAll();
  } catch (e) {
    document.getElementById('loadingBox').style.display = 'none';
    document.getElementById('errorBox').innerHTML = `<div class="error"><b>Falha ao carregar dados:</b> ${escapeHtml(e.message)}</div>`;
  } finally {
    btn.disabled = false; btn.textContent = 'Atualizar dados';
  }
}

// ===========================================================================
// Acompanhamentos & to-do — seção editável persistida em localStorage.
// ===========================================================================
const FOLLOWUP_STORE = CFG.followupStore;
const FU_CATS = [
  { id:'op',  label:'Operação',   color:'#3151CE' },
  { id:'ger', label:'Gerencial',  color:'#7C3AED' },
  { id:'fin', label:'Financeiro', color:'#12B76A' },
  { id:'out', label:'Outro',      color:'#989DAD' },
];
const fuCat = id => FU_CATS.find(c => c.id === id) || FU_CATS[3];
// Followups (KruzerState — D1 + cache local; migra de FOLLOWUP_STORE legacy)
KruzerState.importLegacyKey(FOLLOWUP_STORE, CFG.scope, 'followups');
function loadFollowups(){
  const r = KruzerState.read(CFG.scope, 'followups');
  return Array.isArray(r && r.value) ? r.value : [];
}
function saveFollowups(){
  const cur = KruzerState.read(CFG.scope, 'followups');
  KruzerState.write(CFG.scope, 'followups', FOLLOWUPS, { expectedVersion: cur.version })
    .catch(e => console.warn('followups save failed:', e.message));
}
let FOLLOWUPS = loadFollowups();
KruzerState.sync(CFG.scope, 'followups').then(() => { FOLLOWUPS = loadFollowups(); if (typeof renderFollowups === 'function') renderFollowups(); });
KruzerState.subscribe(CFG.scope, 'followups', () => { FOLLOWUPS = loadFollowups(); if (typeof renderFollowups === 'function') renderFollowups(); });

function renderFollowups(){
  const el = document.getElementById('fuList');
  if (!FOLLOWUPS.length){
    el.innerHTML = `<div class="fu-empty">Nenhum acompanhamento ainda. Clique em <b>+ Adicionar</b> para documentar operação, acordos gerenciais, financeiro, etc.</div>`;
    return;
  }
  el.innerHTML = FOLLOWUPS.map(it => {
    const cat = fuCat(it.cat);
    const opts = FU_CATS.map(c => `<option value="${c.id}" ${c.id === it.cat ? 'selected' : ''}>${c.label}</option>`).join('');
    return `<div class="fu-item ${it.done ? 'done' : ''}" data-id="${it.id}">
      <input type="checkbox" class="fu-done" ${it.done ? 'checked' : ''}>
      <select class="fu-cat" style="background:${cat.color}">${opts}</select>
      <span class="fu-cat-print" style="background:${cat.color}">${escapeHtml(cat.label)}</span>
      <div class="fu-text" contenteditable="true">${escapeHtml(it.text || '')}</div>
      <button class="fu-del export-hide" title="Remover">×</button>
    </div>`;
  }).join('');
  wireFollowups();
}
function wireFollowups(){
  document.querySelectorAll('#fuList .fu-item').forEach(row => {
    const id = row.dataset.id;
    const item = FOLLOWUPS.find(x => x.id === id);
    if (!item) return;
    row.querySelector('.fu-done').addEventListener('change', e => { item.done = e.target.checked; row.classList.toggle('done', item.done); saveFollowups(); });
    const sel = row.querySelector('.fu-cat');
    sel.addEventListener('change', e => {
      item.cat = e.target.value;
      const c = fuCat(item.cat);
      sel.style.background = c.color;
      const pr = row.querySelector('.fu-cat-print'); if (pr){ pr.textContent = c.label; pr.style.background = c.color; }
      saveFollowups();
    });
    const txt = row.querySelector('.fu-text');
    txt.addEventListener('blur', () => { item.text = txt.innerText.trim(); saveFollowups(); });
    txt.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); txt.blur(); } });
    row.querySelector('.fu-del').addEventListener('click', () => { FOLLOWUPS = FOLLOWUPS.filter(x => x.id !== id); saveFollowups(); renderFollowups(); });
  });
}
function addFollowup(){
  const id = 'fu' + Math.random().toString(36).slice(2, 9);
  FOLLOWUPS.push({ id, cat: 'op', text: '', done: false });
  saveFollowups(); renderFollowups();
  const txt = document.querySelector(`#fuList .fu-item[data-id="${id}"] .fu-text`);
  if (txt) txt.focus();
}

// ===========================================================================
// Export PDF — snapshot do estado atual pra pasta de Downloads (semana a semana).
// ===========================================================================
function loadScript(src){
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('falha ao carregar ' + src)); document.head.appendChild(s); });
}
async function exportPDF(){
  const btn = document.getElementById('exportBtn');
  const orig = btn.textContent; btn.disabled = true; btn.textContent = 'Exportando…';
  try {
    if (!window.html2canvas) await loadScript('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js');
    if (!window.jspdf)       await loadScript('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js');
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageW = pdf.internal.pageSize.getWidth(), pageH = pdf.internal.pageSize.getHeight();
    const M = 8, gap = 4, usableW = pageW - 2*M, usableH = pageH - 2*M;
    const fillBg = () => { pdf.setFillColor(244,244,248); pdf.rect(0,0,pageW,pageH,'F'); };

    // Paginação POR BLOCO (header, acompanhamentos, KPIs, cada seção) — quebra
    // entre cards em vez de cortar texto no meio. Só fatia se um bloco isolado
    // for maior que uma página inteira (último recurso, raro).
    const container = document.querySelector('.container');
    const content = document.getElementById('content');
    const blocks = [document.querySelector('.header'), document.getElementById('followups')];
    if (content) [...content.children].forEach(c => { if (!['errorBox','loadingBox'].includes(c.id)) blocks.push(c); });
    const visible = blocks.filter(b => b && b.offsetHeight > 0);

    document.body.classList.add('exporting');
    fillBg();
    let cursorY = M;
    try {
      for (const block of visible){
        // Fundo SÓLIDO na captura: JPEG não tem canal alfa, então pixels
        // transparentes (blocos/áreas sem bg) virariam PRETO no PDF. Captura com a
        // cor da página (#F4F4F8) elimina a transparência e o preto.
        const canvas = await html2canvas(block, { scale: 2, backgroundColor: '#F4F4F8', windowWidth: container.scrollWidth, scrollX: 0, scrollY: -window.scrollY, useCORS: true });
        const imgW = usableW, imgH = canvas.height * imgW / canvas.width;
        const imgData = canvas.toDataURL('image/jpeg', 0.95);
        if (imgH <= usableH){
          if (cursorY + imgH > pageH - M){ pdf.addPage(); fillBg(); cursorY = M; }
          pdf.addImage(imgData, 'JPEG', M, cursorY, imgW, imgH);
          cursorY += imgH + gap;
        } else {
          if (cursorY > M){ pdf.addPage(); fillBg(); cursorY = M; }
          const pxPerMm = canvas.height / imgH;
          let remaining = imgH, srcYmm = 0;
          while (remaining > 0){
            const sliceH = Math.min(usableH, remaining);
            const sc = document.createElement('canvas');
            sc.width = canvas.width; sc.height = Math.round(sliceH * pxPerMm);
            const sctx = sc.getContext('2d');
            sctx.fillStyle = '#F4F4F8'; sctx.fillRect(0, 0, sc.width, sc.height);   // opaco (sem preto em transparência)
            sctx.drawImage(canvas, 0, Math.round(srcYmm*pxPerMm), canvas.width, sc.height, 0, 0, canvas.width, sc.height);
            pdf.addImage(sc.toDataURL('image/jpeg',0.95), 'JPEG', M, M, imgW, sliceH);
            remaining -= sliceH; srcYmm += sliceH;
            if (remaining > 0){ pdf.addPage(); fillBg(); } else { cursorY = M + sliceH + gap; }
          }
        }
      }
    } finally {
      document.body.classList.remove('exporting');
    }
    const d = new Date();
    const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    pdf.save(`${CFG.pdfName}-${ds}.pdf`);
  } catch (e) {
    document.getElementById('errorBox').innerHTML = `<div class="error"><b>Falha ao exportar PDF:</b> ${escapeHtml(e.message)}</div>`;
  } finally {
    btn.disabled = false; btn.textContent = orig;
  }
}

document.getElementById('fuAdd').addEventListener('click', addFollowup);
document.getElementById('exportBtn').addEventListener('click', exportPDF);
injectHierControl();
renderFollowups();
document.getElementById('refreshBtn').addEventListener('click', loadAndRender);
document.getElementById('search').addEventListener('input', applyFilter);
document.getElementById('filter-status').addEventListener('change', applyFilter);
document.getElementById('filter-prio').addEventListener('change', applyFilter);
// Modo FIFO (cliente): sem coluna de prioridade → esconde o filtro de prioridade.
if (REQUESTER_FIELD) { const fp = document.getElementById('filter-prio'); if (fp) fp.style.display = 'none'; }
let _gz; window.addEventListener('resize', () => { clearTimeout(_gz); _gz = setTimeout(() => { if (RAW.length) renderGantt(); }, 150); });
loadAndRender();
} };
