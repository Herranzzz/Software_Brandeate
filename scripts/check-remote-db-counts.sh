#!/usr/bin/env bash

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Uso: $0 <DATABASE_URL>"
  exit 1
fi

DATABASE_URL="$1"

psql "$DATABASE_URL" -At -c "
select 'shops=' || count(*) from shops;
select 'orders=' || count(*) from orders;
select 'shipments=' || count(*) from shipments;
"
