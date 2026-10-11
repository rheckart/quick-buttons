import { DateTime } from 'luxon';
import type { LocalDate, LocalTime } from './types.js';

/** Zone-aware helpers. All "dates" and "times" in the app are local to the configured zone. */

const dt = (d: Date, tz: string): DateTime => DateTime.fromJSDate(d, { zone: tz });

export function isValidZone(tz: string): boolean {
  return DateTime.local().setZone(tz).isValid;
}

export function isLocalTime(s: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

export function isLocalDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && DateTime.fromISO(s, { zone: 'utc' }).isValid;
}

export function localDate(d: Date, tz: string): LocalDate {
  return dt(d, tz).toFormat('yyyy-MM-dd');
}

export function localTime(d: Date, tz: string): LocalTime {
  return dt(d, tz).toFormat('HH:mm');
}

/** The instant a local date + time happens in `tz`. A time inside a DST gap moves forward (luxon). */
export function instantAt(date: LocalDate, time: LocalTime, tz: string): Date {
  const r = DateTime.fromISO(`${date}T${time}`, { zone: tz });
  if (!r.isValid) throw new Error(`bad local date/time: ${date} ${time} (${tz})`);
  return r.toJSDate();
}

export function startOfLocalDay(date: LocalDate, tz: string): Date {
  return instantAt(date, '00:00', tz);
}

/** Calendar-day arithmetic (not 24h blocks), so it survives DST changes. */
export function addDays(date: LocalDate, n: number): LocalDate {
  return DateTime.fromISO(date, { zone: 'utc' }).plus({ days: n }).toFormat('yyyy-MM-dd');
}

/** One calendar month later, clamped to month end (Jan 31 → Feb 28/29). */
export function addMonth(date: LocalDate): LocalDate {
  return DateTime.fromISO(date, { zone: 'utc' }).plus({ months: 1 }).toFormat('yyyy-MM-dd');
}

/** b − a in whole calendar days. */
export function daysBetween(a: LocalDate, b: LocalDate): number {
  const x = DateTime.fromISO(a, { zone: 'utc' });
  const y = DateTime.fromISO(b, { zone: 'utc' });
  return Math.round(y.diff(x, 'days').days);
}

export function minutesBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 60_000;
}

export function addMinutes(d: Date, mins: number): Date {
  return new Date(d.getTime() + mins * 60_000);
}

/** "H:mm" 24h, no leading zero on the hour — "8:15", "18:00". Accepts an instant or a LocalTime. */
export function fmtTime(x: Date | LocalTime, tz?: string): string {
  if (typeof x === 'string') {
    const [h, m] = x.split(':');
    return `${Number(h)}:${m}`;
  }
  return dt(x, tz ?? 'utc').toFormat('H:mm');
}

/** "Tue 14 Oct" */
export function fmtDay(date: LocalDate): string {
  return DateTime.fromISO(date, { zone: 'utc', locale: 'en' }).toFormat('ccc d LLL');
}

/** "2 Oct" */
export function fmtShortDay(date: LocalDate): string {
  return DateTime.fromISO(date, { zone: 'utc', locale: 'en' }).toFormat('d LLL');
}

/** The midpoint between two local times on one day, as a LocalTime (rounded down to the minute). */
export function midpoint(a: LocalTime, b: LocalTime): LocalTime {
  const m = (t: LocalTime) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const mid = Math.floor((m(a) + m(b)) / 2);
  return `${String(Math.floor(mid / 60)).padStart(2, '0')}:${String(mid % 60).padStart(2, '0')}`;
}

export interface QuietHours {
  start: LocalTime;
  end: LocalTime;
}

/** Is `d` inside quiet hours? Handles windows that wrap midnight (22:00–07:00). start === end means never quiet. */
export function inQuietHours(d: Date, q: QuietHours, tz: string): boolean {
  if (q.start === q.end) return false;
  const t = localTime(d, tz);
  return q.start < q.end ? t >= q.start && t < q.end : t >= q.start || t < q.end;
}

/**
 * The first instant at or after `d` that is not quiet. If `d` is already outside quiet hours, returns `d`.
 */
export function quietEndAtOrAfter(d: Date, q: QuietHours, tz: string): Date {
  if (!inQuietHours(d, q, tz)) return d;
  const local = dt(d, tz);
  const date = local.toFormat('yyyy-MM-dd');
  const t = local.toFormat('HH:mm');
  // Wrapping window, and we're in the evening half → the end is tomorrow.
  const endDate = q.start > q.end && t >= q.start ? addDays(date, 1) : date;
  return instantAt(endDate, q.end, tz);
}

export type TypedTime = { ok: true; at: Date } | { ok: false; reason: 'unparseable' | 'future' };

/**
 * Parse a typed "given at" like "7:45", "19:45", "7pm", "7:45 pm", "7.45", "745" as TODAY (local) in `tz`.
 * Times later than `now` (more than 1 minute) are rejected as 'future' — no guessing yesterday.
 */
export function parseTypedTime(input: string, now: Date, tz: string): TypedTime {
  const m = input
    .trim()
    .toLowerCase()
    .match(/^(\d{1,2})(?:[:.]?(\d{2}))?\s*(a\.?m?\.?|p\.?m?\.?)?$/);
  if (!m) return { ok: false, reason: 'unparseable' };
  let h = Number(m[1]);
  const min = m[2] === undefined ? 0 : Number(m[2]);
  const mer = m[3]?.[0];
  if (min > 59) return { ok: false, reason: 'unparseable' };
  if (mer) {
    if (h < 1 || h > 12) return { ok: false, reason: 'unparseable' };
    h = (h % 12) + (mer === 'p' ? 12 : 0);
  } else if (h > 23) {
    return { ok: false, reason: 'unparseable' };
  }
  const at = instantAt(localDate(now, tz), `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`, tz);
  if (at.getTime() > now.getTime() + 60_000) return { ok: false, reason: 'future' };
  return { ok: true, at };
}
