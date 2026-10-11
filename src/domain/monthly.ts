import { addMonth, localDate } from '../time.js';
import type { LocalDate, LogEntry, Med, SingleMedView } from '../types.js';
import {
  findPet,
  hasItem,
  latestDose,
  occurrenceEntries,
  pickLatest,
  type Snapshot,
  todayOf,
} from './snapshot.js';

/**
 * When a monthly med is next due: one calendar month after the latest ACTIVE given dose, else after
 * `seedLastGiven`, else the day the med was created. Undoing a dose therefore restores the previous date.
 */
export function monthlyDueDate(snap: Snapshot, med: Med): LocalDate {
  const tz = snap.settings.timezone;
  const dose = latestDose(snap, med.id);
  if (dose) return addMonth(localDate(dose.givenAt, tz));
  if (med.seedLastGiven) return addMonth(med.seedLastGiven);
  return localDate(med.createdAt, tz);
}

/** Is there an active given dose recorded against this occurrence (due date) of the monthly med? */
export function occurrenceGiven(snap: Snapshot, med: Med, forDate: LocalDate): boolean {
  return occurrenceEntries(snap, med.petId, null, forDate).some((e) => !e.undone && hasItem(e, med.id, 'given'));
}

/**
 * The occurrence a tap on a monthly med belongs to today. USE THIS for a new entry's `forDate` and
 * for the double-dose check.
 *
 * It is the occurrence of the latest active dose while that occurrence is still "current" (neither its
 * due day nor the day it was given has passed), else the next due date. So a dose given early for the
 * 14th stays the current occurrence through the 14th, and a second tap before then is a double dose.
 */
export function monthlyOccurrence(snap: Snapshot, med: Med, now: Date): LocalDate {
  const dose = latestDose(snap, med.id);
  if (dose) {
    const givenOn = localDate(dose.givenAt, snap.settings.timezone);
    if ((givenOn > dose.forDate ? givenOn : dose.forDate) >= todayOf(snap, now)) return dose.forDate;
  }
  return monthlyDueDate(snap, med);
}

/**
 * A monthly or as-needed med as shown on the board or its reminder.
 *
 * Monthly: `forDate` is the occurrence to describe; default = `monthlyOccurrence` (the current one).
 *  - phase `given` when an active given dose is recorded against that occurrence. For the current
 *    occurrence this lasts until its due day / given day passes; for an explicit older `forDate` it is
 *    permanent (a past record message stays "given").
 *  - otherwise `upcoming` / `due` (on the day) / `late` (after the due day) by the local date.
 *  - `dueDate` is that occurrence; while the current occurrence is `given` it is the NEXT due date
 *    instead (what the board shows).
 *  - `latest` = newest active entry of the occurrence, else the newest undone one (undoneBy set).
 * As-needed: phase `as_needed`; `latest` = newest active entry of any day (else the newest undone one).
 */
export function buildSingleView(snap: Snapshot, med: Med, now: Date, forDate?: LocalDate): SingleMedView {
  if (med.kind !== 'monthly' && med.kind !== 'as_needed') throw new Error(`med ${med.id} is not a single med`);
  const pet = findPet(snap.settings, med.petId);
  const dose = latestDose(snap, med.id);
  const base = {
    petId: med.petId,
    petName: pet?.name ?? med.petId,
    med,
    lastGivenAt: dose?.givenAt ?? null,
    lastGivenBy: dose?.loggedBy ?? null,
  };
  const entries = singleEntries(snap, med);
  if (med.kind === 'as_needed') {
    return { ...base, dueDate: null, phase: 'as_needed', latest: pickLatest(entries, null) };
  }

  const occurrence = forDate ?? monthlyOccurrence(snap, med, now);
  const given = occurrenceGiven(snap, med, occurrence);
  const today = todayOf(snap, now);
  const phase = given ? 'given' : today < occurrence ? 'upcoming' : today === occurrence ? 'due' : 'late';
  return {
    ...base,
    dueDate: given && forDate === undefined ? monthlyDueDate(snap, med) : occurrence,
    phase,
    latest: pickLatest(
      entries.filter((e) => e.forDate === occurrence),
      null,
    ),
  };
}

function singleEntries(snap: Snapshot, med: Med): LogEntry[] {
  return snap.entries.filter((e) => e.petId === med.petId && e.roundKey === null && hasItem(e, med.id));
}
