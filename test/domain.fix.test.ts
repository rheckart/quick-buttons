import { describe, expect, it } from 'vitest';
import { canFix, findDoubleDose, fixDeadline, monthlyOccurrence } from '../src/domain/index.js';
import { at, DAILY, DANI, EAR_CLEANER, entry, given, KID, ROB, SIMPARICA, snap } from './domain-fixtures.js';

const roundEntry = (date: string, key = 'morning', extra = {}) =>
  entry({ forDate: date, roundKey: key, givenAt: at(`${date} 08:10`), items: given(1, 2), ...extra });
const monthly = (when: string, forDate: string, extra = {}) =>
  entry({ roundKey: null, forDate, givenAt: at(when), items: given(4), ...extra });

describe('fixDeadline', () => {
  it('round: the next day at the round due time', () => {
    const e = roundEntry('2026-10-10');
    expect(fixDeadline(snap(DAILY, [e]), e)).toEqual(at('2026-10-11 08:00'));
    const ev = roundEntry('2026-10-10', 'evening');
    expect(fixDeadline(snap(DAILY, [ev]), ev)).toEqual(at('2026-10-11 18:00'));
  });

  it('round due inside quiet hours: the real reminder time (quiet end)', () => {
    const e = roundEntry('2026-10-10');
    const settings = snap([]).settings;
    const early = { ...settings.pets[0]!, rounds: [{ key: 'morning', name: 'Morning', emoji: '☀️', due: '06:30', lateAfter: '09:00' }] };
    const s = snap(DAILY, [e], { pets: [early, ...settings.pets.slice(1)] });
    expect(fixDeadline(s, e)).toEqual(at('2026-10-11 07:00'));
  });

  it('DST: the evening of 31 Oct is fixable until 18:00 EST on 1 Nov', () => {
    const e = roundEntry('2026-10-31', 'evening');
    expect(fixDeadline(snap(DAILY, [e]), e).toISOString()).toBe('2026-11-01T23:00:00.000Z');
  });

  it('monthly: the morning of the next due date, counting this entry', () => {
    const e = monthly('2026-10-10 12:00', '2026-10-14');
    expect(fixDeadline(snap([SIMPARICA], [e]), e)).toEqual(at('2026-11-10 08:00'));
  });

  it('monthly: still computed after counting an undone entry', () => {
    const e = monthly('2026-10-14 09:00', '2026-10-14', { undone: true });
    expect(fixDeadline(snap([SIMPARICA], [e]), e)).toEqual(at('2026-11-14 08:00'));
  });

  it('as-needed: 24 hours after it was given', () => {
    const e = entry({ roundKey: null, forDate: '2026-10-10', givenAt: at('2026-10-10 15:00'), items: given(6) });
    expect(fixDeadline(snap([EAR_CLEANER], [e]), e)).toEqual(at('2026-10-11 15:00'));
  });
});

describe('canFix', () => {
  const e = roundEntry('2026-10-10');
  const s = snap(DAILY, [e]);

  it('anyone before the next reminder', () => {
    expect(canFix(s, e, KID, at('2026-10-10 20:00'))).toEqual({ ok: true });
    expect(canFix(s, e, KID, at('2026-10-11 07:59'))).toEqual({ ok: true });
  });

  it('only admins from the next reminder on', () => {
    const r = canFix(s, e, KID, at('2026-10-11 08:00'));
    expect(r.ok).toBe(false);
    expect(canFix(s, e, DANI, at('2026-10-11 08:00'))).toEqual({ ok: true });
    expect(canFix(s, e, ROB, at('2026-10-20 08:00'))).toEqual({ ok: true });
  });
});

describe('findDoubleDose', () => {
  it('finds a given med already logged for the round and date', () => {
    const e = roundEntry('2026-10-10', 'morning', { loggedBy: DANI });
    const s = snap(DAILY, [e]);
    expect(findDoubleDose(s, 'twiggy', 'morning', '2026-10-10', [2, 3])).toEqual({
      entry: e, person: DANI, givenAt: e.givenAt, medIds: [2],
    });
  });

  it('misses other rounds, other dates, undone entries, skipped items and unlisted meds', () => {
    const e = roundEntry('2026-10-10');
    const undone = roundEntry('2026-10-10', 'morning', { undone: true });
    const skip = entry({ forDate: '2026-10-10', givenAt: at('2026-10-10 08:00'), items: [{ medId: 2, status: 'skipped' }] });
    expect(findDoubleDose(snap(DAILY, [e]), 'twiggy', 'evening', '2026-10-10', [1])).toBeNull();
    expect(findDoubleDose(snap(DAILY, [e]), 'twiggy', 'morning', '2026-10-11', [1])).toBeNull();
    expect(findDoubleDose(snap(DAILY, [undone]), 'twiggy', 'morning', '2026-10-10', [1])).toBeNull();
    expect(findDoubleDose(snap(DAILY, [skip]), 'twiggy', 'morning', '2026-10-10', [2])).toBeNull();
    expect(findDoubleDose(snap(DAILY, [e]), 'twiggy', 'morning', '2026-10-10', [3])).toBeNull();
  });

  it('returns the newest entry when several match', () => {
    const a = roundEntry('2026-10-10', 'morning', { loggedAt: at('2026-10-10 08:05') });
    const b = roundEntry('2026-10-10', 'morning', { loggedAt: at('2026-10-10 08:50'), loggedBy: DANI });
    expect(findDoubleDose(snap(DAILY, [a, b]), 'twiggy', 'morning', '2026-10-10', [1])?.entry.id).toBe(b.id);
  });

  it('monthly: after an early dose, a tap the next day is caught using the current occurrence', () => {
    const e = monthly('2026-10-10 12:00', '2026-10-14');
    const s = snap([SIMPARICA], [e]);
    const now = at('2026-10-11 09:00');
    const occurrence = monthlyOccurrence(s, SIMPARICA, now);
    expect(findDoubleDose(s, 'twiggy', null, occurrence, [4])?.entry.id).toBe(e.id);
  });

  it('monthly: after the occurrence has passed there is no hit', () => {
    const e = monthly('2026-10-10 12:00', '2026-10-14');
    const s = snap([SIMPARICA], [e]);
    const occurrence = monthlyOccurrence(s, SIMPARICA, at('2026-10-20 09:00'));
    expect(findDoubleDose(s, 'twiggy', null, occurrence, [4])).toBeNull();
  });
});
