import { describe, expect, it } from 'vitest';
import { planFix } from '../src/service/fixPlan.js';
import { at, entry, given, ROB, skipped } from './domain-fixtures.js';

const t = at('2026-10-10 08:00');
const a = entry({ id: 1, forDate: '2026-10-10', givenAt: t, items: given(1) });
const b = entry({ id: 2, forDate: '2026-10-10', givenAt: at('2026-10-10 08:10'), items: given(2), loggedBy: ROB });

describe('planFix', () => {
  it('returns nothing when nothing changed', () => {
    const ops = planFix([b, a], b, [{ medId: 1, state: 'given' }, { medId: 2, state: 'given' }], b.givenAt);
    expect(ops).toEqual([]);
  });

  it('changes the entry that holds the med', () => {
    const ops = planFix([b, a], b, [{ medId: 1, state: 'skipped' }, { medId: 2, state: 'given' }], b.givenAt);
    expect(ops).toEqual([{ entryId: 1, kind: 'edit', items: skipped(1) }]);
  });

  it('undoes an entry left with no items', () => {
    const ops = planFix([b, a], b, [{ medId: 1, state: 'pending' }, { medId: 2, state: 'given' }], b.givenAt);
    expect(ops).toEqual([{ entryId: 1, kind: 'undo' }]);
  });

  it('unticking everything undoes every entry', () => {
    const ops = planFix([b, a], b, [{ medId: 1, state: 'pending' }, { medId: 2, state: 'pending' }], b.givenAt);
    expect(ops).toEqual([{ entryId: 2, kind: 'undo' }, { entryId: 1, kind: 'undo' }]);
  });

  it('puts a med nobody held onto the target entry', () => {
    const ops = planFix([b, a], b, [{ medId: 1, state: 'given' }, { medId: 2, state: 'given' }, { medId: 3, state: 'given' }], b.givenAt);
    expect(ops).toEqual([{ entryId: 2, kind: 'edit', items: given(2, 3) }]);
  });

  it('applies a new given-at to the target only', () => {
    const newTime = at('2026-10-10 07:45');
    const ops = planFix([b, a], b, [{ medId: 1, state: 'given' }, { medId: 2, state: 'given' }], newTime);
    expect(ops).toEqual([{ entryId: 2, kind: 'edit', items: given(2), givenAt: newTime }]);
  });

  it('keeps items for meds the panel does not list', () => {
    const ops = planFix([a], a, [{ medId: 9, state: 'given' }], a.givenAt);
    expect(ops).toEqual([{ entryId: 1, kind: 'edit', items: given(1, 9) }]);
  });
});
