import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buttonLabels } from './helpers/fakeMessenger.js';
import { DANI, GROUP, makeHarness, ROB, seedDayOneMeds, TWIGGY_TOPIC } from './helpers/harness.js';
import type { Harness } from './helpers/harness.js';

let h: Harness;
let meds: Awaited<ReturnType<typeof seedDayOneMeds>>;

const boardOf = () => h.fake.one('Twiggy · tap to log');
const simparicaButton = () => boardOf().keyboard.flat().find((b) => b.text.includes('Simparica'))!.text;
const tapBoard = (target: string, who = ROB) =>
  h.svc.handleCallback({ t: 'board', petId: 'twiggy', target }, { from: who, chatId: GROUP, messageId: boardOf().messageId, threadId: TWIGGY_TOPIC });
const entries = () => h.repos.entries.listForPet('twiggy', { includeUndone: true });

describe('monthly med due today', () => {
  beforeEach(async () => {
    h = await makeHarness({ now: '2026-10-10 07:30' });
    meds = await seedDayOneMeds(h, { twiggySimparica: '2026-09-10' });
    await h.reconcile();
  });
  afterEach(() => h.close());

  it('reminds in the morning, nudges in the evening, is LATE the next morning, then stays quiet', async () => {
    expect(simparicaButton()).toBe('📅 Simparica · due Sat 10 Oct');
    h.clock.set('2026-10-10 08:00');
    await h.reconcile();
    const reminder = h.fake.one('Simparica is due today', TWIGGY_TOPIC);
    expect(reminder.text).not.toContain('tg://user');
    expect(buttonLabels(reminder)).toEqual(['✅ Given']);
    h.clock.set('2026-10-10 17:59');
    await h.reconcile();
    expect(h.fake.live().filter((m) => m.text.includes('still not given today'))).toEqual([]);
    h.clock.set('2026-10-10 18:00');
    await h.reconcile();
    const nudge = h.fake.one('still not given today');
    expect(nudge.text).not.toContain('tg://user');
    h.clock.set('2026-10-11 08:00');
    await h.reconcile();
    expect(nudge.deleted).toBe(true);
    expect(reminder.text).toContain('⚠️ LATE');
    expect(simparicaButton()).toBe('📅 Simparica · ⚠️ LATE');
    h.clock.set('2026-10-11 18:00');
    await h.reconcile();
    h.clock.set('2026-10-12 08:00');
    await h.reconcile();
    const simparicaMessages = h.fake.messages.filter((m) => m.text.includes('Simparica') && !m.text.includes('tap to log'));
    expect(simparicaMessages.map((m) => m.deleted)).toEqual([false, true]);
  });

  it('logging from the reminder makes it the record, removes the nudge, and moves the due date out', async () => {
    h.clock.set('2026-10-10 18:00');
    await h.reconcile();
    h.clock.set('2026-10-10 18:10');
    await h.tap(h.fake.one('still not given today'), 'Given', DANI);
    expect(h.fake.live().filter((m) => m.text.includes('still not given'))).toEqual([]);
    const record = h.fake.one('Given by Danielle at 18:10');
    expect(buttonLabels(record)).toEqual(['✏️ Fix']);
    expect(simparicaButton()).toBe('📅 Simparica · ✅ Danielle 10 Oct');
    const [entry] = await entries();
    expect(entry).toMatchObject({ roundKey: null, forDate: '2026-10-10' });
  });

  it('undo puts the due date back and the reminder and nudge return', async () => {
    h.clock.set('2026-10-10 08:00');
    await h.reconcile();
    h.clock.set('2026-10-10 18:10');
    await h.tap(h.fake.one('Simparica is due today'), 'Given');
    await h.tap(h.fake.one('Given by Rob'), 'Fix');
    await h.tap(h.fake.live().find((m) => m.keyboard.flat().some((b) => b.text.includes('Undo')))!, 'Undo');
    expect(simparicaButton()).toBe('📅 Simparica · due Sat 10 Oct');
    const back = h.fake.one('Simparica is due today');
    expect(back.text).toContain('↩️ Undone by Rob');
    expect(buttonLabels(back)).toEqual(['✅ Given']);
    await h.reconcile();
    expect(h.fake.one('still not given today')).toBeDefined();
  });

  it('a second tap on the board asks before logging again', async () => {
    await tapBoard(`m${meds.simparica.id}`);
    expect(simparicaButton()).toContain('✅ Rob');
    await tapBoard(`m${meds.simparica.id}`, DANI);
    const prompt = h.fake.one('Simparica was already given by Rob');
    await h.tap(prompt, 'Cancel');
    expect(await entries()).toHaveLength(1);
    expect(prompt.deleted).toBe(true);
  });

  it('a fix by anyone works until the next due morning', async () => {
    h.clock.set('2026-10-10 12:00');
    await tapBoard(`m${meds.simparica.id}`);
    await h.tap(h.fake.one('Given by Rob'), 'Fix', DANI);
    await h.tap(h.fake.live().find((m) => m.keyboard.flat().some((b) => b.text.includes('Save')))!, 'Given at', DANI);
    await h.tap(h.fake.one('When was it given'), '2 h ago', DANI);
    await h.tap(h.fake.live().find((m) => m.keyboard.flat().some((b) => b.text.includes('Save')))!, 'Save', DANI);
    expect(h.fake.one('Given by Rob at 10:00').text).toContain('✏️ edited by Danielle');
  });
});

describe('monthly med given early', () => {
  beforeEach(async () => {
    h = await makeHarness({ now: '2026-10-08 12:00' });
    meds = await seedDayOneMeds(h, { twiggySimparica: '2026-09-10' });
    await h.reconcile();
  });
  afterEach(() => h.close());

  it('an early dose counts for the occurrence: no reminder on the due day, next due a month after the dose', async () => {
    await tapBoard(`m${meds.simparica.id}`);
    expect(h.fake.one('Given by Rob at 12:00').silent).toBe(true);
    expect(simparicaButton()).toBe('📅 Simparica · ✅ Rob 8 Oct');
    h.clock.set('2026-10-10 08:00');
    await h.reconcile();
    h.clock.set('2026-10-10 18:00');
    await h.reconcile();
    expect(h.fake.messages.filter((m) => m.text.includes('Simparica') && !m.text.includes('tap to log') && !m.text.includes('Given by'))).toEqual([]);
  });
});

describe('as-needed meds', () => {
  beforeEach(async () => {
    h = await makeHarness({ now: '2026-10-10 12:00' });
    meds = await seedDayOneMeds(h);
    await h.svc.startMed({ petId: 'twiggy', name: 'Ear cleaner', kind: 'as_needed', roundKeys: [] }, ROB);
    await h.reconcile();
  });
  afterEach(() => h.close());

  const earId = async () => (await h.repos.meds.listActive('twiggy')).find((m) => m.name === 'Ear cleaner')!.id;

  it('has no reminders; a board tap logs it with its own record message', async () => {
    expect(boardOf().keyboard.flat().map((b) => b.text)).toContain('💧 Ear cleaner · never');
    h.clock.set('2026-10-10 19:00');
    await h.reconcile();
    expect(h.fake.live().filter((m) => m.text.includes('Ear cleaner') && !m.text.includes('tap to log') && !m.text.includes('started'))).toEqual([]);
    await tapBoard(`m${await earId()}`);
    const record = h.fake.one('Given by Rob at 19:00');
    expect(record.text).toContain('Ear cleaner');
    expect(boardOf().keyboard.flat().map((b) => b.text)).toContain('💧 Ear cleaner · last 10 Oct');
  });

  it('a second dose the same day asks first; records stay separate and fixes affect only their own', async () => {
    const id = await earId();
    await tapBoard(`m${id}`);
    const first = h.fake.one('Given by Rob at 12:00');
    h.clock.set('2026-10-10 15:00');
    await tapBoard(`m${id}`, DANI);
    await h.tap(h.fake.one('already given by Rob'), 'Yes', DANI);
    const second = h.fake.one('Given by Danielle at 15:00');
    expect(first.messageId).not.toBe(second.messageId);
    await h.tap(second, 'Fix', DANI);
    await h.tap(h.fake.live().find((m) => m.keyboard.flat().some((b) => b.text.includes('Undo')))!, 'Undo', DANI);
    expect(second.text).toContain('↩️ Undone by Danielle');
    expect(first.text).toContain('Given by Rob at 12:00');
    expect(boardOf().keyboard.flat().map((b) => b.text)).toContain('💧 Ear cleaner · last 10 Oct');
    const all = await entries();
    expect(all.map((e) => e.undone)).toEqual([false, true]);
  });

  it('logging again from an undone record message reuses that message', async () => {
    const id = await earId();
    await tapBoard(`m${id}`);
    const record = h.fake.one('Given by Rob');
    await h.tap(record, 'Fix');
    await h.tap(h.fake.live().find((m) => m.keyboard.flat().some((b) => b.text.includes('Undo')))!, 'Undo');
    expect(buttonLabels(record)).toEqual(['✅ Given']);
    h.clock.advance(30);
    await h.tap(record, 'Given', DANI);
    expect(record.text).toContain('Given by Danielle');
    expect(h.fake.live().filter((m) => m.text.includes('Given by'))).toHaveLength(1);
  });
});
