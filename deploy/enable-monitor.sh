#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/root/informer-tributario"
ENV_FILE="$ROOT_DIR/back/.env"

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

set_env MONITOR_ENABLED true
set_env MONITOR_INTERVAL_MINUTES 20

systemctl restart informer
sleep 3
systemctl is-active --quiet informer

echo "Monitor automático ativo; intervalo: 20 minutos."
journalctl -u informer.service -n 15 --no-pager
