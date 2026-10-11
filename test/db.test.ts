import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRepos } from '../src/db/repos-impl.js';
import { migrate } from '../src/db/migrate.js';
import { createPgliteDb } from '../src/db/pglite.js';
import type { NewBotMessage, NewEntry, NewMed, Repos } from '../src/db/repos.js';
import type { Db, Person } from '../src/types.js';
import { makeTestDb } from './helpers/testDb.js';

const rob: Person = { userId: 5_000_000_000, name: 'Rob' };
const dani: Person = { userId: 42, name: 'Danielle' };
const at = (s: string) => new Date(`2026-10-10T${s}:00Z`);

const newMed = (over: Partial<NewMed> = {}): NewMed => ({
  petId: 'twiggy',
  name: 'Eye drops',
  kind: 'ongoing',
  doseNote: '2 drops each eye',
  roundKeys: ['morning'],
  days: null,
  startedOn: null,
  seedLastGiven: null,
  createdAt: at('08:00'),
  ...over,
});

const newEntry = (over: Partial<NewEntry> = {}): NewEntry => ({
  petId: 'twiggy',
  roundKey: 'morning',
  forDate: '2026-10-10',
  givenAt: at('12:15'),
  loggedAt: at('12:20'),
  by: rob,
  items: [{ medId: 1, status: 'given' }],
  ...over,
});

const newMessage = (over: Partial<NewBotMessage> = {}): NewBotMessage => ({
  kind: 'reminder',
  petId: 'twiggy',
  roundKey: 'morning',
  medId: null,
  forDate: '2026-10-10',
  chatId: -1001234567890,
  threadId: 7,
  messageId: 100,
  renderHash: 'h1',
  createdAt: at('12:00'),
  ...over,
});

let db: Db;
let repos: Repos;

beforeEach(async () => {
  db = await makeTestDb();
  repos = createRepos(db);
});
afterEach(() => db.close());

describe('migrate', () => {
  it('is idempotent and records applied migrations', async () => {
    await migrate(db);
    await migrate(db);
    const rows = await db.query<{ id: number; name: string }>('SELECT id, name FROM schema_migrations');
    expect(rows).toEqual([{ id: 1, name: 'initial' }]);
  });

  it('a fresh database gets the schema', async () => {
    const fresh = await createPgliteDb();
    await migrate(fresh);
    expect(await createRepos(fresh).meds.listActive()).toEqual([]);
    await fresh.close();
  });
});

describe('meds', () => {
  it('inserts and reads back every field, arrays included', async () => {
    const med = await repos.meds.insert(
      newMed({ kind: 'course', roundKeys: ['morning', 'evening'], days: 10, startedOn: '2026-10-01' }),
    );
    expect(med).toEqual({
      id: 1,
      petId: 'twiggy',
      name: 'Eye drops',
      kind: 'course',
      doseNote: '2 drops each eye',
      roundKeys: ['morning', 'evening'],
      days: 10,
      startedOn: '2026-10-01',
      seedLastGiven: null,
      createdAt: at('08:00'),
      stoppedAt: null,
    });
    expect(await repos.meds.get(1)).toEqual(med);
    expect(await repos.meds.get(99)).toBeNull();
  });

  it('round-trips an empty roundKeys array and null dose note', async () => {
    const med = await repos.meds.insert(newMed({ kind: 'monthly', roundKeys: [], doseNote: null, seedLastGiven: '2026-09-14' }));
    expect(med.roundKeys).toEqual([]);
    expect(med.doseNote).toBeNull();
    expect(med.seedLastGiven).toBe('2026-09-14');
  });

  it('lists per pet (stopped included) and active (stopped excluded), ordered by id', async () => {
    const a = await repos.meds.insert(newMed({ name: 'A' }));
    const b = await repos.meds.insert(newMed({ name: 'B', petId: 'faith' }));
    const c = await repos.meds.insert(newMed({ name: 'C' }));
    await repos.meds.stop(a.id, at('09:00'));
    expect((await repos.meds.listForPet('twiggy')).map((m) => m.name)).toEqual(['A', 'C']);
    expect((await repos.meds.listActive()).map((m) => m.id)).toEqual([b.id, c.id]);
    expect((await repos.meds.listActive('twiggy')).map((m) => m.id)).toEqual([c.id]);
    expect((await repos.meds.listActive('nobody'))).toEqual([]);
  });

  it('update patches only given fields and can set values to null', async () => {
    const med = await repos.meds.insert(newMed({ kind: 'course', days: 10, roundKeys: ['morning'] }));
    const updated = await repos.meds.update(med.id, { days: 14, roundKeys: ['morning', 'evening'], doseNote: null });
    expect(updated).toMatchObject({ days: 14, roundKeys: ['morning', 'evening'], doseNote: null, name: 'Eye drops' });
    expect(await repos.meds.update(med.id, {})).toEqual(updated);
    await expect(repos.meds.update(999, { name: 'x' })).rejects.toThrow();
  });

  it('stop sets stoppedAt', async () => {
    const med = await repos.meds.insert(newMed());
    expect((await repos.meds.stop(med.id, at('10:00'))).stoppedAt).toEqual(at('10:00'));
    await expect(repos.meds.stop(999, at('10:00'))).rejects.toThrow();
  });
});

describe('entries', () => {
  beforeEach(async () => {
    await repos.meds.insert(newMed({ name: 'Antibiotic' }));
    await repos.meds.insert(newMed({ name: 'Eye drops' }));
  });

  it('create writes entry, items and revision 1', async () => {
    const entry = await repos.entries.create(
      newEntry({ items: [{ medId: 2, status: 'skipped' }, { medId: 1, status: 'given' }] }),
    );
    expect(entry).toEqual({
      id: 1,
      petId: 'twiggy',
      roundKey: 'morning',
      forDate: '2026-10-10',
      givenAt: at('12:15'),
      loggedAt: at('12:20'),
      loggedBy: rob,
      items: [{ medId: 1, status: 'given' }, { medId: 2, status: 'skipped' }],
      undone: false,
      lastRevision: { kind: 'create', by: rob, at: at('12:20') },
      recordMessageId: null,
    });
    expect(await repos.entries.get(1)).toEqual(entry);
    expect(await repos.entries.get(2)).toBeNull();
    expect(await repos.entries.revisions(1)).toEqual([
      { entryId: 1, rev: 1, kind: 'create', by: rob, at: at('12:20'), givenAt: at('12:15'), items: entry.items, undone: false },
    ]);
  });

  it('revision history across create, edit and undo', async () => {
    await repos.entries.create(newEntry({ items: [{ medId: 1, status: 'given' }, { medId: 2, status: 'given' }] }));

    const edited = await repos.entries.revise(1, {
      kind: 'edit',
      by: dani,
      at: at('13:00'),
      items: [{ medId: 1, status: 'given' }, { medId: 2, status: 'skipped' }],
    });
    expect(edited.items).toEqual([{ medId: 1, status: 'given' }, { medId: 2, status: 'skipped' }]);
    expect(edited.givenAt).toEqual(at('12:15'));
    expect(edited.loggedBy).toEqual(rob);
    expect(edited.lastRevision).toEqual({ kind: 'edit', by: dani, at: at('13:00') });

    const retimed = await repos.entries.revise(1, { kind: 'edit', by: rob, at: at('13:05'), givenAt: at('12:00') });
    expect(retimed.givenAt).toEqual(at('12:00'));
    expect(retimed.items).toEqual(edited.items);

    const undone = await repos.entries.revise(1, { kind: 'undo', by: dani, at: at('14:00') });
    expect(undone.undone).toBe(true);
    expect(undone.items).toEqual(edited.items);
    expect(undone.givenAt).toEqual(at('12:00'));
    expect(undone.lastRevision).toEqual({ kind: 'undo', by: dani, at: at('14:00') });

    const revs = await repos.entries.revisions(1);
    expect(revs.map((r) => [r.rev, r.kind, r.by.name, r.undone])).toEqual([
      [1, 'create', 'Rob', false],
      [2, 'edit', 'Danielle', false],
      [3, 'edit', 'Rob', false],
      [4, 'undo', 'Danielle', true],
    ]);
    expect(revs[0]!.items).toHaveLength(2);
    expect(revs[0]!.items[1]).toEqual({ medId: 2, status: 'given' });
    expect(revs[1]!.items[1]).toEqual({ medId: 2, status: 'skipped' });
    expect(revs[0]!.givenAt).toEqual(at('12:15'));
    expect(revs[2]!.givenAt).toEqual(at('12:00'));
    expect(revs[3]!.items).toEqual(edited.items);
  });

  it('editing an undone entry throws and leaves it untouched', async () => {
    await repos.entries.create(newEntry());
    await repos.entries.revise(1, { kind: 'undo', by: rob, at: at('13:00') });
    await expect(
      repos.entries.revise(1, { kind: 'edit', by: rob, at: at('13:30'), givenAt: at('11:00') }),
    ).rejects.toThrow(/undone/);
    expect((await repos.entries.get(1))!.givenAt).toEqual(at('12:15'));
    expect(await repos.entries.revisions(1)).toHaveLength(2);
  });

  it('undoing twice does not add a revision', async () => {
    await repos.entries.create(newEntry());
    await repos.entries.revise(1, { kind: 'undo', by: rob, at: at('13:00') });
    const again = await repos.entries.revise(1, { kind: 'undo', by: dani, at: at('13:10') });
    expect(again.lastRevision.by).toEqual(rob);
    expect(await repos.entries.revisions(1)).toHaveLength(2);
  });

  it('revising a missing entry throws', async () => {
    await expect(repos.entries.revise(77, { kind: 'undo', by: rob, at: at('13:00') })).rejects.toThrow(/not found/);
  });

  it('setRecordMessage sets and clears', async () => {
    await repos.entries.create(newEntry());
    await repos.entries.setRecordMessage(1, 555);
    expect((await repos.entries.get(1))!.recordMessageId).toBe(555);
    await repos.entries.setRecordMessage(1, null);
    expect((await repos.entries.get(1))!.recordMessageId).toBeNull();
  });

  it('listForPet orders by givenAt asc, filters sinceDate and undone', async () => {
    await repos.entries.create(newEntry({ forDate: '2026-10-09', givenAt: at('07:00'), loggedAt: at('07:00') }));
    await repos.entries.create(newEntry({ forDate: '2026-10-10', roundKey: 'evening', givenAt: at('23:00') }));
    await repos.entries.create(newEntry({ forDate: '2026-10-10', givenAt: at('09:00') }));
    await repos.entries.create(newEntry({ petId: 'faith', givenAt: at('10:00') }));
    await repos.entries.revise(2, { kind: 'undo', by: rob, at: at('23:30') });

    expect((await repos.entries.listForPet('twiggy')).map((e) => e.id)).toEqual([1, 3]);
    expect((await repos.entries.listForPet('twiggy', { includeUndone: true })).map((e) => e.id)).toEqual([1, 3, 2]);
    expect((await repos.entries.listForPet('twiggy', { sinceDate: '2026-10-10', includeUndone: true })).map((e) => e.id)).toEqual([3, 2]);
    expect((await repos.entries.listForPet('twiggy', { sinceDate: '2026-10-11' }))).toEqual([]);
    expect((await repos.entries.listForPet('faith')).map((e) => e.id)).toEqual([4]);
  });

  it('listForOccurrence returns active entries; null roundKey matches monthly/as-needed', async () => {
    await repos.entries.create(newEntry({ givenAt: at('12:30') }));
    await repos.entries.create(newEntry({ givenAt: at('12:00') }));
    await repos.entries.create(newEntry({ roundKey: 'evening' }));
    await repos.entries.create(newEntry({ roundKey: null }));
    await repos.entries.create(newEntry({ forDate: '2026-10-11' }));
    await repos.entries.create(newEntry());
    await repos.entries.revise(6, { kind: 'undo', by: rob, at: at('13:00') });

    expect((await repos.entries.listForOccurrence('twiggy', 'morning', '2026-10-10')).map((e) => e.id)).toEqual([2, 1]);
    expect((await repos.entries.listForOccurrence('twiggy', null, '2026-10-10')).map((e) => e.id)).toEqual([4]);
    expect(await repos.entries.listForOccurrence('faith', 'morning', '2026-10-10')).toEqual([]);
  });

  it('keeps ids beyond int32 (user ids, chat ids)', async () => {
    const entry = await repos.entries.create(newEntry({ by: { userId: 5_000_000_000, name: 'Big' } }));
    expect(entry.loggedBy.userId).toBe(5_000_000_000);
    const edited = await repos.entries.revise(entry.id, { kind: 'edit', by: { userId: 9_007_199_254_740_000, name: 'Huge' }, at: at('13:00') });
    expect(edited.lastRevision.by.userId).toBe(9_007_199_254_740_000);
    expect((await repos.entries.revisions(entry.id))[1]!.by.userId).toBe(9_007_199_254_740_000);
    expect(typeof edited.loggedBy.userId).toBe('number');
  });
});

describe('atomicity', () => {
  it('a failing tx leaves nothing behind', async () => {
    await expect(
      db.tx(async (tx) => {
        await createRepos(tx).meds.insert(newMed());
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await repos.meds.listActive()).toEqual([]);
  });

  it('repos built from a tx work inside it and commit with it', async () => {
    const med = await db.tx(async (tx) => {
      const r = createRepos(tx);
      const m = await r.meds.insert(newMed());
      await r.entries.create(newEntry({ items: [{ medId: m.id, status: 'given' }] }));
      await r.entries.revise(1, { kind: 'undo', by: rob, at: at('13:00') });
      return m;
    });
    expect(med.id).toBe(1);
    expect((await repos.entries.get(1))!.undone).toBe(true);
  });

  it('nested tx reuses the outer transaction (inner failure caught, outer rolled back)', async () => {
    await expect(
      db.tx(async (tx) => {
        await tx.tx(async (inner) => {
          await createRepos(inner).meds.insert(newMed());
        });
        expect(await createRepos(tx).meds.listActive()).toHaveLength(1);
        throw new Error('outer fails');
      }),
    ).rejects.toThrow('outer fails');
    expect(await repos.meds.listActive()).toEqual([]);
  });

  it('create is atomic: bad item (unknown med) leaves no entry or revision', async () => {
    await expect(repos.entries.create(newEntry({ items: [{ medId: 404, status: 'given' }] }))).rejects.toThrow();
    expect(await db.query('SELECT 1 FROM log_entries')).toEqual([]);
    expect(await db.query('SELECT 1 FROM log_entry_revisions')).toEqual([]);
  });

  it('revise is atomic: a failing edit changes neither entry nor history', async () => {
    await repos.meds.insert(newMed());
    await repos.entries.create(newEntry());
    await expect(
      repos.entries.revise(1, {
        kind: 'edit',
        by: dani,
        at: at('13:00'),
        givenAt: at('11:00'),
        items: [{ medId: 404, status: 'given' }],
      }),
    ).rejects.toThrow();
    const entry = (await repos.entries.get(1))!;
    expect(entry.givenAt).toEqual(at('12:15'));
    expect(entry.items).toEqual([{ medId: 1, status: 'given' }]);
    expect(entry.lastRevision.kind).toBe('create');
    expect(await repos.entries.revisions(1)).toHaveLength(1);
  });

  it('tx returns the callback value', async () => {
    expect(await db.tx(async () => 7)).toBe(7);
  });
});

describe('bot_messages', () => {
  it('inserts and reads back, with big chat ids as numbers', async () => {
    const m = await repos.messages.insert(newMessage());
    expect(m).toEqual({ id: 1, ...newMessage(), deletedAt: null });
    expect(m.chatId).toBe(-1001234567890);
    expect(await repos.messages.get(1)).toEqual(m);
    expect(await repos.messages.get(2)).toBeNull();
  });

  it('round-trips null fields (board, no thread)', async () => {
    const m = await repos.messages.insert(
      newMessage({ kind: 'board', roundKey: null, forDate: null, threadId: null, medId: null }),
    );
    expect(m).toMatchObject({ kind: 'board', roundKey: null, forDate: null, threadId: null, medId: null });
  });

  it('findLive: omitted fields are not filtered, null matches IS NULL, deleted excluded', async () => {
    const reminder = await repos.messages.insert(newMessage());
    const followup = await repos.messages.insert(newMessage({ kind: 'followup' }));
    const monthly = await repos.messages.insert(newMessage({ roundKey: null, medId: 3 }));
    const other = await repos.messages.insert(newMessage({ forDate: '2026-10-09', petId: 'faith' }));
    await repos.messages.markDeleted(other.id, at('13:00'));

    const ids = async (q: Parameters<Repos['messages']['findLive']>[0]) => (await repos.messages.findLive(q)).map((m) => m.id);
    expect(await ids({ kind: 'reminder' })).toEqual([reminder.id, monthly.id]);
    expect(await ids({ kind: 'followup' })).toEqual([followup.id]);
    expect(await ids({ kind: 'reminder', roundKey: null })).toEqual([monthly.id]);
    expect(await ids({ kind: 'reminder', roundKey: 'morning' })).toEqual([reminder.id]);
    expect(await ids({ kind: 'reminder', medId: 3 })).toEqual([monthly.id]);
    expect(await ids({ kind: 'reminder', medId: null })).toEqual([reminder.id]);
    expect(await ids({ kind: 'reminder', petId: 'twiggy', forDate: '2026-10-10', roundKey: 'morning', medId: null })).toEqual([reminder.id]);
    expect(await ids({ kind: 'reminder', petId: 'faith' })).toEqual([]);
    expect(await ids({ kind: 'board' })).toEqual([]);
  });

  it('findAny includes deleted ones', async () => {
    const a = await repos.messages.insert(newMessage());
    const b = await repos.messages.insert(newMessage());
    await repos.messages.markDeleted(a.id, at('13:00'));
    expect((await repos.messages.findAny({ kind: 'reminder', petId: 'twiggy' })).map((m) => m.id)).toEqual([a.id, b.id]);
    expect((await repos.messages.findLive({ kind: 'reminder', petId: 'twiggy' })).map((m) => m.id)).toEqual([b.id]);
    expect((await repos.messages.get(a.id))!.deletedAt).toEqual(at('13:00'));
  });

  it('setRenderHash updates the hash', async () => {
    const m = await repos.messages.insert(newMessage());
    await repos.messages.setRenderHash(m.id, 'h2');
    expect((await repos.messages.get(m.id))!.renderHash).toBe('h2');
  });
});

describe('ui_state', () => {
  it('get is null when missing; set/get/overwrite round-trips JSON', async () => {
    expect(await repos.ui.get('k')).toBeNull();
    await repos.ui.set('k', { ticks: [1, 2, 3], at: 'now', nested: { a: null } }, at('10:00'));
    expect(await repos.ui.get('k')).toEqual({ ticks: [1, 2, 3], at: 'now', nested: { a: null } });
    await repos.ui.set('k', [1, 'two'], at('11:00'));
    expect(await repos.ui.get('k')).toEqual([1, 'two']);
    await repos.ui.set('s', 'text', at('11:00'));
    expect(await repos.ui.get<string>('s')).toBe('text');
    expect(await db.query('SELECT key FROM ui_state')).toHaveLength(2);
  });

  it('delete removes a key', async () => {
    await repos.ui.set('k', 1, at('10:00'));
    await repos.ui.delete('k');
    await repos.ui.delete('missing');
    expect(await repos.ui.get('k')).toBeNull();
  });

  it('deleteOlderThan drops stale rows and counts them; overwrite refreshes updated_at', async () => {
    await repos.ui.set('old', 1, at('08:00'));
    await repos.ui.set('refreshed', 1, at('08:00'));
    await repos.ui.set('fresh', 1, at('12:00'));
    await repos.ui.set('refreshed', 2, at('12:30'));
    expect(await repos.ui.deleteOlderThan(at('12:00'))).toBe(1);
    expect(await repos.ui.get('old')).toBeNull();
    expect(await repos.ui.get('refreshed')).toBe(2);
    expect(await repos.ui.get('fresh')).toBe(1);
    expect(await repos.ui.deleteOlderThan(at('06:00'))).toBe(0);
  });
});
