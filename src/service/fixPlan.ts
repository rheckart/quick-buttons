import type { EntryItem, LogEntry, MedState } from '../types.js';

export type FixOp =
  | { entryId: number; kind: 'undo' }
  | { entryId: number; kind: 'edit'; items: EntryItem[]; givenAt?: Date };

const toItem = (medId: number, state: MedState): EntryItem[] => (state === 'pending' ? [] : [{ medId, status: state }]);

const sameItems = (a: EntryItem[], b: EntryItem[]): boolean => {
  const key = (items: EntryItem[]) =>
    items.map((i) => `${i.medId}:${i.status}`).sort().join(',');
  return key(a) === key(b);
};

/**
 * Turns the desired per-med states of an occurrence into revisions of its active entries.
 * A round can hold several entries (a partial log plus "log the rest"), so the occurrence is the unit:
 * every entry holding a med follows the new state, meds nobody held go onto `target`, and an entry left
 * with no items is undone. `givenAt` applies to `target` only.
 */
export function planFix(
  entries: LogEntry[],
  target: LogEntry,
  desired: { medId: number; state: MedState }[],
  givenAt: Date,
): FixOp[] {
  const want = new Map(desired.map((d) => [d.medId, d.state]));
  const held = new Set(entries.flatMap((e) => e.items.map((i) => i.medId)));
  const ops: FixOp[] = [];
  for (const entry of entries) {
    const kept = entry.items.flatMap((i) => (want.has(i.medId) ? toItem(i.medId, want.get(i.medId)!) : [i]));
    const added =
      entry.id === target.id ? desired.filter((d) => !held.has(d.medId)).flatMap((d) => toItem(d.medId, d.state)) : [];
    const items = [...kept, ...added];
    const timeChanged = entry.id === target.id && givenAt.getTime() !== entry.givenAt.getTime();
    if (items.length === 0) ops.push({ entryId: entry.id, kind: 'undo' });
    else if (timeChanged || !sameItems(items, entry.items)) {
      ops.push({ entryId: entry.id, kind: 'edit', items, ...(timeChanged ? { givenAt } : {}) });
    }
  }
  return ops;
}
