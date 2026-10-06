/**
 * What the two comment editors share: the modal (CommentEditor.tsx) and the inline form in the
 * chat (CommentCard.tsx). A comment's text with its field and its keys, and where the focus goes
 * when the editor closes.
 */
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";

import "./CommentEditor.css";

import { restoreFocusTarget } from "../lib/commentSelection.ts";
import { useT } from "../lib/i18n.ts";

/** Longest comment, in UTF-16 units as `maxLength` counts. */
export const COMMENT_MAX_CHARS = 2000;

/** A comment being written in an editor (the modal or the inline form): its text, its field and its keys. */
export interface CommentDraft {
  /** the editor's own box: Tab cycles inside it (a modal) */
  surface: RefObject<HTMLDivElement>;
  field: RefObject<HTMLTextAreaElement>;
  value: string;
  setValue: (value: string) => void;
  /** saves the text, or only closes when it is unchanged */
  save: () => void;
  /** on the editor's box: Cmd/Ctrl+Enter in the field saves; in a modal Tab stays inside; in an inline form Escape closes */
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
}

export interface CommentDraftOptions {
  /**
   * What gets the focus back on close. An element or null for none; by default what had the focus
   * as the editor opened. A function is asked after the commit that closes the editor, so it can
   * find an element the same commit drew again (the card of the comment that was edited): it gets
   * the chat view the editor was in (`scope`, null for the modal, which sits outside it).
   */
  opener?: HTMLElement | null | ((scope: Element | null) => HTMLElement | null);
  /** where the focus goes when its opener is gone (the composer of the pane): asked once, as the editor opens */
  fallback: (scope: Element | null) => HTMLElement | null;
  /** not modal: Escape only from inside it, no Tab trap, and the focus is given back only if the editor still had it */
  inline?: boolean;
  /** the text the field starts with when it is not `initialComment`: a form that was being written in, drawn again */
  startValue?: string;
  /** told the text as it changes */
  onText?: (value: string) => void;
}

/**
 * The behaviour both comment editors share. The field grows with the comment, takes the focus with
 * its caret at the end, and Escape cancels: anywhere while a modal is up, only from inside an
 * inline form (`inline`), which leaves the rest of the page usable. On close the focus goes back to
 * the `opener` (by default what had it when the editor opened), else to the `fallback` element: a
 * deleted comment takes its own card, the opener, with it. `fallback()` is asked once, as the
 * editor opens (the caller's own composer: its chat may be gone when the editor closes, and
 * another pane's composer is not its). The target is chosen after the commit that closes the
 * editor (`restoreFocusTarget`), when a deleted card is out of the document too. An inline form
 * gives the focus back only when it still has it (or nothing has): the user may be typing
 * elsewhere when it closes or its chat goes. On a touch screen the fallback is not focused (no
 * keyboard unasked): the focus is let go.
 */
export function useCommentDraft(
  initialComment: string,
  onSave: (comment: string) => void,
  onClose: () => void,
  { opener: given, fallback, inline = false, startValue, onText }: CommentDraftOptions,
): CommentDraft {
  const surface = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(startValue ?? initialComment);
  const save = (): void => { if (value.trim() === initialComment.trim()) onClose(); else onSave(value); };
  const told = useRef(onText);
  told.current = onText;
  useEffect(() => told.current?.(value), [value]);

  // one line to start, growing with the comment up to the cap in CSS, as the composer's box does
  useLayoutEffect(() => {
    const node = field.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${node.scrollHeight + node.offsetHeight - node.clientHeight}px`;
  }, [value]);

  // the opener and the fallback as the editor opened: read once, they do not change while it is up
  const askFallback = useRef(fallback);
  const openedBy = useRef(given);
  const nonModal = useRef(inline);
  useLayoutEffect(() => {
    const scope = surface.current?.closest(".chat-view") ?? null;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const opener = (): HTMLElement | null => {
      const by = openedBy.current;
      return typeof by === "function" ? by(scope) : by !== undefined ? by : active;
    };
    const back = askFallback.current(scope);
    return () => {
      // still in the document here: React runs this before it takes the editor's elements out
      if (nonModal.current) {
        const now = document.activeElement;
        const held = now === null || now === document.body || (surface.current?.contains(now) ?? false);
        if (!held) return;
      }
      // chosen after the commit: a deleted comment's card is still in the document here, and
      // React removes it right after, which would leave the focus on the body
      // (a touch screen lets it go instead of raising the keyboard in the composer, as the composer's undo does)
      queueMicrotask(() => restoreFocusTarget(opener(), back, nonModal.current, window.matchMedia("(pointer: coarse)").matches)?.focus({ preventScroll: true }));
    };
  }, []);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const node = field.current;
      if (!node) return;
      node.focus({ preventScroll: true });
      node.setSelectionRange(node.value.length, node.value.length);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);
  // A modal's Escape is its own, not the composer's or the chat's underneath: anywhere, from the window in the capture
  // phase. An inline form's is handled by its surface's `onKeyDown` below, so only from inside it
  useEffect(() => {
    if (inline) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, inline]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    // React's root dispatches after every document- and window-capture listener, so the walk's Escape (Composer.tsx, on
    // the document) has already run when an inline form gives up here, whatever the order the listeners were added in
    if (inline && event.key === "Escape") {
      event.stopPropagation();
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && event.target === field.current) {
      event.preventDefault();
      save();
      return;
    }
    // a modal keeps Tab inside; an inline form is in the page's flow, and Tab goes on from it
    if (inline || event.key !== "Tab" || !surface.current) return;
    const stops = [...surface.current.querySelectorAll<HTMLElement>("button:not(:disabled), textarea, a[href]")];
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (!first || !last) return;
    if (event.shiftKey ? document.activeElement === first : document.activeElement === last) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  };

  return { surface, field, value, setValue, save, onKeyDown };
}

/** The comment's field in either editor. */
export function CommentField({ draft }: { draft: CommentDraft }) {
  const t = useT();
  return <textarea
    ref={draft.field}
    className="comment-editor-field"
    value={draft.value}
    maxLength={COMMENT_MAX_CHARS}
    rows={1}
    aria-label={t("Comment")}
    placeholder={t("Write a comment…")}
    onChange={(event) => draft.setValue(event.target.value)}
  />;
}
