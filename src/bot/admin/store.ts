import type { MedPatch, UiStateRepo } from '../../db/repos.js';
import type { MedDraft } from '../../render/index.js';
import type { Clock, MedKind } from '../../types.js';
import type { TypedField } from './draft.js';

/** What the single admin message in a private chat is showing right now. */
export type View =
  | { v: 'card' }
  | { v: 'pet' }
  | { v: 'kind' }
  | { v: 'rounds' }
  | { v: 'ask'; field: TypedField; error?: string }
  | { v: 'editFields' }
  | { v: 'editAsk'; field: 'days' | 'doseNote'; error?: string }
  | { v: 'editRounds'; roundKeys: string[] }
  | { v: 'editConfirm'; patch: MedPatch };

/** One open Start card or Edit flow. Plain JSON, so a store can keep it in a database. */
export interface Session {
  /** Telegram id of the message being edited in place. Buttons on any other message are stale. */
  screen: number;
  flow: 'start' | 'edit';
  /** The Start card's draft. */
  draft: MedDraft;
  /** The med being edited. */
  edit?: { petId: string; medId: number };
  view: View;
}

/** Where open sessions live, keyed by private chat id. The database-backed one survives restarts. */
export interface DraftStore {
  get(chatId: number): Promise<Session | undefined>;
  set(chatId: number, session: Session): Promise<void>;
  delete(chatId: number): Promise<void>;
}

/** In memory: a restart abandons a half-made draft. */
export function createMemoryDraftStore(): DraftStore {
  const sessions = new Map<number, Session>();
  return {
    async get(chatId) {
      const s = sessions.get(chatId);
      return s && structuredClone(s);
    },
    async set(chatId, session) {
      sessions.set(chatId, structuredClone(session));
    },
    async delete(chatId) {
      sessions.delete(chatId);
    },
  };
}

/** In the `ui_state` table under `admin:<chatId>` (DESIGN rule 5): a half-made draft survives a restart. */
export function createDbDraftStore(ui: UiStateRepo, clock: Clock): DraftStore {
  const key = (chatId: number): string => `admin:${chatId}`;
  return {
    async get(chatId) {
      return (await ui.get<Session>(key(chatId))) ?? undefined;
    },
    async set(chatId, session) {
      await ui.set(key(chatId), session, clock.now());
    },
    async delete(chatId) {
      await ui.delete(key(chatId));
    },
  };
}

export const KIND_CHOICES: { kind: MedKind; label: string }[] = [
  { kind: 'ongoing', label: 'Ongoing (daily, no end)' },
  { kind: 'course', label: 'Course (daily for N days)' },
  { kind: 'monthly', label: 'Monthly' },
  { kind: 'as_needed', label: 'As needed' },
];
