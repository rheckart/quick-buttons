// Usage: pnpm tsx scripts/pg-check.ts <database-url>   (database must already be migrated)
// Exercises the real `pg` implementation: select, bigint ids, commit, rollback, nested tx, repos.
// Leaves one committed sample of every kind of row behind (used by backup-restore-check.sh).
import { createRepos } from '../src/db/repos-impl.js';
import { createPgDb } from '../src/db/pg.js';

const url = process.argv[2] ?? process.env.DATABASE_URL;
if (!url) {
  console.error('usage: pg-check.ts <database-url>');
  process.exit(2);
}

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || detail === undefined ? '' : ` -> ${JSON.stringify(detail)}`}`);
}

const GROUP = -1001234567890; // exceeds int32
const USER = 5_000_000_123; // exceeds int32
const at = new Date('2026-10-10T12:00:00Z');
const db = createPgDb(url);

try {
  const [sel] = await db.query<{ n: number; t: string }>('SELECT 41 + $1::int AS n, $2::text AS t', [1, 'hi']);
  check('select with params', sel?.n === 42 && sel.t === 'hi', sel);

  const [big] = await db.query<{ v: unknown }>('SELECT $1::bigint AS v', [String(GROUP)]);
  check('bigint comes back as a number', big?.v === GROUP, big);

  const [ts] = await db.query<{ d: unknown; a: unknown }>("SELECT now() AS d, ARRAY['a','b'] AS a");
  check('timestamptz is a Date, text[] is an array', ts?.d instanceof Date && Array.isArray(ts.a), ts);

  await db.query('CREATE TABLE IF NOT EXISTS pgcheck_t (x int)');
  await db.query('TRUNCATE pgcheck_t');
  await db.tx(async (tx) => void (await tx.query('INSERT INTO pgcheck_t VALUES (1)')));
  const committed = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM pgcheck_t');
  check('tx commits', committed[0]?.n === 1, committed);

  const boom = new Error('boom');
  const caught = await db
    .tx(async (tx) => {
      await tx.query('INSERT INTO pgcheck_t VALUES (2)');
      throw boom;
    })
    .catch((e: unknown) => e);
  const afterRollback = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM pgcheck_t');
  check('tx rolls back and rethrows', caught === boom && afterRollback[0]?.n === 1, { caught: String(caught), afterRollback });

  const nestedCaught = await db
    .tx(async (outer) => {
      await outer.tx(async (inner) => void (await inner.query('INSERT INTO pgcheck_t VALUES (3)')));
      throw boom;
    })
    .catch((e: unknown) => e);
  const afterNested = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM pgcheck_t');
  check('nested tx shares the outer transaction', nestedCaught === boom && afterNested[0]?.n === 1, afterNested);

  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) => db.tx(async (tx) => (await tx.query<{ n: number }>('SELECT $1::int AS n', [i]))[0]?.n)),
  );
  check('concurrent transactions (pool of 5)', results.join() === '0,1,2,3,4,5,6,7', results);
  await db.query('DROP TABLE pgcheck_t');

  // Real rows through the repos, including ids that do not fit in 32 bits.
  const repos = createRepos(db);
  const rob = { userId: USER, name: 'Rob' };
  const med = await repos.meds.insert({
    petId: 'twiggy', name: 'Eye drops', kind: 'ongoing', doseNote: '2 drops', roundKeys: ['morning'],
    days: null, startedOn: null, seedLastGiven: null, createdAt: at,
  });
  const entry = await repos.entries.create({
    petId: 'twiggy', roundKey: 'morning', forDate: '2026-10-10', givenAt: at, loggedAt: at, by: rob,
    items: [{ medId: med.id, status: 'given' }],
  });
  const edited = await repos.entries.revise(entry.id, { kind: 'edit', by: rob, at, givenAt: new Date('2026-10-10T11:45:00Z') });
  const revs = await repos.entries.revisions(entry.id);
  check('entry with a >32-bit user id round-trips', edited.loggedBy.userId === USER && revs.length === 2, { by: edited.loggedBy, revs: revs.length });

  const msg = await repos.messages.insert({
    kind: 'board', petId: 'twiggy', roundKey: null, medId: null, forDate: null,
    chatId: GROUP, threadId: 11, messageId: 900, renderHash: 'h', createdAt: at,
  });
  const back = await repos.messages.get(msg.id);
  check('bot message with a >32-bit chat id round-trips', back?.chatId === GROUP && back.threadId === 11, back);

  await repos.ui.set('check', { nested: [1, 2, { ok: true }] }, at);
  const ui = await repos.ui.get<{ nested: unknown[] }>('check');
  check('ui_state jsonb round-trips', ui?.nested.length === 3, ui);
} finally {
  await db.close();
}

if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('pg-check: all good');
