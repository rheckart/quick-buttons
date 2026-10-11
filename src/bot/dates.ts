import { addDays, daysBetween, isLocalDate } from '../time.js';
import type { LocalDate } from '../types.js';

export type DateParse = { ok: true; date: LocalDate } | { ok: false; error: string };

export interface DateRules {
  /** "Started on" may be a day that has not come yet; "Last given" may not. */
  allowFuture: boolean;
}

const HINT = 'Try 2026-10-02, "2 Oct", "yesterday" or "3 days ago".';
const MAX_BACK_DAYS = 5 * 366;
const MAX_AHEAD_DAYS = 366;
/** A year-less date this far ahead (when the future is allowed) is taken to mean last year's. */
const YEARLESS_AHEAD_DAYS = 183;

const FULL_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** "oct", "sept", "october" → 10. */
const MONTH_BY_WORD = new Map<string, number>([
  ...FULL_MONTHS.map((name, i): [string, number] => [name, i + 1]),
  ...FULL_MONTHS.map((name, i): [string, number] => [name.slice(0, 3), i + 1]),
  ['sept', 9],
]);

const monthNumber = (word: string): number | null => MONTH_BY_WORD.get(word) ?? null;

const pad = (n: number): string => String(n).padStart(2, '0');

function build(year: number, month: number, day: number): LocalDate | null {
  const s = `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`;
  return isLocalDate(s) ? s : null;
}

function normalise(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[,.]/g, ' ')
    .replace(/\b(\d{1,2})(st|nd|rd|th)\b/g, '$1')
    .replace(/\s+/g, ' ');
}

/** "2026-10-02" or an invalid combination (null). */
function fromIso(s: string): LocalDate | null | undefined {
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  return m ? build(Number(m[1]), Number(m[2]), Number(m[3])) : undefined;
}

interface DayMonth {
  day: number;
  month: number;
  year: number | null;
}

/** "2 oct", "2 october 2025", "oct 2", "october 2 2025". */
function fromWords(s: string): DayMonth | null {
  let m = s.match(/^(\d{1,2}) ([a-z]+)(?: (\d{4}))?$/);
  let day: string | undefined;
  let word: string | undefined;
  let year: string | undefined;
  if (m) [, day, word, year] = m;
  else {
    m = s.match(/^([a-z]+) (\d{1,2})(?: (\d{4}))?$/);
    if (m) [, word, day, year] = m;
  }
  const month = word ? monthNumber(word) : null;
  if (!day || month === null) return null;
  return { day: Number(day), month, year: year ? Number(year) : null };
}

/** The most recent real occurrence of month/day on or before `today` (skips Feb 29 in non-leap years). */
function latestPast(dm: DayMonth, today: LocalDate): LocalDate | null {
  const thisYear = Number(today.slice(0, 4));
  for (let y = thisYear; y >= thisYear - 8; y--) {
    const d = build(y, dm.month, dm.day);
    if (d && d <= today) return d;
  }
  return null;
}

function yearless(dm: DayMonth, today: LocalDate, allowFuture: boolean): LocalDate | null {
  if (!allowFuture) return latestPast(dm, today);
  const thisYear = Number(today.slice(0, 4));
  const d = build(thisYear, dm.month, dm.day);
  if (d && daysBetween(today, d) > YEARLESS_AHEAD_DAYS) return build(thisYear - 1, dm.month, dm.day);
  return d;
}

function relative(s: string, today: LocalDate): LocalDate | null | undefined {
  if (s === 'today') return today;
  if (s === 'yesterday') return addDays(today, -1);
  if (s === 'tomorrow') return addDays(today, 1);
  const m = s.match(/^(\d+|a|an|one) days? ago$/);
  if (!m) return undefined;
  const n = /^\d+$/.test(m[1]!) ? Number(m[1]) : 1;
  return addDays(today, -Math.min(n, 100_000));
}

function resolve(s: string, today: LocalDate, rules: DateRules): LocalDate | null | undefined {
  const rel = relative(s, today);
  if (rel !== undefined) return rel;
  const iso = fromIso(s);
  if (iso !== undefined) return iso;
  const dm = fromWords(s);
  if (!dm) return undefined;
  if (dm.year !== null) return build(dm.year, dm.month, dm.day);
  return yearless(dm, today, rules.allowFuture);
}

function checkRange(date: LocalDate, today: LocalDate, rules: DateRules): DateParse {
  const diff = daysBetween(today, date);
  if (diff > 0 && !rules.allowFuture) return { ok: false, error: 'That date is in the future.' };
  if (diff > MAX_AHEAD_DAYS) return { ok: false, error: 'That date is too far ahead.' };
  if (diff < -MAX_BACK_DAYS) return { ok: false, error: 'That date is too long ago.' };
  return { ok: true, date };
}

/**
 * Reads a typed date: "2026-10-02", "today", "yesterday", "tomorrow", "N days ago", "2 Oct", "Oct 2"
 * (optionally with a year). A year-less date means its most recent occurrence on or before `today`
 * (when the future is allowed: this year's, or last year's if that is over half a year ahead).
 * `today` is the local date in the bot's zone.
 */
export function parseTypedDate(input: string, today: LocalDate, rules: DateRules): DateParse {
  const s = normalise(input);
  if (!s) return { ok: false, error: `Type a date. ${HINT}` };
  const date = resolve(s, today, rules);
  if (date === undefined) return { ok: false, error: `I could not read that date. ${HINT}` };
  if (date === null) return { ok: false, error: `That date does not exist. ${HINT}` };
  return checkRange(date, today, rules);
}
