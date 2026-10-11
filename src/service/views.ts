import { buildBoardView, buildRoundView, buildSingleView } from '../domain/index.js';
import type { Snapshot } from '../domain/index.js';
import { findMed, findPet, hasItem } from '../domain/snapshot.js';
import {
  renderBoard,
  renderCourseFinished,
  renderFollowup,
  renderMonthlyNudge,
  renderRound,
  renderSingle,
} from '../render/index.js';
import type { BotMessage, LogEntry, Med, Rendered, SingleMedView } from '../types.js';
import type { Ctx } from './ctx.js';
import { removeMessage, show } from './messages.js';

/** Enough of a row to draw it; lets a message be drawn before its row id is known to be sent. */
export type RowRef = Pick<BotMessage, 'id' | 'kind' | 'petId' | 'roundKey' | 'medId' | 'forDate' | 'messageId'>;

/**
 * An as-needed med as one record message sees it: only the doses attached to that message, because
 * the domain otherwise shows the newest dose across all days on every as-needed message.
 */
export function asNeededView(snap: Snapshot, med: Med, entries: LogEntry[], now: Date): SingleMedView {
  return buildSingleView({ ...snap, entries }, med, now);
}

/** What a bot-owned message should show right now, from the log. null when it no longer applies. */
export function drawRow(ctx: Ctx, snap: Snapshot, row: RowRef, now: Date): Rendered | null {
  switch (row.kind) {
    case 'board':
      return row.petId && findPet(snap.settings, row.petId)
        ? renderBoard(buildBoardView(snap, row.petId, now), row.id, ctx.tz, now)
        : null;
    case 'reminder':
    case 'followup':
      return row.roundKey !== null ? drawRound(ctx, snap, row, now) : drawSingle(ctx, snap, row, now);
    case 'course_finished':
      return drawCourseFinished(snap, row);
    default:
      return null;
  }
}

function drawRound(ctx: Ctx, snap: Snapshot, row: RowRef, now: Date): Rendered | null {
  if (!row.petId || !row.roundKey || !row.forDate) return null;
  const view = buildRoundView(snap, row.petId, row.roundKey, row.forDate, now);
  if (!view) return null;
  return row.kind === 'followup'
    ? renderFollowup(view, ctx.settings.givers, row.id, ctx.tz)
    : renderRound(view, row.id, ctx.tz);
}

function drawSingle(ctx: Ctx, snap: Snapshot, row: RowRef, now: Date): Rendered | null {
  const med = row.medId === null ? undefined : findMed(snap, row.medId);
  if (!med || !row.forDate || (med.kind !== 'monthly' && med.kind !== 'as_needed')) return null;
  const view =
    med.kind === 'as_needed'
      ? asNeededView(snap, med, snap.entries.filter((e) => e.recordMessageId === row.messageId && hasItem(e, med.id)), now)
      : buildSingleView(snap, med, now, row.forDate);
  return row.kind === 'followup'
    ? renderMonthlyNudge(view, ctx.settings.givers, row.id, ctx.tz)
    : renderSingle(view, row.id, ctx.tz);
}

function drawCourseFinished(snap: Snapshot, row: RowRef): Rendered | null {
  const med = row.medId === null ? undefined : findMed(snap, row.medId);
  const pet = row.petId ? findPet(snap.settings, row.petId) : undefined;
  return med && pet ? renderCourseFinished(med.name, pet.name) : null;
}

/**
 * Brings a live message up to date. A round reminder whose round still exists but has no meds and no
 * log (they were all stopped) is deleted. Anything else that cannot be drawn is left alone, so a
 * settings change never wipes the history of "Given by" records.
 */
export async function showRow(ctx: Ctx, snap: Snapshot, row: BotMessage, now: Date): Promise<void> {
  const content = drawRow(ctx, snap, row, now);
  if (content) {
    await show(ctx, row, content);
    return;
  }
  const pet = row.petId ? findPet(snap.settings, row.petId) : undefined;
  const roundExists = pet !== undefined && pet.rounds.some((r) => r.key === row.roundKey);
  if (row.kind === 'reminder' && roundExists) await removeMessage(ctx, row);
}
