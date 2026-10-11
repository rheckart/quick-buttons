import { fmtShortDay, fmtTime, localDate } from '../time.js';
import type { Button, Callback, Person, Rendered } from '../types.js';
import { btn, esc, lowerFirst } from './text.js';

export interface DoubleDoseArgs {
  petName: string;
  /** Round name ("Morning") when `isRound`, otherwise the med's name. */
  roundOrMedName: string;
  by: Person;
  givenAt: Date;
  /** Lower-cases the first letter of the round name, so it reads "Twiggy morning". */
  isRound?: boolean;
  /** When given and the dose was on another local day, the text says "on 2 Oct at 8:15". */
  now?: Date;
}

export function renderDoubleDose(args: DoubleDoseArgs, msgId: number, tz: string): Rendered {
  const what = args.isRound ? lowerFirst(args.roundOrMedName) : args.roundOrMedName;
  const day = localDate(args.givenAt, tz);
  const otherDay = args.now && day !== localDate(args.now, tz) ? `on ${fmtShortDay(day)} ` : '';
  return {
    text: `⚠️ ${esc(args.petName)} ${esc(what)} was already given by ${esc(args.by.name)} ${otherDay}at ${fmtTime(args.givenAt, tz)}. Log it again?`,
    keyboard: [[btn('Yes, log again', { t: 'dd', m: msgId, yes: true }), btn('Cancel', { t: 'dd', m: msgId, yes: false })]],
    silent: true,
  };
}

export function renderCourseFinished(medName: string, _petName: string): Rendered {
  return { text: `${esc(medName)} course finished 🎉`, keyboard: [] };
}

/** Plain text (escaped), no buttons. */
export function renderText(text: string): Rendered {
  return { text: esc(text), keyboard: [], silent: true };
}

/** A list of options laid out in `columns`, with an optional « Back row. `title` is plain text. */
export function renderChoice(
  title: string,
  options: { label: string; data: Callback }[],
  columns = 1,
  back?: Callback,
): Rendered {
  const buttons = options.map((o) => btn(o.label, o.data));
  const keyboard: Button[][] = [];
  for (let i = 0; i < buttons.length; i += columns) keyboard.push(buttons.slice(i, i + columns));
  if (back) keyboard.push([btn('« Back', back)]);
  return { text: esc(title), keyboard, silent: true };
}

export function renderConfirm(
  text: string,
  yes: Callback,
  no: Callback,
  labels: { yes?: string; no?: string } = {},
): Rendered {
  return {
    text: esc(text),
    keyboard: [[btn(labels.yes ?? '✅ Yes', yes), btn(labels.no ?? '✖ No', no)]],
    silent: true,
  };
}
