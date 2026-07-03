// src/oauth.js — Endpoint /authorize (login + consent) do OAuth 2.1.
// O @cloudflare/workers-oauth-provider implementa /token, /register e os metadados
// .well-known; aqui a gente só AUTENTICA o usuário (allowlist) e chama
// completeAuthorization pra lib emitir o código/token.
//
// Allowlist: secret OAUTH_USERS = JSON [{ "email", "name", "pass" }, ...].
// Setar com: printf '%s' '[{"email":"a@kruzer.ai","name":"A","pass":"..."}]' \
//   | npx wrangler secret put OAUTH_USERS   (e --env hml pra HML)
// Todo token emitido concede escopo 'read' — o MCP é somente leitura.

function loadUsers(env) {
  try {
    const arr = JSON.parse(env.OAUTH_USERS || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function safeEqual(a, b) {
  a = String(a == null ? '' : a); b = String(b == null ? '' : b);
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function validateUser(env, email, pass) {
  const e = String(email || '').trim().toLowerCase();
  for (const u of loadUsers(env)) {
    if (String(u.email || '').trim().toLowerCase() === e && safeEqual(pass, u.pass)) {
      return { email: u.email, name: u.name || u.email };
    }
  }
  return null;
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function htmlResponse(body, status = 200) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function loginPage(actionUrl, clientName, error) {
  return `<!doctype html><html lang="pt-br"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kruzer Dashboards — Autorizar acesso</title>
<style>
  :root { --navy:#1B1F3B; --blue:#3151CE; --bg:#F4F5FA; --line:#E2E4EF; --err:#F04438; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; background:var(--bg); color:var(--navy);
         min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; }
  .card { background:#fff; border:1px solid var(--line); border-radius:16px; padding:32px; width:100%; max-width:400px;
          box-shadow:0 8px 32px rgba(27,31,59,.08); }
  h1 { font-size:20px; margin:0 0 4px; }
  .sub { font-size:14px; color:#6B7194; margin:0 0 24px; line-height:1.5; }
  .sub b { color:var(--navy); }
  label { display:block; font-size:13px; font-weight:600; margin:14px 0 6px; }
  input { width:100%; padding:11px 13px; border:1px solid var(--line); border-radius:9px; font-size:15px; }
  input:focus { outline:none; border-color:var(--blue); box-shadow:0 0 0 3px rgba(49,81,206,.12); }
  button { width:100%; margin-top:22px; padding:12px; background:var(--blue); color:#fff; border:0; border-radius:9px;
           font-size:15px; font-weight:600; cursor:pointer; }
  button:hover { background:#2842b0; }
  .err { background:#FEF3F2; color:var(--err); border:1px solid #FDA29B; border-radius:9px; padding:10px 12px; font-size:13px; margin:0 0 8px; }
  .foot { margin-top:18px; font-size:12px; color:#9096B5; text-align:center; line-height:1.5; }
</style></head>
<body>
  <div class="card">
    <h1>Kruzer Dashboards</h1>
    <p class="sub"><b>${esc(clientName)}</b> quer acessar seus dashboards em <b>modo somente leitura</b> (consultar épicos, riscos e Service Desk — sem escrever nada).</p>
    ${error ? `<div class="err">${esc(error)}</div>` : ''}
    <form method="POST" action="${esc(actionUrl)}">
      <label for="email">E-mail</label>
      <input id="email" name="email" type="email" autocomplete="username" required autofocus>
      <label for="password">Senha</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <button type="submit">Autorizar acesso</button>
    </form>
    <p class="foot">Acesso restrito à equipe Kruzer. O app recebe apenas leitura dos dashboards.</p>
  </div>
</body></html>`;
}

export async function handleAuthorize(request, env) {
  const provider = env.OAUTH_PROVIDER;
  if (!provider) return new Response('OAuth provider indisponível', { status: 500 });

  let oauthReq;
  try {
    oauthReq = await provider.parseAuthRequest(request);
  } catch (e) {
    return new Response('Requisição de autorização inválida: ' + (e && e.message || e), { status: 400 });
  }

  let clientName = 'Um aplicativo';
  try {
    const client = await provider.lookupClient(oauthReq.clientId);
    if (client) clientName = client.clientName || client.clientId || clientName;
  } catch { /* cliente ainda não registrado — segue com nome genérico */ }

  const u = new URL(request.url);
  const actionUrl = u.pathname + u.search; // preserva os params OAuth no POST

  if (request.method === 'GET') {
    return htmlResponse(loginPage(actionUrl, clientName, null));
  }
  if (request.method === 'POST') {
    const form = await request.formData();
    const user = validateUser(env, form.get('email'), form.get('password'));
    if (!user) return htmlResponse(loginPage(actionUrl, clientName, 'E-mail ou senha inválidos.'), 401);
    const result = await provider.completeAuthorization({
      request: oauthReq,
      userId: user.email,
      scope: ['read'],                 // MCP é read-only
      props: { email: user.email, name: user.name },
      metadata: { via: 'allowlist' },
    });
    const redirectTo = typeof result === 'string' ? result : (result && (result.redirectTo || result.location || result.url));
    if (!redirectTo) return new Response('Falha ao completar autorização', { status: 500 });
    return Response.redirect(redirectTo, 302);
  }
  return new Response('Method not allowed', { status: 405 });
}
