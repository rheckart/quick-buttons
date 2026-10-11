import { addDays, instantAt, midpoint, quietEndAtOrAfter, startOfLocalDay } from '../time.js';
import type { LocalDate, PetConfig, RoundConfig, Settings } from '../types.js';

/** Raw (not quiet-hours-shifted) instants for one occurrence of a round. */
export function roundTimes(
  settings: Settings,
  _pet: PetConfig,
  round: RoundConfig,
  forDate: LocalDate,
): { due: Date; followupAt: Date; lateAt: Date } {
  const tz = settings.timezone;
  return {
    due: instantAt(forDate, round.due, tz),
    followupAt: instantAt(forDate, midpoint(round.due, round.lateAfter), tz),
    lateAt: instantAt(forDate, round.lateAfter, tz),
  };
}

/** `lateFrom` = the first instant after the due day ends. */
export function monthlyTimes(
  settings: Settings,
  pet: PetConfig,
  dueDate: LocalDate,
): { morning: Date; evening: Date; lateFrom: Date } {
  const tz = settings.timezone;
  return {
    morning: instantAt(dueDate, pet.monthlyMorning, tz),
    evening: instantAt(dueDate, pet.monthlyEvening, tz),
    lateFrom: startOfLocalDay(addDays(dueDate, 1), tz),
  };
}

/** When a scheduled send actually happens: waits for quiet hours to end. */
export function effectiveAt(settings: Settings, at: Date): Date {
  return quietEndAtOrAfter(at, settings.quietHours, settings.timezone);
}
