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
