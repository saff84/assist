#!/bin/sh
set -e

if [ "${RUN_DB_MIGRATIONS:-true}" = "true" ]; then
  echo "[EntryPoint] Applying database migrations (if needed)..."
  MIGRATION_DATABASE_URL="${DATABASE_URL}"
  if [ -n "${MIGRATION_DATABASE_URL}" ]; then
    case "${MIGRATION_DATABASE_URL}" in
      *\?*) MIGRATION_DATABASE_URL="${MIGRATION_DATABASE_URL}&multipleStatements=true" ;;
      *) MIGRATION_DATABASE_URL="${MIGRATION_DATABASE_URL}?multipleStatements=true" ;;
    esac
  fi

  if DATABASE_URL="${MIGRATION_DATABASE_URL}" pnpm drizzle-kit migrate; then
    echo "[EntryPoint] Database migrations are up to date."
  else
    if [ "${MIGRATIONS_FAIL_OPEN:-false}" = "true" ]; then
      echo "[EntryPoint] Migration command failed but MIGRATIONS_FAIL_OPEN=true. Continuing startup..."
    else
      echo "[EntryPoint] Migration command failed. Aborting startup."
      exit 1
    fi
  fi
else
  echo "[EntryPoint] Skipping database migrations (RUN_DB_MIGRATIONS=${RUN_DB_MIGRATIONS})."
fi

exec "$@"

