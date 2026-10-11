# Map: Pet meds — one tap, shared, with reminders

Label: wayfinder:map

## Destination

A build-ready spec for a small tool that lets 2–3 family members log a pet dose in one tap, see at a glance whether a dose is done, and get nudged when one is due or late — working on both an Android Pixel 8 and an iPhone.

**Reached:** the build-ready spec is [spec.md](spec.md).

## Notes

- Domain: household pet care. Pets: Twiggy (antibiotic, allergy med, eye drops) and Faith; both get Simparica Trio monthly. Today's log is the "Pet Stuff" Telegram group, one topic per pet.
- Pain to fix: typing each log by hand; not knowing fast if a dose was given (double/missed doses); no reminders.
- Schedules are mixed: daily AM/PM, short courses (antibiotic), monthly (Simparica).
- 2–3 people log doses. Telegram is not required — open to replacing it.
- Rob already has: Hostinger, Convex, a Telegram bot ("Hermes Agent"). Use only if they fit.
- Skills: `/grilling` + `/domain-modeling` for grilling tickets; `/research` for research tickets.
- Plan, don't build: produce decisions, not code.

## Decisions so far

<!-- one line per closed ticket -->

- [Which of Rob's existing platforms can host it?](issues/03-hosting.md) — Convex free tier is the best fit ($0, has a scheduler); the existing Hostinger VPS is the fallback; don't buy shared hosting.
- [What do existing shared pet-med trackers do?](issues/02-prior-art.md) — no proven app fits both phones; must-haves are logging without opening an app, a shared "given by X" status, and a reminder silenced everywhere by one log; courses are an unmet gap. Muzzly is the one worth a quick trial.
- [Which tap surfaces work on both Pixel 8 and iPhone?](issues/01-tap-surfaces.md) — a Telegram bot with inline buttons is the best fit: it shows who logged, shows status, and sends free reminders. An iOS Shortcut, a Pixel HTTP Shortcuts widget, or NFC can call one web endpoint for a 1-tap log. Native apps and web push cost more.
- [What is a "dose", and what makes it due?](issues/04-dose-model.md) — one tap logs a whole round (per pet, per time of day); each round has a late-after time; meds are ongoing, course (N days), monthly (own button, due 1 month after last), or as-needed; double-dose guard; logs can be backdated. Glossary in CONTEXT.md.
- [Which tap surface do we build on?](issues/05-pick-surface.md) — a new dedicated Telegram bot, posting reminders with a Given button and a pinned per-pet board in the existing pet topics; anyone in the group can tap; runs on the existing Hostinger VPS with long polling. Home-screen buttons later; NFC skipped.
- [When and how do reminders fire?](issues/06-reminder-rules.md) — reminder at the due time, a follow-up @mentioning givers halfway to late-after, then "⚠️ LATE" and stop; a tap edits it to ✅ and deletes follow-ups; monthly meds get a morning, evening, and next-day-late nudge; quiet hours 10pm–7am; course-finished notice.
- [How are meds and rounds set up and changed?](issues/07-managing-meds.md) — admins (Rob, Danielle) start, stop, and edit meds via bot buttons in a private chat, with each change announced in the pet's topic; pets, round times, givers, and quiet hours live in a hand-edited settings file on the server.
- [What do the bot's messages and buttons look like?](issues/09-bot-messages.md) — "one button, options tucked away": reminders show ✅ All given + ⚙️ Change (per-med ✅/✖/⏭ and given-at); the board is all buttons with status in the labels; the double-dose prompt is its own message; admins set up meds on one in-place draft card.
- [How is a wrong log fixed?](issues/08-fixing-mistakes.md) — a ✏️ Fix button on the logged reminder (or board) reopens the Change panel with 🗑 Undo; anyone can fix until the round's next reminder, then admins only via "📜 Fix a past log"; old versions kept, fixes are silent edits; undo puts the round back to not given; a course starts from its earliest remaining dose.
- [Where does the log live on the server, and how is it backed up?](issues/10-storage-backup.md) — the bot's own database in the existing Postgres on the VPS; done-status worked out fresh from the log; settings in a YAML file; nightly database export sent to Rob on Telegram on top of Hostinger's weekly backup; log kept forever; one restore test at setup.
- [Is the old Telegram history carried over?](issues/11-old-history.md) — start fresh, old messages stay in the topics; the Start med card gets a Last given (monthly) / Started on (course) date field, which also sets a course's start when given.

## Not yet specified

- (nothing — the way to the destination is clear)

## Out of scope

- Vet reports / history exports — not one of the pains picked; plain "what was given recently" is enough for now.
- [Do home-screen buttons land in this spec?](issues/12-home-screen-buttons.md) — iOS Shortcut / Pixel widget 1-tap buttons; the bot already gives one tap from reminders and the board, and these need a public endpoint + per-person secrets. Separate effort later.
