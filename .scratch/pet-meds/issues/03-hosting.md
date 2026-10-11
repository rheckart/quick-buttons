# Which of Rob's existing platforms can host it?

Type: research
Status: resolved
Blocked by: —

## Question

For a tiny always-on service that receives taps (bot webhook or web app) and sends scheduled reminders: can Convex (http actions, crons, scheduler, free tier), Hostinger (web hosting vs VPS, Node support, cron), or a plain Telegram bot cover it? Note cost, cron/timing precision, and effort for each.

## Answer

Findings: branch `research/hosting`, file `research/hosting.md`.

- A Telegram bot alone can't send scheduled reminders. Something must run it.
- **Convex free tier**: $0, low effort. It has HTTP endpoints for bot taps, and both repeating and one-off scheduled jobs. This use should need only ~1–2% of the free quota. Catch: repeating jobs run on UTC times, so local reminder times must be computed in code. A failed Telegram send is not retried automatically.
- **Existing Hostinger KVM 2 VPS** (already paid, renews 2028-04; Ubuntu 24.04 + Docker + Traefik): $0 extra, minute-precise reminders in local time. More upkeep (uptime, updates, backups are on Rob).
- **Hostinger shared hosting**: Rob has no plan, so it would be new spending. UTC cron only. Don't buy.
- Recommendation: Convex free tier. Fallback: the VPS.
- Unconfirmed: whether Convex pauses idle free projects; whether Rob has a Convex account.
