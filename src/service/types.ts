import type { MedPatch } from '../db/repos.js';
import type { MedDraft } from '../render/index.js';
import type { LogEntry, Med, Person } from '../types.js';

export interface CallbackCtx {
  from: Person;
  chatId: number;
  /** Telegram id of the message holding the button. */
  messageId: number;
  threadId: number | null;
}

export interface CallbackResult {
  toast?: string;
  /** Show the toast as a modal alert. */
  alert?: boolean;
}

export interface TypedTimeCtx {
  from: Person;
  chatId: number;
  replyToMessageId: number;
  text: string;
}

export interface TypedTimeResult {
  handled: boolean;
  reply?: string;
}

export interface Service {
  /** Scheduler tick. Idempotent: running it twice with nothing changed makes no Telegram calls. */
  reconcile(): Promise<void>;
  handleCallback(cb: import('../types.js').Callback, ctx: CallbackCtx): Promise<CallbackResult>;
  handleTypedTime(ctx: TypedTimeCtx): Promise<TypedTimeResult>;
  isAdmin(userId: number): boolean;
  startMed(draft: MedDraft, by: Person): Promise<Med>;
  stopMed(medId: number, by: Person): Promise<Med>;
  editMed(medId: number, patch: MedPatch, by: Person): Promise<Med>;
  /** Active meds only. */
  listMeds(petId: string): Promise<Med[]>;
  listPastEntries(petId: string, days?: number): Promise<{ entry: LogEntry; label: string }[]>;
  /** Admin "Fix a past log": posts a temporary panel message in the given chat. */
  openFixPanel(entryId: number, chatId: number, threadId: number | null, by: Person): Promise<void>;
  /** Creates and pins (silently) any missing board. Also part of reconcile. */
  ensureBoards(): Promise<void>;
}
