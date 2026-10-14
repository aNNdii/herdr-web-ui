/**
 * The code view's ⊕ (CodeComments.tsx): one button on a line, centred on the divider, that opens the line's field. A
 * mouse or a pen puts it on the hovered line; with the mode on it is also one Tab stop, and the arrow keys move it.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type RefObject } from "react";
import { MessageSquarePlus } from "lucide-react";

import { firstVisibleLine, lineAt, lineBounds, lineElement, linesPerPage, originOf, textRows } from "../lib/codeCommentDom.ts";
import { useT } from "../lib/i18n.ts";
import { useMediaQuery } from "../lib/useMediaQuery.ts";

/** The divider's x in client pixels: the code's hairline background (FileViewer.css), so the CSS stays its one source. */
function dividerX(pre: HTMLElement): number | null {
  const code = pre.querySelector("code");
  if (code === null) return null;
  const style = getComputedStyle(code);
  return code.getBoundingClientRect().left + parseFloat(style.backgroundPositionX) + parseFloat(style.backgroundSize) / 2;
}

/** The pointers that hover: a mouse's and a pen's (a finger has no ⊕). */
const hovers = (event: PointerEvent): boolean => event.pointerType === "mouse" || event.pointerType === "pen";

/**
 * How the ⊕ was pressed: with a key, by a mouse or a pen, or by a finger (one that found it shown, an iPad's trackpad
 * having put it there), which opens the line as a finger's tap on the line does.
 */
export type AddPress = "keyboard" | "pointer" | "touch";

/**
 * The line a key moves the ⊕ to from `line`, clamped to the lines there are; null for a key that does not move it.
 * `page` is the lines that fit in the body's view.
 */
function movedTo(key: string, line: number, bounds: { first: number; last: number }, page: number): number | null {
  const to = key === "ArrowUp" ? line - 1
    : key === "ArrowDown" ? line + 1
    : key === "PageUp" ? line - page
    : key === "PageDown" ? line + page
    : key === "Home" ? bounds.first
    : key === "End" ? bounds.last
    : null;
  return to === null ? null : Math.min(bounds.last, Math.max(bounds.first, to));
}

/**
 * The ⊕ (one button, moved to the line it is for) while `active`: on the line a mouse or a pen hovers, else the one a
 * keyboard moved it to, else the line with the open field (`openLine`: a mouse's, a pen's or a key's, never a finger's),
 * so two never overlap. That line is tinted, its
 * text rows only (`data-comment-line` on the `<pre>`, CodeComments.css), never its room. `register` hands the layer the
 * function that places it again after the rows moved the lines. The code scrolled sideways (no wrapping) moves the
 * divider: the ⊕ follows it, and is out of sight (`is-idle`) while it is out of the `<pre>`'s view, so it never lies over code.
 *
 * With the mode on it is a Tab stop, out of sight (`is-idle`: no size, but focusable) while it has no line. It takes the
 * focus on the line it was last on, else the first line in the body's view; ↑ ↓ PageUp PageDown Home End move it (and
 * the tint) to another line, scrolled into view, and its name says which. Enter or Space opens that line's field
 * (`onAdd` with `keyboard`), which gives the focus back to the ⊕ as it closes. A press is told by the pointer that
 * pressed it, not by the click's `detail` alone (a click with no pointer is a key's).
 */
export const CodeCommentAdd = memo(function CodeCommentAdd({ surface, pre, active, openLine, onAdd, register }: {
  surface: RefObject<HTMLDivElement>;
  pre: HTMLElement | null;
  active: boolean;
  openLine: number | null;
  /** `keyboard`: pressed with a key, so the field gives the focus back to it; `touch`: by a finger, as a tap on the line */
  onAdd: (line: number, press: AddPress) => void;
  register: (place: () => void) => void;
}) {
  const t = useT();
  const button = useRef<HTMLButtonElement>(null);
  // the line a pointer hovers, or a key moved the ⊕ to (`byKey`)
  const [cursor, setCursor] = useState<number | null>(null);
  const byKey = useRef(false);
  // the pointer whose press the coming click ends (none for a key's click)
  const pressedBy = useRef<string | null>(null);
  // whether a mouse or a pen is over the code: a hovered line outlives the focus only while it is
  const pointerOver = useRef(false);
  const line = active ? cursor ?? openLine : null;
  const lineRef = useRef(line);
  lineRef.current = line;
  // the last line the ⊕ was on: where the focus finds it again, as the field it opened closes
  const lastLine = useRef<number | null>(null);
  if (line !== null) lastLine.current = line;
  useEffect(() => { lastLine.current = null; }, [pre]);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;

  useEffect(() => {
    const body = surface.current;
    if (!active || body === null || pre === null) {
      pointerOver.current = false;
      setCursor(null);
      return;
    }
    // where a finger last touched: WebKit follows a tap with a mouse's move there (once the page under it changed), which
    // is no mouse's hover
    let touched: { x: number; y: number } | null = null;
    const onTouch = (event: PointerEvent): void => {
      if (event.pointerType === "touch") touched = { x: event.clientX, y: event.clientY };
    };
    const onMove = (event: PointerEvent): void => {
      if (!hovers(event)) return;
      if (touched !== null && Math.abs(event.clientX - touched.x) < 1 && Math.abs(event.clientY - touched.y) < 1) return;
      touched = null;
      // on the ⊕ itself (it hangs over the line's edges): still that line's
      if (event.target instanceof Node && button.current?.contains(event.target)) return;
      byKey.current = false;
      pointerOver.current = true;
      setCursor(lineAt(pre, event.target, event.clientY));
    };
    // the pointer left while the ⊕ has the focus: the ⊕ stays where the keyboard has it
    const onLeave = (): void => {
      pointerOver.current = false;
      if (document.activeElement !== button.current) setCursor(null);
    };
    body.addEventListener("pointermove", onMove, { passive: true });
    body.addEventListener("pointerleave", onLeave);
    window.addEventListener("pointerdown", onTouch, { capture: true, passive: true });
    window.addEventListener("pointerup", onTouch, { capture: true, passive: true });
    return () => {
      body.removeEventListener("pointermove", onMove);
      body.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("pointerdown", onTouch, true);
      window.removeEventListener("pointerup", onTouch, true);
    };
  }, [active, surface, pre]);

  const place = useCallback((): void => {
    const node = button.current;
    const body = surface.current;
    const at = lineRef.current;
    const element = at === null || pre === null ? null : lineElement(pre, at);
    const rows = element === null ? null : textRows(element);
    const divider = pre === null ? null : dividerX(pre);
    if (node === null || body === null || pre === null || element === null || rows === null || divider === null) {
      node?.classList.add("is-idle");
      // parked in the middle of the body's view, so a browser that scrolls to a focused element finds it there (else it
      // lies at the top of the file and the first Tab jumps there); the body's scroll keeps it there (below)
      if (node !== null && body !== null) {
        node.style.left = `${body.scrollLeft + body.clientWidth / 2}px`;
        node.style.top = `${body.scrollTop + body.clientHeight / 2}px`;
      }
      pre?.removeAttribute("data-comment-line");
      return;
    }
    const origin = originOf(body);
    const middle = rows.top + rows.lineHeight / 2;
    const box = pre.getBoundingClientRect();
    const left = box.left + pre.clientLeft;
    node.classList.toggle("is-idle", divider < left || divider > left + pre.clientWidth);
    const size = node.offsetWidth || 28;
    node.style.left = `${divider - origin.left - size / 2}px`;
    node.style.top = `${middle - origin.top - size / 2}px`;
    // the line's tint: its text rows, measured in the <pre>'s padding box, where its background is drawn
    // (plain properties, not custom ones: a custom property set on the <pre> restyles each of its lines)
    pre.setAttribute("data-comment-line", "");
    pre.style.backgroundPosition = `0 ${rows.top - box.top - pre.clientTop}px`;
    pre.style.backgroundSize = `100% ${rows.bottom - rows.top}px`;
  }, [surface, pre]);
  useLayoutEffect(place, [place, line]);
  useLayoutEffect(() => register(place), [register, place]);
  // the code scrolled sideways: the divider moved under the ⊕
  const shown = line !== null;
  useEffect(() => {
    if (!shown || pre === null) return;
    pre.addEventListener("scroll", place, { passive: true });
    return () => pre.removeEventListener("scroll", place);
  }, [shown, pre, place]);
  useEffect(() => () => pre?.removeAttribute("data-comment-line"), [pre]);
  // on no line, the body scrolled: the parked ⊕ follows its view
  useEffect(() => {
    const body = surface.current;
    if (!active || shown || body === null) return;
    body.addEventListener("scroll", place, { passive: true });
    return () => body.removeEventListener("scroll", place);
  }, [active, shown, surface, place]);

  /** Puts the ⊕ on `to` (a key's), its line scrolled into view. */
  const moveTo = (to: number): void => {
    byKey.current = true;
    setCursor(to);
    if (pre !== null) lineElement(pre, to)?.scrollIntoView({ block: "nearest", behavior: reducedMotionRef.current ? "auto" : "smooth" });
  };
  const onFocus = (): void => {
    const body = surface.current;
    // already on a line (hovered, or the open field's): it stays there
    if (lineRef.current !== null || body === null || pre === null) return;
    const bounds = lineBounds(pre);
    const last = lastLine.current;
    const at = last !== null && bounds !== null && last >= bounds.first && last <= bounds.last ? last : firstVisibleLine(pre, body);
    if (at !== null) moveTo(at);
  };
  // a key's line goes with the focus; a hovered one stays only while the pointer is over the code (it may have left while
  // the ⊕ had the focus), else it would stay shown on a stale line
  const onBlur = (): void => {
    const stale = byKey.current || !pointerOver.current;
    byKey.current = false;
    if (stale) setCursor(null);
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    // a press that never became a click is not this key's
    pressedBy.current = null;
    const body = surface.current;
    const current = lineRef.current;
    const bounds = pre === null ? null : lineBounds(pre);
    const home = event.key === "Home" || event.key === "End";
    if (body === null || pre === null || current === null || bounds === null || event.altKey || event.shiftKey || ((event.ctrlKey || event.metaKey) && !home)) return;
    const to = movedTo(event.key, current, bounds, linesPerPage(pre, body, current));
    if (to === null) return;
    // the body does not scroll by itself
    event.preventDefault();
    moveTo(to);
  };

  const onClick = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    const by = pressedBy.current;
    pressedBy.current = null;
    if (line === null) return;
    onAdd(line, by === "touch" ? "touch" : by === null && event.detail === 0 ? "keyboard" : "pointer");
  };

  const label = !active ? undefined : t("Add a comment to line {line}", { line: line ?? lastLine.current ?? 1 });
  return <button ref={button} type="button" className="code-comment-add is-idle" hidden={!active} aria-label={label} title={line === null ? undefined : label} onFocus={onFocus} onBlur={onBlur} onKeyDown={onKeyDown} onPointerDown={(event) => { pressedBy.current = event.pointerType; }} onClick={onClick}>
    <MessageSquarePlus aria-hidden="true" />
  </button>;
});
