# Handoff pro Claude Code

Cole o briefing abaixo no Claude Code (cmd `claude` no terminal, dentro deste diretório), com o repo já aberto:

---

## Briefing

Repo scaffoldado pelo Cowork. Objetivo: dashboards JIRA standalone (KRZR Service Desk, VENA Dev, FST FastShop Demands) que rodam em qualquer Chrome, deploy via Cloudflare Workers, protegidos por Basic Auth pra compartilhar com cliente.

### Estado atual

- `src/worker.js` — Worker com 3 responsabilidades: (1) Basic Auth gate, (2) proxy POST `/api/jira/jql` → Atlassian Cloud REST API v3 `/rest/api/3/search/jql`, (3) serve estáticos do `public/` via `ASSETS` binding.
- `public/index.html` — landing com cards pros dashboards.
- `public/<projeto>/*.html` — dashboards full self-contained, organizados por projeto (Chart.js + Grid.js via CDN, JS inline). Hoje: `krzr/` (index + hml), `vena/` (index + roadmap), `fst/` (index).
- `public/shared/api.js` — helper `KruzerAPI.fetchAll({ jql, fields })` que faz pagination. Carregado por todos via `<script src="/shared/api.js">`.
- `wrangler.toml` — config Worker com Assets binding e `html_handling = "auto-trailing-slash"` (URLs sem `.html`).
- `README.md` — setup completo (token, secrets, deploy) + tabela de rotas.

### O que você precisa fazer

1. **Instalar e testar local**:
   ```bash
   npm install
   cp .dev.vars.example .dev.vars
   # edita .dev.vars com o token real do Atlassian
   npm run dev
   ```
   Abre `http://localhost:8787`, faz login com `DASHBOARD_USER` / `DASHBOARD_PASSWORD`, valida que os 3 dashboards carregam dados de verdade.

2. **Validar cada dashboard**:
   - `/krzr/` deve mostrar ~2.8k tickets (paginação puxa ~28 batches). Pode demorar 10-20s.
   - `/vena/` deve mostrar ~200 issues. Rápido.
   - `/fst/` deve mostrar ~9 demandas DMND, filtradas pelo JQL `labels = "dmnd-fastshop" OR summary ~ "DMND"`.

3. **Possíveis problemas conhecidos a verificar**:
   - **Atlassian search endpoint**: estou usando `/rest/api/3/search/jql` (POST). Se a Atlassian tiver descontinuado, fallback é `/rest/api/3/search` (GET com params). Ajuste em `src/worker.js` `handleJqlProxy`.
   - **Field name `nextPageToken` vs `next_page_token`**: a API nova usa `nextPageToken`; se vier vazio sempre, verifique se a resposta tá em formato `{issues, isLast, nextPageToken}` (novo) ou `{issues, startAt, total}` (antigo). Adapta em `public/shared/api.js` `fetchAll`.
   - **Custom field `customfield_10024`** (Date of First Response) só existe em projetos JSM (KRZR). VENA e FST não usam. Não deve dar erro mas pode retornar null — comportamento esperado.

4. **Deploy**:
   ```bash
   npx wrangler login
   npx wrangler secret put JIRA_EMAIL
   npx wrangler secret put JIRA_API_TOKEN
   npx wrangler secret put JIRA_CLOUD_ID
   npx wrangler secret put DASHBOARD_USER
   npx wrangler secret put DASHBOARD_PASSWORD
   npm run deploy
   ```
   URL final tipo `https://kruzer-dashboards.<sua-conta>.workers.dev`.

5. **Quando funcionar, melhorias sugeridas** (em ordem de impacto):
   - **Cache nos requests** — KV namespace ou Cache API com TTL 5min, reduz latência de refresh + economiza rate limit do Atlassian.
   - **Custom domain** — `dashboards.kruzer.ai` via Cloudflare DNS.
   - **Multi-tenant auth** — substituir Basic Auth fixo por tabela em KV mapeando senha → escopo (ex: cliente FastShop só vê `/fst/`). Hoje todo mundo vê todos os dashboards.
   - **WebSocket / SSE pra real-time** — overkill agora, mas se virar dashboard institucional.

### Decisões técnicas que tomei

- **Worker Assets binding (não Pages)** — um deploy só, mais simples.
- **Basic Auth via header WWW-Authenticate** — browser cuida da prompt, sem login UI custom (rápido de implementar, UX OK).
- **Cada dashboard self-contained** (sem shared.js exceto `shared/api.js`) — facilita debug, custo de duplicação aceitável.
- **JQL gera todo o universo necessário, filtros são client-side** — simplifica backend, dashboards puxam 1 vez e filtram localmente.
- **Sem framework JS** — vanilla, CDN, zero build step.

### Context do JIRA (referência)

- Cloud ID: `dd987a38-5d13-4230-ab43-7141dc3695e1`
- Cloud URL: `https://kruzer.atlassian.net`
- Projetos relevantes: KRZR (Service Desk), VENA (Software), FST (Software)
- API token: gera em `https://id.atlassian.com/manage-profile/security/api-tokens`

### Original artifacts (referência se algo divergir)

Os dashboards do Cowork (que usam MCP) seguem funcionando em paralelo. Se quiser comparar comportamento, abra:
- KRZR: artifact `krzr-service-desk-dashboard` no Cowork
- VENA: artifact `vena-dev-dashboard` no Cowork

O FST não tem artifact Cowork — foi criado direto aqui.

---

Pode iterar à vontade. Quando o deploy estiver verde, manda a URL pro Matheus.
