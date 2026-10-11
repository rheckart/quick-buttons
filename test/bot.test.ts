import { GrammyError } from 'grammy';
import type { Bot } from 'grammy';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerAdmin } from '../src/bot/admin.js';
import { CONFLICT_MESSAGE, createBot, GROUP_HELP_TEXT, isPollingConflict, NON_ADMIN_TEXT, OUT_OF_DATE_TEXT } from '../src/bot/index.js';
import { encodeCallback } from '../src/render/index.js';
import type { Service } from '../src/service/index.js';
import { BOT_USER, callbackUpdate, deliver, messageUpdate, recordApi } from './botKit.js';
import type { Who } from './botKit.js';
import { buttonLabels, findButton } from './helpers/fakeMessenger.js';
import { DANI, e2eSettings, GROUP, KID, makeHarness, recordingLogger, ROB, TWIGGY_TOPIC } from './helpers/harness.js';
import type { Harness } from './helpers/harness.js';
import { seedDayOneMeds } from './helpers/harness.js';

const rob: Who = { id: ROB.userId, first_name: 'Rob' };
const kid: Who = { id: KID.userId, first_name: 'Kid' };
const group = { chatId: GROUP, topic: TWIGGY_TOPIC };

function stubService(over: Partial<Service> = {}): Service {
  return {
    handleCallback: vi.fn(async () => ({})),
    handleTypedTime: vi.fn(async () => ({ handled: false })),
    isAdmin: (id: number) => e2eSettings.admins.includes(id),
    ...over,
  } as unknown as Service;
}

function build(service: Service, registerExtra?: (bot: Bot) => void) {
  const logger = recordingLogger();
  const bot = createBot({ token: '1:fake', service, settings: e2eSettings, logger, botInfo: BOT_USER, registerExtra });
  return { bot, logger, api: recordApi(bot) };
}

describe('button taps (stub service)', () => {
  it('passes who/where to the service and answers with its toast', async () => {
    const service = stubService({ handleCallback: vi.fn(async () => ({ toast: 'Logged', alert: false })) });
    const { bot, api } = build(service);
    const data = encodeCallback({ t: 'logAll', m: 7 });
    await deliver(bot, callbackUpdate({ data, from: rob, where: group, messageId: 55 }));

    expect(service.handleCallback).toHaveBeenCalledWith(
      { t: 'logAll', m: 7 },
      { from: { userId: 1, name: 'Rob' }, chatId: GROUP, messageId: 55, threadId: TWIGGY_TOPIC },
    );
    expect(api.of('answerCallbackQuery')).toHaveLength(1);
    expect(api.of('answerCallbackQuery')[0]!.payload).toMatchObject({ text: 'Logged' });
  });

  it('shows an alert modal when asked and answers silently when there is no toast', async () => {
    const handleCallback = vi.fn()
      .mockResolvedValueOnce({ toast: 'Nope', alert: true })
      .mockResolvedValueOnce({});
    const { bot, api } = build(stubService({ handleCallback }));
    const data = encodeCallback({ t: 'logAll', m: 7 });
    await deliver(bot, callbackUpdate({ data, from: rob, where: group, messageId: 1 }));
    await deliver(bot, callbackUpdate({ data, from: rob, where: group, messageId: 1 }));
    const [first, second] = api.of('answerCallbackQuery');
    expect(first!.payload).toMatchObject({ text: 'Nope', show_alert: true });
    expect(second!.payload).not.toHaveProperty('text');
  });

  it('uses threadId null outside a topic and falls back to username, then "Someone", for the name', async () => {
    const service = stubService();
    const { bot } = build(service);
    const data = encodeCallback({ t: 'logAll', m: 7 });
    await deliver(bot, callbackUpdate({ data, from: { id: 9, first_name: ' ', username: 'katie' }, where: { chatId: GROUP }, messageId: 1 }));
    await deliver(bot, callbackUpdate({ data, from: { id: 10, first_name: '' }, where: { chatId: GROUP }, messageId: 1 }));
    const calls = vi.mocked(service.handleCallback).mock.calls;
    expect(calls[0]![1]).toMatchObject({ from: { userId: 9, name: 'katie' }, threadId: null });
    expect(calls[1]![1].from).toEqual({ userId: 10, name: 'Someone' });
  });

  it.each(['', 'zz:1', 'la:abc', 'la'])('answers "out of date" for undecodable data %j without calling the service', async (data) => {
    const service = stubService();
    const { bot, api } = build(service);
    await deliver(bot, callbackUpdate({ data: data || 'x', from: rob, where: group, messageId: 1 }));
    expect(service.handleCallback).not.toHaveBeenCalled();
    expect(api.of('answerCallbackQuery')[0]!.payload).toMatchObject({ text: OUT_OF_DATE_TEXT });
  });

  it('answers a tap whose message is gone (no message in the query)', async () => {
    const service = stubService();
    const { bot, api } = build(service);
    const update = callbackUpdate({ data: encodeCallback({ t: 'logAll', m: 1 }), from: rob, where: group, messageId: 1 });
    delete (update.callback_query as { message?: unknown }).message;
    await deliver(bot, update);
    expect(service.handleCallback).not.toHaveBeenCalled();
    expect(api.of('answerCallbackQuery')[0]!.payload).toMatchObject({ text: OUT_OF_DATE_TEXT });
  });

  it('still answers, with an alert, when the service throws', async () => {
    const service = stubService({ handleCallback: vi.fn(async () => { throw new Error('boom'); }) });
    const { bot, api, logger } = build(service);
    await deliver(bot, callbackUpdate({ data: encodeCallback({ t: 'logAll', m: 1 }), from: rob, where: group, messageId: 1 }));
    expect(api.of('answerCallbackQuery')[0]!.payload).toMatchObject({ show_alert: true });
    expect(logger.errors[0]).toContain('boom');
  });

  it('survives Telegram refusing the answer (query too old)', async () => {
    const { bot, logger } = build(stubService());
    bot.api.config.use(async () => ({ ok: false as const, error_code: 400, description: 'query is too old' }));
    await deliver(bot, callbackUpdate({ data: encodeCallback({ t: 'logAll', m: 1 }), from: rob, where: group, messageId: 1 }));
    expect(logger.warnings[0]).toContain('could not answer');
  });

  it('truncates a long toast to what Telegram accepts', async () => {
    const service = stubService({ handleCallback: vi.fn(async () => ({ toast: 'x'.repeat(500) })) });
    const { bot, api } = build(service);
    await deliver(bot, callbackUpdate({ data: encodeCallback({ t: 'logAll', m: 1 }), from: rob, where: group, messageId: 1 }));
    expect((api.of('answerCallbackQuery')[0]!.payload.text as string).length).toBe(200);
  });
});

describe('admin buttons', () => {
  it('are not handled by the core: they go to the extra handler, which answers them', async () => {
    const service = stubService();
    const seen: string[] = [];
    const { bot, api } = build(service, (b) => {
      b.on('callback_query:data', async (ctx) => {
        seen.push(ctx.callbackQuery.data);
        await ctx.answerCallbackQuery({ text: 'admin handled' });
      });
    });
    await deliver(bot, callbackUpdate({ data: encodeCallback({ t: 'admin', a: 'menu' }), from: rob, where: { chatId: 1 }, messageId: 1 }));
    expect(seen).toEqual(['ad:menu']);
    expect(service.handleCallback).not.toHaveBeenCalled();
    expect(api.of('answerCallbackQuery')).toHaveLength(1);
    expect(api.of('answerCallbackQuery')[0]!.payload).toMatchObject({ text: 'admin handled' });
  });

  it('are still answered (not left spinning) if no admin flow is installed', async () => {
    const { bot, api } = build(stubService());
    await deliver(bot, callbackUpdate({ data: encodeCallback({ t: 'admin', a: 'menu' }), from: rob, where: { chatId: 1 }, messageId: 1 }));
    expect(api.of('answerCallbackQuery')).toHaveLength(1);
  });

  it('do not stop group buttons from reaching the extra handler last', async () => {
    const extra = vi.fn();
    const { bot } = build(stubService(), (b) => b.on('callback_query:data', extra));
    await deliver(bot, callbackUpdate({ data: encodeCallback({ t: 'logAll', m: 1 }), from: rob, where: group, messageId: 1 }));
    expect(extra).not.toHaveBeenCalled();
  });
});

describe('/ids', () => {
  const ids = async (text: string, where: Parameters<typeof messageUpdate>[0]['where'], from: Who = rob) => {
    const { bot, api } = build(stubService());
    await deliver(bot, messageUpdate({ text, from, where }));
    return api.of('sendMessage');
  };

  it('replies in the exact README format inside a topic, in that topic', async () => {
    const [reply, ...rest] = await ids('/ids', group);
    expect(rest).toEqual([]);
    expect(reply!.payload).toMatchObject({ chat_id: GROUP, text: `chat_id=${GROUP} topic_id=${TWIGGY_TOPIC} user_id=1`, message_thread_id: TWIGGY_TOPIC });
    expect(reply!.payload).not.toHaveProperty('parse_mode');
  });

  it('says topic_id=none outside a topic', async () => {
    const [reply] = await ids('/ids', { chatId: GROUP });
    expect(reply!.payload.text).toBe(`chat_id=${GROUP} topic_id=none user_id=1`);
  });

  it('works in a private chat, for non-admins too', async () => {
    const [reply, ...rest] = await ids('/ids', { chatId: KID.userId }, kid);
    expect(reply!.payload.text).toBe('chat_id=3 topic_id=none user_id=3');
    expect(rest).toEqual([]);
  });

  it('answers /ids@itsname and ignores /ids@someoneelse', async () => {
    expect((await ids('/ids@PetMedsBot', group))).toHaveLength(1);
    expect((await ids('/ids@HermesBot', group))).toEqual([]);
  });
});

describe('private chats', () => {
  it.each(['hello', '/start', '/help', '/menu'])('tells a non-admin %j exactly once', async (text) => {
    const service = stubService();
    const extra = vi.fn();
    const { bot, api } = build(service, (b) => b.on('message', extra));
    await deliver(bot, messageUpdate({ text, from: kid, where: { chatId: KID.userId } }));
    const sent = api.of('sendMessage');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.payload.text).toBe('only admins can change meds — you can still log doses in Pet Stuff.');
    expect(NON_ADMIN_TEXT).toBe(sent[0]!.payload.text);
    expect(extra).not.toHaveBeenCalled();
  });

  it.each(['hello', '/start', '/help'])('leaves an admin\'s %j to the admin flow', async (text) => {
    const extra = vi.fn();
    const { bot, api } = build(stubService(), (b) => b.on('message', extra));
    await deliver(bot, messageUpdate({ text, from: rob, where: { chatId: ROB.userId } }));
    expect(extra).toHaveBeenCalledTimes(1);
    expect(api.calls).toEqual([]);
  });

  it('does not answer non-admin messages in the group', async () => {
    const { bot, api } = build(stubService());
    await deliver(bot, messageUpdate({ text: 'hello there', from: kid, where: group }));
    await deliver(bot, messageUpdate({ text: '/start', from: kid, where: group }));
    expect(api.calls).toEqual([]);
  });
});

describe('/help in the group', () => {
  it('gives one short usage line in the topic', async () => {
    const { bot, api } = build(stubService());
    await deliver(bot, messageUpdate({ text: '/help', from: kid, where: group }));
    const sent = api.of('sendMessage');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.payload).toMatchObject({ text: GROUP_HELP_TEXT, message_thread_id: TWIGGY_TOPIC });
    expect(GROUP_HELP_TEXT).not.toContain('\n');
  });
});

describe('errors', () => {
  it('long polling ends with the 409 error, which main reports as a conflict', async () => {
    const { bot } = build(stubService());
    bot.api.config.use(async (prev, method, payload, signal) =>
      method === 'getUpdates'
        ? { ok: false as const, error_code: 409, description: 'Conflict: terminated by other getUpdates request' }
        : prev(method, payload, signal),
    );
    const err = await bot.start().then(() => null, (e: unknown) => e);
    expect(isPollingConflict(err)).toBe(true);
    expect(isPollingConflict(new Error('x'))).toBe(false);
  });

  it('logs a failing handler and keeps handling updates', async () => {
    const handleTypedTime = vi.fn()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({ handled: true, reply: 'ok' });
    const { bot, api, logger } = build(stubService({ handleTypedTime }));
    const reply = () => messageUpdate({ text: '8:05', from: rob, where: group, replyTo: 50 });
    await deliver(bot, reply());
    expect(logger.errors[0]).toContain('db down');
    await deliver(bot, reply());
    expect(api.of('sendMessage')).toHaveLength(1);
  });

  it('says clearly when another instance is polling (409)', async () => {
    const conflict = new GrammyError('x', { ok: false, error_code: 409, description: 'Conflict: terminated by other getUpdates request' }, 'getUpdates', {});
    const { bot, logger } = build(stubService({ handleTypedTime: vi.fn(async () => { throw conflict; }) }));
    await deliver(bot, messageUpdate({ text: '8:05', from: rob, where: group, replyTo: 50 }));
    expect(logger.errors).toEqual([CONFLICT_MESSAGE]);
    expect(CONFLICT_MESSAGE).toContain('another process is polling');
  });
});

// ───────────────────────── through the real service ─────────────────────────

describe('with the real service', () => {
  let h: Harness;
  afterEach(() => h.close());

  async function setup(now = '2026-10-10 08:00') {
    h = await makeHarness({ now });
    await seedDayOneMeds(h);
    await h.reconcile();
    const logger = h.logger;
    const bot = createBot({ token: '1:fake', service: h.svc, settings: h.settings, logger, botInfo: BOT_USER });
    return { bot, api: recordApi(bot) };
  }

  const reminder = () => h.fake.live(TWIGGY_TOPIC).find((m) => m.text.includes('Twiggy morning'))!;
  const tap = (bot: Bot, msg: { messageId: number; chatId: number; threadId: number | null }, data: string, from: Who = rob, chatId = msg.chatId) =>
    deliver(bot, callbackUpdate({ data, from, where: { chatId, topic: msg.threadId ?? undefined }, messageId: msg.messageId }));

  it('logs the round on "All given" and answers the tap', async () => {
    const { bot, api } = await setup();
    await tap(bot, reminder(), findButton(reminder(), 'All given').data);
    expect(h.fake.one('Given by Rob')).toBeDefined();
    expect(api.of('answerCallbackQuery')).toHaveLength(1);
  });

  it('refuses a tap from the wrong chat with an alert and changes nothing', async () => {
    const { bot, api } = await setup();
    await tap(bot, reminder(), findButton(reminder(), 'All given').data, rob, -999);
    expect(api.of('answerCallbackQuery')[0]!.payload).toMatchObject({ text: "That button doesn't work here", show_alert: true });
    expect(h.fake.live().some((m) => m.text.includes('Given by'))).toBe(false);
  });

  it('says "out of date" for a button whose message the bot no longer knows', async () => {
    const { bot, api } = await setup();
    await tap(bot, reminder(), encodeCallback({ t: 'logAll', m: 98765 }));
    expect(api.of('answerCallbackQuery')[0]!.payload).toMatchObject({ text: OUT_OF_DATE_TEXT });
  });

  describe('typed times', () => {
    async function askForTime() {
      const ctx = await setup('2026-10-10 08:40');
      await h.tap(reminder(), 'Change');
      await h.tap(h.fake.one('Eye drops'), 'Given at');
      await h.tap(h.fake.one('When was it given'), 'Type a time');
      return { ...ctx, prompt: h.fake.live().find((m) => m.forceReply)! };
    }
    const typed = (bot: Bot, prompt: { messageId: number }, text: string, over: Partial<Parameters<typeof messageUpdate>[0]> = {}) =>
      deliver(bot, messageUpdate({ text, from: rob, where: group, replyTo: prompt.messageId, ...over }));

    it('applies a reply to the bot prompt and deletes the prompt', async () => {
      const { bot, api, prompt } = await askForTime();
      await typed(bot, prompt, '8:05');
      expect(prompt.deleted).toBe(true);
      expect(h.fake.one('Eye drops').keyboard.flat().some((b) => b.text.startsWith('🕐 Given at 8:05'))).toBe(true);
      expect(api.of('sendMessage')).toEqual([]);
    });

    it('answers an unreadable time in the same topic, as a reply to the typed message', async () => {
      const { bot, api, prompt } = await askForTime();
      await typed(bot, prompt, 'banana');
      const [sent] = api.of('sendMessage');
      expect(sent!.payload).toMatchObject({ chat_id: GROUP, message_thread_id: TWIGGY_TOPIC });
      expect(sent!.payload.text).toContain("couldn't read");
      expect(sent!.payload.reply_parameters).toMatchObject({ allow_sending_without_reply: true });
      expect(prompt.deleted).toBe(false);
    });

    it('ignores other people, replies to other users\' messages, plain messages, and private chats', async () => {
      const { bot, api, prompt } = await askForTime();
      await typed(bot, prompt, '8:05', { from: { id: DANI.userId, first_name: 'Danielle' } });
      await typed(bot, prompt, '8:05', { replyToFrom: rob });
      await deliver(bot, messageUpdate({ text: '8:05', from: rob, where: group }));
      await typed(bot, prompt, '8:05', { where: { chatId: ROB.userId } });
      expect(prompt.deleted).toBe(false);
      expect(api.of('sendMessage')).toEqual([]);
    });
  });
});

describe('core + the real admin flow', () => {
  const withAdmin = () => {
    const service = stubService();
    return { service, ...build(service, (b) => registerAdmin(b, { service, settings: e2eSettings, logger: recordingLogger() })) };
  };

  it('a non-admin private message gets the refusal once, not twice', async () => {
    const { bot, api } = withAdmin();
    await deliver(bot, messageUpdate({ text: 'hi', from: kid, where: { chatId: KID.userId } }));
    expect(api.of('sendMessage')).toHaveLength(1);
    expect(api.of('sendMessage')[0]!.payload.text).toBe(NON_ADMIN_TEXT);
  });

  it('an admin private message gets the menu, not the refusal', async () => {
    const { bot, api } = withAdmin();
    await deliver(bot, messageUpdate({ text: 'hi', from: rob, where: { chatId: ROB.userId } }));
    const texts = api.of('sendMessage').map((c) => c.payload.text);
    expect(texts.length).toBeGreaterThan(0);
    expect(texts).not.toContain(NON_ADMIN_TEXT);
  });

  it('an admin button is answered exactly once, and never reaches the service', async () => {
    const { bot, api, service } = withAdmin();
    await deliver(bot, callbackUpdate({ data: encodeCallback({ t: 'admin', a: 'menu' }), from: rob, where: { chatId: ROB.userId }, messageId: 9 }));
    expect(api.of('answerCallbackQuery')).toHaveLength(1);
    expect(service.handleCallback).not.toHaveBeenCalled();
  });
});
