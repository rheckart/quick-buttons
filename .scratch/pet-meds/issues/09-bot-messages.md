# What do the bot's messages and buttons look like?

Type: prototype
Status: resolved
Blocked by: —

## Question

Mock up the bot's reminder message, the pinned board, and the flows for: unticking a med before logging a round, setting "given at 7pm", marking a med skipped, the "Already given by X at T, log again?" prompt, and the admin's start / stop / edit med flow in a private chat with the bot. Rob reacts to the mock; the answer is the chosen message and button layouts.

## Assets

- Prototype: [bot-messages-PROTOTYPE.html](../prototype/bot-messages-PROTOTYPE.html) — fake Telegram, three variants (`?variant=A|B|C`): A Checklist, B One button + options tucked away, C Per-med buttons + typed commands. Kept on the throwaway branch `prototype/pet-meds-bot-messages` (all three variants).

## Answer

Rob picked **variant B — "One button, options tucked away"** for everything.

1. **Reminder**: one line naming the round and its meds (e.g. "☀️ Twiggy morning: Antibiotic + Eye drops"), the dose notes as bullets, and "Late after 10:00". Buttons: **✅ All given** and **⚙️ Change…**.
2. **Change…** swaps the buttons (same message) to one row per med — `✅` / `✖ not yet` / `⏭ skip` — plus **🕐 Given at 8:15 (now) ▸**, **« Back** and **✅ Log these**.
3. **Given at**: Now / 15 min / 30 min / 1 h / 2 h ago, or **⌨️ Type a time**, which asks for a reply like "7:45" or "7pm".
4. **After logging**: the reminder becomes "✅ Given by X at T" (+ "(logged T)" if backdated, "Given late" after late-after), the meds given, "⏭ Skipped: …" and "⏳ Still to give: …". If anything is left, one button logs the rest.
5. **Board**: a short title ("📋 Twiggy · tap to log") with one full-width button per round, monthly med and as-needed med. The status lives in the button label: "☀️ Morning · ✅ Rob 8:15", "⏳ due 8:00", "🔜 18:00", "⚠️ LATE", "◐ Eye drops left", "📅 Simparica · due Tue 14 Oct", "💧 Ear cleaner · last 2 Oct". One tap logs the whole round.
6. **Double-dose guard**: a separate message in the topic — "⚠️ Twiggy morning was already given by X at T. Log it again?" with **Yes, log again** / **Cancel**. It's deleted once answered.
7. **Admin start / stop / edit** (private chat): a menu (➕ Start / ⏹ Stop / ✏️ Edit). Start opens one **draft card** message, edited in place, listing Pet, Name, Kind, Rounds, Days, Dose note, with a button per field. Text fields ask you to type. **✅ Start** only works once the card is complete. Stop and Edit: pick the med, then confirm or change one field (days, rounds, dose note).
8. Non-admins who message the bot get "only admins can change meds — you can still log doses in Pet Stuff."
