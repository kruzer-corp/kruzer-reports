#!/bin/bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════════════════════
# Kruzer Dashboards — Setup completo de HML em um comando.
# Cria D1, atualiza wrangler.toml com o database_id, aplica migration, configura
# secrets, deploya. Idempotente: se o D1 já existe, segue; se já foi configurado,
# pula. Aborta na primeira falha.
#
# Pré-condição:
#   export CLOUDFLARE_API_TOKEN=...
#   export JIRA_EMAIL=matheus.mereb@kruzer.ai
#   export JIRA_API_TOKEN=...           # do .dev.vars
#   export JIRA_CLOUD_ID=dd987a38-5d13-4230-ab43-7141dc3695e1
#   export DASHBOARD_USER=kruzer
#   export DASHBOARD_PASSWORD=...
#   bash scripts/setup-hml.sh
# ═══════════════════════════════════════════════════════════════════════════════

GREEN='\033[0;32m'; BLUE='\033[0;34m'; RED='\033[0;31m'; YELLOW='\033[0;33m'; NC='\033[0m'

step() { echo -e "\n${BLUE}─── $1 ───${NC}"; }
ok()   { echo -e "${GREEN}✅ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
fail() { echo -e "${RED}❌ $1${NC}"; exit 1; }

# 0. Validações
[ -z "${CLOUDFLARE_API_TOKEN:-}" ] && fail "Export CLOUDFLARE_API_TOKEN antes de rodar."
[ -f wrangler.toml ] || fail "Rode no root do projeto (kruzer-dashboards/)."

# 1. Cria D1 HML (se não existir).
step "1/5 Criando D1 'kruzer-state-hml'"
DB_LIST=$(npx wrangler d1 list 2>/dev/null || true)
if echo "$DB_LIST" | grep -q "kruzer-state-hml"; then
  ok "D1 'kruzer-state-hml' já existe — pulando criação."
  # Pega o id existente
  DB_ID=$(echo "$DB_LIST" | grep "kruzer-state-hml" | awk '{for(i=1;i<=NF;i++) if (match($i, /^[a-f0-9-]{36}$/)) print $i}' | head -1)
else
  CREATE_OUT=$(npx wrangler d1 create kruzer-state-hml)
  echo "$CREATE_OUT"
  DB_ID=$(echo "$CREATE_OUT" | grep -E '^database_id\s*=' | sed -E 's/.*"([^"]+)".*/\1/')
  ok "D1 criado: $DB_ID"
fi
[ -z "${DB_ID:-}" ] && fail "Não consegui extrair database_id do output."

# 2. Substitui placeholder no wrangler.toml (se ainda for placeholder).
step "2/5 Atualizando wrangler.toml com database_id"
if grep -q "REPLACE_AFTER_RUNNING_d1_create_hml" wrangler.toml; then
  # macOS sed exige '' depois do -i; Linux não. Tenta os dois.
  sed -i.bak "s/REPLACE_AFTER_RUNNING_d1_create_hml/$DB_ID/" wrangler.toml 2>/dev/null || \
    sed -i '' "s/REPLACE_AFTER_RUNNING_d1_create_hml/$DB_ID/" wrangler.toml
  rm -f wrangler.toml.bak
  ok "wrangler.toml atualizado."
else
  ok "wrangler.toml já tem database_id real."
fi

# 3. Aplica migration no D1 remoto (idempotente — CREATE TABLE IF NOT EXISTS).
step "3/5 Aplicando schema (migrations/0001_init.sql) no D1 remoto"
npx wrangler d1 execute kruzer-state-hml --env hml --file=migrations/0001_init.sql --remote
ok "Schema aplicado."

# 4. Configura secrets pro environment hml.
step "4/5 Configurando secrets do env hml"
put_secret() {
  local name="$1" value="${2:-}"
  if [ -n "$value" ]; then
    printf '%s' "$value" | npx wrangler secret put "$name" --env hml
  else
    warn "$name não definido no env — pulando."
  fi
}
put_secret JIRA_EMAIL          "${JIRA_EMAIL:-}"
put_secret JIRA_API_TOKEN      "${JIRA_API_TOKEN:-}"
put_secret JIRA_CLOUD_ID       "${JIRA_CLOUD_ID:-}"
put_secret DASHBOARD_USER      "${DASHBOARD_USER:-}"
put_secret DASHBOARD_PASSWORD  "${DASHBOARD_PASSWORD:-}"
ok "Secrets processados."

# 5. Deploy.
step "5/5 Deploy"
npx wrangler deploy --env hml

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  HML no ar:                                                       ║${NC}"
echo -e "${GREEN}║  https://kruzer-dashboards-hml.matheus-mereb.workers.dev          ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "Validação rápida (deve retornar 401 sem auth, e a home com auth):"
echo "  curl -I https://kruzer-dashboards-hml.matheus-mereb.workers.dev"
echo "  curl -u kruzer:senha https://kruzer-dashboards-hml.matheus-mereb.workers.dev/api/health"
echo ""
echo -e "Checklist completo em ${BLUE}docs/HANDOFF_HML_DEPLOY.md${NC}"
