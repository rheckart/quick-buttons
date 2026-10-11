import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buttonLabels } from './helpers/fakeMessenger.js';
import { DANI, GROUP, KID, makeHarness, ROB, seedDayOneMeds, TWIGGY_TOPIC } from './helpers/harness.js';
import type { Harness } from './helpers/harness.js';
import { at } from './domain-fixtures.js';

let h: Harness;
let meds: Awaited<ReturnType<typeof seedDayOneMeds>>;

beforeEach(async () => {
  h = await makeHarness({ now: '2026-10-10 08:00' });
  meds = await seedDayOneMeds(h);
  await h.reconcile();
});
afterEach(() => h.close());

const reminder = () => h.fake.one('Late after 10:00');
const board = () => h.fake.one('Twiggy · tap to log');
const withUndo = () => h.fake.live().filter((m) => m.keyboard.flat().some((b) => b.text.includes('Undo')));
const entries = () => h.repos.entries.listForPet('twiggy', { includeUndone: true });

describe('All given', () => {
  it('logs every pending med, edits the reminder into the record and refreshes the board', async () => {
    h.clock.set('2026-10-10 08:15');
    const res = await h.tap(reminder(), 'All given', ROB);
    expect(res.toast).toContain('Logged');
    const [entry] = await entries();
    expect(entry).toMatchObject({ roundKey: 'morning', forDate: '2026-10-10', loggedBy: ROB });
    expect(entry!.items).toEqual([{ medId: meds.antibiotic.id, status: 'given' }, { medId: meds.eyeDrops.id, status: 'given' }]);
    expect(entry!.recordMessageId).toBe(h.fake.live()[2]!.messageId);
    const record = h.fake.one('Given by Rob at 8:15');
    expect(buttonLabels(record)).toEqual(['✏️ Fix']);
    expect(board().keyboard[0]![0]!.text).toBe('☀️ Morning · ✅ Rob 8:15');
  });

  it('works from the follow-up message too, and deletes the follow-up', async () => {
    h.clock.set('2026-10-10 09:00');
    await h.reconcile();
    await h.tap(h.fake.one('still not given'), 'All given', DANI);
    expect(h.fake.live().filter((m) => m.text.includes('still not given'))).toEqual([]);
    expect(h.fake.one('Given by Danielle')).toBeDefined();
  });

});

describe('logging before the reminder exists', () => {
  it('posts a silent record message that the reminder later reuses', async () => {
    const early = await makeHarness({ now: '2026-10-10 07:30' });
    await seedDayOneMeds(early);
    await early.reconcile();
    const boardMsg = early.fake.one('Twiggy · tap to log');
    await early.svc.handleCallback({ t: 'board', petId: 'twiggy', target: 'morning' }, { from: ROB, chatId: GROUP, messageId: boardMsg.messageId, threadId: TWIGGY_TOPIC });
    const record = early.fake.one('Given by Rob at 7:30');
    expect(record.silent).toBe(true);
    early.clock.set('2026-10-10 08:00');
    const mark = early.fake.mark();
    await early.reconcile();
    expect(early.fake.callsSince(mark).filter((c) => c.op === 'send')).toEqual([]);
    await early.close();
  });
});

describe('the double-dose guard', () => {
  it('a second All given after the round is logged asks first; Cancel deletes the prompt', async () => {
    const stale = reminder();
    const staleKeyboard = stale.keyboard;
    await h.tap(reminder(), 'All given', ROB);
    const record = h.fake.one('Given by Rob');
    const res = await h.press(record, { t: 'logAll', m: Number(staleKeyboard[0]![0]!.data.split(':')[1]) }, DANI);
    expect(res.toast).toBeDefined();
    const prompt = h.fake.one('already given by Rob');
    expect(prompt.silent).toBe(true);
    expect(await entries()).toHaveLength(1);
    await h.tap(prompt, 'Cancel', DANI);
    expect(prompt.deleted).toBe(true);
    expect(await entries()).toHaveLength(1);
  });

  it('Yes logs a second entry, and the prompt goes away', async () => {
    await h.tap(reminder(), 'All given', ROB);
    const record = h.fake.one('Given by Rob');
    await h.press(record, { t: 'logAll', m: Number(record.keyboard[0]![0]!.data.split(':')[1]) }, DANI);
    await h.tap(h.fake.one('already given by Rob'), 'Yes, log again', DANI);
    expect(await entries()).toHaveLength(2);
    expect(h.fake.live().filter((x) => x.text.includes('already given'))).toEqual([]);
    expect(h.fake.one('Given by Danielle')).toBeDefined();
  });

  it('asking twice does not stack prompts', async () => {
    await h.tap(reminder(), 'All given', ROB);
    const record = h.fake.one('Given by Rob');
    const m = Number(record.keyboard[0]![0]!.data.split(':')[1]);
    await h.press(record, { t: 'logAll', m }, DANI);
    const res = await h.press(record, { t: 'logAll', m }, KID);
    expect(res.toast).toContain('Already asking');
    expect(h.fake.live().filter((x) => x.text.includes('already given'))).toHaveLength(1);
  });

  it('an answered prompt cannot be used twice', async () => {
    await h.tap(reminder(), 'All given', ROB);
    const record = h.fake.one('Given by Rob');
    const m = Number(record.keyboard[0]![0]!.data.split(':')[1]);
    await h.press(record, { t: 'logAll', m }, DANI);
    const prompt = h.fake.one('already given');
    const yes = prompt.keyboard[0]![0]!;
    await h.tap(prompt, 'Yes', DANI);
    const again = await h.svc.handleCallback({ t: 'dd', m: Number(yes.data.split(':')[1]), yes: true }, { from: DANI, chatId: GROUP, messageId: prompt.messageId, threadId: TWIGGY_TOPIC });
    expect(again.toast).toBe('That button is out of date');
    expect(await entries()).toHaveLength(2);
  });
});

describe('the Change panel', () => {
  async function openPanel() {
    await h.tap(reminder(), 'Change');
    return h.fake.one('Eye drops');
  }

  it('opens in place with every pending med ticked', async () => {
    const panel = await openPanel();
    expect(panel.text).toContain('✅ Antibiotic');
    expect(panel.text).toContain('✅ Eye drops');
    expect(buttonLabels(panel)).toContain('✅ Log these');
  });

  it('unticking a med logs a partial round with a log-the-rest button', async () => {
    const panel = await openPanel();
    await h.setMed(panel, 1, 'pending');
    await h.tap(panel, 'Log these');
    const record = h.fake.one('Given by Rob');
    expect(record.text).toContain('⏳ Still to give: Eye drops');
    expect(buttonLabels(record)).toEqual(['✅ Log the rest', '✏️ Fix']);
    expect(board().keyboard[0]![0]!.text).toBe('☀️ Morning · ◐ Eye drops left');
    expect((await entries())[0]!.items).toEqual([{ medId: meds.antibiotic.id, status: 'given' }]);
  });

  it('Log the rest adds a second entry and completes the round', async () => {
    const panel = await openPanel();
    await h.setMed(panel, 1, 'pending');
    await h.tap(panel, 'Log these');
    h.clock.advance(5);
    await h.tap(h.fake.one('Still to give'), 'Log the rest', DANI);
    expect(await entries()).toHaveLength(2);
    const record = h.fake.one('Given by Danielle');
    expect(record.text).not.toContain('Still to give');
    expect(record.text).toContain('Antibiotic, Eye drops');
  });

  it('skipped meds count as done and show as skipped', async () => {
    const panel = await openPanel();
    await h.setMed(panel, 0, 'skipped');
    await h.tap(panel, 'Log these');
    const record = h.fake.one('Given by Rob');
    expect(record.text).toContain('⏭ Skipped: Antibiotic');
    expect(board().keyboard[0]![0]!.text).toBe('☀️ Morning · ✅ Rob 8:00');
  });

  it('Back discards the panel and restores the reminder', async () => {
    const panel = await openPanel();
    await h.setMed(panel, 1, 'pending');
    await h.tap(panel, 'Back');
    expect(buttonLabels(reminder())).toEqual(['✅ All given', '⚙️ Change…']);
    expect(await entries()).toHaveLength(0);
  });

  it('saving with nothing ticked is refused', async () => {
    const panel = await openPanel();
    await h.setMed(panel, 0, 'pending');
    await h.setMed(panel, 1, 'pending');
    const res = await h.tap(panel, 'Log these');
    expect(res.alert).toBe(true);
    expect(await entries()).toHaveLength(0);
  });

  it('backdating records the given time and shows when it was logged', async () => {
    h.clock.set('2026-10-10 08:40');
    const panel = await openPanel();
    await h.tap(panel, 'Given at');
    await h.tap(h.fake.one('When was it given'), '30 min ago');
    expect(h.fake.one('Eye drops').keyboard.flat().some((b) => b.text.startsWith('🕐 Given at 8:10'))).toBe(true);
    await h.tap(h.fake.one('Eye drops'), 'Log these');
    const [entry] = await entries();
    expect(entry!.givenAt).toEqual(at('2026-10-10 08:10'));
    expect(entry!.loggedAt).toEqual(at('2026-10-10 08:40'));
    expect(h.fake.one('Given by Rob').text).toContain('Given by Rob at 8:10 (logged 8:40)');
  });

  it('a log after late-after says Given late', async () => {
    h.clock.set('2026-10-10 10:30');
    await h.reconcile();
    await h.tap(reminder(), 'All given');
    expect(h.fake.one('Given late by Rob at 10:30')).toBeDefined();
  });
});

describe('typed times', () => {
  async function askForTime() {
    h.clock.set('2026-10-10 08:40');
    await h.tap(reminder(), 'Change');
    await h.tap(h.fake.one('Eye drops'), 'Given at');
    await h.tap(h.fake.one('When was it given'), 'Type a time');
    return h.fake.live().find((m) => m.forceReply)!;
  }

  it('accepts a reply to the prompt from the same user, deletes the prompt and updates the panel', async () => {
    const prompt = await askForTime();
    const res = await h.typeReply(prompt.messageId, '8:05');
    expect(res).toEqual({ handled: true });
    expect(prompt.deleted).toBe(true);
    expect(h.fake.one('Eye drops').keyboard.flat().some((b) => b.text.startsWith('🕐 Given at 8:05'))).toBe(true);
    await h.tap(h.fake.one('Eye drops'), 'Log these');
    expect((await entries())[0]!.givenAt).toEqual(at('2026-10-10 08:05'));
  });

  it('asks again for unreadable or future times and keeps the prompt', async () => {
    const prompt = await askForTime();
    expect((await h.typeReply(prompt.messageId, 'banana')).reply).toContain("couldn't read");
    expect((await h.typeReply(prompt.messageId, '11pm')).reply).toContain("hasn't happened");
    expect(prompt.deleted).toBe(false);
    expect((await h.typeReply(prompt.messageId, '8:05')).handled).toBe(true);
  });

  it('ignores other users and other messages', async () => {
    const prompt = await askForTime();
    expect(await h.typeReply(prompt.messageId, '8:05', DANI)).toEqual({ handled: false });
    expect(await h.svc.handleTypedTime({ from: ROB, chatId: GROUP, replyToMessageId: 99999, text: '8:05' })).toEqual({ handled: false });
    expect(prompt.deleted).toBe(false);
  });
});

describe('fixing', () => {
  beforeEach(async () => {
    h.clock.set('2026-10-10 08:15');
    await h.tap(reminder(), 'All given', ROB);
  });

  it('Fix edits quietly: no new messages, shows who edited', async () => {
    await h.tap(h.fake.one('Given by Rob'), 'Fix', DANI);
    const sends = h.fake.count('send');
    const panel = h.fake.one('Eye drops');
    expect(buttonLabels(panel)).toContain('🗑 Undo');
    await h.setMed(panel, 0, 'skipped', DANI);
    await h.tap(panel, 'Save', DANI);
    expect(h.fake.count('send')).toBe(sends);
    const record = h.fake.one('Given by Rob');
    expect(record.text).toContain('✏️ edited by Danielle');
    expect(record.text).toContain('⏭ Skipped: Antibiotic');
  });

  it('keeps old versions', async () => {
    await h.tap(h.fake.one('Given by Rob'), 'Fix', DANI);
    await h.tap(h.fake.one('Eye drops'), 'Undo', DANI);
    const [entry] = await entries();
    expect((await h.repos.entries.revisions(entry!.id)).map((r) => r.kind)).toEqual(['create', 'undo']);
  });

  it('Undo brings back the reminder and resumes follow-ups and LATE', async () => {
    h.clock.set('2026-10-10 09:05');
    await h.reconcile();
    expect(h.fake.live().filter((m) => m.text.includes('still not given'))).toEqual([]);
    await h.tap(h.fake.one('Given by Rob'), 'Fix', DANI);
    await h.tap(h.fake.one('Eye drops'), 'Undo', DANI);
    const back = h.fake.one('Late after 10:00');
    expect(back.text).toContain('↩️ Undone by Danielle');
    expect(buttonLabels(back)).toEqual(['✅ All given', '⚙️ Change…']);
    expect(board().keyboard[0]![0]!.text).toBe('☀️ Morning · ⏳ due 8:00');
    await h.reconcile();
    expect(h.fake.one('still not given').text).toContain('tg://user?id=1');
    h.clock.set('2026-10-10 10:00');
    await h.reconcile();
    expect(h.fake.one('Late after 10:00').text).toContain('⚠️ LATE');
    expect(board().keyboard[0]![0]!.text).toBe('☀️ Morning · ⚠️ LATE');
  });

  it('after a partial log + log-the-rest, Undo clears both entries', async () => {
    await h.tap(h.fake.one('Given by Rob'), 'Fix', ROB);
    await h.tap(h.fake.one('Eye drops'), 'Undo', ROB);
    h.clock.advance(1);
    await h.tap(h.fake.one('Late after'), 'Change', ROB);
    await h.setMed(h.fake.one('Eye drops'), 1, 'pending', ROB);
    await h.tap(h.fake.one('Eye drops'), 'Log these', ROB);
    h.clock.advance(1);
    await h.tap(h.fake.one('Still to give'), 'Log the rest', DANI);
    await h.tap(h.fake.one('Given by Danielle'), 'Fix', ROB);
    await h.tap(h.fake.one('Eye drops'), 'Undo', ROB);
    expect(h.fake.one('Late after').text).toContain('Antibiotic + Eye drops');
    expect((await entries()).every((e) => e.undone)).toBe(true);
  });

  it('a non-admin cannot fix after the next reminder; an admin can', async () => {
    h.clock.set('2026-10-11 08:05');
    await h.reconcile();
    const record = h.fake.live().find((m) => m.text.includes('Given by Rob'))!;
    const refused = await h.tap(record, 'Fix', KID);
    expect(refused.alert).toBe(true);
    expect(refused.toast).toContain('only admins');
    expect(h.fake.live().filter((m) => m.text.includes('When was it given') || m.text.includes('🗑'))).toEqual([]);
    expect((await h.tap(record, 'Fix', DANI)).toast).toBeUndefined();
    expect(buttonLabels(withUndo()[0]!)).toContain('🗑 Undo');
  });

  it('refuses a save when the deadline passes while the panel is open', async () => {
    h.clock.set('2026-10-11 07:50');
    await h.tap(h.fake.one('Given by Rob'), 'Fix', KID);
    h.clock.set('2026-10-11 08:01');
    const res = await h.tap(withUndo()[0]!, 'Undo', KID);
    expect(res.alert).toBe(true);
    expect((await entries())[0]!.undone).toBe(false);
  });
});

describe('the board', () => {
  const tapBoard = (target: string, who = ROB, chatId = GROUP) =>
    h.svc.handleCallback({ t: 'board', petId: 'twiggy', target }, { from: who, chatId, messageId: board().messageId, threadId: TWIGGY_TOPIC });

  it('logs the pending meds of an unlogged round in one tap', async () => {
    await tapBoard('morning');
    expect((await entries())[0]!.items).toHaveLength(2);
    expect(h.fake.one('Given by Rob')).toBeDefined();
  });

  it('tapping a logged round opens a separate Fix panel that is deleted when closed', async () => {
    await tapBoard('morning');
    await tapBoard('morning', DANI);
    const panel = withUndo()[0]!;
    expect(panel.text).toContain('<b>');
    expect(buttonLabels(panel)).toContain('🗑 Undo');
    expect(panel.silent).toBe(true);
    await tapBoard('morning', KID);
    expect(withUndo()).toHaveLength(1);
    await h.tap(panel, 'Back');
    expect(panel.deleted).toBe(true);
    expect(h.fake.one('Given by Rob')).toBeDefined();
  });

  it('a partially logged round logs what is left', async () => {
    await h.tap(reminder(), 'Change');
    await h.setMed(h.fake.one('Eye drops'), 1, 'pending');
    await h.tap(h.fake.one('Eye drops'), 'Log these');
    await tapBoard('morning', DANI);
    expect((await entries())).toHaveLength(2);
    expect(board().keyboard[0]![0]!.text).toContain('✅');
  });

  it('is refused from another chat and for unknown pets or rounds', async () => {
    expect((await tapBoard('morning', ROB, -999)).alert).toBe(true);
    expect((await tapBoard('lunch')).toast).toBe('That button is out of date');
    expect((await h.svc.handleCallback({ t: 'board', petId: 'rex', target: 'morning' }, { from: ROB, chatId: GROUP, messageId: 1, threadId: null })).toast).toBe('That button is out of date');
    expect(await entries()).toHaveLength(0);
  });
});

describe('callback safety', () => {
  it('ignores buttons of deleted or unknown messages', async () => {
    const res = await h.svc.handleCallback({ t: 'logAll', m: 9999 }, { from: ROB, chatId: GROUP, messageId: 1, threadId: null });
    expect(res.toast).toBe('That button is out of date');
  });

  it('ignores a button on a message the bot has deleted', async () => {
    h.clock.set('2026-10-10 09:00');
    await h.reconcile();
    const followup = h.fake.one('still not given');
    await h.tap(reminder(), 'All given');
    expect(followup.deleted).toBe(true);
    const res = await h.press(followup, { t: 'logAll', m: Number(followup.keyboard[0]![0]!.data.split(':')[1]) });
    expect(res.toast).toBe('That button is out of date');
    expect(await entries()).toHaveLength(1);
  });

  it('refuses a callback arriving from a different chat than the message lives in', async () => {
    const rem = reminder();
    const res = await h.press(rem, { t: 'logAll', m: Number(rem.keyboard[0]![0]!.data.split(':')[1]) }, ROB, -555);
    expect(res.alert).toBe(true);
    expect(await entries()).toHaveLength(0);
  });

  it('admin callbacks are not the service\'s business', async () => {
    expect(await h.svc.handleCallback({ t: 'admin', a: 'menu' }, { from: ROB, chatId: 1, messageId: 1, threadId: null })).toEqual({});
  });

  it('expires a stale panel: state is dropped and the message restored', async () => {
    await h.tap(reminder(), 'Change');
    const panel = h.fake.one('Eye drops');
    h.clock.advance(20);
    await h.reconcile();
    expect(buttonLabels(h.fake.one('Late after 10:00')).includes('✅ All given')).toBe(true);
    const res = await h.press(panel, { t: 'save', m: Number(panel.keyboard.flat()[0]!.data.split(':')[1]) });
    expect(res.toast).toContain('expired');
    expect(await entries()).toHaveLength(0);
  });
});

describe('Telegram failures after the DB write', () => {
  it('keeps the log, answers normally, and heals on the next tick', async () => {
    h.fake.failOn('edit', 'send', 'delete');
    h.clock.set('2026-10-10 08:20');
    const res = await h.tap(reminder(), 'All given');
    expect(res.toast).toBe('Logged ✅');
    expect(await entries()).toHaveLength(1);
    expect(reminder().text).toContain('Late after');
    h.fake.stopFailing();
    await h.reconcile();
    expect(h.fake.one('Given by Rob at 8:20')).toBeDefined();
    expect(board().keyboard[0]![0]!.text).toBe('☀️ Morning · ✅ Rob 8:20');
  });

  it('a failed follow-up delete is retried', async () => {
    h.clock.set('2026-10-10 09:00');
    await h.reconcile();
    const followup = h.fake.one('still not given');
    h.fake.failOn('delete');
    await h.tap(reminder(), 'All given');
    expect(followup.deleted).toBe(false);
    h.fake.stopFailing();
    await h.reconcile();
    expect(followup.deleted).toBe(true);
  });
});

describe('a course without a start date', () => {
  it('moves its start when the first dose is undone, so it runs a day longer', async () => {
    const own = await makeHarness({ now: '2026-10-09 08:00' });
    await own.addMed({ petId: 'twiggy', name: 'Antibiotic', kind: 'course', roundKeys: ['morning'], days: 2 });
    await own.addMed({ petId: 'twiggy', name: 'Eye drops', kind: 'ongoing', roundKeys: ['morning'] });
    for (const day of ['2026-10-09', '2026-10-10']) {
      own.clock.set(`${day} 08:00`);
      await own.reconcile();
      await own.tap(own.fake.live().filter((m) => m.text.includes('Late after 10:00')).at(-1)!, 'All given', ROB);
    }
    own.clock.set('2026-10-11 08:00');
    await own.reconcile();
    expect(own.fake.live().filter((m) => m.text.includes('Twiggy morning: Eye drops'))).toHaveLength(1);
    expect(own.fake.live().filter((m) => m.text.includes('Antibiotic course finished'))).toHaveLength(1);

    own.clock.set('2026-10-11 08:05');
    const [, firstDose] = (await own.svc.listPastEntries('twiggy')).map((e) => e.entry);
    expect(firstDose!.forDate).toBe('2026-10-09');
    await own.svc.openFixPanel(firstDose!.id, 777, null, ROB);
    await own.tap(own.fake.live().find((m) => m.chatId === 777)!, 'Undo', ROB);
    await own.reconcile();
    expect(own.fake.live().filter((m) => m.text.includes('Twiggy morning: Antibiotic + Eye drops'))).toHaveLength(1);
    await own.close();
  });
});
