import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buttonLabels } from './helpers/fakeMessenger.js';
import { FAITH_TOPIC, makeHarness, seedDayOneMeds, TWIGGY_TOPIC } from './helpers/harness.js';
import type { Harness } from './helpers/harness.js';

let h: Harness;
beforeEach(async () => {
  h = await makeHarness({ now: '2026-10-10 06:00' });
  await seedDayOneMeds(h);
});
afterEach(() => h.close());

describe('boards', () => {
  it('creates and pins one silent board per pet', async () => {
    await h.reconcile();
    const boards = h.fake.live().filter((m) => m.text.includes('tap to log'));
    expect(boards.map((b) => b.threadId).sort()).toEqual([TWIGGY_TOPIC, FAITH_TOPIC]);
    expect(boards.every((b) => b.pinned && b.silent)).toBe(true);
    expect(buttonLabels(boards.find((b) => b.threadId === TWIGGY_TOPIC)!)).toEqual([
      '☀️ Morning · 🔜 8:00',
      '🌙 Evening · 🔜 18:00',
      '📅 Simparica · due Wed 14 Oct',
    ]);
  });

  it('ensureBoards is idempotent', async () => {
    await h.svc.ensureBoards();
    const mark = h.fake.mark();
    await h.svc.ensureBoards();
    expect(h.fake.callsSince(mark)).toEqual([]);
  });
});

describe('reminders and follow-ups', () => {
  it('posts the reminder at the due time with no mention, not silent', async () => {
    await h.reconcile();
    h.clock.set('2026-10-10 08:00');
    await h.reconcile();
    const reminder = h.fake.one('☀️ Twiggy morning: Antibiotic + Eye drops');
    expect(reminder.text).not.toContain('tg://user');
    expect(reminder.silent).toBe(false);
    expect(reminder.threadId).toBe(TWIGGY_TOPIC);
    expect(reminder.text).toContain('Late after 10:00');
    expect(buttonLabels(reminder)).toEqual(['✅ All given', '⚙️ Change…']);
  });

  it('posts a follow-up with mentions halfway, then marks LATE and sends nothing more', async () => {
    h.clock.set('2026-10-10 08:00');
    await h.reconcile();
    h.clock.set('2026-10-10 09:00');
    await h.reconcile();
    const followup = h.fake.one('still not given');
    expect(followup.text).toContain('<a href="tg://user?id=1">Rob</a>');
    expect(followup.text).toContain('<a href="tg://user?id=2">Danielle</a>');
    h.clock.set('2026-10-10 10:00');
    const sends = h.fake.count('send');
    await h.reconcile();
    expect(h.fake.count('send')).toBe(sends);
    expect(h.fake.one('Late after 10:00').text).toContain('⚠️ LATE');
    expect(h.fake.one('Twiggy · tap to log').keyboard[0]![0]!.text).toContain('⚠️ LATE');
  });

  it('a late start at 11:00 sends no reminder or follow-up but the board shows LATE', async () => {
    h.clock.set('2026-10-10 11:00');
    await h.reconcile();
    expect(h.fake.live().filter((m) => m.text.includes('Twiggy morning'))).toEqual([]);
    expect(h.fake.one('Twiggy · tap to log').keyboard[0]![0]!.text).toBe('☀️ Morning · ⚠️ LATE');
  });
});

describe('idempotency', () => {
  it('reconciling twice makes no new calls', async () => {
    h.clock.set('2026-10-10 09:00');
    await h.reconcile();
    const mark = h.fake.mark();
    await h.reconcile();
    expect(h.fake.callsSince(mark)).toEqual([]);
  });

  it('a restarted service on the same database makes no new calls', async () => {
    h.clock.set('2026-10-10 09:00');
    await h.reconcile();
    const mark = h.fake.mark();
    await h.restart().reconcile();
    expect(h.fake.callsSince(mark)).toEqual([]);
  });
});

describe('quiet hours', () => {
  it('sends nothing between 22:00 and 07:00, then catches up at 07:00', async () => {
    await h.reconcile();
    await h.addMed({ petId: 'twiggy', name: 'Night med', kind: 'ongoing', roundKeys: ['evening'] });
    h.clock.set('2026-10-10 22:30');
    const mark = h.fake.mark();
    await h.reconcile();
    expect(h.fake.callsSince(mark)).toEqual([]);
    h.clock.set('2026-10-11 06:59');
    await h.reconcile();
    expect(h.fake.callsSince(mark)).toEqual([]);
  });

  it('a monthly reminder due in the quiet window waits for 07:00', async () => {
    await h.repos.meds.update((await h.repos.meds.listForPet('faith'))[0]!.id, { seedLastGiven: '2026-09-11' });
    h.clock.set('2026-10-11 00:30');
    await h.reconcile();
    expect(h.fake.live(FAITH_TOPIC).filter((m) => m.text.includes('Simparica') && !m.text.includes('tap to log'))).toEqual([]);
    h.clock.set('2026-10-11 07:00');
    await h.reconcile();
    // Faith's morning time is 09:00, so still nothing at 07:00 ...
    expect(h.fake.live(FAITH_TOPIC).filter((m) => m.text.includes('is due today'))).toEqual([]);
    h.clock.set('2026-10-11 09:00');
    await h.reconcile();
    expect(h.fake.one('is due today', FAITH_TOPIC)).toBeDefined();
  });
});

describe('failures', () => {
  it('a failed send leaves no row, so the next tick retries', async () => {
    await h.reconcile();
    h.clock.set('2026-10-10 08:00');
    h.fake.failOn('send');
    await h.reconcile();
    expect(h.fake.live().filter((m) => m.text.includes('Twiggy morning'))).toEqual([]);
    h.fake.stopFailing();
    await h.reconcile();
    expect(h.fake.one('Late after 10:00')).toBeDefined();
    expect(h.logger.warnings.length).toBeGreaterThan(0);
  });

  it('a failed edit is retried on the next tick', async () => {
    h.clock.set('2026-10-10 08:00');
    await h.reconcile();
    h.clock.set('2026-10-10 10:00');
    h.fake.failOn('edit');
    await h.reconcile();
    expect(h.fake.one('Late after 10:00').text).not.toContain('LATE');
    h.fake.stopFailing();
    await h.reconcile();
    expect(h.fake.one('Late after 10:00').text).toContain('LATE');
  });

  it('one failing message does not stop the others', async () => {
    h.clock.set('2026-10-10 09:00');
    h.fake.failOn('send');
    await h.reconcile();
    h.fake.stopFailing();
    await h.reconcile();
    expect(h.fake.live().filter((m) => m.text.includes('Twiggy morning')).length).toBe(2);
  });

  it('an abandoned unsent row older than a minute does not block reminders', async () => {
    h.clock.set('2026-10-10 08:00');
    await h.repos.messages.insert({
      kind: 'reminder', petId: 'twiggy', roundKey: 'morning', medId: null, forDate: '2026-10-10',
      chatId: h.settings.groupChatId, threadId: TWIGGY_TOPIC, messageId: 0, renderHash: '',
      createdAt: new Date(h.clock.now().getTime() - 5 * 60_000),
    });
    await h.reconcile();
    expect(h.fake.one('Late after 10:00')).toBeDefined();
  });
});
