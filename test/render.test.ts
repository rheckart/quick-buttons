import { describe, expect, it } from 'vitest';
import {
  announcement, decodeCallback, draftMissing, hashRendered, isDraftComplete, renderAdminMenu, renderBoard,
  renderChoice, renderConfirm, renderCourseFinished, renderDoubleDose, renderDraftCard, renderFollowup,
  renderGivenAtPicker, renderMonthlyNudge, renderPanel, renderRound, renderSingle, renderText, typeTimePrompt,
} from '../src/render/index.js';
import type { MedDraft } from '../src/render/index.js';
import type { BoardView, EntryView, Med, MedState, PetConfig, Rendered, RoundView, SingleMedView } from '../src/types.js';

const tz = 'America/New_York';
const at = (hhmm: string, date = '2026-10-10') => new Date(`${date}T${hhmm}:00-04:00`);
const rob = { userId: 1, name: 'Rob' };
const dani = { userId: 2, name: 'Danielle' };

const med = (id: number, name: string, extra: Partial<Med> = {}): Med => ({
  id, petId: 'twiggy', name, kind: 'ongoing', doseNote: null, roundKeys: ['morning'], days: null,
  startedOn: null, seedLastGiven: null, createdAt: at('00:00'), stoppedAt: null, ...extra,
});
const entry = (extra: Partial<EntryView> = {}): EntryView => ({
  entryId: 1, by: rob, givenAt: at('08:15'), loggedAt: at('08:15'), backdated: false, givenLate: false,
  editedBy: null, undoneBy: null, ...extra,
});
const round = (states: [string, MedState, (string | null)?][], extra: Partial<RoundView> = {}): RoundView => ({
  petId: 'twiggy', petName: 'Twiggy', roundKey: 'morning', roundName: 'Morning', emoji: '☀️', forDate: '2026-10-10',
  due: '08:00', lateAfter: '10:00',
  meds: states.map(([name, state, note], i) => ({ med: med(i + 1, name, { doseNote: note ?? null }), state })),
  phase: 'due', complete: false, anyLogged: false, latest: null, ...extra,
});
const reminder = () => round([['Antibiotic', 'pending'], ['Eye drops', 'pending', '2 drops each eye']]);
const done = (extra: Partial<RoundView> = {}) =>
  round([['Antibiotic', 'given'], ['Eye drops', 'given']], { complete: true, anyLogged: true, latest: entry(), ...extra });

const labels = (r: Rendered) => r.keyboard.flat().map((b) => b.text);

function expectValidButtons(r: Rendered) {
  for (const b of r.keyboard.flat()) {
    expect(new TextEncoder().encode(b.data).length).toBeLessThanOrEqual(64);
    expect(decodeCallback(b.data)).not.toBeNull();
  }
}

describe('renderRound', () => {
  it('reminder: title, dose notes, late-after, two buttons', () => {
    const r = renderRound(reminder(), 7, tz);
    expect(r.text).toBe('☀️ Twiggy morning: Antibiotic + Eye drops\n• Eye drops: 2 drops each eye\nLate after 10:00');
    expect(labels(r)).toEqual(['✅ All given', '⚙️ Change…']);
    expect(r.keyboard).toHaveLength(1);
    expect(decodeCallback(r.keyboard[0]![0]!.data)).toEqual({ t: 'logAll', m: 7 });
    expect(decodeCallback(r.keyboard[0]![1]!.data)).toEqual({ t: 'change', m: 7 });
    expectValidButtons(r);
  });

  it('late phase adds the LATE line', () => {
    expect(renderRound({ ...reminder(), phase: 'late' }, 1, tz).text).toContain('\n⚠️ LATE');
  });

  it('logged: header, given list, only a Fix button', () => {
    const r = renderRound(done(), 7, tz);
    expect(r.text).toBe('✅ Given by Rob at 8:15\n☀️ Twiggy morning: Antibiotic, Eye drops');
    expect(labels(r)).toEqual(['✏️ Fix']);
    expect(decodeCallback(r.keyboard[0]![0]!.data)).toEqual({ t: 'change', m: 7 });
  });

  it('backdated and late variants', () => {
    const e = entry({ givenAt: at('07:45'), loggedAt: at('10:30'), backdated: true, givenLate: true });
    expect(renderRound(done({ latest: e }), 1, tz).text).toContain('✅ Given late by Rob at 7:45 (logged 10:30)');
  });

  it('partial: skipped, still to give, log-the-rest + Fix', () => {
    const v = round([['Antibiotic', 'given'], ['Eye drops', 'pending'], ['Allergy', 'skipped']], {
      anyLogged: true, latest: entry(),
    });
    const r = renderRound(v, 3, tz);
    expect(r.text).toContain('⏭ Skipped: Allergy');
    expect(r.text).toContain('⏳ Still to give: Eye drops');
    expect(labels(r)).toEqual(['✅ Log the rest', '✏️ Fix']);
    expect(decodeCallback(r.keyboard[0]![0]!.data)).toEqual({ t: 'logAll', m: 3 });
  });

  it('shows edited-by and undone-by notes', () => {
    expect(renderRound(done({ latest: entry({ editedBy: dani }) }), 1, tz).text).toContain('✏️ edited by Danielle');
    const undone = renderRound({ ...reminder(), latest: entry({ undoneBy: dani }) }, 1, tz);
    expect(undone.text).toContain('↩️ Undone by Danielle');
    expect(labels(undone)).toEqual(['✅ All given', '⚙️ Change…']);
  });

  it('escapes user text', () => {
    const v = round([['<b>x&y', 'pending', 'a<i>&b']], { petName: 'T<w>' });
    const r = renderRound(v, 1, tz);
    expect(r.text).toContain('&lt;b&gt;x&amp;y');
    expect(r.text).toContain('a&lt;i&gt;&amp;b');
    expect(r.text).toContain('T&lt;w&gt;');
    expect(r.text).not.toContain('<b>x');
    const logged = renderRound(done({ latest: entry({ by: { userId: 3, name: 'A&B' } }) }), 1, tz);
    expect(logged.text).toContain('A&amp;B');
  });
});

describe('renderFollowup', () => {
  it('mentions givers and lists only pending meds', () => {
    const v = round([['Antibiotic', 'given'], ['Eye drops', 'pending']], { anyLogged: true, latest: entry() });
    const r = renderFollowup(v, [rob, { userId: 2, name: 'Dani<>' }], 9, tz);
    expect(r.text).toContain('<a href="tg://user?id=1">Rob</a> <a href="tg://user?id=2">Dani&lt;&gt;</a>');
    expect(r.text).toContain('Eye drops still not given (late at 10:00)');
    expect(r.text).not.toContain('Antibiotic');
    expect(labels(r)).toEqual(['✅ All given']);
    expect(decodeCallback(r.keyboard[0]![0]!.data)).toEqual({ t: 'logAll', m: 9 });
  });
});

const single = (extra: Partial<SingleMedView> = {}, medExtra: Partial<Med> = {}): SingleMedView => ({
  petId: 'twiggy', petName: 'Twiggy', med: med(5, 'Simparica', { kind: 'monthly', roundKeys: [], ...medExtra }),
  dueDate: '2026-10-14', lastGivenAt: null, lastGivenBy: null, phase: 'due', latest: null, ...extra,
});

describe('renderSingle / nudge', () => {
  it('due, upcoming and late reminders have a Given button', () => {
    for (const phase of ['due', 'upcoming', 'late'] as const) {
      const r = renderSingle(single({ phase }), 4, tz);
      expect(labels(r)).toEqual(['✅ Given']);
      expect(decodeCallback(r.keyboard[0]![0]!.data)).toEqual({ t: 'logSingle', m: 4 });
    }
    expect(renderSingle(single({ phase: 'late' }), 4, tz).text).toContain('⚠️ LATE');
    expect(renderSingle(single({ phase: 'upcoming' }), 4, tz).text).toContain('Wed 14 Oct');
  });

  it('given state is a record with Fix', () => {
    const r = renderSingle(single({ phase: 'given', latest: entry({ editedBy: dani }) }), 4, tz);
    expect(r.text).toContain('✅ Given by Rob at 8:15');
    expect(r.text).toContain('✏️ edited by Danielle');
    expect(labels(r)).toEqual(['✏️ Fix']);
  });

  it('as-needed: prompt, then record; undone returns to prompt', () => {
    const ear = (x: Partial<SingleMedView>) => single({ phase: 'as_needed', dueDate: null, ...x }, { kind: 'as_needed', name: 'Ear cleaner' });
    expect(labels(renderSingle(ear({}), 1, tz))).toEqual(['✅ Given']);
    expect(labels(renderSingle(ear({ latest: entry() }), 1, tz))).toEqual(['✏️ Fix']);
    const undone = renderSingle(ear({ latest: entry({ undoneBy: rob }) }), 1, tz);
    expect(undone.text).toContain('↩️ Undone by Rob');
    expect(labels(undone)).toEqual(['✅ Given']);
  });

  it('nudge mentions nobody', () => {
    const r = renderMonthlyNudge(single(), [rob], 2, tz);
    expect(r.text).not.toContain('tg://');
    expect(labels(r)).toEqual(['✅ Given']);
  });
});

describe('renderBoard', () => {
  const rd = (extra: Partial<RoundView>) => ({ ...reminder(), ...extra });
  const board = (rounds: RoundView[], singles: SingleMedView[] = []): BoardView => ({
    petId: 'twiggy', petName: 'Twiggy', rounds, singles,
  });
  const lbl = (v: RoundView) => renderBoard(board([v]), 1, tz, at('09:00')).keyboard[0]![0]!.text;

  it('title and per-round status labels', () => {
    expect(renderBoard(board([]), 1, tz, at('09:00')).text).toBe('📋 Twiggy · tap to log');
    expect(lbl(done())).toBe('☀️ Morning · ✅ Rob 8:15');
    expect(lbl(rd({ phase: 'due' }))).toBe('☀️ Morning · ⏳ due 8:00');
    expect(lbl(rd({ phase: 'upcoming', roundName: 'Evening', emoji: '🌙', due: '18:00' }))).toBe('🌙 Evening · 🔜 18:00');
    expect(lbl(rd({ phase: 'late' }))).toBe('☀️ Morning · ⚠️ LATE');
    const partial = round([['Antibiotic', 'given'], ['Eye drops', 'pending']], { anyLogged: true, latest: entry() });
    expect(lbl(partial)).toBe('☀️ Morning · ◐ Eye drops left');
  });

  it('singles: monthly, late, as-needed', () => {
    const ear = single({ phase: 'as_needed', dueDate: null, lastGivenAt: at('12:00', '2026-10-02') }, { kind: 'as_needed', name: 'Ear cleaner', id: 6 });
    const never = single({ phase: 'as_needed', dueDate: null }, { kind: 'as_needed', name: 'Ear cleaner', id: 7 });
    const r = renderBoard(board([], [single(), ear, never, single({ phase: 'late' })]), 1, tz, at('09:00'));
    expect(labels(r)).toEqual([
      '📅 Simparica · due Wed 14 Oct',
      '💧 Ear cleaner · last 2 Oct',
      '💧 Ear cleaner · never',
      '📅 Simparica · ⚠️ LATE',
    ]);
    expect(decodeCallback(r.keyboard[0]![0]!.data)).toEqual({ t: 'board', petId: 'twiggy', target: 'm5' });
    expect(r.keyboard.every((row) => row.length === 1)).toBe(true);
  });

  it('round buttons target the round key; long labels are bounded', () => {
    const long = round(Array.from({ length: 6 }, (_, i) => [`Medication number ${i}`, 'pending'] as [string, MedState]), {
      anyLogged: true, latest: entry(), roundName: 'A very long round name indeed, truly',
    });
    const r = renderBoard(board([long]), 1, tz, at('09:00'));
    expect([...r.keyboard[0]![0]!.text].length).toBeLessThanOrEqual(60);
    expect(r.keyboard[0]![0]!.text).toContain('left');
    expect(decodeCallback(r.keyboard[0]![0]!.data)).toEqual({ t: 'board', petId: 'twiggy', target: 'morning' });
    expectValidButtons(r);
  });
});

describe('panel', () => {
  const meds = [
    { name: 'Antibiotic', state: 'given' as const, doseNote: null },
    { name: 'Eye <drops>', state: 'skipped' as const, doseNote: '2&2' },
  ];
  const base = { title: '☀️ Twiggy morning', meds, givenAt: at('08:15'), now: at('08:15'), mode: 'log' as const };

  it('log mode: rows per med, given-at (now), back + log these', () => {
    const r = renderPanel(base, 11, tz);
    expect(r.keyboard).toHaveLength(4);
    expect(r.keyboard[0]).toHaveLength(3);
    expect(r.keyboard[0]!.map((b) => decodeCallback(b.data))).toEqual([
      { t: 'setMed', m: 11, i: 0, s: 'given' }, { t: 'setMed', m: 11, i: 0, s: 'pending' }, { t: 'setMed', m: 11, i: 0, s: 'skipped' },
    ]);
    expect(r.keyboard[0]![0]!.text.startsWith('•')).toBe(true);
    expect(r.keyboard[0]![1]!.text).toBe('✖ not yet');
    expect(r.keyboard[1]![2]!.text).toBe('• ⏭ skip');
    expect(r.keyboard[2]![0]!.text).toBe('🕐 Given at 8:15 (now) ▸');
    expect(r.keyboard[3]!.map((b) => b.text)).toEqual(['« Back', '✅ Log these']);
    expect(r.text).toContain('Eye &lt;drops&gt; — 2&amp;2');
    expectValidButtons(r);
  });

  it('backdated given-at drops "(now)"', () => {
    const r = renderPanel({ ...base, givenAt: at('07:45') }, 11, tz);
    expect(r.keyboard[2]![0]!.text).toBe('🕐 Given at 7:45 ▸');
  });

  it('fix mode has Undo and Save instead of Log these', () => {
    const r = renderPanel({ ...base, mode: 'fix' }, 11, tz);
    const all = labels(r);
    expect(all).toContain('🗑 Undo');
    expect(all).toContain('✅ Save');
    expect(all).not.toContain('✅ Log these');
    expect(all).toContain('« Back');
    expectValidButtons(r);
  });

  it('pendingAskTime adds a hint', () => {
    expect(renderPanel({ ...base, pendingAskTime: true }, 1, tz).text).toContain('7pm');
  });

  it('given-at picker', () => {
    const r = renderGivenAtPicker(11, at('08:15'), tz);
    expect(labels(r)).toEqual([
      'Now · 8:15', '15 min ago · 8:00', '30 min ago · 7:45', '1 h ago · 7:15', '2 h ago · 6:15', '⌨️ Type a time', '« Back',
    ]);
    const cbs = r.keyboard.flat().map((b) => decodeCallback(b.data));
    expect(cbs.slice(0, 5)).toEqual([0, 15, 30, 60, 120].map((mins) => ({ t: 'ago', m: 11, mins })));
    expect(cbs[5]).toEqual({ t: 'typeTime', m: 11 });
    expect(cbs[6]).toEqual({ t: 'back', m: 11 });
  });

  it('type-time prompt is a force reply with no keyboard', () => {
    const r = typeTimePrompt();
    expect(r.forceReply).toBe(true);
    expect(r.keyboard).toEqual([]);
    expect(r.text).toContain('7:45');
  });
});

describe('prompts', () => {
  it('double dose', () => {
    const r = renderDoubleDose({ petName: 'Twiggy', roundOrMedName: 'Morning', by: rob, givenAt: at('08:15'), isRound: true }, 5, tz);
    expect(r.text).toBe('⚠️ Twiggy morning was already given by Rob at 8:15. Log it again?');
    expect(labels(r)).toEqual(['Yes, log again', 'Cancel']);
    expect(r.keyboard[0]!.map((b) => decodeCallback(b.data))).toEqual([{ t: 'dd', m: 5, yes: true }, { t: 'dd', m: 5, yes: false }]);
  });

  it('double dose for an older med dose says when', () => {
    const r = renderDoubleDose({ petName: 'Twiggy', roundOrMedName: 'Simparica', by: rob, givenAt: at('08:15', '2026-10-02'), now: at('09:00') }, 5, tz);
    expect(r.text).toBe('⚠️ Twiggy Simparica was already given by Rob on 2 Oct at 8:15. Log it again?');
  });

  it('course finished', () => {
    const r = renderCourseFinished('Anti<b>', 'Twiggy');
    expect(r.text).toBe('Anti&lt;b&gt; course finished 🎉');
    expect(r.keyboard).toEqual([]);
  });

  it('generic choice, confirm, text', () => {
    const r = renderChoice('Pick <one>', [1, 2, 3].map((n) => ({ label: `P${n}`, data: { t: 'admin', a: 'pet', v: `p${n}` } })), 2, { t: 'admin', a: 'menu' });
    expect(r.text).toBe('Pick &lt;one&gt;');
    expect(r.keyboard.map((row) => row.length)).toEqual([2, 1, 1]);
    expect(labels(r).at(-1)).toBe('« Back');
    expectValidButtons(r);
    const c = renderConfirm('Stop <x>?', { t: 'admin', a: 'yes' }, { t: 'admin', a: 'no' });
    expect(c.text).toBe('Stop &lt;x&gt;?');
    expect(c.keyboard[0]).toHaveLength(2);
    expect(renderText('a&b')).toMatchObject({ text: 'a&amp;b', keyboard: [] });
  });
});

describe('admin', () => {
  const pets: PetConfig[] = [{
    id: 'twiggy', name: 'Twiggy', topicId: 1, monthlyMorning: '08:00', monthlyEvening: '18:00',
    rounds: [
      { key: 'morning', name: 'Morning', emoji: '☀️', due: '08:00', lateAfter: '10:00' },
      { key: 'evening', name: 'Evening', emoji: '🌙', due: '18:00', lateAfter: '20:00' },
    ],
  }];

  it('menu', () => {
    const r = renderAdminMenu();
    expect(labels(r)).toEqual(['➕ Start', '⏹ Stop', '✏️ Edit', '📜 Fix a past log']);
    expectValidButtons(r);
  });

  it('draftMissing / isDraftComplete rules', () => {
    expect(draftMissing({ roundKeys: [] })).toEqual(['Pet', 'Name', 'Kind']);
    expect(draftMissing({ petId: 'twiggy', name: 'A', kind: 'ongoing', roundKeys: [] })).toEqual(['Rounds']);
    expect(draftMissing({ petId: 'twiggy', name: 'A', kind: 'course', roundKeys: ['morning'] })).toEqual(['Days']);
    expect(draftMissing({ petId: 'twiggy', name: 'A', kind: 'course', roundKeys: ['morning'], days: 0 })).toEqual(['Days']);
    expect(isDraftComplete({ petId: 'twiggy', name: 'A', kind: 'course', roundKeys: ['morning'], days: 10 })).toBe(true);
    expect(isDraftComplete({ petId: 'faith', name: 'S', kind: 'monthly', roundKeys: [] })).toBe(true);
    expect(isDraftComplete({ petId: 'faith', name: 'S', kind: 'as_needed', roundKeys: [] })).toBe(true);
  });

  it('incomplete card: disabled Start naming what is missing', () => {
    const d: MedDraft = { petId: 'twiggy', name: 'A<b>', kind: 'course', roundKeys: ['morning', 'evening'] };
    const r = renderDraftCard(d, pets);
    expect(r.text).toContain('Name: A&lt;b&gt;');
    expect(r.text).toContain('Rounds: Morning + Evening');
    expect(r.text).toContain('Started on: first dose');
    const start = r.keyboard.flat().find((b) => b.text.startsWith('✅ Start'))!;
    expect(start.text).toBe('✅ Start (fill in: Days)');
    expect(decodeCallback(start.data)).toEqual({ t: 'admin', a: 'noop' });
    expect(decodeCallback(r.keyboard.flat().at(-1)!.data)).toEqual({ t: 'admin', a: 'cancel' });
    expectValidButtons(r);
  });

  it('complete card: live Start and a button per applicable field', () => {
    const course = renderDraftCard({ petId: 'twiggy', name: 'A', kind: 'course', roundKeys: ['morning'], days: 10 }, pets);
    const start = course.keyboard.flat().find((b) => b.text === '✅ Start')!;
    expect(decodeCallback(start.data)).toEqual({ t: 'admin', a: 'start' });
    const fields = (r: Rendered) =>
      r.keyboard.flat().map((b) => decodeCallback(b.data)).flatMap((c) => (c?.t === 'admin' && c.a === 'field' ? [c.v] : []));
    expect(fields(course)).toEqual(['pet', 'name', 'kind', 'rounds', 'days', 'doseNote', 'startedOn']);
    const monthly = renderDraftCard({ petId: 'twiggy', name: 'S', kind: 'monthly', roundKeys: [], lastGiven: '2026-10-02' }, pets);
    expect(fields(monthly)).toEqual(['pet', 'name', 'kind', 'doseNote', 'lastGiven']);
    expect(monthly.text).toContain('Last given: Fri 2 Oct');
    expect(monthly.text).not.toContain('Rounds');
    const blank = renderDraftCard({ roundKeys: [] }, pets);
    expect(fields(blank)).toEqual(['pet', 'name', 'kind', 'doseNote']);
  });

  it('announcements', () => {
    const med = { name: 'Antibiotic', kind: 'course' as const, days: 10 };
    expect(announcement('start', 'Rob', med, ['morning', 'evening'])).toBe('Rob started Antibiotic: 10 days, morning + evening');
    expect(announcement('stop', 'Rob', med, [])).toBe('Rob stopped Antibiotic');
    expect(announcement('edit', 'Rob', { ...med, days: 14 }, ['morning'])).toBe('Rob changed Antibiotic: 14 days, morning');
    expect(announcement('start', 'Rob', { name: 'Eye drops', kind: 'ongoing', doseNote: '2 drops' }, ['morning'])).toBe('Rob started Eye drops: daily, morning — "2 drops"');
  });
});

describe('hashRendered', () => {
  it('is stable and sensitive to text and buttons', () => {
    const a = renderRound(reminder(), 1, tz);
    expect(hashRendered(a)).toBe(hashRendered(renderRound(reminder(), 1, tz)));
    expect(hashRendered(a)).toMatch(/^[0-9a-f]{40}$/);
    expect(hashRendered(a)).not.toBe(hashRendered(renderRound(reminder(), 2, tz)));
    expect(hashRendered(a)).not.toBe(hashRendered(renderRound({ ...reminder(), phase: 'late' }, 1, tz)));
  });
});
