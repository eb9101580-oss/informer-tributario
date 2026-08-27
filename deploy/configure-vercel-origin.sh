#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/root/informer-tributario"
ENV_FILE="$ROOT_DIR/back/.env"
PUBLIC_URL="https://informer-tributario.vercel.app"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Arquivo de ambiente não encontrado: $ENV_FILE" >&2
  exit 1
fi

set_env() {
  local key="$1"
  local value="$2"

  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

set_env FRONTEND_URL "$PUBLIC_URL"
set_env AUTH_FRONTEND_URL "$PUBLIC_URL"
set_env AUTH_TRUSTED_ORIGINS "$PUBLIC_URL"
set_env BETTER_AUTH_URL "$PUBLIC_URL"

systemctl restart informer
sleep 3
systemctl is-active --quiet informer

echo "Origem da Vercel autorizada no backend."
