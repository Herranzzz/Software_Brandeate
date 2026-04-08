#!/usr/bin/env bash

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Uso: $0 <DATABASE_URL> [dump_path]"
  exit 1
fi

DATABASE_URL="$1"
DUMP_PATH="${2:-/Users/jorge/Documents/Brandeate app/backups/3pl-local-2026-04-05.dump}"

if [[ ! -f "$DUMP_PATH" ]]; then
  echo "No existe el dump: $DUMP_PATH"
  exit 1
fi

echo "Base destino:"
psql "$DATABASE_URL" -At -c "select current_database(), current_user;"

echo "Conteos antes de restaurar:"
psql "$DATABASE_URL" -At -c "
select 'shops=' || count(*) from shops;
select 'orders=' || count(*) from orders;
select 'shipments=' || count(*) from shipments;
" || true

echo
echo "Restaurando dump desde: $DUMP_PATH"
pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --dbname="$DATABASE_URL" \
  "$DUMP_PATH"

echo
echo "Conteos después de restaurar:"
psql "$DATABASE_URL" -At -c "
select 'shops=' || count(*) from shops;
select 'orders=' || count(*) from orders;
select 'shipments=' || count(*) from shipments;
"
