import { afterEach, describe, expect, it } from 'vitest';
import { buttonLabels } from './helpers/fakeMessenger.js';
import type { FakeMessage } from './helpers/fakeMessenger.js';
import { DANI, e2eSettings, FAITH_TOPIC, GROUP, KID, makeHarness, ROB, seedDayOneMeds, TWIGGY_TOPIC } from './helpers/harness.js';
import type { Harness } from './helpers/harness.js';
import { decodeCallback } from '../src/render/index.js';
import type { Settings } from '../src/types.js';

let h: Harness;
afterEach(() => h.close());

async function start(now: string, settings: Settings = e2eSettings, seed: Parameters<typeof seedDayOneMeds>[1] = {}) {
  h = await makeHarness({ now, settings });
  const meds = await seedDayOneMeds(h, seed);
  return meds;
}

const board = (thread = TWIGGY_TOPIC) => h.fake.live(thread).find((m) => m.text.includes('tap to log'))!;
const boardLabels = (thread = TWIGGY_TOPIC) => buttonLabels(board(thread));
const liveWith = (text: string, thread = TWIGGY_TOPIC) => h.fake.live(thread).filter((m) => m.text.includes(text));
const panelOf = () => h.fake.live().find((m) => m.keyboard.flat().some((b) => b.text.includes('Log these') || b.text.includes('Save')))!;
const mOf = (msg: FakeMessage): number => {
  const cb = decodeCallback(msg.keyboard.flat()[0]!.data);
  if (!cb || !('m' in cb)) throw new Error('no m');
  return cb.m;
};

describe('one realistic day (Sat 10 Oct 2026, America/New_York)', () => {
  it('walks morning and evening rounds through logs, fixes and undo', async () => {
    await start('2026-10-10 06:00');
    await h.reconcile();
    expect(boardLabels()).toEqual(['☀️ Morning · 🔜 8:00', '🌙 Evening · 🔜 18:00', '📅 Simparica · due Wed 14 Oct']);
    expect(h.fake.live().filter((m) => m.pinned)).toHaveLength(2);

    // 8:00 reminder, nobody mentioned
    h.clock.set('2026-10-10 08:00');
    await h.reconcile();
    const morning = liveWith('Twiggy morning')[0]!;
    expect(morning.text).toBe(
      '☀️ Twiggy morning: Antibiotic + Eye drops\n• Antibiotic: 1 tablet\n• Eye drops: 2 drops each eye\nLate after 10:00',
    );
    expect(morning.text).not.toContain('tg://user');
    expect(morning.silent).toBe(false);
    expect(boardLabels()[0]).toBe('☀️ Morning · ⏳ due 8:00');

    // 8:30 Rob logs a partial round: eye drops unticked
    h.clock.set('2026-10-10 08:30');
    await h.tap(morning, 'Change');
    await h.setMed(morning, 1, 'pending');
    await h.tap(morning, 'Log these');
    expect(morning.text).toBe('✅ Given by Rob at 8:30\n☀️ Twiggy morning: Antibiotic\n⏳ Still to give: Eye drops');
    expect(buttonLabels(morning)).toEqual(['✅ Log the rest', '✏️ Fix']);
    expect(boardLabels()[0]).toBe('☀️ Morning · ◐ Eye drops left');

    // 9:00 follow-up mentions both givers and lists only what is left
    h.clock.set('2026-10-10 09:00');
    await h.reconcile();
    const followup = liveWith('still not given')[0]!;
    expect(followup.text).toBe(
      '⏰ <a href="tg://user?id=1">Rob</a> <a href="tg://user?id=2">Danielle</a>\nTwiggy morning: Eye drops still not given (late at 10:00)',
    );

    // 9:10 Danielle logs the rest from the follow-up: reminder is the record, follow-up gone
    h.clock.set('2026-10-10 09:10');
    await h.tap(followup, 'All given', DANI);
    expect(followup.deleted).toBe(true);
    expect(morning.text).toBe('✅ Given by Danielle at 9:10\n☀️ Twiggy morning: Antibiotic, Eye drops');
    expect(boardLabels()[0]).toBe('☀️ Morning · ✅ Danielle 9:10');

    // 10:00 passes: a finished round is never marked LATE
    h.clock.set('2026-10-10 10:00');
    await h.reconcile();
    expect(morning.text).not.toContain('LATE');
    expect(boardLabels()[0]).toBe('☀️ Morning · ✅ Danielle 9:10');

    // 18:00 evening reminder
    h.clock.set('2026-10-10 18:00');
    await h.reconcile();
    const evening = liveWith('Twiggy evening')[0]!;
    expect(evening.text).toBe('🌙 Twiggy evening: Antibiotic + Allergy\n• Antibiotic: 1 tablet\nLate after 20:00');
    const oldAllGiven = mOf(evening);

    // 18:20 backdated, with the allergy med skipped
    h.clock.set('2026-10-10 18:20');
    await h.tap(evening, 'Change');
    await h.setMed(evening, 1, 'skipped');
    await h.tap(evening, 'Given at');
    await h.tap(evening, '15 min ago');
    expect(evening.keyboard.flat().some((b) => b.text.startsWith('🕐 Given at 18:05'))).toBe(true);
    await h.tap(evening, 'Log these');
    expect(evening.text).toBe('✅ Given by Rob at 18:05 (logged 18:20)\n🌙 Twiggy evening: Antibiotic\n⏭ Skipped: Allergy');
    expect(boardLabels()[1]).toBe('🌙 Evening · ✅ Rob 18:05');

    // Danielle taps a stale "All given": the double-dose guard asks, Cancel removes the prompt
    h.clock.set('2026-10-10 18:25');
    await h.press(evening, { t: 'logAll', m: oldAllGiven }, DANI);
    const prompt = liveWith('Log it again?')[0]!;
    expect(prompt.text).toBe('⚠️ Twiggy evening was already given by Rob at 18:05. Log it again?');
    await h.tap(prompt, 'Cancel', DANI);
    expect(prompt.deleted).toBe(true);
    expect(await h.repos.entries.listForPet('twiggy')).toHaveLength(3);

    // 18:30 Danielle fixes it: allergy was actually given. Quiet edit, no new message.
    h.clock.set('2026-10-10 18:30');
    const sends = h.fake.count('send');
    await h.tap(evening, 'Fix', DANI);
    await h.setMed(evening, 1, 'given', DANI);
    await h.tap(evening, 'Save', DANI);
    expect(h.fake.count('send')).toBe(sends);
    expect(evening.text).toBe('✅ Given by Rob at 18:05 (logged 18:20)\n🌙 Twiggy evening: Antibiotic, Allergy\n✏️ edited by Danielle');

    // 19:05 Rob undoes it: reminder form is back, follow-up resumes, LATE at 20:00
    h.clock.set('2026-10-10 19:05');
    await h.tap(evening, 'Fix', ROB);
    await h.tap(evening, 'Undo', ROB);
    expect(evening.text).toBe(
      '🌙 Twiggy evening: Antibiotic + Allergy\n• Antibiotic: 1 tablet\nLate after 20:00\n↩️ Undone by Rob',
    );
    expect(buttonLabels(evening)).toEqual(['✅ All given', '⚙️ Change…']);
    expect(boardLabels()[1]).toBe('🌙 Evening · ⏳ due 18:00');
    await h.reconcile();
    const eveningFollowup = liveWith('still not given')[0]!;
    expect(eveningFollowup.text).toContain('Twiggy evening: Antibiotic, Allergy still not given');
    h.clock.set('2026-10-10 20:00');
    await h.reconcile();
    expect(evening.text).toContain('⚠️ LATE');
    expect(boardLabels()[1]).toBe('🌙 Evening · ⚠️ LATE');
    const afterLate = h.fake.mark();
    h.clock.set('2026-10-10 20:30');
    await h.reconcile();
    expect(h.fake.callsSince(afterLate).filter((c) => c.op === 'send')).toEqual([]);

    // 20:30 given late
    await h.tap(eveningFollowup, 'All given', ROB);
    expect(evening.text).toBe('✅ Given late by Rob at 20:30\n🌙 Twiggy evening: Antibiotic, Allergy');
    expect(eveningFollowup.deleted).toBe(true);
    expect(boardLabels()[1]).toBe('🌙 Evening · ✅ Rob 20:30');
    expect(h.logger.warnings).toEqual([]);
  });

  it('is idempotent: reconcile twice, and a restarted service, make no new Telegram calls', async () => {
    await start('2026-10-10 06:00');
    for (const t of ['06:00', '08:00', '09:00', '10:00', '18:00']) {
      h.clock.set(`2026-10-10 ${t}`);
      await h.reconcile();
    }
    const first = h.fake.mark();
    await h.reconcile();
    await h.reconcile();
    expect(h.fake.callsSince(first)).toEqual([]);
    const restarted = h.fake.mark();
    await h.restart().reconcile();
    expect(h.fake.callsSince(restarted)).toEqual([]);
    // and still correct after the restart: a tap on the old message works
    await h.tap(liveWith('Twiggy morning')[0]!, 'All given');
    expect(liveWith('Given late')).toHaveLength(1);
  });
});

describe('undoing a morning log', () => {
  it('brings the reminder back, resumes the follow-up, and goes LATE at 10:00 via reconcile', async () => {
    await start('2026-10-10 08:00');
    await h.reconcile();
    const reminder = liveWith('Twiggy morning')[0]!;
    h.clock.set('2026-10-10 08:30');
    await h.tap(reminder, 'All given', ROB);
    h.clock.set('2026-10-10 09:05');
    await h.reconcile();
    expect(liveWith('still not given')).toEqual([]);
    h.clock.set('2026-10-10 09:15');
    await h.tap(reminder, 'Fix', DANI);
    await h.tap(panelOf(), 'Undo', DANI);
    expect(buttonLabels(reminder)).toEqual(['✅ All given', '⚙️ Change…']);
    expect(boardLabels()[0]).toBe('☀️ Morning · ⏳ due 8:00');
    await h.reconcile();
    expect(liveWith('still not given')).toHaveLength(1);
    h.clock.set('2026-10-10 10:00');
    await h.reconcile();
    expect(reminder.text).toContain('⚠️ LATE');
    expect(boardLabels()[0]).toBe('☀️ Morning · ⚠️ LATE');
  });
});

describe('monthly meds', () => {
  it('reminds on the due morning, nudges in the evening, is LATE next morning, then stays quiet; undo restores the date', async () => {
    await start('2026-10-10 06:00', e2eSettings, { faithSimparica: '2026-09-10' });
    await h.reconcile();
    expect(boardLabels(FAITH_TOPIC)).toEqual(['📅 Simparica · due Sat 10 Oct']);

    h.clock.set('2026-10-10 08:59');
    await h.reconcile();
    expect(liveWith('Simparica', FAITH_TOPIC).filter((m) => !m.text.includes('tap to log'))).toEqual([]);
    h.clock.set('2026-10-10 09:00');
    await h.reconcile();
    const reminder = liveWith('Faith: Simparica is due today', FAITH_TOPIC)[0]!;
    expect(reminder.text).toBe('📅 Faith: Simparica is due today');
    expect(reminder.text).not.toContain('tg://user');

    h.clock.set('2026-10-10 18:00');
    await h.reconcile();
    const nudge = liveWith('still not given today', FAITH_TOPIC)[0]!;
    expect(nudge.text).toBe('🔔 📅 Faith: Simparica still not given today');

    h.clock.set('2026-10-11 07:30');
    await h.reconcile();
    expect(nudge.deleted).toBe(true);
    expect(reminder.text).toBe('⚠️ LATE · 📅 Faith: Simparica was due Sat 10 Oct');
    expect(boardLabels(FAITH_TOPIC)).toEqual(['📅 Simparica · ⚠️ LATE']);
    for (const t of ['2026-10-11 18:00', '2026-10-12 09:00', '2026-10-12 18:00']) {
      h.clock.set(t);
      await h.reconcile();
    }
    expect(liveWith('Simparica', FAITH_TOPIC).filter((m) => !m.text.includes('tap to log'))).toHaveLength(1);

    // logged late on the 12th: due date moves a month on from the dose; undo brings the old date back
    h.clock.set('2026-10-12 19:00');
    await h.tap(reminder, 'Given', DANI);
    expect(reminder.text).toBe('✅ Given by Danielle at 19:00\n📅 Faith: Simparica');
    expect(boardLabels(FAITH_TOPIC)).toEqual(['📅 Simparica · ✅ Danielle 12 Oct']);
    await h.tap(reminder, 'Fix', ROB);
    await h.tap(panelOf(), 'Undo', ROB);
    expect(boardLabels(FAITH_TOPIC)).toEqual(['📅 Simparica · ⚠️ LATE']);
    expect(reminder.text).toContain('↩️ Undone by Rob');
    expect(buttonLabels(reminder)).toEqual(['✅ Given']);
  });
});

describe('course finished', () => {
  it('a 10-day course from 1 Oct ends on the 10th; the notice goes out on the 11th, once', async () => {
    await start('2026-10-10 06:00');
    h.clock.set('2026-10-10 18:00');
    await h.reconcile();
    expect(liveWith('Twiggy evening')[0]!.text).toContain('Antibiotic');
    expect(liveWith('finished')).toEqual([]);

    h.clock.set('2026-10-11 07:59');
    await h.reconcile();
    expect(liveWith('finished')).toEqual([]);
    h.clock.set('2026-10-11 08:00');
    await h.reconcile();
    expect(liveWith('Antibiotic course finished 🎉')).toHaveLength(1);
    expect(liveWith('Twiggy morning')[0]!.text).toBe('☀️ Twiggy morning: Eye drops\n• Eye drops: 2 drops each eye\nLate after 10:00');
    for (const t of ['2026-10-11 12:00', '2026-10-12 08:00', '2026-10-13 08:00']) {
      h.clock.set(t);
      await h.reconcile();
    }
    expect(h.fake.messages.filter((m) => m.text.includes('course finished'))).toHaveLength(1);
  });
});

describe('quiet hours', () => {
  const early: Settings = {
    ...e2eSettings,
    pets: e2eSettings.pets.map((p) =>
      p.id === 'twiggy' ? { ...p, rounds: [{ key: 'morning', name: 'Morning', emoji: '☀️', due: '06:00', lateAfter: '09:00' }, ...p.rounds.slice(1)] } : p,
    ),
  };

  it('holds reminders due in the night until 07:00, then sends the follow-up that is due too', async () => {
    await start('2026-10-10 05:00', early);
    await h.reconcile();
    const mark = h.fake.mark();
    for (const t of ['06:00', '06:30', '06:59']) {
      h.clock.set(`2026-10-10 ${t}`);
      await h.reconcile();
    }
    expect(h.fake.callsSince(mark)).toEqual([]);
    h.clock.set('2026-10-10 07:00');
    await h.reconcile();
    expect(liveWith('Twiggy morning').map((m) => m.text.split('\n')[0])).toEqual(['☀️ Twiggy morning: Antibiotic + Eye drops']);
    h.clock.set('2026-10-10 07:30');
    await h.reconcile();
    expect(liveWith('still not given')).toHaveLength(1);
  });

  it('does nothing between 22:00 and 07:00 except deleting follow-ups, but taps still work at once', async () => {
    await start('2026-10-10 18:00');
    await h.reconcile();
    h.clock.set('2026-10-10 19:00');
    await h.reconcile();
    expect(liveWith('still not given')).toHaveLength(1);
    h.clock.set('2026-10-10 22:30');
    const mark = h.fake.mark();
    await h.reconcile();
    expect(h.fake.callsSince(mark)).toEqual([]);
    // a tap at night refreshes the pet's messages immediately and removes the follow-up
    await h.tap(liveWith('Twiggy evening')[0]!, 'All given', KID);
    expect(liveWith('still not given')).toEqual([]);
    expect(boardLabels()[1]).toBe('🌙 Evening · ✅ Kid 22:30');
    expect(liveWith('by Kid at 22:30')).toHaveLength(1);
  });
});

describe('who may fix', () => {
  it('a non-admin is refused after the next reminder; an admin is allowed', async () => {
    await start('2026-10-10 08:00');
    await h.reconcile();
    const reminder = liveWith('Twiggy morning')[0]!;
    h.clock.set('2026-10-10 08:10');
    await h.tap(reminder, 'All given', ROB);
    h.clock.set('2026-10-10 20:00');
    expect((await h.tap(reminder, 'Fix', KID)).toast).toBeUndefined(); // still before tomorrow's reminder
    await h.tap(panelOf(), 'Back', KID);
    h.clock.set('2026-10-11 08:00');
    await h.reconcile();
    const refused = await h.tap(reminder, 'Fix', KID);
    expect(refused).toMatchObject({ alert: true });
    expect(refused.toast).toContain('only admins');
    expect(h.fake.live().filter((m) => m.keyboard.flat().some((b) => b.text.includes('Undo')))).toEqual([]);
    expect((await h.tap(reminder, 'Fix', DANI)).toast).toBeUndefined();
    await h.tap(panelOf(), 'Undo', DANI);
    expect(reminder.text).toContain('↩️ Undone by Danielle');
  });
});

describe('a late start', () => {
  it('at 11:00 sends no stale reminder or follow-up, but the board shows LATE', async () => {
    await start('2026-10-10 11:00');
    await h.reconcile();
    expect(liveWith('Twiggy morning')).toEqual([]);
    expect(boardLabels()[0]).toBe('☀️ Morning · ⚠️ LATE');
    await h.tap(board(), 'LATE');
    expect(liveWith('Given late by Rob at 11:00').length + liveWith('Given by Rob at 11:00').length).toBe(1);
    expect(boardLabels()[0]).toBe('☀️ Morning · ✅ Rob 11:00');
  });
});

describe('refusals', () => {
  it('buttons used from the wrong chat do nothing', async () => {
    await start('2026-10-10 08:00');
    await h.reconcile();
    const reminder = liveWith('Twiggy morning')[0]!;
    const res = await h.press(reminder, { t: 'logAll', m: mOf(reminder) }, ROB, -42);
    expect(res.alert).toBe(true);
    const board1 = await h.svc.handleCallback({ t: 'board', petId: 'twiggy', target: 'morning' }, { from: ROB, chatId: 555, messageId: 1, threadId: null });
    expect(board1.alert).toBe(true);
    expect(await h.repos.entries.listForPet('twiggy')).toEqual([]);
    expect(buttonLabels(reminder)).toEqual(['✅ All given', '⚙️ Change…']);
  });

  it('a private chat cannot drive group messages, and non-admins cannot drive admin panels', async () => {
    await start('2026-10-10 08:00');
    await h.reconcile();
    await h.tap(liveWith('Twiggy morning')[0]!, 'All given');
    const [{ entry }] = await h.svc.listPastEntries('twiggy');
    await h.svc.openFixPanel(entry.id, 777, null, ROB);
    const panel = h.fake.live().find((m) => m.chatId === 777)!;
    expect((await h.tap(panel, 'Undo', KID)).alert).toBe(true);
    const inGroup = await h.press(panel, { t: 'undo', m: mOf(panel) }, ROB, GROUP);
    expect(inGroup.alert).toBe(true);
    expect((await h.repos.entries.get(entry.id))!.undone).toBe(false);
  });

  it('a stale panel expires after 15 minutes and its buttons stop working', async () => {
    await start('2026-10-10 08:00');
    await h.reconcile();
    const reminder = liveWith('Twiggy morning')[0]!;
    await h.tap(reminder, 'Change');
    expect(reminder.text).toContain('<b>');
    // still open at 14 minutes: reconcile leaves it alone
    h.clock.advance(14);
    await h.reconcile();
    expect(reminder.text).toContain('<b>');
    h.clock.advance(2);
    await h.reconcile();
    expect(buttonLabels(reminder)).toEqual(['✅ All given', '⚙️ Change…']);
    const late = await h.press(reminder, { t: 'save', m: mOf(reminder) });
    expect(late.toast).toBe('That panel expired. Open it again.');
    expect(await h.repos.entries.listForPet('twiggy')).toEqual([]);

    // the same for a Fix panel posted as its own message: it is deleted
    await h.tap(reminder, 'All given');
    await h.tap(board(), 'Morning');
    const own = h.fake.live().find((m) => m.keyboard.flat().some((b) => b.text.includes('Undo')))!;
    h.clock.advance(20);
    await h.reconcile();
    expect(own.deleted).toBe(true);
  });
});

describe('hostile text', () => {
  it('is HTML-escaped in announcements, reminders, follow-ups, records, boards and the panel', async () => {
    await start('2026-10-10 07:00');
    const evil = '<a href="x">Evil</a> & <b>';
    await h.svc.startMed({ petId: 'twiggy', name: evil, kind: 'ongoing', roundKeys: ['morning'], doseNote: '<i>2</i> drops' }, ROB);
    for (const t of ['08:00', '09:00']) {
      h.clock.set(`2026-10-10 ${t}`);
      await h.reconcile();
    }
    await h.tap(liveWith('Twiggy morning')[0]!, 'Change');
    const everything = h.fake.live().map((m) => m.text).join('\n');
    expect(everything).not.toContain('<a href="x">');
    expect(everything).not.toContain('<i>2</i>');
    expect(everything).toContain('&lt;a href="x"&gt;Evil&lt;/a&gt; &amp; &lt;b&gt;');
    expect(h.fake.live().filter((m) => m.text.includes('tg://user'))).toHaveLength(1);
  });
});

describe('daylight saving (Sun 1 Nov 2026, clocks go back at 02:00)', () => {
  it('sends the 08:00 reminder at 08:00 local (13:00 UTC) and the follow-up and LATE on time', async () => {
    await start('2026-11-01 05:00');
    await h.reconcile();
    h.clock.set('2026-11-01 07:59');
    await h.reconcile();
    expect(liveWith('Twiggy morning')).toEqual([]);
    h.clock.set('2026-11-01 08:00');
    expect(h.clock.now().toISOString()).toBe('2026-11-01T13:00:00.000Z');
    await h.reconcile();
    expect(liveWith('Twiggy morning')).toHaveLength(1);
    h.clock.set('2026-11-01 09:00');
    await h.reconcile();
    expect(liveWith('still not given')).toHaveLength(1);
    h.clock.set('2026-11-01 10:00');
    await h.reconcile();
    expect(liveWith('⚠️ LATE')).toHaveLength(1);
    expect(boardLabels()[0]).toBe('☀️ Morning · ⚠️ LATE');
  });

  it("yesterday's evening log can be fixed by anyone until the next evening reminder at 18:00 EST (23:00 UTC)", async () => {
    await start('2026-10-31 18:00');
    await h.reconcile();
    await h.tap(liveWith('Twiggy evening')[0]!, 'All given', ROB);
    const record = liveWith('Given by Rob')[0]!;
    h.clock.set('2026-11-01 17:59');
    expect((await h.tap(record, 'Fix', KID)).toast).toBeUndefined();
    await h.tap(panelOf(), 'Back', KID);
    h.clock.set('2026-11-01 18:00');
    expect(h.clock.now().toISOString()).toBe('2026-11-01T23:00:00.000Z');
    expect((await h.tap(record, 'Fix', KID)).alert).toBe(true);
  });
});
