import { PGlite } from '@electric-sql/pglite';
import type { Db } from '../types.js';

type Queryable = Pick<PGlite, 'query' | 'exec'>;

function wrap(q: Queryable, tx: Db['tx'], close: Db['close']): Db {
  return {
    async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
      // Without params use the simple protocol, which (like `pg`) allows multi-statement SQL such as migrations.
      if (params === undefined) {
        const results = await q.exec(sql);
        return (results.at(-1)?.rows ?? []) as T[];
      }
      return (await q.query<T>(sql, params)).rows;
    },
    tx,
    close,
  };
}

/** In-memory Postgres for tests. Same `Db` semantics as the `pg` impl. */
export async function createPgliteDb(): Promise<Db> {
  const lite = await PGlite.create();
  return wrap(
    lite,
    (fn) =>
      lite.transaction((t) => {
        const db: Db = wrap(
          t,
          (inner) => inner(db),
          async () => {},
        );
        return fn(db);
      }),
    () => lite.close(),
  );
}
