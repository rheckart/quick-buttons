# Hosting options for the pet-medication tap + reminder service

Researched 2026-10-10. Need: always-on endpoint that receives taps (chat-bot webhook or small web app) plus scheduled nag reminders ("eye drops due 8am, still not given at 9am") for 2-3 people (Pixel 8 + iPhone). Very low traffic.

## Comparison

| Option | Extra cost for Rob | Receives taps? | Scheduled reminders? | Timing precision | Effort |
|---|---|---|---|---|---|
| **Convex Free** | $0 (1M function calls/mo, hard caps) | Yes, HTTP actions at `*.convex.site` | Yes, `crons.ts` + `ctx.scheduler.runAt/runAfter` | Millisecond timestamps for scheduler, seconds-level crons; cron strings are UTC | Low: TypeScript only, no server to run |
| **Hostinger VPS (KVM 2, already owned)** | $0 extra (already paid through 2028-04) | Yes, any Node process behind the existing Traefik | Yes, system cron (supports `CRON_TZ`) or in-process timers | Per-minute (cron) or exact (in-process timer) | Medium: Docker container, TLS via Traefik, you handle restarts/updates |
| **Hostinger shared/web-app hosting** | New purchase (Rob has none); from $3.99/mo promo, $16.99/mo renewal | Yes (Node.js web apps on Business/Cloud plans) | hPanel cron, UTC, `* * * * *` shortest example | Per-minute at best | Low-medium, but costs money and long-running background processes aren't documented |
| **Plain Telegram bot** | $0 (free messaging within rate limits) | Yes: inline-keyboard buttons send callback queries | **No**: Bot API has no scheduled-send parameter | n/a, needs a host for timing | Low for UI, but it is a *front end*, not a host |

**Bottom line:** Telegram covers the tap UI on both phones for free, but it can't schedule anything, so it still needs a backend. The best pairing is Telegram bot + Convex (free, managed, built-in scheduler). Telegram + the existing KVM 2 VPS also costs nothing extra but means more ops work. Don't buy Hostinger shared hosting for this.

---

## Rob's current accounts (checked via Hostinger API, 2026-10-10)

- Hostinger subscriptions: one **KVM 2** VPS (2-year term, auto-renew, next bill 2028-04-18) and a .TECH domain. **No shared/web hosting plan.**
- The VPS `srv1636442.hstgr.cloud` is running Ubuntu 24.04 with the "Docker and Traefik" template (2 vCPU, 8 GB RAM, 100 GB disk).
- Convex account/deployments were not checked.

## Convex

**Cost / free tier**
- Free plan: 1,000,000 function calls/month, 20 GB-hours action compute, 0.5 GB DB storage, 1 GB file storage, 1 GB/month DB I/O, 1 GB/month file egress; usage is counted per team. https://docs.convex.dev/production/state/limits
- Plan tiers: "Free & Starter" ($0, or pay-as-you-go Starter), Professional $25/developer/month. Crons and webhooks are included on Free. https://www.convex.dev/pricing
- Exceeding Free limits: "If you exceed the resource limit for an extended period of time, your deployment may return HTTP errors in response to function calls." Starter instead bills metered overage. https://www.convex.dev/pricing/faq
- When Free limits are hit, "new mutations that attempt to commit more insertions or updates may fail." https://docs.convex.dev/production/state/limits
- Sizing: 3 people x a few taps/day plus a cron every few minutes is roughly 10-20k calls/month, around 1-2% of the free quota. (This is my estimate, not a sourced figure.)
- Inactivity: Free-plan pausing for inactivity isn't documented. The limits page only defines "idle" deployments (no calls for 30 days) in the context of Business/Enterprise fees. https://docs.convex.dev/production/state/limits

**Receiving taps (HTTP actions)**
- `httpAction` handlers routed in `convex/http.ts`, served at `https://<deployment>.convex.site`. The docs name receiving webhooks as a use case. https://docs.convex.dev/functions/http-actions
- Telegram requires HTTPS on port 443/80/88/8443 (https://core.telegram.org/bots/api). `*.convex.site` is HTTPS on 443, so it fits. Custom domains need the Professional plan (https://www.convex.dev/pricing), which this doesn't need.

**Scheduling**
- Crons: `crons.interval()` (seconds-level granularity), `crons.cron()` (5-field), `hourly/daily/weekly/monthly`. Cron strings and `hourUTC`/`minuteUTC` are **UTC**. At most one run of a job at a time; an overlapping run may be skipped. https://docs.convex.dev/scheduling/cron-jobs
- Scheduler: `ctx.scheduler.runAfter(ms)` / `runAt(timestampMs)`, cancellable with `ctx.scheduler.cancel(id)`. Scheduled mutations run exactly once; actions run at most once with no automatic retry. Functions can be scheduled "minutes, days, and even months" ahead. https://docs.convex.dev/scheduling/scheduled-functions
- Limit: 1,000,000 outstanding scheduled functions. https://docs.convex.dev/production/state/limits
- Precision: neither page documents a timing SLA. Timestamps are millisecond-resolution.
- Design note (inference): because crons are UTC, an "8am local" dose drifts by an hour across DST. Better to compute the next local-time dose in code and use `runAt`, or run an `interval` cron every 1-5 min that checks due/overdue doses. Sending to Telegram has to happen in an action (a `fetch` call), and actions aren't retried, so have the mutation record the "sent" state and reschedule on failure (the pattern the scheduled-functions docs recommend).

**Effort:** low. TypeScript functions, `npx convex deploy`, nothing to patch or keep alive.

## Hostinger

**VPS (Rob already has KVM 2)**
- KVM plans list "Full root access". KVM 2 is 2 vCPU / 8 GB / 100 GB NVMe, $8.99/mo promo, $14.99/mo renewal. https://www.hostinger.com/vps-hosting
- Node.js on VPS/dedicated "require[s] manual command-line configuration" (not the hPanel web-app flow). https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/
- Timing: standard cron is per-minute, and Ubuntu cron supports `CRON_TZ` for local-time schedules (which handles DST): https://manpages.ubuntu.com/manpages/noble/man5/crontab.5.html. An always-on Node process can also use its own timers for sub-minute precision, or use Telegram `getUpdates` long polling, which needs no inbound HTTPS (https://core.telegram.org/bots/api).
- Cost: $0 extra, since it's already paid. Effort: medium. Write a Dockerfile, add Traefik labels for TLS if using a webhook, persist a small DB (SQLite volume), and own uptime, security updates and backups.

**Shared / "web apps" hosting (Rob doesn't have this)**
- Node.js web apps are supported on Business Web Hosting and Cloud Startup/Professional/Enterprise/Enterprise Plus, Node 18/20/22/24, deployed from GitHub or an archive. npm commands "cannot be run through SSH". https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/ and https://docs.hostinger.com/node.js/creating-an-app
- Server apps (Express etc.) run as a process with a Restart button. The docs don't cover background workers, timers, or always-on guarantees. https://docs.hostinger.com/node.js/creating-an-app
- Current pricing page: "Unlimited" $3.99/mo (48-month, renews $16.99/mo) and Cloud Startup $7.99/mo (renews $25.99/mo, 10 web apps). https://www.hostinger.com/web-apps-hosting. Plan names there differ from the support article's "Business". Check at purchase time.
- hPanel cron jobs: schedule "is based on Coordinated Universal Time (UTC+0)", with PHP or Custom command types. https://www.hostinger.com/support/1583465-how-to-set-up-a-cron-job-at-hostinger/. Shortest example interval is every minute (`* * * * *`). https://docs.hostinger.com/websites/cron-jobs. Single plan max 2 cron jobs, Premium and above unlimited. https://www.hostinger.com/support/1583765-how-many-cron-jobs-can-you-set-up
- Verdict: works, but it's a new recurring cost, gives worse timing control (UTC per-minute cron) and less control than the VPS Rob already pays for.

## Plain Telegram bot

- Free: messaging users is free within rate limits (about 1 msg/sec per chat, 20 msgs/min per group, about 30 msgs/sec overall). Paid broadcasts only matter at massive scale. https://core.telegram.org/bots/faq
- Bots are created and managed through @BotFather. Users see a Start button the first time they open the bot chat. https://core.telegram.org/bots/features
- Tap UI: inline keyboard buttons (`InlineKeyboardMarkup`) with `callback_data` of 1-64 bytes. `answerCallbackQuery` shows a toast/alert. `editMessageReplyMarkup` can swap the buttons (e.g. replace "Give drops" with "Given by Rob 8:04"). https://core.telegram.org/bots/api
- Receiving updates: `getUpdates` long polling or `setWebhook`, mutually exclusive. Webhooks need HTTPS on port 443/80/88/8443, with an optional `secret_token` sent as the `X-Telegram-Bot-Api-Secret-Token` header. Updates are kept at most 24 hours. https://core.telegram.org/bots/api
- **No scheduling:** `sendMessage` has no schedule/date parameter (its parameter list includes chat_id, text, reply_markup, disable_notification, etc.). https://core.telegram.org/bots/api. So the "still not given at 9am" nag needs an external scheduler (Convex or the VPS).
- Cross-platform: Telegram clients exist for Android and iOS, so both the Pixel 8 and the iPhone work with one bot. A family group chat lets everyone see who gave the dose.
- Effort: low for the UI (no app to build or install beyond Telegram itself). The bot is a front end only and doesn't remove the need for a host.

## Recommendation

1. **Telegram bot + Convex Free**: $0, managed, built-in durable scheduler, webhook URL is HTTPS out of the box. Watch the UTC/DST point and the no-retry behaviour of actions.
2. **Telegram bot + existing KVM 2 VPS**: $0 extra, full control, `CRON_TZ` local-time cron, long polling avoids a public webhook. More upkeep.
3. Avoid buying Hostinger shared hosting for this.
