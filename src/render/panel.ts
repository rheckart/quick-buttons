import { fmtShortDay, fmtTime, localDate, minutesBetween, addMinutes } from '../time.js';
import type { Button, MedState, Person, Rendered } from '../types.js';
import { btn, clip, esc, mention } from './text.js';

export interface PanelMed {
  name: string;
  state: MedState;
  doseNote: string | null;
}

export interface PanelArgs {
  /** Plain text (escaped here), e.g. "☀️ Twiggy morning". */
  title: string;
  meds: PanelMed[];
  givenAt: Date;
  now: Date;
  /** `log` = first logging from a reminder; `fix` = editing an existing log (adds Undo, Save). */
  mode: 'log' | 'fix';
  /** A typed time is being awaited (after ⌨️ Type a time). */
  pendingAskTime?: boolean;
}

const STATE_ICON: Record<MedState, string> = { given: '✅', pending: '✖', skipped: '⏭' };
const STATE_LABEL: Record<MedState, string> = { given: '✅', pending: '✖ not yet', skipped: '⏭ skip' };
const STATES: MedState[] = ['given', 'pending', 'skipped'];

function medLine(m: PanelMed): string {
  const note = m.doseNote ? ` — ${esc(m.doseNote)}` : '';
  return `${STATE_ICON[m.state]} ${esc(m.name)}${note}`;
}

function medRow(m: PanelMed, i: number, msgId: number): Button[] {
  return STATES.map((s, k) => {
    const label = k === 0 ? `${STATE_LABEL[s]} ${clip(m.name, 14)}` : STATE_LABEL[s];
    return btn(m.state === s ? `• ${label}` : label, { t: 'setMed', m: msgId, i, s });
  });
}

export function givenAtLabel(givenAt: Date, now: Date, tz: string): string {
  const near = Math.abs(minutesBetween(givenAt, now)) <= 1;
  const day = localDate(givenAt, tz);
  const other = day !== localDate(now, tz) ? ` ${fmtShortDay(day)}` : '';
  return `🕐 Given at ${fmtTime(givenAt, tz)}${near ? ' (now)' : other} ▸`;
}

/** The Change / Fix panel: a row of three choices per med, the given-at button, and the action row. */
export function renderPanel(args: PanelArgs, msgId: number, tz: string): Rendered {
  const { meds, mode } = args;
  const lines = [`<b>${esc(args.title)}</b>`, ...meds.map(medLine)];
  if (args.pendingAskTime) lines.push('', '⌨️ Reply to my question with the time, e.g. 7:45 or 7pm.');
  const actions =
    mode === 'fix'
      ? [[btn('« Back', { t: 'back', m: msgId }), btn('✅ Save', { t: 'save', m: msgId })], [btn('🗑 Undo', { t: 'undo', m: msgId })]]
      : [[btn('« Back', { t: 'back', m: msgId }), btn('✅ Log these', { t: 'save', m: msgId })]];
  return {
    text: lines.join('\n'),
    keyboard: [
      ...meds.map((m, i) => medRow(m, i, msgId)),
      [btn(givenAtLabel(args.givenAt, args.now, tz), { t: 'givenAt', m: msgId })],
      ...actions,
    ],
  };
}

const AGO: { mins: number; label: string }[] = [
  { mins: 0, label: 'Now' },
  { mins: 15, label: '15 min ago' },
  { mins: 30, label: '30 min ago' },
  { mins: 60, label: '1 h ago' },
  { mins: 120, label: '2 h ago' },
];

/** "Given at" picker: quick offsets (with the resulting time shown) or a typed time. */
export function renderGivenAtPicker(msgId: number, now: Date, tz: string): Rendered {
  const buttons = AGO.map(({ mins, label }) =>
    btn(`${label} · ${fmtTime(addMinutes(now, -mins), tz)}`, { t: 'ago', m: msgId, mins }),
  );
  buttons.push(btn('⌨️ Type a time', { t: 'typeTime', m: msgId }));
  const rows: Button[][] = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  rows.push([btn('« Back', { t: 'back', m: msgId })]);
  return { text: '🕐 When was it given?', keyboard: rows };
}

/**
 * Asked as a force_reply message so the typed answer arrives even with bot privacy mode on. It mentions the
 * person who tapped: in a group the messenger sends it as a *selective* force reply, so only they get the
 * reply box.
 */
export function typeTimePrompt(by: Person): Rendered {
  return {
    text: `⌨️ ${mention(by)}, reply with when it was given, e.g. 7:45 or 7pm.`,
    keyboard: [],
    forceReply: true,
    silent: true,
  };
}
