#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/root/informer-tributario"
BACKEND_DIR="$APP_DIR/back"
ENV_FILE="$BACKEND_DIR/.env"
SERVICE_FILE="/etc/systemd/system/informer.service"
NGINX_FILE="/etc/nginx/sites-enabled/jurispr"
NGINX_BACKUP_DIR="/etc/nginx/backups"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Execute este script como root."
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Arquivo ausente: $ENV_FILE"
  exit 1
fi

if [[ ! -f "$NGINX_FILE" ]]; then
  echo "Arquivo ausente: $NGINX_FILE"
  exit 1
fi

mkdir -p "$NGINX_BACKUP_DIR"
find /etc/nginx/sites-enabled -maxdepth 1 -type f -name 'jurispr.backup*' \
  -exec mv -t "$NGINX_BACKUP_DIR" {} +
cp -a "$NGINX_FILE" "$NGINX_BACKUP_DIR/jurispr-$(date +%Y%m%d-%H%M%S)"

if ! grep -Eq '^BETTER_AUTH_SECRET=.{32,}$' "$ENV_FILE"; then
  auth_secret="$(openssl rand -hex 32)"
  if grep -q '^BETTER_AUTH_SECRET=' "$ENV_FILE"; then
    sed -i "s|^BETTER_AUTH_SECRET=.*$|BETTER_AUTH_SECRET=$auth_secret|" "$ENV_FILE"
  else
    printf '\nBETTER_AUTH_SECRET=%s\n' "$auth_secret" >> "$ENV_FILE"
  fi
  unset auth_secret
fi

cat > "$SERVICE_FILE" <<'EOF'
[Unit]
Description=Informer Tributario API
After=network-online.target ollama.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/root/informer-tributario/back
ExecStart=/usr/bin/node --env-file=/root/informer-tributario/back/.env /root/informer-tributario/back/src/server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

python3 - <<'PY'
from pathlib import Path

path = Path("/etc/nginx/sites-enabled/jurispr")
text = path.read_text(encoding="utf-8")

marker = "location /informer-api/"
needle = "location / {"
block = """
    location = /informer-api {
        return 302 /informer-api/api/health;
    }

    location /informer-api/ {
        proxy_pass http://127.0.0.1:3334/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

"""

if marker not in text:
    if needle not in text:
        raise SystemExit("Nao encontrei o bloco principal do JurisPR no Nginx.")
    text = text.replace(needle, block + needle, 1)
    path.write_text(text, encoding="utf-8")
PY

nginx -t

systemctl stop informer.service 2>/dev/null || true
if command -v fuser >/dev/null 2>&1; then
  fuser -k 3334/tcp 2>/dev/null || true
fi

systemctl daemon-reload
systemctl enable --now informer.service
systemctl reload nginx

sleep 2
curl -fsS http://127.0.0.1:3334/api/health
echo
curl -fsSL https://vps70435.publiccloud.com.br/informer-api
echo
systemctl --no-pager --full status informer.service | sed -n '1,12p'
echo
echo "Publicado em: https://vps70435.publiccloud.com.br/informer-api"
