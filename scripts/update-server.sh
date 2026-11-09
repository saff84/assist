#!/usr/bin/env bash
# Run from a checkout that already contains the reviewed security update.
# Does not pull/upgrade MySQL, Weaviate or Ollama, or delete any volumes.
set -euo pipefail
umask 077
project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
cd "$project_dir"
for command in docker python3 curl tar sha256sum flock; do
  command -v "$command" >/dev/null || { printf 'Missing command: %s\n' "$command" >&2; exit 1; }
done
mkdir -p .knowledge-backups
exec 9>.knowledge-backups/operation.lock
flock -n 9 || { printf 'Another update/knowledge backup or restore is running\n' >&2; exit 1; }
source scripts/active-compose-env.sh
test -f drizzle/0025_auth_session_version.sql || { printf 'Security migration is missing\n' >&2; exit 1; }
test -f vendor/xlsx-0.20.3.tgz || { printf 'Reviewed SheetJS archive is missing\n' >&2; exit 1; }
test -f scripts/check_update_storage.py && test -f scripts/document-inventory.sql
docker compose config --quiet
docker compose config --format json | python3 scripts/check_update_storage.py
app_id=$(docker compose ps -q app)
test -n "$app_id" || { printf 'A running app container is required for backup\n' >&2; exit 1; }
previous_image=$(docker inspect --format '{{.Image}}' "$app_id")
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_dir=${BACKUP_DIR:-"$project_dir/../assist-backups/$stamp"}
mkdir -p "$(dirname -- "$backup_dir")"
# Never overwrite a backup from a previous run or a reused BACKUP_DIR.
mkdir "$backup_dir"
backup_dir=$(cd "$backup_dir" && pwd -P)
if [ -f .env ]; then cp .env "$backup_dir/environment.env"; fi
cp docker-compose.yml "$backup_dir/docker-compose.yml"
if [ -n "${COMPOSE_FILE:-}" ]; then cp "$COMPOSE_FILE" "$backup_dir/active-compose.json"; fi
printf '%s\n' "$previous_image" > "$backup_dir/previous-image.txt"
git rev-parse HEAD > "$backup_dir/source-commit.txt"
git diff --binary > "$backup_dir/local-changes.patch"
docker image tag "$previous_image" "ai-assistant-rollback:$stamp"

# Build and validate without interrupting the running application.
docker compose build --pull app
candidate_ref=$(docker compose config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["app"]["image"])')
candidate_image=$(docker image inspect --format '{{.Id}}' "$candidate_ref")
printf '%s\n' "$candidate_image" > "$backup_dir/candidate-image.txt"
# Validate the runtime before stopping the current app; OCR/Python is not required.
docker run --rm --network none --entrypoint node "$candidate_image" --check /app/dist/index.js
docker compose config --format json | python3 scripts/check_update_storage.py

# Pause writes for a consistent DB + uploads backup.
app_stopped=0
cutover_started=0
cleanup() {
  if [ "$app_stopped" -eq 1 ] && [ "$cutover_started" -eq 0 ]; then
    docker start "$app_id" >/dev/null || true
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP
# Arm recovery before stopping: a failed/interrupted stop may still stop the app.
app_stopped=1
docker compose stop app
# Only InnoDB tables are covered consistently by --single-transaction.
nontransactional=$(docker compose exec -T mysql sh -ec 'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysql -uroot -N -B "$MYSQL_DATABASE" -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_type=\"BASE TABLE\" AND engine<>\"InnoDB\""')
test "$nontransactional" = 0 || { printf 'Non-InnoDB tables found: a consistent backup is required\n' >&2; exit 1; }
docker compose exec -T mysql sh -ec 'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysql -uroot -N -B "$MYSQL_DATABASE"' < scripts/document-inventory.sql > "$backup_dir/document-counts-before.tsv"
docker compose exec -T mysql sh -ec 'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysqldump -uroot --single-transaction --routines --triggers --events --hex-blob --set-gtid-purged=OFF "$MYSQL_DATABASE"' > "$backup_dir/database.sql"
test -s "$backup_dir/database.sql"
docker run --rm --network none --read-only --volumes-from "$app_id:ro" --entrypoint tar "$previous_image" -C /app/uploads -czf - . > "$backup_dir/uploads.tgz"
tar -tzf "$backup_dir/uploads.tgz" >/dev/null
(cd "$backup_dir"; sha256sum database.sql uploads.tgz > SHA256SUMS; sha256sum -c SHA256SUMS)

# Entrypoint applies migrations before starting the new app. Never fail open.
cutover_started=1
docker compose up -d --no-deps app
ready=0
for attempt in $(seq 1 90); do
  if docker compose exec -T app node -e 'fetch("http://127.0.0.1:3000/healthz", {signal: AbortSignal.timeout(1500)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done
if [ "$ready" -ne 1 ]; then
  printf 'New app did not become healthy. Backups: %s\n' "$backup_dir" >&2
  printf 'Inspect docker compose logs --tail=100 app. No automatic DB rollback was attempted.\n' >&2
  exit 1
fi
docker compose exec -T mysql sh -ec 'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysql -uroot -N -B "$MYSQL_DATABASE"' < scripts/document-inventory.sql > "$backup_dir/document-counts-after.tsv"
python3 scripts/check_update_storage.py --inventory "$backup_dir"
docker compose ps
printf 'Update healthy. Backups: %s\n' "$backup_dir"
printf 'Check login, widget consent, a document attachment, a known RAG question and PDF text/manual table processing.\n'
