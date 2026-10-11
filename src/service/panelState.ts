import type { MedState } from '../types.js';
import type { Ctx } from './ctx.js';
import { safe } from './ctx.js';
import { removeMessage } from './messages.js';
import type { OccKey } from './occurrence.js';
import { loadSnapshot } from './snapshot.js';
import { showRow } from './views.js';

/** An open Change/Fix panel. Lives in ui_state under `panel:<BotMessage.id of the message showing it>`. */
export interface PanelState extends OccKey {
  mode: 'log' | 'fix';
  /** In panel order; buttons refer to a row by index into this list. */
  meds: { medId: number; state: MedState }[];
  /** ISO instant. null = "now, at the moment of saving" (log mode only). */
  givenAt: string | null;
  view: 'main' | 'picker';
  /** Set while waiting for a typed time: the force-reply prompt and who may answer it. */
  awaiting: { promptMessageId: number; chatId: number; userId: number } | null;
  /** The reminder/record message the panel was opened from, reused as the record message. */
  recordM: number | null;
  /** ms since epoch of the last interaction; ui_state exposes no updated_at. */
  touchedAt: number;
}

/** A panel left alone this long is stale: the next pass closes it. */
export const PANEL_TTL_MS = 15 * 60_000;

export const panelKey = (m: number): string => `panel:${m}`;

export const isFresh = (state: PanelState, now: Date): boolean => now.getTime() - state.touchedAt < PANEL_TTL_MS;

export const readPanel = (ctx: Ctx, m: number): Promise<PanelState | null> =>
  ctx.repos.ui.get<PanelState>(panelKey(m));

/** The panel's state, or null when missing or stale. */
export async function getPanel(ctx: Ctx, m: number, now: Date): Promise<PanelState | null> {
  const state = await readPanel(ctx, m);
  return state && isFresh(state, now) ? state : null;
}

export async function putPanel(ctx: Ctx, m: number, state: PanelState, now: Date): Promise<void> {
  state.touchedAt = now.getTime();
  await ctx.repos.ui.set(panelKey(m), state, now);
}

export async function listPanels(ctx: Ctx): Promise<{ m: number; state: PanelState }[]> {
  const rows = await ctx.db.query<{ key: string; value: PanelState }>(
    "SELECT key, value FROM ui_state WHERE key LIKE 'panel:%'",
  );
  return rows.map((r) => ({ m: Number(r.key.slice('panel:'.length)), state: r.value }));
}

export async function deletePrompt(ctx: Ctx, state: PanelState): Promise<void> {
  if (!state.awaiting) return;
  const { chatId, promptMessageId } = state.awaiting;
  await safe(ctx, 'delete time prompt', () => ctx.messenger.delete(chatId, promptMessageId));
}

/**
 * Closes a panel. A panel that is its own message is deleted. One opened on a reminder/record message
 * is put back to what the log says, unless the caller is about to redraw that message anyway.
 */
export async function closePanel(ctx: Ctx, m: number, now: Date, opts: { restore: boolean }): Promise<void> {
  const state = await readPanel(ctx, m);
  await ctx.repos.ui.delete(panelKey(m));
  if (state) await deletePrompt(ctx, state);
  const row = await ctx.repos.messages.get(m);
  if (!row || row.deletedAt) return;
  if (row.kind === 'panel') await removeMessage(ctx, row);
  else if (opts.restore) await showRow(ctx, await loadSnapshot(ctx), row, now);
}
