import { canFix } from '../domain/index.js';
import type { Snapshot } from '../domain/index.js';
import { findMed, findPet, findRound } from '../domain/snapshot.js';
import { renderGivenAtPicker, renderPanel, typeTimePrompt } from '../render/index.js';
import { lowerFirst } from '../render/text.js';
import { addMinutes, parseTypedTime } from '../time.js';
import type { BotMessage, Callback, EntryItem, Person, Rendered } from '../types.js';
import { createRepos } from '../db/index.js';
import type { Ctx } from './ctx.js';
import { safe } from './ctx.js';
import { planFix } from './fixPlan.js';
import { requestLog, settle } from './logging.js';
import { sendTracked, show, silent } from './messages.js';
import { occurrenceOf } from './occurrence.js';
import type { OccKey, Occurrence } from './occurrence.js';
import { closePanel, deletePrompt, getPanel, isFresh, listPanels, putPanel } from './panelState.js';
import type { PanelState } from './panelState.js';
import { loadSnapshot } from './snapshot.js';
import type { CallbackCtx, CallbackResult, TypedTimeCtx, TypedTimeResult } from './types.js';

export type PanelCallback = Extract<Callback, { t: 'setMed' | 'givenAt' | 'ago' | 'typeTime' | 'back' | 'save' | 'undo' }>;

const STALE: CallbackResult = { toast: 'That button is out of date' };

// ───────────────────────── drawing ─────────────────────────

function panelTitle(ctx: Ctx, snap: Snapshot, key: OccKey): string {
  const pet = findPet(ctx.settings, key.petId);
  const round = pet && key.roundKey !== null ? findRound(pet, key.roundKey) : undefined;
  if (pet && round) return `${round.emoji} ${pet.name} ${lowerFirst(round.name)}`;
  const med = key.medId === null ? undefined : findMed(snap, key.medId);
  return `${med?.kind === 'as_needed' ? '💧' : '📅'} ${pet?.name ?? key.petId}: ${med?.name ?? '?'}`;
}

export function drawPanel(ctx: Ctx, snap: Snapshot, state: PanelState, m: number, now: Date): Rendered {
  if (state.view === 'picker') return renderGivenAtPicker(m, now, ctx.tz);
  const meds = state.meds.map(({ medId, state: s }) => {
    const med = findMed(snap, medId);
    return { name: med?.name ?? '?', state: s, doseNote: med?.doseNote ?? null };
  });
  return renderPanel(
    {
      title: panelTitle(ctx, snap, state),
      meds,
      givenAt: state.givenAt ? new Date(state.givenAt) : now,
      now,
      mode: state.mode,
      pendingAskTime: state.awaiting !== null,
    },
    m,
    ctx.tz,
  );
}

async function redraw(ctx: Ctx, row: BotMessage, state: PanelState, now: Date): Promise<void> {
  await show(ctx, row, drawPanel(ctx, await loadSnapshot(ctx), state, row.id, now));
}

// ───────────────────────── opening ─────────────────────────

type Opened = { state: PanelState } | { refused: CallbackResult };

/** Builds the panel for an occurrence: log mode when nothing is logged, fix mode otherwise. */
function buildState(snap: Snapshot, key: OccKey, recordM: number | null, by: Person, now: Date): Opened {
  const occ = occurrenceOf(snap, key, now);
  if (!occ) return { refused: STALE };
  const target = occ.entries[0];
  if (target) {
    const verdict = canFix(snap, target, by, now);
    if (!verdict.ok) return { refused: { toast: verdict.reason, alert: true } };
  }
  const mode = target ? 'fix' : 'log';
  return {
    state: {
      ...key,
      entryId: target?.id ?? null,
      mode,
      meds: occ.meds.map(({ med, state }) => ({ medId: med.id, state: mode === 'log' && state === 'pending' ? 'given' : state })),
      givenAt: target ? target.givenAt.toISOString() : null,
      view: 'main',
      awaiting: null,
      recordM,
      touchedAt: now.getTime(),
    },
  };
}

/** ⚙️ Change… / ✏️ Fix on a reminder or record message: the panel replaces the message content in place. */
export async function openInPlace(ctx: Ctx, row: BotMessage, key: OccKey, by: Person, now: Date): Promise<CallbackResult> {
  const existing = await getPanel(ctx, row.id, now);
  const snap = await loadSnapshot(ctx);
  const opened = existing ? { state: existing } : buildState(snap, key, row.id, by, now);
  if ('refused' in opened) return opened.refused;
  await putPanel(ctx, row.id, opened.state, now);
  await redraw(ctx, row, opened.state, now);
  return {};
}

/** A Fix panel as its own message in a chat (from the board, or from the admin "Fix a past log" flow). */
export async function openSeparate(
  ctx: Ctx,
  key: OccKey,
  chat: { chatId: number; threadId: number | null },
  by: Person,
  now: Date,
): Promise<CallbackResult> {
  const snap = await loadSnapshot(ctx);
  const opened = buildState(snap, key, null, by, now);
  if ('refused' in opened) return opened.refused;
  const slot = { kind: 'panel' as const, petId: key.petId, roundKey: key.roundKey, medId: key.medId, forDate: key.forDate, ...chat };
  for (const old of await ctx.repos.messages.findLive(slot)) {
    if (old.chatId !== chat.chatId) continue;
    if (await getPanel(ctx, old.id, now)) return { toast: 'The Fix panel is already open above' };
    await closePanel(ctx, old.id, now, { restore: false });
  }
  const row = await sendTracked(ctx, slot, (id) => silent(drawPanel(ctx, snap, opened.state, id, now)));
  if (!row) return { toast: "Couldn't reach Telegram, please try again", alert: true };
  await putPanel(ctx, row.id, opened.state, now);
  return {};
}

// ───────────────────────── interaction ─────────────────────────

/** Drops a panel callback's effects on a message whose state is gone or stale, and tells the user. */
async function expire(ctx: Ctx, row: BotMessage, now: Date): Promise<CallbackResult> {
  await closePanel(ctx, row.id, now, { restore: true });
  return { toast: 'That panel expired. Open it again.' };
}

export async function onPanel(ctx: Ctx, cb: PanelCallback, row: BotMessage, c: CallbackCtx, now: Date): Promise<CallbackResult> {
  const state = await getPanel(ctx, row.id, now);
  if (!state) return expire(ctx, row, now);
  switch (cb.t) {
    case 'setMed': {
      const med = state.meds[cb.i];
      if (!med) return STALE;
      med.state = cb.s;
      break;
    }
    case 'givenAt':
      state.view = 'picker';
      break;
    case 'ago':
      await clearAwaiting(ctx, state);
      state.givenAt = cb.mins === 0 && state.mode === 'log' ? null : addMinutes(now, -cb.mins).toISOString();
      state.view = 'main';
      break;
    case 'typeTime':
      if (!(await askForTime(ctx, row, state, c))) return { toast: "Couldn't reach Telegram, please try again", alert: true };
      break;
    case 'back':
      if (state.view === 'main') {
        await closePanel(ctx, row.id, now, { restore: true });
        return {};
      }
      state.view = 'main';
      break;
    case 'save':
      return state.mode === 'log' ? saveLog(ctx, row, state, c, now) : saveFix(ctx, row, state, c, now);
    case 'undo':
      return state.mode === 'fix' ? undoAll(ctx, row, state, c, now) : STALE;
  }
  await putPanel(ctx, row.id, state, now);
  await redraw(ctx, row, state, now);
  return {};
}

async function clearAwaiting(ctx: Ctx, state: PanelState): Promise<void> {
  await deletePrompt(ctx, state);
  state.awaiting = null;
}

async function askForTime(ctx: Ctx, row: BotMessage, state: PanelState, c: CallbackCtx): Promise<boolean> {
  await clearAwaiting(ctx, state);
  const target = { chatId: row.chatId, threadId: row.threadId };
  const promptMessageId = await safe(ctx, 'send time prompt', () => ctx.messenger.send(target, typeTimePrompt(c.from)));
  if (promptMessageId === undefined) return false;
  state.awaiting = { promptMessageId, chatId: row.chatId, userId: c.from.userId };
  state.view = 'main';
  return true;
}

// ───────────────────────── saving ─────────────────────────

const logItems = (state: PanelState): EntryItem[] =>
  state.meds.flatMap((m): EntryItem[] => (m.state === 'pending' ? [] : [{ medId: m.medId, status: m.state }]));

async function saveLog(ctx: Ctx, row: BotMessage, state: PanelState, c: CallbackCtx, now: Date): Promise<CallbackResult> {
  const items = logItems(state);
  if (items.length === 0) return { toast: 'Tick at least one med first', alert: true };
  const record = state.recordM === null ? null : await ctx.repos.messages.get(state.recordM);
  return requestLog(
    ctx,
    {
      petId: state.petId, roundKey: state.roundKey, forDate: state.forDate, items,
      givenAt: state.givenAt ? new Date(state.givenAt) : now, by: c.from, record, panelM: row.id,
    },
    now,
  );
}

/** The occurrence's entries and the one the panel targets, re-read at save time. */
async function fixTarget(ctx: Ctx, state: PanelState, now: Date): Promise<{ snap: Snapshot; occ: Occurrence; target: Occurrence['entries'][number] } | null> {
  const snap = await loadSnapshot(ctx);
  const occ = occurrenceOf(snap, state, now);
  const target = occ?.entries.find((e) => e.id === state.entryId) ?? occ?.entries[0];
  return occ && target ? { snap, occ, target } : null;
}

async function saveFix(ctx: Ctx, row: BotMessage, state: PanelState, c: CallbackCtx, now: Date): Promise<CallbackResult> {
  const found = await fixTarget(ctx, state, now);
  if (!found) return expire(ctx, row, now);
  const verdict = canFix(found.snap, found.target, c.from, now);
  if (!verdict.ok) return { toast: verdict.reason, alert: true };
  const givenAt = state.givenAt ? new Date(state.givenAt) : found.target.givenAt;
  const ops = planFix(found.occ.entries, found.target, state.meds, givenAt);
  await applyOps(ctx, ops, c.from, now);
  await finishFix(ctx, row, found.target.id, ops.length > 0, now);
  return { toast: ops.length > 0 ? 'Saved ✅' : 'No changes' };
}

async function undoAll(ctx: Ctx, row: BotMessage, state: PanelState, c: CallbackCtx, now: Date): Promise<CallbackResult> {
  const found = await fixTarget(ctx, state, now);
  if (!found) return expire(ctx, row, now);
  const verdict = canFix(found.snap, found.target, c.from, now);
  if (!verdict.ok) return { toast: verdict.reason, alert: true };
  await applyOps(ctx, found.occ.entries.map((e) => ({ entryId: e.id, kind: 'undo' as const })), c.from, now);
  await finishFix(ctx, row, found.target.id, true, now);
  return { toast: 'Undone ↩️' };
}

async function applyOps(ctx: Ctx, ops: ReturnType<typeof planFix>, by: Person, now: Date): Promise<void> {
  await ctx.db.tx(async (tx) => {
    const entries = createRepos(tx).entries;
    for (const op of ops) {
      await entries.revise(
        op.entryId,
        op.kind === 'undo'
          ? { kind: 'undo', by, at: now }
          : { kind: 'edit', by, at: now, items: op.items, ...(op.givenAt ? { givenAt: op.givenAt } : {}) },
      );
    }
  });
}

/** Fixes are quiet: the panel closes and the existing messages are edited. */
async function finishFix(ctx: Ctx, row: BotMessage, entryId: number, changed: boolean, now: Date): Promise<void> {
  await closePanel(ctx, row.id, now, { restore: !changed });
  if (changed) await safe(ctx, 'update messages after fix', () => settle(ctx, entryId, null, now));
}

// ───────────────────────── typed time ─────────────────────────

export async function typedTime(ctx: Ctx, t: TypedTimeCtx, now: Date): Promise<TypedTimeResult> {
  const hit = (await listPanels(ctx)).find(
    (p) => p.state.awaiting?.promptMessageId === t.replyToMessageId && p.state.awaiting.chatId === t.chatId,
  );
  if (!hit || hit.state.awaiting?.userId !== t.from.userId || !isFresh(hit.state, now)) return { handled: false };
  const parsed = parseTypedTime(t.text, now, ctx.tz);
  if (!parsed.ok) {
    const reply = parsed.reason === 'future'
      ? "That time hasn't happened yet. Reply with a time that has, like 7:45 or 7pm."
      : "I couldn't read that time. Try something like 7:45 or 7pm.";
    return { handled: true, reply };
  }
  const state = hit.state;
  await deletePrompt(ctx, state);
  state.awaiting = null;
  state.givenAt = parsed.at.toISOString();
  state.view = 'main';
  await putPanel(ctx, hit.m, state, now);
  const row = await ctx.repos.messages.get(hit.m);
  if (row && !row.deletedAt) await redraw(ctx, row, state, now);
  return { handled: true };
}
