import { addDays, localDate } from '../time.js';
import type { LocalDate, LogEntry, Med } from '../types.js';
import { findPet, isDaily, isStopped, type Snapshot, todayOf } from './snapshot.js';

/**
 * Inclusive first and last day of a course. start = admin-set `startedOn`, else the local date of the
 * earliest ACTIVE given dose, else null (not started). end needs both a start and `days`.
 */
export function courseWindow(
  med: Med,
  entries: LogEntry[],
  tz: string,
): { start: LocalDate | null; end: LocalDate | null } {
  const start = med.startedOn ?? firstDoseDate(med, entries, tz);
  const end = start !== null && med.days !== null ? addDays(start, med.days - 1) : null;
  return { start, end };
}

function firstDoseDate(med: Med, entries: LogEntry[], tz: string): LocalDate | null {
  const times = entries
    .filter((e) => !e.undone && e.items.some((i) => i.medId === med.id && i.status === 'given'))
    .map((e) => e.givenAt.getTime());
  return times.length ? localDate(new Date(Math.min(...times)), tz) : null;
}

/** Is a daily med (ongoing/course) scheduled on this date? Monthly and as-needed meds are never "daily". */
export function isMedActiveOn(snap: Snapshot, med: Med, date: LocalDate): boolean {
  if (!isDaily(med)) return false;
  const tz = snap.settings.timezone;
  if (localDate(med.createdAt, tz) > date) return false;
  if (med.stoppedAt !== null && localDate(med.stoppedAt, tz) <= date) return false;
  if (med.kind !== 'course') return true;
  const { start, end } = courseWindow(med, snap.entries, tz);
  return start === null || (date >= start && (end === null || date <= end));
}

/** Courses whose last day was yesterday or the day before (the day before covers a missed day). */
export function coursesJustFinished(snap: Snapshot, now: Date): Med[] {
  const today = todayOf(snap, now);
  const recent = [addDays(today, -1), addDays(today, -2)];
  return snap.meds.filter((m) => {
    if (m.kind !== 'course' || isStopped(m, now) || !findPet(snap.settings, m.petId)) return false;
    const { end } = courseWindow(m, snap.entries, snap.settings.timezone);
    return end !== null && recent.includes(end);
  });
}
