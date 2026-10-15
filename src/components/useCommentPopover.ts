/**
 * A comment surface's one comment popover (the chat's, the file viewer's): which comment it edits,
 * and what its field holds. Opened by a card or a count, the ⊕ of a code line, text selected, or the composer's walk: on the
 * comment there, its field filled with it, else on a new one, its field empty. Only one is open at a
 * time: another opening leaves the open one first, which saves what was typed in it (`leaveEdit`); the place of the
 * open one, opened again while it holds a change, keeps it, and the caller gives its field the focus back
 * (lib/commentDom.ts `focusOpenField`). The surface says what a comment is on (`T`), how each opening is kept (`keep`,
 * given with it) and when two targets are one place (`samePlace`). Leaving is lib/commentPopover.ts `leaveEdit`'s rule.
 * CommentPopover.tsx draws it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { blockComments, useBlockComments } from "../lib/blockComments.ts";
import { commentCanSave, leaveEdit, popoverOutlived, popoverStart, type CommentEdit } from "../lib/commentPopover.ts";

/** The comment the popover is open on: kept as it was opened, so it outlives its text re-rendering or leaving. */
export interface OpenComment<T> {
  /** one per opening: another comment opened, or the same one opened again, is another popover */
  id: number;
  owner: string;
  target: T;
  /** the stored comment edited; null for a new one */
  commentId: string | null;
  initialComment: string;
  /** opened by text selected (not by a card, a count or the walk) */
  fromSelection: boolean;
  /** keeps what is written on `target` (`CommentEdit.keep`), as the opener said */
  keep: CommentEdit<T>["keep"];
}

/** What an opening is on (`show`): `owner`'s pane, `target`, its stored comment (`existing`) and how it is kept. */
export interface PopoverOpening<T> {
  owner: string;
  target: T;
  /** the comment stored on `target`, to edit; null opens a new one */
  existing: { id: string; comment: string } | null;
  keep: CommentEdit<T>["keep"];
  /** opened by text selected: saving it clears the page's selection */
  fromSelection?: boolean;
}

export function useCommentPopover<T>({ enabled, samePlace }: {
  /** whether two targets of one owner are the same place (the store keeps one comment there) */
  samePlace: (a: T, b: T) => boolean;
  /**
   * the setting: turning it off closes whatever is open (the store keeps nothing then: lib/blockComments.ts
   * `setEnabled`), and nothing opens while it is off
   */
  enabled: boolean;
}): {
  open: OpenComment<T> | null;
  /**
   * opens `opening`: on its existing comment, the field filled with it, else on a new one. The open one is left first
   * (`leaveEdit`: its change kept). False, changing nothing, while comments are off, or when the target is the place of
   * the open one and it holds a change: the caller then gives its field the focus back (`focusOpenField`)
   */
  show: (opening: PopoverOpening<T>) => boolean;
  /** keeps `comment` on the open one's target ("" deletes an edit's comment) and closes it */
  save: (comment: string) => void;
  /** leaves the open one (`leaveEdit`): a change kept, else nothing; it closes either way. False with none open */
  leave: () => boolean;
  /** the open one as it is being written (its field's text), null with none open */
  edit: () => CommentEdit<T> | null;
  remove: () => void;
  close: () => void;
  /** what the open field holds, kept across a redraw */
  text: { read: () => string; write: (value: string) => void };
} {
  const [open, setOpen] = useState<OpenComment<T> | null>(null);
  // read by the callbacks, which may run twice before a render (a press outside closes, its click opens)
  const openRef = useRef(open);
  const set = useCallback((next: OpenComment<T> | null): void => {
    openRef.current = next;
    setOpen(next);
  }, []);
  const opened = useRef(0);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const samePlaceRef = useRef(samePlace);
  samePlaceRef.current = samePlace;
  // what the open field holds (CommentPopover's `onText`): changed, another opening saves it first
  const fieldText = useRef("");
  const text = useMemo(() => ({
    read: (): string => fieldText.current,
    write: (value: string): void => { fieldText.current = value; },
  }), []);

  const close = useCallback((): void => {
    fieldText.current = "";
    set(null);
  }, [set]);

  const edit = useCallback((): CommentEdit<T> | null => {
    const current = openRef.current;
    return current === null ? null : { id: current.commentId, target: current.target, initial: current.initialComment, text: fieldText.current, keep: current.keep };
  }, []);

  const show = useCallback(({ owner, target, existing, keep, fromSelection = false }: PopoverOpening<T>): boolean => {
    if (!enabledRef.current) return false;
    // the open one is left: what was typed in it is kept. Not `save`: the selection may be the new opening's. Its own
    // place opened again (the ⊕ of its line, its card, the walk) is no other opening: it stays as it is
    const leaving = edit();
    if (leaving !== null && commentCanSave(leaving.text, leaving.initial) && openRef.current!.owner === owner && samePlaceRef.current(leaving.target, target)) return false;
    if (leaving !== null) leaveEdit(leaving);
    const start = popoverStart(existing);
    fieldText.current = start.initialComment;
    set({ id: ++opened.current, owner, target, ...start, fromSelection, keep });
    return true;
  }, [set, edit]);

  const save = useCallback((comment: string): void => {
    const current = openRef.current;
    if (current === null) return;
    // a blank edit deletes the comment there (the store's rule); a blank new one never gets here (`commentCanSave`)
    current.keep(current.target, comment);
    // the selection was for this comment: it is made. A card or the walk opened it: whatever is selected meanwhile stays
    if (current.fromSelection) window.getSelection()?.removeAllRanges();
    close();
  }, [close]);

  const leave = useCallback((): boolean => {
    const leaving = edit();
    if (leaving === null) return false;
    if (leaveEdit(leaving).kind === "saved" && openRef.current!.fromSelection) window.getSelection()?.removeAllRanges();
    close();
    return true;
  }, [edit, close]);

  // at once, without a question or an undo: a comment is cheap to write again
  const remove = useCallback((): void => {
    const current = openRef.current;
    if (current === null) return;
    if (current.commentId !== null) blockComments.remove(current.owner, [current.commentId]);
    close();
  }, [close]);

  // the setting turned off, or the comment edited is no longer stored (a send acknowledged it, another tab deleted it)
  // while its field is unchanged
  const stored = useBlockComments(open?.owner ?? "");
  useEffect(() => {
    // only the opening this render drew: one shown since is checked by its own render
    if (open === null || openRef.current !== open) return;
    if (!enabled || popoverOutlived(open, stored, fieldText.current)) close();
  }, [open, enabled, stored, close]);

  return { open, show, save, leave, edit, remove, close, text };
}
