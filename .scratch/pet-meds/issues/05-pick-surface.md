# Which tap surface do we build on?

Type: grilling
Status: resolved
Blocked by: 01, 03

## Question

Using the research on tap surfaces and hosting, pick the one surface (or combo) the spec targets, and where it runs.

## Answer

1. **Surface**: a new, dedicated Telegram bot (not Hermes Agent).
2. **Where it posts**: the existing per-pet topics (Twiggy, Faith) in the "Pet Stuff" group.
3. **Reminders**: a reminder message carries a **Given** button. On tap, the bot edits it to "✅ Given by X at T".
4. **Board**: one pinned message at the top of each pet's topic, with a button for every round, monthly med and as-needed med, and ✅/⏳ status beside each. The bot keeps it up to date. Use it to log when no reminder is showing.
5. **Who can tap**: anyone in the group. The logger is their Telegram identity (resolves the "who's who" fog).
6. **Hosting**: Rob's existing Hostinger KVM 2 VPS (Docker + Traefik), not Convex. The bot uses long polling (getUpdates), so it needs no public URL or webhook.
7. **Later**: home-screen 1-tap buttons (iOS Shortcut, Pixel HTTP Shortcuts) that call the same bot. **Skipped**: NFC.
