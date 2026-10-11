#!/usr/bin/env bash
# Proves that backup + restore work, using a throwaway Postgres in Docker.
#   1. start postgres:17 on a random localhost port (removed on exit)
#   2. create the bot's role + database, apply the app schema, add sample rows (scripts/pg-check.ts also
#      checks the real `pg` code: select, bigint ids, commit, rollback)
#   3. dump with the app's own backup code (src/backup.ts, password via PGPASSWORD)
#   4. pg_restore into a scratch database and compare row counts + content of every table
# Needs: docker, pnpm. Usage: scripts/backup-restore-check.sh   (PG_IMAGE=postgres:17 by default)
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE="${PG_IMAGE:-postgres:17}"
NAME="pet-meds-restore-check-$$"
WORK="$(mktemp -d)"
ADMIN_PW="admin-pw"
BOT_PW='p@ss word'      # awkward on purpose: proves URL-decoding of the password
BOT_PW_URL='p%40ss%20word'
TABLES=(meds log_entries log_entry_items log_entry_revisions bot_messages ui_state schema_migrations)

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

step() { printf '\n== %s\n' "$*"; }
admin_psql() { docker exec -i -e PGPASSWORD="$ADMIN_PW" "$NAME" psql -v ON_ERROR_STOP=1 -q -h 127.0.0.1 -U postgres "$@"; }
bot_psql() { docker exec -i -e PGPASSWORD="$BOT_PW" "$NAME" psql -v ON_ERROR_STOP=1 -q -At -h 127.0.0.1 -U pet_meds "$@"; }

step "Starting $IMAGE"
docker run -d --name "$NAME" -e POSTGRES_PASSWORD="$ADMIN_PW" -p 127.0.0.1::5432 "$IMAGE" >/dev/null
PORT="$(docker port "$NAME" 5432/tcp | head -1 | sed 's/.*://')"
ready() { docker exec "$NAME" pg_isready -q -h 127.0.0.1 -U postgres; }
for _ in $(seq 1 60); do
  # the image first runs a temporary server without TCP, so test over TCP and require two answers in a row
  ready && sleep 1 && ready && break
  sleep 1
done
ready || { echo "postgres did not start"; exit 1; }
echo "postgres is up on 127.0.0.1:$PORT"

step "Creating the bot's own role and database (same SQL as the README)"
admin_psql <<SQL
CREATE ROLE pet_meds LOGIN PASSWORD '$BOT_PW';
CREATE DATABASE pet_meds OWNER pet_meds;
SQL
URL="postgres://pet_meds:$BOT_PW_URL@127.0.0.1:$PORT/pet_meds"

step "Applying the schema and exercising the pg code"
pnpm --silent tsx scripts/migrate-cli.ts "$URL"
pnpm --silent tsx scripts/pg-check.ts "$URL"

step "Dumping with src/backup.ts"
cat > "$WORK/pg_dump" <<WRAP
#!/bin/sh
# pg_dump from the same image, talking to the container over the host network
exec docker run --rm -i --network host -e PGPASSWORD "$IMAGE" pg_dump "\$@"
WRAP
chmod +x "$WORK/pg_dump"
PG_DUMP_PATH="$WORK/pg_dump" pnpm --silent tsx scripts/backup-cli.ts "$URL" "$WORK/backup.dump"
[ "$(head -c 5 "$WORK/backup.dump")" = "PGDMP" ] || { echo "not a custom-format dump"; exit 1; }

step "Restoring into a scratch database (pg_restore)"
admin_psql -c "CREATE DATABASE restore_check OWNER pet_meds"
docker exec -i -e PGPASSWORD="$BOT_PW" "$NAME" \
  pg_restore -h 127.0.0.1 -U pet_meds --no-owner --exit-on-error -d restore_check < "$WORK/backup.dump"

step "Comparing rows"
fingerprint() { # prints "table count md5-of-all-rows" per table, for database $1
  local db="$1" t
  for t in "${TABLES[@]}"; do
    printf '%s ' "$t"
    bot_psql -d "$db" -c "SELECT count(*), coalesce(md5(string_agg(x::text, '|' ORDER BY x::text)), '-') FROM $t x" | tr '|' ' '
  done
}
fingerprint pet_meds > "$WORK/original.txt"
fingerprint restore_check > "$WORK/restored.txt"
cat "$WORK/restored.txt"

if awk '$2 == 0 { bad = 1 } END { exit bad }' "$WORK/original.txt" && diff -u "$WORK/original.txt" "$WORK/restored.txt"; then
  printf '\nRESULT: OK - backup restored, every table matches (row counts and contents).\n'
else
  printf '\nRESULT: FAILED - restored data differs from the original (or a table was empty).\n'
  exit 1
fi
