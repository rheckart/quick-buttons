import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startScheduler } from '../src/scheduler.js';
import type { LastRunStore, Scheduler, SchedulerDeps } from '../src/scheduler.js';
import { at } from './domain-fixtures.js';
import { MutableClock, recordingLogger } from './helpers/harness.js';

const MINUTE = 60_000;
const settings = { timezone: 'America/New_York', backupTime: '03:00' };

/** A promise the test settles by hand, to hold a tick "in flight". */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
}

function memoryStore(initial: string | null = null): LastRunStore & { value: string | null } {
  const store = {
    value: initial,
    get: async () => store.value,
    set: async (d: string) => void (store.value = d),
  };
  return store;
}

let scheduler: Scheduler | undefined;
let logger = recordingLogger();
let clock: MutableClock;

function start(over: Partial<SchedulerDeps> & { reconcile?: () => Promise<void> } = {}) {
  const { reconcile = async () => {}, ...rest } = over;
  const service = { reconcile: vi.fn(reconcile) };
  scheduler = startScheduler({ service, clock, settings, logger, ...rest });
  return service;
}

beforeEach(() => {
  vi.useFakeTimers();
  logger = recordingLogger();
  clock = new MutableClock(at('2026-10-10 12:00'));
});

afterEach(async () => {
  await scheduler?.stop();
  scheduler = undefined;
  vi.useRealTimers();
});

describe('reconcile ticks', () => {
  it('reconciles immediately and then every minute', async () => {
    const service = start();
    expect(service.reconcile).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(MINUTE - 1);
    expect(service.reconcile).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(service.reconcile).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3 * MINUTE);
    expect(service.reconcile).toHaveBeenCalledTimes(5);
  });

  it('honours intervalMs and calls onTick after each tick', async () => {
    const onTick = vi.fn();
    const service = start({ intervalMs: 1000, onTick });
    await vi.advanceTimersByTimeAsync(2500);
    expect(service.reconcile).toHaveBeenCalledTimes(3);
    expect(onTick).toHaveBeenCalledTimes(3);
  });

  it('never overlaps: a tick that finds the previous one still running is skipped', async () => {
    const slow = gate();
    let running = 0;
    let maxRunning = 0;
    const service = start({
      reconcile: async () => {
        maxRunning = Math.max(maxRunning, ++running);
        await slow.opened;
        running--;
      },
    });
    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    expect(service.reconcile).toHaveBeenCalledTimes(1);
    expect(maxRunning).toBe(1);
    expect(logger.warnings.length).toBeGreaterThan(0);

    slow.open();
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(service.reconcile).toHaveBeenCalledTimes(2);
  });

  it('logs a failing reconcile and keeps ticking', async () => {
    const reconcile = vi.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValue(undefined);
    const onTick = vi.fn();
    start({ reconcile, onTick });
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(logger.errors).toHaveLength(1);
    expect(logger.errors[0]).toContain('db down');
    expect(onTick).toHaveBeenCalledTimes(2);
  });
});

describe('stop', () => {
  it('stops ticking and waits for the tick in flight', async () => {
    const slow = gate();
    let finished = false;
    const service = start({
      reconcile: async () => {
        await slow.opened;
        finished = true;
      },
    });
    let stopped = false;
    const stopping = scheduler!.stop().then(() => (stopped = true));
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(stopped).toBe(false); // still waiting on the tick
    slow.open();
    await stopping;
    expect(finished).toBe(true);
    expect(service.reconcile).toHaveBeenCalledTimes(1); // no ticks after stop()
  });

  it('is quick when idle', async () => {
    start();
    await vi.advanceTimersByTimeAsync(0);
    await expect(scheduler!.stop()).resolves.toBeUndefined();
  });
});

describe('nightly backup', () => {
  it('does nothing without a runBackup', async () => {
    clock.set('2026-10-10 03:30');
    start();
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(logger.errors).toEqual([]);
  });

  it('waits for the backup time', async () => {
    const runBackup = vi.fn(async () => ({ status: 'sent' }));
    clock.set('2026-10-10 02:59');
    start({ runBackup, lastRun: memoryStore() });
    await vi.advanceTimersByTimeAsync(0);
    expect(runBackup).not.toHaveBeenCalled();
    clock.set('2026-10-10 03:00');
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(runBackup).toHaveBeenCalledTimes(1);
  });

  it('runs once per local day, records the date, and runs again the next day', async () => {
    const runBackup = vi.fn(async () => ({ status: 'sent' }));
    const lastRun = memoryStore();
    clock.set('2026-10-10 03:00');
    start({ runBackup, lastRun });
    await vi.advanceTimersByTimeAsync(0);
    expect(runBackup).toHaveBeenCalledTimes(1);
    expect(lastRun.value).toBe('2026-10-10');

    clock.set('2026-10-10 15:00');
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(runBackup).toHaveBeenCalledTimes(1);

    clock.set('2026-10-11 03:01');
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(runBackup).toHaveBeenCalledTimes(2);
    expect(lastRun.value).toBe('2026-10-11');
  });

  it('does not repeat after a restart the same day (date comes from the store), but catches up if the bot was down at 03:00', async () => {
    const runBackup = vi.fn(async () => ({ status: 'sent' }));
    clock.set('2026-10-10 09:00');
    start({ runBackup, lastRun: memoryStore('2026-10-10') });
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(runBackup).not.toHaveBeenCalled();
    await scheduler!.stop();

    start({ runBackup, lastRun: memoryStore('2026-10-09') });
    await vi.advanceTimersByTimeAsync(0);
    expect(runBackup).toHaveBeenCalledTimes(1);
  });

  it('records the day even when the backup fails or throws, so it never retries every minute', async () => {
    const runBackup = vi.fn(async () => ({ status: 'failed', error: 'pg_dump failed' }));
    const lastRun = memoryStore();
    clock.set('2026-10-10 03:00');
    start({ runBackup, lastRun });
    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    expect(runBackup).toHaveBeenCalledTimes(1);
    expect(lastRun.value).toBe('2026-10-10');
  });

  it('records the day when runBackup throws, and logs it', async () => {
    const runBackup = vi.fn(async () => { throw new Error('kaboom'); });
    const lastRun = memoryStore();
    clock.set('2026-10-10 03:00');
    start({ runBackup, lastRun });
    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    expect(runBackup).toHaveBeenCalledTimes(1);
    expect(lastRun.value).toBe('2026-10-10');
    expect(logger.errors[0]).toContain('kaboom');
  });

  it('does not retry every minute even if saving the date fails', async () => {
    const runBackup = vi.fn(async () => ({ status: 'sent' }));
    const lastRun: LastRunStore = { get: async () => null, set: async () => { throw new Error('db down'); } };
    clock.set('2026-10-10 03:00');
    start({ runBackup, lastRun });
    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    expect(runBackup).toHaveBeenCalledTimes(1);
    expect(logger.warnings.join('\n')).toContain('could not save backup date');
  });

  it('does not run twice at once, and a slow backup does not hold up reconciling', async () => {
    const slow = gate();
    const runBackup = vi.fn(async () => { await slow.opened; return { status: 'sent' }; });
    clock.set('2026-10-10 03:00');
    const service = start({ runBackup, lastRun: memoryStore() });
    await vi.advanceTimersByTimeAsync(4 * MINUTE);
    expect(runBackup).toHaveBeenCalledTimes(1);
    expect(service.reconcile).toHaveBeenCalledTimes(5);
    slow.open();
  });

  it('stop() waits for a backup in flight', async () => {
    const slow = gate();
    const lastRun = memoryStore();
    clock.set('2026-10-10 03:00');
    start({ runBackup: async () => { await slow.opened; }, lastRun });
    await vi.advanceTimersByTimeAsync(0);
    let stopped = false;
    const stopping = scheduler!.stop().then(() => (stopped = true));
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(stopped).toBe(false);
    slow.open();
    await stopping;
    expect(lastRun.value).toBe('2026-10-10');
  });
});
