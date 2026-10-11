# What do existing shared pet-med trackers do?

Type: research
Status: resolved
Blocked by: —

## Question

Survey existing apps/tools for shared pet (or family) medication logging on Android + iOS. Which features matter (one-tap log, shared status, reminders, courses vs recurring)? Is there one that already solves all three pains cheaply — and if so, what would building our own still add? Feeds the spec's feature list.

## Answer

Findings: branch `research/prior-art`, file `research/prior-art.md`. It covers 13 apps and is based on store listings only. No app was installed or tested.

- No proven app solves all three pains for a family on both Android and iPhone.
- **DogLog** ($3.99/mo or $39.99/yr, ads on Android): works on both, with a shared log and an alert when someone logs. Listings mention no one-tap logging and no reminders that repeat.
- **Muzzly** ($17.99/yr): lists every feature we want (one-tap "Taken" from the notification, reminders that repeat until answered, widgets). But it's brand new (~100 installs), syncs through Google Drive, and Android↔iPhone sharing is unconfirmed. Worth a 15-minute hands-on trial.
- **Meal Time For Pets**, **PetPill**, **PetMed**: good designs, but iPhone only.
- Features that matter for our spec: logging without opening an app, a shared "given by X at time T" status, and a reminder that goes quiet for everyone once anyone logs the dose.
- Gap: no app advertises fixed-length **courses** (e.g. antibiotic for 10 days, then stop). Building our own adds that, plus the same experience on both phones and no subscription.
- Not worth building: health records, vaccines, vet exports (already out of scope).
