#!/usr/bin/env bash
# Render `.env` from `.env.tpl` through 1Password, and refuse to leave a broken
# one behind. Copied from Caballus's deploy/render-env.sh.
#
# Run by `deploy.sh`, and runnable on its own when a secret changed and nothing
# else did:
#
#   /docker/pet-meds/render-env.sh && cd /docker/pet-meds && docker compose up -d bot
#
# `up -d` rather than `restart`: a container reads `env_file` when it is created.
set -euo pipefail

STACK="${PET_MEDS_STACK:-/docker/pet-meds}"
TEMPLATE="$STACK/.env.tpl"
TOKEN_FILE="$STACK/op-token"
TARGET="$STACK/.env"

say() { printf '==> %s\n' "$*"; }
die() { printf 'render-env: %s\n' "$*" >&2; exit 1; }

umask 077

[ -r "$TEMPLATE" ] || die "no template at $TEMPLATE"
command -v op >/dev/null 2>&1 || die "the 1Password CLI is not installed — docs/deploy.md says how"
[ -r "$TOKEN_FILE" ] || die "no service-account token at $TOKEN_FILE"

MODE=$(stat -c '%a' "$TOKEN_FILE")
[ "$MODE" = "600" ] || die "$TOKEN_FILE is mode $MODE — it must be 600"

OP_SERVICE_ACCOUNT_TOKEN=$(tr -d '\r\n' < "$TOKEN_FILE")
[ -n "$OP_SERVICE_ACCOUNT_TOKEN" ] || die "$TOKEN_FILE is empty"
export OP_SERVICE_ACCOUNT_TOKEN

# The running tag is owned by the box, not the template: carry it across.
RUNNING_IMAGE=""
if [ -r "$TARGET" ]; then
  RUNNING_IMAGE=$(sed -nE 's/^PET_MEDS_IMAGE=(.*)$/\1/p' "$TARGET" | tail -n 1)
fi

NEXT="$STACK/.env.next"
trap 'rm -f "$NEXT"' EXIT

say "rendering $TEMPLATE through 1Password"
# Into a file beside the real one and never over it: a token that expired
# overnight must fail with the working `.env` untouched.
if ! op inject --in-file "$TEMPLATE" --out-file "$NEXT" --force; then
  die "op inject failed — .env is untouched. A reference it could not resolve is named above."
fi

if [ -n "$RUNNING_IMAGE" ]; then
  say "carrying PET_MEDS_IMAGE=$RUNNING_IMAGE across"
  sed -i "s|^PET_MEDS_IMAGE=.*|PET_MEDS_IMAGE=$RUNNING_IMAGE|" "$NEXT"
fi

if grep -q '{{' "$NEXT"; then
  die "the rendered file still contains a template reference — .env is untouched"
fi

for required in BOT_TOKEN DATABASE_URL POSTGRES_NETWORK REGISTRY_IMAGE; do
  value=$(sed -nE "s/^${required}=(.*)\$/\1/p" "$NEXT" | tail -n 1)
  [ -n "$value" ] || die "$required rendered empty — .env is untouched"
done

# A password with a stray newline is a refused connection with no hint why.
grep -qE '^DATABASE_URL=postgres://pet_meds:[^@[:space:]]+@[A-Za-z0-9_.-]+:5432/pet_meds$' "$NEXT" \
  || die "DATABASE_URL did not render into the expected shape — .env is untouched"

if [ -r "$TARGET" ]; then
  cp -p "$TARGET" "$STACK/.env.previous"
  say "the file being replaced is kept at $STACK/.env.previous"
fi

mv "$NEXT" "$TARGET"
chmod 600 "$TARGET"
trap - EXIT
say "wrote $TARGET"
