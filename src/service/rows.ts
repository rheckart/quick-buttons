import { addDays } from '../time.js';
import type { BotMessage, LocalDate } from '../types.js';
import type { Ctx } from './ctx.js';

/** Live board / reminder / follow-up rows, oldest first. Includes unsent (messageId 0) rows. */
export async function loadLiveRows(ctx: Ctx): Promise<BotMessage[]> {
  const kinds = ['board', 'reminder', 'followup'] as const;
  const lists = await Promise.all(kinds.map((kind) => ctx.repos.messages.findLive({ kind })));
  return lists.flat();
}

/**
 * What the planner needs to know: live reminders/follow-ups, anything sent for today (live or deleted),
 * and every course-finished notice (so one is never sent twice).
 */
export async function loadPlanningRows(ctx: Ctx, live: BotMessage[], today: LocalDate): Promise<BotMessage[]> {
  const [reminders, followups, finished] = await Promise.all([
    ctx.repos.messages.findAny({ kind: 'reminder', forDate: today }),
    ctx.repos.messages.findAny({ kind: 'followup', forDate: today }),
    ctx.repos.messages.findAny({ kind: 'course_finished' }),
  ]);
  const byId = new Map<number, BotMessage>();
  for (const row of [...live.filter((r) => r.kind !== 'board'), ...reminders, ...followups, ...finished]) {
    byId.set(row.id, row);
  }
  return [...byId.values()];
}

/** How far back live messages are still kept up to date. Older ones are left as they were. */
export const REFRESH_DAYS = 14;

export const inRefreshWindow = (row: BotMessage, today: LocalDate): boolean =>
  row.kind === 'board' || (row.forDate !== null && row.forDate >= addDays(today, -REFRESH_DAYS));
