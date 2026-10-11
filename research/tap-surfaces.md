# Tap surfaces for one-tap pet-med logging (Pixel 8 + iPhone)

Research date: 2026-10-10. Context: 2-3 family members log doses, currently by typing in a Telegram group. This document informs the spec only. Nothing has been built.

"Taps-to-log" counts screen taps starting from a reminder notification (R) or from the home screen (H). Where a figure is my estimate rather than documented behaviour, it is marked *(est.)*.

## Summary table

| Surface | Taps-to-log | Done / not done at a glance | Push reminders: Android / iOS | Build effort | Cost |
|---|---|---|---|---|---|
| **Telegram bot, inline buttons in the existing group** | R: 2 (open notification, tap button) *(est.)*; 1 if the chat is already open | Yes. The bot edits the reminder message in place ("Given by Rob 08:12") and can pin a status message | Yes / Yes (ordinary Telegram messages) | Low: a small bot plus a scheduler | Bot API is free; you pay only for hosting |
| Telegram Mini App | 3+ (open bot, launch app, tap) | Yes, inside the app | Same as bot | Medium: a web UI plus the bot | Free; hosting only |
| WhatsApp Cloud API bot | R: 2 *(est.)* | Partly. Reply buttons work only 1:1; groups support no interactive messages | Yes / Yes, but reminders outside the 24h window need paid templates | Medium-high: Meta business setup and template approval; groups need an Official Business Account | Per-message charges for templates |
| Signal bot | n/a: no buttons | No | Only through unofficial signal-cli | High and fragile | Free but unofficial |
| **Native home-screen widget, Android** | H: 1 | Yes. The widget can show state; Android 12+ supports checkboxes | Yes, via the app's own notifications | Medium: needs an Android app (Kotlin/Glance) | Sideloading is free; Play costs a one-time US$25 |
| Native interactive widget, iOS 17+ | H: 1 (device must be unlocked) | Yes. The timeline reloads after the tap | Yes, via APNs | Medium-high: needs an iOS app | US$99/yr, or free builds that expire every 7 days |
| **iOS Shortcuts (widget / Home Screen icon / Action button) calling a webhook** | H: 1 (or one press of the Action button) | No. The widget shows shortcut names, not data | n/a (pair with Telegram or PWA push) | Very low: no app, just one HTTP endpoint | Free |
| Android "HTTP Shortcuts" widget calling a webhook | H: 1 | No (shows the response after the tap) | n/a (pair with Telegram) | Very low | Free, open source |
| **PWA saved to home screen** | H: 2 (open, tap); R: 2 *(est.)* | Yes. The page shows today's status; iOS can badge the icon, Android shows only a dot | Yes (Chrome) / Yes, only iOS 16.4+ **and only when added to the Home Screen** | Medium: web app, service worker, push server | Free (no Apple membership needed for web push) |
| NFC sticker on the med shelf | iPhone: 0 screen taps (Shortcuts NFC automation can run without asking). Pixel 8 on Android 17: physical tap, then tap an "open link" notification, then the page *(est. 2-3)* | No (pair with Telegram/PWA) | n/a | Low | Stickers are cheap; price not sourced |

**Bottom line:** Use a **Telegram bot in the existing family group** as the backbone. It is the only option that gives reminders, one-tap logging, and visible done/not-done status on both OSes with no app install and no cost. Add an optional **HTTP "log dose" endpoint** on the same backend. That endpoint lets iPhone users fire it from a Shortcuts widget, the Action button, or an NFC automation, and lets Pixel users fire it from an HTTP Shortcuts widget. The backend then posts or edits the status in the group. Defer the PWA and native widgets unless Telegram proves insufficient.

---

## 1. Chat-app bots

### 1a. Telegram bot (recommended)

- **Inline buttons log without sending a chat message.** "Unlike with custom reply keyboards, pressing buttons on inline keyboards doesn't send messages to the chat." Bots can instead edit the keyboard or message, which is "faster and smoother than sending a whole new message" (https://core.telegram.org/bots/features).
- Pressing a callback button sends the bot a `CallbackQuery` that includes `from` (the User who pressed it). That gives per-person attribution for free. `callback_data` is limited to 1-64 bytes (https://core.telegram.org/bots/api#callbackquery, https://core.telegram.org/bots/api#inlinekeyboardbutton).
- The bot must call `answerCallbackQuery`, or clients "will display a progress bar". The answer can show a toast or alert ("Logged!") (https://core.telegram.org/bots/api#answercallbackquery).
- **Done at a glance:** `editMessageText` / `editMessageReplyMarkup` can turn the reminder into "Given by X at 08:12" and remove the button (https://core.telegram.org/bots/api#editmessagereplymarkup). The bot can also pin a daily status message. To pin in a group, it must be an admin with `can_pin_messages` (https://core.telegram.org/bots/api#pinchatmessage).
- Reply keyboards are the alternative. Their buttons "immediately send the respective text" to the chat (https://core.telegram.org/bots/features). That keeps the current "message in the group" habit but makes the chat noisier.
- **Groups / privacy mode:** By default, bots in groups run in Privacy Mode and "only see relevant messages and commands". Bots that are admins receive all messages (https://core.telegram.org/bots/features#privacy-mode). This only matters if the bot should also parse the family's typed messages.
- **Reminders:** The bot just sends a message at the scheduled time, and Telegram's own app delivers the push on both Android and iOS. Bots can message users "at no cost". Limits are 1 msg/s per chat and 20 msgs/min per group, which is far above this use case (https://core.telegram.org/bots/faq).
- **Cost:** Bot messaging is free (https://core.telegram.org/bots/faq). Only hosting for the bot and its scheduler costs anything.
- **Unverified UX note:** I found no Telegram doc saying inline buttons can be pressed directly from the OS notification. Assume the user taps the notification to open the chat and then taps the button (2 taps) *(est.)*.

### 1b. Telegram Mini App (optional add-on)

- Mini Apps are JS web UIs that run inside Telegram. They can be launched from the menu button, an inline `web_app` button, the attachment menu, the bot profile, or a t.me link (https://core.telegram.org/bots/webapps).
- `addToHomeScreen` (Bot API 8.0) prompts the user to add the Mini App to the home screen (https://core.telegram.org/bots/webapps).
- `web_app` inline buttons are "available only in private chats between a user and the bot", so they don't work in the family group (https://core.telegram.org/bots/api#inlinekeyboardbutton).
- Verdict: more taps than an inline button. Only worth it for a richer history or edit UI.

### 1c. WhatsApp (Cloud API)

- Interactive reply buttons allow "up to three predefined replies". A tap triggers a messages webhook with a `button_reply` payload (https://developers.facebook.com/docs/whatsapp/cloud-api/messages/interactive-reply-buttons-messages).
- **24h window:** A user message opens a 24-hour customer service window. Outside it, "template messages are the only message type that can be sent". Since July 1, 2025, pricing is per message. Utility templates and non-template messages sent inside an open window are free (https://developers.facebook.com/docs/whatsapp/pricing). A daily reminder will often land outside the window, so it would be a paid template. Templates can carry up to 10 quick-reply buttons (https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates/components).
- **Groups:** The Groups API requires an Official Business Account and allows max 8 participants. Interactive messages are listed as **not supported** in groups (https://developers.facebook.com/docs/whatsapp/cloud-api/groups). A shared family log with buttons would therefore have to be 1:1 per person.
- Verdict: it works, but it costs more, needs more setup, and is worse for a shared group than Telegram. It also means moving the family off Telegram.

### 1d. Signal

- I found no official Signal bot or button API. The common route is the unofficial **signal-cli**, which uses a patched libsignal-service-java and needs a dedicated phone number. It must be kept current: "signal-cli releases older than three months may not work correctly" (https://github.com/AsamK/signal-cli/blob/master/README.md).
- There are no interactive buttons, so logging means typing again. Verdict: not suitable.

## 2. Home-screen widgets and OS shortcuts

### 2a. Android native widget (Pixel 8)

- Widgets are "'at-a-glance' views of an app's most important data and functionality". They support "marking them done—with support for compound buttons in Android 12 (API level 31)" (https://developer.android.com/develop/ui/views/appwidgets/overview).
- "The widget is still stateless. Your app must store the state". Checkbox changes arrive through a `PendingIntent` (https://developer.android.com/develop/ui/views/appwidgets).
- Periodic refresh: `updatePeriodMillis` updates "will not be delivered more than once every 30 minutes". The app has to push updates itself, for example when an FCM message arrives or after the tap (https://developer.android.com/reference/android/appwidget/AppWidgetProviderInfo#updatePeriodMillis).
- Requires a native Android app. Sideloading an APK on the Pixel is free; Play distribution has a US$25 one-time fee (https://support.google.com/googleplay/android-developer/answer/6112435).

### 2b. iOS native interactive widget

- Since iOS 17, widgets can have buttons and toggles backed by App Intents "to offer specific app functionality without launching the app". After `perform()` returns, "the system reloads the widget's timeline", so done/not-done updates right away. Caveat: "On a locked device, buttons and toggles are inactive" until the user authenticates (https://developer.apple.com/documentation/widgetkit/adding-interactivity-to-widgets-and-live-activities).
- Requires a native iOS app. The Apple Developer Program costs US$99/yr (https://developer.apple.com/programs/whats-included/). A free Personal Team works, but "provisioning profiles ... will expire 7 days from issuance" and you must rebuild and reinstall weekly (https://developer.apple.com/help/account/basics/about-your-developer-account/).

### 2c. iOS Shortcuts calling a webhook (no app to build)

- Shortcuts' **Get Contents of URL** can POST JSON to an API (https://support.apple.com/guide/shortcuts/request-your-first-api-apd58d46713f/ios).
- Ways to fire it with one tap:
  - **Shortcuts widget:** "tap a shortcut. The shortcut begins, and the widget button displays a progress indicator" (https://support.apple.com/guide/shortcuts/run-shortcuts-from-the-home-screen-widget-apd029b36d05/ios).
  - **Home Screen icon** (https://support.apple.com/guide/shortcuts/add-a-shortcut-to-the-home-screen-apd735880972/ios).
  - **Action button:** it can be set to "Shortcut: Open an app or run your favorite shortcut" (https://support.apple.com/guide/iphone/use-and-customize-the-action-button-iphe89d61d66/ios). It exists only on iPhone 15 Pro/Pro Max, all iPhone 16 models (incl. 16e), iPhone 17/17 Pro/Pro Max, iPhone Air, and iPhone 18 Pro/Pro Max (https://support.apple.com/guide/iphone/aside/iph44c8b4227/27/ios/27).
- Limitation: the widget shows shortcut names, not data, so there is **no done/not-done display**. Pair it with Telegram status or a PWA.

### 2d. Android equivalent without building an app

- **HTTP Shortcuts** (free, open-source, Android 8+) creates "shortcuts and widgets that can be placed on your home screen". Each one sends an HTTP request when tapped (https://http-shortcuts.rmy.ch/). It is third-party, but it gives the Pixel the same one-tap webhook as iOS Shortcuts.

## 3. PWA saved to the home screen

- **iOS web push:** Supported from iOS/iPadOS 16.4, only for web apps **added to the Home Screen**. Permission must be requested "in response to direct user interaction". No Apple Developer membership is needed (https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/). MDN compat data agrees: Safari iOS 16.4, "supported in web apps saved to the home screen" (https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe#browser_compatibility).
- **No silent pushes on iOS:** "Safari doesn't support invisible push notifications... If you don't [show them], Safari revokes the push notification permission" (https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers).
- iOS 18.4 added **Declarative Web Push** for Home Screen web apps, which shows notifications "without requiring a Service Worker" (https://webkit.org/blog/16574/webkit-features-in-safari-18-4/). In iOS 26, "every website added to the Home Screen opens as a web app" by default (https://webkit.org/blog/17333/webkit-features-in-safari-26-0/).
- **Android (Chrome):** Push API support mirrors desktop Chrome (MDN BCD `chrome_android: mirror`, https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe#browser_compatibility). Push arrives "whether or not the web app is in the foreground, or even currently loaded" (https://developer.mozilla.org/en-US/docs/Web/API/Push_API).
- **Badge at a glance:** On iOS, Home Screen web apps can call `setAppBadge`/`clearAppBadge`, even from push handlers (https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/). On Android, "the Badging API is not supported"; Android shows only a notification dot (https://developer.chrome.com/docs/capabilities/web-apis/badging-api).
- Taps: open the icon, then tap "Give dose" = 2. The page itself is the best "who gave what, when" status view.
- Verdict: the most capable cross-platform UI with no app store. The costs are that each iPhone user must "Add to Home Screen" and grant permission, plus you have to build web push infrastructure.

## 4. Other cheap options

### 4a. NFC sticker on the med shelf

- **iPhone:** A Shortcuts personal automation with the **NFC** trigger is in Apple's list of automations that "can run automatically" without asking (https://support.apple.com/guide/shortcuts/add-automations-apdfbdbd7123/ios). Combined with Get Contents of URL, tapping the phone on the sticker logs the dose with zero screen taps. Background tag reading of URL tags (no Shortcut) works on iPhone XS and later, but shows a notification the user must tap first (https://developer.apple.com/documentation/corenfc/adding-support-for-background-tag-reading).
- **Pixel 8:** Android 17 is out for Pixel 8 (https://developer.android.com/about/versions/17/get). On Android 16+, http(s) tags fire `ACTION_VIEW`, and "Beginning with Android 17, scanning such a tag surfaces an 'open link' notification, requiring explicit user interaction" (https://developer.android.com/develop/connectivity/nfc/nfc). A plain URL sticker is therefore physical tap + notification tap + page, and a GET-to-log URL also risks double-logging. A native app could register its own NDEF filter, but that requires building an app.
- Cost: generic NTAG stickers are inexpensive (price not sourced from a primary doc). No at-a-glance status, so pair with Telegram.

## 5. Suggested spec direction

1. A Telegram bot in the existing group. It handles scheduled reminders with a `[Given]` inline button, edits the message to "Given by <name> <time>", runs an overdue nudge, and optionally keeps a pinned daily status.
2. The same backend exposes `POST /dose` (per-user token). iPhones call it from a Shortcuts widget, Action button, or NFC automation; Pixels call it from an HTTP Shortcuts widget. The bot then updates the group message, so status stays in one place.
3. Later and only if needed: a PWA status page (with iOS badge and web push), or native widgets.
