import { describe, expect, it } from 'vitest';
import { TOAST_LIMIT, toastText } from '../src/bot/toast.js';

describe('toastText', () => {
  it('leaves short text alone', () => {
    expect(toastText('Logged ✅')).toBe('Logged ✅');
    expect(toastText('x'.repeat(TOAST_LIMIT))).toHaveLength(TOAST_LIMIT);
  });

  it('cuts long text to the limit', () => {
    expect(toastText('x'.repeat(500))).toHaveLength(TOAST_LIMIT);
  });

  it('never leaves half an emoji at the cut', () => {
    const cut = toastText(`${'x'.repeat(TOAST_LIMIT - 1)}😀 more`);
    expect(cut).toBe('x'.repeat(TOAST_LIMIT - 1));
    expect(() => encodeURIComponent(cut)).not.toThrow();
  });
});
