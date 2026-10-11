// Usage: pnpm tsx scripts/migrate-cli.ts <database-url>
// Applies the app's schema to a database. Safe to run again.
import { migrate } from '../src/db/migrate.js';
import { createPgDb } from '../src/db/pg.js';

const url = process.argv[2] ?? process.env.DATABASE_URL;
if (!url) {
  console.error('usage: migrate-cli.ts <database-url>');
  process.exit(2);
}

const db = createPgDb(url);
try {
  await migrate(db);
  console.log('migrated');
} finally {
  await db.close();
}
