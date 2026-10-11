import type { LocalDate, Med, MedState, RoundView } from '../types.js';
import { isMedActiveOn } from './course.js';
import {
  findPet,
  findRound,
  isDaily,
  occurrenceEntries,
  pickLatest,
  type Snapshot,
} from './snapshot.js';
import { roundTimes } from './times.js';

/**
 * Daily meds listed for a round on a date (stable order by id): the ones active that day, plus any med
 * with an item in an active entry for that occurrence, so a logged record never loses lines.
 */
export function medsInRound(snap: Snapshot, petId: string, roundKey: string, forDate: LocalDate): Med[] {
  const active = occurrenceEntries(snap, petId, roundKey, forDate).filter((e) => !e.undone);
  const logged = new Set(active.flatMap((e) => e.items.map((i) => i.medId)));
  return snap.meds
    .filter(
      (m) =>
        m.petId === petId &&
        (logged.has(m.id) || (isDaily(m) && m.roundKeys.includes(roundKey) && isMedActiveOn(snap, m, forDate))),
    )
    .sort((a, b) => a.id - b.id);
}

/**
 * A round on one date, derived fresh from the log. null for an unknown pet/round or an empty round.
 *
 * Choices:
 *  - `phase` follows the clock (upcoming < due time <= due < late-after <= late), except that a complete
 *    round is never `late` (it reports `due` once its due time has passed), so a done round is never
 *    drawn as LATE. A past date with pending meds is `late` because late-after has passed.
 *  - `latest` = the newest active entry; if the occurrence has only undone entries, the newest of those
 *    with `undoneBy` set, so render can say "Undone by Y" (`anyLogged` is false then).
 */
export function buildRoundView(
  snap: Snapshot,
  petId: string,
  roundKey: string,
  forDate: LocalDate,
  now: Date,
): RoundView | null {
  const pet = findPet(snap.settings, petId);
  const round = pet && findRound(pet, roundKey);
  if (!pet || !round) return null;
  const medList = medsInRound(snap, petId, roundKey, forDate);
  if (!medList.length) return null;

  const entries = occurrenceEntries(snap, petId, roundKey, forDate);
  const active = entries.filter((e) => !e.undone);
  const meds = medList.map((med) => ({ med, state: stateOf(active, med.id) }));
  const complete = meds.every((m) => m.state !== 'pending');
  const times = roundTimes(snap.settings, pet, round, forDate);

  return {
    petId,
    petName: pet.name,
    roundKey,
    roundName: round.name,
    emoji: round.emoji,
    forDate,
    due: round.due,
    lateAfter: round.lateAfter,
    meds,
    phase: phaseAt(now, times, complete),
    complete,
    anyLogged: active.length > 0,
    latest: pickLatest(entries, times.lateAt),
  };
}

function stateOf(active: { items: { medId: number; status: 'given' | 'skipped' }[] }[], medId: number): MedState {
  const items = active.flatMap((e) => e.items.filter((i) => i.medId === medId));
  if (items.some((i) => i.status === 'given')) return 'given';
  return items.some((i) => i.status === 'skipped') ? 'skipped' : 'pending';
}

function phaseAt(now: Date, t: { due: Date; lateAt: Date }, complete: boolean): RoundView['phase'] {
  if (now < t.due) return 'upcoming';
  return now < t.lateAt || complete ? 'due' : 'late';
}

