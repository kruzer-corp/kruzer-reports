// src/mcp.js — Servidor MCP remoto (Streamable HTTP, stateless) hospedado no
// próprio Worker. Expõe os dashboards Kruzer como TOOLS read-only pra um cliente
// MCP (Claude Code/Desktop/ai). Auth: identidade `integration` (Bearer
// INSIGHTS_TOKEN) — o gate de worker.js já garante que a integração é read-only.
//
// Transporte: JSON-RPC 2.0 sobre POST único (initialize / tools/list / tools/call
// / ping). Stateless (sem Mcp-Session-Id), sem SSE — responde application/json.
//
// ⚠️ A lógica de negócio abaixo (resolveBucket*, assessRisks, thresholds) é
// ESPELHO das funções de front: public/shared/report.js e public/ops/index.html.
// Mantê-las em sincronia é manual até uma extração isomórfica futura. Qualquer
// mudança de regra num lado deve refletir no outro (ver HANDOFF_STATUS_CYCLES.md).

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'kruzer-dashboards', version: '1.0.0' };
const MS_DAY = 86400000;

// ─── Metadados de projeto (espelha ops/index.html + rotas) ────────────────────
const PROJECTS = [
  { key: 'FST',  label: 'FastShop',    model: 'horas',        statusVariant: 'fst',  report: '/fst/',        capacity: '/fst/capacity'  },
  { key: 'VENA', label: 'Venâncio',    model: 'story points', statusVariant: 'vena', report: '/vena/roadmap', capacity: '/vena/capacity' },
  { key: 'PMD',  label: 'Pague Menos', model: 'horas',        statusVariant: 'fst',  report: '/pgm/',        capacity: '/pgm/capacity'  },
  { key: 'DCT',  label: 'Decathlon',   model: '—',            statusVariant: 'vena', report: null,           capacity: null             },
];
const EPIC_PROJECTS = PROJECTS.map(p => p.key);
const KRZR_META = { key: 'KRZR', label: 'Service Desk (sustentação)', report: '/krzr/', insights: '/api/krzr/insights' };
const projectMeta = key => PROJECTS.find(p => p.key === key);

// ─── Buckets de status (espelha report.js) ────────────────────────────────────
const BUCKETS = [
  { id: 'hyper',      label: 'Hyper Care',            labelMatch: 'hyper-care' },
  { id: 'uat',        label: 'UAT (cliente)',         labelMatch: 'uat' },
  { id: 'execucao',   label: 'Em Execução',           labelMatch: 'em-execucao' },
  { id: 'aprovacao',  label: 'Aguardando Aprovação',  labelMatch: 'aguardando-aprovacao' },
  { id: 'estimativa', label: 'Aguardando Estimativa', labelMatch: 'aguardando-estimativa' },
  { id: 'backlog',    label: 'Backlog',               labelMatch: 'backlog' },
];
const bucketLabel = id => (BUCKETS.find(b => b.id === id) || {}).label || id;
const STATUS_FIELDS = ['summary', 'status', 'priority', 'issuetype', 'created', 'resolutiondate', 'labels', 'duedate', 'description', 'customfield_10015', 'customfield_10016', 'timeoriginalestimate', 'aggregatetimeoriginalestimate'];

function descToText(d) {
  if (!d) return '';
  if (typeof d === 'string') return d;
  let out = '';
  (function walk(node) {
    if (!node) return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node.type === 'text' && node.text) {
      const strong = (node.marks || []).some(m => m.type === 'strong');
      out += strong ? `**${node.text}**` : node.text;
    }
    if (node.type === 'hardBreak' || node.type === 'paragraph') out += '\n';
    if (node.content) walk(node.content);
  })(d);
  return out;
}
function parseField(desc, field) {
  if (!desc) return '';
  const m = desc.match(new RegExp('\\*\\*' + field + '[^:]*:\\*\\*\\s*(.+)'));
  if (!m) return '';
  const v = m[1].trim();
  return (v === '—' || v === '-') ? '' : v;
}
function statusTextToBucketVena(txt) {
  const s = (txt || '').toLowerCase();
  if (s.includes('uat') || s.includes('homolog')) return 'uat';
  if (s.includes('hyper')) return 'hyper';
  if (s.includes('done') || s.includes('conclu') || s.includes('closed') || s.includes('pronto')) return 'hyper';
  if (s.includes('aprova')) return 'aprovacao';
  if (s.includes('execu') || s.includes('progress') || s.includes('review') || s.includes('desenvolvimento') || s.includes('bloqueado') || s.includes('blocked')) return 'execucao';
  if (s.includes('estimativa') || s.includes('refinamento') || s.includes('refinement') || s.includes('grooming')) return 'estimativa';
  if (s.includes('backlog')) return 'backlog';
  return null;
}
function statusTextToBucketFst(txt) {
  const s = (txt || '').toLowerCase();
  if (s.includes('hyper')) return 'hyper';
  if (s.includes('uat') || s.includes('homolog')) return 'uat';
  if (s.includes('execu')) return 'execucao';
  if (s.includes('aprova')) return 'aprovacao';
  if (s.includes('estimativa')) return 'estimativa';
  if (s.includes('backlog')) return 'backlog';
  return null;
}
// Mapa nativo rico da variante FST — retorna null se nada casar.
function nativeToBucketFst(statusName) {
  const s = (statusName || '').toLowerCase();
  if (s.includes('uat') || s.includes('homolog')) return 'uat';
  if (s.includes('hyper') || s.includes('done') || s.includes('conclu') || s.includes('closed')) return 'hyper';
  if (s.includes('aprova')) return 'aprovacao';
  if (s.includes('estimativa') || s.includes('refin')) return 'estimativa';
  if (s.includes('progress') || s.includes('review') || s.includes('execu') || s.includes('desenvolv')) return 'execucao';
  return null;
}
// resolveBucket. Precedência: label uat/hyper-care (estados ausentes do workflow
// nativo) → STATUS NATIVO → demais labels → descrição (**Status:**) → backlog.
function semanticLabelBucket(labels) {
  if ((labels || []).includes('uat')) return 'uat';
  if ((labels || []).includes('hyper-care')) return 'hyper';
  return null;
}
function resolveBucket(f, variant) {
  const labels = f.labels || [];
  const sem = semanticLabelBucket(labels);
  if (sem) return sem;
  const statusName = (f.status && f.status.name) || '';
  const descText = descToText(f.description);
  const fromNative = variant === 'fst' ? nativeToBucketFst(statusName) : statusTextToBucketVena(statusName);
  if (fromNative) return fromNative;
  for (const b of BUCKETS) if (labels.includes(b.labelMatch)) return b.id;
  const fromDesc = (variant === 'fst' ? statusTextToBucketFst : statusTextToBucketVena)(parseField(descText, 'Status'));
  if (fromDesc) return fromDesc;
  return 'backlog';
}
// Encerrado que NÃO deve ser listado: statusCategory=Done, EXCETO Hyper Care.
function isClosedNotHyper(f) {
  const done = !!(f.status && f.status.statusCategory && f.status.statusCategory.key === 'done');
  const hyper = (f.labels || []).includes('hyper-care') || /hyper.?care/i.test((f.status && f.status.name) || '');
  return done && !hyper;
}
function priorityTier(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('highest')) return 'P0';
  if (n.includes('high')) return 'P1';
  if (n.includes('medium')) return 'P2';
  return 'P3';
}

// ─── Riscos operacionais (espelha ops/index.html) ─────────────────────────────
const TH = { LATE_CRIT_DAYS: 7, BLOCK_DAYS: 5, BLOCK_CRIT_DAYS: 10, WIP_HIGH: 3, WIP_CRIT: 4 };
const RISK_FIELDS = ['summary', 'status', 'assignee', 'duedate', 'created', 'updated', 'resolutiondate', 'customfield_10015', 'customfield_10016', 'timeoriginalestimate', 'project'];
const DECISION = {
  'ATRASO': 'Repactuar prazo com o cliente ou realocar capacity',
  'ATRASO PROJETADO': 'Rever escopo/capacity — a projeção da esteira estoura o prazo',
  'BLOQUEIO': 'Escalar a remoção do impedimento (decisão de prioridade/recurso)',
  'WIP': 'Redistribuir carga — concentrar o recurso em menos frentes',
  'SEM ESTIMATIVA': 'Exigir estimativa antes de comprometer prazo',
  'SEM DUE': 'Definir data de entrega acordada',
  'SUSTAIN': 'Estruturar o intake do Sustain',
};
function parseDate(s) { if (!s) return null; const d = new Date(s.length === 10 ? s + 'T00:00:00' : s); return isNaN(d) ? null : d; }
function isDone(name) { return /done|cancel|expired|duplicat|hyper.?care/i.test(name || ''); }
function isBlocked(name) { return /bloque|blocked|impediment/i.test(name || ''); }
function isInProgress(name, cat) {
  if (cat && /in progress|indeterminate/i.test(cat)) return true;
  return /in.?progress|doing|desenvolvendo|em desenvolvimento|execução|hands.?on|uat|homolog/i.test(name || '');
}
function normalizeEpic(issue) {
  const f = issue.fields || {};
  const proj = (f.project && f.project.key) || (issue.key || '').split('-')[0];
  const statusName = (f.status && f.status.name) || '—';
  const statusCat = (f.status && f.status.statusCategory && f.status.statusCategory.name) || '';
  const sp = f.customfield_10016;
  const sec = f.timeoriginalestimate;
  const name = (f.summary || '').replace(/^([A-Z]*\d[\w]*|P\d|Onda\s*\d|Done)\s*\|\s*/i, '').trim() || (f.summary || '');
  return {
    key: issue.key, project: proj, summary: f.summary || '', name,
    assignee: (f.assignee && f.assignee.displayName) || 'Sem responsável',
    statusName, statusCat,
    blocked: isBlocked(statusName),
    inProgress: isInProgress(statusName, statusCat),
    done: !!f.resolutiondate || isDone(statusName),
    due: parseDate(f.duedate),
    start: parseDate(f.customfield_10015),
    created: parseDate(f.created),
    updated: parseDate(f.updated),
    sp: (typeof sp === 'number') ? sp : null,
    hours: (typeof sec === 'number' && sec > 0) ? Math.round(sec / 3600) : null,
  };
}
function indexScheduleByKey(schedule, idx) {
  if (!schedule) return idx;
  (schedule.lanes || []).forEach(lane => {
    (lane.items || []).forEach(it => {
      if (it.key) idx[it.key] = { scheduledEnd: it.end ? new Date(it.end) : null, dueISO: it.dueISO ? new Date(it.dueISO) : null, late: !!it.late };
    });
  });
  return idx;
}
function assessRisks(epics, schedIdx) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const risks = [];
  epics.forEach(e => {
    if (e.done || !e.due) return;
    const diff = Math.floor((today - e.due) / MS_DAY);
    if (diff <= 0) return;
    risks.push({ type: 'ATRASO', severity: diff > TH.LATE_CRIT_DAYS ? 'crit' : 'high', project: e.project, key: e.key, name: e.name, metric: `${diff}d estourado`, sortKey: diff });
  });
  if (schedIdx) {
    epics.forEach(e => {
      if (e.done || !e.due || e.due < today) return;
      const info = schedIdx[e.key];
      if (!info || !info.scheduledEnd) return;
      const sched0 = new Date(info.scheduledEnd); sched0.setHours(0, 0, 0, 0);
      const due0 = new Date(e.due); due0.setHours(0, 0, 0, 0);
      const overshoot = Math.round((sched0 - due0) / MS_DAY);
      if (overshoot < 1) return;
      risks.push({ type: 'ATRASO PROJETADO', severity: overshoot > TH.LATE_CRIT_DAYS ? 'crit' : 'high', project: e.project, key: e.key, name: e.name, metric: `proj. +${overshoot}d além do due`, sortKey: overshoot });
    });
  }
  epics.forEach(e => {
    if (e.done || !e.blocked || !e.updated) return;
    const stale = Math.floor((today - e.updated) / MS_DAY);
    if (stale < TH.BLOCK_DAYS) return;
    risks.push({ type: 'BLOQUEIO', severity: stale >= TH.BLOCK_CRIT_DAYS ? 'crit' : 'high', project: e.project, key: e.key, name: e.name, metric: `${stale}d sem update`, sortKey: stale });
  });
  const byAssignee = {};
  epics.forEach(e => { if (e.done || !e.inProgress || e.assignee === 'Sem responsável') return; (byAssignee[e.assignee] = byAssignee[e.assignee] || []).push(e); });
  Object.entries(byAssignee).forEach(([assignee, arr]) => {
    if (arr.length < TH.WIP_HIGH) return;
    const projs = [...new Set(arr.map(e => e.project))];
    risks.push({ type: 'WIP', severity: arr.length >= TH.WIP_CRIT ? 'crit' : 'high', project: projs[0], key: assignee, name: assignee, metric: `${arr.length} épicos · ${projs.join('·')}`, sortKey: arr.length });
  });
  const noEstVena = epics.filter(e => !e.done && e.project === 'VENA' && e.sp == null && e.inProgress);
  if (noEstVena.length) risks.push({ type: 'SEM ESTIMATIVA', severity: 'info', project: 'VENA', key: '', name: `${noEstVena.length} épico(s) em andamento sem SP`, metric: noEstVena.slice(0, 3).map(e => e.key).join(', ') + (noEstVena.length > 3 ? '…' : ''), sortKey: noEstVena.length });
  const noEstFst = epics.filter(e => !e.done && e.project === 'FST' && e.hours == null && e.inProgress);
  if (noEstFst.length) risks.push({ type: 'SEM ESTIMATIVA', severity: 'info', project: 'FST', key: '', name: `${noEstFst.length} épico(s) em andamento sem horas`, metric: noEstFst.slice(0, 3).map(e => e.key).join(', ') + (noEstFst.length > 3 ? '…' : ''), sortKey: noEstFst.length });
  EPIC_PROJECTS.forEach(p => {
    const noDue = epics.filter(e => !e.done && e.project === p && e.inProgress && !e.due);
    if (!noDue.length) return;
    risks.push({ type: 'SEM DUE', severity: 'info', project: p, key: '', name: `${noDue.length} épico(s) em andamento sem due`, metric: noDue.slice(0, 3).map(e => e.key).join(', ') + (noDue.length > 3 ? '…' : ''), sortKey: noDue.length });
  });
  risks.push({ type: 'SUSTAIN', severity: 'info', project: 'FST', key: '', name: 'Sustain ainda é caixa-preta', metric: 'sem intake estruturado · risco operacional', sortKey: 0 });
  const sevOrder = { crit: 0, high: 1, info: 2 };
  risks.sort((a, b) => (sevOrder[a.severity] - sevOrder[b.severity]) || (b.sortKey - a.sortKey));
  return risks;
}

// ─── Tools ─────────────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'list_projects',
    description: 'Lista os projetos/clientes rastreados nos dashboards Kruzer (FST, VENA, DCT, PMD) e o Service Desk KRZR, com o modelo de estimativa (horas vs story points) e as rotas de report/capacity. Use como discovery antes das outras tools.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async run() {
      return { projects: PROJECTS, serviceDesk: KRZR_META };
    },
  },
  {
    name: 'get_service_desk_insights',
    description: 'Saúde do Kruzer Service Desk (KRZR): fila aberta, breaches de SLA (Highest>1d, High>3d), aging, distribuição por status/prioridade e lista de tickets abertos. Agregado read-only pronto pra análise.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async run(_args, env, deps) {
      return await deps.krzrInsightsData(env);
    },
  },
  {
    name: 'get_project_status',
    description: 'Épicos de um projeto-cliente com o STATUS derivado (bucket: backlog → estimativa → aprovação → execução → UAT → hyper care), prioridade (P0-P3), start/due, se está committed e se está atrasado (due < hoje). Espelha o Status Report do dashboard.',
    inputSchema: {
      type: 'object',
      properties: { project: { type: 'string', enum: EPIC_PROJECTS, description: 'FST, VENA, DCT ou PMD' } },
      required: ['project'], additionalProperties: false,
    },
    async run(args, env, deps) {
      const project = String(args.project || '').toUpperCase();
      const meta = projectMeta(project);
      if (!meta) throw new Error(`Projeto inválido: "${args.project}". Use FST, VENA, DCT ou PMD.`);
      const jql = `project = ${project} AND issuetype = Epic ORDER BY created DESC`;
      const issues = await deps.jiraSearchAll(env, jql, STATUS_FIELDS, 100, 6);
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const counts = {}; BUCKETS.forEach(b => counts[b.id] = 0);
      // Encerrados (Done/Resolved/Canceled…) fora da listagem; Hyper Care permanece.
      const epics = issues.filter(it => !isClosedNotHyper(it.fields || {})).map(it => {
        const f = it.fields || {};
        const bucket = resolveBucket(f, meta.statusVariant);
        counts[bucket] = (counts[bucket] || 0) + 1;
        const due = parseDate(f.duedate);
        const done = !!(f.status && f.status.statusCategory && f.status.statusCategory.key === 'done');
        const start = f.customfield_10015 || null;
        return {
          key: it.key, summary: f.summary || '',
          bucket, bucketLabel: bucketLabel(bucket),
          statusNative: (f.status && f.status.name) || null,
          priority: priorityTier(f.priority && f.priority.name),
          startDate: start, dueDate: f.duedate || null,
          done, committed: !!start || bucket === 'execucao',
          overdue: !!(due && !done && due < today),
        };
      });
      return { project, label: meta.label, model: meta.model, statusVariant: meta.statusVariant, generatedAt: new Date().toISOString(), total: epics.length, countsByBucket: counts, epics };
    },
  },
  {
    name: 'search_jira',
    description: 'Busca JQL crua e READ-ONLY no JIRA (proxy autenticado). Use pra perguntas fora do padrão dos dashboards. Retorna as issues com os campos pedidos. Não escreve nada.',
    inputSchema: {
      type: 'object',
      properties: {
        jql: { type: 'string', description: 'Expressão JQL, ex.: "project = FST AND status = Done ORDER BY updated DESC"' },
        fields: { type: 'array', items: { type: 'string' }, description: 'Campos do JIRA a retornar (default: summary,status,priority,issuetype,assignee,duedate,created,project)' },
        maxResults: { type: 'integer', minimum: 1, maximum: 100, description: 'Máximo de issues retornadas (default 50, teto 100 — página única)' },
      },
      required: ['jql'], additionalProperties: false,
    },
    async run(args, env, deps) {
      const jql = String(args.jql || '').trim();
      if (!jql) throw new Error('Parâmetro "jql" é obrigatório.');
      const fields = (Array.isArray(args.fields) && args.fields.length) ? args.fields : ['summary', 'status', 'priority', 'issuetype', 'assignee', 'duedate', 'created', 'project'];
      const pageSize = Math.min(Math.max(parseInt(args.maxResults || 50, 10) || 50, 1), 100);
      const issues = await deps.jiraSearchAll(env, jql, fields, pageSize, 1);
      return { jql, total: issues.length, issues: issues.map(i => ({ key: i.key, fields: i.fields })) };
    },
  },
  {
    name: 'get_published_schedule',
    description: 'Cronograma de capacity PUBLICADO de um projeto (lanes/recursos × épicos com datas projetadas), lido do estado compartilhado (D1). É o que a timeline do report espelha. Retorna null se nada foi publicado.',
    inputSchema: {
      type: 'object',
      properties: { project: { type: 'string', enum: ['FST', 'VENA', 'PMD'], description: 'FST, VENA ou PMD (DCT não tem capacity planner)' } },
      required: ['project'], additionalProperties: false,
    },
    async run(args, env, deps) {
      const project = String(args.project || '').toUpperCase();
      const meta = projectMeta(project);
      if (!meta) throw new Error(`Projeto inválido: "${args.project}".`);
      if (!meta.capacity) return { project, schedule: null, note: `${project} não tem capacity planner.` };
      const scope = `${project.toLowerCase()}-capacity`;
      const value = await deps.stateRead(env, scope, 'schedule');
      if (!value || value.v !== 1 || !Array.isArray(value.lanes)) return { project, scope, schedule: null, note: 'Nenhum schedule publicado.' };
      return { project, scope, publishedSchedule: value };
    },
  },
  {
    name: 'get_operational_risks',
    description: 'Riscos operacionais consolidados (o motor do cockpit executivo): ATRASO (due passado), ATRASO PROJETADO (esteira publicada estoura o due), BLOQUEIO (parado ≥5d), WIP (recurso com ≥3 épicos), SEM ESTIMATIVA, SEM DUE, SUSTAIN. Cada risco vem com a decisão executiva sugerida. Opcionalmente filtra por projeto.',
    inputSchema: {
      type: 'object',
      properties: { project: { type: 'string', enum: EPIC_PROJECTS, description: 'Opcional: filtra os riscos de um projeto (FST/VENA/DCT/PMD)' } },
      additionalProperties: false,
    },
    async run(args, env, deps) {
      const filter = args.project ? String(args.project).toUpperCase() : null;
      if (filter && !EPIC_PROJECTS.includes(filter)) throw new Error(`Projeto inválido: "${args.project}".`);
      const projects = filter ? [filter] : EPIC_PROJECTS;
      const jql = `project IN (${projects.join(',')}) AND issuetype = Epic ORDER BY created DESC`;
      const issues = await deps.jiraSearchAll(env, jql, RISK_FIELDS, 100, 8);
      const epics = issues.map(normalizeEpic);
      const schedIdx = {};
      for (const p of projects) {
        const meta = projectMeta(p);
        if (!meta || !meta.capacity) continue;
        const sched = await deps.stateRead(env, `${p.toLowerCase()}-capacity`, 'schedule');
        if (sched && sched.v === 1 && Array.isArray(sched.lanes)) indexScheduleByKey(sched, schedIdx);
      }
      let risks = assessRisks(epics, schedIdx);
      if (filter) risks = risks.filter(r => r.project === filter);
      risks = risks.map(r => ({ type: r.type, severity: r.severity, project: r.project, key: r.key || null, name: r.name, metric: r.metric, decision: DECISION[r.type] || null }));
      return { scope: filter || 'ALL', generatedAt: new Date().toISOString(), total: risks.length, risks };
    },
  },
];

// ─── Protocolo JSON-RPC 2.0 / Streamable HTTP ─────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, Accept',
  'Access-Control-Max-Age': '86400',
};
function withCors(res) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) h.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}
function rpcResult(id, result) { return { jsonrpc: '2.0', id, result }; }
function rpcError(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } }; }
function jsonResponse(body, status = 200) {
  return withCors(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

async function dispatch(method, params, id, env, deps) {
  switch (method) {
    case 'initialize':
      return rpcResult(id, {
        protocolVersion: (params && params.protocolVersion) || PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      });
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, { tools: TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
    case 'tools/call': {
      const name = params && params.name;
      const tool = TOOLS.find(t => t.name === name);
      if (!tool) return rpcError(id, -32602, `Tool desconhecida: ${name}`);
      try {
        const data = await tool.run((params && params.arguments) || {}, env, deps);
        return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
      } catch (e) {
        return rpcResult(id, { content: [{ type: 'text', text: `Erro na tool "${name}": ${e.message}` }], isError: true });
      }
    }
    default:
      return rpcError(id, -32601, `Método não encontrado: ${method}`);
  }
}

export async function handleMcp(request, env, deps) {
  if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }));
  if (request.method !== 'POST') {
    return withCors(new Response('MCP endpoint: use POST (JSON-RPC 2.0, Streamable HTTP).', { status: 405 }));
  }
  let payload;
  try { payload = await request.json(); }
  catch { return jsonResponse(rpcError(null, -32700, 'Parse error'), 200); }

  const one = async (msg) => {
    if (!msg || typeof msg !== 'object') return rpcError(null, -32600, 'Invalid Request');
    const isNotification = !('id' in msg);
    const id = msg.id != null ? msg.id : null;
    const out = await dispatch(msg.method, msg.params, id, env, deps);
    return isNotification ? null : out; // notificações (ex.: notifications/initialized) não respondem
  };

  if (Array.isArray(payload)) {
    const results = [];
    for (const m of payload) { const r = await one(m); if (r) results.push(r); }
    return results.length ? jsonResponse(results) : withCors(new Response(null, { status: 202 }));
  }
  const r = await one(payload);
  return r ? jsonResponse(r) : withCors(new Response(null, { status: 202 }));
}
