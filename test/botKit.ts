import type { Bot, BotError } from 'grammy';
import type { Update, UserFromGetMe } from 'grammy/types';

/** One Telegram API call the bot made. */
export interface ApiCall {
  method: string;
  payload: Record<string, unknown>;
}

export const BOT_USER: UserFromGetMe = {
  id: 777,
  is_bot: true,
  first_name: 'Pet Meds',
  username: 'PetMedsBot',
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
};

/** Makes every API call succeed with a canned result, and remembers it. */
export function recordApi(bot: Bot): { calls: ApiCall[]; of(method: string): ApiCall[] } {
  const calls: ApiCall[] = [];
  let nextMessageId = 5000;
  bot.api.config.use((_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    const chatId = (payload as { chat_id?: number }).chat_id ?? 0;
    const result = method.startsWith('send')
      ? { message_id: nextMessageId++, date: 0, chat: { id: chatId, type: 'supergroup' } }
      : true;
    return Promise.resolve({ ok: true as const, result } as never);
  });
  return { calls, of: (method) => calls.filter((c) => c.method === method) };
}

export interface Who {
  id: number;
  first_name?: string;
  username?: string;
}

export type ChatKind = 'private' | 'group' | 'supergroup';

export interface Where {
  chatId: number;
  kind?: ChatKind;
  /** The forum topic. */
  topic?: number;
}

const user = (who: Who) => ({ is_bot: false, first_name: who.first_name ?? `User${who.id}`, ...who });
const chatOf = (where: Where) => ({ id: where.chatId, type: where.kind ?? (where.chatId > 0 ? 'private' : 'supergroup') });
const topicFields = (where: Where) => (where.topic === undefined ? {} : { message_thread_id: where.topic, is_topic_message: true });

let updateId = 1;
let messageId = 100;

export function callbackUpdate(opts: { data: string; from: Who; where: Where; messageId: number }): Update {
  return {
    update_id: updateId++,
    callback_query: {
      id: `cbq-${updateId}`,
      chat_instance: 'x',
      from: user(opts.from),
      data: opts.data,
      message: { message_id: opts.messageId, date: 0, chat: chatOf(opts.where), ...topicFields(opts.where) },
    },
  } as unknown as Update;
}

export function messageUpdate(opts: {
  text: string;
  from: Who;
  where: Where;
  /** A reply to this message id, sent by `replyToFrom` (default: the bot). */
  replyTo?: number;
  replyToFrom?: Who;
}): Update {
  const command = /^\/\w+(@\w+)?/.exec(opts.text);
  const reply = opts.replyTo === undefined
    ? {}
    : {
        reply_to_message: {
          message_id: opts.replyTo,
          date: 0,
          chat: chatOf(opts.where),
          from: opts.replyToFrom ? user(opts.replyToFrom) : BOT_USER,
        },
      };
  return {
    update_id: updateId++,
    message: {
      message_id: messageId++,
      date: 0,
      chat: chatOf(opts.where),
      from: user(opts.from),
      text: opts.text,
      ...(command ? { entities: [{ type: 'bot_command', offset: 0, length: command[0].length }] } : {}),
      ...topicFields(opts.where),
      ...reply,
    },
  } as unknown as Update;
}

/** Feeds an update the way long polling does: a failing handler goes to bot.catch instead of throwing. */
export async function deliver(bot: Bot, update: Update): Promise<void> {
  try {
    await bot.handleUpdate(update);
  } catch (err) {
    await bot.errorHandler(err as BotError);
  }
}
