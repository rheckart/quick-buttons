import { fmtDay, fmtTime } from '../time.js';
import type { Giver, Rendered, SingleMedView } from '../types.js';
import { givenHeader } from './round.js';
import { btn, esc } from './text.js';

const noteLine = (v: SingleMedView): string[] => (v.med.doseNote ? [`• ${esc(v.med.doseNote)}`] : []);

const icon = (v: SingleMedView): string => (v.med.kind === 'as_needed' ? '💧' : '📅');

function isRecord(v: SingleMedView): boolean {
  if (v.phase === 'given') return true;
  return v.phase === 'as_needed' && v.latest !== null && v.latest.undoneBy === null;
}

function recordForm(v: SingleMedView, msgId: number, tz: string): Rendered {
  const lines: string[] = [];
  if (v.latest) lines.push(givenHeader(v.latest, tz));
  else if (v.lastGivenBy && v.lastGivenAt) lines.push(`✅ Given by ${esc(v.lastGivenBy.name)} at ${fmtTime(v.lastGivenAt, tz)}`);
  lines.push(`${icon(v)} ${esc(v.petName)}: ${esc(v.med.name)}`);
  if (v.latest?.editedBy) lines.push(`✏️ edited by ${esc(v.latest.editedBy.name)}`);
  return { text: lines.join('\n'), keyboard: [[btn('✏️ Fix', { t: 'change', m: msgId })]] };
}

function promptLine(v: SingleMedView): string {
  const head = `${icon(v)} ${esc(v.petName)}: ${esc(v.med.name)}`;
  const day = v.dueDate ? fmtDay(v.dueDate) : '';
  switch (v.phase) {
    case 'late': return `⚠️ LATE · ${head} was due ${day}`;
    case 'upcoming': return `${head} due ${day}`;
    case 'due': return `${head} is due today`;
    default: return `${head} · tap to log`;
  }
}

/** Reminder / record message of a monthly or as-needed med. */
export function renderSingle(view: SingleMedView, msgId: number, tz: string): Rendered {
  if (isRecord(view)) return recordForm(view, msgId, tz);
  const lines = [promptLine(view), ...noteLine(view)];
  if (view.latest?.undoneBy) lines.push(`↩️ Undone by ${esc(view.latest.undoneBy.name)}`);
  return { text: lines.join('\n'), keyboard: [[btn('✅ Given', { t: 'logSingle', m: msgId })]] };
}

/** Evening "still not given" message for a monthly med. Deliberately mentions nobody. */
export function renderMonthlyNudge(view: SingleMedView, _givers: Giver[], msgId: number, _tz: string): Rendered {
  const lines = [`🔔 ${icon(view)} ${esc(view.petName)}: ${esc(view.med.name)} still not given today`, ...noteLine(view)];
  return { text: lines.join('\n'), keyboard: [[btn('✅ Given', { t: 'logSingle', m: msgId })]] };
}
