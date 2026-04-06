#!/usr/bin/env sh
set -eu

PORT="${PORT:-8000}"

echo "Running database migrations..."
alembic upgrade head
echo "Migrations complete."

exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT}"
