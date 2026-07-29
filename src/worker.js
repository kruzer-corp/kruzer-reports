// Cloudflare Worker — Kruzer Dashboards
// Responsabilidades:
//  1. Auth com DUAS identidades:
//     · 'admin'       → Basic Auth (DASHBOARD_USER/PASSWORD): acesso total (humanos + escrita).
//     · 'integration' → token de integração (INSIGHTS_TOKEN) via header `Authorization: Bearer`
//                       ou query `?token=`: SOMENTE LEITURA, em TODOS os dashboards. Pode ler
//                       páginas, consultar JIRA (proxy /api/jira/jql) e ler estado (/api/state
//                       GET) + /api/krzr/insights. NÃO pode escrever: comentar/editar no JIRA
//                       nem gravar/apagar estado. Pensado pra integrações externas (ex.: o
//                       Claude do gestor) lerem os dados sem poder mutar nada.
//  2. Proxy autenticado pra Atlassian Cloud REST API (rota /api/jira/jql).
//  3. /api/krzr/insights — JSON agregado do Service Desk, pronto pra LLM (read-only).
//  4. /mcp — servidor MCP remoto (Streamable HTTP) que expõe os dashboards como
//            tools read-only pra um cliente MCP (Claude etc.). Ver src/mcp.js.
//  5. Serve arquivos estáticos do public/ (binding ASSETS).
//
// Secrets esperadas (via `wrangler secret put`):
//   JIRA_EMAIL, JIRA_API_TOKEN, JIRA_CLOUD_ID,
//   DASHBOARD_USER, DASHBOARD_PASSWORD,
//   INSIGHTS_TOKEN  (opcional — habilita a identidade de integração read-only + o MCP)

import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
import { handleMcp } from './mcp.js';
import { handleAuthorize } from './oauth.js';

const REALM = 'Kruzer Dashboards';

// Deps de dados do MCP (reusa as funções read-only do worker).
const mcpDeps = () => ({ jiraSearchAll, krzrInsightsData, stateRead: stateReadValue });

// ─── Entry point: OAuthProvider por cima do app ───────────────────────────────
// /mcp aceita, nesta ordem: Basic Auth (admin) / INSIGHTS_TOKEN (integration) —
// caminho estático do Claude Code + integrações programáticas — OU, se nenhum,
// cai no OAuth (token do fluxo web/Desktop, validado pela lib). Páginas, /api e a
// tela /authorize passam pelo defaultHandler; a lib serve /token, /register e os
// metadados .well-known.
const mcpApiHandler = {
  // Chamado pela lib SÓ quando há token OAuth válido (ctx.props = {email,name}).
  async fetch(request, env, ctx) {
    return handleMcp(request, env, mcpDeps());
  },
};
const defaultHandler = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/authorize') return handleAuthorize(request, env);
    return handleApp(request, env, ctx);
  },
};
const oauthProvider = new OAuthProvider({
  apiRoute: '/mcp',
  apiHandler: mcpApiHandler,
  defaultHandler,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
  scopesSupported: ['read'],
});

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // /mcp: preflight livre + caminho estático (Basic/INSIGHTS_TOKEN) antes do OAuth.
    if (url.pathname === '/mcp') {
      if (request.method === 'OPTIONS') return handleMcp(request, env, null);
      const id = authIdentity(request, env);
      if (id === 'admin' || id === 'integration') return handleMcp(request, env, mcpDeps());
      // sem credencial estática → deixa o OAuthProvider validar o token OU responder
      // 401 com o discovery (WWW-Authenticate) que o claude.ai usa pra iniciar o fluxo.
    }
    return oauthProvider.fetch(request, env, ctx);
  },
};

// ─── App: páginas + /api + assets (o antigo fetch, agora sob o defaultHandler) ──
async function handleApp(request, env, ctx) {
    const url = new URL(request.url);

    // 1. Auth gate (aplica em tudo, inclusive estáticos — protege a URL inteira).
    //    Sem credencial válida (Basic Auth OU token de integração) → 401.
    const identity = authIdentity(request, env);
    if (!identity) {
      return new Response('Authentication required', {
        status: 401,
        headers: {
          'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"`,
          'Content-Type': 'text/plain; charset=utf-8',
        },
      });
    }
    // Token de integração é READ-ONLY: lê qualquer dashboard, mas bloqueia toda
    // escrita (JIRA comment/issue-update, state PUT/DELETE). Admin não tem restrição.
    if (identity === 'integration' && !integrationAllowed(url, request.method)) {
      return jsonError(403, 'Token de integração: somente leitura. Escrita (comentar/editar no JIRA, gravar estado) exige Basic Auth.');
    }

    // 1b. Service Desk insights — JSON agregado pronto pra LLM (read-only).
    if (url.pathname === '/api/krzr/insights') {
      if (request.method !== 'GET') return jsonError(405, 'Use GET');
      return handleKrzrInsights(env);
    }

    // 2. API proxy
    if (url.pathname === '/api/jira/jql') {
      if (request.method !== 'POST') {
        return jsonError(405, 'Use POST');
      }
      return handleJqlProxy(request, env);
    }

    // 2a-bis. Worklogs agregados por recurso × dia × task (view /tempo). Read-only.
    if (url.pathname === '/api/jira/worklogs') {
      if (request.method !== 'POST') return jsonError(405, 'Use POST');
      return handleWorklogs(request, env);
    }

    // 2a-ter. Roster = usuários atribuíveis do JIRA nos projetos (?projects=FST,VENA).
    // Read-only; permite listar no filtro quem ainda não pegou épico algum.
    if (url.pathname === '/api/jira/roster') {
      if (request.method !== 'GET') return jsonError(405, 'Use GET');
      return handleRoster(request, env, url);
    }

    // 2a-quater. Projetos/espaços do JIRA (universo do filtro de projeto). Read-only.
    if (url.pathname === '/api/jira/projects') {
      if (request.method !== 'GET') return jsonError(405, 'Use GET');
      return handleProjects(env);
    }

    // 2b. Escrita no JIRA — comentário no épico
    if (url.pathname === '/api/jira/comment') {
      if (request.method !== 'POST') return jsonError(405, 'Use POST');
      return handleAddComment(request, env);
    }

    // 2c. Escrita no JIRA — update de campos do épico (whitelist: duedate)
    if (url.pathname === '/api/jira/issue-update') {
      if (request.method !== 'POST') return jsonError(405, 'Use POST');
      return handleUpdateIssue(request, env);
    }

    // 2d. Estado compartilhado (D1) — Camada 1 do roadmap "controle de operação".
    // Substitui localStorage por-navegador como fonte de verdade pra remarks,
    // followups, cenários de capacity, schedule publicado e config de risco.
    if (url.pathname.startsWith('/api/state/')) {
      return handleStateRoute(request, env, url);
    }
    if (url.pathname === '/api/audit') {
      if (request.method !== 'GET') return jsonError(405, 'Use GET');
      return handleAuditList(request, env, url);
    }

    // 3. Healthcheck simples
    if (url.pathname === '/api/health') {
      return new Response(JSON.stringify({ ok: true, ts: new Date().toISOString() }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 4. Static assets
    //
    // IMPORTANTE: força `no-store` na resposta dos assets. O binding ASSETS serve
    // HTML com `Cache-Control: public, max-age=0, must-revalidate`, o que faz a edge
    // da Cloudflare cachear a página e servir uma cópia PÚBLICA em requests sem
    // Basic Auth — contornando o gate de auth acima (cf-cache-status: HIT → 200 sem
    // credenciais). Setando `private, no-store` a edge não cacheia o HTML, então todo
    // request passa de novo pelo worker e o gate de auth sempre vale.
    // O proxy /api/jira/jql não passa por aqui e mantém seu cache de 15min próprio.
    if (env.ASSETS) {
      const res = await env.ASSETS.fetch(request);
      const headers = new Headers(res.headers);
      headers.set('Cache-Control', 'private, no-store');
      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers,
      });
    }
    return jsonError(500, 'ASSETS binding not configured');
}

// ---------------------------------------------------------------------------
function checkBasicAuth(request, env) {
  const header = request.headers.get('Authorization');
  if (!header || !header.startsWith('Basic ')) return false;
  let decoded;
  try {
    decoded = atob(header.slice(6));
  } catch {
    return false;
  }
  const sep = decoded.indexOf(':');
  if (sep < 0) return false;
  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);
  return (
    safeEqual(user, env.DASHBOARD_USER || '') &&
    safeEqual(pass, env.DASHBOARD_PASSWORD || '')
  );
}

// Constant-time string compare pra evitar timing attacks (paranoia leve)
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// Identidade da request: 'admin' (Basic Auth) | 'integration' (token) | null.
function authIdentity(request, env) {
  if (checkBasicAuth(request, env)) return 'admin';
  if (env.INSIGHTS_TOKEN) {
    const token = bearerToken(request) || new URL(request.url).searchParams.get('token');
    if (token && safeEqual(token, env.INSIGHTS_TOKEN)) return 'integration';
  }
  return null;
}

function bearerToken(request) {
  const h = request.headers.get('Authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
}

// Allow-list da identidade de integração: READ-ONLY em toda a aplicação.
// Libera leitura (qualquer GET + o proxy /api/jira/jql, que é POST mas só
// consulta); bloqueia toda escrita (comentar/editar no JIRA, gravar/apagar estado).
function integrationAllowed(url, method) {
  const p = url.pathname;
  if (p === '/api/jira/comment' || p === '/api/jira/issue-update') return false; // escrita JIRA
  if (p.startsWith('/api/state/')) return method === 'GET';                       // lê estado; PUT/DELETE bloqueado
  if (p === '/api/jira/jql') return method === 'POST';                            // proxy de leitura (search)
  if (p === '/api/jira/worklogs') return method === 'POST';                       // agregação de worklog (leitura)
  if (p === '/mcp') return true;                                                  // MCP: só expõe tools read-only
  return method === 'GET';                                                        // páginas, insights, health, audit
}

// ---------------------------------------------------------------------------
// Busca paginada no JIRA (server-side, read-only) — reusa as credenciais do proxy.
async function jiraSearchAll(env, jql, fields, pageSize = 100, maxPages = 6) {
  const auth = btoa(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`);
  const apiUrl = `https://api.atlassian.com/ex/jira/${env.JIRA_CLOUD_ID}/rest/api/3/search/jql`;
  let token, pages = 0;
  const out = [];
  do {
    const body = { jql, maxResults: pageSize, fields };
    if (token) body.nextPageToken = token;
    const r = await fetch(apiUrl, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`JIRA ${r.status}`);
    const data = await r.json();
    (data.issues || []).forEach(i => out.push(i));
    token = data.nextPageToken;
    pages++;
  } while (token && pages < maxPages);
  return out;
}

// Service Desk insights — agrega o KRZR num JSON pronto pra um LLM raciocinar.
// Read-only: só lê do JIRA. Thresholds de SLA alinhados ao cockpit (/ops/).
async function handleKrzrInsights(env) {
  try {
    return jsonOk(await krzrInsightsData(env));
  } catch (e) {
    return jsonError(502, `JIRA fetch failed: ${e.message}`);
  }
}

// Dados agregados do KRZR (sem embrulho HTTP) — reusado pelo handler e pelo MCP.
// Lança em erro de fetch (quem chama trata).
async function krzrInsightsData(env) {
  const MS_DAY = 86400000;
  const now = Date.now();
  // statusCategory != Done captura a fila REALMENTE aberta. (KRZR não mantém o
  // campo resolution, então "resolution is EMPTY" inclui Expired/Done/Canceled.)
  const open = await jiraSearchAll(env,
    'project = KRZR AND statusCategory != Done ORDER BY priority DESC, created DESC',
    ['summary', 'status', 'priority', 'created', 'updated', 'assignee']);
  const resolved = await jiraSearchAll(env,
    'project = KRZR AND resolutiondate >= -30d',
    ['resolutiondate'], 100, 3);

  const tickets = open.map(it => {
    const f = it.fields || {};
    const created = f.created ? new Date(f.created) : null;
    const ageDays = created ? Math.floor((now - created.getTime()) / MS_DAY) : null;
    return {
      key: it.key,
      summary: f.summary || '',
      status: f.status?.name || '—',
      statusCategory: f.status?.statusCategory?.name || '',
      priority: f.priority?.name || '—',
      assignee: f.assignee?.displayName || null,
      created: f.created || null,
      updated: f.updated || null,
      ageDays,
    };
  });

  const byStatus = {}, byPriority = {};
  tickets.forEach(t => {
    byStatus[t.status] = (byStatus[t.status] || 0) + 1;
    byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;
  });
  const isHighest = p => /(highest|critical|p0)/i.test(p);
  const isHigh = p => /(^high$|\bhigh\b|p1)/i.test(p);
  const slaBreaches = tickets.filter(t => t.ageDays != null && (
    (isHighest(t.priority) && t.ageDays > 1) ||
    (isHigh(t.priority) && t.ageDays > 3)
  ));
  const aging = {
    gt7:  tickets.filter(t => t.ageDays > 7).length,
    gt14: tickets.filter(t => t.ageDays > 14).length,
    gt30: tickets.filter(t => t.ageDays > 30).length,
  };
  const oldest = tickets.reduce((m, t) => (t.ageDays || 0) > (m?.ageDays || 0) ? t : m, null);

  return {
    project: 'KRZR',
    description: 'Kruzer Service Desk — fila aberta + agregados. SLA: Highest>1d, High>3d.',
    generatedAt: new Date().toISOString(),
    totals: {
      open: tickets.length,
      resolvedLast30d: resolved.length,
      slaBreaches: slaBreaches.length,
      agingGt7: aging.gt7,
      oldestOpenDays: oldest ? oldest.ageDays : 0,
    },
    byStatus,
    byPriority,
    aging,
    slaBreaches: slaBreaches.map(t => ({ key: t.key, priority: t.priority, ageDays: t.ageDays, summary: t.summary })),
    tickets,
  };
}

// D1: lê um valor de estado (parsed) — reusado pelo MCP (schedule publicado etc.).
// Retorna null se não existir ou sem binding. Read-only.
async function stateReadValue(env, scope, key) {
  if (!env.STATE_DB) return null;
  try {
    const row = await env.STATE_DB
      .prepare('SELECT value FROM state WHERE scope = ? AND key = ?')
      .bind(scope, key)
      .first();
    if (!row) return null;
    try { return JSON.parse(row.value); } catch { return null; }
  } catch { return null; }
}

// ---------------------------------------------------------------------------
async function handleJqlProxy(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'Invalid JSON body');
  }
  const { jql, fields, maxResults = 100, nextPageToken, expand } = body || {};
  if (!jql || typeof jql !== 'string') {
    return jsonError(400, 'Missing required field "jql"');
  }

  const upstreamBody = {
    jql,
    maxResults: clamp(maxResults, 1, 100),
  };
  if (Array.isArray(fields) && fields.length) upstreamBody.fields = fields;
  if (nextPageToken) upstreamBody.nextPageToken = nextPageToken;
  if (expand) {
    const exp = Array.isArray(expand) ? expand.join(',') : String(expand);
    if (exp) upstreamBody.expand = exp;
  }

  const auth = btoa(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`);
  const apiUrl = `https://api.atlassian.com/ex/jira/${env.JIRA_CLOUD_ID}/rest/api/3/search/jql`;

  let upstream;
  try {
    upstream = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(upstreamBody),
    });
  } catch (e) {
    return jsonError(502, `Upstream fetch failed: ${e.message}`);
  }

  const text = await upstream.text();

  // Cache for 15 minutes via Cloudflare cache (skip pagination results)
  const cacheControl = !nextPageToken ? 'public, max-age=900' : 'no-store';

  return new Response(text, {
    status: upstream.status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': cacheControl,
    },
  });
}

// ---------------------------------------------------------------------------
// Worklogs agregados p/ a view /tempo — "quem lançou quanto, em qual task, em
// qual dia". Espelha a Time-view do JIRA. Read-only, server-side.
//
// Escopo: os projetos integrados no Cockpit (/ops/). Fonte: worklog NATIVO do
// JIRA (campo `worklog`). O `started` volta no fuso do usuário do token (SP),
// então o bucket do dia é o prefixo YYYY-MM-DD do próprio `started`.
//
// Retorno:
//   { from, to, projects, days:[...], generatedAt, truncated, roster: <n>,
//     people: [ { accountId, displayName, avatarUrl, active, totalSeconds,
//                 byDay:{ 'YYYY-MM-DD': secs }, hasWorklog,
//                 issues: [ { key, summary, projectKey, issuetype,
//                             totalSeconds, byDay } ] } ] }
const COCKPIT_PROJECTS = ['FST', 'VENA', 'DCT', 'PMD', 'KRZR'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// Contas de sistema/admin que não representam recurso do time — fora da view.
const EXCLUDED_WORKLOG_NAMES = new Set(['admin kruzer']);

async function handleWorklogs(request, env) {
  let body;
  try { body = await request.json(); } catch { return jsonError(400, 'Invalid JSON body'); }
  const from = String(body?.from || '');
  const to = String(body?.to || '');
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) return jsonError(400, 'from/to devem ser YYYY-MM-DD');
  if (from > to) return jsonError(400, 'from deve ser <= to');

  const projects = Array.isArray(body?.projects) && body.projects.length
    ? body.projects.map(p => String(p).replace(/[^A-Z0-9_]/gi, '')).filter(Boolean)
    : COCKPIT_PROJECTS;

  // Limite de dias (evita janelas absurdas + varreduras caras).
  const days = enumerateDays(from, to);
  if (days.length > 400) return jsonError(400, 'Janela muito longa (máx. 400 dias)');

  // Bounds em epoch-ms no fuso de SP, p/ o fetch por-issue (startedAfter/Before).
  const afterMs = Date.parse(`${from}T00:00:00.000-03:00`);
  const beforeMs = Date.parse(`${to}T23:59:59.999-03:00`);

  try {
    // Chaves entre aspas: algumas (ex.: "IN") são palavras reservadas do JQL.
    const jql = `project in (${projects.map(p => `"${p}"`).join(',')}) AND worklogDate >= "${from}" AND worklogDate <= "${to}"`;
    const issues = await jiraSearchAll(env, jql,
      ['summary', 'issuetype', 'project', 'worklog'], 100, 10);

    // people[accountId] = { …, byDay, issues: Map<key, {…, byDay}> }
    const people = new Map();
    let truncated = 0;
    let perIssueFetches = 0;
    const MAX_PER_ISSUE_FETCHES = 300; // teto de segurança (subrequests)

    for (const it of issues) {
      const f = it.fields || {};
      const wl = f.worklog || {};
      let entries = wl.worklogs || [];
      // Truncado (>20 na search): busca a janela exata direto no endpoint da issue.
      if ((wl.total || 0) > entries.length) {
        if (perIssueFetches < MAX_PER_ISSUE_FETCHES) {
          perIssueFetches++;
          entries = await fetchIssueWorklogs(env, it.id, afterMs, beforeMs);
        } else {
          truncated++;
        }
      }
      const projectKey = f.project?.key || (it.key || '').split('-')[0];
      const issuetype = f.issuetype?.name || '—';
      const summary = f.summary || '';

      for (const w of entries) {
        const day = String(w.started || '').slice(0, 10);
        if (!ISO_DATE.test(day) || day < from || day > to) continue;
        const secs = w.timeSpentSeconds || 0;
        if (!secs) continue;
        const a = w.author || {};
        const id = a.accountId || a.displayName || 'unknown';
        let person = people.get(id);
        if (!person) {
          person = {
            accountId: id,
            displayName: a.displayName || 'Sem autor',
            avatarUrl: a.avatarUrls?.['24x24'] || a.avatarUrls?.['48x48'] || null,
            active: a.active !== false,
            totalSeconds: 0,
            byDay: {},
            issues: new Map(),
          };
          people.set(id, person);
        }
        person.totalSeconds += secs;
        person.byDay[day] = (person.byDay[day] || 0) + secs;
        let iss = person.issues.get(it.key);
        if (!iss) {
          iss = { key: it.key, summary, projectKey, issuetype, totalSeconds: 0, byDay: {} };
          person.issues.set(it.key, iss);
        }
        iss.totalSeconds += secs;
        iss.byDay[day] = (iss.byDay[day] || 0) + secs;
      }
    }

    // Roster: garante que todo membro do time apareça, mesmo sem horas.
    const roster = await fetchRoster(env, projects);
    for (const u of roster) {
      if (!people.has(u.accountId)) {
        people.set(u.accountId, {
          accountId: u.accountId,
          displayName: u.displayName,
          avatarUrl: u.avatarUrl,
          active: u.active,
          totalSeconds: 0,
          byDay: {},
          issues: new Map(),
        });
      }
    }

    // Serializa + ordena: quem tem horas primeiro (desc), depois alfabético.
    const peopleOut = [...people.values()]
      .filter(p => !EXCLUDED_WORKLOG_NAMES.has((p.displayName || '').trim().toLowerCase()))
      .map(p => ({
      accountId: p.accountId,
      displayName: p.displayName,
      avatarUrl: p.avatarUrl,
      active: p.active,
      totalSeconds: p.totalSeconds,
      hasWorklog: p.totalSeconds > 0,
      byDay: p.byDay,
      issues: [...p.issues.values()].sort((a, b) => b.totalSeconds - a.totalSeconds),
    })).sort((a, b) =>
      (b.totalSeconds - a.totalSeconds) ||
      a.displayName.localeCompare(b.displayName, 'pt-BR'));

    return jsonOk({
      from, to, projects, days,
      generatedAt: new Date().toISOString(),
      roster: roster.length,
      truncated,
      people: peopleOut,
    });
  } catch (e) {
    return jsonError(502, `JIRA worklogs failed: ${e.message}`);
  }
}

// Enumera datas YYYY-MM-DD de `from` a `to` (inclusive), via UTC (só usamos a data).
function enumerateDays(from, to) {
  const out = [];
  let cur = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  while (cur <= end) {
    out.push(new Date(cur).toISOString().slice(0, 10));
    cur += 86400000;
  }
  return out;
}

// Busca TODOS os worklogs de uma issue dentro da janela (paginado). Usado só
// quando a search truncou (issue com >20 worklogs no total).
async function fetchIssueWorklogs(env, issueId, afterMs, beforeMs) {
  const auth = btoa(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`);
  const base = `https://api.atlassian.com/ex/jira/${env.JIRA_CLOUD_ID}/rest/api/3/issue/${issueId}/worklog`;
  const out = [];
  let startAt = 0;
  const pageSize = 1000;
  for (let page = 0; page < 20; page++) {
    const u = `${base}?startedAfter=${afterMs}&startedBefore=${beforeMs}&startAt=${startAt}&maxResults=${pageSize}`;
    const r = await fetch(u, {
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
    });
    if (!r.ok) throw new Error(`JIRA worklog ${r.status}`);
    const data = await r.json();
    (data.worklogs || []).forEach(w => out.push(w));
    startAt += pageSize;
    if (startAt >= (data.total || 0)) break;
  }
  return out;
}

// Lista os projetos/espaços do JIRA (universo do filtro). Read-only, paginado.
async function handleProjects(env) {
  const auth = btoa(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`);
  const out = [];
  let startAt = 0;
  try {
    for (let page = 0; page < 10; page++) {
      const u = `https://api.atlassian.com/ex/jira/${env.JIRA_CLOUD_ID}/rest/api/3/project/search?maxResults=50&startAt=${startAt}&status=live&orderBy=key`;
      const r = await fetch(u, { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } });
      if (!r.ok) break;
      const data = await r.json();
      (data.values || []).forEach(p => out.push({ key: p.key, name: p.name, type: p.projectTypeKey || null }));
      if (data.isLast || !(data.values || []).length) break;
      startAt += 50;
    }
    return new Response(JSON.stringify({ projects: out }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return jsonError(502, `projects fetch failed: ${e.message}`);
  }
}

// Rota pública (GET) do roster: ?projects=FST,VENA,DCT,PMD (default = os 4).
async function handleRoster(request, env, url) {
  const raw = (url.searchParams.get('projects') || 'FST,VENA,DCT,PMD').split(',').map(s => s.trim()).filter(Boolean);
  const allow = new Set(['FST', 'VENA', 'DCT', 'PMD', 'KRZR']);
  const projects = raw.filter(p => allow.has(p));
  if (!projects.length) return jsonError(400, 'Missing valid "projects"');
  try {
    const users = await fetchRoster(env, projects);
    return new Response(JSON.stringify({ users }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return jsonError(502, `roster fetch failed: ${e.message}`);
  }
}

// Roster do time = usuários atribuíveis (accountType 'atlassian') nos projetos.
// União entre projetos, sem bots (accountType 'app'). Falha graciosa por projeto.
async function fetchRoster(env, projects) {
  const auth = btoa(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`);
  const seen = new Map();
  for (const p of projects) {
    try {
      const u = `https://api.atlassian.com/ex/jira/${env.JIRA_CLOUD_ID}/rest/api/3/user/assignable/search?project=${encodeURIComponent(p)}&maxResults=200`;
      const r = await fetch(u, { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } });
      if (!r.ok) continue;
      const users = await r.json();
      for (const x of users) {
        if (x.accountType && x.accountType !== 'atlassian') continue; // dropa bots/customers
        if (!x.accountId || seen.has(x.accountId)) continue;
        seen.set(x.accountId, {
          accountId: x.accountId,
          displayName: x.displayName || x.accountId,
          avatarUrl: x.avatarUrls?.['24x24'] || x.avatarUrls?.['48x48'] || null,
          active: x.active !== false,
        });
      }
    } catch { /* projeto sem permissão / erro → ignora */ }
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------------------
// Escrita no JIRA. Reaproveita o Basic Auth (JIRA_EMAIL/TOKEN) — o token tem
// permissão de comentar e editar. Os dashboards viram ferramenta de gestão.
async function handleAddComment(request, env) {
  let body;
  try { body = await request.json(); } catch { return jsonError(400, 'Invalid JSON body'); }
  const { key, text } = body || {};
  if (!key || typeof key !== 'string') return jsonError(400, 'Missing "key"');
  if (!text || typeof text !== 'string') return jsonError(400, 'Missing "text"');
  const adf = {
    body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: text.slice(0, 5000) }] }] },
  };
  return forwardJira(env, 'POST', `/rest/api/3/issue/${encodeURIComponent(key)}/comment`, adf);
}

async function handleUpdateIssue(request, env) {
  let body;
  try { body = await request.json(); } catch { return jsonError(400, 'Invalid JSON body'); }
  const { key, fields } = body || {};
  if (!key || typeof key !== 'string') return jsonError(400, 'Missing "key"');
  if (!fields || typeof fields !== 'object') return jsonError(400, 'Missing "fields"');
  // Whitelist de campos editáveis pelos dashboards (evita escrita arbitrária).
  const allowed = {};
  if ('duedate' in fields) allowed.duedate = fields.duedate;   // 'YYYY-MM-DD' ou null
  if ('priority' in fields) allowed.priority = fields.priority; // { name: 'Highest'|'High'|'Medium'|'Low' }
  if ('customfield_10015' in fields) allowed.customfield_10015 = fields.customfield_10015; // Start date 'YYYY-MM-DD' ou null
  if ('assignee' in fields) allowed.assignee = fields.assignee; // { accountId } ou null (desatribui)
  if (!Object.keys(allowed).length) return jsonError(400, 'No editable fields (allowed: duedate, priority, customfield_10015, assignee)');
  return forwardJira(env, 'PUT', `/rest/api/3/issue/${encodeURIComponent(key)}`, { fields: allowed });
}

async function forwardJira(env, method, path, payload) {
  const auth = btoa(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`);
  const apiUrl = `https://api.atlassian.com/ex/jira/${env.JIRA_CLOUD_ID}${path}`;
  let upstream;
  try {
    upstream = await fetch(apiUrl, {
      method,
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return jsonError(502, `Upstream fetch failed: ${e.message}`);
  }
  const text = await upstream.text();
  // JIRA responde 204 (sem corpo) no PUT de update; normaliza pra 200 {ok:true}.
  return new Response(text || JSON.stringify({ ok: upstream.ok }), {
    status: upstream.ok ? 200 : upstream.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function clamp(n, min, max) {
  n = Number(n);
  if (isNaN(n)) return min;
  return Math.min(Math.max(n, min), max);
}

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function jsonOk(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// ─── /api/state — Camada 1: persistência D1 ─────────────────────────────────
// Rotas:
//   GET    /api/state/:scope            → lista chaves do escopo
//   GET    /api/state/:scope/:key       → lê uma chave
//   PUT    /api/state/:scope/:key       → upsert (body: {value, expectedVersion?})
//   DELETE /api/state/:scope/:key       → remove
//
// Concorrência: optimistic. Cliente manda `expectedVersion`. Se o registro existe
// e tem versão diferente, retorna 409 + estado atual. Sem expectedVersion = força.
// updated_by é o usuário do Basic Auth (Camada 3 substitui por identidade real).
async function handleStateRoute(request, env, url) {
  if (!env.STATE_DB) return jsonError(503, 'STATE_DB binding not configured');
  // Path: /api/state/<scope>(/<key>)?
  const rest = url.pathname.slice('/api/state/'.length);
  const parts = rest.split('/').filter(Boolean).map(decodeURIComponent);
  if (!parts.length) return jsonError(400, 'Missing scope');
  const [scope, ...keyParts] = parts;
  const key = keyParts.join('/'); // permite key com '/' (ex.: 'scenario/current')

  if (!key && request.method === 'GET') return handleStateList(env, scope);
  if (!key) return jsonError(400, 'Missing key');

  switch (request.method) {
    case 'GET':    return handleStateGet(env, scope, key);
    case 'PUT':    return handleStatePut(request, env, scope, key);
    case 'DELETE': return handleStateDelete(request, env, scope, key);
    default: return jsonError(405, 'Use GET, PUT or DELETE');
  }
}

async function handleStateList(env, scope) {
  try {
    const rs = await env.STATE_DB
      .prepare('SELECT key, version, updated_at, updated_by FROM state WHERE scope = ? ORDER BY key')
      .bind(scope)
      .all();
    return jsonOk({ scope, items: rs.results || [] });
  } catch (e) {
    return jsonError(500, `D1 list failed: ${e.message}`);
  }
}

async function handleStateGet(env, scope, key) {
  try {
    const row = await env.STATE_DB
      .prepare('SELECT value, version, updated_at, updated_by FROM state WHERE scope = ? AND key = ?')
      .bind(scope, key)
      .first();
    if (!row) return jsonError(404, 'not found');
    let value;
    try { value = JSON.parse(row.value); } catch { value = null; }
    return jsonOk({ scope, key, value, version: row.version, updated_at: row.updated_at, updated_by: row.updated_by });
  } catch (e) {
    return jsonError(500, `D1 get failed: ${e.message}`);
  }
}

async function handleStatePut(request, env, scope, key) {
  let body;
  try { body = await request.json(); } catch { return jsonError(400, 'Invalid JSON body'); }
  if (!body || typeof body !== 'object' || !('value' in body)) {
    return jsonError(400, 'Missing "value"');
  }
  const expectedVersion = body.expectedVersion;
  const valueJson = JSON.stringify(body.value);
  const now = new Date().toISOString();
  const user = env.DASHBOARD_USER || 'anonymous';

  try {
    // Lê estado atual (sob a mesma "transação lógica" — D1 não tem transactions multi-statement
    // confiáveis, mas as duas operações são sequenciais e idempotentes pro caso de race).
    const cur = await env.STATE_DB
      .prepare('SELECT value, version FROM state WHERE scope = ? AND key = ?')
      .bind(scope, key)
      .first();

    if (cur && typeof expectedVersion === 'number' && cur.version !== expectedVersion) {
      // Conflito: cliente está editando uma versão antiga.
      let curValue;
      try { curValue = JSON.parse(cur.value); } catch { curValue = null; }
      return jsonOk({ error: 'version conflict', current: { value: curValue, version: cur.version } }, 409);
    }

    const oldVersion = cur ? cur.version : 0;
    const newVersion = oldVersion + 1;
    const oldValue = cur ? cur.value : null;

    // Upsert
    await env.STATE_DB
      .prepare(`INSERT INTO state (scope, key, value, version, updated_at, updated_by)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(scope, key) DO UPDATE SET
                  value = excluded.value,
                  version = excluded.version,
                  updated_at = excluded.updated_at,
                  updated_by = excluded.updated_by`)
      .bind(scope, key, valueJson, newVersion, now, user)
      .run();

    // Audit
    await env.STATE_DB
      .prepare(`INSERT INTO audit_log (scope, key, action, old_value, new_value, old_version, new_version, updated_by, ts)
                VALUES (?, ?, 'set', ?, ?, ?, ?, ?, ?)`)
      .bind(scope, key, oldValue, valueJson, oldVersion || null, newVersion, user, now)
      .run();

    return jsonOk({ scope, key, version: newVersion, updated_at: now, updated_by: user });
  } catch (e) {
    return jsonError(500, `D1 put failed: ${e.message}`);
  }
}

async function handleStateDelete(request, env, scope, key) {
  const now = new Date().toISOString();
  const user = env.DASHBOARD_USER || 'anonymous';
  try {
    const cur = await env.STATE_DB
      .prepare('SELECT value, version FROM state WHERE scope = ? AND key = ?')
      .bind(scope, key)
      .first();
    if (!cur) return new Response(null, { status: 204 });

    await env.STATE_DB.prepare('DELETE FROM state WHERE scope = ? AND key = ?').bind(scope, key).run();
    await env.STATE_DB
      .prepare(`INSERT INTO audit_log (scope, key, action, old_value, new_value, old_version, new_version, updated_by, ts)
                VALUES (?, ?, 'delete', ?, NULL, ?, NULL, ?, ?)`)
      .bind(scope, key, cur.value, cur.version, user, now)
      .run();
    return new Response(null, { status: 204 });
  } catch (e) {
    return jsonError(500, `D1 delete failed: ${e.message}`);
  }
}

// /api/audit?scope=X&limit=50 → histórico das mudanças.
async function handleAuditList(request, env, url) {
  if (!env.STATE_DB) return jsonError(503, 'STATE_DB binding not configured');
  const scope = url.searchParams.get('scope');
  const limit = clamp(parseInt(url.searchParams.get('limit') || '50', 10), 1, 500);
  try {
    let rs;
    if (scope) {
      rs = await env.STATE_DB
        .prepare('SELECT id, scope, key, action, old_version, new_version, updated_by, ts FROM audit_log WHERE scope = ? ORDER BY ts DESC LIMIT ?')
        .bind(scope, limit).all();
    } else {
      rs = await env.STATE_DB
        .prepare('SELECT id, scope, key, action, old_version, new_version, updated_by, ts FROM audit_log ORDER BY ts DESC LIMIT ?')
        .bind(limit).all();
    }
    return jsonOk({ scope, items: rs.results || [] });
  } catch (e) {
    return jsonError(500, `D1 audit failed: ${e.message}`);
  }
}
