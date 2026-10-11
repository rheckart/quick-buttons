import { describe, expect, it } from 'vitest';
import { buildBoardView, buildRoundView, canFix, fixDeadline } from '../src/domain/index.js';
import { at, DANI, entry, EYE_DROPS, given, KID, med, ROB, SIMPARICA, ANTIBIOTIC, skipped, snap } from './domain-fixtures.js';

describe('fixA 1: a med created mid-day skips rounds already past late-after', () => {
  const late = med({ id: 20, kind: 'ongoing', name: 'New drops', roundKeys: ['morning'], createdAt: at('2026-10-10 15:00') });

  it('morning round of the creation day does not include it at 15:01', () => {
    expect(buildRoundView(snap([late]), 'twiggy', 'morning', '2026-10-10', at('2026-10-10 15:01'))).toBeNull();
    const board = buildBoardView(snap([late]), 'twiggy', at('2026-10-10 15:01'));
    expect(board.rounds).toHaveLength(0);
  });

  it('is part of the round again the next day', () => {
    const v = buildRoundView(snap([late]), 'twiggy', 'morning', '2026-10-11', at('2026-10-11 08:30'));
    expect(v?.meds.map((m) => m.med.id)).toEqual([20]);
  });

  it('a round still open at creation time includes it', () => {
    const m = med({ id: 21, kind: 'ongoing', name: 'X', roundKeys: ['morning'], createdAt: at('2026-10-10 09:00') });
    const v = buildRoundView(snap([m]), 'twiggy', 'morning', '2026-10-10', at('2026-10-10 09:05'));
    expect(v?.meds.map((x) => x.med.id)).toEqual([21]);
    expect(v?.phase).toBe('due');
  });

  it('creation exactly at late-after: excluded; one minute before: included', () => {
    const at10 = med({ id: 22, kind: 'ongoing', roundKeys: ['morning'], createdAt: at('2026-10-10 10:00') });
    const before = med({ id: 23, kind: 'ongoing', roundKeys: ['morning'], createdAt: at('2026-10-10 09:59') });
    expect(buildRoundView(snap([at10]), 'twiggy', 'morning', '2026-10-10', at('2026-10-10 11:00'))).toBeNull();
    expect(buildRoundView(snap([before]), 'twiggy', 'morning', '2026-10-10', at('2026-10-10 11:00'))?.phase).toBe('late');
  });

  it('a med already logged in that occurrence stays listed', () => {
    const e = entry({ forDate: '2026-10-10', givenAt: at('2026-10-10 15:10'), items: given(20) });
    const v = buildRoundView(snap([late], [e]), 'twiggy', 'morning', '2026-10-10', at('2026-10-10 15:20'));
    expect(v?.meds).toEqual([{ med: late, state: 'given' }]);
  });
});

describe('fixA 3: monthly fix deadline comes from the entry itself', () => {
  const monthly = (when: string, forDate: string, extra = {}) =>
    entry({ roundKey: null, forDate, givenAt: at(when), items: given(4), ...extra });

  it('an older entry has an earlier deadline than the latest one', () => {
    const old = monthly('2026-09-14 09:00', '2026-09-14');
    const latest = monthly('2026-10-14 09:00', '2026-10-14');
    const s = snap([SIMPARICA], [old, latest]);
    expect(fixDeadline(s, latest)).toEqual(at('2026-11-14 08:00'));
    expect(fixDeadline(s, old)).toEqual(at('2026-10-14 08:00'));
    expect(canFix(s, old, KID, at('2026-10-20 12:00')).ok).toBe(false);
    expect(canFix(s, old, ROB, at('2026-10-20 12:00')).ok).toBe(true);
    expect(canFix(s, latest, KID, at('2026-10-20 12:00')).ok).toBe(true);
  });

  it('an undone older entry is not rescued by a newer dose either', () => {
    const old = monthly('2026-09-14 09:00', '2026-09-14', { undone: true });
    const latest = monthly('2026-10-14 09:00', '2026-10-14');
    expect(fixDeadline(snap([SIMPARICA], [old, latest]), old)).toEqual(at('2026-10-14 08:00'));
  });
});

describe('fixA 4: attribution across several active entries', () => {
  const day = '2026-10-10';
  const partial = entry({ id: 1, forDate: day, givenAt: at(`${day} 08:10`), items: given(1), loggedBy: ROB });
  const rest = entry({ id: 2, forDate: day, givenAt: at(`${day} 09:10`), items: given(2), loggedBy: DANI });
  const meds = [ANTIBIOTIC, EYE_DROPS];
  const view = (entries: ReturnType<typeof entry>[]) =>
    buildRoundView(snap(meds, entries), 'twiggy', 'morning', day, at(`${day} 09:30`))!;

  it('latest stays the newest-created logger and alsoBy lists the earlier ones oldest first', () => {
    const v = view([partial, rest]);
    expect(v.latest?.by).toEqual(DANI);
    expect(v.latest?.alsoBy).toEqual([ROB]);
  });

  it('alsoBy is distinct and excludes the latest logger', () => {
    const third = entry({ id: 3, forDate: day, givenAt: at(`${day} 09:20`), items: given(1), loggedBy: DANI });
    const kid = entry({ id: 4, forDate: day, givenAt: at(`${day} 08:50`), items: given(2), loggedBy: KID });
    const v = view([partial, kid, rest, third]);
    expect(v.latest?.by).toEqual(DANI);
    expect(v.latest?.alsoBy).toEqual([ROB, KID]);
  });

  it('undone entries are ignored', () => {
    const v = view([{ ...partial, undone: true, lastRevision: { kind: 'undo', by: ROB, at: at(`${day} 08:20`) } }, rest]);
    expect(v.latest?.alsoBy ?? []).toEqual([]);
  });

  it('editedBy: an edit of an OLDER entry newer than the newest create shows', () => {
    const edited = { ...partial, lastRevision: { kind: 'edit' as const, by: KID, at: at(`${day} 09:20`) } };
    expect(view([edited, rest]).latest?.editedBy).toEqual(KID);
  });

  it('editedBy: an edit older than the newest create is not shown', () => {
    const edited = { ...partial, lastRevision: { kind: 'edit' as const, by: KID, at: at(`${day} 08:30`) } };
    expect(view([edited, rest]).latest?.editedBy).toBeNull();
  });

  it('editedBy: the newest edit wins across entries', () => {
    const e1 = { ...partial, lastRevision: { kind: 'edit' as const, by: KID, at: at(`${day} 09:20`) } };
    const e2 = { ...rest, lastRevision: { kind: 'edit' as const, by: ROB, at: at(`${day} 09:25`) } };
    expect(view([e1, e2]).latest?.editedBy).toEqual(ROB);
  });

  it('a lone entry has no alsoBy', () => {
    expect(view([partial]).latest?.alsoBy ?? []).toEqual([]);
  });
});

describe('fixA 5: skipped-only view', () => {
  it('stays anyLogged with no given meds', () => {
    const e = entry({ forDate: '2026-10-10', givenAt: at('2026-10-10 08:10'), items: skipped(1, 2) });
    const v = buildRoundView(snap([ANTIBIOTIC, EYE_DROPS], [e]), 'twiggy', 'morning', '2026-10-10', at('2026-10-10 08:30'))!;
    expect(v.anyLogged).toBe(true);
    expect(v.meds.map((m) => m.state)).toEqual(['skipped', 'skipped']);
  });
});
