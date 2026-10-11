<img src="assets/icon.svg" width="64" height="64" alt="">

# Pet Meds bot

A Telegram bot for the "Pet Stuff" group. It posts a reminder in each pet's topic when a round of meds is due (morning, evening, a monthly pill). Anyone taps **All given**, and the message turns into "Given by Rob at 8:15". If something is still missing halfway to the late time, it nudges the givers. A pinned board in each topic shows what is done at a glance.

It runs on the VPS in Docker, talks to Telegram by long polling (no public URL, no Traefik), and keeps everything in its own Postgres database. A `pg_dump` goes to your private chat every night.

Words used here are defined in [CONTEXT.md](CONTEXT.md). What it should do is in [the spec](.scratch/pet-meds/spec.md). How it is built is in [DESIGN.md](DESIGN.md).

## One-time setup

Do these in order. Each step needs something from the one before.

### 1. BotFather: create the new bot

1. In Telegram, open @BotFather and send `/newbot`. Pick a name and a username. **Make a new bot. Do not reuse Hermes.**
2. Copy the token it gives you (`123456:ABC...`). Treat it like a password. It goes in `.env` later.
3. `/setprivacy`: leave it on the default, **Enable**. With privacy mode on, the bot still gets what it needs: button taps, `/commands`, and replies to its own messages (typed times use Telegram's "reply" prompt for exactly this reason). Once the bot is a group admin (next step), Telegram sends it every message anyway, so this setting hardly matters. If you ever change the privacy setting, remove and re-add the bot to the group for it to take effect.

### 2. Add the bot to the Pet Stuff group as an admin

Add the bot to the group, then make it an **admin** with:

- **Pin messages** (for the board)
- **Delete messages** (for follow-ups and prompts that clean up after themselves)

"Manage topics" is not needed. Nothing else is needed either.

### 3. Learn the ids

The settings file wants numbers, not names. The bot can tell you them, but it needs to run first, so do this after steps 4 to 6 with a throwaway `settings.yaml` (placeholders are fine; it must still pass the checks, so copy `settings.example.yaml` unchanged; errors in the log about posting to the placeholder chat are expected until the real ids are in). Then:

- In **each pet topic** of the Pet Stuff group, send `/ids`. Since Hermes is in the group too, `/ids@YourBotUsername` makes sure only this bot answers.
- In a **private chat** with the bot, send `/ids` (once for you, once from Danielle's phone).

It replies in this exact format:

```
chat_id=-1001234567890 topic_id=11 user_id=111111111
```

- `chat_id` of the group (negative number) becomes `group_chat_id`.
- `topic_id` in each pet's topic becomes that pet's `topic_id`.
- `user_id` of each person goes into `admins` and `givers`.

Then put the real numbers in `settings.yaml` and restart the bot (step 9).

### 4. Create the Postgres role and database

The bot gets its **own login and its own database**. Never give it a superuser. On the VPS, as your Postgres admin (adjust the container and role names to yours):

```bash
docker exec -it <postgres-container> psql -U <admin-role>
```

```sql
CREATE ROLE pet_meds LOGIN PASSWORD 'PUT-A-LONG-RANDOM-PASSWORD-HERE';
CREATE DATABASE pet_meds OWNER pet_meds;
REVOKE CONNECT ON DATABASE pet_meds FROM PUBLIC;
GRANT CONNECT ON DATABASE pet_meds TO pet_meds;
SELECT version();
```

(`openssl rand -hex 24` makes a good password with no characters that need escaping.)

`SELECT version();` prints something like `PostgreSQL 16.4 ...`. **The first number is your `PG_MAJOR`.** The bot's backup tool (`pg_dump`) refuses to dump a server newer than itself, so `PG_MAJOR` must be the same as, or newer than, the server. Put it in `docker-compose.yml` (`args: PG_MAJOR`). The default is 17.

The bot creates its own tables the first time it starts.

### 5. Fill in settings.yaml

```bash
cp settings.example.yaml settings.yaml
chmod 644 settings.yaml     # the container runs as a non-root user and must be able to read it
```

`settings.yaml` is not committed (it is in `.gitignore`). Every key:

| Key | Meaning |
|---|---|
| `timezone` | Zone name like `America/New_York`. Every time in this file and every reminder uses it. |
| `group_chat_id` | The Pet Stuff group (negative number, from `/ids`). |
| `admins` | Telegram user ids who get the setup menu (start, stop, edit meds, fix old logs). At least one. |
| `givers` | People the follow-ups @mention: `{ user_id, name }`. |
| `quiet_hours` | `start` / `end`. Nothing is sent in this window; it can cross midnight. Default `22:00` to `07:00`. Optional. |
| `backup.chat_id` | The private chat that gets the nightly dump. Default: the first admin. Optional. |
| `backup.time` | When the nightly backup runs. Default `03:00`. Optional. |
| `pets[].name` | Display name, e.g. `Twiggy`. |
| `pets[].id` | Optional. Internal name (lowercase, dashes). Default: made from the name. Never change it later, it ties the pet to its history. |
| `pets[].topic_id` | The pet's topic (from `/ids` sent in that topic). |
| `pets[].rounds[]` | Any number per pet, or none (Faith only has a monthly med). Each has `name`, `due` (reminder time), `late_after` (must be after `due`), and optional `emoji`. |
| `pets[].monthly_reminders` | Optional `morning` / `evening` times for monthly meds. Default: the pet's first and last round, or `09:00` / `18:00`. |

Times are 24h and in quotes: `"08:00"`. A typo in a key name is an error, on purpose.

### 6. Build and run

```bash
cp .env.example .env                              # then fill in BOT_TOKEN and DATABASE_URL
cp docker-compose.example.yml docker-compose.yml  # then set PG_MAJOR and the Postgres network
docker compose up -d --build
docker compose logs -f pet-meds-bot
```

In `.env`, `DATABASE_URL` looks like `postgres://pet_meds:PASSWORD@<postgres-container>:5432/pet_meds`. If the password has special characters, URL-encode them (`@` is `%40`, `/` is `%2F`, `#` is `%23`, `%` is `%25`). The bot reaches Postgres through a shared docker network: the commented `networks:` part of the compose file shows how to join the one your Postgres is on. No ports are published. Traefik is not involved.

### 7. First day: add the current meds

1. Open a **private chat** with the bot and press Start. (Do this for the backup chat too: a bot cannot message someone who has never started it.)
2. Send any message. As an admin you get the menu: **Start / Stop / Edit / Fix a past log**.
3. **Start** each med on the draft card. Set each field with its button, then press **Start**:
   - Twiggy, **Antibiotic**: kind *course*, rounds *morning + evening*, number of days, **Started on** = the day the first dose was actually given.
   - Twiggy, **Eye drops**: *ongoing*, round *morning*, dose note (e.g. "2 drops each eye").
   - Twiggy, **Allergy med**: *ongoing*, round *evening*.
   - Twiggy and Faith, **Simparica Trio**: *monthly*, **Last given** = the date each one actually got it. That sets the next due date.
4. Each start is announced in the pet's topic, and the pinned board appears there.

### 8. Backups, and the restore test

The bot sends `pg_dump` output to the backup chat every night at `backup.time`. If the bot was down at that time it runs when it comes back that day. If the dump fails, or is over Telegram's 50 MB bot upload limit, you get a text message about it instead. Hostinger also snapshots the whole server weekly; that is the second layer.

**Do the restore test once, now, and again if you change servers or Postgres versions.** A backup you have never restored is a guess.

1. Wait for a nightly dump (or run one by hand, see below). Download it from Telegram to the VPS, e.g. `pet-meds-2026-10-11-0300.dump`.
2. Restore it into a **scratch** database. Use your Postgres admin role, because the bot's role cannot create databases:

   ```bash
   docker exec -i <postgres-container> psql -U <admin-role> -c "CREATE DATABASE pet_meds_restore_test OWNER pet_meds"
   docker exec -i <postgres-container> pg_restore -U <admin-role> --no-owner --exit-on-error \
     -d pet_meds_restore_test < pet-meds-2026-10-11-0300.dump
   ```

3. Compare row counts with the live database (the numbers should match, or the restored one may be a little behind if doses were logged after the dump):

   ```bash
   for DB in pet_meds pet_meds_restore_test; do
     echo "== $DB"
     docker exec -i <postgres-container> psql -U <admin-role> -d "$DB" -At -c "
       SELECT 'meds', count(*) FROM meds UNION ALL
       SELECT 'log_entries', count(*) FROM log_entries UNION ALL
       SELECT 'log_entry_items', count(*) FROM log_entry_items UNION ALL
       SELECT 'log_entry_revisions', count(*) FROM log_entry_revisions UNION ALL
       SELECT 'bot_messages', count(*) FROM bot_messages UNION ALL
       SELECT 'ui_state', count(*) FROM ui_state UNION ALL
       SELECT 'schema_migrations', count(*) FROM schema_migrations"
   done
   ```

4. Delete the scratch database: `docker exec -i <postgres-container> psql -U <admin-role> -c "DROP DATABASE pet_meds_restore_test"`.

To really restore after a disaster: create an empty `pet_meds` database owned by `pet_meds` (step 4), run `pg_restore` as above with `-d pet_meds`, start the bot.

If Postgres is not in Docker, drop the `docker exec -i <postgres-container>` part and run the same `psql` / `pg_restore` commands directly.

**Dry run without touching your server:** `scripts/backup-restore-check.sh` starts a throwaway `postgres:17` container, applies the app's schema, adds sample rows, backs up with the bot's own backup code, restores into a scratch database and compares every table. It cleans up after itself. Needs Docker and `pnpm install`.

**Take a backup by hand** (from a checkout with `pg_dump` installed): `pnpm tsx scripts/backup-cli.ts "$DATABASE_URL" out.dump`.

### 9. Updating, restarting, logs

```bash
git pull
docker compose up -d --build        # rebuild and restart after a code update
docker compose restart pet-meds-bot # after editing settings.yaml
docker compose logs -f --tail 100 pet-meds-bot
docker compose down                 # stop (data stays in Postgres)
```

The bot picks up `settings.yaml` only at start. Database changes (new tables) are applied automatically at start and are safe to repeat.

### 10. Troubleshooting

- **The bot says nothing in a topic.** Is it an admin of the group (step 2)? Is `topic_id` right for that topic (`/ids` inside it)? Look at `docker compose logs pet-meds-bot`: "Telegram topic ... is gone" means the topic was deleted or `topic_id` is wrong; "Make the bot an admin" means rights.
- **Buttons do nothing, or the logs show no updates.** Another process may be polling with the same token (an old container, or the token reused elsewhere). Telegram allows one poller per bot.
- **"Refuses to start."** The log lists every problem in `settings.yaml`, one per line, with its path (for example `pets[0].rounds[1].late_after: must be after due`). Fix them all, then restart.
- **Cannot read settings file.** Check the volume path in the compose file and that the file is readable by everyone (`chmod 644`).
- **Times are off.** Everything uses `timezone` in `settings.yaml`, not the server's clock. Check that and that you typed times as 24h (`"18:00"`).
- **Nightly backup alerts say `pg_dump failed`.** Read the message in the alert. Typical causes: `PG_MAJOR` older than the server ("server version mismatch": rebuild with the right number), or a wrong password in `DATABASE_URL`.
- **No backup arrives.** The backup chat must have pressed Start on the bot once (step 7), and `backup.chat_id` must be a user id, not a group.

## How it behaves

- **Rounds.** Each pet has named times of day. At the due time the bot posts a reminder (no @mentions) unless that round is already logged. One tap on **All given** logs the whole round. **Change...** lets you untick a med, mark one **skipped**, or set when it was really given.
- **Follow-up.** Halfway to the late time, if something is still not given, the bot @mentions the givers and lists only what is left. At the late time it marks the round **LATE** and sends nothing more. When the round is logged, the follow-ups are deleted.
- **Monthly meds** are due one month after they were last given. Reminder on the due day (morning), another that evening if still not given, "LATE" the next morning, then quiet. Giving one early is fine.
- **As-needed meds** can be logged any time and never trigger reminders.
- **Courses** run N days from **Started on** (or the first dose still in the log). Missed doses do not extend them. When one ends the bot posts "... course finished".
- **Quiet hours** (default 22:00 to 07:00): the bot sends nothing; whatever fell due waits until the end. Your own taps always work.
- **Double-dose guard.** Logging something already logged asks "Already given by X at T. Log again?" first.
- **Fixing.** Anyone can fix a log (**Fix** button, or tap the round on the board) until that round's next reminder; after that only admins can, from **Fix a past log** in the private chat. Old versions are kept. **Undo** puts the round back to not given.
- **Done is never stored.** It is worked out fresh from the log every time.
- **The log is kept forever.** Nothing is deleted from the database.

## Decisions the builder made

Where the spec left it open:

- Pets with no rounds are allowed (monthly or as-needed only). Monthly reminders use `monthlyMorning` / `monthlyEvening`.
- A round is "logged" when none of its meds is pending (each is given or skipped). A partial log leaves a "Log the rest" button.
- Tapping a partially-logged round on the board logs the remaining meds; a fully-logged round opens the Fix panel.
- The double-dose prompt appears only if a med being logged already has an *active, given* dose for that round and date (or, for monthly meds, for the current occurrence).
- Typed "given at" times in the future are rejected (the bot asks again); it does not guess yesterday.
- A monthly med's next due date is (latest active given dose, else `Last given`) plus one calendar month, clamped to month end; with neither, it is due the day it was started.
- The fix deadline for a round entry is the round's next reminder after its date (next day, at the round's due time); for monthly, the next due date's morning time; for as-needed, 24 hours. After it, admins only.
- Board-opened and past-log panels are separate temporary messages, deleted when closed.

Deploy and backup:

- Telegram sends are retried 3 times in total: a rate limit (429) waits as long as Telegram asks; network errors and Telegram 5xx wait 1 s then 3 s. A retry after a lost network reply can, rarely, post a message twice.
- Harmless Telegram errors ("message is not modified", "message to edit/delete not found", "can't be deleted") are logged and ignored.
- Messages go out with link previews off. Backup files are sent without a notification sound.
- The database password is passed to `pg_dump` through the `PGPASSWORD` environment variable, never on the command line, and is scrubbed from any error text.
- Backup file names use your time zone: `pet-meds-YYYY-MM-DD-HHmm.dump`.
- The image is Debian-based with the Postgres client from the official PostgreSQL apt repository, matching `PG_MAJOR`. It runs as a non-root user and has no secrets baked in.
