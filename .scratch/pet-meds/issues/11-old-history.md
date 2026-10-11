# Is the old Telegram history carried over?

Type: grilling
Status: resolved
Assignee: Rob
Blocked by: 10

## Question

The "Pet Stuff" group already has typed dose logs in each pet's topic. Should any of it be imported into the new log (e.g. so Simparica's next due date and a running course's start date are right on day one), or does the bot start fresh with admins setting current state (last Simparica date, course day) by hand at setup?

## Answer

1. **Start fresh**: none of the old typed logs are imported.
2. **Old messages stay** in the pet topics as they are; the pinned board sits on top.
3. **Starting state**: the admin **Start med** draft card (see "What do the bot's messages and buttons look like?") gets one more field — **Last given** (date) for monthly meds, which sets the next due date, and **Started on** (date, default "first dose") for courses. Used on day one for Simparica and the running antibiotic, and later whenever the vet gives a first dose at the clinic.
4. **Course start rule** (refines "How is a wrong log fixed?" point 8): a course counts its days from **Started on** if an admin set it; otherwise from the earliest dose still in the log.
