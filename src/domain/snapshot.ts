import { localDate } from '../time.js';
import type { EntryView, LocalDate, LogEntry, Med, Person, PetConfig, RoundConfig, Settings } from '../types.js';

/** Everything the pure rules need. `entries` may include undone ones; status ignores them. */
export interface Snapshot {
  settings: Settings;
  meds: Med[];
  entries: LogEntry[];
}

export const todayOf = (snap: Snapshot, now: Date): LocalDate => localDate(now, snap.settings.timezone);

export const findPet = (settings: Settings, petId: string): PetConfig | undefined =>
  settings.pets.find((p) => p.id === petId);

export const findRound = (pet: PetConfig, key: string): RoundConfig | undefined =>
  pet.rounds.find((r) => r.key === key);

export const findMed = (snap: Snapshot, id: number): Med | undefined => snap.meds.find((m) => m.id === id);

export const isStopped = (med: Med, now: Date): boolean => med.stoppedAt !== null && med.stoppedAt <= now;

export const isDaily = (med: Med): boolean => med.kind === 'ongoing' || med.kind === 'course';

export const hasItem = (e: LogEntry, medId: number, status?: 'given' | 'skipped'): boolean =>
  e.items.some((i) => i.medId === medId && (status === undefined || i.status === status));

const newestFirst = (a: LogEntry, b: LogEntry): number =>
  b.loggedAt.getTime() - a.loggedAt.getTime() || b.id - a.id;

/** Entries (active and undone) of one occurrence of a round or of the monthly/as-needed list (`roundKey` null). */
export function occurrenceEntries(
  snap: Snapshot,
  petId: string,
  roundKey: string | null,
  forDate: LocalDate,
): LogEntry[] {
  return snap.entries.filter((e) => e.petId === petId && e.roundKey === roundKey && e.forDate === forDate);
}

/** Active entries holding a *given* item for the med, oldest dose first by `givenAt`. */
export function givenDoses(snap: Snapshot, medId: number): LogEntry[] {
  return snap.entries
    .filter((e) => !e.undone && hasItem(e, medId, 'given'))
    .sort((a, b) => a.givenAt.getTime() - b.givenAt.getTime() || a.id - b.id);
}

/** The active entry with the latest dose of this med (by `givenAt`), if any. */
export function latestDose(snap: Snapshot, medId: number): LogEntry | null {
  return givenDoses(snap, medId).at(-1) ?? null;
}

/**
 * The entry a message should show: the newest active one. If every entry of the occurrence is undone,
 * the newest undone one (so render can say "Undone by Y"). null when there are no entries at all.
 */
export function pickLatest(entries: LogEntry[], lateAt: Date | null): EntryView | null {
  const sorted = [...entries].sort(newestFirst);
  const entry = sorted.find((e) => !e.undone) ?? sorted[0];
  return entry ? toEntryView(entry, lateAt) : null;
}

/**
 * Like `pickLatest`, for a round occurrence that may hold several active entries (a partial log, then
 * "Log the rest" by someone else; or fixes of an older entry):
 *  - `by` stays the newest-created active entry's logger; `alsoBy` = the other distinct people who logged
 *    an active entry, oldest first;
 *  - `editedBy` = the newest edit revision across active entries that is newer than the newest create
 *    (the newest entry's own edit always counts).
 */
export function pickRoundLatest(entries: LogEntry[], lateAt: Date | null): EntryView | null {
  const view = pickLatest(entries, lateAt);
  const active = entries.filter((e) => !e.undone);
  const newest = [...active].sort(newestFirst)[0];
  if (!view || !newest) return view;

  const alsoBy: Person[] = [];
  for (const e of [...active].sort((a, b) => -newestFirst(a, b))) {
    const id = e.loggedBy.userId;
    if (id !== newest.loggedBy.userId && !alsoBy.some((p) => p.userId === id)) alsoBy.push(e.loggedBy);
  }

  const edits = active
    .filter((e) => e.lastRevision.kind === 'edit' && (e === newest || e.lastRevision.at > newest.loggedAt))
    .sort((a, b) => b.lastRevision.at.getTime() - a.lastRevision.at.getTime() || b.id - a.id);
  return { ...view, alsoBy, editedBy: edits[0]?.lastRevision.by ?? null };
}

function toEntryView(e: LogEntry, lateAt: Date | null): EntryView {
  const rev = e.lastRevision;
  return {
    entryId: e.id,
    by: e.loggedBy,
    givenAt: e.givenAt,
    loggedAt: e.loggedAt,
    backdated: Math.abs(e.givenAt.getTime() - e.loggedAt.getTime()) > 60_000,
    givenLate: lateAt !== null && e.loggedAt >= lateAt,
    editedBy: !e.undone && rev.kind === 'edit' ? rev.by : null,
    undoneBy: e.undone ? rev.by : null,
  };
}
