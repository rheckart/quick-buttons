import { spawn as nodeSpawn } from 'node:child_process';
import { localDate, localTime } from './time.js';
import type { LocalDate, Messenger, Settings } from './types.js';

/** Telegram's limit for files a bot uploads. */
export const TELEGRAM_UPLOAD_LIMIT = 50 * 1024 * 1024;

export interface SpawnResult {
  /** null when the process was killed by a signal. */
  code: number | null;
  stdout: Uint8Array;
  stderr: string;
}

/** Runs a program and collects its output. Rejects only if it cannot be started. */
export type SpawnFn = (command: string, args: string[], env: NodeJS.ProcessEnv) => Promise<SpawnResult>;

export interface BackupFile {
  filename: string;
  data: Uint8Array;
}

export interface CreateBackupOptions {
  databaseUrl: string;
  /** Default "pg_dump" (from PATH). */
  pgDumpPath?: string;
  now: Date;
  /** Zone for the filename; default UTC. Pass `settings.timezone`. */
  timezone?: string;
  spawn?: SpawnFn;
}

/** A pg_dump problem, with the message safe to show in a chat (no URL, no password). */
export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

export const spawnProcess: SpawnFn = (command, args, env) =>
  new Promise((resolve, reject) => {
    const child = nodeSpawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => out.push(c));
    child.stderr.on('data', (c: Buffer) => err.push(c));
    child.on('error', reject);
    child.on('close', (code) =>
      resolve({ code, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString('utf8') }),
    );
  });

/**
 * Moves the password out of the URL into PGPASSWORD, so it never shows in the process list.
 * Returns the secrets that must be scrubbed from any error text.
 */
function splitPassword(databaseUrl: string): { url: string; password: string | null; secrets: string[] } {
  const secrets = [databaseUrl];
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return { url: databaseUrl, password: null, secrets };
  }
  if (!parsed.password) return { url: databaseUrl, password: null, secrets };
  const password = decodeURIComponent(parsed.password);
  secrets.push(parsed.password, password);
  parsed.password = '';
  return { url: parsed.toString(), password, secrets };
}

function redact(text: string, secrets: string[]): string {
  return secrets.filter(Boolean).reduce((t, s) => t.split(s).join('***'), text);
}

export function backupFilename(now: Date, timezone = 'UTC'): string {
  return `pet-meds-${localDate(now, timezone)}-${localTime(now, timezone).replace(':', '')}.dump`;
}

export async function createBackup(opts: CreateBackupOptions): Promise<BackupFile> {
  const command = opts.pgDumpPath ?? 'pg_dump';
  const run = opts.spawn ?? spawnProcess;
  const { url, password, secrets } = splitPassword(opts.databaseUrl);
  const env = password === null ? process.env : { ...process.env, PGPASSWORD: password };

  let result: SpawnResult;
  try {
    result = await run(command, ['--format=custom', '--no-owner', '--dbname', url], env);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    throw new BackupError(redact(`could not run ${command} (is postgresql-client installed?): ${why}`, secrets));
  }
  if (result.code !== 0) {
    const detail = redact(result.stderr.trim(), secrets).slice(-600) || 'no error output';
    throw new BackupError(`${command} failed (exit ${String(result.code)}): ${detail}`);
  }
  if (result.stdout.byteLength === 0) throw new BackupError(`${command} succeeded but produced an empty dump`);
  return { filename: backupFilename(opts.now, opts.timezone), data: result.stdout };
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export type BackupOutcome = 'sent' | 'too_large';

/** Sends the dump to the backup chat, or a text warning if it is over Telegram's upload limit. */
export async function sendBackup(
  messenger: Messenger,
  settings: Pick<Settings, 'backupChatId' | 'timezone'>,
  backup: BackupFile,
  now: Date,
  log: (message: string) => void = console.warn,
): Promise<BackupOutcome> {
  const size = formatSize(backup.data.byteLength);
  const to = { chatId: settings.backupChatId };
  if (backup.data.byteLength > TELEGRAM_UPLOAD_LIMIT) {
    log(`backup: ${backup.filename} is ${size}, over Telegram's 50 MB bot limit; not sent`);
    await messenger.send(to, {
      text: `⚠️ Tonight's backup is ${size}, over Telegram's 50 MB limit for bots, so it was <b>not sent</b>. Take a dump on the server by hand.`,
      keyboard: [],
    });
    return 'too_large';
  }
  const when = `${localDate(now, settings.timezone)} ${localTime(now, settings.timezone)}`;
  await messenger.sendDocument(settings.backupChatId, backup.filename, backup.data, `Pet Meds backup · ${when} · ${size}`);
  return 'sent';
}

export type BackupRunResult = { status: BackupOutcome } | { status: 'failed'; error: string };

export interface RunBackupDeps {
  messenger: Messenger;
  settings: Pick<Settings, 'backupChatId' | 'timezone'>;
  databaseUrl: string;
  now: Date;
  pgDumpPath?: string;
  spawn?: SpawnFn;
  log?: (message: string) => void;
}

/**
 * Dump and send in one call; never throws. On any failure it alerts the backup chat.
 * The caller must record today as "done" after ANY result, or a failing dump alerts every minute.
 */
export async function runBackup(deps: RunBackupDeps): Promise<BackupRunResult> {
  const log = deps.log ?? console.warn;
  try {
    const backup = await createBackup({
      databaseUrl: deps.databaseUrl,
      pgDumpPath: deps.pgDumpPath,
      now: deps.now,
      timezone: deps.settings.timezone,
      spawn: deps.spawn,
    });
    return { status: await sendBackup(deps.messenger, deps.settings, backup, deps.now, log) };
  } catch (err) {
    const error = err instanceof BackupError ? err.message : `backup failed: ${err instanceof Error ? err.message : String(err)}`;
    log(`backup: ${error}`);
    await alert(deps, error, log);
    return { status: 'failed', error };
  }
}

async function alert(deps: RunBackupDeps, error: string, log: (message: string) => void): Promise<void> {
  try {
    await deps.messenger.send(
      { chatId: deps.settings.backupChatId },
      { text: `⚠️ Tonight's Pet Meds backup <b>failed</b>.\n<code>${escapeHtml(error)}</code>`, keyboard: [] },
    );
  } catch (sendErr) {
    log(`backup: could not send the failure alert: ${sendErr instanceof Error ? sendErr.message : String(sendErr)}`);
  }
}

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * True once per local day, at or after the backup time. If the bot was down at 03:00 it still
 * runs when it comes back that day. `lastRunDate` is the local date of the last attempt.
 */
export function backupDue(
  now: Date,
  settings: Pick<Settings, 'backupTime' | 'timezone'>,
  lastRunDate: LocalDate | null,
): boolean {
  if (lastRunDate !== null && lastRunDate >= localDate(now, settings.timezone)) return false;
  return localTime(now, settings.timezone) >= settings.backupTime;
}
