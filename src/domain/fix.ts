import { addDays, addMinutes, instantAt } from '../time.js';
import type { LocalDate, LogEntry, Person } from '../types.js';
import { findMed, findPet, findRound, hasItem, type Snapshot } from './snapshot.js';
import { monthlyDueDate } from './monthly.js';
import { effectiveAt } from './times.js';

/**
 * When "anyone can fix" ends and "admins only" begins for an entry:
 *  - round entry: the round's next reminder, i.e. the next day's due time (shifted past quiet hours);
 *  - monthly entry: the morning reminder of the med's next due date, counting this entry as given;
 *  - as-needed entry (or anything unrecognised): 24 hours after it was given.
 */
export function fixDeadline(snap: Snapshot, entry: LogEntry): Date {
  const pet = findPet(snap.settings, entry.petId);
  const fallback = addMinutes(entry.givenAt, 24 * 60);
  if (!pet) return fallback;
  const tz = snap.settings.timezone;
  if (entry.roundKey !== null) {
    const round = findRound(pet, entry.roundKey);
    if (!round) return fallback;
    return effectiveAt(snap.settings, instantAt(addDays(entry.forDate, 1), round.due, tz));
  }
  const med = entry.items[0] && findMed(snap, entry.items[0].medId);
  if (med?.kind !== 'monthly') return fallback;
  const due: LocalDate = monthlyDueDate(withEntryCounted(snap, entry), med);
  return effectiveAt(snap.settings, instantAt(due, pet.monthlyMorning, tz));
}

function withEntryCounted(snap: Snapshot, entry: LogEntry): Snapshot {
  const others = snap.entries.filter((e) => e.id !== entry.id);
  return { ...snap, entries: [...others, { ...entry, undone: false }] };
}

export type CanFix = { ok: true } | { ok: false; reason: string };

/** Anyone may fix before the deadline; afterwards only `settings.admins`. */
export function canFix(snap: Snapshot, entry: LogEntry, person: Person, now: Date): CanFix {
  if (now < fixDeadline(snap, entry)) return { ok: true };
  if (snap.settings.admins.includes(person.userId)) return { ok: true };
  return { ok: false, reason: 'The next reminder has gone out, so only admins can fix this log now.' };
}

export interface DoubleDose {
  entry: LogEntry;
  person: Person;
  givenAt: Date;
  /** The requested meds that were already given in that entry. */
  medIds: number[];
}

/**
 * Is any of `medIds` already given in an active entry of this occurrence? Returns the newest such entry.
 * For monthly meds pass `monthlyOccurrence(...)` as `forDate`. As-needed meds are matched on the day they
 * were given, so tapping one twice in a day also asks.
 */
export function findDoubleDose(
  snap: Snapshot,
  petId: string,
  roundKey: string | null,
  forDate: LocalDate,
  medIds: number[],
): DoubleDose | null {
  const hits = snap.entries
    .filter((e) => !e.undone && e.petId === petId && e.roundKey === roundKey && e.forDate === forDate)
    .map((entry) => ({ entry, medIds: medIds.filter((id) => hasItem(entry, id, 'given')) }))
    .filter((h) => h.medIds.length > 0)
    .sort((a, b) => b.entry.loggedAt.getTime() - a.entry.loggedAt.getTime() || b.entry.id - a.entry.id);
  const top = hits[0];
  return top ? { entry: top.entry, person: top.entry.loggedBy, givenAt: top.entry.givenAt, medIds: top.medIds } : null;
}
