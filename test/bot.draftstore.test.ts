import { Bot } from 'grammy';
import { afterEach, describe, expect, it } from 'vitest';
import { registerAdmin } from '../src/bot/admin.js';
import { createDbDraftStore, createMemoryDraftStore } from '../src/bot/admin/store.js';
import type { Session } from '../src/bot/admin/store.js';
import { BOT_USER, Chat, labels, makeAdminKit, ROB } from './bot.admin.kit.js';
import type { AdminKit } from './bot.admin.kit.js';

let kit: AdminKit;
afterEach(() => kit.close());

const session = (screen = 9): Session => ({
  screen,
  flow: 'start',
  draft: { petId: 'twiggy', name: 'Antibiotic' } as Session['draft'],
  view: { v: 'card' },
});

describe('the database draft store', () => {
  it('keeps a session under admin:<chatId> and forgets it on delete', async () => {
    kit = await makeAdminKit();
    const store = createDbDraftStore(kit.h.repos.ui, kit.h.clock);
    expect(await store.get(5)).toBeUndefined();
    await store.set(5, session());
    expect(await kit.h.repos.ui.get('admin:5')).toMatchObject({ screen: 9, flow: 'start' });
    expect(await store.get(5)).toEqual(session());
    expect(await store.get(6)).toBeUndefined();
    await store.delete(5);
    expect(await store.get(5)).toBeUndefined();
    expect(await kit.h.repos.ui.get('admin:5')).toBeNull();
  });

  it('behaves like the memory store (a copy is returned, not the stored object)', async () => {
    kit = await makeAdminKit();
    for (const store of [createDbDraftStore(kit.h.repos.ui, kit.h.clock), createMemoryDraftStore()]) {
      await store.set(1, session());
      const got = (await store.get(1))!;
      got.screen = 77;
      expect((await store.get(1))!.screen).toBe(9);
    }
  });
});

describe('a half-made draft survives a restart', () => {
  it('a fresh registerAdmin and store over the same database carries on with the same card', async () => {
    kit = await makeAdminKit({ deps: (h) => ({ store: createDbDraftStore(h.repos.ui, h.clock) }) });
    const before = kit.chat(ROB);
    const card = await before.openMenu();
    await before.tap(card, 'Start');
    await before.tap(card, 'Pet');
    await before.tap(card, 'Twiggy');
    await before.tap(card, 'Name');
    await before.say('Antibiotic');
    expect(card.text).toContain('Name: Antibiotic');
    expect(await kit.h.repos.ui.get(`admin:${ROB.id}`)).not.toBeNull();

    // The bot restarts: a new Bot, a new registerAdmin, a new store, the same database.
    const bot = new Bot('1:fake', { botInfo: BOT_USER });
    kit.tg.install(bot);
    registerAdmin(bot, {
      service: kit.service, settings: kit.h.settings, logger: kit.h.logger, clock: kit.h.clock,
      store: createDbDraftStore(kit.h.repos.ui, kit.h.clock),
    });
    const after = new Chat({ ...kit, bot }, ROB, ROB.id);

    await after.tap(card, 'Kind');
    await after.tap(card, 'As needed');
    expect(card.text).toContain('Pet: Twiggy');
    expect(card.text).toContain('Name: Antibiotic');
    expect(labels(card)).toContain('✅ Start');
    await after.tap(card, '✅ Start');
    expect((await kit.service.listMeds('twiggy')).map((m) => m.name)).toContain('Antibiotic');
    expect(await kit.h.repos.ui.get(`admin:${ROB.id}`)).toBeNull(); // finished: nothing left behind
  });

  it('a typed answer still goes to the draft after a restart', async () => {
    kit = await makeAdminKit({ deps: (h) => ({ store: createDbDraftStore(h.repos.ui, h.clock) }) });
    const before = kit.chat(ROB);
    const card = await before.openMenu();
    await before.tap(card, 'Start');
    await before.tap(card, 'Name'); // now waiting for typed text

    const bot = new Bot('1:fake', { botInfo: BOT_USER });
    kit.tg.install(bot);
    registerAdmin(bot, {
      service: kit.service, settings: kit.h.settings, logger: kit.h.logger, clock: kit.h.clock,
      store: createDbDraftStore(kit.h.repos.ui, kit.h.clock),
    });
    await new Chat({ ...kit, bot }, ROB, ROB.id).say('Ear cleaner');
    expect(card.text).toContain('Name: Ear cleaner');
  });
});
