import { createRepos } from '../db/index.js';
import type { Repos } from '../db/index.js';
import type { Clock, Db, Messenger, Settings } from '../types.js';

export interface Logger {
  warn(message: string, err?: unknown): void;
  error(message: string, err?: unknown): void;
}

const consoleLogger: Logger = {
  warn: (message, err) => console.warn(message, err ?? ''),
  error: (message, err) => console.error(message, err ?? ''),
};

export interface ServiceDeps {
  db: Db;
  messenger: Messenger;
  clock: Clock;
  settings: Settings;
  logger?: Logger;
}

/** Everything a use-case needs, built once per service. */
export interface Ctx {
  db: Db;
  repos: Repos;
  messenger: Messenger;
  clock: Clock;
  settings: Settings;
  tz: string;
  log: Logger;
}

export function makeCtx(deps: ServiceDeps): Ctx {
  return {
    db: deps.db,
    repos: createRepos(deps.db),
    messenger: deps.messenger,
    clock: deps.clock,
    settings: deps.settings,
    tz: deps.settings.timezone,
    log: deps.logger ?? consoleLogger,
  };
}

/** Runs `fn`, logging instead of throwing. For Telegram work that must not undo a DB write. */
export async function safe<T>(ctx: Ctx, what: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    ctx.log.warn(`${what} failed`, err);
    return undefined;
  }
}

/** Runs tasks one at a time, so a slow scheduler tick and a tap never interleave. */
export function createMutex(): <T>(fn: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return (fn) => {
    const run = tail.then(fn, fn);
    tail = run.catch(() => undefined);
    return run;
  };
}

export const isAdmin = (ctx: Ctx, userId: number): boolean => ctx.settings.admins.includes(userId);
