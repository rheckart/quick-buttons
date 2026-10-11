import { inQuietHours, instantAt } from '../time.js';
import type { BotMessage, LocalDate, Med } from '../types.js';
import { coursesJustFinished, courseWindow } from './course.js';
import { monthlyDueDate, occurrenceGiven } from './monthly.js';
import { buildRoundView } from './rounds.js';
import { findMed, findPet, isStopped, type Snapshot, todayOf } from './snapshot.js';
import { effectiveAt, monthlyTimes, roundTimes } from './times.js';

export interface Wanted {
  kind: 'reminder' | 'followup' | 'course_finished';
  petId: string;
  roundKey: string | null;
  medId: number | null;
  forDate: LocalDate;
}

export interface Plan {
  create: Wanted[];
  /** BotMessage ids of live follow-ups that are no longer needed. */
  remove: number[];
}

/**
 * What the bot should send or delete right now, from the log and the messages it already has.
 * `existing` = bot_messages rows (live and deleted) of kind reminder / followup / course_finished.
 * Idempotent: once the rows for `create` exist, planning again yields nothing new.
 * Quiet hours hold back every `create`; `remove` is never held back.
 */
export function planMessages(snap: Snapshot, now: Date, existing: BotMessage[]): Plan {
  const rows = existing.filter((m) => m.kind === 'reminder' || m.kind === 'followup' || m.kind === 'course_finished');
  const remove = staleFollowups(snap, now, rows);
  const quiet = inQuietHours(now, snap.settings.quietHours, snap.settings.timezone);
  return { create: quiet ? [] : wantedMessages(snap, now, rows), remove };
}

// ───────────────────────── removals ─────────────────────────

function staleFollowups(snap: Snapshot, now: Date, rows: BotMessage[]): number[] {
  const today = todayOf(snap, now);
  return rows
    .filter((m) => m.kind === 'followup' && m.deletedAt === null && isStale(snap, now, today, m))
    .map((m) => m.id);
}

function isStale(snap: Snapshot, now: Date, today: LocalDate, m: BotMessage): boolean {
  if (m.petId === null || m.forDate === null) return false;
  if (m.forDate < today) return true;
  if (m.medId !== null) {
    const med = findMed(snap, m.medId);
    return !med || isStopped(med, now) || occurrenceGiven(snap, med, m.forDate);
  }
  const view = m.roundKey === null ? null : buildRoundView(snap, m.petId, m.roundKey, m.forDate, now);
  return !view || view.complete;
}

// ───────────────────────── creations ─────────────────────────

function wantedMessages(snap: Snapshot, now: Date, rows: BotMessage[]): Wanted[] {
  const out: Wanted[] = [];
  for (const pet of snap.settings.pets) {
    for (const round of pet.rounds) out.push(...roundWanted(snap, now, rows, pet.id, round.key));
    const monthly = snap.meds.filter((m) => m.petId === pet.id && m.kind === 'monthly' && !isStopped(m, now));
    for (const med of monthly.sort((a, b) => a.id - b.id)) out.push(...monthlyWanted(snap, now, rows, med));
  }
  return [...out, ...courseFinishedWanted(snap, now, rows)];
}

const same = (m: BotMessage, w: Wanted): boolean =>
  m.kind === w.kind && m.petId === w.petId && m.roundKey === w.roundKey && m.medId === w.medId && m.forDate === w.forDate;

const hasLive = (rows: BotMessage[], w: Wanted): boolean => rows.some((m) => m.deletedAt === null && same(m, w));

function roundWanted(snap: Snapshot, now: Date, rows: BotMessage[], petId: string, roundKey: string): Wanted[] {
  const forDate = todayOf(snap, now);
  const view = buildRoundView(snap, petId, roundKey, forDate, now);
  const pet = findPet(snap.settings, petId);
  const round = pet?.rounds.find((r) => r.key === roundKey);
  if (!view || !pet || !round || view.complete) return [];

  const t = roundTimes(snap.settings, pet, round, forDate);
  if (now >= t.lateAt) return []; // no stale reminders
  const base = { petId, roundKey, medId: null, forDate };
  const reminder: Wanted = { ...base, kind: 'reminder' };
  const followup: Wanted = { ...base, kind: 'followup' };
  return [
    ...(now >= effectiveAt(snap.settings, t.due) && !hasLive(rows, reminder) ? [reminder] : []),
    ...(now >= effectiveAt(snap.settings, t.followupAt) && !hasLive(rows, followup) ? [followup] : []),
  ];
}

function monthlyWanted(snap: Snapshot, now: Date, rows: BotMessage[], med: Med): Wanted[] {
  const pet = findPet(snap.settings, med.petId);
  const forDate = monthlyDueDate(snap, med);
  if (!pet || forDate !== todayOf(snap, now) || occurrenceGiven(snap, med, forDate)) return [];

  const times = monthlyTimes(snap.settings, pet, forDate);
  const base = { petId: med.petId, roundKey: null, medId: med.id, forDate };
  const reminder: Wanted = { ...base, kind: 'reminder' };
  const nudge: Wanted = { ...base, kind: 'followup' };
  const wantReminder = now >= effectiveAt(snap.settings, times.morning) && !hasLive(rows, reminder);
  const reminderExists = wantReminder || rows.some((m) => same(m, reminder));
  const wantNudge = now >= effectiveAt(snap.settings, times.evening) && !hasLive(rows, nudge) && reminderExists;
  return [...(wantReminder ? [reminder] : []), ...(wantNudge ? [nudge] : [])];
}

function courseFinishedWanted(snap: Snapshot, now: Date, rows: BotMessage[]): Wanted[] {
  const tz = snap.settings.timezone;
  const today = todayOf(snap, now);
  return coursesJustFinished(snap, now).flatMap((med): Wanted[] => {
    const pet = findPet(snap.settings, med.petId);
    const end = courseWindow(med, snap.entries, tz).end;
    if (!pet || end === null) return [];
    if (rows.some((m) => m.kind === 'course_finished' && m.medId === med.id)) return [];
    const from = effectiveAt(snap.settings, instantAt(today, pet.monthlyMorning, tz));
    return now >= from ? [{ kind: 'course_finished', petId: med.petId, roundKey: null, medId: med.id, forDate: end }] : [];
  });
}
