# Do home-screen buttons land in this spec?

Type: grilling
Status: out of scope
Assignee: Rob
Blocked by: 10

## Question

The pick was "home-screen buttons later" (iOS Shortcut, Pixel HTTP Shortcuts widget). The bot uses long polling, so it has no public URL today. Do these buttons belong in this spec — and if so, how does a tap reach the bot (a small endpoint behind Traefik?), how does it know who tapped (a per-person secret link?), and what does it log (a whole round, using the double-dose guard)? Or are they ruled out of scope for now?

## Answer

Ruled **out of scope** for this spec. The bot already gives one tap from each reminder (✅ All given) and one tap per round on the board. Home-screen buttons (iOS Shortcut, Pixel HTTP Shortcuts widget) would need a public endpoint behind Traefik and per-person secret links; revisit as a separate small effort once the bot has been lived with. Nothing in the bot design blocks adding them later.
