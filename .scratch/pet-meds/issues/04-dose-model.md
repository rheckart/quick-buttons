# What is a "dose", and what makes it due?

Type: grilling
Status: resolved
Blocked by: —

## Question

Pin down the dose model: pets, meds, schedules (daily AM/PM, course with an end date, monthly), what window counts as "on time", and whether one tap can log several meds at once ("antibiotic and allergy medicine given"). Output: a small glossary + rules everything else builds on.

## Answer

Glossary: [CONTEXT.md](../../../CONTEXT.md) (Pet, Med, Round, Dose, Skipped, Late after, Ongoing med, Course, Monthly med, As-needed med).

Current meds:
- **Twiggy, morning round**: antibiotic (course) + eye drops (ongoing).
- **Twiggy, evening round**: antibiotic (course) + allergy med (ongoing).
- **Twiggy** and **Faith**: Simparica Trio (monthly).

Rules:
1. One tap logs a whole **round**. Any med in it can be unticked first.
2. An unticked med stays "not given", and can still be reminded about, until the round is late. It can also be marked **skipped** on purpose, which stops it counting as due.
3. Each round has a **late after** time.
4. Each pet has its own round times, and any number of rounds.
5. A round's contents follow whatever meds are active, so courses join and leave.
6. A **course** runs N days from its first dose. Missed doses don't extend it; they just show as missed.
7. A **monthly med** has its own button, separate from rounds. It's due 1 month after it was last given, late once that due day ends, and fine to give early.
8. An **as-needed med** can be logged, but has no schedule and no reminders.
9. An early tap counts for that round. There's no "opens at" time.
10. Double-dose guard: tapping an already-logged round asks "Already given by X at T, log again?" before anything is saved.
11. A dose records when it was actually given. This defaults to the tap time and can be changed (e.g. "given at 7pm").
