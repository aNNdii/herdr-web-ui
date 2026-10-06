/**
 * The floating Comment button for text selected on a comment surface (the chat's final replies,
 * the file viewer). The surface says what a selection makes (`measure`) and what a press does
 * (`onComment`); the button only follows the selection, places itself and stays out of its way.
 */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { MessageSquarePlus } from "lucide-react";

import "./BlockComments.css";

import { floatingPlace, onLine, placeAtPointer } from "../lib/commentSelection.ts";
import { useT } from "../lib/i18n.ts";

/** A selection a surface can comment on, measured where the button goes. */
export interface MeasuredSelection {
  /** the same text selected has the same key, whatever else moved (a reflow) */
  key: string;
  /**
   * Where the button goes, measured on the user's whole selection: the last line on screen. A
   * keyboard or touch selection's button goes above or below it.
   */
  placeRect: DOMRect;
  /** every line of selected text on screen, in order: the line under a mouse's release is one of them */
  placeLines: DOMRect[];
}

/** Room between a selection's line and its Comment button; below it a touch screen's selection handle hangs, so more. */
const SELECTION_GAP_PX = 8;
const SELECTION_GAP_TOUCH_PX = 28;
/** The least room between the button and the view's sides. */
const SELECTION_MARGIN_PX = 8;

/** Where a pointer let go (client coordinates) and what it was: a mouse or pen's release is where the user looks. */
interface Release { x: number; y: number; type: string }

/** Same selection, same place: no re-render for a `selectionchange` that changed nothing of it. */
function sameSelection(a: MeasuredSelection, b: MeasuredSelection): boolean {
  return a.key === b.key && a.placeRect.top === b.placeRect.top && a.placeRect.bottom === b.placeRect.bottom && a.placeRect.right === b.placeRect.right;
}

/**
 * The Comment button for text selected in `view` (what `measure` finds in it). It sits in the
 * scrolling `view`, so it scrolls with the text. A mouse or pen puts it where its release was:
 * centred on the pointer, above the line under it. A touch screen puts it below the last line, where
 * its own menu does not reach; a selection made with the keyboard, above that line. Lines are those
 * of the whole selection, also where it runs over several paragraphs or list items (one comment on
 * all of it). It shows once a mouse lets go, stays put while the selection does not change, and goes
 * when the selection collapses or `measure` finds none. A press on it keeps the selection. It hands
 * the selection to `onComment` and hides: the form it opens takes the selection away. A selection
 * inside a comment's field is none: the form is in the view, but it is not its text.
 */
export function SelectionCommentButton<T extends MeasuredSelection>({ view, measure, onComment }: {
  view: RefObject<HTMLElement>;
  measure: (selection: Selection | null, view: Element) => T | null;
  onComment: (found: T) => void;
}): JSX.Element | null {
  const t = useT();
  const [found, setFound] = useState<{ comment: T; release: Release | null } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  // read when the selection changes: a surface's measure may be a new function every render
  const measureRef = useRef(measure);
  measureRef.current = measure;
  // the last release not yet matched to a selection it made; a selection that changes without one (the keyboard) has none
  const released = useRef<Release | null>(null);
  // pressed, not yet clicked: a touch screen may drop the selection in between, and the button
  // stays for the click. Never outlives the press: a release elsewhere, a cancel or any click ends it
  const pressing = useRef(false);

  useEffect(() => {
    let frame = 0;
    // a mouse button held down: the selection is still being drawn
    let dragging = false;
    const update = (): void => {
      frame = 0;
      if (pressing.current) return;
      const node = view.current;
      const field = document.activeElement;
      const writing = field instanceof HTMLTextAreaElement && node?.contains(field) === true;
      const next = dragging || writing || node === null ? null : measureRef.current(window.getSelection(), node);
      const release = released.current;
      released.current = null;
      setFound((current) => {
        if (next === null) return null;
        if (current !== null && sameSelection(current.comment, next)) return current;
        // the same text, moved (a reflow) or reached otherwise (the keyboard over a blank or a rule):
        // a mouse's release stands while it is still on one of its lines; a touch's stands for being one
        const held = current !== null && current.comment.key === next.key ? current.release : null;
        const stands = held !== null && (held.type === "touch" || onLine(next.placeLines, held.y));
        return { comment: next, release: release ?? (stands ? held : null) };
      });
    };
    // once per frame, however many events a drag or a handle fires
    const schedule = (): void => { if (frame === 0) frame = window.requestAnimationFrame(update); };
    const onButton = (event: Event): boolean => event.target instanceof Node && button.current?.contains(event.target) === true;
    const onPointerDown = (event: PointerEvent): void => {
      if (onButton(event)) return;
      pressing.current = false;
      if (event.pointerType === "mouse" && event.button === 0) { dragging = true; schedule(); }
    };
    // released on the button, the click follows and ends the press; released anywhere else, no click will
    const onPointerUp = (event: PointerEvent): void => {
      dragging = false;
      if (!onButton(event)) { pressing.current = false; released.current = { x: event.clientX, y: event.clientY, type: event.pointerType }; }
      schedule();
    };
    const onPointerCancel = (): void => { dragging = false; pressing.current = false; schedule(); };
    const onClick = (): void => { if (pressing.current) { pressing.current = false; schedule(); } };
    // the view or its column resized (a window, the composer, a chat width setting): the text rewrapped under the button
    const resized = new ResizeObserver(schedule);
    const node = view.current;
    if (node !== null) {
      resized.observe(node);
      if (node.firstElementChild !== null) resized.observe(node.firstElementChild);
    }
    document.addEventListener("selectionchange", schedule);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("pointercancel", onPointerCancel, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keyup", schedule, true);
    window.addEventListener("resize", schedule);
    return () => {
      window.cancelAnimationFrame(frame);
      resized.disconnect();
      document.removeEventListener("selectionchange", schedule);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("pointercancel", onPointerCancel, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keyup", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [view]);

  // placed before paint, in the view's scrolled content: measured against its visible box, then shifted by its scroll
  useLayoutEffect(() => {
    const node = button.current;
    const scroller = view.current;
    if (node === null || scroller === null || found === null) return;
    const box = scroller.getBoundingClientRect();
    const left = box.left + scroller.clientLeft;
    const top = box.top + scroller.clientTop;
    const { comment, release } = found;
    // a release by touch, or none at all (the keyboard): the selection's last line; else the line under the pointer
    const at = release !== null && release.type !== "touch" ? { x: release.x - left, y: release.y - top } : null;
    const below = release !== null ? release.type === "touch" : window.matchMedia("(pointer: coarse)").matches;
    const options = { below, gap: below ? SELECTION_GAP_TOUCH_PX : SELECTION_GAP_PX, margin: SELECTION_MARGIN_PX };
    const viewSize = { width: scroller.clientWidth, height: scroller.clientHeight };
    const size = { width: node.offsetWidth, height: node.offsetHeight };
    const place = at !== null
      ? placeAtPointer(comment.placeLines.map((line) => ({ top: line.top - top, bottom: line.bottom - top })), at, viewSize, size, options)
      : floatingPlace({ top: comment.placeRect.top - top, bottom: comment.placeRect.bottom - top, right: comment.placeRect.right - left }, viewSize, size, options);
    node.style.left = `${place.left + scroller.scrollLeft}px`;
    node.style.top = `${place.top + scroller.scrollTop}px`;
  }, [found, view]);

  if (found === null) return null;
  return <button
    ref={button}
    type="button"
    className="btn comment-selection"
    onPointerDown={(event) => { event.preventDefault(); pressing.current = true; }}
    onMouseDown={(event) => event.preventDefault()}
    onClick={() => {
      pressing.current = false;
      setFound(null);
      onComment(found.comment);
    }}
  >
    <MessageSquarePlus aria-hidden="true" />{t("Comment")}
  </button>;
}
