import { describe, expect, it } from 'vitest';
import { planMessages, type Plan, type Wanted } from '../src/domain/index.js';
import type { BotMessage, LogEntry, Med } from '../src/types.js';
import {
  ALLERGY, ANTIBIOTIC, at, DAILY, entry, FAITH_SIMPARICA, given, msg, SIMPARICA, skipped, snap,
} from './domain-fixtures.js';

const D = '2026-10-10';
const first = entry({ forDate: '2026-10-01', givenAt: at('2026-10-01 08:00'), items: given(1) }); // antibiotic started 1 Oct
const morningLog = (items: ReturnType<typeof given>, extra: Partial<LogEntry> = {}) =>
  entry({ forDate: D, givenAt: at(`${D} 08:30`), items, ...extra });

const wanted = (kind: Wanted['kind'], roundKey: string | null = 'morning', over: Partial<Wanted> = {}): Wanted => ({
  kind, petId: 'twiggy', roundKey, medId: null, forDate: D, ...over,
});

const planAt = (now: string, entries: LogEntry[] = [first], rows: BotMessage[] = [], meds: Med[] = DAILY): Plan =>
  planMessages(snap(meds, entries), at(now), rows);

const row = (w: Wanted, over: Partial<BotMessage> = {}) => msg({ ...w, ...over });

describe('daily rounds', () => {
  it('nothing before the due time', () => {
    expect(planAt(`${D} 07:59`)).toEqual({ create: [], remove: [] });
  });

  it('a reminder at the due time, a follow-up at the halfway point', () => {
    expect(planAt(`${D} 08:00`).create).toEqual([wanted('reminder')]);
    const reminder = row(wanted('reminder'));
    expect(planAt(`${D} 08:59`, [first], [reminder]).create).toEqual([]);
    expect(planAt(`${D} 09:00`, [first], [reminder]).create).toEqual([wanted('followup')]);
  });

  it('nothing at or after late-after', () => {
    expect(planAt(`${D} 10:00`).create).toEqual([]);
    expect(planAt(`${D} 15:00`).create).toEqual([]);
  });

  it('a late start at 11:00 creates no reminder and no follow-up', () => {
    expect(planAt(`${D} 11:00`)).toEqual({ create: [], remove: [] });
  });

  it('a logged round gets no reminder; the follow-up is removed', () => {
    const log = morningLog(given(1, 2));
    expect(planAt(`${D} 08:35`, [first, log]).create).toEqual([]);
    const followup = row(wanted('followup'));
    expect(planAt(`${D} 09:05`, [first, log], [row(wanted('reminder')), followup]).remove).toEqual([followup.id]);
  });

  it('a partial log still wants the follow-up, which lists only what is left', () => {
    const log = morningLog(given(2));
    expect(planAt(`${D} 09:00`, [first, log], [row(wanted('reminder'))]).create).toEqual([wanted('followup')]);
  });

  it('skipped meds stop counting as pending', () => {
    const log = morningLog([...given(2), ...skipped(1)]);
    expect(planAt(`${D} 09:00`, [first, log]).create).toEqual([]);
  });

  it('an undone log makes the round pending again', () => {
    const log = morningLog(given(1, 2), { undone: true });
    expect(planAt(`${D} 09:05`, [first, log], [row(wanted('reminder'))]).create).toEqual([wanted('followup')]);
  });

  it('keeps a live follow-up while something is pending, even after late-after', () => {
    const followup = row(wanted('followup'));
    expect(planAt(`${D} 10:30`, [first], [row(wanted('reminder')), followup]).remove).toEqual([]);
  });

  it('removes yesterday\'s live follow-up', () => {
    const old = row(wanted('followup', 'evening', { forDate: '2026-10-09' }));
    expect(planAt(`${D} 07:30`, [first], [old]).remove).toEqual([old.id]);
  });

  it('removes a follow-up for a round that has no meds any more', () => {
    const followup = row(wanted('followup'));
    expect(planAt(`${D} 09:30`, [], [followup], [ALLERGY]).remove).toEqual([followup.id]);
  });

  it('only live follow-ups are ever removed', () => {
    const log = morningLog(given(1, 2));
    const rows = [
      row(wanted('reminder')),
      row(wanted('followup'), { deletedAt: at(`${D} 08:31`) }),
      row(wanted('course_finished', null, { medId: 1 })),
    ];
    expect(planAt(`${D} 09:30`, [first, log], rows).remove).toEqual([]);
  });

  it('a deleted reminder is not live, so it is created again while the round is open', () => {
    const gone = row(wanted('reminder'), { deletedAt: at(`${D} 08:10`) });
    expect(planAt(`${D} 08:20`, [first], [gone]).create).toEqual([wanted('reminder')]);
  });

  it('ignores rows of other occurrences', () => {
    const yesterday = row(wanted('reminder', 'morning', { forDate: '2026-10-09' }));
    expect(planAt(`${D} 08:00`, [first], [yesterday]).create).toEqual([wanted('reminder')]);
  });

  it('both rounds are independent', () => {
    expect(planAt(`${D} 18:00`).create).toEqual([wanted('reminder', 'evening')]);
  });
});

describe('quiet hours', () => {
  const early = (s = snap(DAILY, [first])) => {
    const pet = s.settings.pets[0]!;
    const rounds = [{ key: 'morning', name: 'Morning', emoji: '☀️', due: '06:30', lateAfter: '09:00' }, pet.rounds[1]!];
    return snap(DAILY, [first], { pets: [{ ...pet, rounds }, ...s.settings.pets.slice(1)] });
  };

  it('defers a 06:30 round to 07:00, but remove still works during quiet hours', () => {
    const s = early();
    const stale = row(wanted('followup', 'evening', { forDate: '2026-10-09' }));
    const at0659 = planMessages(s, at(`${D} 06:59`), [stale]);
    expect(at0659).toEqual({ create: [], remove: [stale.id] });
    expect(planMessages(s, at(`${D} 07:00`), []).create).toEqual([wanted('reminder')]);
  });

  it('the follow-up midpoint (07:45) is unaffected when it falls after quiet end', () => {
    const s = early();
    const reminder = row(wanted('reminder'));
    expect(planMessages(s, at(`${D} 07:44`), [reminder]).create).toEqual([]);
    expect(planMessages(s, at(`${D} 07:45`), [reminder]).create).toEqual([wanted('followup')]);
  });

  it('creates nothing during quiet hours at all', () => {
    expect(planAt(`${D} 22:00`, [first], [], [...DAILY, SIMPARICA]).create).toEqual([]);
    expect(planAt(`${D} 03:00`).create).toEqual([]);
  });
});

describe('monthly meds', () => {
  const M = (kind: Wanted['kind'], over: Partial<Wanted> = {}) =>
    wanted(kind, null, { medId: 4, forDate: '2026-10-14', ...over });
  const planM = (now: string, entries: LogEntry[] = [], rows: BotMessage[] = []) =>
    planMessages(snap([SIMPARICA], entries), at(now), rows);
  const dose = (when: string, forDate: string, extra: Partial<LogEntry> = {}) =>
    entry({ roundKey: null, forDate, givenAt: at(when), items: given(4), ...extra });

  it('nothing before the due day', () => {
    expect(planM('2026-10-13 12:00')).toEqual({ create: [], remove: [] });
  });

  it('morning reminder on the due day at the pet\'s morning time, evening nudge at the evening time', () => {
    expect(planM('2026-10-14 07:59').create).toEqual([]);
    expect(planM('2026-10-14 08:00').create).toEqual([M('reminder')]);
    const reminder = row(M('reminder'));
    expect(planM('2026-10-14 17:59', [], [reminder]).create).toEqual([]);
    expect(planM('2026-10-14 18:00', [], [reminder]).create).toEqual([M('followup')]);
  });

  it('starting at 19:00 on the due day creates both', () => {
    expect(planM('2026-10-14 19:00').create).toEqual([M('reminder'), M('followup')]);
  });

  it('removes the nudge once given, and creates nothing', () => {
    const nudge = row(M('followup'));
    const given1 = dose('2026-10-14 18:30', '2026-10-14');
    expect(planM('2026-10-14 18:35', [given1], [row(M('reminder')), nudge])).toEqual({ create: [], remove: [nudge.id] });
  });

  it('removes the nudge the day after (late) and creates no reminder for it', () => {
    const nudge = row(M('followup'));
    expect(planM('2026-10-15 09:00', [], [row(M('reminder')), nudge])).toEqual({ create: [], remove: [nudge.id] });
  });

  it('given early: no reminder on the original due day', () => {
    const early = dose('2026-10-10 12:00', '2026-10-14');
    expect(planM('2026-10-14 08:00', [early]).create).toEqual([]);
    expect(planM('2026-11-10 08:00', [early]).create).toEqual([M('reminder', { forDate: '2026-11-10' })]);
  });

  it('undo brings the reminder back', () => {
    const undone = dose('2026-10-14 07:30', '2026-10-14', { undone: true });
    expect(planM('2026-10-14 08:00', [undone]).create).toEqual([M('reminder')]);
  });

  it('a stopped monthly med gets nothing, and its nudge goes away', () => {
    const stopped = { ...SIMPARICA, stoppedAt: at('2026-10-14 09:00') };
    const nudge = row(M('followup'));
    expect(planMessages(snap([stopped]), at('2026-10-14 18:00'), [nudge])).toEqual({ create: [], remove: [nudge.id] });
  });

  it('uses each pet\'s own morning time', () => {
    const s = snap([FAITH_SIMPARICA]);
    const faith = (k: Wanted['kind']): Wanted => ({ kind: k, petId: 'faith', roundKey: null, medId: 5, forDate: '2026-10-20' });
    expect(planMessages(s, at('2026-10-20 08:30'), []).create).toEqual([]);
    expect(planMessages(s, at('2026-10-20 09:00'), []).create).toEqual([faith('reminder')]);
  });

  it('DST day 2026-11-01: due from a 1 Oct late-evening dose, reminder at 08:00 EST', () => {
    const e = dose('2026-10-01 23:30', '2026-10-01');
    const s = snap([SIMPARICA], [e]);
    expect(planMessages(s, at('2026-11-01 07:59'), []).create).toEqual([]);
    expect(planMessages(s, at('2026-11-01 08:00'), []).create).toEqual([M('reminder', { forDate: '2026-11-01' })]);
  });

  it('month-end clamp: dose on 31 Jan is due 28 Feb', () => {
    const e = dose('2027-01-31 09:00', '2027-01-31');
    expect(planMessages(snap([SIMPARICA], [e]), at('2027-02-28 08:00'), []).create).toEqual([
      M('reminder', { forDate: '2027-02-28' }),
    ]);
  });
});

describe('course finished', () => {
  const planC = (now: string, rows: BotMessage[] = []) => planMessages(snap([ANTIBIOTIC], [first]), at(now), rows);
  const finished = (): Wanted => ({ kind: 'course_finished', petId: 'twiggy', roundKey: null, medId: 1, forDate: '2026-10-10' });
  const creates = (p: Plan) => p.create.filter((w) => w.kind === 'course_finished');

  it('posts the day after the last day, from the pet\'s morning time', () => {
    expect(creates(planC('2026-10-10 12:00'))).toEqual([]);
    expect(creates(planC('2026-10-11 07:59'))).toEqual([]);
    expect(creates(planC('2026-10-11 08:00'))).toEqual([finished()]);
  });

  it('still posts the day after that if it was missed, then never again', () => {
    expect(creates(planC('2026-10-12 12:00'))).toEqual([finished()]);
    expect(creates(planC('2026-10-13 12:00'))).toEqual([]);
  });

  it('never twice: a live or a deleted row is enough', () => {
    const live = row(finished());
    const deleted = row(finished(), { deletedAt: at('2026-10-11 09:00') });
    expect(creates(planC('2026-10-11 12:00', [live]))).toEqual([]);
    expect(creates(planC('2026-10-11 12:00', [deleted]))).toEqual([]);
  });

  it('waits out quiet hours', () => {
    const p = planMessages(snap([ANTIBIOTIC], [first]), at('2026-10-11 23:00'), []);
    expect(creates(p)).toEqual([]);
  });
});

describe('idempotence', () => {
  const live = (plan: Plan, startId = 500): BotMessage[] => plan.create.map((w, i) => row(w, { id: startId + i }));

  it('planning again after creating the rows plans nothing, now or a minute later', () => {
    const meds = [...DAILY, SIMPARICA];
    const s = snap(meds, [first]);
    for (const t of ['08:00', '09:00', '09:30', '18:00']) {
      const now = at(`${D} ${t}`);
      const p = planMessages(s, now, []);
      const rows = live(p);
      expect(planMessages(s, now, rows)).toEqual({ create: [], remove: [] });
      expect(planMessages(s, new Date(now.getTime() + 60_000), rows).create).toEqual([]);
    }
  });

  it('accumulating rows across the day creates each message exactly once', () => {
    const s = snap([...DAILY, { ...SIMPARICA, seedLastGiven: '2026-09-10' }], [first]);
    let rows: BotMessage[] = [];
    const seen: string[] = [];
    for (let m = 0; m < 24 * 60; m += 1) {
      const now = new Date(at(`${D} 00:00`).getTime() + m * 60_000);
      const p = planMessages(s, now, rows);
      seen.push(...p.create.map((w) => `${w.kind}:${w.roundKey ?? w.medId}`));
      rows = [...rows, ...live(p, 1000 + rows.length)];
    }
    expect(seen.sort()).toEqual(
      ['followup:4', 'followup:evening', 'followup:morning', 'reminder:4', 'reminder:evening', 'reminder:morning'],
    );
  });

  it('removed follow-ups, once marked deleted, are not removed again', () => {
    const log = morningLog(given(1, 2));
    const followup = row(wanted('followup'));
    const s = snap(DAILY, [first, log]);
    const now = at(`${D} 09:10`);
    const p = planMessages(s, now, [followup]);
    expect(p.remove).toEqual([followup.id]);
    expect(planMessages(s, now, [{ ...followup, deletedAt: now }]).remove).toEqual([]);
  });
});
