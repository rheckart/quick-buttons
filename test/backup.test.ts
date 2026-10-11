import { describe, expect, it } from 'vitest';
import {
  BackupError,
  TELEGRAM_UPLOAD_LIMIT,
  type SpawnFn,
  backupDue,
  backupFilename,
  createBackup,
  runBackup,
  sendBackup,
} from '../src/backup.js';
import type { Messenger, Rendered, Settings } from '../src/types.js';

const settings = { timezone: 'America/New_York', backupChatId: 4242, backupTime: '03:00' } satisfies Pick<
  Settings,
  'timezone' | 'backupChatId' | 'backupTime'
>;

// 2026-10-10 07:05 UTC = 03:05 in New York (EDT)
const NIGHT = new Date('2026-10-10T07:05:00Z');
const URL_WITH_PASSWORD = 'postgres://pet_meds:s3cr%40t!@db.internal:5432/pet_meds';

interface Seen {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

function fakeSpawn(result: { code: number | null; stdout?: Uint8Array; stderr?: string } | Error) {
  const seen: Seen[] = [];
  const spawn: SpawnFn = async (command, args, env) => {
    seen.push({ command, args, env });
    if (result instanceof Error) throw result;
    return { code: result.code, stdout: result.stdout ?? new Uint8Array(), stderr: result.stderr ?? '' };
  };
  return { spawn, seen };
}

function fakeMessenger() {
  const sent: { chatId: number; content: Rendered }[] = [];
  const docs: { chatId: number; filename: string; size: number; caption?: string }[] = [];
  const messenger: Messenger = {
    async send(to, content) {
      sent.push({ chatId: to.chatId, content });
      return 1;
    },
    async edit() {
      return true;
    },
    async delete() {},
    async pin() {},
    async sendDocument(chatId, filename, data, caption) {
      docs.push({ chatId, filename, size: data.byteLength, caption });
    },
  };
  return { messenger, sent, docs };
}

describe('backupFilename', () => {
  it('uses the local date and time', () => {
    expect(backupFilename(NIGHT, 'America/New_York')).toBe('pet-meds-2026-10-10-0305.dump');
    expect(backupFilename(NIGHT)).toBe('pet-meds-2026-10-10-0705.dump');
  });
});

describe('createBackup', () => {
  it('runs pg_dump in custom format and returns the bytes', async () => {
    const dump = new Uint8Array([80, 71, 68, 77, 80]);
    const { spawn, seen } = fakeSpawn({ code: 0, stdout: dump });
    const out = await createBackup({ databaseUrl: 'postgres://u@h/db', now: NIGHT, timezone: 'America/New_York', spawn });
    expect(out).toEqual({ filename: 'pet-meds-2026-10-10-0305.dump', data: dump });
    expect(seen[0]!.command).toBe('pg_dump');
    expect(seen[0]!.args).toEqual(['--format=custom', '--no-owner', '--dbname', 'postgres://u@h/db']);
  });

  it('honours pgDumpPath', async () => {
    const { spawn, seen } = fakeSpawn({ code: 0, stdout: new Uint8Array([1]) });
    await createBackup({ databaseUrl: 'postgres://u@h/db', pgDumpPath: '/opt/pg/bin/pg_dump', now: NIGHT, spawn });
    expect(seen[0]!.command).toBe('/opt/pg/bin/pg_dump');
  });

  it('passes the password via PGPASSWORD, not on the command line', async () => {
    const { spawn, seen } = fakeSpawn({ code: 0, stdout: new Uint8Array([1]) });
    await createBackup({ databaseUrl: URL_WITH_PASSWORD, now: NIGHT, spawn });
    expect(seen[0]!.env.PGPASSWORD).toBe('s3cr@t!');
    expect(seen[0]!.args.join(' ')).not.toContain('s3cr');
    expect(seen[0]!.args.at(-1)).toBe('postgres://pet_meds@db.internal:5432/pet_meds');
    expect(seen[0]!.env.PATH).toBe(process.env.PATH);
  });

  it('gives a clear error and never leaks the URL or password when pg_dump fails', async () => {
    const stderr = `pg_dump: error: connection to server failed: ${URL_WITH_PASSWORD}\npassword s3cr@t! rejected`;
    const { spawn } = fakeSpawn({ code: 1, stderr });
    const err = await createBackup({ databaseUrl: URL_WITH_PASSWORD, now: NIGHT, spawn }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BackupError);
    const message = (err as Error).message;
    expect(message).toContain('pg_dump failed (exit 1)');
    expect(message).not.toContain('s3cr');
    expect(message).not.toContain('db.internal:5432/pet_meds');
  });

  it('explains a missing pg_dump', async () => {
    const { spawn } = fakeSpawn(new Error('spawn pg_dump ENOENT'));
    await expect(createBackup({ databaseUrl: 'postgres://u@h/db', now: NIGHT, spawn })).rejects.toThrow(
      /could not run pg_dump.*postgresql-client/,
    );
  });

  it('rejects an empty dump', async () => {
    const { spawn } = fakeSpawn({ code: 0 });
    await expect(createBackup({ databaseUrl: 'postgres://u@h/db', now: NIGHT, spawn })).rejects.toThrow(/empty dump/);
  });
});

describe('sendBackup', () => {
  it('sends the file to the backup chat with size and time in the caption', async () => {
    const m = fakeMessenger();
    const file = { filename: 'pet-meds-2026-10-10-0305.dump', data: new Uint8Array(2048) };
    expect(await sendBackup(m.messenger, settings, file, NIGHT)).toBe('sent');
    expect(m.docs).toEqual([
      { chatId: 4242, filename: file.filename, size: 2048, caption: 'Pet Meds backup · 2026-10-10 03:05 · 2.0 KB' },
    ]);
    expect(m.sent).toHaveLength(0);
  });

  it('warns in text, and logs, when the dump is over 50 MB', async () => {
    const m = fakeMessenger();
    const logs: string[] = [];
    const file = { filename: 'big.dump', data: new Uint8Array(TELEGRAM_UPLOAD_LIMIT + 1) };
    expect(await sendBackup(m.messenger, settings, file, NIGHT, (l) => logs.push(l))).toBe('too_large');
    expect(m.docs).toHaveLength(0);
    expect(m.sent).toHaveLength(1);
    expect(m.sent[0]!.chatId).toBe(4242);
    expect(m.sent[0]!.content.text).toContain('50 MB');
    expect(logs).toHaveLength(1);
  });

  it('still sends a file of exactly 50 MB', async () => {
    const m = fakeMessenger();
    const file = { filename: 'edge.dump', data: new Uint8Array(TELEGRAM_UPLOAD_LIMIT) };
    expect(await sendBackup(m.messenger, settings, file, NIGHT)).toBe('sent');
  });
});

describe('runBackup', () => {
  const quiet = () => {};

  it('dumps and sends', async () => {
    const m = fakeMessenger();
    const { spawn } = fakeSpawn({ code: 0, stdout: new Uint8Array(10) });
    const result = await runBackup({ messenger: m.messenger, settings, databaseUrl: 'postgres://u@h/db', now: NIGHT, spawn, log: quiet });
    expect(result).toEqual({ status: 'sent' });
    expect(m.docs[0]!.filename).toBe('pet-meds-2026-10-10-0305.dump');
  });

  it('alerts the backup chat when pg_dump fails, without leaking the password', async () => {
    const m = fakeMessenger();
    const { spawn } = fakeSpawn({ code: 1, stderr: 'FATAL: password authentication failed for user "pet_meds" <s3cr@t!>' });
    const result = await runBackup({ messenger: m.messenger, settings, databaseUrl: URL_WITH_PASSWORD, now: NIGHT, spawn, log: quiet });
    expect(result.status).toBe('failed');
    expect(m.docs).toHaveLength(0);
    expect(m.sent).toHaveLength(1);
    expect(m.sent[0]!.chatId).toBe(4242);
    expect(m.sent[0]!.content.text).toContain('failed');
    expect(m.sent[0]!.content.text).toContain('password authentication failed');
    expect(m.sent[0]!.content.text).not.toContain('s3cr');
  });

  it('alerts when the upload itself fails, and does not throw if the alert also fails', async () => {
    const m = fakeMessenger();
    m.messenger.sendDocument = async () => {
      throw new Error('boom');
    };
    m.messenger.send = async () => {
      throw new Error('alert down');
    };
    const { spawn } = fakeSpawn({ code: 0, stdout: new Uint8Array(10) });
    const logs: string[] = [];
    const result = await runBackup({
      messenger: m.messenger,
      settings,
      databaseUrl: 'postgres://u@h/db',
      now: NIGHT,
      spawn,
      log: (l) => logs.push(l),
    });
    expect(result).toMatchObject({ status: 'failed', error: expect.stringContaining('boom') });
    expect(logs.some((l) => l.includes('alert down'))).toBe(true);
  });
});

describe('backupDue', () => {
  const at = (iso: string) => new Date(iso);
  // New York is UTC-4 in October (EDT)
  it('is not due before the backup time', () => {
    expect(backupDue(at('2026-10-10T06:59:00Z'), settings, '2026-10-09')).toBe(false); // 02:59 local
  });

  it('is due at the backup time', () => {
    expect(backupDue(at('2026-10-10T07:00:00Z'), settings, '2026-10-09')).toBe(true); // 03:00 local
  });

  it('is due late in the day if the bot was down at 03:00', () => {
    expect(backupDue(at('2026-10-10T22:30:00Z'), settings, '2026-10-09')).toBe(true);
  });

  it('runs once per local day', () => {
    expect(backupDue(at('2026-10-10T07:05:00Z'), settings, '2026-10-10')).toBe(false);
    expect(backupDue(at('2026-10-10T23:00:00Z'), settings, '2026-10-10')).toBe(false);
  });

  it('is due on the first run ever', () => {
    expect(backupDue(at('2026-10-10T12:00:00Z'), settings, null)).toBe(true);
  });

  it('uses the local day, not the UTC day', () => {
    // 2026-10-11 02:30 UTC is still 2026-10-10 22:30 in New York: already done today
    expect(backupDue(at('2026-10-11T02:30:00Z'), settings, '2026-10-10')).toBe(false);
    // 2026-10-11 07:00 UTC is 03:00 on the 11th local: due again
    expect(backupDue(at('2026-10-11T07:00:00Z'), settings, '2026-10-10')).toBe(true);
  });
});
