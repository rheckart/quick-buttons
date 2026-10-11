import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Api, GrammyError } from 'grammy';
import { runBackup } from './backup.js';
import { createDbDraftStore, registerAdmin } from './bot/admin.js';
import { createBot, CONFLICT_MESSAGE, isPollingConflict } from './bot/index.js';
import { createTelegramMessenger } from './bot/telegramMessenger.js';
import { ConfigError, loadSettings } from './config.js';
import { createPgDb, createRepos, migrate } from './db/index.js';
import { createLogger, describeError, isLogLevel, LOG_LEVELS } from './logger.js';
import type { AppLogger, LogLevel } from './logger.js';
import { BACKUP_LAST_RUN_KEY, startScheduler } from './scheduler.js';
import { createService } from './service/index.js';
import type { Clock, Db, LocalDate, Messenger, Settings } from './types.js';

// ───────────────────────── environment ─────────────────────────

export interface Env {
  botToken: string;
  databaseUrl: string;
  settingsPath: string;
  logLevel: LogLevel;
}

/** A problem with the environment or startup; its message is the one line shown to the operator. */
export class StartupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StartupError';
  }
}

/** Reads and checks the process environment. Never echoes a secret. */
export function readEnv(env: NodeJS.ProcessEnv): Env {
  const get = (key: string): string | undefined => env[key]?.trim() || undefined;
  const missing = ['BOT_TOKEN', 'DATABASE_URL'].filter((key) => !get(key));
  if (missing.length > 0) {
    throw new StartupError(`Missing required environment variable${missing.length > 1 ? 's' : ''}: ${missing.join(', ')} (see .env.example)`);
  }
  const level = (get('LOG_LEVEL') ?? 'info').toLowerCase();
  if (!isLogLevel(level)) {
    throw new StartupError(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}, got "${get('LOG_LEVEL')}"`);
  }
  return {
    botToken: get('BOT_TOKEN')!,
    databaseUrl: get('DATABASE_URL')!,
    settingsPath: get('SETTINGS_PATH') ?? './settings.yaml',
    logLevel: level,
  };
}

/** "host:port/name" of a database url, safe to log (no user, no password). */
export function describeDatabase(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.port ? `:${u.port}` : ''}${u.pathname}`;
  } catch {
    return '(DATABASE_URL is not a valid url)';
  }
}

/** Everything that must never reach a log line. */
export function secretsOf(env: Env): string[] {
  const secrets = [env.botToken, env.databaseUrl];
  try {
    const { password } = new URL(env.databaseUrl);
    if (password) secrets.push(password, decodeURIComponent(password));
  } catch {
    // not a url: the whole string is already listed
  }
  return secrets;
}

// ───────────────────────── startup ─────────────────────────

const systemClock: Clock = { now: () => new Date() };

/** Runs a startup step; any failure becomes one line saying which step. Config errors pass through. */
async function step<T>(what: string, fn: () => Promise<T> | T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ConfigError || err instanceof StartupError) throw err;
    throw new StartupError(`${what}: ${describeError(err)}`);
  }
}

async function checkToken(api: Api) {
  try {
    return await api.getMe();
  } catch (err) {
    if (err instanceof GrammyError && err.error_code === 401) {
      throw new StartupError('Telegram rejected BOT_TOKEN (401 Unauthorized). Check the token from BotFather.');
    }
    throw err;
  }
}

export interface App {
  /** Stops polling, waits for work in flight, closes the database. */
  stop(): Promise<void>;
}

/** Brings the bot up. `onFatal` is called if polling dies later (bad token, 409 conflict). */
export async function startApp(env: Env, logger: AppLogger, onFatal: (message: string, err: unknown) => void): Promise<App> {
  const settings = loadSettings(env.settingsPath);
  const api = new Api(env.botToken);
  const me = await step('Cannot reach Telegram', () => checkToken(api)); // a bad token fails here, before the database is touched

  const db = createPgDb(env.databaseUrl, { logger });
  try {
    await step(`Cannot set up the database ${describeDatabase(env.databaseUrl)}`, () => migrate(db));
  } catch (err) {
    await db.close().catch(() => undefined);
    throw err;
  }

  const messenger = createTelegramMessenger(api, { log: (m) => logger.warn(m) });
  const service = createService({
    db,
    messenger,
    clock: systemClock,
    settings,
    logger,
  });
  const bot = createBot({
    token: env.botToken,
    service,
    settings,
    logger,
    botInfo: me,
    registerExtra: (b) => registerAdmin(b, { service, settings, logger, clock: systemClock, messenger, store: createDbDraftStore(createRepos(db).ui, systemClock) }),
  });

  const polling = bot
    .start({
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: false,
      onStart: () => logger.info(`polling Telegram as @${me.username}`),
    })
    .catch((err: unknown) => onFatal(isPollingConflict(err) ? CONFLICT_MESSAGE : 'polling stopped', err));

  const scheduler = startScheduler({
    service,
    clock: systemClock,
    settings,
    logger,
    lastRun: backupDateStore(db),
    runBackup: () => nightlyBackup({ env, settings, messenger, logger }),
  });

  logger.info(`started: ${settings.pets.length} pet(s), time zone ${settings.timezone}, database ${describeDatabase(env.databaseUrl)}`);

  return {
    async stop() {
      await bot.stop().catch((err: unknown) => logger.warn('could not stop polling cleanly', err));
      await polling;
      await scheduler.stop();
      await db.close();
    },
  };
}

function backupDateStore(db: Db) {
  const ui = createRepos(db).ui;
  return {
    get: () => ui.get<LocalDate>(BACKUP_LAST_RUN_KEY),
    set: (date: LocalDate) => ui.set(BACKUP_LAST_RUN_KEY, date, systemClock.now()),
  };
}

async function nightlyBackup(deps: { env: Env; settings: Settings; messenger: Messenger; logger: AppLogger }) {
  const { env, settings, messenger, logger } = deps;
  const result = await runBackup({
    messenger,
    settings,
    databaseUrl: env.databaseUrl,
    now: systemClock.now(),
    log: (m) => logger.warn(m),
  });
  logger.info(`nightly backup: ${result.status}`);
  return result;
}

// ───────────────────────── process ─────────────────────────

const FORCE_EXIT_MS = 10_000;

export async function main(processEnv: NodeJS.ProcessEnv = process.env): Promise<void> {
  let env: Env;
  try {
    env = readEnv(processEnv);
  } catch (err) {
    return exitWith(1, err instanceof Error ? err.message : String(err));
  }
  const logger = createLogger({ level: env.logLevel, redact: secretsOf(env) });

  let app: App | undefined;
  let stopping = false;
  const shutdown = async (code: number): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.info('shutting down');
    setTimeout(() => exitWith(1, 'shutdown took too long; forcing exit'), FORCE_EXIT_MS).unref();
    try {
      await app?.stop();
    } catch (err) {
      logger.error('error while shutting down', err);
      code = 1;
    }
    process.exit(code);
  };

  process.on('SIGINT', () => void shutdown(0));
  process.on('SIGTERM', () => void shutdown(0));
  process.on('unhandledRejection', (reason) => logger.error('unhandled rejection', reason));
  process.on('uncaughtException', (err) => {
    logger.error('uncaught exception', err);
    void shutdown(1);
  });

  try {
    app = await startApp(env, logger, (message, err) => {
      logger.error(message, err);
      void shutdown(1);
    });
  } catch (err) {
    // A bad settings file lists its own problems; print them as they are, without a stack trace.
    stopping = true;
    return exitWith(1, err instanceof ConfigError ? err.message : `${new Date().toISOString()} ERROR ${redact(err instanceof StartupError ? err.message : describeError(err), env)}`);
  }
}

const redact = (text: string, env: Env): string => secretsOf(env).reduce((out, s) => (s.length >= 4 ? out.replaceAll(s, '***') : out), text);

function exitWith(code: number, message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function isEntryPoint(): boolean {
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1] ?? '')).href;
  } catch {
    return false;
  }
}

if (isEntryPoint()) void main();
