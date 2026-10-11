import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decodeCallback } from '../src/render/index.js';
import { at } from './domain-fixtures.js';
import { DANI, makeHarness, ROB, seedDayOneMeds, TWIGGY_TOPIC } from './helpers/harness.js';
import type { Harness } from './helpers/harness.js';

let h: Harness;
let meds: Awaited<ReturnType<typeof seedDayOneMeds>>;

beforeEach(async () => {
  h = await makeHarness({ now: '2026-10-10 06:00' });
  meds = await seedDayOneMeds(h);
  await h.reconcile();
});
afterEach(() => h.close());

const entries = () => h.repos.entries.listForPet('twiggy', { includeUndone: true });
const twiggyBoards = () => h.fake.live(TWIGGY_TOPIC).filter((m) => m.text.includes('tap to log'));

describe('messages deleted by hand are re-posted', () => {
  it('a board that is gone is sent and pinned again', async () => {
    const old = twiggyBoards()[0]!;
    old.deleted = true; // Rob removed it in Telegram
    h.clock.set('2026-10-10 08:00'); // its labels change, so the bot edits it and finds out
    await h.reconcile();
    const boards = twiggyBoards();
    expect(boards).toHaveLength(1);
    expect(boards[0]!.messageId).not.toBe(old.messageId);
    expect(boards[0]!.pinned).toBe(true);
    expect(boards[0]!.keyboard[0]![0]!.text).toBe('☀️ Morning · ⏳ due 8:00');
    const rows = await h.repos.messages.findAny({ kind: 'board', petId: 'twiggy' });
    expect(rows.filter((r) => r.deletedAt === null)).toHaveLength(1);
  });

  it('an unlogged reminder that is gone is posted again', async () => {
    h.clock.set('2026-10-10 08:00');
    await h.reconcile();
    const old = h.fake.one('Twiggy morning: Antibiotic');
    old.deleted = true;
    await h.svc.editMed(meds.antibiotic.id, { doseNote: '2 tablets' }, ROB); // changes the reminder text
    h.clock.set('2026-10-10 08:05');
    await h.reconcile();
    const fresh = h.fake.live(TWIGGY_TOPIC).filter((m) => m.text.includes('Twiggy morning: Antibiotic') && m.text.includes('Late after'));
    expect(fresh).toHaveLength(1);
    expect(fresh[0]!.messageId).not.toBe(old.messageId);
    expect(fresh[0]!.text).toContain('2 tablets');
    expect(fresh[0]!.keyboard.flat().map((b) => b.text)).toContain('✅ All given');
  });

  it('a logged record that is gone loses its record id and a new record is posted', async () => {
    h.clock.set('2026-10-10 08:00');
    await h.reconcile();
    const reminder = h.fake.one('Late after 10:00');
    await h.tap(reminder, 'Change', ROB);
    await h.setMed(reminder, 1, 'pending', ROB); // log the antibiotic only
    await h.tap(reminder, 'Log these', ROB);
    const [entry] = await entries();
    const old = h.fake.byId(entry!.recordMessageId!);
    old.deleted = true;
    h.clock.set('2026-10-10 08:30');
    await h.tap(old, 'Log the rest', DANI); // the next edit of the record finds out it is gone
    const records = h.fake.live(TWIGGY_TOPIC).filter((m) => m.text.includes('Given by'));
    expect(records).toHaveLength(0);
    expect((await entries()).every((e) => e.recordMessageId === null)).toBe(true);

    await h.reconcile();
    const fresh = h.fake.one('Given by');
    expect(fresh.messageId).not.toBe(old.messageId);
    expect(fresh.text).toContain('Antibiotic');
    expect(fresh.text).toContain('Eye drops');
    expect((await entries()).some((e) => e.recordMessageId === fresh.messageId)).toBe(true);
  });
});

describe('a record message that failed to send is sent later', () => {
  it('reconcile posts the record of a log whose send failed', async () => {
    h.clock.set('2026-10-10 07:30');
    await h.reconcile();
    h.fake.failOnce('send');
    await h.tap(h.fake.one('Twiggy · tap to log'), 'Morning', ROB);
    const [logged] = await entries();
    expect(logged).toBeDefined(); // the log itself was kept
    expect(logged!.recordMessageId).toBeNull();
    expect(h.fake.live(TWIGGY_TOPIC).filter((m) => m.text.includes('Given by'))).toEqual([]);

    h.clock.set('2026-10-10 07:31');
    await h.reconcile();
    const record = h.fake.one('Given by Rob');
    expect(record.silent).toBe(true);
    expect((await entries())[0]!.recordMessageId).toBe(record.messageId);

    const mark = h.fake.mark();
    await h.reconcile(); // and it stays idempotent
    expect(h.fake.callsSince(mark)).toEqual([]);
  });

  it('also covers yesterday, and an as-needed dose', async () => {
    h.clock.set('2026-10-10 21:00');
    const ear = await h.addMed({ petId: 'twiggy', name: 'Ear cleaner', kind: 'as_needed' });
    await h.reconcile();
    h.fake.failOnce('send');
    await h.tap(h.fake.one('Twiggy · tap to log'), 'Ear cleaner', ROB);
    expect(h.fake.live(TWIGGY_TOPIC).filter((m) => m.text.includes('Ear cleaner') && m.text.includes('Given'))).toEqual([]);
    h.clock.set('2026-10-11 07:30'); // quiet hours end; the dose is from yesterday
    await h.reconcile();
    expect(h.fake.live(TWIGGY_TOPIC).filter((m) => m.text.includes('Ear cleaner') && m.text.includes('Rob'))).toHaveLength(1);
    expect(ear.id).toBeGreaterThan(0);
  });

  it('does nothing during quiet hours', async () => {
    h.clock.set('2026-10-10 07:30');
    h.fake.failOnce('send');
    await h.tap(h.fake.one('Twiggy · tap to log'), 'Morning', ROB);
    h.clock.set('2026-10-10 23:00');
    const sends = h.fake.count('send');
    await h.reconcile();
    expect(h.fake.count('send')).toBe(sends);
  });
});

describe('Yes, log again', () => {
  async function promptAt(logAt: string, askAt: string) {
    h.clock.set('2026-10-10 08:00');
    await h.reconcile();
    h.clock.set(logAt);
    await h.tap(h.fake.one('Late after 10:00'), 'All given', ROB);
    h.clock.set(askAt);
    const record = h.fake.one('Given by Rob');
    const m = decodeCallback(record.keyboard[0]![0]!.data);
    if (!m || !('m' in m)) throw new Error('no m');
    return { record, m: m.m };
  }

  it('a plain "now" log uses the time of the confirmation', async () => {
    const { record, m } = await promptAt('2026-10-10 08:10', '2026-10-10 08:15');
    await h.press(record, { t: 'logAll', m }, DANI);
    const prompt = h.fake.one('already given');
    h.clock.set('2026-10-10 08:50');
    await h.tap(prompt, 'Yes', DANI);
    const all = await entries();
    expect(all).toHaveLength(2);
    const again = all.find((e) => e.loggedBy.userId === DANI.userId)!;
    expect(again.givenAt).toEqual(at('2026-10-10 08:50'));
    expect(again.loggedAt).toEqual(at('2026-10-10 08:50'));
  });

  it('an explicitly backdated time stays as chosen', async () => {
    h.clock.set('2026-10-10 08:00');
    await h.reconcile();
    h.clock.set('2026-10-10 08:10');
    const reminder = h.fake.one('Late after 10:00');
    await h.tap(reminder, 'Change', DANI);
    await h.tap(h.fake.one('Eye drops'), 'Given at', DANI);
    await h.tap(h.fake.one('When was it given'), '30 min ago', DANI);
    const panelM = decodeCallback(h.fake.one('Eye drops').keyboard.flat()[0]!.data);
    if (!panelM || !('m' in panelM)) throw new Error('no m');
    h.clock.set('2026-10-10 08:12');
    await h.tap(h.fake.one('Twiggy · tap to log'), 'Morning', ROB); // someone else logs the round meanwhile
    await h.press(reminder, { t: 'save', m: panelM.m }, DANI); // Dani's panel is still open in her client
    const prompt = h.fake.one('already given');
    h.clock.set('2026-10-10 08:50');
    await h.tap(prompt, 'Yes', DANI);
    const all = await entries();
    expect(all).toHaveLength(2);
    const again = all.find((e) => e.loggedBy.userId === DANI.userId)!;
    expect(again.givenAt).toEqual(at('2026-10-10 07:40'));
    expect(again.loggedAt).toEqual(at('2026-10-10 08:50'));
  });
});
