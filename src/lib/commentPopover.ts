/**
 * The rules of a comment surface's one popover (components/useCommentPopover.ts), without React or
 * the DOM: whether its text is changed and what saving or leaving it does, how an opening starts, which
 * keys save and leave, and whether its field takes the focus as it opens. Every opening is its field:
 * a saved comment opens straight into editing, filled with its text, and a new one empty.
 */

/**
 * Whether a comment's popover is changed: its field's text differs from the text it opened with (empty for a new
 * comment, the saved comment for an edit). A cleared edit counts as changed; text typed and then undone back to what
 * it opened with does not. This is the one meaning of "changed" for the comment UI (`popoverChanged`,
 * `data-comment-changed`, lib/commentDom.ts `hasChangedComment`): leaving a changed popover saves it (`leaveOutcome`),
 * the composer's Send and the walk stop at it, and Settings asks before turning comments off over it.
 */
export function commentChanged(value: string, initialComment: string): boolean {
  return value !== initialComment;
}

/**
 * Whether a comment popover's save (its ↑, Save and Enter) does anything: a new comment with nothing
 * but blanks has nothing to save, nor has an edit left as it opened (`commentChanged`); an edit may be saved
 * blank, which deletes the comment.
 */
export function commentCanSave(value: string, initialComment: string): boolean {
  return commentChanged(value, initialComment) && (initialComment !== "" || value.trim() !== "");
}

/** What an opening shows: the field, filled with a saved comment's text, or empty for a new one. */
export interface PopoverStart {
  /** the stored comment edited; null for a new one */
  commentId: string | null;
  initialComment: string;
}

/** How the popover opens on a target: on a saved comment (`existing`) to edit, or on a new one to write. */
export function popoverStart(existing: { id: string; comment: string } | null): PopoverStart {
  return existing === null
    ? { commentId: null, initialComment: "" }
    : { commentId: existing.id, initialComment: existing.comment };
}

/**
 * Whether the open popover holds a change: its field (`field`, what it holds now) is changed (`commentChanged`). None
 * open holds nothing.
 */
export function popoverChanged(open: { initialComment: string } | null, field: string): boolean {
  return open !== null && commentChanged(field, open.initialComment);
}

/**
 * What leaving the open field does (Escape, a press outside it, ✕, the scrim, another comment opened, the comment mode
 * turned off): "none" with none open (an Escape goes on: the viewer closes); "close" while it is unchanged
 * (`commentChanged`) or a new comment holds only blanks, so it leaves nothing; else "save", which keeps what was typed:
 * a new comment is stored, an edit applied, and an emptied edit (saved as "") deletes the comment. Either of the last
 * two takes an Escape: the viewer stays.
 */
export function leaveOutcome(open: { initialComment: string } | null, field: string): "none" | "close" | "save" {
  if (open === null) return "none";
  return commentCanSave(field, open.initialComment) ? "save" : "close";
}

/**
 * A comment being written in a field, as every opener holds it (the popover's open one, a margin's field, a sheet's
 * page): enough to leave it by the leave rule (`leaveEdit`) without knowing who opened it.
 */
export interface CommentEdit<T> {
  /** the stored comment edited; null for a new one */
  id: string | null;
  /** what it is written on (an edit: the stored comment's own target, so keeping it replaces that comment) */
  target: T;
  /** the text it opened with: "" for a new one */
  initial: string;
  /** what its field holds now */
  text: string;
  /**
   * keeps `text` on `target` ("" deletes an edit's comment). Returns the id of the comment stored there now (after an
   * edit a new one), or null where nothing is stored there now: deleted (emptied), or refused (comments are off, a
   * selection with nothing to quote)
   */
  keep(target: T, text: string): string | null;
}

/** What leaving a field did: "saved" (its change kept: `id` as `CommentEdit.keep` returned it), or "closed" (nothing to keep). */
export type LeftEdit = { kind: "saved"; id: string | null } | { kind: "closed" };

/**
 * Leaves `edit` by the leave rule (`leaveOutcome`): a change is kept (`keep`, which stores a new comment, applies an
 * edit, or deletes an emptied one), and a field left as it opened or a new one holding only blanks keeps nothing. The
 * one action every opener of a comment field leaves it by; closing the field is the opener's.
 */
export function leaveEdit<T>(edit: CommentEdit<T>): LeftEdit {
  if (leaveOutcome({ initialComment: edit.initial }, edit.text) !== "save") return { kind: "closed" };
  return { kind: "saved", id: edit.keep(edit.target, edit.text) };
}

/**
 * Whether leaving `edit` (`left`, `leaveEdit`'s) deleted the stored comment it edits: an edit emptied and saved, so
 * nothing is stored there now. A `keep` that refused (null for a text that is not blank: comments off) deleted nothing,
 * and a new comment has nothing to delete.
 */
export function editDeleted(edit: Pick<CommentEdit<unknown>, "id" | "text">, left: LeftEdit): boolean {
  return left.kind === "saved" && left.id === null && edit.id !== null && edit.text.trim() === "";
}

/** The facts of a key press `leaveKey` reads (a DOM `KeyboardEvent` has them). */
export type LeaveKeyFacts = Pick<KeyboardEvent, "key" | "isComposing" | "keyCode">;

/**
 * Whether a key pressed in or over a comment field leaves it (`leaveOutcome`): Escape, but not one an IME composition
 * takes to cancel its conversion (`isComposing`, or Safari's `keyCode` 229).
 */
export function leaveKey(event: LeaveKeyFacts): boolean {
  return event.key === "Escape" && !event.isComposing && event.keyCode !== 229;
}

/** The facts of a key press `submitKey` reads (a DOM `KeyboardEvent` has them). */
export type SubmitKeyFacts = Pick<KeyboardEvent, "key" | "shiftKey" | "isComposing" | "keyCode">;

/**
 * Whether a key pressed in a comment field saves it: Enter, with Ctrl or Cmd too, but not Shift+Enter, which breaks the
 * line, nor an Enter that ends an IME composition (`isComposing`, or Safari's `keyCode` 229).
 */
export function submitKey(event: SubmitKeyFacts): boolean {
  return event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229;
}

/**
 * Whether the open popover of a saved comment has outlived it: the comment is no longer stored (a
 * send acknowledged it, another tab deleted it) and its field (`field`, what it holds now) is unchanged
 * (`commentChanged`), so nothing would be lost. A changed one stays open (saving it stores the comment
 * again), and a new comment is never closed this way: what is being written stays.
 */
export function popoverOutlived(open: { commentId: string | null; initialComment: string }, stored: readonly { id: string }[], field: string): boolean {
  return open.commentId !== null && !stored.some((comment) => comment.id === open.commentId) && !commentChanged(field, open.initialComment);
}

/**
 * Whether the popover's field takes the focus as it opens. A new comment's always does: it is opened
 * to be written. A saved comment's does not on a touch screen (`coarse`), where a focused field raises
 * the keyboard over what was only tapped to be read: the sheet shows the field filled, and a tap
 * into it starts editing.
 */
export function popoverFocusesField(saved: boolean, coarse: boolean): boolean {
  return !saved || !coarse;
}

/**
 * What a sheet quotes of the lines a code comment is on (`sheetQuote`): their text, each trimmed, blank ones left
 * out, joined by spaces. The sheet clamps it to three lines. A blank line, or one past the file's end, quotes nothing.
 */
export function lineQuote(lines: readonly string[], range: readonly [number, number]): string {
  return lines.slice(range[0] - 1, range[1]).map((line) => line.trim()).filter((line) => line !== "").join(" ");
}

/**
 * The comment a sheet that pages through several (a count's, lib/commentMargin.ts) shows next: from the one at `index` of
 * `count`, a step back (‹, -1) or on (›, 1), or none (0, Delete). `removed`: the one shown is gone (deleted, or emptied
 * and so deleted as it was paged away from). ‹ and › do not wrap; Delete stays on the next one, else the one before. Null
 * where none is left.
 */
export function sheetPage(index: number, count: number, step: -1 | 0 | 1, removed: boolean): number | null {
  const left = removed ? count - 1 : count;
  if (left <= 0) return null;
  const next = removed ? (step === -1 ? index - 1 : index) : index + step;
  return Math.max(0, Math.min(left - 1, next));
}
