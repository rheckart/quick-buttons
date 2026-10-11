import type { Bot, Context } from 'grammy';
import { decodeCallback } from '../render/index.js';
import type { Logger, Service } from '../service/index.js';
import type { Clock, Messenger, Person, Settings } from '../types.js';
import { createAdminController } from './admin/controller.js';
import type { AdminController } from './admin/controller.js';
import { createMemoryDraftStore } from './admin/store.js';
import type { DraftStore } from './admin/store.js';
import { toastText } from './toast.js';
import { createTelegramMessenger } from './telegramMessenger.js';

export type { DraftStore, Session } from './admin/store.js';
export { createDbDraftStore, createMemoryDraftStore } from './admin/store.js';

export interface AdminDeps {
  service: Service;
  settings: Settings;
  logger?: Logger;
  /** Where half-made drafts live. Default: memory (a restart abandons them); main uses `createDbDraftStore`. */
  store?: DraftStore;
  /** "Today" for typed dates. Default: the system clock. */
  clock?: Clock;
  /** Default: one built on `bot.api`. */
  messenger?: Messenger;
}

const consoleLogger: Logger = {
  warn: (message, err) => console.warn(message, err ?? ''),
  error: (message, err) => console.error(message, err ?? ''),
};

function personOf(from: { id: number; first_name: string; username?: string }): Person {
  return { userId: from.id, name: from.first_name || from.username || String(from.id) };
}

/**
 * The private-chat admin flow: menu, Start card, Stop, Edit, Fix a past log.
 * Only admins in private chats get anything; everyone else falls through to `next()`
 * (the core handler answers them). It owns every `{t:'admin'}` button and always answers its taps.
 */
export function registerAdmin(bot: Bot, deps: AdminDeps): void {
  const logger = deps.logger ?? consoleLogger;
  const controller = createAdminController({
    service: deps.service,
    settings: deps.settings,
    messenger: deps.messenger ?? createTelegramMessenger(bot.api),
    store: deps.store ?? createMemoryDraftStore(),
    clock: deps.clock ?? { now: () => new Date() },
    logger,
  });

  bot.on('callback_query:data', async (ctx, next) => {
    const cb = decodeCallback(ctx.callbackQuery.data);
    if (cb?.t !== 'admin') return next();
    await answerAdminTap(ctx, cb, controller, deps.service, logger);
  });

  bot.on('message', async (ctx, next) => {
    const from = ctx.from;
    if (ctx.chat.type !== 'private' || !from || !deps.service.isAdmin(from.id)) return next();
    try {
      const handled = await controller.onText({
        from: personOf(from),
        chatId: ctx.chat.id,
        messageId: ctx.message.message_id,
        text: ctx.message.text,
        replyTo: repliedBotMessage(ctx),
      });
      if (!handled) return next();
    } catch (err) {
      logger.error('admin message failed', err);
    }
  });
}

/** The id of the bot message this message replies to, or undefined for any other message. */
function repliedBotMessage(ctx: Context): number | undefined {
  const replied = ctx.message?.reply_to_message;
  return replied?.from?.id === ctx.me.id ? replied.message_id : undefined;
}

/** Runs one admin button and answers the callback query whatever happens. */
async function answerAdminTap(
  ctx: Context,
  cb: Parameters<AdminController['onCallback']>[0],
  controller: AdminController,
  service: Service,
  logger: Logger,
): Promise<void> {
  let reply: Awaited<ReturnType<AdminController['onCallback']>> = {};
  try {
    const from = ctx.from;
    const message = ctx.callbackQuery?.message;
    if (from && message && message.chat.type === 'private' && service.isAdmin(from.id)) {
      reply = await controller.onCallback(cb, { from: personOf(from), chatId: message.chat.id, messageId: message.message_id });
    }
  } catch (err) {
    logger.error('admin callback failed', err);
  }
  try {
    await ctx.answerCallbackQuery(reply.toast ? { text: toastText(reply.toast), show_alert: reply.alert ?? false } : undefined);
  } catch (err) {
    logger.warn('admin: answering a callback failed', err);
  }
}
