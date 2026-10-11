import { describe, expect, it } from 'vitest';
import { renderBoard, renderRound } from '../src/render/index.js';
import type { BoardView, EntryView, Med, MedState, Rendered, RoundView } from '../src/types.js';

const tz = 'America/New_York';
const at = (hhmm: string, date = '2026-10-10') => new Date(`${date}T${hhmm}:00-04:00`);
const rob = { userId: 1, name: 'Rob' };
const dani = { userId: 2, name: 'Danielle' };
const kid = { userId: 3, name: 'Kid' };

const med = (id: number, name: string): Med => ({
  id, petId: 'twiggy', name, kind: 'ongoing', doseNote: null, roundKeys: ['morning'], days: null,
  startedOn: null, seedLastGiven: null, createdAt: at('00:00'), stoppedAt: null,
});
const entry = (extra: Partial<EntryView> = {}): EntryView => ({
  entryId: 1, by: rob, givenAt: at('08:15'), loggedAt: at('08:15'), backdated: false, givenLate: false,
  editedBy: null, undoneBy: null, ...extra,
});
const round = (states: [string, MedState][], extra: Partial<RoundView> = {}): RoundView => ({
  petId: 'twiggy', petName: 'Twiggy', roundKey: 'morning', roundName: 'Morning', emoji: '☀️', forDate: '2026-10-10',
  due: '08:00', lateAfter: '10:00',
  meds: states.map(([name, state], i) => ({ med: med(i + 1, name), state })),
  phase: 'due', complete: false, anyLogged: true, latest: entry(), ...extra,
});
const labels = (r: Rendered) => r.keyboard.flat().map((b) => b.text);

describe('fixA 4: several people on one round', () => {
  const both = () => round([['Antibiotic', 'given'], ['Eye drops', 'given']], {
    complete: true,
    latest: entry({ by: dani, givenAt: at('09:10'), loggedAt: at('09:10'), alsoBy: [rob] }),
  });

  it('names both people and the time of the last log', () => {
    expect(renderRound(both(), 1, tz).text).toBe(
      '✅ Given by Rob & Danielle, last at 9:10\n☀️ Twiggy morning: Antibiotic, Eye drops',
    );
  });

  it('three people: comma list then ampersand', () => {
    const v = both();
    v.latest = { ...v.latest!, alsoBy: [rob, kid] };
    expect(renderRound(v, 1, tz).text.split('\n')[0]).toBe('✅ Given by Rob, Kid & Danielle, last at 9:10');
  });

  it('keeps late and backdated markers', () => {
    const v = both();
    v.latest = { ...v.latest!, givenLate: true, backdated: true, givenAt: at('08:55') };
    expect(renderRound(v, 1, tz).text.split('\n')[0]).toBe('✅ Given late by Rob & Danielle, last at 8:55 (logged 9:10)');
  });

  it('single-person strings are unchanged', () => {
    const v = both();
    v.latest = { ...v.latest!, by: rob, alsoBy: [], givenAt: at('08:15'), loggedAt: at('08:15') };
    expect(renderRound(v, 1, tz).text.split('\n')[0]).toBe('✅ Given by Rob at 8:15');
    v.latest = { ...v.latest!, alsoBy: undefined };
    expect(renderRound(v, 1, tz).text.split('\n')[0]).toBe('✅ Given by Rob at 8:15');
  });

  it('edited-by still shows next to the multi-person header', () => {
    const v = both();
    v.latest = { ...v.latest!, editedBy: kid };
    expect(renderRound(v, 1, tz).text).toContain('✏️ edited by Kid');
  });
});

describe('fixA 5: nothing given (only skipped)', () => {
  it('does not say Given; shows a skipped header, the rest, and the usual buttons', () => {
    const v = round([['Antibiotic', 'skipped'], ['Eye drops', 'pending']], { latest: entry({ editedBy: dani }) });
    const r = renderRound(v, 3, tz);
    expect(r.text).not.toContain('Given');
    expect(r.text).toBe('⏭ Skipped by Rob: Antibiotic\n⏳ Still to give: Eye drops\n✏️ edited by Danielle');
    expect(labels(r)).toEqual(['✅ Log the rest', '✏️ Fix']);
  });

  it('all skipped: complete, only Fix', () => {
    const v = round([['Antibiotic', 'skipped'], ['Eye drops', 'skipped']], { complete: true });
    const r = renderRound(v, 3, tz);
    expect(r.text).toBe('⏭ Skipped by Rob: Antibiotic, Eye drops');
    expect(labels(r)).toEqual(['✏️ Fix']);
  });

  it('a mixed log still says Given and keeps the skipped line', () => {
    const v = round([['Antibiotic', 'given'], ['Eye drops', 'skipped']], { complete: true });
    expect(renderRound(v, 3, tz).text).toBe(
      '✅ Given by Rob at 8:15\n☀️ Twiggy morning: Antibiotic\n⏭ Skipped: Eye drops',
    );
  });

  it('edited down to nothing (no given, no skipped) is not "Given" either', () => {
    const v = round([['Antibiotic', 'pending'], ['Eye drops', 'pending']], { phase: 'late' });
    const r = renderRound(v, 3, tz);
    expect(r.text).not.toContain('Given');
    expect(r.text).toContain('⏳ Still to give: Antibiotic, Eye drops');
    expect(r.text).toContain('⚠️ LATE');
    expect(labels(r)).toEqual(['✅ Log the rest', '✏️ Fix']);
  });
});

describe('fixA 6: board shows LATE on a partly logged round', () => {
  const board = (r: RoundView): BoardView => ({ petId: 'twiggy', petName: 'Twiggy', rounds: [r], singles: [] });
  const lbl = (r: RoundView) => renderBoard(board(r), 1, tz, at('11:00')).keyboard[0]![0]!.text;

  it('late partial', () => {
    const v = round([['Antibiotic', 'given'], ['Eye drops', 'pending']], { phase: 'late' });
    expect(lbl(v)).toBe('☀️ Morning · ⚠️ LATE · ◐ Eye drops left');
  });

  it('not late stays as before', () => {
    const v = round([['Antibiotic', 'given'], ['Eye drops', 'pending']]);
    expect(lbl(v)).toBe('☀️ Morning · ◐ Eye drops left');
  });

  it('stays within 64 characters and keeps the status with long names', () => {
    const v = round(
      [['Antibiotic', 'given'], ['Extremely long medicine name one', 'pending'], ['Another very long medicine', 'pending']],
      { phase: 'late', roundName: 'A very long round name indeed here' },
    );
    const t = lbl(v);
    expect([...t].length).toBeLessThanOrEqual(64);
    expect(t).toContain('⚠️ LATE · ◐ 2 left');
  });
});
