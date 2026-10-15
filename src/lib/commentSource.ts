/**
 * The pure parts of a Markdown comment layer's source (components/MarkdownComments.tsx `CommentSource`), without React
 * or the DOM: what a selection opens (`commentAt`), and a surface's comments by the text each is on (`commentsByText`).
 */

/** A comment as a source shows it: enough for `commentAt` and `commentsByText`. */
export interface SourceComment<T> {
  id: string;
  quote: string;
  /** the target it is stored on */
  target: T;
  /** the text it is on, where a surface lays out one margin per text (the chat's replies: the turn's key) */
  textKey?: string;
}

/**
 * What a selection on `target` (quoting `quote`) opens, where the store holds the comment `id` there (undefined: none):
 * that comment if it is among `comments` (shown), with its own target and quote, so an edit replaces it; else a new
 * comment on `target`. A comment stored there but not shown opens nothing of its own: the selection writes a new one.
 */
export function commentAt<T, C extends SourceComment<T>>(comments: readonly C[], id: string | undefined, target: T, quote: string): { target: T; quote: string; existing: C | null } {
  const existing = id === undefined ? undefined : comments.find((comment) => comment.id === id);
  return existing === undefined ? { target, quote, existing: null } : { target: existing.target, quote: existing.quote, existing };
}

/**
 * `comments` by the text each is on (`textKey`), each list in the order of `comments`; one on no text is in none. Each
 * text's list is a new array per call: call it once per change of `comments`.
 */
export function commentsByText<C extends { textKey?: string }>(comments: readonly C[]): ReadonlyMap<string, readonly C[]> {
  const byText = new Map<string, C[]>();
  for (const comment of comments) {
    if (comment.textKey === undefined) continue;
    const list = byText.get(comment.textKey);
    if (list === undefined) byText.set(comment.textKey, [comment]);
    else list.push(comment);
  }
  return byText;
}
