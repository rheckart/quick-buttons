import { buildBoardView, buildRoundView, planMessages } from '../domain/index.js';
import type { Plan, Snapshot, Wanted } from '../domain/index.js';
import { findMed, findPet, todayOf } from '../domain/snapshot.js';
import { renderBoard } from '../render/index.js';
import { addDays, inQuietHours } from '../time.js';
import type { BotMessage, LogEntry } from '../types.js';
import type { Ctx } from './ctx.js';
import { safe } from './ctx.js';
import { settle } from './logging.js';
import { removeMessage, sendTracked, sweepDeadRows } from './messages.js';
import type { Slot } from './messages.js';
import { closePanel, isFresh, listPanels, panelKey } from './panelState.js';
import { inRefreshWindow, loadLiveRows, loadPlanningRows } from './rows.js';
import { loadSnapshot } from './snapshot.js';
import { drawRow, showRow } from './views.js';

const DOUBLE_DOSE_TTL_MS = 60 * 60_000;

/** Creates and pins (silently) a board for every pet that has none. */
export async function ensureBoards(ctx: Ctx): Promise<void> {
  const now = ctx.clock.now();
  let snap: Snapshot | undefined;
  for (const pet of ctx.settings.pets) {
    if ((await ctx.repos.messages.findLive({ kind: 'board', petId: pet.id })).length > 0) continue;
    snap ??= await loadSnapshot(ctx);
    const board = snap;
    const slot: Slot = {
      kind: 'board', petId: pet.id, roundKey: null, medId: null, forDate: null,
      chatId: ctx.settings.groupChatId, threadId: pet.topicId,
    };
    const row = await sendTracked(ctx, slot, (id) => renderBoard(buildBoardView(board, pet.id, now), id, ctx.tz, now));
    if (row) await safe(ctx, 'pin board', () => ctx.messenger.pin(row.chatId, row.messageId));
  }
}

async function createWanted(ctx: Ctx, snap: Snapshot, w: Wanted, now: Date): Promise<void> {
  const pet = findPet(ctx.settings, w.petId);
  if (!pet) return;
  const slot: Slot = {
    kind: w.kind, petId: w.petId, roundKey: w.roundKey, medId: w.medId, forDate: w.forDate,
    chatId: ctx.settings.groupChatId, threadId: pet.topicId,
  };
  await sendTracked(ctx, slot, (id) => {
    const content = drawRow(ctx, snap, { ...slot, id, messageId: 0 }, now);
    if (!content) throw new Error(`nothing to draw for ${w.kind}`);
    return content;
  });
}

async function applyRemovals(ctx: Ctx, plan: Plan, rows: BotMessage[]): Promise<void> {
  for (const id of plan.remove) {
    const row = rows.find((r) => r.id === id);
    if (row) await removeMessage(ctx, row);
  }
}

/** Edits every live message whose content changed (this is how LATE and board labels appear). */
async function rerender(ctx: Ctx, snap: Snapshot, rows: BotMessage[], now: Date, petId?: string): Promise<void> {
  const today = todayOf(snap, now);
  const openPanels = new Set((await listPanels(ctx)).filter((p) => isFresh(p.state, now)).map((p) => p.m));
  for (const row of rows) {
    if (row.messageId === 0 || (petId && row.petId !== petId)) continue;
    if (!inRefreshWindow(row, today) || openPanels.has(row.id)) continue;
    await showRow(ctx, snap, row, now);
  }
}

/**
 * After a tap: drop follow-ups that are no longer needed and bring one pet's messages up to date.
 * Ignores quiet hours (taps always refresh immediately) and never sends new reminders.
 */
export async function refreshPet(ctx: Ctx, snap: Snapshot, petId: string, now: Date): Promise<void> {
  const live = await loadLiveRows(ctx);
  const planning = await loadPlanningRows(ctx, live, todayOf(snap, now));
  const plan = planMessages(snap, now, planning);
  await applyRemovals(ctx, plan, live);
  await rerender(ctx, snap, live.filter((r) => !plan.remove.includes(r.id)), now, petId);
}

/** Closes panels nobody touched for a while and drops double-dose prompts nobody answered. */
async function sweepStale(ctx: Ctx, now: Date): Promise<void> {
  const panels = await listPanels(ctx);
  for (const { m, state } of panels) {
    if (!isFresh(state, now)) await closePanel(ctx, m, now, { restore: true });
  }
  for (const row of await ctx.repos.messages.findLive({ kind: 'panel' })) {
    if (!(await ctx.repos.ui.get(panelKey(row.id)))) await removeMessage(ctx, row);
  }
  for (const row of await ctx.repos.messages.findLive({ kind: 'double_dose' })) {
    if (now.getTime() - row.createdAt.getTime() < DOUBLE_DOSE_TTL_MS) continue;
    await ctx.repos.ui.delete(`dd:${row.id}`);
    await removeMessage(ctx, row);
  }
}

/** Does a live reminder row stand for this entry's record message? */
function hasRecordRow(snap: Snapshot, entry: LogEntry, rows: BotMessage[], now: Date): boolean | 'skip' {
  if (entry.roundKey !== null) {
    if (!buildRoundView(snap, entry.petId, entry.roundKey, entry.forDate, now)) return 'skip';
    return rows.some((r) => r.petId === entry.petId && r.roundKey === entry.roundKey && r.medId === null && r.forDate === entry.forDate);
  }
  const med = findMed(snap, entry.items[0]?.medId ?? -1);
  if (!med) return 'skip';
  if (med.kind === 'as_needed') {
    return entry.recordMessageId !== null && rows.some((r) => r.petId === entry.petId && r.medId === med.id && r.messageId === entry.recordMessageId);
  }
  return rows.some((r) => r.petId === entry.petId && r.roundKey === null && r.medId === med.id && r.forDate === entry.forDate);
}

/**
 * A log is written before its record message is sent, so a Telegram outage (or a record deleted by hand and
 * then noticed) can leave an active entry with no record. The planner skips completed rounds, so nothing else
 * would ever post one. Looks at today and yesterday and posts the missing records.
 */
async function repostMissingRecords(ctx: Ctx, now: Date): Promise<void> {
  const snap = await loadSnapshot(ctx);
  const today = todayOf(snap, now);
  const since = addDays(today, -1);
  let rows = await ctx.repos.messages.findLive({ kind: 'reminder' });
  for (const entry of snap.entries) {
    if (entry.undone || entry.forDate < since || entry.forDate > today) continue;
    if (hasRecordRow(snap, entry, rows, now) !== false) continue;
    await safe(ctx, `repost record of entry ${entry.id}`, () => settle(ctx, entry.id, null, now));
    rows = await ctx.repos.messages.findLive({ kind: 'reminder' });
  }
}

/** One planning pass. Returns true when a live message turned out to be gone from Telegram. */
async function pass(ctx: Ctx): Promise<boolean> {
  const now = ctx.clock.now();
  await ensureBoards(ctx);
  await sweepDeadRows(ctx, now);
  const quiet = inQuietHours(now, ctx.settings.quietHours, ctx.tz);
  if (!quiet) await sweepStale(ctx, now);

  const snap = await loadSnapshot(ctx);
  const live = await loadLiveRows(ctx);
  const plan = planMessages(snap, now, await loadPlanningRows(ctx, live, todayOf(snap, now)));
  await applyRemovals(ctx, plan, live);
  if (quiet) return false;
  for (const wanted of plan.create) await safe(ctx, `create ${wanted.kind}`, () => createWanted(ctx, snap, wanted, now));
  await repostMissingRecords(ctx, now);
  const kept = live.filter((r) => !plan.remove.includes(r.id));
  await rerender(ctx, snap, kept, now);
  const stillLive = new Set((await loadLiveRows(ctx)).map((r) => r.id));
  return kept.some((r) => !stillLive.has(r.id));
}

/**
 * The scheduler tick. Idempotent: with nothing changed it makes no Telegram calls. A message found gone
 * while editing (deleted by hand) is posted again in the same tick, by a second pass.
 */
export async function reconcile(ctx: Ctx): Promise<void> {
  if (await pass(ctx)) await pass(ctx);
}
