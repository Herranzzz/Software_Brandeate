#!/usr/bin/env sh
set -eu

PORT="${PORT:-8000}"

echo "Running database migrations..."
python scripts/safe_migrate.py
echo "Migrations complete."

exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT}"
