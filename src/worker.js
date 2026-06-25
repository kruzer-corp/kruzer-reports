// Cloudflare Worker — Kruzer Dashboards
// Responsabilidades:
//  1. Basic Auth gate (DASHBOARD_USER / DASHBOARD_PASSWORD).
//  2. Proxy autenticado pra Atlassian Cloud REST API (rota /api/jira/jql).
//  3. Serve arquivos estáticos do public/ (binding ASSETS).
//
// Secrets esperadas (via `wrangler secret put`):
//   JIRA_EMAIL, JIRA_API_TOKEN, JIRA_CLOUD_ID,
//   DASHBOARD_USER, DASHBOARD_PASSWORD

const REALM = 'Kruzer Dashboards';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. Auth gate (aplica em tudo, inclusive estáticos — protege a URL inteira)
    if (!checkBasicAuth(request, env)) {
      return new Response('Authentication required', {
        status: 401,
        headers: {
          'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"`,
          'Content-Type': 'text/plain; charset=utf-8',
        },
      });
    }

    // 2. API proxy
    if (url.pathname === '/api/jira/jql') {
      if (request.method !== 'POST') {
        return jsonError(405, 'Use POST');
      }
      return handleJqlProxy(request, env);
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
  },
};

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
  // Whitelist: só duedate é editável pelos dashboards (evita escrita arbitrária).
  const allowed = {};
  if ('duedate' in fields) allowed.duedate = fields.duedate;   // 'YYYY-MM-DD' ou null
  if ('priority' in fields) allowed.priority = fields.priority; // { name: 'Highest'|'High'|'Medium'|'Low' }
  if (!Object.keys(allowed).length) return jsonError(400, 'No editable fields (allowed: duedate, priority)');
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
