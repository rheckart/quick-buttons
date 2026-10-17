import type { DraftField, MedDraft } from '../../render/index.js';
import type { LocalDate, MedKind } from '../../types.js';
import { parseTypedDate } from '../dates.js';

/** Draft fields answered by typing. */
export type TypedField = 'name' | 'doseNote' | 'days' | 'lastGiven' | 'startedOn';

export const MAX_NAME = 40;
export const MAX_NOTE = 100;
export const MAX_DAYS = 365;

export type Answer<T> = { ok: true; value: T } | { ok: false; error: string };

const isDaily = (k: MedKind | undefined): boolean => k === 'ongoing' || k === 'course';

/** Does this field belong on the card for the draft's current kind? */
export function fieldApplies(draft: MedDraft, field: DraftField): boolean {
  switch (field) {
    case 'rounds': return isDaily(draft.kind);
    case 'days':
    case 'startedOn': return draft.kind === 'course';
    case 'lastGiven': return draft.kind === 'monthly';
    default: return true;
  }
}

export const isTypedField = (f: DraftField): f is TypedField =>
  f === 'name' || f === 'doseNote' || f === 'days' || f === 'lastGiven' || f === 'startedOn';

/** Changing the kind drops the fields that no longer apply. */
export function withKind(draft: MedDraft, kind: MedKind): MedDraft {
  const next: MedDraft = { roundKeys: isDaily(kind) ? draft.roundKeys : [], kind };
  if (draft.petId) next.petId = draft.petId;
  if (draft.name) next.name = draft.name;
  if (draft.doseNote) next.doseNote = draft.doseNote;
  if (kind === 'course' && draft.days !== undefined) next.days = draft.days;
  if (kind === 'course' && draft.startedOn) next.startedOn = draft.startedOn;
  if (kind === 'monthly' && draft.lastGiven) next.lastGiven = draft.lastGiven;
  return next;
}

/** Changing the pet drops the rounds, which belong to the old one. */
export function withPet(draft: MedDraft, petId: string): MedDraft {
  return petId === draft.petId ? draft : { ...draft, petId, roundKeys: [] };
}

/** Sets or clears (undefined) one typed field. */
export function withTyped(draft: MedDraft, field: TypedField, value: string | number | undefined): MedDraft {
  const { [field]: _dropped, ...rest } = draft;
  return value === undefined ? rest : { ...rest, [field]: value };
}

export function toggleRound(keys: string[], key: string): string[] {
  return keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key];
}

// ───────────────────────── typed answers ─────────────────────────

const CLEAR = '-';

export function parseName(text: string): Answer<string> {
  const name = text.trim().replace(/\s+/g, ' ');
  const length = [...name].length;
  if (length === 0) return { ok: false, error: 'The name cannot be empty.' };
  if (length > MAX_NAME) return { ok: false, error: `That name is too long (${MAX_NAME} characters at most).` };
  return { ok: true, value: name };
}

/** "-" clears the note. */
export function parseDoseNote(text: string): Answer<string | undefined> {
  const note = text.trim().replace(/\s+/g, ' ');
  if (note === CLEAR) return { ok: true, value: undefined };
  if (note === '') return { ok: false, error: 'Type the note, or - to remove it.' };
  if ([...note].length > MAX_NOTE) return { ok: false, error: `That note is too long (${MAX_NOTE} characters at most).` };
  return { ok: true, value: note };
}

export function parseDays(text: string): Answer<number> {
  const m = text.trim().match(/^(\d+)\s*(?:days?|d)?$/i);
  const days = m ? Number(m[1]) : NaN;
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    return { ok: false, error: `Type a whole number of days from 1 to ${MAX_DAYS}.` };
  }
  return { ok: true, value: days };
}

/** "-" clears the date. Last given cannot be in the future; Started on can. */
export function parseDateAnswer(text: string, field: 'lastGiven' | 'startedOn', today: LocalDate): Answer<LocalDate | undefined> {
  if (text.trim() === CLEAR) return { ok: true, value: undefined };
  const r = parseTypedDate(text, today, { allowFuture: field === 'startedOn' });
  return r.ok ? { ok: true, value: r.date } : { ok: false, error: r.error };
}

export function parseTyped(field: TypedField, text: string, today: LocalDate): Answer<string | number | undefined> {
  switch (field) {
    case 'name': return parseName(text);
    case 'doseNote': return parseDoseNote(text);
    case 'days': return parseDays(text);
    default: return parseDateAnswer(text, field, today);
  }
}

export function askPrompt(field: TypedField): string {
  switch (field) {
    case 'name': return `Type the name of the med (up to ${MAX_NAME} characters).`;
    case 'doseNote': return 'Type the dose note, e.g. "2 drops each eye". Send - to remove it.';
    case 'days': return 'Type the number of days.';
    case 'lastGiven': return 'Type the date it was last given, e.g. "2 Oct" or "3 days ago". Send - to clear it.';
    case 'startedOn': return 'Type the date the course started, e.g. "2 Oct" or "yesterday". This only sets day 1; it does not log a dose. Send - to start the count at the first logged dose.';
  }
}
