import { buildRoundView } from '../domain/index.js';
import type { Snapshot } from '../domain/index.js';
import { findMed, hasItem, occurrenceEntries } from '../domain/snapshot.js';
import type { LocalDate, LogEntry, Med, MedState } from '../types.js';

/** Identifies one thing that can be logged: a round on a date, or a monthly/as-needed med. */
export interface OccKey {
  petId: string;
  roundKey: string | null;
  /** The single med for monthly/as-needed occurrences; null for rounds. */
  medId: number | null;
  forDate: LocalDate;
  /** As-needed only: the dose a fix targets (each as-needed tap is its own record). */
  entryId: number | null;
}

export interface Occurrence {
  key: OccKey;
  /** One row per med, as the panel shows them. */
  meds: { med: Med; state: MedState }[];
  /** Active entries of the occurrence, newest first. Several exist after "log the rest" or a re-log. */
  entries: LogEntry[];
}

const newestFirst = (a: LogEntry, b: LogEntry): number =>
  b.loggedAt.getTime() - a.loggedAt.getTime() || b.id - a.id;

function singleState(entries: LogEntry[], medId: number): MedState {
  const items = entries.flatMap((e) => e.items.filter((i) => i.medId === medId));
  if (items.some((i) => i.status === 'given')) return 'given';
  return items.some((i) => i.status === 'skipped') ? 'skipped' : 'pending';
}

export function occurrenceOf(snap: Snapshot, key: OccKey, now: Date): Occurrence | null {
  if (key.roundKey !== null) {
    const view = buildRoundView(snap, key.petId, key.roundKey, key.forDate, now);
    if (!view) return null;
    const entries = occurrenceEntries(snap, key.petId, key.roundKey, key.forDate).filter((e) => !e.undone);
    return { key, meds: view.meds, entries: entries.sort(newestFirst) };
  }
  const med = key.medId === null ? undefined : findMed(snap, key.medId);
  if (!med) return null;
  const entries = occurrenceEntries(snap, key.petId, null, key.forDate)
    .filter((e) => !e.undone && hasItem(e, med.id) && (med.kind !== 'as_needed' || e.id === key.entryId))
    .sort(newestFirst);
  return { key, meds: [{ med, state: singleState(entries, med.id) }], entries };
}
