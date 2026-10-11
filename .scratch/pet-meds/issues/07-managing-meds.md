# How are meds and rounds set up and changed?

Type: grilling
Status: resolved
Blocked by: 05

## Question

On the chosen surface: who can start a course, stop an ongoing med, add a pet, change round times and late-after times, or edit the givers list — and from where (bot command, web page, editing a file)? How often does this happen in practice?

## Answer

Glossary terms: Admin, Dose note (see [CONTEXT.md](../../../CONTEXT.md)).

1. **Who**: only **admins** (Telegram group admins: Rob, Danielle) can change meds. Anyone in the group can still log doses.
2. **How often**: a few times a year, mostly after vet visits.
3. **Med changes**: made by admins in a private chat with the bot, using buttons. Non-admins get no setup answers there.
   - **Start**: pet, med name, kind (ongoing / course / monthly / as-needed), which rounds, days (courses only), and an optional **dose note** shown on reminders.
   - **Stop**: ends the med immediately (e.g. the vet stops a course early).
   - **Edit**: change a running med's days, rounds, or dose note.
4. **Announcements**: every start, stop, or edit posts a line in the pet's topic (e.g. "Rob started Antibiotic: 10 days, morning + evening").
5. **Settings file**: rarely changed setup lives in a file on the server that Rob edits by hand: pets, round times, late-after times, givers, quiet hours.
