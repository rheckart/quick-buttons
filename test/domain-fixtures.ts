import { instantAt } from '../src/time.js';
import type { Snapshot } from '../src/domain/index.js';
import type { BotMessage, EntryItem, LogEntry, Med, Person, Settings } from '../src/types.js';

export const TZ = 'America/New_York';
export const ROB: Person = { userId: 1, name: 'Rob' };
export const DANI: Person = { userId: 2, name: 'Danielle' };
export const KID: Person = { userId: 3, name: 'Kid' };

/** An instant from local wall-clock "YYYY-MM-DD HH:mm" in the test zone. */
export const at = (s: string): Date => instantAt(s.slice(0, 10), s.slice(11, 16), TZ);

export const settings: Settings = {
  timezone: TZ,
  groupChatId: -100,
  admins: [1, 2],
  givers: [{ userId: 1, name: 'Rob' }],
  quietHours: { start: '22:00', end: '07:00' },
  backupChatId: 1,
  backupTime: '03:00',
  pets: [
    {
      id: 'twiggy',
      name: 'Twiggy',
      topicId: 11,
      monthlyMorning: '08:00',
      monthlyEvening: '18:00',
      rounds: [
        { key: 'morning', name: 'Morning', emoji: '☀️', due: '08:00', lateAfter: '10:00' },
        { key: 'evening', name: 'Evening', emoji: '🌙', due: '18:00', lateAfter: '20:00' },
      ],
    },
    { id: 'faith', name: 'Faith', topicId: 12, monthlyMorning: '09:00', monthlyEvening: '18:00', rounds: [] },
  ],
};

let nextId = 100;
export function med(p: Partial<Med> & Pick<Med, 'id' | 'kind'>): Med {
  return {
    petId: 'twiggy',
    name: `Med ${p.id}`,
    doseNote: null,
    roundKeys: [],
    days: null,
    startedOn: null,
    seedLastGiven: null,
    createdAt: at('2026-09-01 12:00'),
    stoppedAt: null,
    ...p,
  };
}

export const ANTIBIOTIC = med({ id: 1, kind: 'course', name: 'Antibiotic', roundKeys: ['morning', 'evening'], days: 10 });
export const EYE_DROPS = med({ id: 2, kind: 'ongoing', name: 'Eye drops', roundKeys: ['morning'] });
export const ALLERGY = med({ id: 3, kind: 'ongoing', name: 'Allergy', roundKeys: ['evening'] });
export const SIMPARICA = med({ id: 4, kind: 'monthly', name: 'Simparica', seedLastGiven: '2026-09-14' });
export const FAITH_SIMPARICA = med({ id: 5, kind: 'monthly', petId: 'faith', name: 'Simparica', seedLastGiven: '2026-09-20' });
export const EAR_CLEANER = med({ id: 6, kind: 'as_needed', name: 'Ear cleaner' });

export const given = (...ids: number[]): EntryItem[] => ids.map((medId) => ({ medId, status: 'given' }));
export const skipped = (...ids: number[]): EntryItem[] => ids.map((medId) => ({ medId, status: 'skipped' }));

export function entry(p: Partial<LogEntry> & Pick<LogEntry, 'forDate' | 'givenAt' | 'items'>): LogEntry {
  const by = p.loggedBy ?? ROB;
  return {
    id: nextId++,
    petId: 'twiggy',
    roundKey: 'morning',
    loggedAt: p.givenAt,
    loggedBy: by,
    undone: false,
    lastRevision: { kind: p.undone ? 'undo' : 'create', by, at: p.givenAt },
    recordMessageId: null,
    ...p,
  };
}

export function snap(meds: Med[], entries: LogEntry[] = [], over: Partial<Settings> = {}): Snapshot {
  return { settings: { ...settings, ...over }, meds, entries };
}

export const DAILY = [ANTIBIOTIC, EYE_DROPS, ALLERGY];

let nextMsg = 1;
export function msg(p: Partial<BotMessage> & Pick<BotMessage, 'kind'>): BotMessage {
  return {
    id: nextMsg++,
    petId: 'twiggy',
    roundKey: null,
    medId: null,
    forDate: null,
    chatId: -100,
    threadId: 11,
    messageId: nextMsg + 1000,
    renderHash: '',
    createdAt: new Date(0),
    deletedAt: null,
    ...p,
  };
}
