import type { MedPatch, NewMed } from '../db/repos.js';
import { findPet } from '../domain/snapshot.js';
import { renderAnnouncement } from '../render/index.js';
import type { MedDraft } from '../render/index.js';
import { addDays, fmtShortDay, fmtTime, isLocalDate, localDate } from '../time.js';
import type { LocalDate, LogEntry, Med, MedKind, PetConfig, Person } from '../types.js';
import { clip } from '../render/text.js';
import type { Ctx } from './ctx.js';
import { isAdmin, safe } from './ctx.js';
import { ServiceError } from './errors.js';
import { reconcile, refreshPet } from './refresh.js';
import { loadSnapshot } from './snapshot.js';
import { openSeparate } from './panel.js';
import type { OccKey } from './occurrence.js';

const MAX_NAME = 60;
const MAX_NOTE = 200;
const MAX_DAYS = 3650;

function requireAdmin(ctx: Ctx, by: Person): void {
  if (!isAdmin(ctx, by.userId)) throw new ServiceError('Only admins can change meds.');
}

function petOrThrow(ctx: Ctx, petId: string | undefined): PetConfig {
  const pet = petId ? findPet(ctx.settings, petId) : undefined;
  if (!pet) throw new ServiceError('Pick a pet first.');
  return pet;
}

function cleanName(name: string | undefined): string {
  const n = (name ?? '').trim();
  if (!n) throw new ServiceError('The med needs a name.');
  if ([...n].length > MAX_NAME) throw new ServiceError(`That name is too long (${MAX_NAME} characters at most).`);
  return n;
}

function cleanNote(note: string | null | undefined): string | null {
  const n = (note ?? '').trim();
  if ([...n].length > MAX_NOTE) throw new ServiceError(`That dose note is too long (${MAX_NOTE} characters at most).`);
  return n || null;
}

function cleanRounds(pet: PetConfig, keys: string[] | undefined): string[] {
  const unique = [...new Set(keys ?? [])];
  if (unique.length === 0) throw new ServiceError(`Pick at least one round for ${pet.name}.`);
  const unknown = unique.filter((k) => !pet.rounds.some((r) => r.key === k));
  if (unknown.length > 0) throw new ServiceError(`${pet.name} has no round called ${unknown.join(', ')}.`);
  return unique;
}

function cleanDays(days: number | null | undefined): number {
  if (!Number.isInteger(days) || (days as number) < 1 || (days as number) > MAX_DAYS) {
    throw new ServiceError('A course needs a whole number of days, 1 or more.');
  }
  return days as number;
}

function cleanDate(value: LocalDate | null | undefined, label: string): LocalDate | null {
  if (value === undefined || value === null) return null;
  if (!isLocalDate(value)) throw new ServiceError(`${label} must be a date like 2026-10-14.`);
  return value;
}

const isDaily = (kind: MedKind): boolean => kind === 'ongoing' || kind === 'course';

function toNewMed(ctx: Ctx, draft: MedDraft, now: Date): NewMed {
  const pet = petOrThrow(ctx, draft.petId);
  if (!draft.kind) throw new ServiceError('Pick what kind of med it is.');
  const kind = draft.kind;
  return {
    petId: pet.id,
    name: cleanName(draft.name),
    kind,
    doseNote: cleanNote(draft.doseNote),
    roundKeys: isDaily(kind) ? cleanRounds(pet, draft.roundKeys) : [],
    days: kind === 'course' ? cleanDays(draft.days) : null,
    startedOn: kind === 'course' ? cleanDate(draft.startedOn, 'Started on') : null,
    seedLastGiven: kind === 'monthly' ? cleanDate(draft.lastGiven, 'Last given') : null,
    createdAt: now,
  };
}

async function announce(ctx: Ctx, what: 'start' | 'stop' | 'edit', by: Person, med: Med): Promise<void> {
  const pet = findPet(ctx.settings, med.petId);
  if (!pet) return;
  const roundNames = med.roundKeys.map((k) => pet.rounds.find((r) => r.key === k)?.name.toLowerCase() ?? k);
  const content = renderAnnouncement(what, by.name, med, roundNames);
  await safe(ctx, 'announce', () => ctx.messenger.send({ chatId: ctx.settings.groupChatId, threadId: pet.topicId }, content));
}

/** An admin change is user-driven, so it shows at once even in quiet hours. */
async function applyChange(ctx: Ctx, petId: string): Promise<void> {
  await reconcile(ctx);
  await refreshPet(ctx, await loadSnapshot(ctx), petId, ctx.clock.now());
}

export async function startMed(ctx: Ctx, draft: MedDraft, by: Person): Promise<Med> {
  requireAdmin(ctx, by);
  const med = await ctx.repos.meds.insert(toNewMed(ctx, draft, ctx.clock.now()));
  await announce(ctx, 'start', by, med);
  await applyChange(ctx, med.petId);
  return med;
}

async function activeMed(ctx: Ctx, medId: number): Promise<Med> {
  const med = await ctx.repos.meds.get(medId);
  if (!med || (med.stoppedAt !== null && med.stoppedAt <= ctx.clock.now())) throw new ServiceError('That med is not active.');
  return med;
}

export async function stopMed(ctx: Ctx, medId: number, by: Person): Promise<Med> {
  requireAdmin(ctx, by);
  await activeMed(ctx, medId);
  const med = await ctx.repos.meds.stop(medId, ctx.clock.now());
  await announce(ctx, 'stop', by, med);
  await applyChange(ctx, med.petId);
  return med;
}

function cleanPatch(ctx: Ctx, med: Med, patch: MedPatch): MedPatch {
  const pet = petOrThrow(ctx, med.petId);
  const out: MedPatch = {};
  if (patch.name !== undefined) out.name = cleanName(patch.name);
  if (patch.doseNote !== undefined) out.doseNote = cleanNote(patch.doseNote);
  if (patch.roundKeys !== undefined) {
    if (!isDaily(med.kind)) throw new ServiceError('Only daily meds are given in rounds.');
    out.roundKeys = cleanRounds(pet, patch.roundKeys);
  }
  if (patch.days !== undefined) {
    if (med.kind !== 'course') throw new ServiceError('Only a course has a number of days.');
    out.days = cleanDays(patch.days);
  }
  if (patch.startedOn !== undefined) {
    if (med.kind !== 'course') throw new ServiceError('Only a course has a start date.');
    out.startedOn = cleanDate(patch.startedOn, 'Started on');
  }
  if (patch.seedLastGiven !== undefined) {
    if (med.kind !== 'monthly') throw new ServiceError('Only a monthly med has a last given date.');
    out.seedLastGiven = cleanDate(patch.seedLastGiven, 'Last given');
  }
  if (Object.keys(out).length === 0) throw new ServiceError('Nothing to change.');
  return out;
}

export async function editMed(ctx: Ctx, medId: number, patch: MedPatch, by: Person): Promise<Med> {
  requireAdmin(ctx, by);
  const current = await activeMed(ctx, medId);
  const med = await ctx.repos.meds.update(medId, cleanPatch(ctx, current, patch));
  await announce(ctx, 'edit', by, med);
  await applyChange(ctx, med.petId);
  return med;
}

// ───────────────────────── fixing old logs ─────────────────────────

function entryLabel(ctx: Ctx, entry: LogEntry, meds: Med[]): string {
  const pet = findPet(ctx.settings, entry.petId);
  const round = entry.roundKey === null ? undefined : pet?.rounds.find((r) => r.key === entry.roundKey);
  const med = meds.find((m) => m.id === entry.items[0]?.medId);
  const what = round ? `${round.emoji} ${round.name}` : `${med?.kind === 'as_needed' ? '💧' : '📅'} ${med?.name ?? '?'}`;
  return clip(`${what} · ${fmtShortDay(entry.forDate)} · ${entry.loggedBy.name} ${fmtTime(entry.givenAt, ctx.tz)}`, 60);
}

/** Active logs of the last `days` days, newest first, labelled for a pick-list button. */
export async function listPastEntries(ctx: Ctx, petId: string, days = 14): Promise<{ entry: LogEntry; label: string }[]> {
  const since = addDays(localDate(ctx.clock.now(), ctx.tz), -days);
  const [entries, meds] = await Promise.all([
    ctx.repos.entries.listForPet(petId, { sinceDate: since }),
    ctx.repos.meds.listForPet(petId),
  ]);
  return entries
    .sort((a, b) => b.givenAt.getTime() - a.givenAt.getTime() || b.id - a.id)
    .map((entry) => ({ entry, label: entryLabel(ctx, entry, meds) }));
}

export async function openFixPanel(ctx: Ctx, entryId: number, chatId: number, threadId: number | null, by: Person): Promise<void> {
  requireAdmin(ctx, by);
  const entry = await ctx.repos.entries.get(entryId);
  if (!entry || entry.undone) throw new ServiceError('That log no longer exists or was already undone.');
  const medId = entry.roundKey === null ? (entry.items[0]?.medId ?? null) : null;
  const key: OccKey = {
    petId: entry.petId, roundKey: entry.roundKey, medId, forDate: entry.forDate, entryId: entry.id,
  };
  const result = await openSeparate(ctx, key, { chatId, threadId }, by, ctx.clock.now());
  if (result.toast) throw new ServiceError(result.toast);
}
