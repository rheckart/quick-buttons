// Usage: pnpm tsx scripts/backup-cli.ts <database-url> <out-file> [time-zone]
// Takes a dump exactly the way the nightly job does (src/backup.ts) and writes it to a file.
// Set PG_DUMP_PATH to use a pg_dump that is not on PATH.
// The file name uses UTC unless a time zone (e.g. America/New_York) is given; the nightly job names its
// files in the `timezone` of settings.yaml.
import { writeFile } from 'node:fs/promises';
import { createBackup } from '../src/backup.js';

const [url, out, timezone] = process.argv.slice(2);
if (!url || !out) {
  console.error('usage: backup-cli.ts <database-url> <out-file> [time-zone]');
  process.exit(2);
}

const backup = await createBackup({ databaseUrl: url, pgDumpPath: process.env.PG_DUMP_PATH, now: new Date(), timezone });
await writeFile(out, backup.data);
console.log(`${backup.filename}: ${backup.data.byteLength} bytes -> ${out}`);
