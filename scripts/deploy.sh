#!/bin/bash
set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Kruzer Dashboards — Deploy para Cloudflare Workers${NC}\n"

# ---------------------------------------------------------------------------
# Segredos: NÃO ficam hardcoded aqui. Defina como variáveis de ambiente antes
# de rodar (ou use `npx wrangler secret put <NOME>` manualmente). Ex.:
#   export CLOUDFLARE_API_TOKEN=...
#   export JIRA_EMAIL=...
#   export JIRA_API_TOKEN=...        # token do Atlassian (id.atlassian.com)
#   export JIRA_CLOUD_ID=...
#   export DASHBOARD_USER=...
#   export DASHBOARD_PASSWORD=...
#   bash scripts/deploy.sh
# ---------------------------------------------------------------------------

if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
  echo -e "${RED}❌ CLOUDFLARE_API_TOKEN não está setada${NC}"
  echo "  Gere em https://dash.cloudflare.com/profile/api-tokens (template 'Edit Cloudflare Workers')"
  echo "  e rode: export CLOUDFLARE_API_TOKEN=seu-token-aqui"
  exit 1
fi

echo -e "${GREEN}✅ CLOUDFLARE_API_TOKEN configurado${NC}\n"

# Configura os secrets do Worker a partir do ambiente (só os que estiverem setados).
put_secret() {
  local name="$1" value="$2"
  if [ -n "$value" ]; then
    printf '%s' "$value" | npx wrangler secret put "$name" --env production
  else
    echo -e "${RED}↷ $name não definido no ambiente — pulando (configure manualmente se necessário)${NC}"
  fi
}

echo -e "${BLUE}📝 Configurando secrets (a partir do ambiente)...${NC}"
put_secret JIRA_EMAIL          "$JIRA_EMAIL"
put_secret JIRA_API_TOKEN      "$JIRA_API_TOKEN"
put_secret JIRA_CLOUD_ID       "$JIRA_CLOUD_ID"
put_secret DASHBOARD_USER      "$DASHBOARD_USER"
put_secret DASHBOARD_PASSWORD  "$DASHBOARD_PASSWORD"

echo -e "${GREEN}✅ Secrets processados${NC}\n"

# Deploy
echo -e "${BLUE}🌐 Deployando para Cloudflare Workers...${NC}"
npm run deploy

echo -e "\n${GREEN}✅ Deploy concluído!${NC}"
echo "  URL: https://kruzer-dashboards.matheus-mereb.workers.dev"
