# Pet Meds bot — build design

Source of truth for *what*: [.scratch/pet-meds/spec.md](.scratch/pet-meds/spec.md). Words: [CONTEXT.md](CONTEXT.md).
This file is *how it is built*. Shared types live in `src/types.ts` — the contract between modules.

## Stack
TypeScript, Node 22, ESM with `NodeNext` (**import with `.js` extensions**), `grammy`, `pg`, `yaml` + `zod`, `luxon`,
`vitest`, `@electric-sql/pglite` (tests only: real Postgres in-process, so SQL is exercised for real).
Check: `pnpm typecheck`, `pnpm test` (`pnpm vitest run test/x.test.ts` for one file).

## Module map (`src/`)
| Module | Job | Depends on |
|---|---|---|
| `types.ts` | Shared contracts | — |
| `time.ts` | Zone-aware helpers (luxon): local date/time of an instant, instant from date+time, add days/month, quiet-hours test, typed-time parsing | types |
| `config.ts` | Load + validate `settings.yaml` (zod). Refuses to start on any mistake | types, time |
| `db/` | `Db` impls (`pg`, PGlite), migrations, repositories (meds, entries, revisions, bot_messages, ui_state) | types |
| `domain/` | **Pure** functions: what's in a round, round/monthly status, course start/end, fix deadline, who may fix | types, time |
| `render/` | **Pure** functions: `RoundView` etc → `Rendered` (HTML text + keyboard); `callbacks.ts` encode/decode | types |
| `service/` | Use-cases on `Db` + `Messenger` + `Clock`: log, fix, undo, meds admin, `reconcile(now)` (sends/edits/deletes messages) | all above |
| `bot/` | grammy wiring: callbacks → service, private-chat admin flow, typed-input capture | service |
| `backup.ts` | nightly `pg_dump` → `Messenger.sendDocument` | |
| `main.ts` | wire config + db + bot + scheduler loop | |

## Rules that must hold everywhere
1. **Derive, never store, "done".** Round/med status is computed from `meds` + `log_entries` + the clock every time.
2. **Time zone** always from `Settings.timezone`. A "date" is a local date. Tests pass an explicit `Clock`.
3. **Callback data ≤ 64 bytes.** Buttons carry a `BotMessage.id` (`m`), never pet/med names.
4. **Every message with buttons has a `bot_messages` row**, so a callback can find its occurrence (pet, round/med, forDate).
5. **Panel state** (the unsaved ticks / given-at of an open Change panel, admin draft cards, "waiting for a typed time")
   lives in the `ui_state` key/value table (jsonb), keyed by `BotMessage.id` or chat. Survives restarts.
6. **Messages are re-rendered from the DB**, and edited only when `renderHash` changed.
7. **Reconcile is idempotent**: `reconcile(now)` computes which messages *should* exist for today/yesterday and
   creates/edits/deletes to match. Running it twice changes nothing. Scheduler ticks it every minute.
8. **Quiet hours**: scheduler-driven sends/edits wait until quiet hours end. User taps always work immediately.
9. Telegram failures: retry sends with backoff (3 tries); a failure never loses a log — log is written to the DB first.
10. Never put secrets in the repo. `BOT_TOKEN`, `DATABASE_URL`, `SETTINGS_PATH` come from env.

## Decisions made while building (spec §12 "builder's call")
- Pets with no rounds are allowed (monthly/as-needed only). Monthly reminders use `monthlyMorning`/`monthlyEvening`.
- A round is "logged" when none of its meds is pending (each is given or skipped). A partial log leaves a "Log the rest" button.
- Tapping a partially-logged round on the board logs the remaining meds; a fully-logged round opens the Fix panel.
- The double-dose prompt appears only if a med being logged already has an *active, given* dose for that round and date (or, for monthly meds, for the current occurrence).
- Typed "given at" times in the future are rejected (re-ask); no guessing yesterday.
- A monthly med's "next due" = (latest active given dose, else `seedLastGiven`) + 1 calendar month (clamped to month end); with neither, it is due on the day it was started.
- Fix deadline for a round entry = the round's next reminder after `forDate` (next day, at the round's effective due time); for monthly = the next due date's morning time; as-needed = 24h. After it, admins only.
- Board-opened and past-log panels are separate temporary `panel` messages, deleted when closed.
