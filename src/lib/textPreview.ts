/**
 * The part of a text file the viewer loads is cut at a byte count, so its end is a broken line,
 * or a broken UTF-8 character (decoded as U+FFFD). Cut back to the last whole line; a single
 * huge line (minified JSON) has no whole line to cut back to, so it stays, less a broken character.
 */
export function dropPartialLastLine(text: string, truncated: boolean): string {
  if (!truncated) return text;
  const newline = text.lastIndexOf("\n");
  if (newline >= 0) return text.slice(0, newline + 1);
  return text.replace(/\uFFFD+$/, "");
}
