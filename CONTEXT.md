# Pet Meds

A shared log so a few family members can record pet medication in one tap, see whether it's done, and get nudged when it's due.

## Language

**Pet**:
An animal in the household that receives medication (e.g. Twiggy, Faith).

**Med**:
A specific medication given to a specific pet (e.g. Twiggy's eye drops).
_Avoid_: Medicine, drug

**Round**:
The group of daily meds (ongoing meds and courses) currently due for one pet at one of that pet's set times of day (e.g. "Twiggy evening"), logged together with one tap. A pet can have any number of rounds; their contents change as meds start and stop.
_Avoid_: Slot, batch

**Dose**:
One med given once, as recorded in the log, with when it was actually given (which may be earlier than when it was logged).
_Avoid_: Entry, given

**Giver**:
A family member who gives meds and is @mentioned by follow-up reminders.
_Avoid_: Caregiver, owner, user

**Admin**:
A family member listed by Telegram user ID in the settings file (Rob, Danielle) — the only people who can start, stop, or edit meds.
_Avoid_: Owner, manager

**Dose note**:
Optional short instructions on a med shown with its reminder (e.g. "2 drops each eye").
_Avoid_: Instructions, comment

**Reminder**:
The bot's message saying a round or monthly med is due, which becomes the "✅ Given by X at T" record once logged.
_Avoid_: Alert, notification

**Follow-up**:
A nudge sent halfway to late-after while something in a round is still not given; deleted once it's done.

**Quiet hours**:
The nightly window (10pm–7am) when no reminders are sent; anything due waits until it ends.

**Board**:
The pinned message in each pet's topic showing every round, monthly med and as-needed med with its done/not-done status, and a button to log each.
_Avoid_: Dashboard, status message

**Fix**:
A change to a logged round or med — which meds were given, or when — made from the ✏️ Fix button. The old version is kept and the message shows "✏️ edited by Y". Anyone can fix until the round's next reminder; after that, admins only.
_Avoid_: Edit, correction

**Undo**:
A fix that removes a log entirely, putting the round or med back to not given so reminders carry on.
_Avoid_: Delete, cancel

**Skipped**:
A med in a round deliberately marked as not given, so it stops counting as due.

**Late after**:
The time after which an unlogged round counts as late.

**Ongoing med**:
A daily med with no end date that continues until someone stops it (e.g. allergy med).

**Course**:
A med that runs for a set number of days, counted from its first dose (or from a "Started on" date an admin sets), then stops (e.g. an antibiotic for 10 days). Missed doses do not extend it.

**Monthly med**:
A med due one month after it was last given (e.g. Simparica Trio), logged on its own rather than in a round. Late once its due day ends.

**As-needed med**:
A med with no schedule. It can be logged, but it never comes due and never triggers a reminder.
