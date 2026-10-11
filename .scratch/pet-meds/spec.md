# Spec: Pet Meds bot

A Telegram bot that lets 2–3 family members log a pet's meds in one tap, see at a glance whether a dose is done, and get nudged when one is due or late. Works the same on an Android Pixel 8 and an iPhone, because it lives inside Telegram.

- Word list: [CONTEXT.md](../../CONTEXT.md). Every **bold term** below is defined there.
- Where each decision came from: [map.md](map.md) and its tickets in `issues/`.
- Message layouts mockup: `bot-messages-PROTOTYPE.html?variant=B` on branch `prototype/pet-meds-bot-messages`.

## 1. The problem

The family logs pet meds in the "Pet Stuff" Telegram group, with one topic per pet, by typing messages. That is slow, it's hard to tell fast if a dose was given (so doses get doubled or missed), and nothing reminds anyone.

## 2. Shape of the solution

- A **new, dedicated Telegram bot**. Not the existing "Hermes Agent" bot.
- It posts in the existing per-pet topics (Twiggy, Faith) of the "Pet Stuff" group.
- Anyone in the group can log. The logger is their Telegram account.
- **Admins** (Rob, Danielle — listed by Telegram user ID in the settings file) set up meds in a private chat with the bot.
- It runs on Rob's Hostinger KVM 2 VPS (`srv1636442`, Ubuntu 24.04, Docker + Traefik). It uses **long polling** (`getUpdates`), so it needs no public URL or webhook.

## 3. Domain model

### Pets and rounds
- Each **pet** has its own **rounds**: named times of day (e.g. "Twiggy morning" due 8:00), each with a **late after** time (e.g. 10:00). A pet can have any number of rounds.
- A round's contents are whatever daily meds (ongoing + courses) are active for that pet in that round. Courses join and leave automatically.

### Med kinds
| Kind | Schedule | Logged | Ends |
|---|---|---|---|
| **Ongoing med** | Daily, in one or more rounds | With its round | When an admin stops it |
| **Course** | Daily, in one or more rounds, for N days | With its round | N days after **Started on** if set, otherwise after the earliest dose still in the log. Missed doses don't extend it. |
| **Monthly med** | Due 1 month after it was last given | On its own button | When an admin stops it |
| **As-needed med** | None, never due, never reminded | On its own button | When an admin stops it |

Each med may have a **dose note** (e.g. "2 drops each eye") shown on its reminders.

### Logging rules
1. One tap logs a whole round. Any med in it can be unticked first.
2. An unticked med stays "not given" and keeps triggering follow-ups until late-after, unless it's marked **skipped**.
3. An early tap counts for that round. There's no "opens at" time.
4. A monthly med is fine to give early. It's late once its due day ends.
5. **Double-dose guard**: logging an already-logged round or med asks "Already given by X at T, log again?" before saving.
6. A **dose** records when it was actually given. This defaults to the tap time and can be backdated.
7. "Is it done?" is always **worked out fresh from the log** (e.g. "is there a dose for this round today?"). There are no stored done flags.

### Current meds (day-one setup)
- Twiggy morning: antibiotic (course) + eye drops (ongoing).
- Twiggy evening: antibiotic (course) + allergy med (ongoing).
- Twiggy and Faith: Simparica Trio (monthly).

## 4. Messages and buttons

Layout style: "one button, options tucked away" (prototype variant B).

### Reminder
- Text: "☀️ Twiggy morning: Antibiotic + Eye drops", the dose notes as bullets, and "Late after 10:00".
- Buttons: **✅ All given** and **⚙️ Change…**
- **Change…** edits the same message to show one row per med (`✅` / `✖ not yet` / `⏭ skip`), then **🕐 Given at 8:15 (now) ▸**, **« Back**, and **✅ Log these**.
- **Given at** offers Now / 15 min / 30 min / 1 h / 2 h ago, or **⌨️ Type a time**, which asks for a reply like "7:45" or "7pm".
- **After logging**, the message becomes "✅ Given by X at T". It adds "(logged T)" if backdated, and says "Given late" if logged after late-after. It lists the meds given, "⏭ Skipped: …" and "⏳ Still to give: …". If anything is left, one button logs the rest. A **✏️ Fix** button stays on the message (see §6).

### Board
- One pinned message per pet topic, kept up to date by the bot.
- Title: "📋 Twiggy · tap to log". Below it, one full-width button per round, monthly med and as-needed med. The status is in the label:
  - "☀️ Morning · ✅ Rob 8:15", "⏳ due 8:00", "🔜 18:00", "⚠️ LATE", "◐ Eye drops left"
  - "📅 Simparica · due Tue 14 Oct"
  - "💧 Ear cleaner · last 2 Oct"
- One tap logs the whole round. Tapping an already-logged round opens the Fix panel (§6).

### Double-dose prompt
A separate message in the topic: "⚠️ Twiggy morning was already given by X at T. Log it again?" with **Yes, log again** / **Cancel**. It's deleted once answered.

## 5. Reminders

### Daily rounds (e.g. due 8:00, late after 10:00)
1. At the due time, post a **reminder** in the pet's topic, with no @mentions. Skip it if the round is already logged.
2. Halfway to late-after (9:00), if anything is still not given, post a **follow-up** that @mentions the **givers** and lists only what's left.
3. At late-after (10:00), if anything is still not given, mark it "⚠️ LATE". Then send nothing more.
4. Once logged, edit the reminder to ✅ (§4) and **delete the follow-ups**.

### Monthly meds
A reminder on the due day at the pet's morning round time. Another at the evening round time if it's still not given. "⚠️ LATE" the next morning. Then stop.

### Other
- **Quiet hours** (10pm–7am): nothing is sent. Anything that falls due waits until 7am.
- **Course end**: after a course's last day, post "<med> course finished 🎉" in the pet's topic.
- As-needed meds never trigger reminders.

## 6. Fixing a wrong log

1. A logged reminder keeps a **✏️ Fix** button. Tapping a logged round on the board does the same thing. It opens the Change panel: tick or untick meds, change "given at", or **🗑 Undo**.
2. **Anyone** in the group can fix any log, until that round's next reminder. After that, admins only (point 6).
3. **Old versions are kept.** The message shows "✏️ edited by Y", and an undo leaves "↩️ Undone by Y" in the history.
4. A fix **quietly edits the message**. No new message, no ping.
5. **Undo = not given.** The ✅ All given button comes back, and follow-ups and LATE carry on as normal. A monthly med's next due date goes back to what it was. A course's start moves if its first dose is undone and no Started on date is set.
6. **Older logs**: admins use **📜 Fix a past log** in the private chat. Pick the pet, pick from its last ~2 weeks of logs, then use the same Change panel.

## 7. Admin: managing meds (private chat)

- Only admins get the setup menu. Anyone else who messages the bot gets: "only admins can change meds — you can still log doses in Pet Stuff."
- Menu: **➕ Start** / **⏹ Stop** / **✏️ Edit** / **📜 Fix a past log**.
- **Start** opens one **draft card** message, edited in place. It lists Pet, Name, Kind, Rounds, Days (courses), Dose note, **Last given** (monthly; sets the next due date) and **Started on** (courses; default "first dose"), with a button per field. Text fields ask you to type. **✅ Start** only works once the card is complete.
- **Stop**: pick the med, then confirm. It ends immediately.
- **Edit**: pick the med, then change one field (days, rounds, or dose note).
- Every start, stop or edit is **announced** in the pet's topic, e.g. "Rob started Antibiotic: 10 days, morning + evening".
- Expect this a few times a year, mostly after vet visits.

## 8. Settings file

A YAML file next to the bot, edited by hand by Rob. Restart the bot to pick up changes. The bot checks the file for mistakes when it starts, and refuses to start if it finds one.

It holds:
- pets and their topic IDs
- each pet's rounds: name, due time, late-after time
- **givers** (Telegram users @mentioned by follow-ups)
- **admins**, as Telegram user IDs (Rob, Danielle). Only these users get the setup menu.
- quiet hours (default 22:00–07:00)
- the time zone (e.g. `America/New_York`), which every time in the file and every reminder uses

## 9. Storage and backup

- **Postgres**: Rob's existing Postgres on the VPS, with **its own database and its own login** for the bot. It holds the dose log (including old versions kept by fixes and undos), the meds, and whatever Telegram message IDs the bot needs to edit or delete messages later.
- The log is **kept forever**.
- **Backups**:
  - Hostinger already backs up the whole server once a week and keeps the last 2.
  - On top of that, every night the bot runs `pg_dump` on its database and sends the file to Rob in a private Telegram chat.
- **Restore test**: at first setup, restore one backup into a scratch database to prove it works. Write the restore steps in the README.

## 10. Starting out

- **Start fresh**: none of the old typed logs are imported. The old messages stay in the topics, and the board is pinned on top.
- On day one, admins add the current meds with the Start card. They set **Last given** for each Simparica and **Started on** for the running antibiotic.

## 11. Out of scope

- Vet reports and history exports.
- Home-screen one-tap buttons (iOS Shortcut, Pixel widget). These would need a public endpoint behind Traefik and a secret link per person. Possible later as a separate project.
- NFC tags.
- Native apps and web push.

## 12. Left to the builder

Decided after the map:
- **Language**: TypeScript (Node, in Docker).
- **Time zone**: set in the settings file.
- **Admins**: Telegram user IDs listed in the settings file. Not looked up from the group's admin list.

Still the builder's call (pick sensibly and note the choice):
- The database schema and the exact YAML layout.
- Retrying failed Telegram sends.
