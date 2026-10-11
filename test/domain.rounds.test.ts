import { describe, expect, it } from 'vitest';
import { buildBoardView, buildRoundView, monthlyTimes, roundTimes } from '../src/domain/index.js';
import {
  ALLERGY, ANTIBIOTIC, at, DAILY, DANI, EAR_CLEANER, entry, EYE_DROPS, given, ROB, settings, SIMPARICA, skipped, snap,
} from './domain-fixtures.js';

const TODAY = '2026-10-10';
const morning = (items: ReturnType<typeof given>, extra = {}) =>
  entry({ forDate: TODAY, givenAt: at(`${TODAY} 08:10`), items, ...extra });
const view = (s: ReturnType<typeof snap>, now: string, key = 'morning', date = TODAY) =>
  buildRoundView(s, 'twiggy', key, date, at(now));

describe('buildRoundView', () => {
  it('is null for an unknown pet/round or a round with no meds', () => {
    expect(buildRoundView(snap(DAILY), 'nobody', 'morning', TODAY, at(`${TODAY} 08:00`))).toBeNull();
    expect(view(snap(DAILY), `${TODAY} 08:00`, 'noon')).toBeNull();
    expect(view(snap([ALLERGY]), `${TODAY} 08:00`)).toBeNull();
  });

  it('phase follows the clock: upcoming, due, late', () => {
    const s = snap(DAILY);
    expect(view(s, `${TODAY} 07:59`)?.phase).toBe('upcoming');
    expect(view(s, `${TODAY} 08:00`)?.phase).toBe('due');
    expect(view(s, `${TODAY} 09:59`)?.phase).toBe('due');
    expect(view(s, `${TODAY} 10:00`)?.phase).toBe('late');
  });

  it('a past date with pending meds is late; a future date is upcoming', () => {
    const s = snap(DAILY);
    expect(view(s, `${TODAY} 07:00`, 'evening', '2026-10-09')?.phase).toBe('late');
    expect(view(s, `${TODAY} 07:00`, 'morning', '2026-10-11')?.phase).toBe('upcoming');
  });

  it('a complete round is never late', () => {
    const s = snap(DAILY, [morning(given(1, 2))]);
    const v = view(s, `${TODAY} 12:00`);
    expect(v?.complete).toBe(true);
    expect(v?.phase).not.toBe('late');
    expect(view(s, `${TODAY} 07:00`)?.phase).toBe('upcoming');
  });

  it('carries names and times for render', () => {
    const v = view(snap(DAILY), `${TODAY} 08:00`);
    expect(v).toMatchObject({ petName: 'Twiggy', roundName: 'Morning', emoji: '☀️', due: '08:00', lateAfter: '10:00', forDate: TODAY });
    expect(v?.meds.map((m) => [m.med.id, m.state])).toEqual([[1, 'pending'], [2, 'pending']]);
  });

  it('partial log: logged meds are given, the rest pending, round not complete', () => {
    const v = view(snap(DAILY, [morning(given(2))]), `${TODAY} 09:00`);
    expect(v?.meds.map((m) => m.state)).toEqual(['pending', 'given']);
    expect(v).toMatchObject({ complete: false, anyLogged: true });
  });

  it('skipped counts as not pending; given beats skipped across entries', () => {
    const v = view(snap(DAILY, [morning(skipped(1)), morning(given(2))]), `${TODAY} 09:00`);
    expect(v?.meds.map((m) => m.state)).toEqual(['skipped', 'given']);
    expect(v?.complete).toBe(true);
    const both = view(snap(DAILY, [morning(skipped(1)), morning(given(1, 2))]), `${TODAY} 09:00`);
    expect(both?.meds.map((m) => m.state)).toEqual(['given', 'given']);
  });

  it('an undone entry counts as not given', () => {
    const v = view(snap(DAILY, [morning(given(1, 2), { undone: true })]), `${TODAY} 09:00`);
    expect(v?.meds.map((m) => m.state)).toEqual(['pending', 'pending']);
    expect(v?.anyLogged).toBe(false);
  });

  it('a stopped med still shows in a logged record, and does not hold the round open', () => {
    const stopped = { ...EYE_DROPS, stoppedAt: at(`${TODAY} 12:00`) };
    const s = snap([ANTIBIOTIC, stopped], [morning(given(1, 2))]);
    const v = view(s, `${TODAY} 13:00`);
    expect(v?.meds.map((m) => m.med.id)).toEqual([1, 2]);
    expect(v?.complete).toBe(true);
  });

  describe('latest', () => {
    it('shows who and when; backdated when given != logged by over a minute', () => {
      const e = morning(given(1, 2), { givenAt: at(`${TODAY} 07:45`), loggedAt: at(`${TODAY} 08:30`), loggedBy: DANI });
      const l = view(snap(DAILY, [e]), `${TODAY} 09:00`)?.latest;
      expect(l).toMatchObject({ entryId: e.id, by: DANI, backdated: true, givenLate: false, editedBy: null, undoneBy: null });
      const exact = morning(given(1, 2), { loggedAt: new Date(at(`${TODAY} 08:10`).getTime() + 30_000) });
      expect(view(snap(DAILY, [exact]), `${TODAY} 09:00`)?.latest?.backdated).toBe(false);
    });

    it('givenLate when logged at or after late-after', () => {
      const e = morning(given(1, 2), { loggedAt: at(`${TODAY} 10:00`), givenAt: at(`${TODAY} 10:00`) });
      expect(view(snap(DAILY, [e]), `${TODAY} 11:00`)?.latest?.givenLate).toBe(true);
    });

    it('is the newest active entry; editedBy comes from the last revision', () => {
      const first = morning(given(1), { loggedAt: at(`${TODAY} 08:05`) });
      const second = morning(given(2), {
        loggedAt: at(`${TODAY} 08:40`), loggedBy: DANI,
        lastRevision: { kind: 'edit', by: ROB, at: at(`${TODAY} 08:50`) },
      });
      const l = view(snap(DAILY, [second, first]), `${TODAY} 09:00`)?.latest;
      expect(l).toMatchObject({ entryId: second.id, editedBy: ROB, undoneBy: null });
    });

    it('when only undone entries exist, latest is that one with undoneBy set', () => {
      const e = morning(given(1, 2), { undone: true, lastRevision: { kind: 'undo', by: DANI, at: at(`${TODAY} 09:00`) } });
      const v = view(snap(DAILY, [e]), `${TODAY} 09:30`);
      expect(v?.latest).toMatchObject({ entryId: e.id, undoneBy: DANI, editedBy: null });
      expect(v?.anyLogged).toBe(false);
    });

    it('an active entry wins over a newer undone one', () => {
      const active = morning(given(1, 2), { loggedAt: at(`${TODAY} 08:05`) });
      const undone = morning(given(1, 2), { undone: true, loggedAt: at(`${TODAY} 08:30`) });
      expect(view(snap(DAILY, [active, undone]), `${TODAY} 09:00`)?.latest?.entryId).toBe(active.id);
    });

    it('null when nothing was ever logged', () => {
      expect(view(snap(DAILY), `${TODAY} 09:00`)?.latest).toBeNull();
    });
  });
});

describe('buildBoardView', () => {
  it('lists rounds that have meds in due order, then monthly, then as-needed; skips stopped', () => {
    const stoppedEar = { ...EAR_CLEANER, id: 7, stoppedAt: at('2026-10-01 12:00') };
    const s = snap([ANTIBIOTIC, EYE_DROPS, SIMPARICA, EAR_CLEANER, stoppedEar]);
    const b = buildBoardView(s, 'twiggy', at(`${TODAY} 09:00`));
    expect(b.petName).toBe('Twiggy');
    expect(b.rounds.map((r) => r.roundKey)).toEqual(['morning', 'evening']);
    expect(b.singles.map((x) => [x.med.id, x.phase])).toEqual([[4, 'upcoming'], [6, 'as_needed']]);
  });

  it('omits rounds without meds', () => {
    const b = buildBoardView(snap([EYE_DROPS]), 'twiggy', at(`${TODAY} 09:00`));
    expect(b.rounds.map((r) => r.roundKey)).toEqual(['morning']);
  });

  it('a pet with no rounds only has singles', () => {
    expect(buildBoardView(snap([]), 'faith', at(`${TODAY} 09:00`))).toMatchObject({ rounds: [], singles: [] });
  });
});

describe('times', () => {
  const pet = settings.pets[0]!;
  const morningRound = pet.rounds[0]!;

  it('roundTimes: followup is the midpoint of due and late-after', () => {
    const t = roundTimes(settings, pet, morningRound, TODAY);
    expect(t.due).toEqual(at(`${TODAY} 08:00`));
    expect(t.followupAt).toEqual(at(`${TODAY} 09:00`));
    expect(t.lateAt).toEqual(at(`${TODAY} 10:00`));
  });

  it('DST day 2026-11-01: the 08:00 round is in EST (13:00Z)', () => {
    const t = roundTimes(settings, pet, morningRound, '2026-11-01');
    expect(t.due.toISOString()).toBe('2026-11-01T13:00:00.000Z');
    expect(t.lateAt.toISOString()).toBe('2026-11-01T15:00:00.000Z');
  });

  it('monthlyTimes: morning, evening, and late-from = start of the next day', () => {
    const t = monthlyTimes(settings, pet, '2026-10-14');
    expect(t.morning).toEqual(at('2026-10-14 08:00'));
    expect(t.evening).toEqual(at('2026-10-14 18:00'));
    expect(t.lateFrom).toEqual(at('2026-10-15 00:00'));
  });

  it('monthlyTimes on DST day: the day is 25 hours long', () => {
    const t = monthlyTimes(settings, pet, '2026-11-01');
    expect(t.morning.toISOString()).toBe('2026-11-01T13:00:00.000Z');
    expect(t.lateFrom.toISOString()).toBe('2026-11-02T05:00:00.000Z');
  });
});
