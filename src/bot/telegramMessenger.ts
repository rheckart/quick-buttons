import { type Api, GrammyError, HttpError, InputFile } from 'grammy';
import type { Messenger, Rendered, Target } from '../types.js';

export interface MessengerOptions {
  /** Injectable so tests do not wait. */
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
}

/** The forum topic a message was meant for no longer exists (or is closed). */
export class TopicGoneError extends Error {
  constructor(readonly target: Target, readonly telegramMessage: string) {
    super(
      `Telegram topic ${String(target.threadId)} in chat ${target.chatId} is gone or closed (${telegramMessage}). ` +
        'Check topic_id in settings.yaml and that the topic still exists.',
    );
    this.name = 'TopicGoneError';
  }
}

/** The bot is not allowed to do this in the chat (usually missing admin rights). */
export class MissingRightsError extends Error {
  constructor(readonly action: string, readonly chatId: number, readonly telegramMessage: string) {
    super(
      `Telegram refused to ${action} in chat ${chatId} (${telegramMessage}). ` +
        'Make the bot an admin of the group with "Pin messages" and "Delete messages".',
    );
    this.name = 'MissingRightsError';
  }
}

const MAX_TRIES = 3;
const NETWORK_BACKOFF_MS = [1_000, 3_000];

const EDIT_HARMLESS = /message is not modified|message to edit not found|message can't be edited|MESSAGE_ID_INVALID/i;
const DELETE_GONE = /message to delete not found|message can't be deleted|MESSAGE_ID_INVALID/i;
const PIN_GONE = /message to pin not found|MESSAGE_ID_INVALID/i;
const TOPIC_GONE = /message thread not found|TOPIC_DELETED|TOPIC_CLOSED/i;
const NO_RIGHTS = /not enough rights|CHAT_ADMIN_REQUIRED|need administrator rights/i;

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function keyboardMarkup(content: Rendered) {
  return {
    inline_keyboard: content.keyboard.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))),
  };
}

function sendMarkup(content: Rendered) {
  if (content.forceReply) return { force_reply: true as const };
  return content.keyboard.length > 0 ? keyboardMarkup(content) : undefined;
}

/** Retry delay in ms if this failure is worth retrying, else null. */
function retryDelayMs(err: unknown, attempt: number): number | null {
  if (err instanceof GrammyError) {
    if (err.error_code === 429) return (err.parameters.retry_after ?? 1) * 1000;
    return err.error_code >= 500 ? NETWORK_BACKOFF_MS[attempt - 1]! : null;
  }
  return err instanceof HttpError ? NETWORK_BACKOFF_MS[attempt - 1]! : null;
}

export function createTelegramMessenger(api: Api, options: MessengerOptions = {}): Messenger {
  const sleep = options.sleep ?? defaultSleep;
  const log = options.log ?? ((m: string) => console.warn(m));

  async function withRetry<T>(call: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await call();
      } catch (err) {
        const delay = attempt < MAX_TRIES ? retryDelayMs(err, attempt) : null;
        if (delay === null) throw err;
        log(`telegram: ${describe(err)}; retrying in ${Math.round(delay / 1000)}s (try ${attempt + 1}/${MAX_TRIES})`);
        await sleep(delay);
      }
    }
  }

  /** Runs `call`; a failure whose description matches `harmless` is logged and swallowed. */
  async function tolerating(what: string, harmless: RegExp, call: () => Promise<unknown>): Promise<void> {
    try {
      await withRetry(call);
    } catch (err) {
      if (err instanceof GrammyError && harmless.test(err.description)) {
        log(`telegram: ${what}: ${err.description} (ignored)`);
        return;
      }
      throw err;
    }
  }

  function translate(err: unknown, action: string, target: Target): unknown {
    if (!(err instanceof GrammyError)) return err;
    if (target.threadId != null && TOPIC_GONE.test(err.description)) return new TopicGoneError(target, err.description);
    if (NO_RIGHTS.test(err.description)) return new MissingRightsError(action, target.chatId, err.description);
    return err;
  }

  return {
    async send(to, content) {
      try {
        const sent = await withRetry(() =>
          api.sendMessage(to.chatId, content.text, {
            parse_mode: 'HTML',
            link_preview_options: { is_disabled: true },
            reply_markup: sendMarkup(content),
            disable_notification: content.silent ? true : undefined,
            message_thread_id: to.threadId ?? undefined,
          }),
        );
        return sent.message_id;
      } catch (err) {
        throw translate(err, 'send a message', to);
      }
    },

    async edit(chatId, messageId, content) {
      // An empty keyboard must be sent explicitly, or Telegram keeps the old buttons.
      const reply_markup = keyboardMarkup(content);
      await tolerating(
        `edit ${messageId} in ${chatId}`,
        EDIT_HARMLESS,
        () =>
          api.editMessageText(chatId, messageId, content.text, {
            parse_mode: 'HTML',
            link_preview_options: { is_disabled: true },
            reply_markup,
          }),
      );
    },

    async delete(chatId, messageId) {
      await tolerating(`delete ${messageId} in ${chatId}`, DELETE_GONE, () => api.deleteMessage(chatId, messageId));
    },

    async pin(chatId, messageId) {
      try {
        await tolerating(`pin ${messageId} in ${chatId}`, PIN_GONE, () =>
          api.pinChatMessage(chatId, messageId, { disable_notification: true }),
        );
      } catch (err) {
        throw translate(err, 'pin a message', { chatId });
      }
    },

    async sendDocument(chatId, filename, data, caption) {
      await withRetry(() =>
        api.sendDocument(chatId, new InputFile(data, filename), {
          caption,
          disable_notification: true,
        }),
      );
    },
  };
}

function describe(err: unknown): string {
  if (err instanceof GrammyError) return `${err.error_code} ${err.description}`;
  return err instanceof Error ? err.message : String(err);
}
