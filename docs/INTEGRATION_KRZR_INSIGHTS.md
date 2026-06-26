# Integração — dashboards Kruzer via token read-only

Para uma integração externa (ex.: o Claude de um gestor) ler os dados de **todos
os dashboards** e gerar insights, **sem** poder escrever em nada.

## Como funciona

O Worker tem **duas identidades**:

| Identidade | Como autentica | Acesso |
|---|---|---|
| **admin** (humanos) | Basic Auth (`DASHBOARD_USER`/`DASHBOARD_PASSWORD`) | total (leitura + escrita) |
| **integration** | token `INSIGHTS_TOKEN` | **somente leitura, em todos os dashboards** |

A identidade de integração pode **ler tudo**: qualquer página (`/`, `/ops/`,
`/vena/*`, `/fst/*`, `/pgm/*`, `/krzr/*`, `/timeline/`), o endpoint agregado
`GET /api/krzr/insights`, o proxy de leitura do JIRA (`POST /api/jira/jql`) e o
estado compartilhado (`GET /api/state/...`). **Não pode escrever**: comentar/editar
no JIRA (`/api/jira/comment`, `/api/jira/issue-update`) e gravar/apagar estado
(`PUT`/`DELETE /api/state`) retornam **403**.

Sem credencial válida → **401**. Assim, mesmo que o token vaze, ele é só um
espelho **read-only** do que um usuário autenticado dos dashboards já enxerga —
não muta nada (nem JIRA, nem estado compartilhado).

> **Escopo da leitura:** o proxy `/api/jira/jql` não restringe projeto — o token
> consegue consultar qualquer projeto que a conta de serviço JIRA enxerga. Se um
> dia precisar limitar a projetos específicos, dá pra travar o JQL no Worker.

## Service Desk (KRZR) — endpoint agregado

```
GET /api/krzr/insights
```

Autenticação (escolha uma):

- **Header (recomendado):** `Authorization: Bearer <TOKEN>`
- **Query (fallback):** `?token=<TOKEN>` — mais simples, porém o token aparece em
  logs/histórico/Referer. Use só se a ferramenta não permitir header.

### Exemplos

```bash
# Header (preferido)
curl -H "Authorization: Bearer $TOKEN" \
  https://kruzer-dashboards.matheus-mereb.workers.dev/api/krzr/insights

# Query (fallback — o jeito que o gestor imaginou)
curl "https://kruzer-dashboards.matheus-mereb.workers.dev/api/krzr/insights?token=$TOKEN"
```

### Resposta (JSON)

```jsonc
{
  "project": "KRZR",
  "generatedAt": "2026-06-26T...Z",
  "totals": { "open": 36, "resolvedLast30d": 32, "slaBreaches": 22, "agingGt7": 27, "oldestOpenDays": 730 },
  "byStatus":   { "Work in progress": 3, "Waiting for support": 12, "Waiting for customer": 19, "Pending": 2 },
  "byPriority": { "Highest": 9, "High": 18, "Medium": 8, "Low": 1 },
  "aging":      { "gt7": 27, "gt14": 25, "gt30": 23 },
  "slaBreaches": [ { "key": "KRZR-2868", "priority": "Highest", "ageDays": 12, "summary": "..." } ],
  "tickets":     [ { "key": "...", "summary": "...", "status": "...", "statusCategory": "...",
                     "priority": "...", "assignee": "...", "created": "...", "updated": "...", "ageDays": 12 } ]
}
```

- **Fila aberta** = `statusCategory != Done` (não usa `resolution`, que o KRZR não mantém).
- **SLA**: `Highest` aberto > 1 dia ou `High` aberto > 3 dias (mesmos thresholds do cockpit `/ops/`).
- `resolvedLast30d` é aproximado (via `resolutiondate`).

## Outros dashboards (VENA, FST, PGM, DCT, portfólio)

Para os demais clientes, a integração lê os dados crus do JIRA pelo **proxy de
leitura** (mesmo header/token), e o LLM agrega:

```bash
curl -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"jql":"project = PGM AND issuetype = Epic","fields":["summary","status","priority","duedate","customfield_10015","timeoriginalestimate"],"maxResults":100}' \
  https://kruzer-dashboards.matheus-mereb.workers.dev/api/jira/jql
```

Trocar `PGM` por `VENA`/`FST`/`DCT` (ou `project in (FST,VENA,DCT,PGM)` pra
cross-projeto). O estado publicado pelos planners (cronograma, remarks, follow-ups)
sai em `GET /api/state/<scope>` — ex.: `/api/state/pgm-capacity/schedule`,
`/api/state/vena-roadmap/remarks`. Alternativamente, a integração pode **carregar
a própria página** do dashboard (`GET /pgm/`, `/ops/`, etc.) — todas funcionam com
o token, pois os dados carregam via o proxy já liberado.

## Como ligar no Claude do gestor

Basta uma ferramenta/conector que faça um GET HTTP nessa URL com o header (ou
`?token=`) e entregue o JSON ao modelo. O Claude então resume fila, gargalos por
prioridade, breaches de SLA e aging. Como o payload já vem agregado + a lista de
tickets, não precisa de prompt de parsing complexo.

## Operação do token (secret)

```bash
# Define / rotaciona o token (NUNCA commitar no código):
printf '%s' "SEU_TOKEN_FORTE" | npx wrangler secret put INSIGHTS_TOKEN            # prod
printf '%s' "SEU_TOKEN_FORTE" | npx wrangler secret put INSIGHTS_TOKEN --env hml  # HML

# Gerar um token forte:
echo "krzr_$(openssl rand -hex 24)"
```

- Rotacionar = só rodar `secret put` de novo (invalida o anterior na hora).
- Se o `INSIGHTS_TOKEN` não estiver setado, a identidade de integração fica
  **desligada** (só Basic Auth funciona) — degradação segura.

## Por que não foi feito como no pedido original

A proposta inicial (`const SECRET_TOKEN = "..."` no código + token em `?token=`
liberando a URL inteira) tinha três problemas: (1) secret no fonte/git; (2) o gate
atual já é Basic Auth, então a integração **já** autenticava — o que faltava era
**privilégio mínimo**; (3) o Worker tem endpoints de **escrita** (comentar/editar
no JIRA, gravar no D1) que um token "que passa no gate" exporia. A solução acima
mantém o espírito (token na URL funciona) mas torna a credencial **read-only e
escopada ao Service Desk**, com o secret fora do código.
