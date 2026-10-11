import { backupDue } from './backup.js';
import type { AppLogger } from './logger.js';
import { describeError } from './logger.js';
import type { Service } from './service/index.js';
import { localDate } from './time.js';
import type { Clock, LocalDate, Settings } from './types.js';

/** ui_state key holding the local date of the last backup attempt (any result). */
export const BACKUP_LAST_RUN_KEY = 'backup:lastRunDate';

/** Where the date of the last backup attempt lives (ui_state in production). */
export interface LastRunStore {
  get(): Promise<LocalDate | null>;
  set(date: LocalDate): Promise<void>;
}

export interface SchedulerDeps {
  service: Pick<Service, 'reconcile'>;
  clock: Clock;
  settings: Pick<Settings, 'timezone' | 'backupTime'>;
  logger: Pick<AppLogger, 'warn' | 'error'> & Partial<Pick<AppLogger, 'debug' | 'info'>>;
  /** Default 60 000. */
  intervalMs?: number;
  /** Called after every reconcile tick, success or failure. */
  onTick?: () => void;
  /** Dumps and sends the nightly backup. Must report failures itself (runBackup does); a throw is logged. */
  runBackup?: () => Promise<unknown>;
  /** Persisted date of the last attempt. Default: memory only (a restart could then back up twice a day). */
  lastRun?: LastRunStore;
}

export interface Scheduler {
  /** Stops ticking, then waits for work already in flight. */
  stop(): Promise<void>;
}

const memoryStore = (): LastRunStore => {
  let date: LocalDate | null = null;
  return { get: async () => date, set: async (d) => void (date = d) };
};

/** Reconciles now and then every minute; once a day, after `backupTime`, also takes the backup. */
export function startScheduler(deps: SchedulerDeps): Scheduler {
  const { logger, clock, settings } = deps;
  const lastRun = deps.lastRun ?? memoryStore();
  const inFlight = new Set<Promise<void>>();
  let cachedLastRun: LocalDate | null | undefined; // undefined = not read yet

  /** One run at a time per task: a tick that finds the previous one still running does nothing. */
  function exclusive(name: string, task: () => Promise<void>): () => void {
    let running = false;
    return () => {
      if (running) {
        logger.warn(`scheduler: previous ${name} still running; skipping this tick`);
        return;
      }
      running = true;
      const run = task()
        .catch((err: unknown) => logger.error(`scheduler: ${name} failed`, err))
        .finally(() => {
          running = false;
          inFlight.delete(run);
        });
      inFlight.add(run);
    };
  }

  async function reconcileOnce(): Promise<void> {
    try {
      await deps.service.reconcile();
    } finally {
      deps.onTick?.();
    }
  }

  async function backupOnce(): Promise<void> {
    if (!deps.runBackup) return;
    if (cachedLastRun === undefined) cachedLastRun = await lastRun.get();
    const now = clock.now();
    if (!backupDue(now, settings, cachedLastRun)) return;
    const today = localDate(now, settings.timezone);
    logger.info?.('scheduler: starting nightly backup');
    try {
      await deps.runBackup();
    } catch (err) {
      logger.error('scheduler: backup threw', err);
    }
    // Recorded after ANY result: a failing dump must not retry (and alert) every minute.
    cachedLastRun = today;
    await lastRun.set(today).catch((err: unknown) => logger.warn(`scheduler: could not save backup date (${describeError(err)})`));
  }

  const reconcileTick = exclusive('reconcile', reconcileOnce);
  const backupTick = exclusive('backup', backupOnce);
  const tick = (): void => {
    reconcileTick();
    backupTick();
  };

  tick();
  const timer = setInterval(tick, deps.intervalMs ?? 60_000);

  return {
    async stop() {
      clearInterval(timer);
      await Promise.allSettled([...inFlight]);
    },
  };
}
