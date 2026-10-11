# Where does the log live on the server, and how is it backed up?

Type: grilling
Status: resolved
Assignee: Rob
Blocked by: —

## Question

On the Hostinger VPS (Docker + Traefik): where are the log of doses (including the old versions kept when a log is fixed or undone), the meds (changed via the bot), and the hand-edited settings file (pets, round times, givers, quiet hours) stored, how is the "is it done?" status worked out from it, and how is it backed up so a server problem doesn't lose the history?

## Answer

Fact found: Hostinger already takes a weekly whole-server backup of the VPS (`srv1636442`) and keeps the last 2 (seen 2026-10-03 and 2026-10-10). Restoring one rolls back the whole server.

1. **Storage**: Rob's existing Postgres on the VPS. The bot gets **its own database and its own login** there. It holds the dose log, the old versions kept by fixes and undos, and the meds.
2. **"Is it done?"**: always worked out fresh from the log (e.g. "is there a dose for this round today?"). No stored done flags.
3. **Settings file**: a YAML file next to the bot (pets, round times, late-after times, givers, quiet hours). Checked for mistakes when the bot starts; restart the bot to pick up changes.
4. **Backups**: on top of Hostinger's weekly backup, every night the bot exports its database (`pg_dump`) and sends the file to Rob in a private Telegram chat.
5. **Keep**: the log is kept forever.
6. **Restore test**: at first setup, restore one backup into a scratch database to prove it works. Write the restore steps in the README.
