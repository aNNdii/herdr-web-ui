/**
 * A comment surface's one comment form (the chat's, the file viewer's), opened by a selection's
 * Comment button or a comment's Edit button: the place where the comment's card goes or is draws
 * it inline (`CommentEdit`, CommentCard.tsx). Where nothing draws it (its place left the view) the
 * surface's modal takes over with what was typed. The form and what is typed in it stay until it
 * is saved or closed. The surface says what a comment is on (`T`) and how one is kept (`persist`).
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";

import { commentTyped } from "../lib/blockComments.ts";
import type { CommentEdit } from "./CommentCard.tsx";

/** The comment being written: kept as it was opened, so it outlives its place changing or leaving. */
export interface OpenForm<T> {
  /** one per opening: another comment opened is another form */
  id: number;
  owner: string;
  target: T;
  initialComment: string;
  /** opened by the Comment button, for the text selected (not by a comment's Edit button) */
  selection: boolean;
  /** no place in the view draws the form: the modal editor does */
  modal: boolean;
}

export function useCommentForm<T>({ view, persist }: {
  /** the surface's scrolling view: a typed form there takes the focus back instead of being replaced */
  view: RefObject<HTMLElement>;
  /** keeps the comment written on `target` of `owner`'s pane; "" deletes */
  persist: (owner: string, target: T, comment: string) => void;
}): {
  editing: OpenForm<T> | null;
  open: (owner: string, target: T, initialComment: string, fromSelection?: boolean) => void;
  save: (comment: string) => void;
  close: () => void;
  /** for the inline form; null while none is open or while the modal stands in for it */
  edit: CommentEdit<T> | null;
  /** what the form's field holds now */
  typed: () => string;
} {
  const [editing, setEditing] = useState<OpenForm<T> | null>(null);
  // what the form's field holds: with something typed, another comment does not take its place
  // (the form stays open while the view is used, so a card or the Comment button can be pressed meanwhile)
  const typed = useRef("");
  const opened = useRef(0);
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const persistRef = useRef(persist);
  persistRef.current = persist;
  /** the forms drawn, by opening: none for the opening that is current means the view has no place for it */
  const drawn = useRef(new Set<number>());
  const close = useCallback(() => setEditing(null), []);
  const open = useCallback((owner: string, target: T, initialComment: string, fromSelection = false) => {
    const current = editingRef.current;
    if (current !== null && !current.modal && commentTyped(typed.current, current.initialComment)) {
      view.current?.querySelector<HTMLTextAreaElement>(".block-comment-card.is-editing textarea")?.focus({ preventScroll: true });
      return;
    }
    typed.current = initialComment;
    setEditing({ id: ++opened.current, owner, target, initialComment, selection: fromSelection, modal: false });
  }, [view]);
  const save = useCallback((comment: string): void => {
    const current = editingRef.current;
    if (current === null) return;
    persistRef.current(current.owner, current.target, comment);
    // the selection was for this comment: it is made. An edit leaves whatever is selected meanwhile
    if (current.selection) window.getSelection()?.removeAllRanges();
    close();
  }, [close]);
  const attach = useCallback((id: number): (() => void) => {
    drawn.current.add(id);
    return () => {
      drawn.current.delete(id);
      // gone while it is the open one, and not drawn again meanwhile (a development remount does that): no place for it
      queueMicrotask(() => {
        const current = editingRef.current;
        if (current !== null && current.id === id && !current.modal && !drawn.current.has(id)) setEditing({ ...current, modal: true });
      });
    };
  }, []);
  const edit = useMemo<CommentEdit<T> | null>(() => editing === null || editing.modal ? null : {
    id: editing.id,
    owner: editing.owner,
    target: editing.target,
    initialComment: editing.initialComment,
    draft: () => typed.current,
    text: (value) => { typed.current = value; },
    save,
    close,
    attach,
  }, [editing, save, close, attach]);
  // children first: the form is drawn by now if the view has a place for it
  useLayoutEffect(() => {
    if (editing !== null && !editing.modal && !drawn.current.has(editing.id)) setEditing({ ...editing, modal: true });
  }, [editing]);
  const read = useCallback(() => typed.current, []);
  return { editing, open, save, close, edit, typed: read };
}
