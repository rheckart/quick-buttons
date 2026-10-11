import type {
  BotMessage,
  Db,
  EntryItem,
  EntryRevision,
  LogEntry,
  Med,
  Person,
  RevisionKind,
} from '../types.js';
import type {
  EntriesRepo,
  MedPatch,
  MedsRepo,
  MessageQuery,
  MessagesRepo,
  Repos,
  UiStateRepo,
} from './repos.js';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const num = (v: unknown): number => Number(v);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** Repositories over `db`. Build them from a `db.tx` handle to run them inside that transaction. */
export function createRepos(db: Db): Repos {
  return {
    meds: medsRepo(db),
    entries: entriesRepo(db),
    messages: messagesRepo(db),
    ui: uiStateRepo(db),
  };
}

// ───────────────────────── meds ─────────────────────────

function toMed(r: Row): Med {
  return {
    id: num(r.id),
    petId: r.pet_id,
    name: r.name,
    kind: r.kind,
    doseNote: r.dose_note,
    roundKeys: r.round_keys,
    days: numOrNull(r.days),
    startedOn: r.started_on,
    seedLastGiven: r.seed_last_given,
    createdAt: r.created_at,
    stoppedAt: r.stopped_at,
  };
}

const MED_COLUMNS: Record<keyof MedPatch, { column: string; cast: string }> = {
  name: { column: 'name', cast: '' },
  doseNote: { column: 'dose_note', cast: '' },
  roundKeys: { column: 'round_keys', cast: '::text[]' },
  days: { column: 'days', cast: '' },
  startedOn: { column: 'started_on', cast: '' },
  seedLastGiven: { column: 'seed_last_given', cast: '' },
};

function medsRepo(db: Db): MedsRepo {
  const one = async (id: number): Promise<Med | null> => {
    const rows = await db.query<Row>('SELECT * FROM meds WHERE id = $1', [id]);
    return rows[0] ? toMed(rows[0]) : null;
  };
  const must = async (id: number): Promise<Med> => {
    const med = await one(id);
    if (!med) throw new Error(`med ${id} not found`);
    return med;
  };

  return {
    async insert(input) {
      const rows = await db.query<Row>(
        `INSERT INTO meds (pet_id, name, kind, dose_note, round_keys, days, started_on, seed_last_given, created_at)
         VALUES ($1, $2, $3, $4, $5::text[], $6, $7, $8, $9) RETURNING *`,
        [
          input.petId,
          input.name,
          input.kind,
          input.doseNote,
          input.roundKeys,
          input.days,
          input.startedOn,
          input.seedLastGiven,
          input.createdAt,
        ],
      );
      return toMed(rows[0]!);
    },

    get: one,

    async listForPet(petId) {
      const rows = await db.query<Row>('SELECT * FROM meds WHERE pet_id = $1 ORDER BY id', [petId]);
      return rows.map(toMed);
    },

    async listActive(petId) {
      const rows = await db.query<Row>(
        'SELECT * FROM meds WHERE stopped_at IS NULL AND ($1::text IS NULL OR pet_id = $1) ORDER BY id',
        [petId ?? null],
      );
      return rows.map(toMed);
    },

    async update(id, patch) {
      const keys = (Object.keys(patch) as (keyof MedPatch)[]).filter((k) => patch[k] !== undefined);
      if (keys.length === 0) return must(id);
      const sets = keys.map((k, i) => `${MED_COLUMNS[k].column} = $${i + 2}${MED_COLUMNS[k].cast}`);
      const rows = await db.query<Row>(`UPDATE meds SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, [
        id,
        ...keys.map((k) => patch[k]),
      ]);
      if (!rows[0]) throw new Error(`med ${id} not found`);
      return toMed(rows[0]);
    },

    async stop(id, at) {
      const rows = await db.query<Row>('UPDATE meds SET stopped_at = $2 WHERE id = $1 RETURNING *', [id, at]);
      if (!rows[0]) throw new Error(`med ${id} not found`);
      return toMed(rows[0]);
    },
  };
}

// ───────────────────────── log entries ─────────────────────────

const person = (id: unknown, name: string): Person => ({ userId: num(id), name });

async function itemsByEntry(db: Db, entryIds: number[]): Promise<Map<number, EntryItem[]>> {
  const byEntry = new Map<number, EntryItem[]>(entryIds.map((id) => [id, []]));
  if (entryIds.length === 0) return byEntry;
  const rows = await db.query<Row>(
    'SELECT entry_id, med_id, status FROM log_entry_items WHERE entry_id = ANY($1::int[]) ORDER BY entry_id, med_id',
    [entryIds],
  );
  for (const r of rows) byEntry.get(num(r.entry_id))!.push({ medId: num(r.med_id), status: r.status });
  return byEntry;
}

async function hydrateEntries(db: Db, rows: Row[]): Promise<LogEntry[]> {
  const items = await itemsByEntry(db, rows.map((r) => num(r.id)));
  return rows.map((r) => ({
    id: num(r.id),
    petId: r.pet_id,
    roundKey: r.round_key,
    forDate: r.for_date,
    givenAt: r.given_at,
    loggedAt: r.logged_at,
    loggedBy: person(r.logged_by_id, r.logged_by_name),
    items: items.get(num(r.id))!,
    undone: r.undone,
    lastRevision: {
      kind: r.last_rev_kind as RevisionKind,
      by: person(r.last_rev_by_id, r.last_rev_by_name),
      at: r.last_rev_at,
    },
    recordMessageId: numOrNull(r.record_message_id),
  }));
}

/** Items are read back ordered by med id, so snapshots use the same order. */
const sortItems = (items: EntryItem[]): EntryItem[] => [...items].sort((a, b) => a.medId - b.medId);

async function insertItems(db: Db, entryId: number, items: EntryItem[]): Promise<void> {
  for (const item of items) {
    await db.query('INSERT INTO log_entry_items (entry_id, med_id, status) VALUES ($1, $2, $3)', [
      entryId,
      item.medId,
      item.status,
    ]);
  }
}

async function insertRevision(
  db: Db,
  rev: { entryId: number; rev: number; kind: RevisionKind; by: Person; at: Date; givenAt: Date; items: EntryItem[]; undone: boolean },
): Promise<void> {
  await db.query(
    `INSERT INTO log_entry_revisions (entry_id, rev, kind, by_id, by_name, at, given_at, items, undone)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
    [rev.entryId, rev.rev, rev.kind, rev.by.userId, rev.by.name, rev.at, rev.givenAt, JSON.stringify(sortItems(rev.items)), rev.undone],
  );
}

function entriesRepo(db: Db): EntriesRepo {
  const get = async (id: number): Promise<LogEntry | null> => {
    const rows = await db.query<Row>('SELECT * FROM log_entries WHERE id = $1', [id]);
    return (await hydrateEntries(db, rows))[0] ?? null;
  };

  return {
    create: (input) =>
      db.tx(async (tx) => {
        const rows = await tx.query<Row>(
          `INSERT INTO log_entries
             (pet_id, round_key, for_date, given_at, logged_at, logged_by_id, logged_by_name,
              last_rev_kind, last_rev_by_id, last_rev_by_name, last_rev_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'create', $6, $7, $5) RETURNING id`,
          [input.petId, input.roundKey, input.forDate, input.givenAt, input.loggedAt, input.by.userId, input.by.name],
        );
        const entryId = num(rows[0]!.id);
        await insertItems(tx, entryId, input.items);
        await insertRevision(tx, {
          entryId,
          rev: 1,
          kind: 'create',
          by: input.by,
          at: input.loggedAt,
          givenAt: input.givenAt,
          items: input.items,
          undone: false,
        });
        return (await createRepos(tx).entries.get(entryId))!;
      }),

    get,

    revise: (id, input) =>
      db.tx(async (tx) => {
        const locked = await tx.query<Row>('SELECT * FROM log_entries WHERE id = $1 FOR UPDATE', [id]);
        if (!locked[0]) throw new Error(`entry ${id} not found`);
        const repo = createRepos(tx).entries;
        const current = (await repo.get(id))!;

        if (input.kind === 'edit' && current.undone) throw new Error(`entry ${id} is undone and cannot be edited`);
        if (input.kind === 'undo' && current.undone) return current;

        const givenAt = (input.kind === 'edit' && input.givenAt) || current.givenAt;
        const items = (input.kind === 'edit' && input.items) || current.items;
        const undone = input.kind === 'undo';

        await tx.query(
          `UPDATE log_entries SET given_at = $2, undone = $3,
             last_rev_kind = $4, last_rev_by_id = $5, last_rev_by_name = $6, last_rev_at = $7
           WHERE id = $1`,
          [id, givenAt, undone, input.kind, input.by.userId, input.by.name, input.at],
        );
        if (input.kind === 'edit' && input.items) {
          await tx.query('DELETE FROM log_entry_items WHERE entry_id = $1', [id]);
          await insertItems(tx, id, input.items);
        }
        const [{ next }] = await tx.query<{ next: number }>(
          'SELECT COALESCE(MAX(rev), 0) + 1 AS next FROM log_entry_revisions WHERE entry_id = $1',
          [id],
        ) as [{ next: number }];
        await insertRevision(tx, { entryId: id, rev: num(next), kind: input.kind, by: input.by, at: input.at, givenAt, items, undone });
        return (await repo.get(id))!;
      }),

    async setRecordMessage(id, messageId) {
      await db.query('UPDATE log_entries SET record_message_id = $2 WHERE id = $1', [id, messageId]);
    },

    async listForPet(petId, opts = {}) {
      const rows = await db.query<Row>(
        `SELECT * FROM log_entries
         WHERE pet_id = $1 AND ($2::text IS NULL OR for_date >= $2) AND ($3 OR NOT undone)
         ORDER BY given_at, id`,
        [petId, opts.sinceDate ?? null, opts.includeUndone ?? false],
      );
      return hydrateEntries(db, rows);
    },

    async listForOccurrence(petId, roundKey, forDate) {
      const rows = await db.query<Row>(
        `SELECT * FROM log_entries
         WHERE pet_id = $1 AND round_key IS NOT DISTINCT FROM $2::text AND for_date = $3 AND NOT undone
         ORDER BY given_at, id`,
        [petId, roundKey, forDate],
      );
      return hydrateEntries(db, rows);
    },

    async revisions(entryId): Promise<EntryRevision[]> {
      const rows = await db.query<Row>('SELECT * FROM log_entry_revisions WHERE entry_id = $1 ORDER BY rev', [entryId]);
      return rows.map((r) => ({
        entryId: num(r.entry_id),
        rev: num(r.rev),
        kind: r.kind,
        by: person(r.by_id, r.by_name),
        at: r.at,
        givenAt: r.given_at,
        items: r.items,
        undone: r.undone,
      }));
    },
  };
}

// ───────────────────────── bot messages ─────────────────────────

function toBotMessage(r: Row): BotMessage {
  return {
    id: num(r.id),
    kind: r.kind,
    petId: r.pet_id,
    roundKey: r.round_key,
    medId: numOrNull(r.med_id),
    forDate: r.for_date,
    chatId: num(r.chat_id),
    threadId: numOrNull(r.thread_id),
    messageId: num(r.message_id),
    renderHash: r.render_hash,
    createdAt: r.created_at,
    deletedAt: r.deleted_at,
  };
}

const MESSAGE_FILTERS = [
  ['petId', 'pet_id'],
  ['roundKey', 'round_key'],
  ['medId', 'med_id'],
  ['forDate', 'for_date'],
] as const;

function messagesRepo(db: Db): MessagesRepo {
  const find = async (q: MessageQuery, includeDeleted: boolean): Promise<BotMessage[]> => {
    const where = ['kind = $1'];
    const params: unknown[] = [q.kind];
    for (const [field, column] of MESSAGE_FILTERS) {
      const value = q[field];
      if (value === undefined) continue;
      if (value === null) {
        where.push(`${column} IS NULL`);
      } else {
        params.push(value);
        where.push(`${column} = $${params.length}`);
      }
    }
    if (!includeDeleted) where.push('deleted_at IS NULL');
    const rows = await db.query<Row>(`SELECT * FROM bot_messages WHERE ${where.join(' AND ')} ORDER BY id`, params);
    return rows.map(toBotMessage);
  };

  return {
    async insert(input) {
      const rows = await db.query<Row>(
        `INSERT INTO bot_messages
           (kind, pet_id, round_key, med_id, for_date, chat_id, thread_id, message_id, render_hash, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [
          input.kind,
          input.petId,
          input.roundKey,
          input.medId,
          input.forDate,
          input.chatId,
          input.threadId,
          input.messageId,
          input.renderHash,
          input.createdAt,
        ],
      );
      return toBotMessage(rows[0]!);
    },

    async get(id) {
      const rows = await db.query<Row>('SELECT * FROM bot_messages WHERE id = $1', [id]);
      return rows[0] ? toBotMessage(rows[0]) : null;
    },

    findLive: (q) => find(q, false),
    findAny: (q) => find(q, true),

    async setRenderHash(id, hash) {
      await db.query('UPDATE bot_messages SET render_hash = $2 WHERE id = $1', [id, hash]);
    },

    async markDeleted(id, at) {
      await db.query('UPDATE bot_messages SET deleted_at = $2 WHERE id = $1', [id, at]);
    },
  };
}

// ───────────────────────── ui state ─────────────────────────

function uiStateRepo(db: Db): UiStateRepo {
  return {
    async get<T = unknown>(key: string) {
      const rows = await db.query<{ value: T }>('SELECT value FROM ui_state WHERE key = $1', [key]);
      return rows[0] ? rows[0].value : null;
    },

    async set(key, value, at) {
      await db.query(
        `INSERT INTO ui_state (key, value, updated_at) VALUES ($1, $2::jsonb, $3)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
        [key, JSON.stringify(value ?? null), at],
      );
    },

    async delete(key) {
      await db.query('DELETE FROM ui_state WHERE key = $1', [key]);
    },

    async deleteOlderThan(before) {
      const rows = await db.query('DELETE FROM ui_state WHERE updated_at < $1 RETURNING key', [before]);
      return rows.length;
    },
  };
}
