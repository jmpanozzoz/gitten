export function hasLayoutControl(text: string): boolean {
  return /[\p{Bidi_Control}\p{Zl}\p{Zp}]/u.test(text);
}
