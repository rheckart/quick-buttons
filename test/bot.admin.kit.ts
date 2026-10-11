import { Bot } from 'grammy';
import type { Update, UserFromGetMe } from 'grammy/types';
import { registerAdmin } from '../src/bot/admin.js';
import type { AdminDeps } from '../src/bot/admin.js';
import { createTelegramMessenger } from '../src/bot/telegramMessenger.js';
import { createService } from '../src/service/index.js';
import type { Service } from '../src/service/index.js';
import type { Button } from '../src/types.js';
import { makeHarness } from './helpers/harness.js';
import type { Harness } from './helpers/harness.js';

export const BOT_USER = { id: 777, is_bot: true, first_name: 'Pet Meds', username: 'PetMedsBot' } as unknown as UserFromGetMe;

export interface Msg {
  chatId: number;
  id: number;
  threadId: number | null;
  text: string;
  keyboard: Button[][];
  forceReply: boolean;
  deleted: boolean;
  edits: number;
}

export interface Answer {
  text?: string;
  alert: boolean;
}

/** A tiny fake Telegram behind grammy's transformer: keeps messages, records every call. */
export class FakeTelegram {
  readonly messages: Msg[] = [];
  readonly calls: { method: string; payload: Record<string, any> }[] = [];
  readonly answers: Answer[] = [];
  private nextId = 5000;

  install(bot: Bot): void {
    bot.api.config.use((_prev, method, payload) => {
      const p = payload as Record<string, any>;
      this.calls.push({ method, payload: p });
      return Promise.resolve({ ok: true as const, result: this.handle(method, p) } as never);
    });
  }

  private handle(method: string, p: Record<string, any>): unknown {
    switch (method) {
      case 'sendMessage': return this.send(p);
      case 'editMessageText': return this.edit(p);
      case 'deleteMessage': {
        const m = this.find(p.chat_id, p.message_id);
        if (m) m.deleted = true;
        return true;
      }
      case 'answerCallbackQuery':
        this.answers.push({ text: p.text, alert: p.show_alert === true });
        return true;
      default: return true;
    }
  }

  private send(p: Record<string, any>) {
    const msg: Msg = {
      chatId: p.chat_id,
      id: this.nextId++,
      threadId: p.message_thread_id ?? null,
      text: p.text,
      keyboard: keyboardOf(p.reply_markup),
      forceReply: p.reply_markup?.force_reply === true,
      deleted: false,
      edits: 0,
    };
    this.messages.push(msg);
    return { message_id: msg.id, date: 0, chat: { id: msg.chatId, type: msg.chatId > 0 ? 'private' : 'supergroup' } };
  }

  private edit(p: Record<string, any>) {
    const m = this.find(p.chat_id, p.message_id);
    if (m) {
      m.text = p.text;
      m.keyboard = keyboardOf(p.reply_markup);
      m.edits++;
    }
    return true;
  }

  find(chatId: number, id: number): Msg | undefined {
    return this.messages.find((m) => m.chatId === chatId && m.id === id);
  }

  live(chatId: number): Msg[] {
    return this.messages.filter((m) => m.chatId === chatId && !m.deleted);
  }

  /** The newest message still on screen in a chat. */
  last(chatId: number): Msg {
    const msg = this.live(chatId).at(-1);
    if (!msg) throw new Error(`nothing on screen in chat ${chatId}`);
    return msg;
  }

  count(method: string): number {
    return this.calls.filter((c) => c.method === method).length;
  }
}

function keyboardOf(markup: any): Button[][] {
  return (markup?.inline_keyboard ?? []).map((row: any[]) => row.map((b) => ({ text: b.text, data: b.callback_data })));
}

export const labels = (msg: Msg): string[] => msg.keyboard.flat().map((b) => b.text);

const withoutEmoji = (text: string): string => text.replace(/^[^\p{L}\p{N}]+/u, '');

/** The one button whose label equals `label` (emoji aside), else the one containing it. */
export function buttonOn(msg: Msg, label: string): Button {
  const all = msg.keyboard.flat();
  const tiers = [(b: Button) => b.text === label, (b: Button) => withoutEmoji(b.text) === label, (b: Button) => b.text.includes(label)];
  const hits = tiers.map((match) => all.filter(match)).find((found) => found.length > 0) ?? [];
  if (hits.length !== 1) throw new Error(`expected 1 button "${label}", found ${hits.length}: ${labels(msg).join(' / ')}`);
  return hits[0]!;
}

export interface Who {
  id: number;
  first_name: string;
}

export const ROB: Who = { id: 1, first_name: 'Rob' };
export const DANI: Who = { id: 2, first_name: 'Danielle' };
export const KID: Who = { id: 3, first_name: 'Kid' };

let updateId = 1;
let messageId = 100;

const chatOf = (chatId: number) => ({ id: chatId, type: chatId > 0 ? 'private' : 'supergroup' });

export interface AdminKit {
  h: Harness;
  bot: Bot;
  tg: FakeTelegram;
  service: Service;
  /** Handlers registered after the admin ones: they see only what the admin flow passed on. */
  passedOn: Update[];
  /** A person in their private chat with the bot (or any chat id). */
  chat(who: Who, chatId?: number): Chat;
  close(): Promise<void>;
}

export class Chat {
  constructor(private kit: AdminKit, readonly who: Who, readonly chatId: number) {}

  async say(text: string, opts: { replyTo?: number; replyToFrom?: number } = {}): Promise<void> {
    const reply = opts.replyTo === undefined ? {} : {
      reply_to_message: { message_id: opts.replyTo, date: 0, chat: chatOf(this.chatId), from: { id: opts.replyToFrom ?? BOT_USER.id, is_bot: true, first_name: 'x' } },
    };
    const command = /^\/\w+(@\w+)?/.exec(text);
    await this.kit.bot.handleUpdate({
      update_id: updateId++,
      message: {
        message_id: messageId++, date: 0, chat: chatOf(this.chatId), from: { is_bot: false, ...this.who }, text,
        ...(command ? { entities: [{ type: 'bot_command', offset: 0, length: command[0].length }] } : {}),
        ...reply,
      },
    } as unknown as Update);
  }

  /** Presses a button by label. Returns how Telegram was told to answer the tap. */
  async tap(msg: Msg, label: string): Promise<Answer> {
    return this.tapData(msg, buttonOn(msg, label).data);
  }

  async tapData(msg: Msg, data: string): Promise<Answer> {
    const before = this.kit.tg.answers.length;
    await this.kit.bot.handleUpdate({
      update_id: updateId++,
      callback_query: {
        id: `q${updateId}`, chat_instance: 'x', from: { is_bot: false, ...this.who }, data,
        message: { message_id: msg.id, date: 0, chat: chatOf(msg.chatId) },
      },
    } as unknown as Update);
    const answers = this.kit.tg.answers.slice(before);
    if (answers.length !== 1) throw new Error(`expected exactly 1 answerCallbackQuery, got ${answers.length}`);
    return answers[0]!;
  }

  /** The newest message on screen in this chat. */
  get screen(): Msg {
    return this.kit.tg.last(this.chatId);
  }

  /** Says hello and returns the menu that comes back. */
  async openMenu(): Promise<Msg> {
    await this.say('hi');
    return this.screen;
  }
}

export async function makeAdminKit(opts: { now?: string; deps?: Partial<AdminDeps> | ((h: Harness) => Partial<AdminDeps>) } = {}): Promise<AdminKit> {
  const h = await makeHarness({ now: opts.now ?? '2026-10-10 12:00' });
  const bot = new Bot('1:fake', { botInfo: BOT_USER });
  const tg = new FakeTelegram();
  tg.install(bot);
  const service = createService({
    db: h.db, messenger: createTelegramMessenger(bot.api), clock: h.clock, settings: h.settings, logger: h.logger,
  });
  registerAdmin(bot, {
    service, settings: h.settings, logger: h.logger, clock: h.clock,
    ...(typeof opts.deps === 'function' ? opts.deps(h) : opts.deps),
  });
  const passedOn: Update[] = [];
  bot.use(async (ctx, next) => {
    passedOn.push(ctx.update);
    await next();
  });
  const kit: AdminKit = {
    h, bot, tg, service, passedOn,
    chat: (who, chatId = who.id) => new Chat(kit, who, chatId),
    close: () => h.close(),
  };
  return kit;
}

