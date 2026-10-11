import { describe, expect, it } from 'vitest';
import { buildSingleView, monthlyDueDate, monthlyOccurrence } from '../src/domain/index.js';
import { at, DANI, EAR_CLEANER, entry, given, med, ROB, SIMPARICA, snap } from './domain-fixtures.js';

/** A monthly dose: forDate is the occurrence it was logged against. */
const dose = (when: string, forDate: string, extra = {}) =>
  entry({ roundKey: null, forDate, givenAt: at(when), items: given(4), ...extra });
const view = (entries: ReturnType<typeof dose>[], now: string) =>
  buildSingleView(snap([SIMPARICA], entries), SIMPARICA, at(now));

describe('monthlyDueDate', () => {
  it('seed last given + 1 month', () => {
    expect(monthlyDueDate(snap([SIMPARICA]), SIMPARICA)).toBe('2026-10-14');
  });

  it('the latest active dose wins over the seed', () => {
    const s = snap([SIMPARICA], [dose('2026-10-12 09:00', '2026-10-14')]);
    expect(monthlyDueDate(s, SIMPARICA)).toBe('2026-11-12');
  });

  it('with neither, it is due the day it was created', () => {
    const m = med({ id: 4, kind: 'monthly', createdAt: at('2026-10-03 20:00') });
    expect(monthlyDueDate(snap([m]), m)).toBe('2026-10-03');
  });

  it('clamps to month end (31 Jan -> 28 Feb)', () => {
    const s = snap([SIMPARICA], [dose('2027-01-31 09:00', '2027-01-31')]);
    expect(monthlyDueDate(s, SIMPARICA)).toBe('2027-02-28');
  });

  it('uses the latest dose by given time, not by when it was logged', () => {
    const recent = dose('2026-10-12 09:00', '2026-10-14', { loggedAt: at('2026-10-12 09:00') });
    const olderLoggedLater = dose('2026-10-01 09:00', '2026-10-14', { loggedAt: at('2026-10-13 09:00') });
    expect(monthlyDueDate(snap([SIMPARICA], [recent, olderLoggedLater]), SIMPARICA)).toBe('2026-11-12');
  });

  it('DST day 2026-11-01: a late-evening dose on 1 Oct is due on 1 Nov', () => {
    const s = snap([SIMPARICA], [dose('2026-10-01 23:30', '2026-10-01')]);
    expect(monthlyDueDate(s, SIMPARICA)).toBe('2026-11-01');
    expect(buildSingleView(s, SIMPARICA, at('2026-11-01 08:00'))).toMatchObject({ phase: 'due', dueDate: '2026-11-01' });
    expect(buildSingleView(s, SIMPARICA, at('2026-11-02 00:30')).phase).toBe('late');
  });
});

describe('buildSingleView: monthly phases', () => {
  it('upcoming before the due day, due on it, late once it ends', () => {
    expect(view([], '2026-10-13 23:59')).toMatchObject({ phase: 'upcoming', dueDate: '2026-10-14' });
    expect(view([], '2026-10-14 00:00').phase).toBe('due');
    expect(view([], '2026-10-14 23:59').phase).toBe('due');
    expect(view([], '2026-10-15 00:00').phase).toBe('late');
  });

  it('given on the due day: given that day, then upcoming for next month', () => {
    const e = dose('2026-10-14 08:30', '2026-10-14');
    expect(view([e], '2026-10-14 20:00')).toMatchObject({ phase: 'given', dueDate: '2026-11-14' });
    expect(view([e], '2026-10-15 09:00')).toMatchObject({ phase: 'upcoming', dueDate: '2026-11-14' });
  });

  it('given early (10 Oct for the 14th): given until the 14th passes, next due is a month from the dose', () => {
    const e = dose('2026-10-10 12:00', '2026-10-14');
    const early = view([e], '2026-10-11 09:00');
    expect(early).toMatchObject({ phase: 'given', dueDate: '2026-11-10', lastGivenAt: e.givenAt, lastGivenBy: ROB });
    expect(view([e], '2026-10-14 22:00').phase).toBe('given');
    expect(view([e], '2026-10-15 08:00')).toMatchObject({ phase: 'upcoming', dueDate: '2026-11-10' });
  });

  it('given late (16 Oct for the 14th): given that day, then upcoming', () => {
    const e = dose('2026-10-16 09:00', '2026-10-14');
    expect(view([e], '2026-10-16 20:00')).toMatchObject({ phase: 'given', dueDate: '2026-11-16' });
    expect(view([e], '2026-10-17 08:00')).toMatchObject({ phase: 'upcoming', dueDate: '2026-11-16' });
  });

  it('undo restores the previous due date and phase', () => {
    const e = dose('2026-10-10 12:00', '2026-10-14', { undone: true, lastRevision: { kind: 'undo', by: DANI, at: at('2026-10-10 12:05') } });
    const v = view([e], '2026-10-14 09:00');
    expect(v).toMatchObject({ phase: 'due', dueDate: '2026-10-14', lastGivenAt: null });
    expect(v.latest).toMatchObject({ undoneBy: DANI });
  });

  it('undoing a newer dose falls back to the older one', () => {
    const older = dose('2026-09-14 09:00', '2026-09-14');
    const newer = dose('2026-10-14 09:00', '2026-10-14', { undone: true });
    expect(monthlyDueDate(snap([SIMPARICA], [older, newer]), SIMPARICA)).toBe('2026-10-14');
  });

  it('an explicit forDate describes that occurrence: a past one stays given', () => {
    const e = dose('2026-10-14 08:30', '2026-10-14');
    const s = snap([SIMPARICA], [e]);
    expect(buildSingleView(s, SIMPARICA, at('2026-11-20 09:00'), '2026-10-14')).toMatchObject({
      phase: 'given', dueDate: '2026-10-14', latest: { entryId: e.id, by: ROB },
    });
    expect(buildSingleView(s, SIMPARICA, at('2026-10-16 09:00'), '2026-09-14').phase).toBe('late');
  });
});

describe('monthlyOccurrence', () => {
  it('is the next due date normally, the logged occurrence while it is current', () => {
    const e = dose('2026-10-10 12:00', '2026-10-14');
    const s = snap([SIMPARICA], [e]);
    expect(monthlyOccurrence(snap([SIMPARICA]), SIMPARICA, at('2026-10-10 09:00'))).toBe('2026-10-14');
    expect(monthlyOccurrence(s, SIMPARICA, at('2026-10-11 09:00'))).toBe('2026-10-14');
    expect(monthlyOccurrence(s, SIMPARICA, at('2026-10-15 09:00'))).toBe('2026-11-10');
  });
});

describe('buildSingleView: as-needed', () => {
  it('has phase as_needed and the last given info', () => {
    const e = entry({ roundKey: null, forDate: '2026-10-02', givenAt: at('2026-10-02 18:00'), items: given(6), loggedBy: DANI });
    const s = snap([EAR_CLEANER], [e]);
    expect(buildSingleView(s, EAR_CLEANER, at('2026-10-10 09:00'))).toMatchObject({
      phase: 'as_needed', dueDate: null, lastGivenAt: e.givenAt, lastGivenBy: DANI, latest: { entryId: e.id },
    });
    expect(buildSingleView(snap([EAR_CLEANER]), EAR_CLEANER, at('2026-10-10 09:00'))).toMatchObject({ lastGivenAt: null, latest: null });
  });

  it('refuses daily meds', () => {
    expect(() => buildSingleView(snap([]), med({ id: 9, kind: 'ongoing' }), at('2026-10-10 09:00'))).toThrow();
  });
});
