import { describe, expect, it, vi } from 'vitest';

const handlers: Record<string, (err: Error) => void> = {};
vi.mock('pg', () => {
  class Pool {
    on(event: string, fn: (err: Error) => void) {
      handlers[event] = fn;
      return this;
    }
    end() {
      return Promise.resolve();
    }
  }
  return { default: { Pool, types: { getTypeParser: () => (v: string) => v } } };
});

const { createPgDb } = await import('../src/db/pg.js');

describe('createPgDb pool errors', () => {
  it('go to the given logger (so secrets are redacted there), not to console', async () => {
    const logger = { error: vi.fn() };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    createPgDb('postgres://u:p@h/db', { logger });
    const err = new Error('terminating connection');
    handlers.error!(err);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('database'), err);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('fall back to console.error without a logger, and never throw', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    createPgDb('postgres://u:p@h/db');
    expect(() => handlers.error!(new Error('boom'))).not.toThrow();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
