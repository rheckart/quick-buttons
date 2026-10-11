#!/usr/bin/env bash
# What the CI deploy key is allowed to do, and the whole of it. Installed as the
# key's forced command, so a leaked key can deploy a tag and cannot open a shell.
set -euo pipefail

COMMAND="${SSH_ORIGINAL_COMMAND:-}"
TAG=$(printf '%s' "$COMMAND" | sed -nE "s|^/docker/pet-meds/deploy\.sh '?([A-Za-z0-9_][A-Za-z0-9_.-]{0,63})'?\$|\1|p")

if [ -z "$TAG" ]; then
  echo "refused: this key may only run /docker/pet-meds/deploy.sh <tag>" >&2
  exit 2
fi

exec "${PET_MEDS_STACK:-/docker/pet-meds}/deploy.sh" "$TAG"
