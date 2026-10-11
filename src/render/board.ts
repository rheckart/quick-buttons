import { fmtDay, fmtShortDay, fmtTime, localDate } from '../time.js';
import type { BoardView, Button, Rendered, RoundView, SingleMedView } from '../types.js';
import { btn, clip, esc } from './text.js';

/** Telegram truncates long button text on phones; keep labels short and cut the name, not the status. */
const MAX_LABEL = 60;
const MAX_NAME = 22;
const MAX_LEFT_LIST = 30;

function partialStatus(pending: string[]): string {
  const list = pending.join(', ');
  return list.length <= MAX_LEFT_LIST ? `◐ ${list} left` : `◐ ${pending.length} left`;
}

function roundStatus(r: RoundView, tz: string): string {
  const pending = r.meds.filter((m) => m.state === 'pending').map((m) => m.med.name);
  if (r.complete) return r.latest ? `✅ ${r.latest.by.name} ${fmtTime(r.latest.givenAt, tz)}` : '✅ done';
  if (r.anyLogged && pending.length) return partialStatus(pending);
  if (r.phase === 'late') return '⚠️ LATE';
  if (r.phase === 'due') return `⏳ due ${fmtTime(r.due)}`;
  return `🔜 ${fmtTime(r.due)}`;
}

function roundButton(r: RoundView, tz: string): Button {
  const label = `${r.emoji} ${clip(r.roundName, MAX_NAME)} · ${roundStatus(r, tz)}`;
  return btn(clip(label, MAX_LABEL), { t: 'board', petId: r.petId, target: r.roundKey });
}

function singleStatus(s: SingleMedView, tz: string): string {
  if (s.med.kind === 'as_needed') {
    return s.lastGivenAt ? `last ${fmtShortDay(localDate(s.lastGivenAt, tz))}` : 'never';
  }
  if (s.phase === 'given') {
    const who = s.lastGivenBy ? `${s.lastGivenBy.name} ` : '';
    const day = s.lastGivenAt ? fmtShortDay(localDate(s.lastGivenAt, tz)) : '';
    return `✅ ${who}${day}`.trimEnd();
  }
  if (s.phase === 'late') return '⚠️ LATE';
  return s.dueDate ? `due ${fmtDay(s.dueDate)}` : 'due';
}

function singleButton(s: SingleMedView, tz: string): Button {
  const icon = s.med.kind === 'as_needed' ? '💧' : '📅';
  const label = `${icon} ${clip(s.med.name, MAX_NAME)} · ${singleStatus(s, tz)}`;
  return btn(clip(label, MAX_LABEL), { t: 'board', petId: s.petId, target: `m${s.med.id}` });
}

/** The pinned board: one full-width button per round, monthly med and as-needed med, status in the label. */
export function renderBoard(view: BoardView, _boardMsgId: number, tz: string, _now: Date): Rendered {
  return {
    text: `📋 ${esc(view.petName)} · tap to log`,
    keyboard: [...view.rounds.map((r) => [roundButton(r, tz)]), ...view.singles.map((s) => [singleButton(s, tz)])],
    silent: true,
  };
}
