import type { Button, Messenger, Rendered, Target } from '../../src/types.js';

export interface FakeMessage {
  chatId: number;
  threadId: number | null;
  messageId: number;
  text: string;
  keyboard: Button[][];
  forceReply: boolean;
  silent: boolean;
  deleted: boolean;
  pinned: boolean;
  /** How many times the content was really changed. */
  edits: number;
}

export type Op = 'send' | 'edit' | 'delete' | 'pin' | 'sendDocument';

export interface Call {
  op: Op;
  chatId: number;
  messageId?: number;
  /** An edit that changed nothing (Telegram ignores those). */
  noop?: boolean;
}

/** Records every call, keeps the live messages, and can be told to fail. */
export class FakeMessenger implements Messenger {
  readonly messages: FakeMessage[] = [];
  readonly calls: Call[] = [];
  readonly documents: { chatId: number; filename: string; caption?: string }[] = [];
  private nextId = 1000;
  private failing = new Set<Op>();

  failOn(...ops: Op[]): void {
    for (const op of ops) this.failing.add(op);
  }

  stopFailing(): void {
    this.failing.clear();
  }

  private record(call: Call): void {
    this.calls.push(call);
    if (this.failing.has(call.op)) throw new Error(`fake telegram: ${call.op} failed`);
  }

  async send(to: Target, content: Rendered): Promise<number> {
    this.record({ op: 'send', chatId: to.chatId });
    const messageId = this.nextId++;
    this.messages.push({
      chatId: to.chatId,
      threadId: to.threadId ?? null,
      messageId,
      text: content.text,
      keyboard: content.keyboard,
      forceReply: content.forceReply ?? false,
      silent: content.silent ?? false,
      deleted: false,
      pinned: false,
      edits: 0,
    });
    return messageId;
  }

  async edit(chatId: number, messageId: number, content: Rendered): Promise<void> {
    const msg = this.find(chatId, messageId);
    const same = msg && JSON.stringify([msg.text, msg.keyboard]) === JSON.stringify([content.text, content.keyboard]);
    this.record({ op: 'edit', chatId, messageId, noop: !msg || msg.deleted || !!same });
    if (!msg || msg.deleted || same) return;
    msg.text = content.text;
    msg.keyboard = content.keyboard;
    msg.edits++;
  }

  async delete(chatId: number, messageId: number): Promise<void> {
    this.record({ op: 'delete', chatId, messageId });
    const msg = this.find(chatId, messageId);
    if (msg) msg.deleted = true;
  }

  async pin(chatId: number, messageId: number): Promise<void> {
    this.record({ op: 'pin', chatId, messageId });
    const msg = this.find(chatId, messageId);
    if (msg) msg.pinned = true;
  }

  async sendDocument(chatId: number, filename: string, _data: Uint8Array, caption?: string): Promise<void> {
    this.record({ op: 'sendDocument', chatId });
    this.documents.push({ chatId, filename, caption });
  }

  // ───────────── test helpers ─────────────

  find(chatId: number, messageId: number): FakeMessage | undefined {
    return this.messages.find((m) => m.chatId === chatId && m.messageId === messageId);
  }

  byId(messageId: number): FakeMessage {
    const msg = this.messages.find((m) => m.messageId === messageId);
    if (!msg) throw new Error(`no fake message ${messageId}`);
    return msg;
  }

  /** Messages still on screen, oldest first. */
  live(threadId?: number): FakeMessage[] {
    return this.messages.filter((m) => !m.deleted && (threadId === undefined || m.threadId === threadId));
  }

  /** The one live message containing `text`. Fails if there is not exactly one. */
  one(text: string, threadId?: number): FakeMessage {
    const hits = this.live(threadId).filter((m) => m.text.includes(text));
    if (hits.length !== 1) {
      throw new Error(`expected 1 live message with "${text}", found ${hits.length}:\n${this.dump()}`);
    }
    return hits[0]!;
  }

  count(op: Op): number {
    return this.calls.filter((c) => c.op === op).length;
  }

  /** Calls that reached Telegram's servers with an effect (no-op edits excluded). */
  get effectiveCalls(): number {
    return this.calls.filter((c) => !c.noop).length;
  }

  mark(): number {
    return this.calls.length;
  }

  callsSince(mark: number): Call[] {
    return this.calls.slice(mark);
  }

  dump(): string {
    return this.live()
      .map((m) => `#${m.messageId} [${m.threadId}] ${m.text.replace(/\n/g, ' | ')} {${m.keyboard.flat().map((b) => b.text).join(' / ')}}`)
      .join('\n');
  }
}

export function buttonLabels(msg: FakeMessage): string[] {
  return msg.keyboard.flat().map((b) => b.text);
}

export function findButton(msg: FakeMessage, labelPart: string): Button {
  const hits = msg.keyboard.flat().filter((b) => b.text.includes(labelPart));
  if (hits.length !== 1) {
    throw new Error(`expected 1 button with "${labelPart}" on #${msg.messageId}, found ${hits.length}: ${buttonLabels(msg).join(' / ')}`);
  }
  return hits[0]!;
}
