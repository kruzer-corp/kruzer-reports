# Deploy HML — passo-a-passo

**Objetivo:** subir uma versão de homologação isolada de prod pra validar Camada 0 (`/ops/`) + Camada 1 (D1) antes de promover.

**URL final:** `https://kruzer-dashboards-hml.matheus-mereb.workers.dev`
**Database HML:** `kruzer-state-hml` (isolado de prod, sem risco de poluir dado real)

---

## Pré-requisitos

- `CLOUDFLARE_API_TOKEN` ativo na sua máquina (token vazado em chat foi revogado — gere um novo em [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens), template "Edit Cloudflare Workers").
- Variáveis JIRA (`JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_CLOUD_ID`) — mesmas da prod.
- `DASHBOARD_USER` / `DASHBOARD_PASSWORD` — sugestão: usa **senha diferente** da prod pra evitar engano.

---

## Sequência (uma vez)

### 1. Cria o database D1 de HML

```bash
cd kruzer-dashboards
npx wrangler d1 create kruzer-state-hml
```

A saída traz algo como:
```
✅ Successfully created DB 'kruzer-state-hml'
[[d1_databases]]
binding = "STATE_DB"
database_name = "kruzer-state-hml"
database_id = "abc123-def456-..."
```

**Copie o `database_id`** e cole em `wrangler.toml` substituindo o placeholder:

```toml
[[env.hml.d1_databases]]
binding = "STATE_DB"
database_name = "kruzer-state-hml"
database_id = "abc123-def456-..."   # ← cole aqui
```

### 2. Aplica a migration no D1 (remoto)

```bash
npx wrangler d1 execute kruzer-state-hml --env hml --file=migrations/0001_init.sql --remote
```

Deve retornar `🚣 6 commands executed successfully` (2 CREATE TABLE + 4 CREATE INDEX).

### 3. Cria o database D1 de prod (se ainda não existir)

```bash
npx wrangler d1 create kruzer-state
# cola database_id no [[d1_databases]] top-level do wrangler.toml
npx wrangler d1 execute kruzer-state --file=migrations/0001_init.sql --remote
```

> Sem isso, a prod vai dar `503 STATE_DB binding not configured` quando os dashboards tentarem escrever. Os fallbacks pra localStorage continuam funcionando, mas a verdade compartilhada não funciona.

### 4. Deploy HML

```bash
export CLOUDFLARE_API_TOKEN=...
export JIRA_EMAIL=matheus.mereb@kruzer.ai
export JIRA_API_TOKEN=...
export JIRA_CLOUD_ID=dd987a38-5d13-4230-ab43-7141dc3695e1
export DASHBOARD_USER=kruzer
export DASHBOARD_PASSWORD=senha-hml-diferente-da-prod

bash scripts/deploy-hml.sh
```

O script valida que o placeholder do D1 foi substituído, manda os secrets pro env `hml`, e deploya.

---

## Checklist de validação (depois do deploy)

Abra a URL e autentique com as credenciais HML. Em cada item, marque ✅ ou anota o que quebrou.

### Painel novo · `/ops/`
- [ ] Cards de saúde aparecem (5 clientes: FST, VENA, DCT, J4PM, KRZR) — cor refletindo o estado.
- [ ] Lista de riscos vem ordenada por severidade (crítico → alto → info).
- [ ] Mini-Gantt das 4 próximas semanas renderiza (ou mostra "Nenhum marco" sem quebrar).
- [ ] Tiles do rodapé linkam pros 8 dashboards.

### Camada 1 (persistência D1)
- [ ] Em `/vena/roadmap`, edita um remark de um épico e recarrega — texto persiste.
- [ ] Em `/fst/`, idem.
- [ ] Em outro navegador (ou aba anônima), abre `/vena/roadmap` — o mesmo remark aparece. **(Esse é o teste-chave da Camada 1.)**
- [ ] Em `/vena/capacity`, faz um drag-and-drop de épico → recarrega → mantém posição.
- [ ] Em `/vena/capacity`, salva um cenário → abre `/vena/roadmap` em outro navegador → timeline reflete o cenário publicado.

### Endpoints D1
- [ ] `https://kruzer-dashboards-hml.matheus-mereb.workers.dev/api/state/vena-roadmap` retorna JSON com `items: [{key:"remarks", ...}, {key:"followups", ...}]`.
- [ ] `…/api/audit?scope=vena-roadmap&limit=10` retorna histórico das últimas edições.

### Dashboards existentes (não-regression)
- [ ] `/krzr/`, `/krzr/hml`, `/vena/`, `/timeline/` carregam sem erro no console.
- [ ] Paleta visual padronizada (azul Kruzer `#3151CE` no KRZR também, antes era `#4f46e5`).

### Conflito de concorrência (opcional, avançado)
- [ ] Em duas abas, edita o mesmo remark sem recarregar. A segunda escrita recebe toast/console.warn de "version conflict".

---

## Promoção pra prod

Quando o checklist estiver verde:

```bash
bash scripts/deploy.sh   # deploy padrão (sem --env), vai pro top-level = prod
```

E executa as migrations no D1 de prod (passo 3 acima, se ainda não tiver feito).

---

## Rollback

HML e prod são isolados — rollback de HML não afeta prod. Se quiser reverter HML pra zero:

```bash
npx wrangler d1 execute kruzer-state-hml --env hml --command "DELETE FROM state; DELETE FROM audit_log;" --remote
```

E pra dropar o worker HML inteiro (se quiser limpar):

```bash
npx wrangler delete --name kruzer-dashboards-hml
```

---

## Notas técnicas

- **D1 isolado.** HML e prod têm databases separados; nenhum risco de cross-contamination.
- **Mesmas secrets, mas separadas no Cloudflare.** `wrangler secret put --env hml` grava na lista de secrets do env HML, distinta da prod.
- **Asset binding único por env.** Os arquivos em `public/` são os mesmos — não há "branch" de HTML; o que diferencia HML é só o backend.
- **localStorage segue funcionando** como fallback se a chamada pro D1 falhar (testar offline).
