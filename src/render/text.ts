import type { Button, Callback, Giver } from '../types.js';
import { encodeCallback } from './callbacks.js';

/** Escape user text for Telegram HTML parse mode. */
export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function btn(text: string, cb: Callback): Button {
  return { text, data: encodeCallback(cb) };
}

/** Shorten to `max` characters (not UTF-16 units), ending in "…" when cut. */
export function clip(s: string, max: number): string {
  const chars = [...s];
  return chars.length <= max ? s : `${chars.slice(0, Math.max(0, max - 1)).join('')}…`;
}

export function mention(g: Giver): string {
  return `<a href="tg://user?id=${g.userId}">${esc(g.name)}</a>`;
}

export function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

export function joinEsc(names: string[], sep: string): string {
  return names.map(esc).join(sep);
}
