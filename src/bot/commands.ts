import type { Bot, Context } from 'grammy';
import type { Service } from '../service/index.js';

export const NON_ADMIN_TEXT = 'only admins can change meds — you can still log doses in Pet Stuff.';
export const GROUP_HELP_TEXT =
  'Tap ✅ All given on a reminder to log a dose, or tap a round on the pinned board to log or fix it. Admins set up meds in a private chat with me.';

/** The forum topic a message was sent in, or null (General topic, plain group, private chat). */
export function topicOf(msg: { is_topic_message?: boolean; message_thread_id?: number }): number | null {
  return msg.is_topic_message ? (msg.message_thread_id ?? null) : null;
}

/** "chat_id=… topic_id=… user_id=…", the exact format README step 3 promises. */
export function idsText(ctx: Context): string {
  const topic = ctx.msg ? topicOf(ctx.msg) : null;
  return `chat_id=${ctx.chat?.id ?? 'unknown'} topic_id=${topic ?? 'none'} user_id=${ctx.from?.id ?? 'unknown'}`;
}

/**
 * /ids everywhere (it is how the settings file gets its numbers), /help in the group, and the
 * one answer every non-admin gets in a private chat. Admin private chats fall through.
 */
export function registerCommands(bot: Bot, service: Pick<Service, 'isAdmin'>): void {
  bot.command('ids', (ctx) => ctx.reply(idsText(ctx)));

  bot.chatType(['group', 'supergroup']).command('help', (ctx) => ctx.reply(GROUP_HELP_TEXT));

  bot.chatType('private').on('message', async (ctx, next) => {
    if (service.isAdmin(ctx.from.id)) return next();
    await ctx.reply(NON_ADMIN_TEXT);
  });
}
