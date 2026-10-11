# When and how do reminders fire?

Type: grilling
Status: resolved
Blocked by: 04, 05

## Question

When does a nudge go out, to whom, how does it escalate if still not done, and how does it go quiet once someone logs the dose?

## Answer

Glossary terms: Giver, Reminder, Follow-up, Quiet hours (see [CONTEXT.md](../../../CONTEXT.md)).

**Daily rounds** (e.g. due 8:00, late after 10:00):
1. At the round's due time, the bot posts a **reminder** in the pet's topic, with no @mentions.
2. Halfway to late-after (9:00), if anything is still not given, a **follow-up** @mentions the **givers** and lists only what's left (e.g. "eye drops still not given").
3. At late-after (10:00), if anything is still not given: "⚠️ LATE". Then nothing more is sent.
4. Once logged, the reminder is edited to "✅ Given by X at T", or "✅ Given late by X at T" after late-after. Follow-ups are deleted.
5. If the round was already logged before its due time, no reminder is posted.
6. An unticked med keeps the follow-up and late steps going until it's logged or marked skipped.

**Monthly meds**: a reminder on the due day at the pet's morning round time, another at the evening round time if still not given, and "⚠️ LATE" the next morning. Then it stops.

**Quiet hours** (10pm–7am): no messages are sent. Anything that falls due waits until 7am.

**Course end**: after a course's last day, the bot posts "<med> course finished 🎉".

**Givers**: a list configured alongside the meds. How it's edited is decided in "How are meds and rounds set up and changed?".
