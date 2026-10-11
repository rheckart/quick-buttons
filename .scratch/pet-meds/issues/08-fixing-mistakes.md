# How is a wrong log fixed?

Type: grilling
Status: resolved
Assignee: Rob
Blocked by: 05, 09

## Question

On the chosen surface: how does someone undo a wrong tap, fix the "given at" time, or change which meds were ticked after the fact? Who may fix someone else's log, and is the original kept?

## Answer

Glossary terms: Fix, Undo (see [CONTEXT.md](../../../CONTEXT.md)).

1. **Where**: a logged reminder ("✅ Given by X at T") keeps a **✏️ Fix** button. It opens the same ⚙️ Change panel: tick/untick meds, change "given at", or **🗑 Undo**. Tapping a logged round on the board opens the same panel.
2. **Who**: anyone in the group can fix any log.
3. **How long**: until that round's next reminder (e.g. this morning's log until tomorrow morning). After that, admins only.
4. **History kept**: every fix keeps the old version. The message shows "✏️ edited by Y"; an undo leaves "↩️ Undone by Y" in the history.
5. **Undo = not given**: the reminder gets ✅ All given back, and follow-ups and "⚠️ LATE" carry on as normal. A monthly med's next due date goes back to what it was.
6. **Quiet**: a fix only edits the message. No new message, no ping.
7. **Older logs**: admins use **📜 Fix a past log** in the private chat: pick the pet, pick from its last ~2 weeks of logs, then the same Change panel.
8. **Courses**: a course's start date follows the earliest dose still in the log, so undoing or moving the first dose moves its end date too.
