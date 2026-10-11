/** Telegram rejects answerCallbackQuery text longer than this. */
export const TOAST_LIMIT = 200;

/** A toast Telegram will accept: cut to the limit, never in the middle of an emoji. */
export function toastText(text: string): string {
  if (text.length <= TOAST_LIMIT) return text;
  const cut = text.slice(0, TOAST_LIMIT);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}
