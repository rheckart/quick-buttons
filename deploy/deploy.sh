#!/usr/bin/env bash
# One deploy of the Pet Meds bot. Run by hand over SSH, or by the `deploy`
# workflow, which is the same act pressed from a different keyboard.
#
# Order: render secrets, pull, swap the container, wait until the bot says it is
# polling Telegram, and roll back to the previous image if it never does.
# There is no separate migration step: the bot applies its own (idempotent,
# transactional) migrations on start, and it has no web endpoint to health-check,
# so "healthy" here means "logged that it is polling and stayed up".
set -euo pipefail

STACK="${PET_MEDS_STACK:-/docker/pet-meds}"
TAG="${1:-latest}"
HEALTH_SECONDS="${PET_MEDS_HEALTH_SECONDS:-90}"

say() { printf '==> %s\n' "$*"; }

# The tag arrives from a workflow input, so it is checked, not trusted.
if ! printf '%s' "$TAG" | grep -Eq '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$'; then
  echo "deploy: refusing tag '$TAG'" >&2
  exit 2
fi

cd "$STACK"

# Secrets first, so a token that expired overnight fails with the running bot
# untouched. PET_MEDS_SKIP_ENV_RENDER=1 is root's escape hatch for the day
# 1Password is the broken thing (or before it is set up: write .env by hand).
if [ "${PET_MEDS_SKIP_ENV_RENDER:-}" = "1" ]; then
  say "SKIPPING the 1Password render — .env is whatever is already on this box"
else
  ./render-env.sh
fi

REGISTRY_IMAGE=$(grep -E '^REGISTRY_IMAGE=' .env | cut -d= -f2-)
REGISTRY_IMAGE="${REGISTRY_IMAGE:-ghcr.io/rheckart/quick-buttons}"
IMAGE="$REGISTRY_IMAGE:$TAG"
PREVIOUS=$(grep -E '^PET_MEDS_IMAGE=' .env | cut -d= -f2-)

say "pulling $IMAGE"
docker pull "$IMAGE"

say "recording the image this stack runs"
if grep -q '^PET_MEDS_IMAGE=' .env; then
  sed -i "s|^PET_MEDS_IMAGE=.*|PET_MEDS_IMAGE=$IMAGE|" .env
else
  printf 'PET_MEDS_IMAGE=%s\n' "$IMAGE" >> .env
fi

STARTED=$(date -u +%Y-%m-%dT%H:%M:%SZ)
say "starting the bot"
# Same service name, so compose stops the old container before the new one
# polls: two pollers on one token would fight (HTTP 409). --force-recreate
# because the health check below waits for a fresh "polling" line: without it,
# redeploying the tag already running leaves the container untouched, no new
# line is logged, and a healthy deploy is reported as failed and rolled back.
docker compose up -d --force-recreate bot

say "waiting for the bot to say it is polling (up to ${HEALTH_SECONDS}s)"
for attempt in $(seq 1 $((HEALTH_SECONDS / 3))); do
  RUNNING=$(docker inspect -f '{{.State.Running}}' pet-meds-bot 2>/dev/null || echo false)
  if [ "$RUNNING" = "true" ] && docker logs --since "$STARTED" pet-meds-bot 2>&1 | grep -q 'polling Telegram as'; then
    # Polling started; give a crash-on-first-update a moment to show itself.
    sleep 5
    if [ "$(docker inspect -f '{{.State.Running}}' pet-meds-bot 2>/dev/null || echo false)" = "true" ]; then
      say "healthy: $(docker logs --since "$STARTED" pet-meds-bot 2>&1 | grep 'polling Telegram as' | tail -n 1)"
      say "deployed $IMAGE"
      exit 0
    fi
  fi
  sleep 3
done

say "the bot did not come up — last log lines:"
docker logs --tail 20 pet-meds-bot 2>&1 || true

if [ -z "$PREVIOUS" ]; then
  say "no previous image to roll back to. The failed image was $IMAGE"
  exit 1
fi
say "rolling back to $PREVIOUS"
sed -i "s|^PET_MEDS_IMAGE=.*|PET_MEDS_IMAGE=$PREVIOUS|" .env
docker compose up -d --force-recreate bot
say "rolled back. The failed image was $IMAGE"
say "note: the secrets were not rolled back; the file this deploy replaced is at $STACK/.env.previous."
exit 1
