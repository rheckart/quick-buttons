import { Api, GrammyError, HttpError, type Transformer } from 'grammy';
import { describe, expect, it } from 'vitest';
import { MissingRightsError, TopicGoneError, createTelegramMessenger } from '../src/bot/telegramMessenger.js';
import type { Rendered } from '../src/types.js';

interface Call {
  method: string;
  payload: Record<string, unknown>;
}

type Reply = { ok: true; result: unknown } | { ok: false; error_code: number; description: string; parameters?: { retry_after?: number } } | Error;

/** A fake Telegram: records every call, answers from a script (last reply repeats). */
function fakeTelegram(script: Reply[] = []) {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  const logs: string[] = [];
  const transformer: Transformer = async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    const reply = script[Math.min(calls.length - 1, script.length - 1)] ?? { ok: true, result: { message_id: 77 } };
    if (reply instanceof Error) throw reply;
    return { parameters: {}, ...reply } as never;
  };
  const api = new Api('123:abc');
  api.config.use(transformer);
  const messenger = createTelegramMessenger(api, {
    sleep: async (ms) => void sleeps.push(ms),
    log: (m) => void logs.push(m),
  });
  return { messenger, calls, sleeps, logs };
}

const ok = (result: unknown = { message_id: 77 }): Reply => ({ ok: true, result });
const fail = (error_code: number, description: string, parameters?: { retry_after?: number }): Reply => ({
  ok: false,
  error_code,
  description,
  parameters,
});

const content: Rendered = {
  text: '<b>Hi</b>',
  keyboard: [[{ text: 'A', data: 'a' }, { text: 'B', data: 'b' }], [{ text: 'C', data: 'c' }]],
};

describe('send', () => {
  it('uses HTML, an inline keyboard, the topic and returns the message id', async () => {
    const t = fakeTelegram([ok({ message_id: 501 })]);
    const id = await t.messenger.send({ chatId: -100, threadId: 11 }, content);
    expect(id).toBe(501);
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]!.method).toBe('sendMessage');
    expect(t.calls[0]!.payload).toMatchObject({
      chat_id: -100,
      text: '<b>Hi</b>',
      parse_mode: 'HTML',
      message_thread_id: 11,
      reply_markup: {
        inline_keyboard: [
          [{ text: 'A', callback_data: 'a' }, { text: 'B', callback_data: 'b' }],
          [{ text: 'C', callback_data: 'c' }],
        ],
      },
    });
    expect(t.calls[0]!.payload.disable_notification).toBeUndefined();
  });

  it('is silent only when asked', async () => {
    const t = fakeTelegram();
    await t.messenger.send({ chatId: 1 }, { ...content, silent: true });
    expect(t.calls[0]!.payload.disable_notification).toBe(true);
    expect(t.calls[0]!.payload.message_thread_id).toBeUndefined();
  });

  it('sends force_reply instead of a keyboard', async () => {
    const t = fakeTelegram();
    await t.messenger.send({ chatId: 1, threadId: null }, { text: 'Time?', keyboard: [[{ text: 'x', data: 'x' }]], forceReply: true });
    expect(t.calls[0]!.payload.reply_markup).toEqual({ force_reply: true });
  });

  it('omits reply_markup when there are no buttons', async () => {
    const t = fakeTelegram();
    await t.messenger.send({ chatId: 1 }, { text: 'plain', keyboard: [] });
    expect(t.calls[0]!.payload.reply_markup).toBeUndefined();
  });

  it('turns a deleted topic into a clear error', async () => {
    const t = fakeTelegram([fail(400, 'Bad Request: message thread not found')]);
    const err = await t.messenger.send({ chatId: -100, threadId: 11 }, content).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TopicGoneError);
    expect((err as Error).message).toContain('topic 11');
    expect((err as Error).message).toContain('settings.yaml');
    expect(t.calls).toHaveLength(1);
  });

  it('explains missing admin rights', async () => {
    const t = fakeTelegram([fail(400, 'Bad Request: not enough rights to send text messages to the chat')]);
    const err = await t.messenger.send({ chatId: -100 }, content).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MissingRightsError);
  });

  it('rethrows other errors untouched', async () => {
    const t = fakeTelegram([fail(400, 'Bad Request: chat not found')]);
    await expect(t.messenger.send({ chatId: 1 }, content)).rejects.toBeInstanceOf(GrammyError);
    expect(t.calls).toHaveLength(1);
  });
});

describe('retries', () => {
  it('waits retry_after seconds on 429, then succeeds', async () => {
    const t = fakeTelegram([fail(429, 'Too Many Requests: retry after 7', { retry_after: 7 }), ok({ message_id: 9 })]);
    expect(await t.messenger.send({ chatId: 1 }, content)).toBe(9);
    expect(t.sleeps).toEqual([7000]);
    expect(t.calls).toHaveLength(2);
  });

  it('gives up after 3 tries in total', async () => {
    const t = fakeTelegram([fail(429, 'Too Many Requests', { retry_after: 1 })]);
    await expect(t.messenger.send({ chatId: 1 }, content)).rejects.toMatchObject({ error_code: 429 });
    expect(t.calls).toHaveLength(3);
    expect(t.sleeps).toHaveLength(2);
  });

  it('retries network errors with growing backoff', async () => {
    const net = new HttpError('Network request for sendMessage failed!', new Error('ECONNRESET'));
    const t = fakeTelegram([net, net, ok({ message_id: 3 })]);
    expect(await t.messenger.send({ chatId: 1 }, content)).toBe(3);
    expect(t.calls).toHaveLength(3);
    expect(t.sleeps).toHaveLength(2);
    expect(t.sleeps[1]!).toBeGreaterThan(t.sleeps[0]!);
  });

  it('gives up on a network error after 3 tries', async () => {
    const net = new HttpError('down', new Error('ETIMEDOUT'));
    const t = fakeTelegram([net]);
    await expect(t.messenger.send({ chatId: 1 }, content)).rejects.toBeInstanceOf(HttpError);
    expect(t.calls).toHaveLength(3);
  });

  it('retries Telegram server errors', async () => {
    const t = fakeTelegram([fail(502, 'Bad Gateway'), ok()]);
    await t.messenger.send({ chatId: 1 }, content);
    expect(t.calls).toHaveLength(2);
  });

  it('does not retry client errors', async () => {
    const t = fakeTelegram([fail(403, 'Forbidden: bot was blocked by the user')]);
    await expect(t.messenger.sendDocument(1, 'a.dump', new Uint8Array([1]))).rejects.toBeInstanceOf(GrammyError);
    expect(t.calls).toHaveLength(1);
  });
});

describe('edit', () => {
  it('sends HTML text and the new keyboard', async () => {
    const t = fakeTelegram([ok(true)]);
    await t.messenger.edit(-100, 5, content);
    expect(t.calls[0]!.method).toBe('editMessageText');
    expect(t.calls[0]!.payload).toMatchObject({ chat_id: -100, message_id: 5, parse_mode: 'HTML' });
    expect((t.calls[0]!.payload.reply_markup as { inline_keyboard: unknown[] }).inline_keyboard).toHaveLength(2);
  });

  it('clears old buttons with an explicit empty keyboard', async () => {
    const t = fakeTelegram([ok(true)]);
    await t.messenger.edit(1, 5, { text: 'done', keyboard: [] });
    expect(t.calls[0]!.payload.reply_markup).toEqual({ inline_keyboard: [] });
  });

  it.each([
    'Bad Request: message is not modified: specified new message content and reply markup are exactly the same',
    'Bad Request: message to edit not found',
    "Bad Request: message can't be edited",
  ])('swallows and logs "%s"', async (description) => {
    const t = fakeTelegram([fail(400, description)]);
    await expect(t.messenger.edit(1, 5, content)).resolves.toBeUndefined();
    expect(t.logs.some((l) => l.includes('ignored'))).toBe(true);
  });

  it('rethrows other edit errors', async () => {
    const t = fakeTelegram([fail(400, "Bad Request: can't parse entities: Unsupported start tag")]);
    await expect(t.messenger.edit(1, 5, content)).rejects.toBeInstanceOf(GrammyError);
  });
});

describe('delete', () => {
  it('deletes', async () => {
    const t = fakeTelegram([ok(true)]);
    await t.messenger.delete(-100, 5);
    expect(t.calls[0]).toMatchObject({ method: 'deleteMessage', payload: { chat_id: -100, message_id: 5 } });
  });

  it.each(['Bad Request: message to delete not found', "Bad Request: message can't be deleted for everyone"])(
    'swallows "%s"',
    async (description) => {
      const t = fakeTelegram([fail(400, description)]);
      await expect(t.messenger.delete(1, 5)).resolves.toBeUndefined();
    },
  );

  it('rethrows unrelated errors', async () => {
    const t = fakeTelegram([fail(400, 'Bad Request: chat not found')]);
    await expect(t.messenger.delete(1, 5)).rejects.toBeInstanceOf(GrammyError);
  });
});

describe('pin', () => {
  it('pins without a notification', async () => {
    const t = fakeTelegram([ok(true)]);
    await t.messenger.pin(-100, 5);
    expect(t.calls[0]).toMatchObject({
      method: 'pinChatMessage',
      payload: { chat_id: -100, message_id: 5, disable_notification: true },
    });
  });

  it('explains missing pin rights', async () => {
    const t = fakeTelegram([fail(400, 'Bad Request: not enough rights to pin a message')]);
    await expect(t.messenger.pin(-100, 5)).rejects.toBeInstanceOf(MissingRightsError);
  });
});

describe('sendDocument', () => {
  it('uploads the bytes as a file with a caption, quietly', async () => {
    const t = fakeTelegram();
    await t.messenger.sendDocument(42, 'pet-meds-2026-10-10-0300.dump', new Uint8Array([1, 2, 3]), 'nightly');
    expect(t.calls[0]!.method).toBe('sendDocument');
    expect(t.calls[0]!.payload).toMatchObject({ chat_id: 42, caption: 'nightly', disable_notification: true });
    const file = t.calls[0]!.payload.document as { filename?: string };
    expect(file.filename).toBe('pet-meds-2026-10-10-0300.dump');
  });
});
