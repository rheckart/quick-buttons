import { buildRoundView, monthlyOccurrence } from '../domain/index.js';
import type { Snapshot } from '../domain/index.js';
import { findMed, findPet, findRound, hasItem, isStopped, todayOf } from '../domain/snapshot.js';
import type { BotMessage, BotMessageKind, Callback, Med } from '../types.js';
import type { Ctx } from './ctx.js';
import { isAdmin } from './ctx.js';
import { answerDoubleDose, requestLog } from './logging.js';
import type { LogRequest } from './logging.js';
import type { OccKey } from './occurrence.js';
import { onPanel, openInPlace, openSeparate } from './panel.js';
import type { PanelCallback } from './panel.js';
import { loadSnapshot } from './snapshot.js';
import type { CallbackCtx, CallbackResult } from './types.js';

const STALE: CallbackResult = { toast: 'That button is out of date' };
const NOT_HERE: CallbackResult = { toast: "That button doesn't work here", alert: true };

/** Which message kinds each button type may sit on. */
function kindsFor(t: Callback['t']): BotMessageKind[] {
  switch (t) {
    case 'logAll':
    case 'logSingle':
      return ['reminder', 'followup'];
    case 'change':
      return ['reminder'];
    case 'dd':
      return ['double_dose'];
    default:
      return ['reminder', 'panel']; // panel buttons: in place on a record, or on a panel message
  }
}

/** Group buttons work in the group. Private chats only host admin-opened panels. */
function chatAllowed(ctx: Ctx, row: BotMessage, c: CallbackCtx): boolean {
  if (row.chatId !== c.chatId) return false;
  return c.chatId === ctx.settings.groupChatId || (row.kind === 'panel' && isAdmin(ctx, c.from.userId));
}

export async function dispatchCallback(ctx: Ctx, cb: Callback, c: CallbackCtx): Promise<CallbackResult> {
  const now = ctx.clock.now();
  if (cb.t === 'admin') return {}; // the bot's private-chat flow handles these
  if (cb.t === 'board') return onBoard(ctx, cb, c, now);
  const row = await ctx.repos.messages.get(cb.m);
  if (!row || row.deletedAt || !kindsFor(cb.t).includes(row.kind)) return STALE;
  if (!chatAllowed(ctx, row, c)) return NOT_HERE;
  switch (cb.t) {
    case 'logAll': return onLogAll(ctx, row, c, now);
    case 'logSingle': return onLogSingle(ctx, row, c, now);
    case 'change': return onChange(ctx, row, c, now);
    case 'dd': return answerDoubleDose(ctx, row, cb.yes, now);
    default: return onPanel(ctx, cb as PanelCallback, row, c, now);
  }
}

// ───────────────────────── reminders and records ─────────────────────────

const given = (medIds: number[]) => medIds.map((medId) => ({ medId, status: 'given' as const }));

const sourceRow = (row: BotMessage): BotMessage | null => (row.kind === 'reminder' ? row : null);

async function onLogAll(ctx: Ctx, row: BotMessage, c: CallbackCtx, now: Date): Promise<CallbackResult> {
  if (row.roundKey === null) return onLogSingle(ctx, row, c, now);
  if (!row.petId || !row.forDate) return STALE;
  const view = buildRoundView(await loadSnapshot(ctx), row.petId, row.roundKey, row.forDate, now);
  if (!view) return STALE;
  const pending = view.meds.filter((m) => m.state === 'pending');
  // Nothing pending means a stale button or a second person's tap: re-logging everything trips the double-dose guard.
  const targets = pending.length > 0 ? pending : view.meds;
  return requestLog(ctx, roundRequest(view.petId, view.roundKey, view.forDate, targets.map((m) => m.med.id), c, sourceRow(row), now), now);
}

async function onLogSingle(ctx: Ctx, row: BotMessage, c: CallbackCtx, now: Date): Promise<CallbackResult> {
  const snap = await loadSnapshot(ctx);
  const med = row.medId === null ? undefined : findMed(snap, row.medId);
  if (!med || isStopped(med, now) || !isSingle(med)) return STALE;
  return requestLog(ctx, singleRequest(snap, med, c, sourceRow(row), now), now);
}

const isSingle = (med: Med): boolean => med.kind === 'monthly' || med.kind === 'as_needed';

function roundRequest(
  petId: string, roundKey: string, forDate: string, medIds: number[], c: CallbackCtx, record: BotMessage | null, now: Date,
): LogRequest {
  return { petId, roundKey, forDate, items: given(medIds), givenAt: now, by: c.from, record, panelM: null };
}

/** A monthly tap belongs to the current occurrence; an as-needed dose to the day it is given. */
function singleRequest(snap: Snapshot, med: Med, c: CallbackCtx, record: BotMessage | null, now: Date): LogRequest {
  const forDate = med.kind === 'monthly' ? monthlyOccurrence(snap, med, now) : todayOf(snap, now);
  return { petId: med.petId, roundKey: null, forDate, items: given([med.id]), givenAt: now, by: c.from, record, panelM: null };
}

/** ⚙️ Change… (log) or ✏️ Fix on the reminder/record message itself. */
async function onChange(ctx: Ctx, row: BotMessage, c: CallbackCtx, now: Date): Promise<CallbackResult> {
  if (!row.petId || !row.forDate) return STALE;
  const key = await keyOfRow(ctx, row, now);
  return key ? openInPlace(ctx, row, key, c.from, now) : STALE;
}

async function keyOfRow(ctx: Ctx, row: BotMessage, now: Date): Promise<OccKey | null> {
  if (!row.petId || !row.forDate) return null;
  const base = { petId: row.petId, roundKey: row.roundKey, medId: row.medId, forDate: row.forDate, entryId: null };
  if (row.roundKey !== null || row.medId === null) return base;
  const snap = await loadSnapshot(ctx);
  const med = findMed(snap, row.medId);
  if (!med || med.kind !== 'as_needed') return base;
  const dose = snap.entries
    .filter((e) => !e.undone && e.recordMessageId === row.messageId && hasItem(e, med.id))
    .sort((a, b) => b.loggedAt.getTime() - a.loggedAt.getTime() || b.id - a.id)[0];
  return { ...base, forDate: dose?.forDate ?? todayOf(snap, now), entryId: dose?.id ?? null };
}

// ───────────────────────── board ─────────────────────────

async function onBoard(ctx: Ctx, cb: Extract<Callback, { t: 'board' }>, c: CallbackCtx, now: Date): Promise<CallbackResult> {
  if (c.chatId !== ctx.settings.groupChatId) return NOT_HERE;
  const pet = findPet(ctx.settings, cb.petId);
  if (!pet) return STALE;
  const snap = await loadSnapshot(ctx);
  const medTarget = /^m(\d+)$/.exec(cb.target);
  if (medTarget && !findRound(pet, cb.target)) return boardSingle(ctx, snap, pet.id, Number(medTarget[1]), c, now);
  const today = todayOf(snap, now);
  const view = buildRoundView(snap, pet.id, cb.target, today, now);
  if (!view) return STALE;
  if (view.complete) {
    const key: OccKey = { petId: pet.id, roundKey: cb.target, medId: null, forDate: today, entryId: null };
    return openSeparate(ctx, key, { chatId: c.chatId, threadId: pet.topicId }, c.from, now);
  }
  const pending = view.meds.filter((m) => m.state === 'pending').map((m) => m.med.id);
  return requestLog(ctx, roundRequest(pet.id, cb.target, today, pending, c, null, now), now);
}

async function boardSingle(ctx: Ctx, snap: Snapshot, petId: string, medId: number, c: CallbackCtx, now: Date): Promise<CallbackResult> {
  const med = findMed(snap, medId);
  if (!med || med.petId !== petId || isStopped(med, now) || !isSingle(med)) return STALE;
  return requestLog(ctx, singleRequest(snap, med, c, null, now), now);
}
