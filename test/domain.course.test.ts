import { describe, expect, it } from 'vitest';
import { coursesJustFinished, courseWindow, isMedActiveOn, medsInRound } from '../src/domain/index.js';
import { ALLERGY, ANTIBIOTIC, at, entry, EYE_DROPS, given, med, snap, TZ } from './domain-fixtures.js';

const dose = (when: string, date = when.slice(0, 10), extra = {}) =>
  entry({ forDate: date, givenAt: at(when), items: given(1), ...extra });

describe('courseWindow', () => {
  it('10 days from 1 Oct ends 10 Oct (start day counts)', () => {
    const m = med({ ...ANTIBIOTIC, startedOn: '2026-10-01' });
    expect(courseWindow(m, [], TZ)).toEqual({ start: '2026-10-01', end: '2026-10-10' });
  });

  it('starts at the earliest active given dose when no Started on is set', () => {
    const entries = [dose('2026-10-02 18:00'), dose('2026-10-01 08:00'), dose('2026-09-30 08:00', '2026-09-30', { undone: true })];
    expect(courseWindow(ANTIBIOTIC, entries, TZ)).toEqual({ start: '2026-10-01', end: '2026-10-10' });
  });

  it('undoing the first dose moves the start to the next dose', () => {
    const entries = [dose('2026-10-01 08:00', undefined, { undone: true }), dose('2026-10-02 08:00')];
    expect(courseWindow(ANTIBIOTIC, entries, TZ).start).toBe('2026-10-02');
  });

  it('ignores skipped items and other meds', () => {
    const skippedOnly = entry({ forDate: '2026-10-01', givenAt: at('2026-10-01 08:00'), items: [{ medId: 1, status: 'skipped' }] });
    const other = entry({ forDate: '2026-10-01', givenAt: at('2026-10-01 08:00'), items: given(2) });
    expect(courseWindow(ANTIBIOTIC, [skippedOnly, other], TZ)).toEqual({ start: null, end: null });
  });

  it('uses the local date, not UTC', () => {
    expect(courseWindow(ANTIBIOTIC, [dose('2026-10-01 21:30')], TZ).start).toBe('2026-10-01');
  });

  it('has no end for a course without days', () => {
    const m = med({ ...ANTIBIOTIC, days: null, startedOn: '2026-10-01' });
    expect(courseWindow(m, [], TZ)).toEqual({ start: '2026-10-01', end: null });
  });
});

describe('isMedActiveOn', () => {
  const s = snap([ANTIBIOTIC, EYE_DROPS], [dose('2026-10-01 08:00')]);

  it('course is active inside its window only', () => {
    expect(isMedActiveOn(s, ANTIBIOTIC, '2026-09-30')).toBe(false);
    expect(isMedActiveOn(s, ANTIBIOTIC, '2026-10-01')).toBe(true);
    expect(isMedActiveOn(s, ANTIBIOTIC, '2026-10-10')).toBe(true);
    expect(isMedActiveOn(s, ANTIBIOTIC, '2026-10-11')).toBe(false);
  });

  it('a course with no start yet is active', () => {
    expect(isMedActiveOn(snap([ANTIBIOTIC]), ANTIBIOTIC, '2026-10-05')).toBe(true);
  });

  it('is active from the day it was created, until the day it was stopped', () => {
    const m = med({ id: 9, kind: 'ongoing', createdAt: at('2026-10-05 14:00'), stoppedAt: at('2026-10-08 10:00') });
    const x = snap([m]);
    expect([4, 5, 7, 8, 9].map((d) => isMedActiveOn(x, m, `2026-10-0${d}`))).toEqual([false, true, true, false, false]);
  });

  it('monthly and as-needed meds are not daily', () => {
    expect(isMedActiveOn(snap([]), med({ id: 9, kind: 'monthly' }), '2026-10-10')).toBe(false);
  });
});

describe('medsInRound', () => {
  it('lists the round meds in id order, courses joining and leaving by window', () => {
    const s = snap([EYE_DROPS, ANTIBIOTIC, ALLERGY], [dose('2026-10-01 08:00')]);
    expect(medsInRound(s, 'twiggy', 'morning', '2026-10-05').map((m) => m.id)).toEqual([1, 2]);
    expect(medsInRound(s, 'twiggy', 'evening', '2026-10-05').map((m) => m.id)).toEqual([1, 3]);
    expect(medsInRound(s, 'twiggy', 'morning', '2026-10-11').map((m) => m.id)).toEqual([2]);
  });

  it('keeps a since-stopped med that has a line in a logged record', () => {
    const stopped = med({ ...EYE_DROPS, stoppedAt: at('2026-10-10 12:00') });
    const e = entry({ forDate: '2026-10-10', givenAt: at('2026-10-10 08:05'), items: given(2) });
    expect(medsInRound(snap([stopped], [e]), 'twiggy', 'morning', '2026-10-10').map((m) => m.id)).toEqual([2]);
    expect(medsInRound(snap([stopped], []), 'twiggy', 'morning', '2026-10-10')).toEqual([]);
  });

  it('does not keep a med whose only entry was undone', () => {
    const stopped = med({ ...EYE_DROPS, stoppedAt: at('2026-10-10 12:00') });
    const e = entry({ forDate: '2026-10-10', givenAt: at('2026-10-10 08:05'), items: given(2), undone: true });
    expect(medsInRound(snap([stopped], [e]), 'twiggy', 'morning', '2026-10-10')).toEqual([]);
  });
});

describe('coursesJustFinished', () => {
  const s = snap([ANTIBIOTIC], [dose('2026-10-01 08:00')]);
  it('lists a course the day after, and the day after that, but not before or later', () => {
    const on = (d: string) => coursesJustFinished(s, at(`${d} 12:00`)).map((m) => m.id);
    expect(on('2026-10-10')).toEqual([]);
    expect(on('2026-10-11')).toEqual([1]);
    expect(on('2026-10-12')).toEqual([1]);
    expect(on('2026-10-13')).toEqual([]);
  });
  it('skips stopped courses and courses not started', () => {
    const stopped = snap([med({ ...ANTIBIOTIC, stoppedAt: at('2026-10-05 12:00') })], [dose('2026-10-01 08:00')]);
    expect(coursesJustFinished(stopped, at('2026-10-11 12:00'))).toEqual([]);
    expect(coursesJustFinished(snap([ANTIBIOTIC]), at('2026-10-11 12:00'))).toEqual([]);
  });
});
