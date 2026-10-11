import { createHash } from 'node:crypto';
import type { Rendered } from '../types.js';

/** Stable hash of what the user sees (text + buttons), so unchanged messages are not re-edited. */
export function hashRendered(r: Rendered): string {
  return createHash('sha1').update(JSON.stringify({ text: r.text, keyboard: r.keyboard })).digest('hex');
}
