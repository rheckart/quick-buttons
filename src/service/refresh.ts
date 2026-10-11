import { buildBoardView, planMessages } from '../domain/index.js';
import type { Plan, Snapshot, Wanted } from '../domain/index.js';
import { findPet, todayOf } from '../domain/snapshot.js';
import { renderBoard } from '../render/index.js';
import { inQuietHours } from '../time.js';
import type { BotMessage } from '../types.js';
import type { Ctx } from './ctx.js';
import { safe } from './ctx.js';
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

/** The scheduler tick. Idempotent: with nothing changed it makes no Telegram calls. */
export async function reconcile(ctx: Ctx): Promise<void> {
  const now = ctx.clock.now();
  await ensureBoards(ctx);
  await sweepDeadRows(ctx, now);
  const quiet = inQuietHours(now, ctx.settings.quietHours, ctx.tz);
  if (!quiet) await sweepStale(ctx, now);

  const snap = await loadSnapshot(ctx);
  const live = await loadLiveRows(ctx);
  const plan = planMessages(snap, now, await loadPlanningRows(ctx, live, todayOf(snap, now)));
  await applyRemovals(ctx, plan, live);
  if (quiet) return;
  for (const wanted of plan.create) await safe(ctx, `create ${wanted.kind}`, () => createWanted(ctx, snap, wanted, now));
  await rerender(ctx, snap, live.filter((r) => !plan.remove.includes(r.id)), now);
}
