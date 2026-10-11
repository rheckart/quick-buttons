import type { MedPatch } from '../../db/repos.js';
import { announcement, draftMissing, esc, isDraftComplete, renderDraftCard } from '../../render/index.js';
import type { DraftField } from '../../render/index.js';
import { ServiceError } from '../../service/index.js';
import type { Logger, Service } from '../../service/index.js';
import { localDate } from '../../time.js';
import type { Callback, Clock, Med, MedKind, Messenger, PetConfig, Person, Rendered, Settings } from '../../types.js';
import {
  askPrompt, fieldApplies, isTypedField, parseTyped, toggleRound, withKind, withPet, withTyped,
} from './draft.js';
import type { TypedField } from './draft.js';
import {
  adminCb, askScreen, doneScreen, editConfirmScreen, editFieldsScreen, kindScreen, medChoiceScreen, menuScreen,
  pastLogsScreen, petChoiceScreen, roundsScreen, stopConfirmScreen,
} from './screens.js';
import { KIND_CHOICES } from './store.js';
import type { DraftStore, Session, View } from './store.js';

export interface ControllerDeps {
  service: Service;
  settings: Settings;
  messenger: Messenger;
  store: DraftStore;
  clock: Clock;
  logger: Logger;
}

/** The message a button sits on. */
export interface Tap {
  from: Person;
  chatId: number;
  messageId: number;
}

export interface Reply {
  toast?: string;
  alert?: boolean;
}

export interface IncomingText {
  from: Person;
  chatId: number;
  messageId: number;
  text: string | undefined;
  /** Telegram id of the bot message this one replies to, if it is a reply to one. */
  replyTo: number | undefined;
}

const MAX_PAST_BUTTONS = 20;
const STALE: Reply = { toast: 'That is out of date. Send any message to open the menu.' };
const DRAFT_FIELDS: DraftField[] = ['pet', 'name', 'kind', 'rounds', 'days', 'doseNote', 'lastGiven', 'startedOn'];
const MENU_COMMAND = /^\/(start|menu)(@\w+)?(\s|$)/i;

const isKind = (v: string | undefined): v is MedKind => KIND_CHOICES.some((k) => k.kind === v);
const isDraftField = (v: string | undefined): v is DraftField => DRAFT_FIELDS.includes(v as DraftField);
const toId = (v: string | undefined): number | null => (v !== undefined && /^\d+$/.test(v) ? Number(v) : null);

function awaitingTyped(view: View): boolean {
  return view.v === 'ask' || view.v === 'editAsk';
}

export function createAdminController(d: ControllerDeps) {
  const { service, settings, messenger, store, logger } = d;
  const pet = (id: string | undefined): PetConfig | undefined => settings.pets.find((p) => p.id === id);
  const today = () => localDate(d.clock.now(), settings.timezone);
  const menuBack = adminCb('menuback');

  // ───────────── small helpers ─────────────

  async function swallow(what: string, fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      logger.warn(`admin: ${what} failed`, err);
    }
  }

  const draw = (chatId: number, messageId: number, content: Rendered) => messenger.edit(chatId, messageId, content);

  function failure(err: unknown): Reply {
    if (err instanceof ServiceError) return { toast: err.message, alert: true };
    logger.error('admin action failed', err);
    return { toast: 'Something went wrong, please try again.', alert: true };
  }

  async function findMed(medId: number): Promise<{ med: Med; pet: PetConfig } | null> {
    for (const p of settings.pets) {
      const med = (await service.listMeds(p.id)).find((m) => m.id === medId);
      if (med) return { med, pet: p };
    }
    return null;
  }

  async function sendMenu(chatId: number, note?: string): Promise<void> {
    await messenger.send({ chatId }, menuScreen(note));
  }

  /** Forget the session if it is shown on this message. */
  async function dropSessionOn(tap: Tap): Promise<void> {
    const s = await store.get(tap.chatId);
    if (s?.screen === tap.messageId) await store.delete(tap.chatId);
  }

  /** The session shown on this message, or undefined when the button is stale. */
  async function sessionOn(tap: Tap): Promise<Session | undefined> {
    const s = await store.get(tap.chatId);
    return s?.screen === tap.messageId ? s : undefined;
  }

  // ───────────── rendering a session ─────────────

  async function render(s: Session): Promise<Rendered> {
    const v = s.view;
    if (s.flow === 'start') return renderStart(s, v);
    return renderEdit(s, v);
  }

  function renderStart(s: Session, v: View): Rendered {
    const back = adminCb('back');
    switch (v.v) {
      case 'pet': return petChoiceScreen('Which pet?', settings.pets, (p) => adminCb('pet', p.id), back);
      case 'kind': return kindScreen(back);
      case 'rounds': return roundsScreen(pet(s.draft.petId)!, s.draft.roundKeys);
      case 'ask': return askScreen(askPrompt(v.field), v.error, back);
      default: return renderDraftCard(s.draft, settings.pets);
    }
  }

  async function renderEdit(s: Session, v: View): Promise<Rendered> {
    const found = s.edit ? await findMed(s.edit.medId) : null;
    if (!found) return menuScreen('That med is not active any more.');
    const back = adminCb('back');
    const toList = adminCb('pick', `edit:${found.pet.id}`);
    switch (v.v) {
      case 'editAsk': return askScreen(editPrompt(v.field), v.error, back);
      case 'editRounds': return roundsScreen(found.pet, v.roundKeys);
      case 'editConfirm': return editConfirmScreen(describeChange(found.med, found.pet, v.patch), back);
      default: return editFieldsScreen(found.med, found.pet.name, toList);
    }
  }

  /** Shows a view and answers the tap with no toast. */
  async function go(tap: Tap, s: Session, view: View): Promise<Reply> {
    await show(tap.chatId, s, view);
    return {};
  }

  async function show(chatId: number, s: Session, view: View): Promise<void> {
    const next: Session = { ...s, view };
    await store.set(chatId, next);
    await draw(chatId, s.screen, await render(next));
  }

  /** Starts a session on a message; the previous session's message (if elsewhere) is removed. */
  async function open(chatId: number, s: Session): Promise<void> {
    const old = await store.get(chatId);
    if (old && old.screen !== s.screen) await swallow('delete old card', () => messenger.delete(chatId, old.screen));
    await show(chatId, s, s.view);
  }

  // ───────────── incoming text ─────────────

  /** Returns false when the message is not ours to handle (the caller passes it on). */
  async function onText(m: IncomingText): Promise<boolean> {
    if (m.text !== undefined && MENU_COMMAND.test(m.text)) {
      await reopenMenu(m.chatId);
      return true;
    }
    if (m.text?.startsWith('/')) return false;
    const s = await store.get(m.chatId);
    if (s && awaitingTyped(s.view) && m.text !== undefined) {
      if (m.replyTo !== undefined && m.replyTo !== s.screen) return typedTime(m, m.replyTo);
      await onAnswer(s, m.chatId, m.messageId, m.text);
      return true;
    }
    if (m.replyTo !== undefined) return typedTime(m, m.replyTo);
    await reopenMenu(m.chatId);
    return true;
  }

  /** A message while a question is open and no answer fits: the question is dropped, the card shows again, then the menu. */
  async function reopenMenu(chatId: number): Promise<void> {
    const s = await store.get(chatId);
    if (s && awaitingTyped(s.view)) await show(chatId, s, s.flow === 'start' ? { v: 'card' } : { v: 'editFields' });
    await sendMenu(chatId);
  }

  /** A reply to a bot message may answer a "Type a time" prompt on a Fix panel opened in this chat. */
  async function typedTime(m: IncomingText, replyTo: number): Promise<boolean> {
    if (m.text === undefined) return false;
    const r = await service.handleTypedTime({ from: m.from, chatId: m.chatId, replyToMessageId: replyTo, text: m.text });
    if (r.handled && r.reply) await messenger.send({ chatId: m.chatId }, { text: esc(r.reply), keyboard: [], silent: true });
    return r.handled;
  }

  async function onAnswer(s: Session, chatId: number, messageId: number, text: string): Promise<void> {
    await swallow('delete answer', () => messenger.delete(chatId, messageId));
    if (s.view.v === 'ask') await answerDraft(s, s.view.field, chatId, text);
    else if (s.view.v === 'editAsk') await answerEdit(s, s.view.field, chatId, text);
  }

  async function answerDraft(s: Session, field: TypedField, chatId: number, text: string): Promise<void> {
    const r = parseTyped(field, text, today());
    if (!r.ok) return show(chatId, s, { v: 'ask', field, error: r.error });
    await show(chatId, { ...s, draft: withTyped(s.draft, field, r.value) }, { v: 'card' });
  }

  async function answerEdit(s: Session, field: 'days' | 'doseNote', chatId: number, text: string): Promise<void> {
    const found = s.edit ? await findMed(s.edit.medId) : null;
    if (!found) return show(chatId, s, { v: 'editFields' });
    const r = parseTyped(field, text, today());
    if (!r.ok) return show(chatId, s, { v: 'editAsk', field, error: r.error });
    const patch: MedPatch = field === 'days' ? { days: r.value as number } : { doseNote: (r.value as string | undefined) ?? null };
    const same = field === 'days' ? found.med.days === patch.days : (found.med.doseNote ?? null) === patch.doseNote;
    if (same) return show(chatId, s, { v: 'editAsk', field, error: 'That is already the current value.' });
    await show(chatId, s, { v: 'editConfirm', patch });
  }

  // ───────────── button taps ─────────────

  async function onCallback(cb: Extract<Callback, { t: 'admin' }>, tap: Tap): Promise<Reply> {
    try {
      return await dispatch(cb, tap);
    } catch (err) {
      return failure(err);
    }
  }

  async function dispatch(cb: Extract<Callback, { t: 'admin' }>, tap: Tap): Promise<Reply> {
    switch (cb.a) {
      case 'noop': return noop(tap);
      case 'menu': return menu(cb.v, tap);
      case 'menuback':
      case 'cancel': return backToMenu(tap);
      case 'pick': return pickPet(cb.v, tap);
      case 'med': return pickMed(cb.v, tap);
      case 'stopyes': return stopYes(cb.v, tap);
      case 'entry': return openEntry(cb.v, tap);
      default: return sessionTap(cb, tap);
    }
  }

  async function noop(tap: Tap): Promise<Reply> {
    const s = await sessionOn(tap);
    const missing = s ? draftMissing(s.draft) : [];
    return { toast: missing.length > 0 ? `Still to fill in: ${missing.join(', ')}` : 'Nothing to do here.' };
  }

  async function backToMenu(tap: Tap): Promise<Reply> {
    await dropSessionOn(tap);
    await draw(tap.chatId, tap.messageId, menuScreen());
    return {};
  }

  // Menu and stateless pick-lists

  async function menu(v: string | undefined, tap: Tap): Promise<Reply> {
    await dropSessionOn(tap);
    if (v === 'start') return startDraft(tap);
    if (v !== 'stop' && v !== 'edit' && v !== 'past') return STALE;
    if (settings.pets.length === 1) return showMeds(v, settings.pets[0]!, tap);
    const title = { stop: 'Stop a med: which pet?', edit: 'Edit a med: which pet?', past: 'Fix a past log: which pet?' }[v];
    await draw(tap.chatId, tap.messageId, petChoiceScreen(title, settings.pets, (p) => adminCb('pick', `${v}:${p.id}`), menuBack));
    return {};
  }

  async function startDraft(tap: Tap): Promise<Reply> {
    const draft = settings.pets.length === 1 ? { roundKeys: [], petId: settings.pets[0]!.id } : { roundKeys: [] };
    await open(tap.chatId, { screen: tap.messageId, flow: 'start', draft, view: { v: 'card' } });
    return {};
  }

  async function pickPet(v: string | undefined, tap: Tap): Promise<Reply> {
    const [flow, petId] = (v ?? '').split(':');
    const p = pet(petId);
    if (!p || (flow !== 'stop' && flow !== 'edit' && flow !== 'past')) return STALE;
    await dropSessionOn(tap);
    return showMeds(flow, p, tap);
  }

  /** After the pet is known: the pet's meds (stop, edit) or recent logs (past). */
  async function showMeds(flow: 'stop' | 'edit' | 'past', p: PetConfig, tap: Tap): Promise<Reply> {
    const back = settings.pets.length > 1 ? adminCb('menu', flow) : menuBack;
    if (flow === 'past') {
      const items = await service.listPastEntries(p.id);
      await draw(tap.chatId, tap.messageId, pastLogsScreen(p.name, items, back, MAX_PAST_BUTTONS));
      return {};
    }
    const title = `${flow === 'stop' ? 'Stop' : 'Edit'} which med for ${p.name}?`;
    await draw(tap.chatId, tap.messageId, medChoiceScreen(title, flow, await service.listMeds(p.id), back));
    return {};
  }

  async function pickMed(v: string | undefined, tap: Tap): Promise<Reply> {
    const [flow, id] = (v ?? '').split(':');
    const medId = toId(id);
    if (medId === null || (flow !== 'stop' && flow !== 'edit')) return STALE;
    const found = await findMed(medId);
    if (!found) return { toast: 'That med is not active any more.' };
    await dropSessionOn(tap);
    if (flow === 'stop') {
      await draw(tap.chatId, tap.messageId, stopConfirmScreen(found.med, found.pet.name, adminCb('pick', `stop:${found.pet.id}`)));
      return {};
    }
    const edit = { petId: found.pet.id, medId };
    await open(tap.chatId, { screen: tap.messageId, flow: 'edit', draft: { roundKeys: [] }, edit, view: { v: 'editFields' } });
    return {};
  }

  async function stopYes(v: string | undefined, tap: Tap): Promise<Reply> {
    const medId = toId(v);
    if (medId === null) return STALE;
    const med = await service.stopMed(medId, tap.from);
    await draw(tap.chatId, tap.messageId, doneScreen(`⏹ Stopped ${med.name}. It is announced in the topic.`));
    await sendMenu(tap.chatId);
    return {};
  }

  async function openEntry(v: string | undefined, tap: Tap): Promise<Reply> {
    const entryId = toId(v);
    if (entryId === null) return STALE;
    await service.openFixPanel(entryId, tap.chatId, null, tap.from);
    return { toast: 'The fix panel is below.' };
  }

  // Taps that need the open card

  async function sessionTap(cb: Extract<Callback, { t: 'admin' }>, tap: Tap): Promise<Reply> {
    const s = await sessionOn(tap);
    if (!s) return STALE;
    const handler = s.flow === 'start' ? startTap : editTap;
    return (await handler(cb, s, tap)) ?? STALE;
  }

  async function startTap(cb: Extract<Callback, { t: 'admin' }>, s: Session, tap: Tap): Promise<Reply | undefined> {
    switch (cb.a) {
      case 'field': return chooseField(cb.v, s, tap);
      case 'pet': return setPet(cb.v, s, tap);
      case 'kind': return setKind(cb.v, s, tap);
      case 'round': return toggleDraftRound(cb.v, s, tap);
      case 'rdone':
      case 'back': return go(tap, s, { v: 'card' });
      case 'start': return finishStart(s, tap);
      default: return undefined;
    }
  }

  async function chooseField(v: string | undefined, s: Session, tap: Tap): Promise<Reply | undefined> {
    if (!isDraftField(v)) return undefined;
    if (!fieldApplies(s.draft, v)) return { toast: 'That does not apply to this kind of med.' };
    if (v === 'pet') return go(tap, s, { v: 'pet' });
    if (v === 'kind') return go(tap, s, { v: 'kind' });
    if (v === 'rounds') return openRounds(s, tap);
    if (isTypedField(v)) return go(tap, s, { v: 'ask', field: v });
    return undefined;
  }

  async function openRounds(s: Session, tap: Tap): Promise<Reply> {
    const p = pet(s.draft.petId);
    if (!p) return { toast: 'Pick a pet first.' };
    if (p.rounds.length === 0) return { toast: `${p.name} has no rounds, so only monthly or as-needed meds fit.`, alert: true };
    await show(tap.chatId, s, { v: 'rounds' });
    return {};
  }

  async function setPet(v: string | undefined, s: Session, tap: Tap): Promise<Reply | undefined> {
    if (!pet(v)) return undefined;
    await show(tap.chatId, { ...s, draft: withPet(s.draft, v!) }, { v: 'card' });
    return {};
  }

  async function setKind(v: string | undefined, s: Session, tap: Tap): Promise<Reply | undefined> {
    if (!isKind(v)) return undefined;
    await show(tap.chatId, { ...s, draft: withKind(s.draft, v) }, { v: 'card' });
    return {};
  }

  async function toggleDraftRound(key: string | undefined, s: Session, tap: Tap): Promise<Reply | undefined> {
    const p = pet(s.draft.petId);
    if (!p || !p.rounds.some((r) => r.key === key)) return undefined;
    const draft = { ...s.draft, roundKeys: toggleRound(s.draft.roundKeys, key!) };
    await show(tap.chatId, { ...s, draft }, { v: 'rounds' });
    return {};
  }

  async function finishStart(s: Session, tap: Tap): Promise<Reply> {
    if (!isDraftComplete(s.draft)) return { toast: `Still to fill in: ${draftMissing(s.draft).join(', ')}` };
    const med = await service.startMed(s.draft, tap.from);
    await store.delete(tap.chatId);
    await draw(tap.chatId, tap.messageId, doneScreen(confirmation('start', med)));
    await sendMenu(tap.chatId);
    return {};
  }

  async function editTap(cb: Extract<Callback, { t: 'admin' }>, s: Session, tap: Tap): Promise<Reply | undefined> {
    switch (cb.a) {
      case 'ef': return chooseEditField(cb.v, s, tap);
      case 'round': return toggleEditRound(cb.v, s, tap);
      case 'rdone': return finishEditRounds(s, tap);
      case 'back': return go(tap, s, { v: 'editFields' });
      case 'editYes': return finishEdit(s, tap);
      default: return undefined;
    }
  }

  async function chooseEditField(v: string | undefined, s: Session, tap: Tap): Promise<Reply | undefined> {
    const found = s.edit ? await findMed(s.edit.medId) : null;
    if (!found) return { toast: 'That med is not active any more.' };
    const { med } = found;
    if (v === 'note') return go(tap, s, { v: 'editAsk', field: 'doseNote' });
    if (v === 'days' && med.kind === 'course') return go(tap, s, { v: 'editAsk', field: 'days' });
    if (v === 'rounds' && (med.kind === 'ongoing' || med.kind === 'course')) {
      return go(tap, s, { v: 'editRounds', roundKeys: med.roundKeys });
    }
    return undefined;
  }

  async function toggleEditRound(key: string | undefined, s: Session, tap: Tap): Promise<Reply | undefined> {
    const found = s.edit ? await findMed(s.edit.medId) : null;
    if (s.view.v !== 'editRounds' || !found?.pet.rounds.some((r) => r.key === key)) return undefined;
    await show(tap.chatId, s, { v: 'editRounds', roundKeys: toggleRound(s.view.roundKeys, key!) });
    return {};
  }

  async function finishEditRounds(s: Session, tap: Tap): Promise<Reply | undefined> {
    const found = s.edit ? await findMed(s.edit.medId) : null;
    if (s.view.v !== 'editRounds' || !found) return undefined;
    const picked = s.view.roundKeys;
    if (picked.length === 0) return { toast: 'Pick at least one round.' };
    const current = found.med.roundKeys;
    if (picked.length === current.length && picked.every((k) => current.includes(k))) return { toast: 'That is already the current rounds.' };
    await show(tap.chatId, s, { v: 'editConfirm', patch: { roundKeys: picked } });
    return {};
  }

  async function finishEdit(s: Session, tap: Tap): Promise<Reply | undefined> {
    if (s.view.v !== 'editConfirm' || !s.edit) return undefined;
    const med = await service.editMed(s.edit.medId, s.view.patch, tap.from);
    await store.delete(tap.chatId);
    await draw(tap.chatId, tap.messageId, doneScreen(confirmation('edit', med)));
    await sendMenu(tap.chatId);
    return {};
  }

  // ───────────── wording ─────────────

  function roundNames(med: Med): string[] {
    const rounds = pet(med.petId)?.rounds ?? [];
    return med.roundKeys.map((k) => rounds.find((r) => r.key === k)?.name.toLowerCase() ?? k);
  }

  function confirmation(kind: 'start' | 'edit', med: Med): string {
    const line = announcement(kind, 'You', med, roundNames(med));
    const where = pet(med.petId)?.name ?? 'the';
    return `✅ ${line}\nPosted in ${where}'s topic.`;
  }

  function editPrompt(field: 'days' | 'doseNote'): string {
    return field === 'days' ? 'Type the new number of days.' : askPrompt('doseNote');
  }

  function describeChange(med: Med, p: PetConfig, patch: MedPatch): string {
    const names = (keys: string[]) => keys.map((k) => p.rounds.find((r) => r.key === k)?.name ?? k).join(' + ');
    const lines: string[] = [];
    if (patch.doseNote !== undefined) {
      lines.push(patch.doseNote === null ? 'Remove the dose note' : `Dose note: "${patch.doseNote}"`);
    }
    if (patch.days !== undefined) lines.push(`Days: ${med.days ?? '?'} → ${patch.days}`);
    if (patch.roundKeys !== undefined) lines.push(`Rounds: ${names(med.roundKeys)} → ${names(patch.roundKeys)}`);
    return `Change ${med.name} (${p.name})?\n${lines.join('\n')}`;
  }

  return { onText, onCallback, sendMenu };
}

export type AdminController = ReturnType<typeof createAdminController>;
