import { fmtTime } from '../time.js';
import type { Button, EntryView, Giver, Rendered, RoundView } from '../types.js';
import { btn, esc, joinEsc, lowerFirst, mention } from './text.js';

const names = (view: RoundView, state: 'given' | 'skipped' | 'pending'): string[] =>
  view.meds.filter((m) => m.state === state).map((m) => m.med.name);

const roundTitle = (view: RoundView, medNames: string[]): string =>
  `${view.emoji} ${esc(view.petName)} ${esc(lowerFirst(view.roundName))}: ${joinEsc(medNames, ' + ')}`;

/** "✅ Given [late] by X at T [(logged T)]". */
export function givenHeader(e: EntryView, tz: string): string {
  const late = e.givenLate ? ' late' : '';
  const logged = e.backdated ? ` (logged ${fmtTime(e.loggedAt, tz)})` : '';
  return `✅ Given${late} by ${esc(e.by.name)} at ${fmtTime(e.givenAt, tz)}${logged}`;
}

function reminderForm(view: RoundView, msgId: number): Rendered {
  const pending = view.meds.filter((m) => m.state === 'pending');
  const lines = [roundTitle(view, pending.map((m) => m.med.name))];
  for (const { med } of pending) if (med.doseNote) lines.push(`• ${esc(med.name)}: ${esc(med.doseNote)}`);
  lines.push(`Late after ${fmtTime(view.lateAfter)}`);
  if (view.phase === 'late') lines.push('⚠️ LATE');
  if (view.latest?.undoneBy) lines.push(`↩️ Undone by ${esc(view.latest.undoneBy.name)}`);
  return {
    text: lines.join('\n'),
    keyboard: [[btn('✅ All given', { t: 'logAll', m: msgId }), btn('⚙️ Change…', { t: 'change', m: msgId })]],
  };
}

function recordForm(view: RoundView, msgId: number, tz: string): Rendered {
  const lines: string[] = [];
  if (view.latest) lines.push(givenHeader(view.latest, tz));
  const given = names(view, 'given');
  if (given.length) lines.push(`${view.emoji} ${esc(view.petName)} ${esc(lowerFirst(view.roundName))}: ${joinEsc(given, ', ')}`);
  const skipped = names(view, 'skipped');
  if (skipped.length) lines.push(`⏭ Skipped: ${joinEsc(skipped, ', ')}`);
  const left = names(view, 'pending');
  if (left.length) lines.push(`⏳ Still to give: ${joinEsc(left, ', ')}`);
  if (left.length && view.phase === 'late') lines.push('⚠️ LATE');
  if (view.latest?.editedBy) lines.push(`✏️ edited by ${esc(view.latest.editedBy.name)}`);
  const row: Button[] = [];
  if (left.length) row.push(btn('✅ Log the rest', { t: 'logAll', m: msgId }));
  row.push(btn('✏️ Fix', { t: 'change', m: msgId }));
  return { text: lines.join('\n'), keyboard: [row] };
}

/** The reminder / record message of a round, drawn from its current state. */
export function renderRound(view: RoundView, msgId: number, tz: string): Rendered {
  return view.anyLogged ? recordForm(view, msgId, tz) : reminderForm(view, msgId);
}

/** Halfway-to-late nudge: @mentions the givers and lists only what is left. */
export function renderFollowup(view: RoundView, givers: Giver[], msgId: number, _tz: string): Rendered {
  const left = names(view, 'pending');
  const who = givers.map(mention).join(' ');
  const text = [
    `⏰ ${who}`.trimEnd(),
    `${esc(view.petName)} ${esc(lowerFirst(view.roundName))}: ${joinEsc(left, ', ')} still not given (late at ${fmtTime(view.lateAfter)})`,
  ].join('\n');
  return { text, keyboard: [[btn('✅ All given', { t: 'logAll', m: msgId })]] };
}
