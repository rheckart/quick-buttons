#!/usr/bin/env bash
# Proves that backup + restore work, using a throwaway Postgres in Docker.
#   1. build the bot image (its pg_dump / pg_restore are the ones Rob will use), start postgres:17 on a
#      docker network and on a random localhost port (both removed on exit)
#   2. create the bot's role + database, apply the app schema, add sample rows (scripts/pg-check.ts also
#      checks the real `pg` code: select, bigint ids, commit, rollback)
#   3. dump with the app's own backup code (src/backup.ts, password via PGPASSWORD) and the image's pg_dump
#   4. restore into a scratch database EXACTLY as the README says: the image's pg_restore, run as the bot's
#      own role (pet_meds), so the restored tables belong to the bot
#   5. compare row counts + content of every table, as the bot role (a wrong owner fails with
#      "permission denied"), and check who owns the tables
# Needs: docker, pnpm. Usage: scripts/backup-restore-check.sh
#   PG_IMAGE=postgres:17   the server to test against (try postgres:16 with PG_MAJOR=17: client newer than server)
#   PG_MAJOR=17            client tools in the bot image (build arg of the Dockerfile)
#   BOT_IMAGE=<image>      use an existing bot image instead of building one
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE="${PG_IMAGE:-postgres:17}"
PG_MAJOR="${PG_MAJOR:-17}"
NAME="pet-meds-restore-check-$$"
NET="$NAME-net"
WORK="$(mktemp -d)"
ADMIN_PW="admin-pw"
BOT_PW='p@ss word'      # awkward on purpose: proves URL-decoding of the password
BOT_PW_URL='p%40ss%20word'
TABLES=(meds log_entries log_entry_items log_entry_revisions bot_messages ui_state schema_migrations)

BUILT_IMAGE=""
cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  [ -z "$BUILT_IMAGE" ] || docker rmi -f "$BUILT_IMAGE" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

step() { printf '\n== %s\n' "$*"; }
admin_psql() { docker exec -i -e PGPASSWORD="$ADMIN_PW" "$NAME" psql -v ON_ERROR_STOP=1 -q -h 127.0.0.1 -U postgres "$@"; }
bot_psql() { docker exec -i -e PGPASSWORD="$BOT_PW" "$NAME" psql -v ON_ERROR_STOP=1 -q -At -h 127.0.0.1 -U pet_meds "$@"; }

if [ -n "${BOT_IMAGE:-}" ]; then
  BOT="$BOT_IMAGE"
else
  step "Building the bot image (PG_MAJOR=$PG_MAJOR)"
  BOT="$NAME-bot"
  BUILT_IMAGE="$BOT"
  docker build -q --build-arg PG_MAJOR="$PG_MAJOR" -t "$BOT" . >/dev/null
fi
echo "bot image: $BOT ($(docker run --rm "$BOT" pg_restore --version))"

step "Starting $IMAGE"
docker network create "$NET" >/dev/null
docker run -d --name "$NAME" --network "$NET" -e POSTGRES_PASSWORD="$ADMIN_PW" -p 127.0.0.1::5432 "$IMAGE" >/dev/null
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

step "Dumping with src/backup.ts (pg_dump from the bot image)"
cat > "$WORK/pg_dump" <<WRAP
#!/bin/sh
# the bot image's pg_dump, talking to the server over the host network
exec docker run --rm -i --network host -e PGPASSWORD "$BOT" pg_dump "\$@"
WRAP
chmod +x "$WORK/pg_dump"
PG_DUMP_PATH="$WORK/pg_dump" pnpm --silent tsx scripts/backup-cli.ts "$URL" "$WORK/backup.dump"
[ "$(head -c 5 "$WORK/backup.dump")" = "PGDMP" ] || { echo "not a custom-format dump"; exit 1; }

step "Restoring into a scratch database (the README's command: bot image, as pet_meds)"
admin_psql -c "CREATE DATABASE restore_check OWNER pet_meds"
SERVER_MAJOR="$(admin_psql -At -c 'SHOW server_version_num' | cut -c1-2)"
RESTORE=(docker run --rm -i --network "$NET" -e PGPASSWORD="$BOT_PW" "$BOT"
  pg_restore -h "$NAME" -U pet_meds --no-owner --no-acl -d restore_check)
if [ "$SERVER_MAJOR" = "$PG_MAJOR" ]; then
  "${RESTORE[@]}" --exit-on-error < "$WORK/backup.dump"
else
  # A client newer than the server (README: allowed, but prefer PG_MAJOR = server): pg_restore 17 emits
  # SET transaction_timeout, which a 16 server rejects. Without --exit-on-error that is one harmless error;
  # the row comparison below is what proves the data came across.
  echo "note: server is $SERVER_MAJOR, pg_restore is $PG_MAJOR: restoring without --exit-on-error"
  "${RESTORE[@]}" < "$WORK/backup.dump" || echo "pg_restore reported errors (see above); checking the data"
fi
OWNERS="$(bot_psql -d restore_check -c "SELECT DISTINCT tableowner FROM pg_tables WHERE schemaname = 'public'")"
[ "$OWNERS" = "pet_meds" ] || { echo "restored tables are owned by: $OWNERS (expected pet_meds)"; exit 1; }
echo "restored tables are owned by pet_meds"

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
