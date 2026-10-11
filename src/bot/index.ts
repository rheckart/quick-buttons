import { Bot, GrammyError } from 'grammy';
import type { BotError } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import type { Logger, Service } from '../service/index.js';
import type { Settings } from '../types.js';
import { registerCommands } from './commands.js';
import { OUT_OF_DATE_TEXT, registerCallbacks, registerTypedReplies } from './group.js';

export { GROUP_HELP_TEXT, idsText, NON_ADMIN_TEXT } from './commands.js';
export { OUT_OF_DATE_TEXT, personOf } from './group.js';

export interface BotDeps {
  token: string;
  service: Service;
  settings: Settings;
  logger: Logger;
  /** Where the private-chat admin flow hooks in. Runs after the core handlers, so it only sees what they pass on. */
  registerExtra?: (bot: Bot) => void;
  /** Skips the getMe call on start. Tests (and a caller that already ran getMe) set it. */
  botInfo?: UserFromGetMe;
}

export const CONFLICT_MESSAGE =
  'Telegram reports a 409 conflict: another process is polling with this bot token. ' +
  'Stop the other instance (an old container?) because Telegram allows only one.';

export const isPollingConflict = (err: unknown): boolean => err instanceof GrammyError && err.error_code === 409;

/**
 * Wires grammy to the service: button taps, typed times, /ids, and the non-admin private reply.
 * Anything else is ignored. A failing update is logged and never stops the bot.
 */
export function createBot(deps: BotDeps): Bot {
  const bot = new Bot(deps.token, deps.botInfo ? { botInfo: deps.botInfo } : undefined);
  bot.catch((err: BotError) => {
    if (isPollingConflict(err.error)) deps.logger.error(CONFLICT_MESSAGE);
    else deps.logger.error(`update ${err.ctx.update.update_id} failed`, err.error);
  });

  registerCommands(bot, deps.service);
  registerCallbacks(bot, deps.service, deps.logger);
  registerTypedReplies(bot, deps.service);
  deps.registerExtra?.(bot);

  // Last resort: a tap nobody claimed (an admin button with no admin flow) must not spin forever.
  bot.on('callback_query', (ctx) => ctx.answerCallbackQuery({ text: OUT_OF_DATE_TEXT }).catch(() => undefined));
  return bot;
}
