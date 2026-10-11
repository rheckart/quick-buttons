import { expect } from 'vitest';
import { createRepos } from '../../src/db/index.js';
import type { Repos } from '../../src/db/index.js';
import { decodeCallback } from '../../src/render/index.js';
import { createService } from '../../src/service/index.js';
import type { CallbackResult, Logger, Service, TypedTimeResult } from '../../src/service/index.js';
import { addMinutes } from '../../src/time.js';
import type { Callback, Db, Med, MedState, Person, Settings } from '../../src/types.js';
import { at, settings as baseSettings } from '../domain-fixtures.js';
import { FakeMessenger, findButton } from './fakeMessenger.js';
import type { FakeMessage } from './fakeMessenger.js';
import { makeTestDb } from './testDb.js';

export const ROB: Person = { userId: 1, name: 'Rob' };
export const DANI: Person = { userId: 2, name: 'Danielle' };
export const KID: Person = { userId: 3, name: 'Kid' };

export const GROUP = baseSettings.groupChatId;
export const TWIGGY_TOPIC = 11;
export const FAITH_TOPIC = 12;

/** Two givers, two admins; otherwise the shared domain fixtures. */
export const e2eSettings: Settings = {
  ...baseSettings,
  givers: [
    { userId: 1, name: 'Rob' },
    { userId: 2, name: 'Danielle' },
  ],
};

export class MutableClock {
  constructor(private current: Date) {}
  now(): Date {
    return this.current;
  }
  /** "2026-10-10 08:00" in the test zone. */
  set(local: string): void {
    this.current = at(local);
  }
  advance(minutes: number): void {
    this.current = addMinutes(this.current, minutes);
  }
}

export interface RecordingLogger extends Logger {
  warnings: string[];
  errors: string[];
}

export function recordingLogger(): RecordingLogger {
  const warnings: string[] = [];
  const errors: string[] = [];
  return {
    warnings,
    errors,
    warn: (m, e) => void warnings.push(`${m}${e ? `: ${String(e)}` : ''}`),
    error: (m, e) => void errors.push(`${m}${e ? `: ${String(e)}` : ''}`),
  };
}

export interface Harness {
  db: Db;
  repos: Repos;
  fake: FakeMessenger;
  clock: MutableClock;
  svc: Service;
  settings: Settings;
  logger: RecordingLogger;
  /** A fresh service on the same database, messenger and clock (a bot restart). */
  restart(): Service;
  reconcile(): Promise<void>;
  /** Presses a button, found by part of its label, as `who`. */
  tap(msg: FakeMessage, label: string, who?: Person): Promise<CallbackResult>;
  press(msg: FakeMessage, cb: Callback, who?: Person, chatId?: number): Promise<CallbackResult>;
  /** Sets one med row of an open panel (index into the panel's med list). */
  setMed(msg: FakeMessage, index: number, state: MedState, who?: Person): Promise<CallbackResult>;
  typeReply(promptId: number, text: string, who?: Person): Promise<TypedTimeResult>;
  addMed(med: Partial<Med> & Pick<Med, 'name' | 'kind' | 'petId'>): Promise<Med>;
  /** A screen-ready view of what is live in a topic. */
  screen(threadId?: number): string;
  close(): Promise<void>;
}

export async function makeHarness(opts: { now?: string; settings?: Settings } = {}): Promise<Harness> {
  const db = await makeTestDb();
  const repos = createRepos(db);
  const fake = new FakeMessenger();
  const clock = new MutableClock(at(opts.now ?? '2026-10-10 07:30'));
  const settings = opts.settings ?? e2eSettings;
  const logger = recordingLogger();
  const build = () => createService({ db, messenger: fake, clock, settings, logger });
  let svc = build();

  const h: Harness = {
    db, repos, fake, clock, settings, logger,
    get svc() {
      return svc;
    },
    restart() {
      svc = build();
      return svc;
    },
    reconcile: () => svc.reconcile(),
    press(msg, cb, who = ROB, chatId = msg.chatId) {
      return svc.handleCallback(cb, { from: who, chatId, messageId: msg.messageId, threadId: msg.threadId });
    },
    tap(msg, label, who = ROB) {
      const cb = decodeCallback(findButton(msg, label).data);
      if (!cb) throw new Error(`undecodable button "${label}"`);
      return h.press(msg, cb, who);
    },
    setMed(msg, index, state, who = ROB) {
      const first = decodeCallback(msg.keyboard.flat()[0]!.data);
      if (!first || !('m' in first)) throw new Error('not a panel message');
      return h.press(msg, { t: 'setMed', m: first.m, i: index, s: state }, who);
    },
    typeReply(promptId, text, who = ROB) {
      const prompt = fake.byId(promptId);
      return svc.handleTypedTime({ from: who, chatId: prompt.chatId, replyToMessageId: promptId, text });
    },
    addMed(med) {
      return repos.meds.insert({
        doseNote: null, roundKeys: [], days: null, startedOn: null, seedLastGiven: null,
        createdAt: at('2026-09-01 12:00'), ...med,
      });
    },
    screen: (threadId) => fake.dump().split('\n').filter((l) => threadId === undefined || l.includes(`[${threadId}]`)).join('\n'),
    async close() {
      expect(logger.errors).toEqual([]);
      await db.close();
    },
  };
  return h;
}

/** Twiggy's day-one meds (antibiotic course from 1 Oct, eye drops, allergy) and both Simparicas. */
export async function seedDayOneMeds(h: Harness, over: { twiggySimparica?: string; faithSimparica?: string } = {}) {
  const antibiotic = await h.addMed({ petId: 'twiggy', name: 'Antibiotic', kind: 'course', roundKeys: ['morning', 'evening'], days: 10, startedOn: '2026-10-01', doseNote: '1 tablet' });
  const eyeDrops = await h.addMed({ petId: 'twiggy', name: 'Eye drops', kind: 'ongoing', roundKeys: ['morning'], doseNote: '2 drops each eye' });
  const allergy = await h.addMed({ petId: 'twiggy', name: 'Allergy', kind: 'ongoing', roundKeys: ['evening'] });
  const simparica = await h.addMed({ petId: 'twiggy', name: 'Simparica', kind: 'monthly', seedLastGiven: over.twiggySimparica ?? '2026-09-14' });
  const faithSimparica = await h.addMed({ petId: 'faith', name: 'Simparica', kind: 'monthly', seedLastGiven: over.faithSimparica ?? '2026-09-20' });
  return { antibiotic, eyeDrops, allergy, simparica, faithSimparica };
}
