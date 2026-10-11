import type { Callback, MedState } from '../types.js';

/**
 * Callback data codec. Telegram allows at most 64 bytes of callback data, so keys are 2 letters
 * and buttons carry a BotMessage id (`m`) instead of names.
 */

const STATE_TO_CODE: Record<MedState, string> = { given: 'g', pending: 'n', skipped: 'k' };
const CODE_TO_STATE: Record<string, MedState> = { g: 'given', n: 'pending', k: 'skipped' };

export function encodeCallback(cb: Callback): string {
  let out: string;
  switch (cb.t) {
    case 'logAll': out = `la:${cb.m}`; break;
    case 'change': out = `ch:${cb.m}`; break;
    case 'setMed': out = `sm:${cb.m}:${cb.i}:${STATE_TO_CODE[cb.s]}`; break;
    case 'givenAt': out = `ga:${cb.m}`; break;
    case 'ago': out = `ag:${cb.m}:${cb.mins}`; break;
    case 'typeTime': out = `tt:${cb.m}`; break;
    case 'back': out = `bk:${cb.m}`; break;
    case 'save': out = `sv:${cb.m}`; break;
    case 'undo': out = `un:${cb.m}`; break;
    case 'logSingle': out = `ls:${cb.m}`; break;
    case 'board': out = `bd:${cb.petId}:${cb.target}`; break;
    case 'dd': out = `dd:${cb.m}:${cb.yes ? 1 : 0}`; break;
    case 'admin': out = cb.v === undefined ? `ad:${cb.a}` : `ad:${cb.a}:${cb.v}`; break;
  }
  if (new TextEncoder().encode(out).length > 64) throw new Error(`callback data too long: ${out}`);
  return out;
}

/** Returns null for anything that is not valid callback data (stale or foreign buttons). */
export function decodeCallback(data: string): Callback | null {
  const p = data.split(':');
  const key = p[0];
  const int = (s: string | undefined): number | null => (s !== undefined && /^\d+$/.test(s) ? Number(s) : null);
  const m = int(p[1]);
  switch (key) {
    case 'la': return m === null ? null : { t: 'logAll', m };
    case 'ch': return m === null ? null : { t: 'change', m };
    case 'sm': {
      const i = int(p[2]);
      const s = p[3] ? CODE_TO_STATE[p[3]] : undefined;
      return m === null || i === null || !s ? null : { t: 'setMed', m, i, s };
    }
    case 'ga': return m === null ? null : { t: 'givenAt', m };
    case 'ag': {
      const mins = int(p[2]);
      return m === null || mins === null ? null : { t: 'ago', m, mins };
    }
    case 'tt': return m === null ? null : { t: 'typeTime', m };
    case 'bk': return m === null ? null : { t: 'back', m };
    case 'sv': return m === null ? null : { t: 'save', m };
    case 'un': return m === null ? null : { t: 'undo', m };
    case 'ls': return m === null ? null : { t: 'logSingle', m };
    case 'bd': return p[1] && p[2] ? { t: 'board', petId: p[1], target: p[2] } : null;
    case 'dd': return m === null || (p[2] !== '0' && p[2] !== '1') ? null : { t: 'dd', m, yes: p[2] === '1' };
    case 'ad': {
      if (!p[1]) return null;
      const v = p.slice(2).join(':');
      return v ? { t: 'admin', a: p[1], v } : { t: 'admin', a: p[1] };
    }
    default: return null;
  }
}
