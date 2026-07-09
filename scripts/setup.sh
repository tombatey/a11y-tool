#!/usr/bin/env bash
# scripts/setup.sh
# Run once on a fresh Ubuntu 24.04 Droplet as root:
#   bash scripts/setup.sh
set -euo pipefail

DOMAIN="a11y.webdepend.dev"
APP_DIR="/var/www/a11y-tool"
DATA_DIR="/var/data/a11y-tool"
DB_NAME="a11y_tool"
DB_USER="a11y_user"
DB_PASS=$(openssl rand -hex 20)

echo ""
echo "╔══════════════════════════════════════╗"
echo "║   a11y-tool server setup             ║"
echo "╚══════════════════════════════════════╝"
echo ""

# ─── 1. System packages ───────────────────────────────────────────────────────
echo "→ Updating system packages..."
apt-get update -qq
apt-get install -y -qq \
  curl gnupg ca-certificates \
  debian-keyring debian-archive-keyring apt-transport-https \
  git rsync ufw

# ─── 2. Node.js 22 ───────────────────────────────────────────────────────────
echo "→ Installing Node.js 22..."
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - > /dev/null 2>&1
apt-get install -y nodejs > /dev/null 2>&1
node --version

# ─── 3. PostgreSQL 16 ─────────────────────────────────────────────────────────
echo "→ Installing PostgreSQL..."
apt-get install -y postgresql postgresql-contrib > /dev/null 2>&1
systemctl enable --now postgresql

# Create or update DB user, create DB if not exists
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
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

echo "  PostgreSQL ready."

# ─── 4. Caddy ─────────────────────────────────────────────────────────────────
echo "→ Installing Caddy..."
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | tee /etc/apt/sources.list.d/caddy-stable.list > /dev/null
apt-get update -qq
apt-get install -y caddy > /dev/null 2>&1

# Write Caddyfile
cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
    reverse_proxy localhost:3000

    # Cache static assets
    @static path *.js *.css *.png *.jpg *.svg *.ico *.woff2
    header @static Cache-Control "public, max-age=31536000, immutable"
}
CADDY

systemctl reload caddy
echo "  Caddy ready."

# ─── 5. PM2 ───────────────────────────────────────────────────────────────────
echo "→ Installing PM2..."
npm install -g pm2 --quiet
pm2 startup systemd -u root --hp /root | tail -1 | bash || true
echo "  PM2 ready."

# ─── 6. Playwright system dependencies ───────────────────────────────────────
echo "→ Installing Playwright browser dependencies (this takes a minute)..."
npx playwright install-deps chromium > /dev/null 2>&1 || true
npx playwright install chromium > /dev/null 2>&1 || true
echo "  Playwright dependencies ready."

# ─── 7. App and data directories ─────────────────────────────────────────────
echo "→ Creating directories..."
mkdir -p "$APP_DIR" "$DATA_DIR/screenshots"

# ─── 8. Firewall ──────────────────────────────────────────────────────────────
echo "→ Configuring firewall..."
ufw allow OpenSSH > /dev/null
ufw allow 80/tcp  > /dev/null
ufw allow 443/tcp > /dev/null
ufw --force enable > /dev/null
echo "  Firewall: SSH, HTTP, HTTPS allowed."

# ─── Done ─────────────────────────────────────────────────────────────────────
DATABASE_URL="postgresql://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME"

echo ""
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║   Setup complete — save these values                            ║"
echo "╠══════════════════════════════════════════════════════════════════╣"
echo "║"
echo "║  DATABASE_URL=$DATABASE_URL"
echo "║  DATA_DIR=$DATA_DIR"
echo "║"
echo "╠══════════════════════════════════════════════════════════════════╣"
echo "║   Next: run deploy.sh from your local machine, then create      ║"
echo "║   $APP_DIR/.env with the values above.        ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""
echo "  .env contents to create on the server:"
echo ""
echo "  DATABASE_URL=$DATABASE_URL"
echo "  DATA_DIR=$DATA_DIR"
echo "  PORT=3000"
echo ""
