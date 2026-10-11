import { describe, expect, it } from 'vitest';
import { parseTypedDate } from '../src/bot/dates.js';

const TODAY = '2026-10-10'; // a Saturday
const past = { allowFuture: false };
const future = { allowFuture: true };

const ok = (input: string, rules: { allowFuture: boolean }, today = TODAY) => {
  const r = parseTypedDate(input, today, rules);
  return r.ok ? r.date : r.error;
};

describe('parseTypedDate: accepted forms', () => {
  it.each([
    ['2026-10-02', '2026-10-02'],
    ['2026-1-5', '2026-01-05'],
    ['  2026-10-10 ', '2026-10-10'],
    ['today', '2026-10-10'],
    ['Today', '2026-10-10'],
    ['yesterday', '2026-10-09'],
    ['0 days ago', '2026-10-10'],
    ['1 day ago', '2026-10-09'],
    ['a day ago', '2026-10-09'],
    ['3 days ago', '2026-10-07'],
    ['10 Days Ago', '2026-09-30'],
    ['2 Oct', '2026-10-02'],
    ['2 oct', '2026-10-02'],
    ['Oct 2', '2026-10-02'],
    ['October 2', '2026-10-02'],
    ['2nd October', '2026-10-02'],
    ['Oct 2nd', '2026-10-02'],
    ['02 Oct', '2026-10-02'],
    ['2 Oct 2026', '2026-10-02'],
    ['Oct 2, 2026', '2026-10-02'],
    ['14 Sep', '2026-09-14'],
    ['14 Sept', '2026-09-14'],
    ['Sep 14', '2026-09-14'],
    ['10 Oct', '2026-10-10'],
  ])('past-only: %j -> %s', (input, expected) => {
    expect(ok(input, past)).toBe(expected);
  });

  it('a year-less date past-only is its most recent occurrence on or before today', () => {
    expect(ok('Oct 12', past)).toBe('2025-10-12');
    expect(ok('11 Oct', past)).toBe('2025-10-11');
    expect(ok('1 Jan', past)).toBe('2026-01-01');
    expect(ok('31 Dec', past)).toBe('2025-12-31');
  });

  it('a year-less date when the future is allowed is this year', () => {
    expect(ok('Oct 12', future)).toBe('2026-10-12');
    expect(ok('1 Oct', future)).toBe('2026-10-01');
    expect(ok('tomorrow', future)).toBe('2026-10-11');
  });

  it('a year-less date more than half a year ahead means last year, when the future is allowed', () => {
    expect(ok('30 Dec', future, '2026-01-02')).toBe('2025-12-30');
    expect(ok('20 Apr', future, '2026-10-10')).toBe('2026-04-20');
    expect(ok('20 Jan', future, '2026-01-02')).toBe('2026-01-20');
  });

  it('Feb 29 is the last real leap day', () => {
    expect(ok('29 Feb', past, '2026-10-10')).toBe('2024-02-29');
    expect(ok('Feb 29 2028', future, '2027-10-10')).toBe('2028-02-29');
  });
});

describe('parseTypedDate: rejected input', () => {
  it.each(['', '   ', 'soon', 'last week', '10/2', '2 Octo', 'Oct', '2', 'x days ago', '-3 days ago'])(
    'cannot read %j',
    (input) => {
      expect(ok(input, past)).toMatch(/Type a date|could not read/);
    },
  );

  it.each(['31 Feb', 'Feb 30', '2026-02-29', '2026-04-31', '30 Feb 2026', '0 Oct', '32 Oct', '2026-13-01'])('%j does not exist', (input) => {
    expect(ok(input, past)).toMatch(/does not exist/);
  });

  it('rejects the future when it is not allowed', () => {
    expect(ok('2026-10-11', past)).toMatch(/in the future/);
    expect(ok('tomorrow', past)).toMatch(/in the future/);
    expect(ok('Oct 11 2026', past)).toMatch(/in the future/);
    expect(ok('2030-01-01', past)).toMatch(/in the future/);
  });

  it('when the future is allowed, only very far dates are rejected', () => {
    expect(ok('2026-12-25', future)).toBe('2026-12-25');
    expect(ok('2028-01-01', future)).toMatch(/too far ahead/);
  });

  it('rejects dates from long ago', () => {
    expect(ok('2015-03-01', past)).toMatch(/too long ago/);
    expect(ok('3000 days ago', past)).toMatch(/too long ago/);
    expect(ok('2023-10-10', past)).toBe('2023-10-10');
  });
});
