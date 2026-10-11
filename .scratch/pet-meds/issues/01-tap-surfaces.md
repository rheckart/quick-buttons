# Which tap surfaces work on both Pixel 8 and iPhone?

Type: research
Status: resolved
Blocked by: —

## Question

Compare ways to log a dose in one tap that work on BOTH Android (Pixel 8) and iPhone, and can also deliver reminders:
- Telegram bot with inline/reply buttons (and other chat apps' bots: WhatsApp, Signal)
- Home-screen widgets (Android widget; iOS widget / Shortcuts / Action button)
- Web app saved to home screen (PWA), incl. iOS web push limits
- Anything else cheap (NFC tag on the med shelf, etc.)

For each: taps-to-log, can it show "done/not done" at a glance, push reminder support on each OS, build effort, cost.

## Answer

Findings: branch `research/tap-surfaces`, file `research/tap-surfaces.md`.

- **Telegram bot with inline buttons**: the best fit. A button press logs the dose without posting a chat message, and the bot knows who pressed it. The bot then edits the reminder to read "Given by X 08:12", so status shows at a glance. Reminders come as normal Telegram notifications on both phones, at no cost. About 2 taps from a reminder. (Pressing the button straight from the notification is unconfirmed.)
- **One tap from the home screen, nothing to build per phone**: an iOS Shortcut can call a web endpoint from a widget, a Home Screen icon, or the Action button (iPhone 15 Pro and later). On the Pixel, the free HTTP Shortcuts app does the same from a widget. Neither shows status, so they should feed the bot.
- **Native widgets**: one tap plus live status, but need a real app. iOS costs $99/yr, widget buttons don't work on the lock screen, and free builds must be reinstalled every 7 days.
- **Web app on the home screen**: workable. iOS push needs 16.4+, the app added to the Home Screen, and a tap to allow notifications. More setup.
- **WhatsApp, Signal**: weaker. WhatsApp charges for messages sent outside a 24h window, and Signal has no official bot support. **NFC sticker**: zero taps on iPhone via a Shortcuts automation; on the Pixel 8 it shows a notification you must tap first.
- Suggested direction: a Telegram bot as the backbone, plus one web endpoint that the Shortcut, the Pixel widget and NFC all call.
