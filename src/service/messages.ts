import { hashRendered } from '../render/index.js';
import type { BotMessage, LocalDate, Rendered } from '../types.js';
import type { Ctx } from './ctx.js';

/** Where a tracked message lives and what it stands for. */
export interface Slot {
  kind: BotMessage['kind'];
  petId: string | null;
  roundKey: string | null;
  medId: number | null;
  forDate: LocalDate | null;
  chatId: number;
  threadId: number | null;
}

export const silent = (r: Rendered): Rendered => ({ ...r, silent: true });

/**
 * Sends a message that has buttons or must be found again. The row is inserted first because the
 * rendered buttons carry its id; messageId 0 marks "not sent yet". A failed send leaves no row.
 */
export async function sendTracked(ctx: Ctx, slot: Slot, draw: (rowId: number) => Rendered): Promise<BotMessage | null> {
  const row = await ctx.repos.messages.insert({ ...slot, messageId: 0, renderHash: '', createdAt: ctx.clock.now() });
  let content: Rendered;
  let messageId: number;
  try {
    content = draw(row.id);
    messageId = await ctx.messenger.send({ chatId: slot.chatId, threadId: slot.threadId }, content);
  } catch (err) {
    ctx.log.warn(`sending ${slot.kind} failed`, err);
    await ctx.db.query('DELETE FROM bot_messages WHERE id = $1', [row.id]);
    return null;
  }
  const renderHash = hashRendered(content);
  await ctx.db.query('UPDATE bot_messages SET message_id = $2, render_hash = $3 WHERE id = $1', [
    row.id,
    messageId,
    renderHash,
  ]);
  return { ...row, messageId, renderHash };
}

/** Edits the message when what it should show changed. False when the edit failed (retried next time). */
export async function show(ctx: Ctx, row: BotMessage, content: Rendered): Promise<boolean> {
  const hash = hashRendered(content);
  if (hash === row.renderHash) return true;
  try {
    await ctx.messenger.edit(row.chatId, row.messageId, content);
  } catch (err) {
    ctx.log.warn(`editing ${row.kind} ${row.id} failed`, err);
    return false;
  }
  await ctx.repos.messages.setRenderHash(row.id, hash);
  return true;
}

/** Deletes the Telegram message and marks the row. On failure the row stays live and is retried. */
export async function removeMessage(ctx: Ctx, row: BotMessage): Promise<boolean> {
  if (row.messageId !== 0) {
    try {
      await ctx.messenger.delete(row.chatId, row.messageId);
    } catch (err) {
      ctx.log.warn(`deleting ${row.kind} ${row.id} failed`, err);
      return false;
    }
  }
  await ctx.repos.messages.markDeleted(row.id, ctx.clock.now());
  return true;
}

/** Rows whose send never finished (crash between insert and send) must not block future reminders. */
export async function sweepDeadRows(ctx: Ctx, now: Date): Promise<void> {
  await ctx.db.query('DELETE FROM bot_messages WHERE message_id = 0 AND deleted_at IS NULL AND created_at < $1', [
    new Date(now.getTime() - 60_000),
  ]);
}
