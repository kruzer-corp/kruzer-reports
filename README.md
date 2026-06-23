# Kruzer Dashboards

Dashboards standalone (KRZR Service Desk, VENA Dev, FST FastShop Demands) que rodam em qualquer navegador, com dados ao vivo do JIRA da Kruzer.

Arquitetura simples:

```
Browser → Cloudflare Worker (Basic Auth + proxy) → Atlassian Cloud API
         └ serve HTML/JS estáticos do diretório public/
```

Um único worker faz duas coisas: (1) serve os arquivos estáticos do `public/`, (2) proxia chamadas `/api/jira/jql` pra Atlassian com credenciais guardadas como secrets do Worker. O frontend nunca toca em API token.

## Setup (uma vez)

### 1. Pré-requisitos

```bash
# Node 18+ e npm
node -v
npm -v
```

Conta Cloudflare (free tier serve): https://dash.cloudflare.com/sign-up

### 2. Instalar deps

```bash
npm install
```

### 3. Pegar API token do Atlassian

1. Vá em https://id.atlassian.com/manage-profile/security/api-tokens
2. **Create API token** → nome: `kruzer-dashboards` → copie o token (não dá pra ver de novo depois)
3. Anote junto: email da conta (`matheus.mereb@kruzer.ai`), cloud ID (`dd987a38-5d13-4230-ab43-7141dc3695e1`)

### 4. Configurar variáveis locais (pra rodar `wrangler dev`)

Copie `.dev.vars.example` → `.dev.vars` e preencha:

```
JIRA_EMAIL=matheus.mereb@kruzer.ai
JIRA_API_TOKEN=<token-do-passo-3>
JIRA_CLOUD_ID=dd987a38-5d13-4230-ab43-7141dc3695e1
DASHBOARD_USER=kruzer
DASHBOARD_PASSWORD=<senha-forte>
```

> ⚠️ `.dev.vars` está no `.gitignore`. Nunca commite credenciais.

### 5. Login no Cloudflare

```bash
npx wrangler login
```

Vai abrir o browser pra autorizar.

### 6. Setar secrets em produção

Os mesmos valores do `.dev.vars`, mas como secrets do Worker:

```bash
npx wrangler secret put JIRA_EMAIL
npx wrangler secret put JIRA_API_TOKEN
npx wrangler secret put JIRA_CLOUD_ID
npx wrangler secret put DASHBOARD_USER
npx wrangler secret put DASHBOARD_PASSWORD
```

Cada comando vai pedir o valor interativamente.

## Rodar localmente

```bash
npm run dev
```

Abre em `http://localhost:8787`. Vai pedir Basic Auth — usa `DASHBOARD_USER`/`DASHBOARD_PASSWORD` do `.dev.vars`.

## Deploy

```bash
npm run deploy
```

URL final tipo `https://kruzer-dashboards.<sua-conta>.workers.dev`. Você pode plugar custom domain depois (ex: `dashboards.kruzer.ai`).

## Como compartilhar com cliente

1. Mande a URL + usuário + senha (canal seguro — 1Password, Bitwarden, ou Slack/email criptografado).
2. Cliente abre, navega pelos dashboards.
3. Quando quiser revogar acesso: `npx wrangler secret put DASHBOARD_PASSWORD` com nova senha.

Se quiser controle por cliente (cada cliente uma senha), dá pra estender o worker pra ler de um KV namespace — não está implementado nessa primeira versão.

## Estrutura

```
.
├── README.md                   # esse arquivo
├── package.json
├── package-lock.json
├── wrangler.toml               # config Cloudflare Worker (+ html_handling)
├── .dev.vars.example           # template das vars locais
├── .gitignore
├── src/
│   └── worker.js               # backend: Basic Auth + proxy JIRA + serve static
├── public/                     # tudo que é servido pelo Worker
│   ├── index.html              # landing — picker dos dashboards
│   ├── shared/
│   │   └── api.js              # cliente JIRA paginated (KruzerAPI), usado por todos
│   ├── krzr/                   # KRZR Service Desk
│   │   ├── index.html          # produção
│   │   └── hml.html            # v2 ITIL (homologação)
│   ├── vena/                   # VENA — Venancio
│   │   ├── index.html          # dev dashboard
│   │   └── roadmap.html        # Gantt de épicos + capacity
│   └── fst/                    # FST — FastShop Demands
│       └── index.html
├── docs/                       # handoffs, fixes, snapshots de validação
│   ├── HANDOFF_INITIAL.md
│   ├── HANDOFF_KRZR_PROD.md
│   ├── HANDOFF_KRZR_HML.md
│   ├── HANDOFF_VENA_ROADMAP_V2.md
│   ├── FIXES_KRZR.md
│   └── snapshots/              # HTML congelados de sprints anteriores (revert/debug)
└── scripts/                    # ferramentas operacionais
    ├── deploy.sh               # wrapper de deploy (one-shot com secrets)
    ├── verify-dashboards.js    # smoke test via puppeteer pós-deploy
    └── dev/                    # scripts puppeteer one-off (debug histórico)
```

### URLs servidas pelo Worker

| Rota                 | Arquivo                       |
| -------------------- | ----------------------------- |
| `/`                  | `public/index.html`           |
| `/krzr/`             | `public/krzr/index.html`      |
| `/krzr/hml`          | `public/krzr/hml.html`        |
| `/vena/`             | `public/vena/index.html`      |
| `/vena/roadmap`      | `public/vena/roadmap.html`    |
| `/fst/`              | `public/fst/index.html`       |
| `/shared/api.js`     | helper cliente JIRA           |
| `POST /api/jira/jql` | proxy autenticado pra JIRA    |

URLs sem `.html` funcionam porque `wrangler.toml` tem `html_handling = "auto-trailing-slash"`.

## Como adicionar um dashboard novo

**Mesmo projeto** (ex: novo dashboard do VENA):
1. Crie `public/vena/<nome>.html` (use um dos existentes como template).
2. Mantenha o `<script src="/shared/api.js"></script>` no topo.
3. Adicione um link no `public/index.html` apontando pra `/vena/<nome>`.
4. `npm run deploy`.

**Projeto novo** (ex: dashboards de um cliente XYZ):
1. Crie `public/xyz/index.html` (e mais arquivos `.html` se quiser).
2. Adicione o card no `public/index.html` apontando pra `/xyz/`.
3. `npm run deploy`.

Todos os dashboards consomem o mesmo endpoint `/api/jira/jql` — sem mexer no worker.

## Endpoint do proxy

```
POST /api/jira/jql
Content-Type: application/json
Authorization: Basic <base64(user:pass)>

{
  "jql": "project = KRZR ORDER BY created DESC",
  "fields": ["summary","status","created","resolutiondate"],
  "maxResults": 100,
  "nextPageToken": null
}
```

Retorna o body raw da Atlassian Cloud REST API v3 (`/rest/api/3/search/jql`):

```json
{
  "issues": [ ... ],
  "nextPageToken": "...",
  "isLast": false
}
```

## Troubleshooting

**Tela de auth pede de novo toda hora** — Basic Auth no Chrome às vezes não persiste. Use Edge/Firefox ou logue uma vez no devtools.

**`401 Unauthorized` na chamada JIRA** — API token expirou ou está errado. Regenere e re-rode `npx wrangler secret put JIRA_API_TOKEN`.

**`429 Too Many Requests`** — Atlassian rate limit. O worker hoje não tem cache; pra alto tráfego, ative cache via Cloudflare Cache API ou KV (não implementado).

**CORS** — não tem. Frontend e backend estão na mesma origem (o próprio Worker). Se você partir o frontend pra outro domínio, vai precisar adicionar CORS no worker.

**Performance lenta com muitos tickets** — KRZR tem ~2.8k issues e os dashboards puxam em batches de 100. Refresh demora ~10–20s. Otimizar: limitar a janela JQL (já fazemos com `created >= -120d`).

## Próximos passos sugeridos

- [ ] Custom domain (ex: `dashboards.kruzer.ai`)
- [ ] Cache no Worker pra refresh < 1s (TTL configurável)
- [ ] Multi-tenant: senha por cliente via KV
- [ ] Webhooks de JIRA pra atualização push em vez de pull
- [ ] Métricas Cloudflare Analytics pra ver quantos clientes acessam
