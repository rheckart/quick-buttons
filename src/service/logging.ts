import { buildRoundView, buildSingleView, findDoubleDose } from '../domain/index.js';
import type { DoubleDose, Snapshot } from '../domain/index.js';
import { findMed, findPet, findRound } from '../domain/snapshot.js';
import { renderDoubleDose, renderRound, renderSingle } from '../render/index.js';
import type { BotMessage, EntryItem, LocalDate, LogEntry, Person, Rendered } from '../types.js';
import type { Ctx } from './ctx.js';
import { safe } from './ctx.js';
import { removeMessage, sendTracked, silent } from './messages.js';
import type { Slot } from './messages.js';
import { closePanel } from './panelState.js';
import { refreshPet } from './refresh.js';
import { loadSnapshot } from './snapshot.js';
import type { CallbackResult } from './types.js';
import { asNeededView, showRow } from './views.js';

export interface LogRequest {
  petId: string;
  roundKey: string | null;
  forDate: LocalDate;
  items: EntryItem[];
  givenAt: Date;
  by: Person;
  /** The reminder/record message the user tapped, if any. */
  record: BotMessage | null;
  /** The open panel (BotMessage.id) to close once the log is written. */
  panelM: number | null;
}

/** A LogRequest parked in ui_state `dd:<prompt id>` while the double-dose question is open. */
type StoredRequest = Omit<LogRequest, 'givenAt' | 'record'> & { givenAt: string; recordM: number | null };

const ddKey = (promptId: number): string => `dd:${promptId}`;

/** Logs unless something in the request was already given for this occurrence; then it asks first. */
export async function requestLog(ctx: Ctx, req: LogRequest, now: Date): Promise<CallbackResult> {
  const snap = await loadSnapshot(ctx);
  const givenIds = req.items.filter((i) => i.status === 'given').map((i) => i.medId);
  const dose = findDoubleDose(snap, req.petId, req.roundKey, req.forDate, givenIds);
  if (dose) return askDoubleDose(ctx, snap, req, dose, now);
  await commitLog(ctx, req, now);
  return { toast: 'Logged ✅' };
}

/** Writes the entry (DB first), then updates the messages. Telegram trouble never undoes the log. */
export async function commitLog(ctx: Ctx, req: LogRequest, now: Date): Promise<LogEntry> {
  const entry = await ctx.repos.entries.create({
    petId: req.petId,
    roundKey: req.roundKey,
    forDate: req.forDate,
    givenAt: req.givenAt,
    loggedAt: now,
    by: req.by,
    items: req.items,
  });
  await safe(ctx, 'close panel', async () => {
    if (req.panelM !== null) await closePanel(ctx, req.panelM, now, { restore: false });
  });
  await safe(ctx, 'update messages after log', () => settle(ctx, entry.id, req.record, now));
  return entry;
}

/**
 * After an entry changed: make sure its record message exists and is current, then refresh the pet's
 * follow-ups, reminders and board. The reminder IS the record; a new silent one is posted only when the
 * round or med was logged before any reminder existed.
 */
export async function settle(ctx: Ctx, entryId: number, hint: BotMessage | null, now: Date): Promise<void> {
  let snap = await loadSnapshot(ctx);
  const entry = snap.entries.find((e) => e.id === entryId);
  if (!entry) return;
  const row = await recordRow(ctx, snap, entry, hint, now);
  if (row && !entry.undone && entry.recordMessageId !== row.messageId) {
    await ctx.repos.entries.setRecordMessage(entry.id, row.messageId);
    snap = await loadSnapshot(ctx);
  }
  if (row) await showRow(ctx, snap, row, now);
  await refreshPet(ctx, snap, entry.petId, now);
}

async function recordRow(
  ctx: Ctx,
  snap: Snapshot,
  entry: LogEntry,
  hint: BotMessage | null,
  now: Date,
): Promise<BotMessage | null> {
  const med = entry.roundKey === null ? findMed(snap, entry.items[0]?.medId ?? -1) : undefined;
  if (hint && !hint.deletedAt && hint.kind === 'reminder' && hint.roundKey === entry.roundKey && hint.medId === (med?.id ?? null)) return hint;
  const query = { petId: entry.petId, roundKey: entry.roundKey, medId: med?.id ?? null, forDate: entry.forDate };
  const found = await findRecordRow(ctx, entry, med, query);
  if (found) return found;
  if (entry.undone) return null;
  const pet = findPet(ctx.settings, entry.petId);
  if (!pet) return null;
  const slot: Slot = { kind: 'reminder', ...query, chatId: ctx.settings.groupChatId, threadId: pet.topicId };
  return sendTracked(ctx, slot, (id) => silent(drawRecord(ctx, snap, entry, med, id, now)));
}

/** Round/monthly records are found by occurrence; each as-needed dose has its own message. */
async function findRecordRow(
  ctx: Ctx,
  entry: LogEntry,
  med: ReturnType<typeof findMed>,
  query: { petId: string; roundKey: string | null; medId: number | null; forDate: LocalDate },
): Promise<BotMessage | undefined> {
  if (med?.kind !== 'as_needed') return (await ctx.repos.messages.findLive({ kind: 'reminder', ...query })).at(-1);
  const { forDate: _forDate, ...anyDay } = query;
  const rows = await ctx.repos.messages.findLive({ kind: 'reminder', ...anyDay });
  return rows.find((r) => r.messageId === entry.recordMessageId);
}

function drawRecord(ctx: Ctx, snap: Snapshot, entry: LogEntry, med: ReturnType<typeof findMed>, id: number, now: Date): Rendered {
  if (entry.roundKey !== null) {
    const view = buildRoundView(snap, entry.petId, entry.roundKey, entry.forDate, now);
    if (!view) throw new Error('round has no meds');
    return renderRound(view, id, ctx.tz);
  }
  if (!med) throw new Error('entry has no med');
  const view =
    med.kind === 'as_needed' ? asNeededView(snap, med, [entry], now) : buildSingleView(snap, med, now, entry.forDate);
  return renderSingle(view, id, ctx.tz);
}

// ───────────────────────── double-dose guard ─────────────────────────

async function askDoubleDose(ctx: Ctx, snap: Snapshot, req: LogRequest, dose: DoubleDose, now: Date): Promise<CallbackResult> {
  const pet = findPet(ctx.settings, req.petId);
  if (!pet) return { toast: 'That button is out of date' };
  const isRound = req.roundKey !== null;
  const medId = isRound ? null : (req.items[0]?.medId ?? null);
  const name = isRound ? findRound(pet, req.roundKey!)?.name : findMed(snap, medId!)?.name;
  const slot: Slot = {
    kind: 'double_dose', petId: req.petId, roundKey: req.roundKey, medId, forDate: req.forDate,
    chatId: ctx.settings.groupChatId, threadId: pet.topicId,
  };
  if ((await ctx.repos.messages.findLive(slot)).length > 0) return { toast: 'Already asking above ☝️' };
  const args = { petName: pet.name, roundOrMedName: name ?? '?', by: dose.person, givenAt: dose.givenAt, isRound, now };
  const prompt = await sendTracked(ctx, slot, (id) => renderDoubleDose(args, id, ctx.tz));
  if (!prompt) return { toast: "Couldn't reach Telegram, please try again", alert: true };
  const stored: StoredRequest = {
    petId: req.petId, roundKey: req.roundKey, forDate: req.forDate, items: req.items,
    givenAt: req.givenAt.toISOString(), by: req.by, recordM: req.record?.id ?? null, panelM: req.panelM,
  };
  await ctx.repos.ui.set(ddKey(prompt.id), stored, now);
  return { toast: 'Already logged, please confirm below' };
}

/** The answer to a double-dose prompt. The prompt is deleted either way. */
export async function answerDoubleDose(ctx: Ctx, prompt: BotMessage, yes: boolean, now: Date): Promise<CallbackResult> {
  const stored = await ctx.repos.ui.get<StoredRequest>(ddKey(prompt.id));
  await ctx.repos.ui.delete(ddKey(prompt.id));
  await removeMessage(ctx, prompt);
  if (!stored) return { toast: 'That button is out of date' };
  if (!yes) return { toast: 'Cancelled' };
  const record = stored.recordM === null ? null : await ctx.repos.messages.get(stored.recordM);
  await commitLog(ctx, { ...stored, givenAt: new Date(stored.givenAt), record }, now);
  return { toast: 'Logged ✅' };
}
