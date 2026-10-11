# Prior art: shared pet (and family) medication trackers

Research date: 2026-10-10. Sources are the apps' own store listings and websites, read on that date. Apple listings show version dates without the year. All feature claims are the vendors' marketing copy; none of the apps were installed or tested.

The three pains this research checks against:

1. **Typing each log.** Can a dose be logged with one tap (notification action, widget, quick button)?
2. **Not knowing if a dose was given.** Do all members share one live status, and are others told when someone logs a dose?
3. **No reminders.** Are there dose reminders, and do they go to everyone or keep repeating until someone logs?

Requirement: 2-3 family members on a mix of Android and iPhone, at low cost.

## Comparison

Legend: Y = the listing says so, N = the listing does not mention it or says it is absent, ? = unclear or not verified.

| App | Android | iPhone | Cross-platform shared log | One-tap log | Others notified when logged | Dose reminders | Reminder repeats / goes to whole group | Price for sharing | Traction |
|---|---|---|---|---|---|---|---|---|---|
| **DogLog** | Y | Y | ? (implied: one account-based "Pack" on both stores) | ? | Y | Y | ? | $3.99/mo or $39.99/yr; contains ads; free vs. paid split not published | 100K+ Android installs; 4.8 on iOS from 1.4K ratings |
| **Muzzly** | Y | Y | ? | Y (from the notification) | ? ("change tracking") | Y (persistent) | Y (carers reminded a few minutes after the owner) | Premium. iOS: $2.99/mo, $17.99/yr, $39.99 lifetime | 100+ Android installs; no iOS rating |
| **VigilClan** | Y (app) | Browser only | Y (family logs from a mobile browser) | Y | Y ("notified instantly") | Y | ? | No in-app purchases listed | 10+ installs |
| **Notepet** | Y | N (not found) | Android only | Y ("log it with one tap") | ? ("in sync in real time") | Y | ? | Free tier; Plus $1.99-$44.99 | 1K+ installs; 2.6 stars |
| **Tailog** | Y | Y | Y (stated explicitly) | ? | ? | N (appointments only, no dose reminders) | N | Premium $1.99/mo or $19.99/yr; contains ads | 10+ installs |
| **Pett** (iOS) | ? (a Play app with the same name has a different developer) | Y | ? | Y (from the notification) | Partly (shows name and time; alerts only in Away mode) | Y (every caretaker gets them) | Y (to all caretakers) | Free for 2 pets, all caretakers included | 2 iOS ratings |
| **Meal Time For Pets** | N | Y | iOS only | Y (Quick Log, widgets) | Y | Y (Premium) | Y (up to 3 repeats; everyone, one person, or rotating) | Group (2 members) $1.99, or $19.99/yr | 4.3 from 46 ratings |
| **PetPill** | N | Y | iOS only (iCloud) | Y (notification, widget, Lock Screen, Watch) | Y (household sees doses instantly) | Y | ? | Pro $3.49/mo, $34.99/yr, $59.99 lifetime | 5 ratings |
| **PetMed** | N | Y | iOS only | Y (notification actions, widget) | ? | Y | ? | Premium $4.99/mo or $44.99/yr | Unrated |
| **Furly** | Y | N (not found) | Android only | Y | ? (board shows who did each task) | Y | ? | $4.99-$39.99 | 10+ installs |
| **Petnote Plus** | Y | ? | ? | ? | Y | Y (logging reminders) | ? | Sharing appears to be free; Premium removes ads | 50K+ installs |
| **11pets** | ? | Y | N (vet sharing only) | ? | N | Y | N | IAP $1.99 / $17.99 | 3.3 from 77 ratings |
| **Medisafe** (human meds) | Y | Y | N (one owner plus "Medfriends" who watch) | Y | Only missed-dose alerts | Y | N | IAP $2.99-$54.99 | 5M+ installs |

**Short answer:** none of these apps clearly solves all three pains for a mixed Android/iPhone family.

- **iPhone-only households:** Meal Time For Pets and PetPill come closest. They have one-tap logging, a shared live status, and reminders that go to the whole group or repeat until someone logs.
- **DogLog** is the only established app on both stores with a shared log and alerts when someone logs, but its listings advertise no one-tap or widget logging and no reminder escalation.
- **Muzzly** and **VigilClan** describe the right features on paper. Both are very new, have tiny install counts, and do not clearly confirm sharing between Android and iPhone.

## Details

### DogLog (DOGLOG INC): the established cross-platform option

- **Platforms:** Android listing ([Play](https://play.google.com/store/apps/details?id=com.mobikode.dog&hl=en_US)) and iOS listing ([App Store](https://apps.apple.com/us/app/id1229529595)). The official site links to both stores ([doglogapp.com](https://www.doglogapp.com/)).
- **Shared log:** "Form a 'pack' with your fellow dog caretakers" and "Add your pet sitters and walkers to your Pack so all activities get recorded" ([Play](https://play.google.com/store/apps/details?id=com.mobikode.dog&hl=en_US)).
- **Alerts when someone logs:** "Get notified when activities are logged for your pet with alerts" ([Play](https://play.google.com/store/apps/details?id=com.mobikode.dog&hl=en_US), [App Store](https://apps.apple.com/us/app/id1229529595)). The pitch is aimed at exactly pain 2: "Don't spend any more time wondering if your dog has been taken care of" ([Play](https://play.google.com/store/apps/details?id=com.mobikode.dog&hl=en_US)).
- **Reminders:** "Set reminders for giving medicine to your pet so you never miss a dose" ([Play](https://play.google.com/store/apps/details?id=com.mobikode.dog&hl=en_US)). Neither listing says whether reminders repeat or go to the whole Pack.
- **Logging:** Medicine is one of a fixed set of activity types, along with Food, Walk, Pee, and others, plus Custom ([Play](https://play.google.com/store/apps/details?id=com.mobikode.dog&hl=en_US)). Neither listing mentions widgets, quick-log buttons, or notification actions ([App Store](https://apps.apple.com/us/app/id1229529595)).
- **Price:** Monthly Premium $3.99 and Annual Premium $39.99 ([App Store](https://apps.apple.com/us/app/id1229529595)). The Android app "Contains ads" and has in-app purchases of $3.99-$39.99 ([Play](https://play.google.com/store/apps/details?id=com.mobikode.dog&hl=en_US)). Neither store nor the site publishes which features are paid.
- **Traction:** 100K+ downloads, 4.5 stars, updated Aug 20, 2026 ([Play](https://play.google.com/store/apps/details?id=com.mobikode.dog&hl=en_US)). 4.8 from 1.4K ratings on iOS ([App Store](https://apps.apple.com/us/app/id1229529595)).

### Muzzly: closest feature match on both platforms, but new

- **Platforms:** Android ([Play](https://play.google.com/store/apps/details?id=io.muzzly.app&hl=en_US), developer "Concept Solutions (EU)") and iOS ([App Store](https://apps.apple.com/us/app/id6761260557), developer "Fernando Mendes"). The two listings carry the same feature copy.
- **Reminders:** The free tier has "Persistent notifications until you respond" and "One-tap actions: Taken, Snooze, or Skip from the notification" ([Play](https://play.google.com/store/apps/details?id=io.muzzly.app&hl=en_US)).
- **Schedules:** "Daily, specific weekdays, every X days, or every X weeks", "Cycle schedules (days on / days off)", "As-needed (PRN) logging", and "Archive medications without deleting" ([Play](https://play.google.com/store/apps/details?id=io.muzzly.app&hl=en_US)). It does not advertise fixed-length courses with an end date.
- **Sharing (Premium):**
  - "Share pets with family, sitters, or dog walkers via a simple link"
  - "Recipients get their own dose reminders, mark doses, and add care notes"
  - "Carers are reminded minutes after you, so nobody double doses"
  - "Change tracking shows what caregivers have logged"
  - "Google Drive backup and sync across devices"
  - "Home screen widgets for today's doses"

  Source for all of the above: [Play](https://play.google.com/store/apps/details?id=io.muzzly.app&hl=en_US).
- **Possible catch:** The free tier says "No account required - all data stored locally on your device" ([Play](https://play.google.com/store/apps/details?id=io.muzzly.app&hl=en_US)). Sync is described as Google Drive based, so it is not verified whether a share from Android to iPhone works. The official site (muzzly.io → muzz.ly) only redirects to a Linktree, so there is no documentation to check.
- **Price on iOS:** $2.99/month, $17.99/year, or $39.99 lifetime ([App Store](https://apps.apple.com/us/app/id6761260557)).
- **Traction:** 100+ downloads on Android, updated Aug 30, 2026 ([Play](https://play.google.com/store/apps/details?id=io.muzzly.app&hl=en_US)). Not enough ratings to show on iOS ([App Store](https://apps.apple.com/us/app/id6761260557)).

### VigilClan: Android app plus a browser for everyone else

- **Shared logging:** "Share a secure link or code and let them log doses directly in their mobile browser. No app download... required for your family members." "See exactly who marked a dose as 'Given' and at what time. The whole household is notified instantly." ([Play](https://play.google.com/store/apps/details?id=com.kamilnowak.vigilclan&hl=en_US)).
- **Logging and schedules:** "One-Tap Logging: Record doses with a single tap", "twice-daily, every 3 days, or multi-day cycles", and a pill counter with low-stock alerts ([Play](https://play.google.com/store/apps/details?id=com.kamilnowak.vigilclan&hl=en_US)).
- **Price and traction:** No in-app purchases are shown on the listing. 10+ downloads, updated Jun 14, 2026, solo developer ([Play](https://play.google.com/store/apps/details?id=com.kamilnowak.vigilclan&hl=en_US), [kamilnowak.com](https://kamilnowak.com)). No App Store app was found.
- **Relevance:** This is the only product found that solves the mixed-platform problem by design, using browser logging for non-Android members. A browser page cannot give iPhone users reliable push reminders the way a native app can, though the listing does not say how it reminds browser users.

### Meal Time For Pets (iOS only): best reminder design found

- **Family sharing:** Marked "FAMILY SHARING (PREMIUM)". "Get notified when meals or meds are handled by someone else." ([App Store](https://apps.apple.com/us/app/meal-time-for-pets/id1523239569)).
- **Reminders:**
  - "Optional repeat reminders for medications until they're marked done". Version notes give re-reminders from 15 minutes to 2 hours apart, up to 3 times.
  - "Choose who's reminded for every meal, med, and task: everybody, one person, or take turns."
  - An "I've got it" claim that moves the reminder to that person.

  Source: [App Store](https://apps.apple.com/us/app/meal-time-for-pets/id1523239569).
- **Logging:** Quick Log: "tap the corner of any pet's card to instantly log ... meds". Widgets were added in version 2.7 ([App Store](https://apps.apple.com/us/app/meal-time-for-pets/id1523239569)).
- **Price and platforms:** "Group" (2 members) costs $1.99 or $19.99/yr, and "Group Plus" (5 members) costs $2.99 or $29.99/yr. Compatibility lists iPhone, iPad, and Vision only. No Play listing was found.

### PetPill (iOS only)

- **Sharing:** "Share a pet with your partner or anyone you live with via iCloud". When someone logs, the household sees it ([App Store](https://apps.apple.com/us/app/id6760020801)).
- **Logging:** "Log a dose as given or skipped with one tap — from the app, a widget, or your wrist", including Lock Screen logging ([App Store](https://apps.apple.com/us/app/id6760020801)).
- **Free vs. Pro:** The free tier is "one pet, one medication". Household sharing and widgets need Pro: $3.49/mo, $34.99/yr, or $59.99 lifetime ([App Store](https://apps.apple.com/us/app/id6760020801)).
- **Platform limit:** Sharing is built on iCloud, so Android family members cannot join.

### Pett (iOS)

- **Logging and reminders:** "Set feeding and medication schedules once, and every caretaker gets the right reminder at the right time." "Log a feeding or a dose in one tap, right from the notification." ([App Store](https://apps.apple.com/us/app/pett-pet-care-health/id6773452497)).
- **Free tier:** "The free plan covers two pets, forever, and every caretaker always has full access." Pro costs $2.99/mo or $29.99/yr ([App Store](https://apps.apple.com/us/app/pett-pet-care-health/id6773452497)). This is the cheapest full-featured shared plan found, but it is iOS-confirmed only.
- **Android:** A Play app named "Pett" makes similar claims ("they all get the same reminders and records"), but its developer is listed as "Griftin" ([Play](https://play.google.com/store/apps/details?id=com.griftin.pett&hl=en_US)) while the iOS developer is Christopher Johnson. It is not confirmed to be the same product or the same shared backend.

### Tailog: cross-platform, but not for medication

- **Sharing:** "Tailog syncs in real time across iOS and Android — no more 'did you feed the dog?' moments" ([Play](https://play.google.com/store/apps/details?id=com.honeymilk.tailog&hl=en_US)). This is the only listing that states explicitly that sharing works across platforms.
- **Gap:** Reminders cover vaccines, vet visits, and grooming. Medication is mentioned only as a diary use case ([Play](https://play.google.com/store/apps/details?id=com.honeymilk.tailog&hl=en_US), [App Store](https://apps.apple.com/us/app/id6755321265)).
- **Price and traction:** $1.99/mo or $19.99/yr ([App Store](https://apps.apple.com/us/app/id6755321265)). 10+ downloads, contains ads ([Play](https://play.google.com/store/apps/details?id=com.honeymilk.tailog&hl=en_US)).

### Others

- **Notepet** (Android only):
  - "Get a reminder when something's due, then log it with one tap"
  - "Set Admin, Editor, or Viewer roles, and everyone stays in sync in real time, so no one double-doses"
  - Recurring schedules "from three times a day to once a year"
  - 2.6 stars, 1K+ downloads

  Source: [Play](https://play.google.com/store/apps/details?id=io.notepet&hl=en_US).
- **Furly** (Android only):
  - "See what care is already done, what is still left today, and who handled each task"
  - "ONE-TAP LOGGING"

  Source: [Play](https://play.google.com/store/apps/details?id=com.furly.furly&hl=en_US).
- **Petnote Plus:** Shares with up to 15 members via a share code. "you will be notified when another family member adds a record". Premium mainly removes ads. 50K+ downloads ([Play](https://play.google.com/store/apps/details?id=com.lancerdog.petnote_plus&hl=en_US)). It is a general health and diary tracker, not dose-centric.
- **PetMed** (iOS only): Premium "Invite up to four trusted caregivers to coordinate medication doses". Quick give/snooze actions from the notification, widgets, and Live Activities. $4.99/mo or $44.99/yr ([App Store](https://apps.apple.com/us/app/id6761286407)).
- **11pets:** The listing mentions medication reminders and sharing records with a vet, with no family sharing ([App Store](https://apps.apple.com/us/app/id1232470530)).
- **Medisafe** (human medication, both platforms):
  - The site says "even pet meds are available to track in the app" ([medisafeapp.com](https://medisafeapp.com/features/))
  - The family model is "Medfriend", which lets a watcher "know when a loved one missed a dose" ([medisafeapp.com](https://medisafeapp.com/features/))
  - Medfriends get push notifications "if the main user has forgotten to take medication" ([Play](https://play.google.com/store/apps/details?id=com.medisafe.android.client&hl=en_US))

  This is a watcher model where one person owns the schedule. It is not a shared log where any member can mark a dose as given, and the listing does not say otherwise.

## Which features matter (input for the spec)

These are the features that separate apps covering all three pains from those that cover only one or two:

1. **Logging without opening the app.** This means notification actions ("Taken / Snooze / Skip": [Muzzly](https://play.google.com/store/apps/details?id=io.muzzly.app&hl=en_US), [Pett](https://apps.apple.com/us/app/pett-pet-care-health/id6773452497)), home or Lock Screen widgets ([PetPill](https://apps.apple.com/us/app/id6760020801), [Meal Time](https://apps.apple.com/us/app/meal-time-for-pets/id1523239569)), or a Quick Log tap. Choosing from a list of activity types (DogLog) is the weaker pattern.
2. **Shared "given by X at time T" status that everyone can see,** plus a push to the others when a dose is logged ([DogLog](https://play.google.com/store/apps/details?id=com.mobikode.dog&hl=en_US), [VigilClan](https://play.google.com/store/apps/details?id=com.kamilnowak.vigilclan&hl=en_US), [Meal Time](https://apps.apple.com/us/app/meal-time-for-pets/id1523239569)). This directly prevents double dosing.
3. **Reminders that are aware of the group.** Examples:
   - Reminders that repeat until anyone logs the dose ([Meal Time](https://apps.apple.com/us/app/meal-time-for-pets/id1523239569))
   - Staggered owner and carer reminders ([Muzzly](https://play.google.com/store/apps/details?id=io.muzzly.app&hl=en_US))
   - Assigning a reminder to everyone, one person, or a rotation ([Meal Time](https://apps.apple.com/us/app/meal-time-for-pets/id1523239569))

   A logged dose should silence everyone else's reminder.
4. **Schedule types.** Recurring schedules (daily, every N days, cycles) and as-needed doses are common ([Muzzly](https://play.google.com/store/apps/details?id=io.muzzly.app&hl=en_US), [Notepet](https://play.google.com/store/apps/details?id=io.notepet&hl=en_US)). **Fixed-length courses** (for example, antibiotics twice a day for 10 days, then stop automatically) were not explicitly advertised by any app reviewed. Muzzly's "archive" is the closest. This gap is real.
5. **Cross-platform membership.** Most of the polished apps are iOS-only and sync over iCloud (PetPill, Meal Time, PetMed). Among the cross-platform apps, only Tailog states that sharing works between iOS and Android, and it does not handle medication.
6. **Nice to have:** pill stock counting with refill alerts (VigilClan, Notepet, Muzzly) and a PDF or export for the vet (DogLog, Muzzly, PetPill).

## Is there one that already solves it, and what would building our own add?

**Is there one?** Not clearly, for a mixed Android/iPhone household.

- **DogLog** is the safe, established choice. It covers pains 2 and 3 at a basic level for about $40/yr. Its listings advertise no one-tap or widget logging (pain 1), and the free vs. premium split is undocumented.
- **Muzzly** advertises everything (one-tap logging, staggered shared reminders, widgets) on both stores at $17.99/yr. However:
  - It is a few months old with roughly 100 installs.
  - It syncs via Google Drive.
  - Its developer names differ between the two stores.
  - Android-to-iPhone sharing is unverified.

  It is worth a 15-minute hands-on trial before deciding to build.
- **If everyone used iPhone,** Meal Time For Pets ($19.99/yr for 2 members) would solve all three pains.

**What building our own would add:**

- **One-tap logging on both platforms.** A home-screen button or widget per pet and medication that logs "given by me, now" with no app navigation, on both Android and iPhone. Among the apps reviewed this exists only on iOS (PetPill, Meal Time); on Android it appears only as Muzzly's paid notification actions and widget.
- **Reminders that cancel for everyone.** Repeat until anyone logs the dose, then silence every device, working across platforms. Meal Time does this on iOS only.
- **First-class courses.** Start date, dose count or end date, and auto-stop, alongside recurring and as-needed schedules. No reviewed app advertises this.
- **No subscription, ads, or tier gating** for a 2-3 person household. Ongoing cost is only hosting, versus $18-40/yr per paying account in the apps above.
- **Fit and longevity.** Only the features the household needs, no reliance on a tiny vendor that might disappear (most candidates have 10-100 installs), and data the household owns and controls.

**What building would not add:** pet health records, vaccine tracking, vet exports, or photo diaries. Every app above already does these, and they are not part of the three pains.
