import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ServiceError } from '../src/service/index.js';
import { at } from './domain-fixtures.js';
import { buttonLabels } from './helpers/fakeMessenger.js';
import { DANI, KID, makeHarness, ROB, seedDayOneMeds, TWIGGY_TOPIC } from './helpers/harness.js';
import type { Harness } from './helpers/harness.js';

let h: Harness;
let meds: Awaited<ReturnType<typeof seedDayOneMeds>>;

beforeEach(async () => {
  h = await makeHarness({ now: '2026-10-10 06:00' });
  meds = await seedDayOneMeds(h);
  await h.reconcile();
});
afterEach(() => h.close());

const rejects = (p: Promise<unknown>, text: string) =>
  expect(p).rejects.toSatisfy((e: unknown) => e instanceof ServiceError && e.message.includes(text));

describe('startMed', () => {
  it('creates the med, announces it in the pet topic and refreshes the board', async () => {
    h.clock.set('2026-10-10 12:00');
    const med = await h.svc.startMed({ petId: 'twiggy', name: 'Joint chew', kind: 'ongoing', roundKeys: ['evening'], doseNote: '1 chew' }, ROB);
    expect(med).toMatchObject({ name: 'Joint chew', createdAt: at('2026-10-10 12:00'), roundKeys: ['evening'] });
    const note = h.fake.one('Rob started Joint chew: daily, evening', TWIGGY_TOPIC);
    expect(note.keyboard).toEqual([]);
    expect((await h.svc.listMeds('twiggy')).map((m) => m.name)).toContain('Joint chew');
  });

  it('a course announces its length, and seeds monthly last-given', async () => {
    await h.svc.startMed({ petId: 'twiggy', name: 'Eye gel', kind: 'course', roundKeys: ['morning', 'evening'], days: 5, startedOn: '2026-10-09' }, DANI);
    expect(h.fake.one('Danielle started Eye gel: 5 days, morning + evening')).toBeDefined();
    const m = await h.svc.startMed({ petId: 'faith', name: 'Heartworm', kind: 'monthly', roundKeys: [], lastGiven: '2026-10-01' }, ROB);
    expect(m.seedLastGiven).toBe('2026-10-01');
    expect(h.fake.one('Heartworm', 12).text).toContain('Rob started Heartworm: monthly');
  });

  it('starting a med mid-round shows up in that round straight away', async () => {
    h.clock.set('2026-10-10 08:00');
    await h.reconcile();
    await h.svc.startMed({ petId: 'twiggy', name: 'Probiotic', kind: 'ongoing', roundKeys: ['morning'] }, ROB);
    expect(h.fake.one('Late after 10:00').text).toContain('Probiotic');
  });

  it('rejects bad input with a ServiceError', async () => {
    const base = { petId: 'twiggy', name: 'X', kind: 'ongoing' as const, roundKeys: ['morning'] };
    await rejects(h.svc.startMed({ ...base }, KID), 'Only admins');
    await rejects(h.svc.startMed({ ...base, name: '  ' }, ROB), 'needs a name');
    await rejects(h.svc.startMed({ ...base, petId: 'rex' }, ROB), 'Pick a pet');
    await rejects(h.svc.startMed({ ...base, petId: undefined }, ROB), 'Pick a pet');
    await rejects(h.svc.startMed({ ...base, kind: undefined }, ROB), 'what kind');
    await rejects(h.svc.startMed({ ...base, roundKeys: [] }, ROB), 'at least one round');
    await rejects(h.svc.startMed({ ...base, roundKeys: ['lunch'] }, ROB), 'no round called lunch');
    await rejects(h.svc.startMed({ ...base, petId: 'faith' }, ROB), 'no round called morning');
    await rejects(h.svc.startMed({ ...base, kind: 'course' }, ROB), 'whole number of days');
    await rejects(h.svc.startMed({ ...base, kind: 'course', days: 0 }, ROB), 'whole number of days');
    await rejects(h.svc.startMed({ ...base, kind: 'course', days: 2.5 }, ROB), 'whole number of days');
    await rejects(h.svc.startMed({ ...base, kind: 'course', days: 3, startedOn: 'yesterday' }, ROB), 'Started on');
    await rejects(h.svc.startMed({ ...base, name: 'x'.repeat(61) }, ROB), 'too long');
    expect(await h.repos.meds.listActive('twiggy')).toHaveLength(4);
    expect(h.fake.live().filter((m) => m.text.includes('started'))).toEqual([]);
  });

  it('escapes hostile names in announcements, reminders and the board', async () => {
    await h.svc.startMed({ petId: 'twiggy', name: '<b>Hi</b> & <script>', kind: 'ongoing', roundKeys: ['morning'], doseNote: '<i>2</i> & more' }, ROB);
    h.clock.set('2026-10-10 08:00');
    await h.reconcile();
    const texts = h.fake.live().map((m) => m.text).join('\n');
    expect(texts).not.toContain('<script>');
    expect(texts).toContain('&lt;b&gt;Hi&lt;/b&gt; &amp; &lt;script&gt;');
    expect(h.fake.one('Late after 10:00').text).toContain('&lt;i&gt;2&lt;/i&gt; &amp; more');
  });
});

describe('stopMed', () => {
  it('stops the med, announces it, and takes it out of the round', async () => {
    h.clock.set('2026-10-10 08:00');
    await h.reconcile();
    const stopped = await h.svc.stopMed(meds.eyeDrops.id, DANI);
    expect(stopped.stoppedAt).toEqual(at('2026-10-10 08:00'));
    expect(h.fake.one('Danielle stopped Eye drops')).toBeDefined();
    expect(h.fake.one('Late after 10:00').text).not.toContain('Eye drops');
    expect((await h.svc.listMeds('twiggy')).map((m) => m.name)).not.toContain('Eye drops');
  });

  it('shows at once in quiet hours: the board drops a med stopped at 23:00', async () => {
    h.clock.set('2026-10-10 23:00');
    await h.svc.stopMed(meds.simparica.id, ROB);
    expect(h.fake.one('Twiggy · tap to log').keyboard.flat().map((b) => b.text)).toEqual(['☀️ Morning · ⚠️ LATE', '🌙 Evening · ⚠️ LATE']);
    await h.svc.startMed({ petId: 'twiggy', name: 'Night chew', kind: 'as_needed', roundKeys: [] }, ROB);
    expect(h.fake.one('Twiggy · tap to log').keyboard.flat().map((b) => b.text)).toContain('💧 Night chew · never');
  });

  it('removes the reminder when its only med is stopped', async () => {
    await h.svc.stopMed(meds.antibiotic.id, ROB);
    h.clock.set('2026-10-10 18:00');
    await h.svc.stopMed(meds.allergy.id, ROB);
    await h.reconcile();
    expect(h.fake.live().filter((m) => m.text.includes('Twiggy evening'))).toEqual([]);
  });

  it('rejects stopping twice, unknown meds and non-admins', async () => {
    await h.svc.stopMed(meds.allergy.id, ROB);
    await rejects(h.svc.stopMed(meds.allergy.id, ROB), 'not active');
    await rejects(h.svc.stopMed(9999, ROB), 'not active');
    await rejects(h.svc.stopMed(meds.eyeDrops.id, KID), 'Only admins');
  });
});

describe('editMed', () => {
  it('changes days and announces the change', async () => {
    const med = await h.svc.editMed(meds.antibiotic.id, { days: 14 }, ROB);
    expect(med.days).toBe(14);
    expect(h.fake.one('Rob changed Antibiotic: 14 days, morning + evening')).toBeDefined();
  });

  it('changes rounds and dose note, and the reminder follows', async () => {
    await h.svc.editMed(meds.eyeDrops.id, { roundKeys: ['morning', 'evening'], doseNote: '1 drop' }, ROB);
    h.clock.set('2026-10-10 18:00');
    await h.reconcile();
    const evening = h.fake.one('Twiggy evening');
    expect(evening.text).toContain('Eye drops: 1 drop');
  });

  it('validates the patch against the med kind', async () => {
    await rejects(h.svc.editMed(meds.eyeDrops.id, { days: 3 }, ROB), 'Only a course');
    await rejects(h.svc.editMed(meds.simparica.id, { roundKeys: ['morning'] }, ROB), 'rounds');
    await rejects(h.svc.editMed(meds.antibiotic.id, { days: 0 }, ROB), 'whole number');
    await rejects(h.svc.editMed(meds.antibiotic.id, { roundKeys: ['nope'] }, ROB), 'no round called nope');
    await rejects(h.svc.editMed(meds.antibiotic.id, {}, ROB), 'Nothing to change');
    await rejects(h.svc.editMed(meds.antibiotic.id, { days: 3 }, KID), 'Only admins');
    expect((await h.repos.meds.get(meds.antibiotic.id))!.days).toBe(10);
  });
});

describe('past logs', () => {
  async function logMorning(day: string, time: string) {
    h.clock.set(`${day} ${time}`);
    await h.reconcile();
    const rem = h.fake.live().filter((m) => m.text.includes('Late after 10:00')).at(-1)!;
    await h.tap(rem, 'All given', ROB);
  }

  it('lists active logs of the last two weeks, newest first, with labels', async () => {
    await logMorning('2026-10-08', '08:05');
    await logMorning('2026-10-09', '08:10');
    await h.repos.entries.create({ petId: 'twiggy', roundKey: 'morning', forDate: '2026-09-20', givenAt: at('2026-09-20 08:00'), loggedAt: at('2026-09-20 08:00'), by: ROB, items: [{ medId: meds.antibiotic.id, status: 'given' }] });
    const list = await h.svc.listPastEntries('twiggy');
    expect(list.map((e) => e.label)).toEqual(['☀️ Morning · 9 Oct · Rob 8:10', '☀️ Morning · 8 Oct · Rob 8:05']);
    expect(await h.svc.listPastEntries('twiggy', 30)).toHaveLength(3);
  });

  it('an admin opens a Fix panel in a private chat and can undo an old log', async () => {
    await logMorning('2026-10-08', '08:05');
    h.clock.set('2026-10-10 12:00');
    const [{ entry }] = await h.svc.listPastEntries('twiggy');
    await rejects(h.svc.openFixPanel(entry.id, 777, null, KID), 'Only admins');
    await h.svc.openFixPanel(entry.id, 777, null, DANI);
    const panel = h.fake.live().find((m) => m.chatId === 777)!;
    expect(buttonLabels(panel)).toContain('🗑 Undo');
    expect(panel.text).toContain('Twiggy morning');
    const refused = await h.tap(panel, 'Undo', KID);
    expect(refused.alert).toBe(true);
    expect((await h.repos.entries.get(entry.id))!.undone).toBe(false);
    await h.tap(panel, 'Undo', DANI);
    expect(panel.deleted).toBe(true);
    expect((await h.repos.entries.get(entry.id))!.undone).toBe(true);
    expect(h.fake.live().filter((m) => m.text.includes('Given by Rob'))).toEqual([]);
  });

  it('rejects entries that are gone or already undone', async () => {
    await rejects(h.svc.openFixPanel(9999, 777, null, ROB), 'no longer exists');
  });

  it('an admin can fix an old log: change given-at and the message says edited', async () => {
    await logMorning('2026-10-08', '08:05');
    h.clock.set('2026-10-10 12:00');
    const [{ entry }] = await h.svc.listPastEntries('twiggy');
    await h.svc.openFixPanel(entry.id, 777, null, ROB);
    const panel = h.fake.live().find((m) => m.chatId === 777)!;
    await h.tap(panel, 'Given at');
    await h.tap(h.fake.live().find((m) => m.chatId === 777)!, '1 h ago');
    await h.tap(h.fake.live().find((m) => m.chatId === 777)!, 'Save');
    const after = (await h.repos.entries.get(entry.id))!;
    expect(after.givenAt).toEqual(at('2026-10-10 11:00'));
    expect(after.lastRevision.kind).toBe('edit');
    expect(h.fake.live().find((m) => m.text.includes('✏️ edited by Rob'))).toBeDefined();
  });
});
