# What `.env` on the box is rendered from, by `render-env.sh`, at deploy time.
# Same rule as Caballus: the repository decides what is a literal; 1Password
# holds what only the deployment knows (a token, a password). 1Password is never
# in the startup path: the container reads a plain file.
#
# Every reference below must exist in the vault before the first render, or the
# render fails and the deploy stops with the running bot untouched.
# docs/deploy.md lists them.
#
# Do not write the reference scheme outside a moustache, not even in a comment:
# the render scans the whole file for it.

# --- Telegram ---------------------------------------------------------------
BOT_TOKEN={{ op://PetMeds/telegram/bot-token }}

# --- Postgres ---------------------------------------------------------------
# The bot's own login and database, never a superuser. The host is the Postgres
# container's name on POSTGRES_NETWORK (the Caballus stack calls it "postgres").
DATABASE_URL=postgres://pet_meds:{{ op://PetMeds/postgres/password }}@postgres:5432/pet_meds
POSTGRES_NETWORK=pg-petmeds

# --- Image ------------------------------------------------------------------
REGISTRY_IMAGE=ghcr.io/rheckart/quick-buttons
# The one value the box owns: deploy.sh writes the running tag here.
PET_MEDS_IMAGE=

LOG_LEVEL=info
