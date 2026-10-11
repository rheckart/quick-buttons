import { describe, expect, it } from 'vitest';
import { decodeCallback, encodeCallback } from '../src/render/callbacks.js';
import type { Callback } from '../src/types.js';

const samples: Callback[] = [
  { t: 'logAll', m: 1 },
  { t: 'change', m: 123456789 },
  { t: 'setMed', m: 42, i: 7, s: 'given' },
  { t: 'setMed', m: 42, i: 0, s: 'pending' },
  { t: 'setMed', m: 42, i: 3, s: 'skipped' },
  { t: 'givenAt', m: 5 },
  { t: 'ago', m: 5, mins: 120 },
  { t: 'ago', m: 5, mins: 0 },
  { t: 'typeTime', m: 5 },
  { t: 'back', m: 5 },
  { t: 'save', m: 5 },
  { t: 'undo', m: 5 },
  { t: 'logSingle', m: 5 },
  { t: 'board', petId: 'twiggy', target: 'morning' },
  { t: 'board', petId: 'twiggy', target: 'm12' },
  { t: 'dd', m: 9, yes: true },
  { t: 'dd', m: 9, yes: false },
  { t: 'admin', a: 'menu' },
  { t: 'admin', a: 'pet', v: 'twiggy' },
  { t: 'admin', a: 'pickMed', v: '12:34' },
];

describe('callbacks', () => {
  it.each(samples)('round-trips %j within 64 bytes', (cb) => {
    const s = encodeCallback(cb);
    expect(new TextEncoder().encode(s).length).toBeLessThanOrEqual(64);
    expect(decodeCallback(s)).toEqual(cb);
  });

  it('rejects junk', () => {
    for (const s of ['', 'zz:1', 'la:', 'la:x', 'sm:1:2:z', 'dd:1:2', 'bd:twiggy', 'ad:']) {
      expect(decodeCallback(s)).toBeNull();
    }
  });

  it('refuses to encode data over 64 bytes', () => {
    expect(() => encodeCallback({ t: 'admin', a: 'x', v: 'y'.repeat(80) })).toThrow();
  });
});
