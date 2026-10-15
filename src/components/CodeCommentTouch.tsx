/**
 * The code view's comments under a finger (CodeComments.tsx), while comment mode is on: a long press on a line, or a
 * tap (Settings → Comments → On mobile, comment with), opens its comment, and turning the mode by touch says so in a
 * hint (CommentModeHint.tsx). A mouse and a pen keep the ⊕ (CodeCommentAdd.tsx): which applies is decided per press
 * by its `pointerType`.
 *
 * - A finger's press, its moves, its lift, a `pointercancel`, a scroll (the viewer's body, or the code sideways) and the
 *   click after it go through `pressStep` (lib/codeCommentPress.ts), which keeps no timers: the press's timer is set
 *   here. A second finger (a pinch) cancels it.
 * - A long press is armed at `LONG_PRESS_MS` (its fill complete, a 10 ms tick where the device can) and opens on the
 *   finger's lift: inside its `pointerup`, flushed at once, so the field has the focus within the user's gesture and
 *   iOS Safari raises the keyboard. A move past the slop, a scroll or a `pointercancel` before the lift disarms it.
 * - While a line is pressed (armed too) it is marked `.is-pressing`, and the press's tint lies under it
 *   (`.code-comment-press`, CodeComments.css): the line's text rows in `--bg-hover` after `PRESS_FILL_DELAY_MS`, then
 *   the `--primary-tint` fill from the left to the end of the press. It is an element of the layer drawn under the
 *   code's text (the body isolates it, FileViewer.css), so neither a line's box nor the `<pre>`'s style changes and a
 *   long file lays out nothing again. The line whose comment a finger opened keeps a band of its own while it is open
 *   (`.code-comment-held`, `held`): a separate element, so a new press on another line still waits out its delay.
 * - The click a long press still causes is swallowed wherever it lands, with its mouse events: on the sheet's scrim
 *   they would close the sheet the lift just opened, and its `mousedown` would take the focus from the field. A long
 *   press no click follows (a context menu took it, or the browser sent none) leaves nothing to swallow later: the next
 *   press resets the recogniser, and so does `CLICK_AFTER_LIFT_MS` after the lift; a keyboard's click (`detail` 0) is
 *   never a finger's.
 * - A long press opens no context menu on the code while the mode is on, and gives a 10 ms tick where the device can.
 * - While a finger's press lasts (pressing or armed) no text selection starts (`selectstart` cancelled): the code keeps
 *   its selection otherwise, since `user-select: none` over a long file costs WebKit every keystroke in a field.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { flushSync } from "react-dom";

import { clickFacts, isCommentClick, isDismissingPress } from "../lib/commentClick.ts";
import { lineAt, lineElement, originOf, textRows } from "../lib/codeCommentDom.ts";
import { LONG_PRESS_MS, pressStep, type PressEvent, type PressState } from "../lib/codeCommentPress.ts";
import type { MobileCommentGesture } from "../lib/settings.ts";

/** How long after a long press's lift its click may still come; past it, none will. */
const CLICK_AFTER_LIFT_MS = 500;

const IDLE: PressState = { kind: "idle" };
const CANCEL: PressEvent = { type: "cancel" };
/** On the pressed line element and on the tint; the line's mark is a state hook (no style), which the browser script reads. */
const PRESSING_CLASS = "is-pressing";
const HELD_CLASS = "is-held";

export interface CodeCommentPressOptions {
  /** the viewer's scrolling body */
  surface: RefObject<HTMLDivElement | null>;
  /** the code's `<pre>` while the layer is drawn, else null */
  pre: HTMLElement | null;
  /** comment mode */
  mode: boolean;
  gesture: MobileCommentGesture;
  /** the line whose comment a finger opened, while it is open: it keeps the tint's band */
  held: number | null;
  /** a finger opened line `line` */
  onOpen: (line: number) => void;
}

export interface CodeCommentPress {
  /** the press's tint, an element of the layer (`.code-comment-press`) */
  tint: RefObject<HTMLDivElement | null>;
  /** the band of the line a finger opened, an element of the layer (`.code-comment-held`) */
  band: RefObject<HTMLDivElement | null>;
  /** places the tint and the band again, after the layer moved the lines */
  place: () => void;
  /** what pressed last: "touch", "mouse" or "pen" (a keyboard's click keeps what was before) */
  pointer: () => string;
}

/** The touch gesture on the code's lines (see the module comment). */
export function useCodeCommentPress({ surface, pre, mode, gesture, held, onOpen }: CodeCommentPressOptions): CodeCommentPress {
  const tint = useRef<HTMLDivElement>(null);
  const band = useRef<HTMLDivElement>(null);
  const pointer = useRef("mouse");
  const latest = useRef({ gesture, held, onOpen });
  latest.current = { gesture, held, onOpen };
  const state = useRef<PressState>(IDLE);
  // the line a long press opened, until its click is through: it keeps the band while the opening lands
  const fired = useRef<number | null>(null);
  // the line element marked `.is-pressing`
  const marked = useRef<HTMLElement | null>(null);

  /** Lays the press's tint on the pressed line, and the band on the line a finger opened (or is opening); marks the pressed line. */
  const place = useCallback((): void => {
    const body = surface.current;
    const now = state.current;
    const pressing = now.kind === "pressing" || now.kind === "armed" ? now.line : null;
    const pressed = pressing !== null && pre !== null ? lineElement(pre, pressing) : null;
    if (marked.current !== pressed) {
      marked.current?.classList.remove(PRESSING_CLASS);
      pressed?.classList.add(PRESSING_CLASS);
      marked.current = pressed;
    }
    /** Lays `node` over line `line`'s text rows across the code, `shown` by `className`; hides it without a line. */
    const lay = (node: HTMLDivElement | null, line: number | null, className: string): void => {
      if (node === null) return;
      const element = line === null || pre === null ? null : line === pressing ? pressed : lineElement(pre, line);
      const rows = element === null ? null : textRows(element);
      if (body === null || pre === null || rows === null) {
        node.classList.remove(className);
        return;
      }
      const origin = originOf(body);
      const box = pre.getBoundingClientRect();
      node.style.left = `${box.left - origin.left}px`;
      node.style.top = `${rows.top - origin.top}px`;
      node.style.width = `${box.width}px`;
      node.style.height = `${rows.bottom - rows.top}px`;
      node.classList.add(className);
    };
    lay(tint.current, pressing, PRESSING_CLASS);
    lay(band.current, now.kind === "fired" ? fired.current : latest.current.held, HELD_CLASS);
  }, [surface, pre]);
  useLayoutEffect(place, [place, held]);

  const active = mode && pre !== null;
  useEffect(() => {
    const body = surface.current;
    if (!active || body === null || pre === null) return;
    let timer = 0;
    let lift = 0;
    // the last `pointerdown`: whether it dismissed an open field is known only after the popover's own listener saw it
    let press: PointerEvent | null = null;

    /** One event through the recogniser; its timer, the tint and an opening follow from the step. */
    const apply = (event: PressEvent): ReturnType<typeof pressStep> => {
      const was = state.current;
      const step = pressStep(was, event, latest.current.gesture, true);
      const now = step.state;
      state.current = now;
      if (now.kind === "armed" && was.kind === "pressing") navigator.vibrate?.(10);
      if (now.kind === "fired" && was.kind === "armed") fired.current = was.line;
      const started = now.kind === "pressing" && (was.kind !== "pressing" || was.line !== now.line);
      if (started || was.kind !== now.kind) {
        window.clearTimeout(timer);
        if (now.kind === "pressing") timer = window.setTimeout(expire, LONG_PRESS_MS);
        place();
      }
      window.clearTimeout(lift);
      if (now.kind === "fired" && event.type === "up") lift = window.setTimeout(() => { if (state.current.kind === "fired") apply(CANCEL); }, CLICK_AFTER_LIFT_MS);
      // drawn and focused before the event's handling ends: inside the user's gesture (the lift, the tap's click)
      const open = step.open;
      if (open !== null) flushSync(() => latest.current.onOpen(open));
      return step;
    };
    /** A finger rests on a line: pressing, or armed. */
    const pressed = (): boolean => state.current.kind === "pressing" || state.current.kind === "armed";
    /** The press's timer: a timer that ran early waits out the rest. */
    function expire(): void {
      const now = state.current;
      if (now.kind !== "pressing") return;
      const left = now.since + LONG_PRESS_MS - performance.now();
      if (left > 0) timer = window.setTimeout(expire, left);
      else apply({ type: "timer", at: performance.now() });
    }

    const onDown = (event: PointerEvent): void => {
      pointer.current = event.pointerType;
      press = event;
      const line = event.pointerType === "touch" && event.isPrimary ? lineAt(pre, event.target, event.clientY) : null;
      apply(line === null ? CANCEL : { type: "down", line, x: event.clientX, y: event.clientY, at: performance.now() });
    };
    const onMove = (event: PointerEvent): void => {
      if (event.pointerType === "touch" && event.isPrimary && pressed()) apply({ type: "move", x: event.clientX, y: event.clientY });
    };
    const onUp = (event: PointerEvent): void => {
      if (event.pointerType === "touch" && event.isPrimary) apply({ type: "up" });
    };
    // the browser took the touch over: a press ends (an armed one opens nothing); one that opened has lifted, as far as its click goes
    const onCancel = (): void => {
      if (pressed()) apply(CANCEL);
      else if (state.current.kind === "fired") apply({ type: "up" });
    };
    const onScroll = (): void => {
      if (pressed()) apply({ type: "scroll" });
    };
    // a long press's click, and the mouse events before it: held back, wherever they land
    const onMouse = (event: MouseEvent): void => {
      if (state.current.kind !== "fired" && state.current.kind !== "armed") return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const onClick = (event: MouseEvent): void => {
      // a keyboard's click, or a mouse's or a pen's (their own path: CodeComments.tsx)
      if (event.detail === 0 || pointer.current !== "touch") return;
      const opens = !isDismissingPress(press) && isCommentClick(clickFacts(event));
      const step = apply({ type: "click", line: opens ? lineAt(pre, event.target, event.clientY) : null });
      if (!step.swallowClick) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    // a finger's long press on the code, or one that opened a comment (the sheet is under it now): no context menu
    const onMenu = (event: MouseEvent): void => {
      if (pointer.current !== "touch") return;
      if (state.current.kind !== "idle" || (event.target instanceof Node && pre.contains(event.target))) event.preventDefault();
    };
    // a finger's press, while it lasts: no text selection (a long press starts one on a touch screen)
    const onSelect = (event: Event): void => {
      if (pressed()) event.preventDefault();
    };

    // at the window's capture: before the popover's own press handling, and the click before anything it lands on
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointermove", onMove, { capture: true, passive: true });
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onCancel, true);
    window.addEventListener("mousedown", onMouse, true);
    window.addEventListener("mouseup", onMouse, true);
    window.addEventListener("click", onClick, true);
    window.addEventListener("contextmenu", onMenu, true);
    window.addEventListener("selectstart", onSelect, true);
    // a scroll does not bubble: the body's capture sees its own and the code's sideways one
    body.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onCancel, true);
      window.removeEventListener("mousedown", onMouse, true);
      window.removeEventListener("mouseup", onMouse, true);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("contextmenu", onMenu, true);
      window.removeEventListener("selectstart", onSelect, true);
      body.removeEventListener("scroll", onScroll, true);
      window.clearTimeout(timer);
      window.clearTimeout(lift);
      state.current = IDLE;
      place();
    };
  }, [active, surface, pre, place]);

  const readPointer = useCallback((): string => pointer.current, []);
  return { tint, band, place, pointer: readPointer };
}
