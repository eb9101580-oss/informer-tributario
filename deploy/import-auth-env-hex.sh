#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/root/informer-tributario"
ENV_FILE="$ROOT_DIR/back/.env"
PAYLOAD_HEX="${1:-}"

if [[ ! -f "$ENV_FILE" || -z "$PAYLOAD_HEX" ]]; then
  echo "Uso inválido do importador de ambiente." >&2
  exit 1
fi

PAYLOAD_FILE="$(mktemp)"
NEW_ENV="$(mktemp)"
trap 'rm -f "$PAYLOAD_FILE" "$NEW_ENV"' EXIT

python3 - "$PAYLOAD_HEX" "$PAYLOAD_FILE" <<'PY'
import sys

payload_hex, destination = sys.argv[1:]
with open(destination, 'wb') as output:
    output.write(bytes.fromhex(payload_hex))
PY

for key in DATABASE_URL AUTH_ADMIN_EMAIL AUTH_ADMIN_PASSWORD; do
  grep -q "^${key}=" "$PAYLOAD_FILE" || {
    echo "Variável obrigatória ausente no payload." >&2
    exit 1
  }
done

grep -Ev '^(DATABASE_URL|AUTH_ADMIN_EMAIL|AUTH_ADMIN_PASSWORD)=' "$ENV_FILE" > "$NEW_ENV"
cat "$PAYLOAD_FILE" >> "$NEW_ENV"
install -m 600 "$NEW_ENV" "$ENV_FILE"

systemctl restart informer
sleep 4
systemctl is-active --quiet informer

echo "Banco e autenticação configurados no VPS."
