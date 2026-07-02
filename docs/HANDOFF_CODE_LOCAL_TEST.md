# Handoff pro Claude Code — Validação local do refactor + Camada 1

**Audiência:** Claude Code (CLI) operando no terminal local do Matheus.
**Objetivo:** subir tudo em `localhost`, validar o trabalho **sem tocar em prod, HML remoto, ou main**.
**Regra de ouro:** se algum comando deste handoff tenta deploy/push/criar D1 remoto, **PARE** — não é o caminho.

---

## 1. O que tem na pasta agora

Branch local: `feat/ops-cockpit-and-d1` (criada nessa sessão, ainda sem commits — só working tree).

```
Modificados (13):
  package.json, src/worker.js, wrangler.toml, scripts/verify-dashboards.js
  public/index.html, public/timeline/index.html
  public/vena/{index,capacity,roadmap}.html
  public/fst/{index,capacity}.html
  public/krzr/{index,hml}.html

Novos (11):
  public/ops/index.html              ← cockpit executivo (Camada 0)
  public/shared/tokens.css           ← paleta Kruzer compartilhada
  public/shared/capacity.js          ← helpers + IO de schedule
  public/shared/components.js        ← kpiCard/alertBanner/riskRow
  public/shared/state.js             ← cliente D1 com cache local
  migrations/0001_init.sql           ← schema D1
  scripts/deploy-hml.sh              ← (NÃO RODAR — é pra remoto)
  scripts/setup-hml.sh               ← (NÃO RODAR — é pra remoto)
  docs/HANDOFF_OPS_CONTROL.md
  docs/HANDOFF_HML_DEPLOY.md
  docs/HANDOFF_CODE_LOCAL_TEST.md    ← este arquivo

Bundle git pronto na raiz:
  feat-ops-cockpit-and-d1.bundle     ← 4 commits semânticos já organizados
```

**Resumo do que esses arquivos fazem:**

1. **`/ops/`** — painel executivo C-level que agrega FST/VENA/DCT/J4PM/KRZR numa tela (semáforo por cliente, top riscos, mini-Gantt 4 semanas).
2. **`/shared/`** — tokens.css, capacity helpers, components.js e state.js (cliente D1 com cache local).
3. **D1 + Worker endpoints** — `/api/state/:scope/:key` (GET/PUT/DELETE) + `/api/audit` com optimistic concurrency. Schema em `migrations/0001_init.sql`.
4. **Callers migrados** — remarks, followups e cenários em vena/roadmap, fst/index, vena/capacity, fst/capacity passam por `KruzerState` (D1 first, localStorage como cache+fallback).

Doc de visão completa: `docs/HANDOFF_OPS_CONTROL.md`.

---

## 2. Setup local (uma vez, sem tocar nada remoto)

### 2.1. Cria D1 LOCAL (`--local` é a flag chave — não cria nada na Cloudflare)

```bash
cd ~/Desktop/Kruzer/kruzer-dashboards

# O --local faz o wrangler usar SQLite local em .wrangler/state/v3/d1/
# Não precisa de CLOUDFLARE_API_TOKEN. Não cria recurso remoto.
npx wrangler d1 execute kruzer-state --local --file=migrations/0001_init.sql
```

> Esperado: `🚣 6 commands executed successfully` (2 CREATE TABLE + 4 CREATE INDEX).
>
> Se reclamar de `database_id`: edite `wrangler.toml` e troque `REPLACE_AFTER_RUNNING_d1_create` no top-level `[[d1_databases]]` por qualquer UUID. O `--local` ignora o id pra binding remoto, mas o wrangler valida sintaxe.
>
> Sugestão de UUID dummy: `database_id = "00000000-0000-0000-0000-000000000000"`. **Importante:** isto NÃO conecta a nenhum recurso real — é só pra wrangler aceitar a config local.

### 2.2. Garante que `.dev.vars` está OK

```bash
cat .dev.vars  # deve ter JIRA_EMAIL, JIRA_API_TOKEN, JIRA_CLOUD_ID, DASHBOARD_USER, DASHBOARD_PASSWORD
```

Já deve estar preenchido (gitignored, sobreviveu).

### 2.3. Sobe o worker em localhost

```bash
npx wrangler dev
```

URL: `http://localhost:8787` · auth: `DASHBOARD_USER` / `DASHBOARD_PASSWORD` do `.dev.vars`.

> Esperado: console mostra `Ready on http://localhost:8787` + binding `STATE_DB` listado como D1 (local).

---

## 3. Checklist de validação

Faz como **smoke test** primeiro (5 min), depois **funcional** (10 min). Se algo falhar, relate o erro de console + screenshot, **não tente "consertar empurrando pra prod"**.

### 3.1. Smoke — só carregamento

Abre cada rota no browser autenticando uma vez. Marca ✅ ou anota erro.

- [ ] `http://localhost:8787/` — landing carrega; card "★ COCKPIT EXECUTIVO" aparece no topo.
- [ ] `http://localhost:8787/ops/` — 4 bandas renderizam (saúde, riscos, marcos, drill). KPIs aparecem em 10-15s.
- [ ] `http://localhost:8787/timeline/` — Gantt cross-projeto renderiza.
- [ ] `http://localhost:8787/krzr/` — Service Desk carrega.
- [ ] `http://localhost:8787/krzr/hml` — v2 ITIL carrega.
- [ ] `http://localhost:8787/vena/` — Dev Venâncio carrega.
- [ ] `http://localhost:8787/vena/capacity` — Planner com drag-and-drop carrega.
- [ ] `http://localhost:8787/vena/roadmap` — Status report carrega.
- [ ] `http://localhost:8787/fst/` — Status report FST carrega.
- [ ] `http://localhost:8787/fst/capacity` — Planner FST carrega.

Em **cada uma**, abra o DevTools Console e verifique que **não há erro vermelho**. Warnings de CORS/cache são esperados.

### 3.2. Endpoints D1 (validar a Camada 1)

```bash
# Lista chaves (vazio no primeiro boot — esperado)
curl -u "$DASHBOARD_USER:$DASHBOARD_PASSWORD" http://localhost:8787/api/state/vena-roadmap

# Health check
curl http://localhost:8787/api/health
```

Esperado:
- `/api/state/...` → `{"scope":"vena-roadmap","items":[]}` ou items existentes
- `/api/health` → `{"ok":true,"ts":"..."}`

### 3.3. Funcional — persistência compartilhada

Esse é o teste-chave da Camada 1.

1. [ ] Em `/vena/roadmap`, edita o remark de um épico qualquer. Reload da página. **Remark persiste.**
2. [ ] Abre `/api/state/vena-roadmap` no browser. Vê `items` com `key:"remarks"`, `version:1` ou maior.
3. [ ] Abre `/api/state/vena-roadmap/remarks` direto. Vê o JSON com o texto que você acabou de digitar.
4. [ ] Em `/fst/`, edita um remark — mesmo teste.
5. [ ] Em `/vena/capacity`, faz um drag-and-drop de um épico, troca de track. Reload. **Posição persiste.**
6. [ ] Em `/vena/capacity`, salva um cenário com nome. Abre `/api/state/vena-capacity/scenarios`. **Cenário aparece.**

### 3.4. Funcional — `/ops/` com dados reais

1. [ ] `/ops/` mostra cards de saúde com cores (verde/amarelo/vermelho) baseadas no estado real do JIRA.
2. [ ] Lista de "Top riscos" tem pelo menos 1 item (provavelmente o Sustain informativo + atrasos reais).
3. [ ] Se houve drag-and-drop em `/vena/capacity` que projetou fim > due de algum épico, o sinal **`ATRASO PROJETADO`** aparece em `/ops/`.

### 3.5. Auditoria (subproduto de graça)

```bash
curl -u "$DASHBOARD_USER:$DASHBOARD_PASSWORD" "http://localhost:8787/api/audit?scope=vena-roadmap&limit=10"
```

Esperado: array com cada edição feita (`action:"set"`, `old_version`, `new_version`, `updated_by`, `ts`).

### 3.6. Conflito de concorrência (opcional)

- [ ] Abre `/vena/roadmap` em **duas abas** (sem reload entre elas). Edita o mesmo remark na aba A, depois na aba B sem recarregar a B. A escrita na aba B deve gerar `console.warn('remarks save failed: version conflict')`.

---

## 4. Se passou no checklist — commitar

A pasta atual tem 13 modificados + 11 untracked, sem commit. Há duas formas de commitar (escolha **uma**):

### Opção A — Aplicar o bundle (4 commits semânticos já organizados)

O bundle tem o histórico já estruturado em 4 commits limpos.

```bash
# 1. Stash do working tree atual (tudo vai pro bundle, então pode descartar)
git stash --include-untracked

# 2. Importa a branch do bundle
git fetch feat-ops-cockpit-and-d1.bundle feat/ops-cockpit-and-d1:feat/ops-cockpit-and-d1-bundle

# 3. Verifica o log
git log --oneline feat/ops-cockpit-and-d1-bundle -5

# Esperado:
# ba5d237 chore(hml): environment de homologacao, scripts e docs de roadmap
# e570752 feat(d1): persistencia compartilhada Camada 1 (D1 + cache local + audit)
# e2ff74a feat(ops): cockpit executivo /ops/ (Camada 0 do controle de operacao)
# c83aa5e refactor(shared): extrai tokens.css, capacity helpers e components
# 4e3d3fd chore: import Kruzer dashboards app

# 4. Faz a branch atual apontar pros commits do bundle
git reset --hard feat/ops-cockpit-and-d1-bundle
git branch -D feat/ops-cockpit-and-d1-bundle  # cleanup

# 5. Sanidade: o working tree deve estar limpo
git status  # esperado: "nothing to commit, working tree clean"

# 6. Remove o bundle (não precisa mais)
rm feat-ops-cockpit-and-d1.bundle
```

### Opção B — Commitar tudo manualmente (1 commit "big bang")

Se prefere não usar bundle:

```bash
git add -A
git commit -m "feat: cockpit /ops/, refactor shared, D1 Camada 1, env HML

Ver docs/HANDOFF_OPS_CONTROL.md pra contexto completo."
```

Menos limpo (perde a separação semântica), mas funciona.

---

## 5. O que NÃO fazer agora

| ❌ Não | ✋ Razão |
|---|---|
| `npx wrangler deploy` (sem --env) | Deploy direto **em prod**. Prod ainda não tem D1 configurado. Vai dar 503. |
| `bash scripts/deploy-hml.sh` ou `setup-hml.sh` | Criam D1 remoto e configuram secrets no Cloudflare. Mantém pra quando for promover. |
| `npx wrangler d1 create kruzer-state` (sem --local) | Cria recurso remoto na Cloudflare — não é o que esse handoff testa. |
| `git push origin feat/ops-cockpit-and-d1` antes de validar | Empurra antes de saber se funciona. Espera o checklist verde. |
| `git push origin main` ou rebase em main | Sobrescreve produção. Branch é segura, main NÃO. |
| Editar `wrangler.toml` na seção top-level | Só edite local se for o UUID dummy (passo 2.1). Não troque database_id real. |
| Aplicar migration em D1 remoto | `wrangler d1 execute kruzer-state --file=... --remote` — só quando for promover HML/prod. |

---

## 6. Quando tudo estiver verde

Próximos passos (ordem):

1. **Commit** (Opção A do passo 4).
2. **Push da branch** (não main): `git push -u origin feat/ops-cockpit-and-d1`.
   - Se permissão for negada (handoff §5 original mencionou que `matheusmereb-krzr` não tinha write), peça liberação ao admin do `kruzer-corp`.
3. **Abre PR no GitHub** apontando `feat/ops-cockpit-and-d1` → `main`. Revisar antes de mergear.
4. **Deploy em HML** (depois do merge ou direto da branch): seguir `docs/HANDOFF_HML_DEPLOY.md`.
5. **Deploy em prod**: só depois de HML validado com o checklist completo (também em `HANDOFF_HML_DEPLOY.md`).

---

## 7. Se algo falhar — onde olhar primeiro

| Sintoma | Provável causa | Onde olhar |
|---|---|---|
| `/ops/` mostra loading infinito | JQL falhou ou JIRA API token expirou | DevTools Network: olhar `/api/jira/jql`; ver se retorna 401 → token novo |
| Console: `KruzerState is not defined` | `shared/state.js` não foi servido | DevTools Network: ver se `/shared/state.js` retorna 200 |
| `503 STATE_DB binding not configured` | Wrangler não iniciou com binding D1 | Reiniciar `wrangler dev`, conferir wrangler.toml `[[d1_databases]]` |
| Remarks somem ao recarregar | D1 local não foi inicializado (passo 2.1) | Repetir `wrangler d1 execute kruzer-state --local --file=migrations/0001_init.sql` |
| Erro CORS / 401 inesperado | Auth do Basic Auth não foi passada | DevTools deve preservar auth header; tente reload com auth manual |
| Cor do KRZR mudou (era roxo, virou azul) | Refactor Fase A padronizou paleta | Esperado — handoff de UX confirmado |
| Engine de capacity calculou diferente | Engine ainda duplicada (gap G3 conhecido) | Não é regressão; planner publica → report espelha |

---

## 8. Para a Cowork — feedback que ajuda

Se algum item do checklist falhar, copie:
1. Output do `console.error` (DevTools).
2. Saída do `wrangler dev` (terminal).
3. Resultado do `curl /api/health` e `/api/state/vena-roadmap`.

Com isso eu consigo iterar daqui sem ficar empilhando suposições.
