import { createPgliteDb } from '../../src/db/pglite.js';
import { migrate } from '../../src/db/migrate.js';
import type { Db } from '../../src/types.js';

/** Fresh in-memory Postgres with all migrations applied. Call `db.close()` when done. */
export async function makeTestDb(): Promise<Db> {
  const db = await createPgliteDb();
  await migrate(db);
  return db;
}
