#!/bin/bash
set -e

# ═══════════════════════════════════════════════════════════════════════════════
# Kruzer Dashboards — Deploy HML (homologação)
# URL final: https://kruzer-dashboards-hml.matheus-mereb.workers.dev
#
# Pré-requisitos (uma vez):
#   1. wrangler d1 create kruzer-state-hml
#   2. Cole o database_id retornado em wrangler.toml [[env.hml.d1_databases]] →
#      database_id = "..."
#   3. wrangler d1 execute kruzer-state-hml --env hml --file=migrations/0001_init.sql --remote
#
# Uso:
#   export CLOUDFLARE_API_TOKEN=...
#   export JIRA_EMAIL=matheus.mereb@kruzer.ai
#   export JIRA_API_TOKEN=...
#   export JIRA_CLOUD_ID=dd987a38-5d13-4230-ab43-7141dc3695e1
#   export DASHBOARD_USER=kruzer
#   export DASHBOARD_PASSWORD=...
#   bash scripts/deploy-hml.sh
# ═══════════════════════════════════════════════════════════════════════════════

GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

ENV_FLAG="--env hml"

echo -e "${BLUE}🧪 Kruzer Dashboards — Deploy HML${NC}\n"

if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
  echo -e "${RED}❌ CLOUDFLARE_API_TOKEN não está setada${NC}"
  exit 1
fi
echo -e "${GREEN}✅ CLOUDFLARE_API_TOKEN configurado${NC}\n"

# Verificação: o database_id em [env.hml] foi substituído?
if grep -q 'REPLACE_AFTER_RUNNING_d1_create_hml' wrangler.toml; then
  echo -e "${RED}❌ wrangler.toml ainda tem placeholder no database_id de [env.hml].${NC}"
  echo -e "${YELLOW}Rode primeiro:${NC}"
  echo "   npx wrangler d1 create kruzer-state-hml"
  echo "   # Cole o database_id retornado em wrangler.toml [[env.hml.d1_databases]]"
  echo "   npx wrangler d1 execute kruzer-state-hml $ENV_FLAG --file=migrations/0001_init.sql --remote"
  exit 1
fi

put_secret() {
  local name="$1" value="$2"
  if [ -n "$value" ]; then
    printf '%s' "$value" | npx wrangler secret put "$name" $ENV_FLAG
  else
    echo -e "${YELLOW}↷ $name não definido — pulando${NC}"
  fi
}

echo -e "${BLUE}📝 Configurando secrets pro env HML…${NC}"
put_secret JIRA_EMAIL          "$JIRA_EMAIL"
put_secret JIRA_API_TOKEN      "$JIRA_API_TOKEN"
put_secret JIRA_CLOUD_ID       "$JIRA_CLOUD_ID"
put_secret DASHBOARD_USER      "$DASHBOARD_USER"
put_secret DASHBOARD_PASSWORD  "$DASHBOARD_PASSWORD"
echo -e "${GREEN}✅ Secrets processados${NC}\n"

echo -e "${BLUE}🌐 Deployando HML…${NC}"
npx wrangler deploy $ENV_FLAG

echo -e "\n${GREEN}✅ Deploy HML concluído!${NC}"
echo -e "   URL: ${BLUE}https://kruzer-dashboards-hml.matheus-mereb.workers.dev${NC}"
echo -e "   D1:  ${BLUE}kruzer-state-hml${NC} (isolado de prod)\n"
echo -e "${YELLOW}Próximo passo:${NC} abra a URL, autentique com DASHBOARD_USER/PASSWORD,"
echo -e "rode os dashboards (/ops/, /vena/roadmap, /fst/, planners) e valide:"
echo -e "  • Cards do /ops/ aparecem com semáforo;"
echo -e "  • Remarks/followups persistem entre reloads E entre navegadores;"
echo -e "  • Aba /api/state/vena-roadmap retorna lista de chaves após editar algo."
