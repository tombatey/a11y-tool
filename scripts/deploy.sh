#!/usr/bin/env bash
# scripts/deploy.sh
# Run from your local project root to push code and restart the app:
#   ./scripts/deploy.sh root@YOUR_DROPLET_IP
#
# For subsequent deploys, same command.
set -euo pipefail

SERVER=${1:?"Usage: ./scripts/deploy.sh root@YOUR_DROPLET_IP"}
APP_DIR="/var/www/a11y-tool"

echo ""
echo "→ Deploying to $SERVER..."

# Ensure destination directory exists on the server
ssh "$SERVER" "mkdir -p $APP_DIR"

# Sync code — excludes .env and data so they're never overwritten on the server
rsync -az --delete \
  --exclude '.env' \
  --exclude 'node_modules/' \
  --exclude 'data/' \
  --exclude '.git/' \
  ./ "$SERVER:$APP_DIR/"

echo "→ Installing dependencies and running migrations..."
ssh "$SERVER" bash <<REMOTE
  set -euo pipefail
  cd $APP_DIR

  # Install production deps (skips devDependencies)
  npm install --omit=dev --quiet

  # Install Chromium binary if not already present
  npx playwright install chromium > /dev/null 2>&1

  # Run DB migrations (safe to re-run — all CREATE IF NOT EXISTS)
  npm run db:migrate

  # Restart app, or start it if not running yet
  pm2 describe a11y-tool > /dev/null 2>&1 \
    && pm2 restart a11y-tool \
    || pm2 start ecosystem.config.js
  pm2 save
REMOTE

echo ""
echo "✓ Deployed. App is running on $SERVER."
echo ""

# Check if .env exists on the server — warn if not
ssh "$SERVER" test -f "$APP_DIR/.env" 2>/dev/null || {
  echo "⚠  No .env found on the server."
  echo "   SSH in and create $APP_DIR/.env with:"
  echo ""
  echo "   DATABASE_URL=postgresql://..."
  echo "   DATA_DIR=/var/data/a11y-tool"
  echo "   PORT=3000"
  echo ""
  echo "   Then run: pm2 restart a11y-tool"
  echo ""
}
