import { describe, expect, it } from 'vitest';
import * as t from '../src/time.js';

const NY = 'America/New_York';
const utc = (s: string) => new Date(s);

describe('time', () => {
  it('local date/time follow the zone, not UTC', () => {
    const d = utc('2026-10-11T02:30:00Z'); // 22:30 on the 10th in New York (EDT)
    expect(t.localDate(d, NY)).toBe('2026-10-10');
    expect(t.localTime(d, NY)).toBe('22:30');
  });

  it('instantAt round-trips and handles DST end (2026-11-01)', () => {
    expect(t.instantAt('2026-10-10', '08:00', NY).toISOString()).toBe('2026-10-10T12:00:00.000Z'); // EDT
    expect(t.instantAt('2026-11-02', '08:00', NY).toISOString()).toBe('2026-11-02T13:00:00.000Z'); // EST
    expect(t.localDate(t.instantAt('2026-11-01', '23:30', NY), NY)).toBe('2026-11-01');
  });

  it('instantAt inside the spring-forward gap does not throw', () => {
    const d = t.instantAt('2026-03-08', '02:30', NY);
    expect(t.localDate(d, NY)).toBe('2026-03-08');
  });

  it('addDays is calendar arithmetic across DST', () => {
    expect(t.addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(t.addDays('2026-11-01', 1)).toBe('2026-11-02');
    expect(t.addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('addMonth clamps to month end', () => {
    expect(t.addMonth('2026-01-31')).toBe('2026-02-28');
    expect(t.addMonth('2028-01-31')).toBe('2028-02-29');
    expect(t.addMonth('2026-12-15')).toBe('2027-01-15');
    expect(t.addMonth('2026-10-14')).toBe('2026-11-14');
  });

  it('daysBetween', () => {
    expect(t.daysBetween('2026-10-01', '2026-10-10')).toBe(9);
    expect(t.daysBetween('2026-10-10', '2026-10-01')).toBe(-9);
    expect(t.daysBetween('2026-10-31', '2026-11-02')).toBe(2);
  });

  it('formats', () => {
    expect(t.fmtTime('08:15')).toBe('8:15');
    expect(t.fmtTime('18:00')).toBe('18:00');
    expect(t.fmtTime(utc('2026-10-10T12:15:00Z'), NY)).toBe('8:15');
    expect(t.fmtDay('2026-10-14')).toBe('Wed 14 Oct');
    expect(t.fmtShortDay('2026-10-02')).toBe('2 Oct');
  });

  it('midpoint', () => {
    expect(t.midpoint('08:00', '10:00')).toBe('09:00');
    expect(t.midpoint('08:00', '09:15')).toBe('08:37');
  });

  describe('quiet hours (22:00–07:00 wraps midnight)', () => {
    const q = { start: '22:00', end: '07:00' };
    const at = (time: string, date = '2026-10-10') => t.instantAt(date, time, NY);
    it('detects quiet and not-quiet', () => {
      expect(t.inQuietHours(at('21:59'), q, NY)).toBe(false);
      expect(t.inQuietHours(at('22:00'), q, NY)).toBe(true);
      expect(t.inQuietHours(at('03:00'), q, NY)).toBe(true);
      expect(t.inQuietHours(at('06:59'), q, NY)).toBe(true);
      expect(t.inQuietHours(at('07:00'), q, NY)).toBe(false);
    });
    it('quietEnd: evening → tomorrow 07:00, early morning → today 07:00, awake → unchanged', () => {
      expect(t.quietEndAtOrAfter(at('23:30'), q, NY).toISOString()).toBe(at('07:00', '2026-10-11').toISOString());
      expect(t.quietEndAtOrAfter(at('02:00'), q, NY).toISOString()).toBe(at('07:00').toISOString());
      const awake = at('12:00');
      expect(t.quietEndAtOrAfter(awake, q, NY)).toBe(awake);
    });
    it('non-wrapping window and empty window', () => {
      const day = { start: '13:00', end: '15:00' };
      expect(t.inQuietHours(at('14:00'), day, NY)).toBe(true);
      expect(t.inQuietHours(at('15:00'), day, NY)).toBe(false);
      expect(t.quietEndAtOrAfter(at('14:00'), day, NY).toISOString()).toBe(at('15:00').toISOString());
      expect(t.inQuietHours(at('03:00'), { start: '00:00', end: '00:00' }, NY)).toBe(false);
    });
    it('quiet end on the DST-end night is still 07:00 local', () => {
      const d = t.instantAt('2026-11-01', '23:00', NY);
      expect(t.localTime(t.quietEndAtOrAfter(d, q, NY), NY)).toBe('07:00');
      expect(t.localDate(t.quietEndAtOrAfter(d, q, NY), NY)).toBe('2026-11-02');
    });
  });

  describe('parseTypedTime', () => {
    const now = t.instantAt('2026-10-10', '20:00', NY);
    const ok = (s: string) => {
      const r = t.parseTypedTime(s, now, NY);
      return r.ok ? t.localTime(r.at, NY) : r.reason;
    };
    it('parses common forms', () => {
      expect(ok('7:45')).toBe('07:45');
      expect(ok('19:45')).toBe('19:45');
      expect(ok('7pm')).toBe('19:00');
      expect(ok('7:45 pm')).toBe('19:45');
      expect(ok('7:45PM')).toBe('19:45');
      expect(ok('12am')).toBe('00:00');
      expect(ok('12pm')).toBe('12:00');
      expect(ok('7.45')).toBe('07:45');
      expect(ok(' 745 ')).toBe('07:45');
    });
    it('rejects junk and the future', () => {
      expect(ok('banana')).toBe('unparseable');
      expect(ok('25:00')).toBe('unparseable');
      expect(ok('13pm')).toBe('unparseable');
      expect(ok('7:75')).toBe('unparseable');
      expect(ok('9pm')).toBe('future');
      expect(ok('20:00')).toBe('20:00');
    });
  });
});
