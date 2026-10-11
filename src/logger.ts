import { GrammyError, HttpError } from 'grammy';
import type { Logger } from './service/index.js';

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const isLogLevel = (s: string): s is LogLevel => (LOG_LEVELS as readonly string[]).includes(s);

/** The service's Logger (warn/error with an optional cause) plus the quieter levels. */
export interface AppLogger extends Logger {
  debug(message: string): void;
  info(message: string): void;
}

export interface LoggerOptions {
  level?: LogLevel;
  /** Where finished lines go. Default: stdout for debug/info, stderr for warn/error. */
  write?: (line: string, level: LogLevel) => void;
  now?: () => Date;
  /** Strings (token, database url, password) that must never reach the output. */
  redact?: readonly string[];
}

/** One readable line for an error. The stack is left to debug logging. */
export function describeError(err: unknown): string {
  if (err instanceof GrammyError) return `Telegram ${err.error_code}: ${err.description}`;
  if (err instanceof HttpError) return `network error talking to Telegram: ${describeError(err.error)}`;
  if (err instanceof Error) {
    const message = errorMessage(err);
    return err.name === 'Error' || err.name === 'AggregateError' ? message : `${err.name}: ${message}`;
  }
  return String(err);
}

/** Some errors have an empty message: a refused connection to "localhost" is an AggregateError of the tries. */
function errorMessage(err: Error): string {
  if (err.message) return err.message;
  const parts = err instanceof AggregateError ? err.errors.map((e: unknown) => describeError(e)) : [];
  return [...new Set(parts)].join('; ') || (err as { code?: string }).code || err.name;
}

const defaultWrite = (line: string, level: LogLevel): void => {
  (level === 'warn' || level === 'error' ? process.stderr : process.stdout).write(`${line}\n`);
};

/** Plain lines: `2026-10-10T12:00:00.000Z WARN  message: cause`. */
export function createLogger(options: LoggerOptions = {}): AppLogger {
  const threshold = LOG_LEVELS.indexOf(options.level ?? 'info');
  const write = options.write ?? defaultWrite;
  const now = options.now ?? (() => new Date());
  const secrets = (options.redact ?? []).filter((s) => s.length >= 4);

  const scrub = (text: string): string => secrets.reduce((out, s) => out.replaceAll(s, '***'), text);

  function emit(level: LogLevel, message: string, err?: unknown): void {
    if (LOG_LEVELS.indexOf(level) < threshold) return;
    const cause = err === undefined || err === '' ? '' : `: ${describeError(err)}`;
    const stack = threshold === 0 && err instanceof Error && err.stack ? `\n${err.stack}` : '';
    write(scrub(`${now().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}${cause}${stack}`), level);
  }

  return {
    debug: (m) => emit('debug', m),
    info: (m) => emit('info', m),
    warn: (m, err) => emit('warn', m, err),
    error: (m, err) => emit('error', m, err),
  };
}
