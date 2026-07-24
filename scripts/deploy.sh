#!/usr/bin/env bash
# scripts/deploy.sh
# Deploy to staging or production.
#
# Usage:
#   ./scripts/deploy.sh staging      — deploy current branch to staging
#   ./scripts/deploy.sh production   — deploy main branch to production
#
set -euo pipefail

ENVIRONMENT=${1:?"Usage: ./scripts/deploy.sh staging|production"}
SERVER="root@104.248.164.90"

case "$ENVIRONMENT" in
  staging)
    APP_DIR="/var/www/a11y-tool-staging"
    PM2_NAME="a11y-tool-staging"
    BRANCH=$(git rev-parse --abbrev-ref HEAD)
    echo ""
    echo "→ Deploying branch '$BRANCH' to STAGING..."
    ;;
  production)
    APP_DIR="/var/www/a11y-tool"
    PM2_NAME="a11y-tool"
    BRANCH="main"
    # Safety check — must be on main or via promote.sh
    CURRENT=$(git rev-parse --abbrev-ref HEAD)
    if [ "$CURRENT" != "main" ]; then
      echo "⚠  You are on branch '$CURRENT', not 'main'."
      echo "   Run ./scripts/promote.sh first to merge develop → main."
      echo "   Or switch to main: git checkout main"
      read -rp "   Deploy anyway? (y/N) " CONFIRM
      if [ "${CONFIRM,,}" != "y" ]; then echo "Aborted."; exit 1; fi
    fi
    echo ""
    echo "→ Deploying branch '$BRANCH' to PRODUCTION..."
    ;;
  *)
    echo "Unknown environment: $ENVIRONMENT — use 'staging' or 'production'"
    exit 1
    ;;
esac

# Ensure destination directory exists on the server
ssh "$SERVER" "mkdir -p $APP_DIR"

# Sync code — .env and data/ are never overwritten
rsync -az --delete \
  --exclude '.env' \
  --exclude 'node_modules/' \
  --exclude 'data/' \
  --exclude '.git/' \
  ./ "$SERVER:$APP_DIR/"

echo "→ Installing dependencies, running migrations, restarting app..."
ssh "$SERVER" bash << REMOTE
  set -euo pipefail
  cd $APP_DIR

  npm install --omit=dev --quiet
  npx playwright install chromium > /dev/null 2>&1
  npm run db:migrate

  # Restart if running, otherwise start fresh
  if pm2 describe $PM2_NAME > /dev/null 2>&1; then
    pm2 restart $PM2_NAME
  else
    pm2 start src/server.js --name $PM2_NAME
  fi
  pm2 save
REMOTE

echo ""
echo "✓ Deployed to $ENVIRONMENT."
if [ "$ENVIRONMENT" = "staging" ]; then
  echo "  https://staging.a11y.webdepend.dev"
else
  echo "  https://a11y.webdepend.dev"
fi
echo ""

# Warn if .env is missing
ssh "$SERVER" test -f "$APP_DIR/.env" 2>/dev/null || {
  echo "⚠  No .env found at $APP_DIR/.env"
  echo "   SSH in and create it before the app will work."
  echo ""
}
