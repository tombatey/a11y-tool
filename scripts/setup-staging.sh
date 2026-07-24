#!/usr/bin/env bash
# scripts/setup-staging.sh
# One-time setup of the staging environment on the same Droplet.
# Run from the server as root:
#   bash /var/www/a11y-tool/scripts/setup-staging.sh
set -euo pipefail

APP_DIR="/var/www/a11y-tool-staging"
DATA_DIR="/var/data/a11y-tool-staging"
DB_NAME="a11y_tool_staging"
DB_USER="a11y_user_staging"
DB_PASS=$(openssl rand -hex 20)
PORT=3001
DOMAIN="staging.a11y.webdepend.dev"

echo ""
echo "╔══════════════════════════════════════╗"
echo "║   Staging environment setup          ║"
echo "╚══════════════════════════════════════╝"
echo ""

# ─── Directories ──────────────────────────────────────────────────────────────
echo "→ Creating directories..."
mkdir -p "$APP_DIR" "$DATA_DIR/screenshots"
echo "  Done."

# ─── PostgreSQL ───────────────────────────────────────────────────────────────
echo "→ Creating staging database..."
sudo -u postgres psql -v ON_ERROR_STOP=1 << SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$DB_USER') THEN
    CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';
  ELSE
    ALTER USER $DB_USER WITH PASSWORD '$DB_PASS';
  END IF;
END \$\$;
SELECT 'CREATE DATABASE $DB_NAME OWNER $DB_USER'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$DB_NAME')\gexec
GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;
SQL
echo "  Done."

# ─── Caddy vhost ──────────────────────────────────────────────────────────────
echo "→ Adding Caddy vhost for $DOMAIN..."
# Append staging block to Caddyfile if not already there
if ! grep -q "$DOMAIN" /etc/caddy/Caddyfile; then
  cat >> /etc/caddy/Caddyfile << CADDY

$DOMAIN {
    reverse_proxy localhost:$PORT
}
CADDY
  systemctl reload caddy
  echo "  Caddy updated."
else
  echo "  Caddy vhost already exists — skipping."
fi

# ─── Done ─────────────────────────────────────────────────────────────────────
DATABASE_URL="postgresql://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME"

echo ""
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║   Staging setup complete                                        ║"
echo "╠══════════════════════════════════════════════════════════════════╣"
echo "║"
echo "║  Now create $APP_DIR/.env with:"
echo "║"
echo "║  DATABASE_URL=$DATABASE_URL"
echo "║  DATA_DIR=$DATA_DIR"
echo "║  PORT=$PORT"
echo "║  APP_URL=https://$DOMAIN"
echo "║  GOOGLE_CLIENT_ID=<same as production or separate>"
echo "║  GOOGLE_CLIENT_SECRET=<same as production or separate>"
echo "║  SESSION_SECRET=$(openssl rand -hex 32)"
echo "║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""
echo "  Also add https://$DOMAIN/auth/google/callback"
echo "  to your Google OAuth app's authorised redirect URIs."
echo ""
echo "  Then deploy: ./scripts/deploy.sh staging"
echo ""
