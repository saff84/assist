#!/bin/sh
set -e

if [ "${RUN_DB_MIGRATIONS:-true}" = "true" ]; then
  echo "[EntryPoint] Applying database migrations (if needed)..."
  if pnpm drizzle-kit migrate; then
    echo "[EntryPoint] Database migrations are up to date."
  else
    echo "[EntryPoint] Migration command failed (likely because schema already exists). Continuing startup..."
  fi
else
  echo "[EntryPoint] Skipping database migrations (RUN_DB_MIGRATIONS=${RUN_DB_MIGRATIONS})."
fi

exec "$@"

