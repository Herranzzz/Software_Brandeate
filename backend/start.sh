#!/usr/bin/env sh
set -eu

PORT="${PORT:-8000}"
# 2 workers lets the API keep serving while one is busy on a slow CTT call.
# Override with WEB_CONCURRENCY when sizing for a bigger Render plan.
WEB_CONCURRENCY="${WEB_CONCURRENCY:-2}"

echo "Running database migrations..."
PYTHONPATH=. python scripts/safe_migrate.py
echo "Migrations complete."

exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT}" --workers "${WEB_CONCURRENCY}"
