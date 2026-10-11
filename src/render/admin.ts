import { fmtDay } from '../time.js';
import type { Button, LocalDate, MedKind, PetConfig, Rendered } from '../types.js';
import { btn, esc } from './text.js';

export interface MedDraft {
  petId?: string;
  name?: string;
  kind?: MedKind;
  roundKeys: string[];
  days?: number;
  doseNote?: string;
  lastGiven?: LocalDate;
  startedOn?: LocalDate;
}

export type DraftField = 'pet' | 'name' | 'kind' | 'rounds' | 'days' | 'doseNote' | 'lastGiven' | 'startedOn';

const KIND_LABEL: Record<MedKind, string> = {
  ongoing: 'ongoing',
  course: 'course',
  monthly: 'monthly',
  as_needed: 'as needed',
};

const hasRounds = (k: MedKind | undefined): boolean => k === 'ongoing' || k === 'course';

/** Names of the fields still to fill in before the draft can start, in card order. */
export function draftMissing(d: MedDraft): string[] {
  const missing: string[] = [];
  if (!d.petId) missing.push('Pet');
  if (!d.name) missing.push('Name');
  if (!d.kind) missing.push('Kind');
  if (hasRounds(d.kind) && d.roundKeys.length === 0) missing.push('Rounds');
  if (d.kind === 'course' && !(d.days !== undefined && d.days >= 1)) missing.push('Days');
  return missing;
}

export function isDraftComplete(d: MedDraft): boolean {
  return draftMissing(d).length === 0;
}

function roundNames(d: MedDraft, pets: PetConfig[]): string[] {
  const rounds = pets.find((p) => p.id === d.petId)?.rounds ?? [];
  return d.roundKeys.map((k) => rounds.find((r) => r.key === k)?.name ?? k);
}

function cardLines(d: MedDraft, pets: PetConfig[]): string[] {
  const dash = '—';
  const lines = [
    `Pet: ${esc(pets.find((p) => p.id === d.petId)?.name ?? dash)}`,
    `Name: ${d.name ? esc(d.name) : dash}`,
    `Kind: ${d.kind ? KIND_LABEL[d.kind] : dash}`,
  ];
  if (hasRounds(d.kind)) {
    const names = roundNames(d, pets);
    lines.push(`Rounds: ${names.length ? names.map(esc).join(' + ') : dash}`);
  }
  if (d.kind === 'course') lines.push(`Days: ${d.days ?? dash}`);
  lines.push(`Dose note: ${d.doseNote ? esc(d.doseNote) : dash}`);
  if (d.kind === 'monthly') lines.push(`Last given: ${d.lastGiven ? fmtDay(d.lastGiven) : dash}`);
  if (d.kind === 'course') lines.push(`Started on: ${d.startedOn ? fmtDay(d.startedOn) : 'first dose'}`);
  return lines;
}

function fieldButtons(d: MedDraft): { label: string; field: DraftField }[] {
  const fields: { label: string; field: DraftField }[] = [
    { label: '🐾 Pet', field: 'pet' },
    { label: '✏️ Name', field: 'name' },
    { label: 'Kind', field: 'kind' },
  ];
  if (hasRounds(d.kind)) fields.push({ label: 'Rounds', field: 'rounds' });
  if (d.kind === 'course') fields.push({ label: 'Days', field: 'days' });
  fields.push({ label: '✏️ Dose note', field: 'doseNote' });
  if (d.kind === 'monthly') fields.push({ label: 'Last given', field: 'lastGiven' });
  if (d.kind === 'course') fields.push({ label: 'Started on', field: 'startedOn' });
  return fields;
}

/** The draft card for ➕ Start: all fields as text, a button per field, and Start once complete. */
export function renderDraftCard(draft: MedDraft, pets: PetConfig[]): Rendered {
  const buttons = fieldButtons(draft).map((f) => btn(f.label, { t: 'admin', a: 'field', v: f.field }));
  const keyboard: Button[][] = [];
  for (let i = 0; i < buttons.length; i += 3) keyboard.push(buttons.slice(i, i + 3));
  const missing = draftMissing(draft);
  keyboard.push([
    missing.length === 0
      ? btn('✅ Start', { t: 'admin', a: 'start' })
      : btn(`✅ Start (fill in: ${missing.join(', ')})`, { t: 'admin', a: 'noop' }),
  ]);
  keyboard.push([btn('Cancel', { t: 'admin', a: 'cancel' })]);
  return { text: ['<b>New med</b>', ...cardLines(draft, pets)].join('\n'), keyboard, silent: true };
}

/** Start / Stop / Edit / Fix a past log. */
export function renderAdminMenu(): Rendered {
  const item = (label: string, v: string) => [btn(label, { t: 'admin', a: 'menu', v })];
  return {
    text: 'What do you want to change?',
    keyboard: [
      item('➕ Start', 'start'),
      item('⏹ Stop', 'stop'),
      item('✏️ Edit', 'edit'),
      item('📜 Fix a past log', 'past'),
    ],
    silent: true,
  };
}

export interface AnnouncedMed {
  name: string;
  kind: MedKind;
  days?: number | null;
  doseNote?: string | null;
}

function describe(med: AnnouncedMed, roundNames: string[]): string {
  const rounds = roundNames.join(' + ');
  const parts: string[] = [];
  if (med.kind === 'course') parts.push(`${med.days ?? '?'} days`);
  else if (med.kind === 'ongoing') parts.push('daily');
  else parts.push(KIND_LABEL[med.kind]);
  if (rounds) parts.push(rounds);
  return parts.join(', ');
}

/** Plain-text line for the pet's topic, e.g. "Rob started Antibiotic: 10 days, morning + evening". */
export function announcement(
  kind: 'start' | 'stop' | 'edit',
  by: string,
  med: AnnouncedMed,
  roundNames: string[],
): string {
  if (kind === 'stop') return `${by} stopped ${med.name}`;
  const verb = kind === 'start' ? 'started' : 'changed';
  const note = med.doseNote ? ` — "${med.doseNote}"` : '';
  return `${by} ${verb} ${med.name}: ${describe(med, roundNames)}${note}`;
}

export function renderAnnouncement(
  kind: 'start' | 'stop' | 'edit',
  by: string,
  med: AnnouncedMed,
  roundNames: string[],
): Rendered {
  return { text: esc(announcement(kind, by, med, roundNames)), keyboard: [] };
}
