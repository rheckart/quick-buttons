import { describe, expect, it } from 'vitest';
import { describeDatabase, readEnv, secretsOf, StartupError } from '../src/main.js';
import { createLogger, describeError } from '../src/logger.js';
import type { LogLevel } from '../src/logger.js';

const good = { BOT_TOKEN: '123456:ABCdef', DATABASE_URL: 'postgres://pet_meds:s3cr%40t@postgres:5432/pet_meds' };

describe('readEnv', () => {
  it('reads the required variables and defaults the rest', () => {
    expect(readEnv(good)).toEqual({
      botToken: '123456:ABCdef',
      databaseUrl: good.DATABASE_URL,
      settingsPath: './settings.yaml',
      logLevel: 'info',
    });
  });

  it('takes SETTINGS_PATH and LOG_LEVEL (any case) when given', () => {
    expect(readEnv({ ...good, SETTINGS_PATH: '/config/settings.yaml', LOG_LEVEL: 'DEBUG' })).toMatchObject({
      settingsPath: '/config/settings.yaml',
      logLevel: 'debug',
    });
  });

  it('names every missing variable on one line, and treats blanks as missing', () => {
    const message = (env: NodeJS.ProcessEnv) => {
      try {
        readEnv(env);
      } catch (err) {
        expect(err).toBeInstanceOf(StartupError);
        return (err as Error).message;
      }
      throw new Error('did not throw');
    };
    expect(message({})).toBe('Missing required environment variables: BOT_TOKEN, DATABASE_URL (see .env.example)');
    expect(message({ BOT_TOKEN: '  ', DATABASE_URL: good.DATABASE_URL })).toContain('BOT_TOKEN');
    expect(message({ BOT_TOKEN: good.BOT_TOKEN })).toBe('Missing required environment variable: DATABASE_URL (see .env.example)');
    expect(message({})).not.toContain('\n');
  });

  it('rejects an unknown LOG_LEVEL', () => {
    expect(() => readEnv({ ...good, LOG_LEVEL: 'loud' })).toThrow(/LOG_LEVEL must be one of debug, info, warn, error/);
  });

  it('never puts a secret in an error message', () => {
    for (const env of [{}, { BOT_TOKEN: good.BOT_TOKEN }, { ...good, LOG_LEVEL: 'x' }]) {
      try {
        readEnv(env);
      } catch (err) {
        expect((err as Error).message).not.toContain('ABCdef');
        expect((err as Error).message).not.toContain('s3cr');
      }
    }
  });
});

describe('describeDatabase', () => {
  it('shows host, port and name only', () => {
    expect(describeDatabase(good.DATABASE_URL)).toBe('postgres:5432/pet_meds');
    expect(describeDatabase('postgres://u:p@db.internal/x?sslmode=require')).toBe('db.internal/x');
  });

  it('does not echo something that is not a url', () => {
    expect(describeDatabase('hunter2')).not.toContain('hunter2');
  });
});

describe('logger', () => {
  function capture(level: LogLevel, redact: string[] = []) {
    const lines: string[] = [];
    const logger = createLogger({ level, redact, write: (l) => lines.push(l), now: () => new Date('2026-10-10T12:00:00Z') });
    return { lines, logger };
  }

  it('writes plain ISO-timestamped lines', () => {
    const { lines, logger } = capture('info');
    logger.info('started');
    logger.warn('careful', new Error('why'));
    expect(lines).toEqual(['2026-10-10T12:00:00.000Z INFO  started', '2026-10-10T12:00:00.000Z WARN  careful: why']);
  });

  it('drops lines below the level', () => {
    const { lines, logger } = capture('warn');
    logger.debug('a');
    logger.info('b');
    logger.warn('c');
    logger.error('d');
    expect(lines).toHaveLength(2);
  });

  it('scrubs secrets, including inside error text', () => {
    const { lines, logger } = capture('info', secretsOf(readEnv(good)));
    logger.error('failed with 123456:ABCdef', new Error('connect postgres://pet_meds:s3cr%40t@postgres:5432/pet_meds failed, password s3cr@t'));
    expect(lines[0]).not.toMatch(/ABCdef|s3cr/);
    expect(lines[0]).toContain('***');
  });

  it('describes errors without stacks and with useful text for empty messages', () => {
    expect(describeError(new TypeError('bad'))).toBe('TypeError: bad');
    expect(describeError(new AggregateError([new Error('connect ECONNREFUSED ::1:5432'), new Error('connect ECONNREFUSED 127.0.0.1:5432')], ''))).toBe(
      'connect ECONNREFUSED ::1:5432; connect ECONNREFUSED 127.0.0.1:5432',
    );
    expect(describeError('plain')).toBe('plain');
  });
});
