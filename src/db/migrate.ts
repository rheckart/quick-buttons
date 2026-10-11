import type { Db } from '../types.js';
import { migrations } from './schema.js';

/** Applies pending migrations in id order, recording each in `schema_migrations`. Safe to run repeatedly. */
export async function migrate(db: Db): Promise<void> {
  await db.tx(async (tx) => {
    await tx.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      id integer PRIMARY KEY,
      name text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const done = new Set((await tx.query<{ id: number }>('SELECT id FROM schema_migrations')).map((r) => Number(r.id)));
    for (const m of [...migrations].sort((a, b) => a.id - b.id)) {
      if (done.has(m.id)) continue;
      await tx.query(m.sql);
      await tx.query('INSERT INTO schema_migrations (id, name) VALUES ($1, $2)', [m.id, m.name]);
    }
  });
}
