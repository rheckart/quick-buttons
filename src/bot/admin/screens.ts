import { btn, clip, esc } from '../../render/index.js';
import { renderAdminMenu } from '../../render/index.js';
import type { Button, Callback, LogEntry, Med, PetConfig, Rendered } from '../../types.js';
import { KIND_CHOICES } from './store.js';

/** Small pure screens for the admin flows. Every one has a « Back or Cancel. */

export const adminCb = (a: string, v?: string): Callback => (v === undefined ? { t: 'admin', a } : { t: 'admin', a, v });

const button = (text: string, a: string, v?: string): Button => btn(text, adminCb(a, v));

const screen = (text: string, keyboard: Button[][]): Rendered => ({ text, keyboard, silent: true });

function rows(buttons: Button[], perRow: number): Button[][] {
  const out: Button[][] = [];
  for (let i = 0; i < buttons.length; i += perRow) out.push(buttons.slice(i, i + perRow));
  return out;
}

export function menuScreen(note?: string): Rendered {
  const menu = renderAdminMenu();
  return note ? { ...menu, text: `${note}\n\n${menu.text}` } : menu;
}

/** Back button and Cancel (back to the menu). */
function footer(back?: Callback): Button[] {
  const cancel = button('Cancel', 'cancel');
  return back ? [btn('« Back', back), cancel] : [cancel];
}

export function askScreen(prompt: string, error: string | undefined, back: Callback): Rendered {
  const text = error ? `${esc(prompt)}\n\n⚠️ ${esc(error)}` : esc(prompt);
  return screen(text, [footer(back)]);
}

export function petChoiceScreen(title: string, pets: PetConfig[], toCb: (pet: PetConfig) => Callback, back: Callback | undefined): Rendered {
  const buttons = pets.map((p) => btn(p.name, toCb(p)));
  return screen(esc(title), [...rows(buttons, 2), footer(back)]);
}

export function kindScreen(back: Callback): Rendered {
  const buttons = KIND_CHOICES.map((k) => button(k.label, 'kind', k.kind));
  return screen('What kind of med is it?', [...rows(buttons, 1), footer(back)]);
}

export function roundsScreen(pet: PetConfig, selected: string[]): Rendered {
  const buttons = pet.rounds.map((r) => button(`${selected.includes(r.key) ? '✅' : '⬜'} ${r.emoji} ${r.name}`, 'round', r.key));
  return screen(`Which rounds is it given in for ${esc(pet.name)}? Tap to switch on or off.`, [
    ...rows(buttons, 2),
    [button('✅ Done', 'rdone'), button('Cancel', 'cancel')],
  ]);
}

const KIND_SHORT: Record<Med['kind'], string> = { ongoing: 'ongoing', course: 'course', monthly: 'monthly', as_needed: 'as needed' };

export function medChoiceScreen(title: string, flow: string, meds: Med[], back: Callback): Rendered {
  if (meds.length === 0) return screen(`${esc(title)}\n\nNo active meds.`, [footer(back)]);
  const buttons = meds.map((m) => button(clip(`${m.name} · ${KIND_SHORT[m.kind]}`, 40), 'med', `${flow}:${m.id}`));
  return screen(esc(title), [...rows(buttons, 1), footer(back)]);
}

export function stopConfirmScreen(med: Med, petName: string, back: Callback): Rendered {
  return screen(`Stop ${esc(med.name)} for ${esc(petName)}? It ends right away.`, [
    [button('⏹ Yes, stop it', 'stopyes', String(med.id))],
    footer(back),
  ]);
}

export function editFieldsScreen(med: Med, petName: string, back: Callback): Rendered {
  const fields: Button[] = [button('✏️ Dose note', 'ef', 'note')];
  if (med.kind === 'course') fields.push(button('Days', 'ef', 'days'));
  if (med.kind === 'ongoing' || med.kind === 'course') fields.push(button('Rounds', 'ef', 'rounds'));
  return screen(`${esc(med.name)} (${esc(petName)}): what do you want to change?`, [fields, footer(back)]);
}

export function editConfirmScreen(summary: string, back: Callback): Rendered {
  return screen(esc(summary), [[button('✅ Yes, change it', 'editYes')], footer(back)]);
}

export function pastLogsScreen(petName: string, items: { entry: LogEntry; label: string }[], back: Callback, max: number): Rendered {
  if (items.length === 0) return screen(`${esc(petName)}: no logs in the last 2 weeks.`, [footer(back)]);
  const shown = items.slice(0, max);
  const more = items.length > shown.length ? ` (latest ${shown.length} of ${items.length})` : '';
  const buttons = shown.map((i) => button(i.label, 'entry', String(i.entry.id)));
  return screen(`${esc(petName)}: which log do you want to fix?${more}`, [...rows(buttons, 1), footer(back)]);
}

/** The last text of a finished flow: no buttons. */
export function doneScreen(text: string): Rendered {
  return screen(text, []);
}
