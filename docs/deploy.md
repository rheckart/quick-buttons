# Deploying the Pet Meds bot

Same shape as Caballus (`github.com/rheckart/caballus`, `docs/deploy.md`): GitHub builds and stores the image, the VPS only ever **pulls**, and taking it live is a person pressing a button.

```
push to main ─► ci.yml: typecheck, build, test ─► image to ghcr.io/rheckart/quick-buttons
                                                   tags: <12-char commit> and latest
you press  Actions → deploy → Run workflow (tag)
   └─ SSH (key can ONLY run deploy.sh) ─► /docker/pet-meds/deploy.sh <tag>
         render .env from 1Password → docker pull → docker compose up -d bot
         → wait for "polling Telegram as @…" → roll back if it never says it
```

## What is in the repo

| File | What it does |
|---|---|
| `.github/workflows/ci.yml` | Typecheck, build, test on every push. On `main`, publishes the image. |
| `.github/workflows/deploy.yml` | Manual. SSHes to the VPS and runs `deploy.sh <tag>`. |
| `deploy/deploy.sh` | Lives on the VPS. Pull, swap, check, roll back. |
| `deploy/deploy-ssh.sh` | The deploy key's forced command. Lets the key deploy a tag and nothing else. |
| `deploy/render-env.sh`, `deploy/.env.tpl` | Builds `.env` from 1Password at deploy time. |
| `deploy/docker-compose.yml` | The one service, joined to Postgres's docker network. No ports. |

Differences from Caballus, on purpose: no separate migration step (the bot applies its own migrations when it starts), and no HTTP health URL (the bot has none, so "healthy" means it logged `polling Telegram as @…` and stayed up for 5 seconds).

## One-time setup

### 1. GitHub

```bash
# A deploy-only key. Keep the private half only in the GitHub secret.
ssh-keygen -t ed25519 -N '' -C github-actions-deploy@pet-meds -f /tmp/pet-meds-deploy
gh secret set VPS_SSH_KEY --repo rheckart/quick-buttons < /tmp/pet-meds-deploy
shred -u /tmp/pet-meds-deploy            # the public half (.pub) is used in step 2

# Where to deploy, and the box's public host key (so a swapped-out box fails loudly).
gh variable set VPS_HOST     --repo rheckart/quick-buttons --body 'your.vps.hostname'
gh variable set VPS_HOST_KEY --repo rheckart/quick-buttons --body "$(ssh-keyscan -t ed25519 your.vps.hostname 2>/dev/null | grep -v '^#' | cut -d' ' -f2-)"
# Optional: match pg_dump to your Postgres major version (default 18; a NEWER pg_dump than the server is fine).
gh variable set PG_MAJOR     --repo rheckart/quick-buttons --body '18'
```

If this is the same box as Caballus, `VPS_HOST` is `caballus.tech`.

### 2. On the VPS (as root)

```bash
mkdir -p /docker/pet-meds && cd /docker/pet-meds
# From a checkout of this repo, copy: deploy/{deploy.sh,deploy-ssh.sh,render-env.sh,.env.tpl,docker-compose.yml}
# and settings.example.yaml (rename to settings.yaml, fill it in, chmod 644).
chmod +x deploy.sh deploy-ssh.sh render-env.sh

# Let the deploy key run deploy.sh and nothing else. Use printf, not echo >>:
# a missing trailing newline in authorized_keys silently glues two keys together.
printf '%s\n' 'command="/docker/pet-meds/deploy-ssh.sh",restrict ssh-ed25519 AAAA…the .pub contents… github-actions-deploy@pet-meds' >> /root/.ssh/authorized_keys

# The VPS pulls the (private) image with a token of its own: a classic GitHub
# token with read:packages and nothing else.
docker login ghcr.io -u rheckart
```

Postgres: create the bot's own login and database (SQL is in the README, step 4). The compose file joins the docker network named by `POSTGRES_NETWORK` in `.env.tpl` (default `caballus_default`, where the Caballus Postgres is). If your Postgres is elsewhere, change that line and the host in `DATABASE_URL`.

### 3. Secrets

Pick one.

**1Password (what Caballus does).** Make a vault `PetMeds` with items `telegram` (field `bot-token`) and `postgres` (field `password`). Create a read-only service account for that vault and put its token in `/docker/pet-meds/op-token` (`chmod 600`). Install the `op` CLI as the Caballus runbook describes. Each deploy then renders `.env` from `.env.tpl`.

**By hand (simplest to start).** Write `/docker/pet-meds/.env` yourself (`chmod 600`):

```
BOT_TOKEN=…
DATABASE_URL=postgres://pet_meds:PASSWORD@postgres:5432/pet_meds
POSTGRES_NETWORK=caballus_default
REGISTRY_IMAGE=ghcr.io/rheckart/quick-buttons
PET_MEDS_IMAGE=
LOG_LEVEL=info
```

and deploy with `PET_MEDS_SKIP_ENV_RENDER=1` (see below). Move to 1Password whenever you like.

### 4. First deploy

Push to `main`, wait for `ci` to go green, then Actions → **deploy** → Run workflow → tag `latest`.

## A routine deploy

Push to `main`. When `ci` is green, press **deploy** with the 12-character commit (or `latest`). Publishing never deploys by itself.

If GitHub is the thing that is broken, do the same over SSH:

```bash
ssh root@your.vps.hostname /docker/pet-meds/deploy.sh <tag>
# without 1Password:  PET_MEDS_SKIP_ENV_RENDER=1 /docker/pet-meds/deploy.sh <tag>
```

## Changing settings or a secret

- **`settings.yaml`**: edit on the box, then `cd /docker/pet-meds && docker compose restart bot`. A mistake makes the bot refuse to start and print every problem; read `docker compose logs bot`.
- **A secret**: change it in 1Password, then run **deploy** again with the tag already running. (`up -d`, not `restart`: a container reads `.env` when it is created.)

## Rolling back

`deploy.sh` rolls back by itself when the bot never says it is polling. To go back by hand, deploy the previous commit's tag. The secrets are deliberately not rolled back; the previous `.env` is kept at `/docker/pet-meds/.env.previous`.

## Things that will bite

- **Only one poller per bot token.** Never run a second copy (a laptop, a second container) with the same `BOT_TOKEN`: Telegram answers 409 and the bot exits on purpose.
- **The host key is pinned.** If the VPS is rebuilt, update the `VPS_HOST_KEY` variable.
- **Not tested end to end.** `deploy.sh` and the SSH wrapper were exercised against a stubbed `docker`; the workflows and the real VPS have not been run.
