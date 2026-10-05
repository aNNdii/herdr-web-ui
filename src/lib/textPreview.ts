/** How the viewer shows a text file: chosen in its header, Preview unless the user asked for the source. */
export type TextViewMode = "preview" | "code";

/** A text file as the viewer loaded it: its start when it is longer than the limit. */
export interface LoadedText {
  text: string;
  /** the file goes on past `text` */
  truncated: boolean;
  /** the bytes asked for: what "the first 256 KB" says */
  limit: number;
  /** the file's size when its text was sent (`answeredFileSize`), null when the answer did not say */
  size: number | null;
}

/**
 * The text of a file the viewer asked the first `limit` bytes of. The part is cut at a byte
 * count, so its end is a broken line, or a broken UTF-8 character (decoded as U+FFFD): it is cut
 * back to the last whole line. A single huge line (minified JSON) has no whole line to cut back
 * to, so it stays, less a broken character. Whether the file was cut is decided here, once, from
 * the limit the part was loaded with, not from whatever the limit is later. A file of unknown size
 * (null) counts as cut: the part is never taken, and copied, for the whole file.
 */
export function loadedText(body: string, fileSize: number | null, limit: number): LoadedText {
  if (fileSize !== null && fileSize <= limit) return { text: body, truncated: false, limit, size: fileSize };
  const newline = body.lastIndexOf("\n");
  const text = newline >= 0 ? body.slice(0, newline + 1) : body.replace(/\uFFFD+$/, "");
  return { text, truncated: true, limit, size: fileSize };
}

/**
 * The first `limit` bytes of a file's body as text. A 206 is that part already; a server that
 * ignores the range answers 200 with the whole file, and is cut here, so the limit holds either
 * way. A cut inside a UTF-8 character decodes to U+FFFD, which `loadedText` drops.
 */
export function decodeStart(bytes: Uint8Array, limit: number): string {
  return new TextDecoder().decode(bytes.subarray(0, limit));
}

/**
 * The size of a file as the answer to the request for its first bytes says it is, read when the
 * body was sent rather than from the stat before it: a file that grew in between is then still
 * known to go on past the part. A 206 names it in its `Content-Range` (`bytes 0-1023/4096`), a
 * server that ignored the range sent the whole file (200), and an empty file answers 416 with
 * `bytes *\/0`. Null when the answer does not say: the part is then not taken for the whole file.
 */
export function answeredFileSize(status: number, contentRange: string | null, received: number): number | null {
  if (status === 200) return received;
  const total = status === 206 ? /^bytes \d+-\d+\/(\d+)$/.exec(contentRange?.trim() ?? "")
    : status === 416 ? /^bytes \*\/(\d+)$/.exec(contentRange?.trim() ?? "")
    : null;
  return total ? Number(total[1]) : null;
}

/** Whether a file in `language` has a rendered Preview besides its source: Markdown does. */
export function hasPreview(language: string | null): boolean {
  return language === "markdown";
}

/** What the viewer renders for a text file in `mode`: its Preview where it has one, else its code. */
export function textView(language: string | null, mode: TextViewMode): "markdown" | "code" {
  return hasPreview(language) && mode === "preview" ? "markdown" : "code";
}
