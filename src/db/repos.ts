import type {
  BotMessage,
  BotMessageKind,
  EntryItem,
  EntryRevision,
  LocalDate,
  LogEntry,
  Med,
  Person,
} from '../types.js';

/**
 * Repository contracts over the schema in schema.ts. Implemented in `repos-impl.ts` (`createRepos`).
 * Every method returns plain objects from types.ts: ids and Telegram ids as `number`, instants as `Date`.
 * Methods that take a `now`/`at` never read the wall clock themselves.
 */

export interface NewMed {
  petId: string;
  name: string;
  kind: Med['kind'];
  doseNote: string | null;
  roundKeys: string[];
  days: number | null;
  startedOn: LocalDate | null;
  seedLastGiven: LocalDate | null;
  createdAt: Date;
}

export type MedPatch = Partial<Pick<Med, 'name' | 'doseNote' | 'roundKeys' | 'days' | 'startedOn' | 'seedLastGiven'>>;

export interface MedsRepo {
  insert(input: NewMed): Promise<Med>;
  get(id: number): Promise<Med | null>;
  /** All meds ever for the pet (stopped ones included), ordered by id. */
  listForPet(petId: string): Promise<Med[]>;
  /** Meds not stopped, ordered by id. */
  listActive(petId?: string): Promise<Med[]>;
  update(id: number, patch: MedPatch): Promise<Med>;
  stop(id: number, at: Date): Promise<Med>;
}

export interface NewEntry {
  petId: string;
  roundKey: string | null;
  forDate: LocalDate;
  givenAt: Date;
  loggedAt: Date;
  by: Person;
  items: EntryItem[];
}

export interface EntriesRepo {
  /** Inserts the entry + items and revision 1 ('create'), atomically. */
  create(input: NewEntry): Promise<LogEntry>;
  get(id: number): Promise<LogEntry | null>;
  /**
   * Appends a revision and updates the entry to match, atomically.
   *  - 'edit': replaces items and/or givenAt (omitted fields keep their value); entry stays active.
   *  - 'undo': sets undone = true (items and givenAt kept as they were).
   * An 'edit' of an undone entry is not allowed (throws); create a new entry instead.
   */
  revise(
    id: number,
    input: { kind: 'edit'; by: Person; at: Date; givenAt?: Date; items?: EntryItem[] } | { kind: 'undo'; by: Person; at: Date },
  ): Promise<LogEntry>;
  setRecordMessage(id: number, messageId: number | null): Promise<void>;
  /** Entries of a pet ordered by givenAt ascending. Undone ones only with includeUndone. sinceDate filters on forDate >=. */
  listForPet(petId: string, opts?: { sinceDate?: LocalDate; includeUndone?: boolean }): Promise<LogEntry[]>;
  /** Active entries for one occurrence (roundKey null = monthly/as-needed entries for that forDate). */
  listForOccurrence(petId: string, roundKey: string | null, forDate: LocalDate): Promise<LogEntry[]>;
  /** Oldest first. */
  revisions(entryId: number): Promise<EntryRevision[]>;
}

export interface NewBotMessage {
  kind: BotMessageKind;
  petId: string | null;
  roundKey: string | null;
  medId: number | null;
  forDate: LocalDate | null;
  chatId: number;
  threadId: number | null;
  messageId: number;
  renderHash: string;
  createdAt: Date;
}

export interface MessageQuery {
  kind: BotMessageKind;
  petId?: string | null;
  roundKey?: string | null;
  medId?: number | null;
  forDate?: LocalDate | null;
}

export interface MessagesRepo {
  insert(input: NewBotMessage): Promise<BotMessage>;
  get(id: number): Promise<BotMessage | null>;
  /** Not-deleted messages matching every given field (omitted fields are not filtered; null matches IS NULL). */
  findLive(q: MessageQuery): Promise<BotMessage[]>;
  /** Like findLive but includes deleted ones (to ask "did we ever send this?"). */
  findAny(q: MessageQuery): Promise<BotMessage[]>;
  setRenderHash(id: number, hash: string): Promise<void>;
  markDeleted(id: number, at: Date): Promise<void>;
}

export interface UiStateRepo {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown, at: Date): Promise<void>;
  delete(key: string): Promise<void>;
  /** Housekeeping: drops rows last updated before `before`. Returns how many. */
  deleteOlderThan(before: Date): Promise<number>;
}

export interface Repos {
  meds: MedsRepo;
  entries: EntriesRepo;
  messages: MessagesRepo;
  ui: UiStateRepo;
}
