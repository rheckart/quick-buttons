/**
 * Shared contracts for the Pet Meds bot. Words follow CONTEXT.md.
 * This file is the seam between modules: change it deliberately, never casually.
 *
 * Time conventions
 *  - An instant is a JS `Date`.
 *  - `LocalDate` is "YYYY-MM-DD" and `LocalTime` is "HH:MM" (24h), both in `Settings.timezone`.
 *  - Day boundaries, "today", and every due/late time use `Settings.timezone`, never the server zone.
 */

export type LocalDate = string;
export type LocalTime = string;

// ───────────────────────── Settings (from settings.yaml) ─────────────────────────

export interface RoundConfig {
  /** Stable slug used in callback data and the DB, e.g. "morning". Unique within a pet. */
  key: string;
  /** Display name, e.g. "Morning". */
  name: string;
  emoji: string;
  due: LocalTime;
  /** Strictly after `due`, same day. */
  lateAfter: LocalTime;
}

export interface PetConfig {
  /** Stable slug, e.g. "twiggy". Unique. */
  id: string;
  /** Display name, e.g. "Twiggy". */
  name: string;
  /** Telegram forum topic (message_thread_id) inside the group. */
  topicId: number;
  /** Sorted by `due`. May be empty (e.g. Faith only has a monthly med). */
  rounds: RoundConfig[];
  /** When monthly-med reminders fire on the due day. Defaults: earliest/latest round due, else 09:00 / 18:00. */
  monthlyMorning: LocalTime;
  monthlyEvening: LocalTime;
}

export interface Giver {
  userId: number;
  /** Shown in @mentions. */
  name: string;
}

export interface Settings {
  timezone: string;
  /** The "Pet Stuff" supergroup chat id (negative number). */
  groupChatId: number;
  /** Telegram user ids allowed to start/stop/edit meds and fix old logs. */
  admins: number[];
  givers: Giver[];
  pets: PetConfig[];
  quietHours: { start: LocalTime; end: LocalTime };
  /** Private chat that receives the nightly pg_dump. Defaults to the first admin's user id. */
  backupChatId: number;
  /** Local time of the nightly backup. Default 03:00. */
  backupTime: LocalTime;
}

// ───────────────────────── Meds and the log ─────────────────────────

export type MedKind = 'ongoing' | 'course' | 'monthly' | 'as_needed';

export interface Med {
  id: number;
  petId: string;
  name: string;
  kind: MedKind;
  doseNote: string | null;
  /** Round keys this med is given in. Only for ongoing/course; [] otherwise. */
  roundKeys: string[];
  /** Course length in days. Only for course. */
  days: number | null;
  /** Course: admin-set start date (else the earliest dose still in the log). */
  startedOn: LocalDate | null;
  /** Monthly: admin-set "last given" date, used until a real dose exists. */
  seedLastGiven: LocalDate | null;
  createdAt: Date;
  /** Set when an admin stops the med; it counts as stopped from this instant. */
  stoppedAt: Date | null;
}

export interface Person {
  userId: number;
  /** Telegram first name (or username fallback). */
  name: string;
}

export type ItemStatus = 'given' | 'skipped';

export interface EntryItem {
  medId: number;
  status: ItemStatus;
}

export type RevisionKind = 'create' | 'edit' | 'undo';

/**
 * One tap's worth of logging: a round (several meds) or a single monthly/as-needed med.
 * A med in the round that is NOT in `items` is "not given".
 * "Is it done?" is always derived from entries — there are no stored done flags.
 */
export interface LogEntry {
  id: number;
  petId: string;
  /** Round key, or null for a monthly / as-needed entry. */
  roundKey: string | null;
  /**
   * The occurrence this entry belongs to: the round's local date, the monthly med's due date,
   * or (as-needed) the local date it was given.
   */
  forDate: LocalDate;
  givenAt: Date;
  loggedAt: Date;
  loggedBy: Person;
  items: EntryItem[];
  /** Undone entries count as "not given". They stay in the DB forever. */
  undone: boolean;
  /** The most recent revision (create/edit/undo) and who made it. */
  lastRevision: { kind: RevisionKind; by: Person; at: Date };
  /** Telegram message id of the record/reminder message this entry is shown on, if any. */
  recordMessageId: number | null;
}

/** Append-only history: a full snapshot after every create/edit/undo. */
export interface EntryRevision {
  entryId: number;
  rev: number;
  kind: RevisionKind;
  by: Person;
  at: Date;
  givenAt: Date;
  items: EntryItem[];
  undone: boolean;
}

// ───────────────────────── Bot messages the bot must find again ─────────────────────────

export type BotMessageKind =
  | 'reminder' // reminder / record message for a round or monthly med occurrence
  | 'followup' // @mentions followers halfway to late-after (also the monthly evening nudge)
  | 'board' // pinned board, one per pet
  | 'panel' // temporary Change/Fix panel posted from the board or a past-log flow
  | 'double_dose' // "already given, log again?" prompt
  | 'course_finished'; // "<med> course finished 🎉" (one per med, kept to avoid repeats)

export interface BotMessage {
  /** Short numeric id, used inside callback data (Telegram caps callback data at 64 bytes). */
  id: number;
  kind: BotMessageKind;
  petId: string | null;
  roundKey: string | null;
  medId: number | null;
  /** The occurrence date (see LogEntry.forDate). null for boards. */
  forDate: LocalDate | null;
  chatId: number;
  threadId: number | null;
  /** Telegram message id. */
  messageId: number;
  /** Hash of what we last sent, so unchanged messages are not re-edited. */
  renderHash: string;
  createdAt: Date;
  deletedAt: Date | null;
}

// ───────────────────────── Rendered output ─────────────────────────

/** HTML parse mode text + inline keyboard of callback buttons. */
export interface Rendered {
  /** Telegram HTML (escape user text!). */
  text: string;
  keyboard: Button[][];
}

export interface Button {
  text: string;
  /** Encoded `Callback` (see callbacks.ts), at most 64 bytes. */
  data: string;
}

// ───────────────────────── Ports (faked in tests) ─────────────────────────

export interface Clock {
  now(): Date;
}

export interface Target {
  chatId: number;
  threadId?: number | null;
}

/** Thin wrapper over the Telegram Bot API. Real impl uses grammy; tests use a fake. */
export interface Messenger {
  send(to: Target, content: Rendered): Promise<number>;
  /** Editing to identical content must not throw. A message that no longer exists must not throw either. */
  edit(chatId: number, messageId: number, content: Rendered): Promise<void>;
  /** Deleting a message that is already gone must not throw. */
  delete(chatId: number, messageId: number): Promise<void>;
  pin(chatId: number, messageId: number): Promise<void>;
  sendDocument(chatId: number, filename: string, data: Uint8Array, caption?: string): Promise<void>;
}

/** Minimal SQL interface so the same code runs on `pg` (prod) and PGlite (tests). Uses $1, $2… params. */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Runs `fn` in a transaction; rolls back if it throws. Nested calls reuse the outer transaction. */
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

// ───────────────────────── Views built by the domain, drawn by render ─────────────────────────

export type MedState = 'given' | 'skipped' | 'pending';

/** What a round looks like at one moment, for one pet on one date. Built fresh from the log every time. */
export interface RoundView {
  petId: string;
  petName: string;
  roundKey: string;
  roundName: string;
  emoji: string;
  forDate: LocalDate;
  due: LocalTime;
  lateAfter: LocalTime;
  /** Meds in this round on this date, in a stable order (by med id). */
  meds: { med: Med; state: MedState }[];
  /** `late` = pending meds remain and now >= lateAfter. `due` = pending and due time reached. `upcoming` = due not reached. */
  phase: 'upcoming' | 'due' | 'late';
  /** No pending meds remain (all given or skipped) and at least one is in the round. */
  complete: boolean;
  /** At least one active entry covers this round on this date. */
  anyLogged: boolean;
  /** The newest active entry (given by whom / when). null when nothing is logged. */
  latest: EntryView | null;
}

export interface EntryView {
  entryId: number;
  by: Person;
  givenAt: Date;
  loggedAt: Date;
  /** givenAt differs from loggedAt by more than a minute. */
  backdated: boolean;
  /** Logged (loggedAt) after the round's late-after time; false for monthly/as-needed. */
  givenLate: boolean;
  /** Set if the newest revision is an edit. */
  editedBy: Person | null;
  /** Set if the newest revision is an undo (entry is then inactive, shown as history). */
  undoneBy: Person | null;
}

/** A monthly or as-needed med as shown on the board / its reminder. */
export interface SingleMedView {
  petId: string;
  petName: string;
  med: Med;
  /** monthly only: the day it is due (local date). */
  dueDate: LocalDate | null;
  /** The last active dose, if any. */
  lastGivenAt: Date | null;
  lastGivenBy: Person | null;
  /** monthly only. `given` = the current occurrence is already logged. */
  phase: 'upcoming' | 'due' | 'late' | 'given' | 'as_needed';
  latest: EntryView | null;
}

export interface BoardView {
  petId: string;
  petName: string;
  rounds: RoundView[];
  singles: SingleMedView[];
}

// ───────────────────────── Callback data ─────────────────────────

/**
 * Everything a button can say. `m` is a `BotMessage.id` — the message the button sits on.
 * Encoded to a short string by callbacks.ts (<= 64 bytes).
 */
export type Callback =
  // reminder / record message
  | { t: 'logAll'; m: number } // ✅ All given (everything still pending)
  | { t: 'change'; m: number } // ⚙️ Change… / ✏️ Fix  (opens the panel; Fix when already logged)
  // change/fix panel
  | { t: 'setMed'; m: number; i: number; s: MedState } // row i → given | pending ("not yet") | skipped
  | { t: 'givenAt'; m: number } // open the "given at" picker
  | { t: 'ago'; m: number; mins: number } // 0 = now
  | { t: 'typeTime'; m: number } // ⌨️ ask for a typed time
  | { t: 'back'; m: number } // « Back (discard panel edits / leave picker)
  | { t: 'save'; m: number } // ✅ Log these / Save
  | { t: 'undo'; m: number } // 🗑 Undo
  // monthly / as-needed reminder
  | { t: 'logSingle'; m: number }
  // board: target is a round key or "m<medId>"
  | { t: 'board'; petId: string; target: string }
  // double-dose prompt: m is the prompt's BotMessage id
  | { t: 'dd'; m: number; yes: boolean }
  // admin (private chat)
  | { t: 'admin'; a: string; v?: string };
