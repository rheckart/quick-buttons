import pg from 'pg';
import type { Db } from '../types.js';

const INT8_OID = 20;

/** Per-pool type parsing (no global side effects): int8 -> number. Chat/user ids fit in 2^53. */
const types = {
  getTypeParser(oid: number, format?: 'text' | 'binary') {
    if (oid === INT8_OID) return (v: string) => Number(v);
    return pg.types.getTypeParser(oid, format as 'text');
  },
} as unknown as pg.CustomTypesConfig;

type Queryable = Pick<pg.Pool | pg.PoolClient, 'query'>;

function wrap(q: Queryable, tx: Db['tx'], close: Db['close']): Db {
  return {
    async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
      const res = await q.query(sql, params);
      return res.rows as T[];
    },
    tx,
    close,
  };
}

export interface PgOptions {
  /** Where pool errors go (main passes its redacting logger). Default: console.error. */
  logger?: { error(message: string, err?: unknown): void };
}

/** Db over a `pg` Pool. `tx` pins one client for BEGIN..COMMIT; a nested `tx` reuses that client. */
export function createPgDb(connectionString: string, options: PgOptions = {}): Db {
  const pool = new pg.Pool({ connectionString, types, max: 5 });
  // An idle client dying (server restart, network) must not crash the process.
  pool.on('error', (err) => {
    if (options.logger) options.logger.error('database connection error', err);
    else console.error('pg pool error:', err.message);
  });

  const txDb = (client: pg.PoolClient): Db => {
    const db: Db = wrap(
      client,
      (fn) => fn(db),
      async () => {},
    );
    return db;
  };

  return wrap(
    pool,
    async (fn) => {
      const client = await pool.connect();
      let failure: unknown;
      try {
        await client.query('BEGIN');
        const result = await fn(txDb(client));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        failure = err;
        try {
          await client.query('ROLLBACK');
        } catch {
          // connection is broken; release(true) below discards it
        }
        throw err;
      } finally {
        client.release(failure === undefined ? undefined : true);
      }
    },
    () => pool.end(),
  );
}
