import type { BoardView, Med } from '../types.js';
import { buildSingleView } from './monthly.js';
import { buildRoundView } from './rounds.js';
import { findPet, isStopped, type Snapshot, todayOf } from './snapshot.js';

/** Today's board for a pet: rounds that have meds (in due order), then monthly meds, then as-needed meds. */
export function buildBoardView(snap: Snapshot, petId: string, now: Date): BoardView {
  const pet = findPet(snap.settings, petId);
  if (!pet) throw new Error(`unknown pet: ${petId}`);
  const today = todayOf(snap, now);
  const rounds = [...pet.rounds]
    .sort((a, b) => a.due.localeCompare(b.due))
    .map((r) => buildRoundView(snap, petId, r.key, today, now))
    .filter((v) => v !== null);
  const live = (kind: Med['kind']) =>
    snap.meds.filter((m) => m.petId === petId && m.kind === kind && !isStopped(m, now)).sort((a, b) => a.id - b.id);
  const singles = [...live('monthly'), ...live('as_needed')].map((m) => buildSingleView(snap, m, now));
  return { petId, petName: pet.name, rounds, singles };
}
