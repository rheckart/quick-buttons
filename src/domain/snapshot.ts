import { localDate } from '../time.js';
import type { EntryView, LocalDate, LogEntry, Med, PetConfig, RoundConfig, Settings } from '../types.js';

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
