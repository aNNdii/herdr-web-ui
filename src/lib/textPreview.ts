/** How the viewer shows a text file: chosen in its header, Preview unless the user asked for the source. */
export type TextViewMode = "preview" | "code";

/** A text file as the viewer loaded it: its start when it is longer than the limit. */
export interface LoadedText {
  text: string;
  /** the file goes on past `text` */
  truncated: boolean;
  /** the bytes asked for: what "the first 256 KB" says */
  limit: number;
}

/**
 * The text of a file the viewer asked the first `limit` bytes of. The part is cut at a byte
 * count, so its end is a broken line, or a broken UTF-8 character (decoded as U+FFFD): it is cut
 * back to the last whole line. A single huge line (minified JSON) has no whole line to cut back
 * to, so it stays, less a broken character. Whether the file was cut is decided here, once, from
 * the limit the part was loaded with, not from whatever the limit is later.
 */
export function loadedText(body: string, fileSize: number, limit: number): LoadedText {
  if (fileSize <= limit) return { text: body, truncated: false, limit };
  const newline = body.lastIndexOf("\n");
  const text = newline >= 0 ? body.slice(0, newline + 1) : body.replace(/\uFFFD+$/, "");
  return { text, truncated: true, limit };
}

/** Whether a file in `language` has a rendered Preview besides its source: Markdown does. */
export function hasPreview(language: string | null): boolean {
  return language === "markdown";
}

/** What the viewer renders for a text file in `mode`: its Preview where it has one, else its code. */
export function textView(language: string | null, mode: TextViewMode): "markdown" | "code" {
  return hasPreview(language) && mode === "preview" ? "markdown" : "code";
}
