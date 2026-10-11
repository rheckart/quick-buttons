import type { Bot, Context } from 'grammy';
import type { User } from 'grammy/types';
import { decodeCallback } from '../render/index.js';
import type { CallbackCtx, CallbackResult, Logger, Service } from '../service/index.js';
import type { Person } from '../types.js';

export const OUT_OF_DATE_TEXT = 'That button is out of date';
const FAILED: CallbackResult = { toast: 'Something went wrong, please try again.', alert: true };
/** Telegram rejects answerCallbackQuery text longer than this. */
const TOAST_LIMIT = 200;

export function personOf(user: User): Person {
  return { userId: user.id, name: user.first_name.trim() || user.username || 'Someone' };
}

/** Where a button tap came from, or null when the button's message is not reachable. */
function callbackCtx(ctx: Context): CallbackCtx | null {
  const msg = ctx.callbackQuery?.message;
  if (!ctx.from || !msg) return null;
  return {
    from: personOf(ctx.from),
    chatId: msg.chat.id,
    messageId: msg.message_id,
    threadId: ('message_thread_id' in msg ? msg.message_thread_id : undefined) ?? null,
  };
}

/**
 * Button taps. Every tap is answered, even stale or failed ones, or Telegram shows a spinner.
 * `admin` buttons belong to the private-chat flow: they go on to the next handler untouched.
 */
export function registerCallbacks(bot: Bot, service: Pick<Service, 'handleCallback'>, logger: Logger): void {
  async function resolve(ctx: Context, data: string): Promise<CallbackResult | 'pass'> {
    const cb = decodeCallback(data);
    if (cb?.t === 'admin') return 'pass';
    const where = callbackCtx(ctx);
    if (!cb || !where) return { toast: OUT_OF_DATE_TEXT };
    try {
      return await service.handleCallback(cb, where);
    } catch (err) {
      logger.error('callback failed', err);
      return FAILED;
    }
  }

  async function answer(ctx: Context, result: CallbackResult): Promise<void> {
    try {
      await ctx.answerCallbackQuery(
        result.toast ? { text: result.toast.slice(0, TOAST_LIMIT), show_alert: result.alert || undefined } : undefined,
      );
    } catch (err) {
      logger.warn('could not answer a button tap', err); // e.g. "query is too old"
    }
  }

  bot.on('callback_query:data', async (ctx, next) => {
    const result = await resolve(ctx, ctx.callbackQuery.data);
    if (result === 'pass') return next();
    await answer(ctx, result);
  });
}

/** A reply to one of the bot's own group messages might be a typed time for an open prompt. */
export function registerTypedReplies(bot: Bot, service: Pick<Service, 'handleTypedTime'>): void {
  bot.chatType(['group', 'supergroup']).on('message:text', async (ctx, next) => {
    const replyTo = ctx.message.reply_to_message;
    if (replyTo?.from?.id !== ctx.me.id || !ctx.from) return next();

    const result = await service.handleTypedTime({
      from: personOf(ctx.from),
      chatId: ctx.chat.id,
      replyToMessageId: replyTo.message_id,
      text: ctx.message.text,
    });
    if (result.handled && result.reply) {
      // ctx.reply keeps the answer in the same topic.
      await ctx.reply(result.reply, {
        reply_parameters: { message_id: ctx.message.message_id, allow_sending_without_reply: true },
      });
    }
  });
}
