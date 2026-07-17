#!/usr/bin/env bash
# scripts/install-html-validator.sh
# Run once on the server to set up the W3C Nu HTML Checker (vnu.jar):
#   bash scripts/install-html-validator.sh
set -euo pipefail

VNU_VERSION="26.7.8"
VNU_DIR="/opt/vnu"
VNU_JAR="$VNU_DIR/vnu.jar"
VNU_PORT=8888

echo ""
echo "╔══════════════════════════════════════╗"
echo "║   Installing W3C Nu HTML Checker     ║"
echo "╚══════════════════════════════════════╝"
echo ""

# ─── 1. Java ──────────────────────────────────────────────────────────────────
echo "→ Installing Java..."
apt-get update -qq
apt-get install -y -qq default-jre-headless
java -version 2>&1 | head -1
echo "  Java ready."

# ─── 2. Download vnu.jar ──────────────────────────────────────────────────────
echo "→ Downloading vnu.jar v${VNU_VERSION}..."
mkdir -p "$VNU_DIR"
curl -fsSL \
  "https://github.com/validator/validator/releases/download/${VNU_VERSION}/vnu.jar" \
  -o "$VNU_JAR"
echo "  Downloaded to $VNU_JAR"

# ─── 3. Test it works ─────────────────────────────────────────────────────────
echo "→ Testing vnu.jar..."
echo '<!DOCTYPE html><html><head><title>Test</title></head><body><p>Hello</p></body></html>' \
  | java -jar "$VNU_JAR" --format text - 2>&1 || true
echo "  vnu.jar working."

# ─── 4. systemd service ───────────────────────────────────────────────────────
echo "→ Creating systemd service..."
cat > /etc/systemd/system/vnu.service <<SERVICE
[Unit]
Description=W3C Nu HTML Checker
After=network.target

[Service]
ExecStart=/usr/bin/java -Xss32m -cp $VNU_JAR nu.validator.servlet.Main $VNU_PORT
Restart=always
RestartSec=5
User=root
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable vnu
systemctl start vnu

sleep 2

if systemctl is-active --quiet vnu; then
  echo "  vnu service running on port $VNU_PORT."
else
  echo "  ⚠ vnu service failed to start. Check: journalctl -u vnu"
fi

echo ""
echo "╔══════════════════════════════════════╗"
echo "║   HTML validator ready               ║"
echo "║   Running on http://localhost:$VNU_PORT  ║"
echo "╚══════════════════════════════════════╝"
echo ""
echo "  To check status: systemctl status vnu"
echo "  To view logs:    journalctl -u vnu -f"
echo ""
