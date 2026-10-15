/**
 * What the comment popover (CommentPopover.tsx, in place or as a dialog) is written with: a
 * comment's text with its field and its keys, and where the focus goes when the editor closes.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";

import "./CommentPopover.css";

import { COMMENT_SURFACE } from "../lib/commentHighlight.ts";
import { commentCanSave, commentChanged, leaveKey, leaveOutcome, submitKey } from "../lib/commentPopover.ts";
import { restoreFocusTarget } from "../lib/commentSelection.ts";
import { fieldAnchor } from "../lib/frameField.ts";
import { useT } from "../lib/i18n.ts";

/**
 * Whether a key or a press (its `target`) while a comment's popover or dialog (`box`) is up belongs to another modal
 * dialog, one that does not hold the box (Settings by its shortcut, a question it asks, the file viewer opened from a reply). That
 * dialog's own then: its Escape never closes the comment beneath, which listens on the whole window, nor does a press in
 * it count as one outside the comment (CommentPopover.tsx).
 */
export function inAnotherDialog(target: EventTarget | null, box: Element | null): boolean {
  const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  const dialog = element?.closest("[aria-modal='true']") ?? null;
  // the dialog is the comment's own (its box), or one it lies in (the file viewer): not another
  return dialog !== null && !(box !== null && dialog.contains(box));
}

/** Longest comment, in UTF-16 units as `maxLength` counts. */
export const COMMENT_MAX_CHARS = 2000;

/** A comment being written in the popover: its text, its field and its keys. */
export interface CommentDraft {
  /** the editor's own box */
  surface: RefObject<HTMLDivElement | null>;
  field: RefObject<HTMLTextAreaElement | null>;
  value: string;
  /** Save does something (`commentCanSave`): a new comment with only blanks, or a saved one unchanged, has nothing to save */
  canSave: boolean;
  /** the text is changed (`commentChanged`): the composer's Send and the walk stop at it, and Settings asks before turning comments off */
  changed: boolean;
  setValue: (value: string) => void;
  /** saves the text, or only closes when it is unchanged */
  save: () => void;
  /**
   * Leaves the editor (Escape, ✕, a press outside it or on its scrim), which always ends it (`leaveOutcome`): what was
   * typed is saved (an emptied edit deletes the comment), and a field left as it opened, or a new one left blank, only
   * closes
   */
  leave: () => void;
  /** on the editor's box: in a popover in place, Escape leaves it (`leave`) */
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  /** on the field: Enter (and Cmd/Ctrl+Enter) saves when `canSave` (`submitKey`); Shift+Enter breaks the line */
  onFieldKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
  /**
   * The field's first focus, its caret at the end: once, and only where the field takes it as the editor opens
   * (`focusField`). The editor asks as it opens; a field drawn a commit later (in a frame of its own, FrameField.tsx) asks
   * again once it is there
   */
  focusStart: () => void;
  /** sizes the field to its text (one line to start, up to its cap in CSS): a field whose width changed asks again */
  fit: () => void;
}

export interface CommentDraftOptions {
  /**
   * What gets the focus back on close. An element or null for none; by default what had the focus
   * as the editor opened. A function is asked after the commit that closes the editor, so it can
   * find an element the same commit drew again (the card of the comment that was edited): it gets
   * the comment surface the editor was in (`scope`: the chat view, the file viewer; null for a
   * dialog, which sits outside it).
   */
  opener?: HTMLElement | null | ((scope: Element | null) => HTMLElement | null);
  /** where the focus goes when its opener is gone (the composer of the pane): asked once, as the editor opens */
  fallback: (scope: Element | null) => HTMLElement | null;
  /** a popover in place, not a dialog: Escape only from inside it, and the focus is given back only if the editor still had it */
  inline?: boolean;
  /**
   * Whether the field takes the focus as the editor opens (`popoverFocusesField`); else its box (`surface`, which then
   * needs `tabIndex={-1}`) does, so Escape is the editor's and no keyboard rises on a touch screen. Default: the field
   */
  focusField?: boolean;
  /**
   * False: nothing takes the focus as the editor opens, neither the field nor the box (the field over a selection,
   * MarkdownComments.tsx: the page keeps its selection, and a keyboard can go on extending it; the first printable key
   * moves the focus into the field). Default true
   */
  focusOnOpen?: boolean;
  /** the text the field starts with when it is not `initialComment`: a comment that was being written in, drawn again */
  startValue?: string;
  /** told the text as it changes */
  onText?: (value: string) => void;
  /**
   * Another value starts the text again, from `startValue` or else `initialComment`: a sheet that pages to another
   * comment (MarkdownCommentSheet.tsx) keeps its box, its field and the field's focus
   */
  resetKey?: string | number;
}

/**
 * The behaviour of the comment popover's editing, in place or as a dialog. The field grows with the comment, takes the focus with
 * its caret at the end (unless `focusField` is false: then the box takes it), and Escape leaves it (`leave`, `leaveOutcome`: what was typed is saved, a
 * field left as it opened or a new one left blank only closes): anywhere while a dialog is up; from inside a popover in place (`inline`), which
 * leaves the rest of the page usable. Enter saves only what Save would (`canSave`), Shift+Enter breaks the line (`submitKey`).
 * On close the focus goes back to
 * the `opener` (by default what had it when the editor opened), else to the `fallback` element: a
 * deleted comment takes its own card, the opener, with it. `fallback()` is asked once, as the
 * editor opens (the caller's own composer: its chat may be gone when the editor closes, and
 * another pane's composer is not its). The target is chosen after the commit that closes the
 * editor (`restoreFocusTarget`), when a deleted card is out of the document too. A popover in place
 * gives the focus back only when it still has it (or nothing has): the user may be typing
 * elsewhere when it closes or its chat goes. On a touch screen the fallback is not focused (no
 * keyboard unasked): the focus is let go.
 */
export function useCommentDraft(
  initialComment: string,
  onSave: (comment: string) => void,
  onClose: () => void,
  { opener: given, fallback, inline = false, focusField = true, focusOnOpen = true, startValue, onText, resetKey }: CommentDraftOptions,
): CommentDraft {
  const surface = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(startValue ?? initialComment);
  // another `resetKey`: the text starts again, set during this render so no frame shows the one before
  const [shownKey, setShownKey] = useState(resetKey);
  if (shownKey !== resetKey) {
    setShownKey(resetKey);
    setValue(startValue ?? initialComment);
  }
  const save = (): void => { if (value.trim() === initialComment.trim()) onClose(); else onSave(value); };
  const told = useRef(onText);
  told.current = onText;
  useEffect(() => told.current?.(value), [value]);

  // one line to start, growing with the comment up to the cap in CSS, as the composer's box does
  const fit = useCallback((): void => {
    const node = field.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${node.scrollHeight + node.offsetHeight - node.clientHeight}px`;
  }, []);
  useLayoutEffect(fit, [value, fit]);

  // the opener and the fallback as the editor opened: read once, they do not change while it is up
  const askFallback = useRef(fallback);
  const openedBy = useRef(given);
  const nonModal = useRef(inline);
  useLayoutEffect(() => {
    const scope = surface.current?.closest(`[${COMMENT_SURFACE}]`) ?? null;
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
        // a field in a frame of its own (FrameField.tsx) counts as its slot in the box
        const held = now === null || now === document.body || (surface.current?.contains(fieldAnchor(now)) ?? false);
        if (!held) return;
      }
      // chosen after the commit: a deleted comment's card is still in the document here, and
      // React removes it right after, which would leave the focus on the body
      // (a touch screen lets it go instead of raising the keyboard in the composer, as the bar's X does).
      // Unless something took the focus meanwhile: the field of the editor drawn in its place (a popover
      // that became a dialog) keeps it
      queueMicrotask(() => {
        const now = document.activeElement;
        if (now instanceof HTMLElement && now !== document.body && now.isConnected) return;
        restoreFocusTarget(opener(), back, nonModal.current, window.matchMedia("(pointer: coarse)").matches)?.focus({ preventScroll: true });
      });
    };
  }, []);
  // in the commit, so inside the tap or click that opened the editor: iOS raises its keyboard only for a
  // focus given while that event is handled (not a frame later), and a phone's user would else tap the field.
  // Without `focusField` the box takes it instead: the editor holds the focus (its Escape, a dialog's trap) and no
  // keyboard rises; a tap into the field starts editing
  const focusesField = useRef(focusField);
  const focusesAtAll = useRef(focusOnOpen);
  const started = useRef(false);
  const focusStart = useCallback((): void => {
    if (started.current || !focusesField.current) return;
    const node = field.current;
    if (!node) return;
    started.current = true;
    node.focus({ preventScroll: true });
    node.setSelectionRange(node.value.length, node.value.length);
  }, []);
  useLayoutEffect(() => {
    if (!focusesAtAll.current) return;
    if (!focusesField.current) {
      surface.current?.focus({ preventScroll: true });
      return;
    }
    focusStart();
  }, [focusStart]);
  const changed = commentChanged(value, initialComment);
  const canSave = commentCanSave(value, initialComment);
  const leave = (): void => {
    if (leaveOutcome({ initialComment }, value) === "save") save();
    else onClose();
  };
  // A dialog's Escape is its own, not the composer's or the chat's underneath: anywhere, from the window in the capture
  // phase. A popover in place handles it in its surface's `onKeyDown` below, so only from inside it. Either leaves
  // the editor (`leave`), and a dialog's keeps the key from what is underneath (a file viewer would close on it).
  // A caller may hand a new onClose on every render, and the text changes: read here, the listener stays where it is in
  // the window's order
  const leaveRef = useRef(leave);
  leaveRef.current = leave;
  useEffect(() => {
    if (inline) return;
    const onKey = (event: KeyboardEvent): void => {
      // an IME's Escape cancels its conversion, not the comment (`leaveKey`)
      if (!leaveKey(event) || inAnotherDialog(event.target, surface.current)) return;
      event.stopPropagation();
      event.preventDefault();
      leaveRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [inline]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    // React's root dispatches after every document- and window-capture listener, so the walk's Escape (Composer.tsx, on
    // the document) has already run when a popover leaves here, whatever the order the listeners were added in. The key
    // is taken: the file viewer underneath stays. A dialog keeps Tab inside through its focus trap (CommentPopover.tsx,
    // `useFocusTrap`); a popover is in the page's flow, and Tab goes on from it without leaving it
    if (inline && leaveKey(event.nativeEvent)) {
      event.stopPropagation();
      event.preventDefault();
      leave();
    }
  };
  const onFieldKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (!submitKey(event.nativeEvent)) return;
    event.preventDefault();
    // as a Save button: nothing to save is no save, and the editor stays
    if (canSave) save();
  };

  return { surface, field, value, canSave, changed, setValue, save, leave, onKeyDown, onFieldKeyDown, focusStart, fit };
}

/** The comment's field, in its popover. */
export function CommentField({ draft }: { draft: CommentDraft }) {
  const t = useT();
  return <textarea
    ref={draft.field}
    className="comment-editor-field"
    value={draft.value}
    maxLength={COMMENT_MAX_CHARS}
    rows={1}
    // Enter saves (`submitKey`): a soft keyboard's key says so, not "return"
    enterKeyHint="done"
    aria-label={t("Comment")}
    placeholder={t("Write a comment…")}
    onChange={(event) => draft.setValue(event.target.value)}
    onKeyDown={draft.onFieldKeyDown}
  />;
}
