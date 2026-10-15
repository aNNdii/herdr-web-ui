/**
 * The app's own selection over rendered Markdown, for a finger in the comment mode (the Markdown comment layer,
 * MarkdownComments.tsx: the file viewer's preview and the chat's replies). A page cannot keep the system's selection without its Copy / Share
 * menu, which would cover the text, so while `enabled` (the mode on, and a coarse primary pointer):
 *
 * - The surface carries `TOUCH_SELECT_ATTRIBUTE`, under which the commentable roots take `user-select: none` and
 *   `-webkit-touch-callout: none` (MarkdownComments.css, FileViewer.css): one attribute, so a root mounted later (a chat
 *   row the list draws as it scrolls) is covered too. Their `contextmenu` and `selectstart` are cancelled.
 * - A press resting `TOUCH_HOLD_MS` within `TOUCH_SLOP_PX` (lib/touchSelection.ts `holdStep`; any pointer, so a mouse on
 *   such a device selects as a finger does) selects the word under it (`caretPositionFromPoint`, else
 *   `caretRangeFromPoint`; `wordBounds`), with a 10 ms tick where the device can. A move before that is a scroll and
 *   selects nothing. Moving on without lifting extends the selection by words (the page does not scroll meanwhile: the
 *   touch's `touchmove` is cancelled), and the click its lift brings is swallowed (a link under it stays shut). A move
 *   that reaches no other word changes nothing, and draws nothing again.
 * - Two handles (a 2 px `--accent` bar with a 12 px knob, above the start and below the end, a 44 px target with
 *   `touch-action: none`) move the ends (`moveEdge`): crossing swaps them. Positions come only from commentable text
 *   (lib/commentSelection.ts `partTextNodes`): offsets count those text nodes end to end.
 * - The selection is drawn as `comment-touch-selection` (`--term-selection`), never the system's.
 * - Comment, its one action, a 40 px pill (`MessageSquarePlus`; the look of the Comment button a pointer gets,
 *   SelectionButton.tsx), sits above the selection, else below the end handle,
 *   once no finger moves it. A tap on it hands the selection, cut to commentable text (`clampSelection`), to `onComment`
 *   and drops it. A tap anywhere else drops it (a scroll does not), and so does `enabled` going false.
 *
 * The handles and the pill are drawn in `surface` (the scrolling element the roots are in), whose content they scroll
 * with; their root is comment UI (`MARKDOWN_COMMENTS_CLASS`), never text. It is a component of its own, which the layer
 * renders (MarkdownComments.tsx): the selection's state is its own, so a finger's drag renders it alone, never the host
 * (the chat, the file viewer).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MessageSquarePlus } from "lucide-react";

import { SharedRanges, TOUCH_SELECTION_HIGHLIGHT } from "../lib/commentHighlight.ts";
import { isCommentUi, MARKDOWN_COMMENTS_CLASS } from "../lib/commentDom.ts";
import { partTextNodes } from "../lib/commentSelection.ts";
import { useT } from "../lib/i18n.ts";
import { clampSelection, textRanges } from "../lib/markdownSelection.ts";
import { holdStep, moveEdge, pillTop, TOUCH_HOLD_MS, TOUCH_SLOP_PX, wordBounds, type HoldState } from "../lib/touchSelection.ts";

/** On the surface while the app's selection is its roots': no system selection, no callout there (MarkdownComments.css). */
export const TOUCH_SELECT_ATTRIBUTE = "data-touch-select";

/** The Comment pill's height, its gap over the selection, and how far under the last line it goes (clear of the end knob). */
const PILL_H = 40;
const PILL_GAP = 8;
const PILL_BELOW = 24;
/** How far the pill keeps from the surface's sides. */
const INSET_PX = 8;
/** How long after a long press's lift its click may still come. */
const CLICK_AFTER_LIFT_MS = 600;

/** The roots' commentable text nodes, end to end: offsets in it, and back. */
interface TextModel {
  offsetOf(node: Node, offset: number): number | null;
  /** the point at `offset`; at a boundary between two nodes the next one's start (`side` "start") or the previous one's end */
  pointAt(offset: number, side: "start" | "end"): [Text, number] | null;
}

function textModel(roots: readonly Element[]): TextModel {
  const nodes = roots.flatMap((root) => partTextNodes(root));
  const starts: number[] = [];
  let total = 0;
  for (const node of nodes) {
    starts.push(total);
    total += node.length;
  }
  const index = new Map<Node, number>(nodes.map((node, at) => [node, at]));
  return {
    offsetOf: (node, offset) => {
      const at = index.get(node);
      return at === undefined ? null : starts[at]! + Math.min(offset, nodes[at]!.length);
    },
    pointAt: (offset, side) => {
      for (let at = 0; at < nodes.length; at++) {
        const from = starts[at]!;
        const to = from + nodes[at]!.length;
        if (offset < from || offset > to) continue;
        if (side === "start" && offset === to && at + 1 < nodes.length && starts[at + 1] === to) continue;
        return [nodes[at]!, offset - from];
      }
      return null;
    },
  };
}

/**
 * The text position under a client point. The handles and the pill (`over`) are left out of the hit test: a handle's
 * target lies on the line it stands at, under the finger that moves it.
 */
function caretAt(x: number, y: number, over: HTMLElement | null): { node: Node; offset: number } | null {
  const doc = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
  over?.style.setProperty("pointer-events", "none");
  try {
    if (typeof doc.caretPositionFromPoint === "function") {
      const found = doc.caretPositionFromPoint(x, y);
      return found === null ? null : { node: found.offsetNode, offset: found.offset };
    }
    const range = document.caretRangeFromPoint?.(x, y) ?? null;
    return range === null ? null : { node: range.startContainer, offset: range.startOffset };
  } finally {
    over?.style.removeProperty("pointer-events");
  }
}

/** The range of the model's `start`–`end`. */
function rangeOf(model: TextModel, start: number, end: number): Range | null {
  const from = model.pointAt(start, "start");
  const to = model.pointAt(end, "end");
  if (from === null || to === null) return null;
  const range = document.createRange();
  range.setStart(...from);
  range.setEnd(...to);
  return range;
}

/** The selection's line boxes (client pixels), drawn ones only. */
const lineRects = (range: Range, roots: readonly Element[]): DOMRect[] =>
  textRanges(range, roots).flatMap((piece) => [...piece.getClientRects()]).filter((rect) => rect.width > 0 && rect.height > 0);

export interface TouchSelectionProps {
  /** the commentable roots, in document order (read as they are needed) */
  roots: () => readonly Element[];
  /** the comment mode on, with a coarse primary pointer */
  enabled: boolean;
  /** Comment tapped: the selection, cut to commentable text (read as of the last render) */
  onComment(range: Range): void;
  /** the scrolling element the roots are in, once it is there: the handles and the pill are drawn in it */
  surface: HTMLElement | null;
}

/** The app's selection (see the module comment): its handles and its pill, a portal into `surface`. */
export function TouchSelection({ roots, enabled, onComment, surface }: TouchSelectionProps): ReactNode {
  const t = useT();
  const latest = useRef({ roots, onComment });
  latest.current = { roots, onComment };
  // the selection (a live range: it follows the text's own changes), redrawn on each `version`
  const selection = useRef<Range | null>(null);
  const [version, setVersion] = useState(0);
  // a finger moves it (a hold extending, a handle dragged): no pill meanwhile
  const [moving, setMoving] = useState(false);
  const layer = useRef<HTMLDivElement | null>(null);

  const setSelection = useCallback((range: Range | null): void => {
    selection.current = range;
    setVersion((now) => now + 1);
  }, []);

  // a hold that selected: its moves extend the selection, not scroll the surface (set by the listeners' effect below)
  const touchMove = useRef<((event: TouchEvent) => void) | null>(null);
  const onSurfaceTouchMove = useCallback((event: TouchEvent): void => touchMove.current?.(event), []);
  // while it is enabled the surface takes the attribute (its roots take no system selection) and the `touchmove` listener:
  // not passive, so on the surface only (the roots' scroller, which every press that selects starts in), never the
  // document, where a listener that can block would make every touch on the page wait for the script before it scrolls.
  // The surface is a prop (the layer's state), so its element coming or changing binds anew
  useLayoutEffect(() => {
    if (!enabled || surface === null) return;
    surface.setAttribute(TOUCH_SELECT_ATTRIBUTE, "");
    surface.addEventListener("touchmove", onSurfaceTouchMove, { capture: true, passive: false });
    return () => {
      surface.removeAttribute(TOUCH_SELECT_ATTRIBUTE);
      surface.removeEventListener("touchmove", onSurfaceTouchMove, true);
    };
  }, [enabled, surface, onSurfaceTouchMove]);

  // off: the selection goes
  useEffect(() => {
    if (!enabled && selection.current !== null) setSelection(null);
  }, [enabled, setSelection]);

  useEffect(() => {
    if (!enabled) return;
    let state: HoldState = { kind: "idle" };
    let pointer: number | null = null;
    let timer = 0;
    // a press that, ending as a tap, drops the selection
    let dropOnTap = false;
    let tapFrom: { x: number; y: number } | null = null;
    // the word the hold selected (model offsets), which moving on extends from, and the selection's offsets as last set
    // (a move within the same word, or onto white space, sets nothing again)
    let word: [number, number] | null = null;
    let extended: [number, number] | null = null;
    let model: TextModel | null = null;
    let swallowUntil = 0;

    const inRoots = (target: EventTarget | null): boolean =>
      target instanceof Node && !isCommentUi(target) && latest.current.roots().some((root) => root.contains(target));
    const ours = (target: EventTarget | null): boolean => target instanceof Node && (layer.current?.contains(target) ?? false);
    const reset = (): void => {
      window.clearTimeout(timer);
      state = { kind: "idle" };
      pointer = null;
      word = null;
      extended = null;
    };
    /** The model's word under a client point. */
    const wordAt = (x: number, y: number): [number, number] | null => {
      const caret = caretAt(x, y, layer.current);
      if (caret === null || !(caret.node instanceof Text) || model === null) return null;
      const base = model.offsetOf(caret.node, 0);
      if (base === null) return null;
      const [from, to] = wordBounds(caret.node.data, caret.offset, document.documentElement.lang || undefined);
      return from === to ? null : [base + from, base + to];
    };
    const select = (): void => {
      if (state.kind !== "selecting") return;
      const at = tapFrom;
      model = textModel(latest.current.roots());
      const found = at === null ? null : wordAt(at.x, at.y);
      const range = found === null ? null : rangeOf(model, found[0], found[1]);
      if (found === null || range === null) {
        // nothing to select under it (white space between blocks): the press is a tap's, as far as the lift goes
        state = { kind: "idle" };
        return;
      }
      word = found;
      extended = found;
      dropOnTap = false;
      navigator.vibrate?.(10);
      setMoving(true);
      setSelection(range);
    };
    const extend = (x: number, y: number): void => {
      if (word === null || model === null) return;
      const to = wordAt(x, y);
      if (to === null) return;
      const start = Math.min(word[0], to[0]);
      const end = Math.max(word[1], to[1]);
      if (extended !== null && extended[0] === start && extended[1] === end) return;
      const range = rangeOf(model, start, end);
      if (range === null) return;
      extended = [start, end];
      setSelection(range);
    };

    const onDown = (event: PointerEvent): void => {
      // a new press: the lift's click came already, or never will (Android sends none after a long press)
      swallowUntil = 0;
      if (!event.isPrimary || ours(event.target)) return;
      reset();
      dropOnTap = selection.current !== null;
      tapFrom = { x: event.clientX, y: event.clientY };
      if (event.button !== 0 || !inRoots(event.target)) return;
      pointer = event.pointerId;
      state = holdStep(state, { type: "down", x: event.clientX, y: event.clientY }).state;
      timer = window.setTimeout(() => {
        state = holdStep(state, { type: "timer", x: 0, y: 0 }).state;
        select();
      }, TOUCH_HOLD_MS);
    };
    const onMove = (event: PointerEvent): void => {
      if (!event.isPrimary) return;
      if (tapFrom !== null && state.kind === "idle" && Math.hypot(event.clientX - tapFrom.x, event.clientY - tapFrom.y) > TOUCH_SLOP_PX) dropOnTap = false;
      if (event.pointerId !== pointer) return;
      const step = holdStep(state, { type: "move", x: event.clientX, y: event.clientY });
      state = step.state;
      if (step.action === "cancel") {
        // a scroll: it keeps the selection
        reset();
        dropOnTap = false;
      } else if (step.action === "extend") extend(event.clientX, event.clientY);
    };
    const onUp = (event: PointerEvent): void => {
      if (!event.isPrimary) return;
      const step = event.pointerId === pointer ? holdStep(state, { type: "up", x: event.clientX, y: event.clientY }) : { action: "none" as const };
      const tap = dropOnTap;
      reset();
      tapFrom = null;
      dropOnTap = false;
      if (step.action === "end") {
        swallowUntil = performance.now() + CLICK_AFTER_LIFT_MS;
        setMoving(false);
      } else if (tap) setSelection(null);
    };
    const onCancel = (event: PointerEvent): void => {
      if (event.pointerId !== pointer) return;
      const held = state.kind === "selecting";
      reset();
      dropOnTap = false;
      if (held) setMoving(false);
    };
    // bound to the surface above
    touchMove.current = (event: TouchEvent): void => {
      if (state.kind === "selecting" && event.cancelable) event.preventDefault();
    };
    const onClick = (event: MouseEvent): void => {
      if (performance.now() > swallowUntil) return;
      swallowUntil = 0;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    // no system menu and no system selection on the text while the app's selection is theirs
    const onMenu = (event: Event): void => {
      if (inRoots(event.target)) event.preventDefault();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointermove", onMove, { capture: true, passive: true });
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("pointercancel", onCancel, true);
    window.addEventListener("click", onClick, true);
    document.addEventListener("contextmenu", onMenu, true);
    document.addEventListener("selectstart", onMenu, true);
    return () => {
      reset();
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerup", onUp, true);
      document.removeEventListener("pointercancel", onCancel, true);
      touchMove.current = null;
      window.removeEventListener("click", onClick, true);
      document.removeEventListener("contextmenu", onMenu, true);
      document.removeEventListener("selectstart", onMenu, true);
      setMoving(false);
    };
  }, [enabled, setSelection]);

  // the selection drawn in the app's selection colour
  const drawn = useRef<SharedRanges | null>(null);
  useLayoutEffect(() => {
    drawn.current ??= new SharedRanges(TOUCH_SELECTION_HIGHLIGHT);
    const range = selection.current;
    drawn.current.set(range === null ? [] : textRanges(range, latest.current.roots()));
  }, [version]);
  useEffect(() => () => drawn.current?.set([]), []);

  /** Places the handles and the pill at the selection, in the surface's content. */
  const place = useCallback((): void => {
    const node = layer.current;
    const body = surface;
    const range = selection.current;
    if (node === null || body === null || range === null) return;
    const rects = lineRects(range, latest.current.roots());
    node.toggleAttribute("hidden", rects.length === 0);
    if (rects.length === 0) return;
    const outer = body.getBoundingClientRect();
    const origin = { left: outer.left + body.clientLeft - body.scrollLeft, top: outer.top + body.clientTop - body.scrollTop };
    const first = rects[0]!;
    const last = rects[rects.length - 1]!;
    const start = node.querySelector<HTMLElement>("[data-edge='start']");
    const end = node.querySelector<HTMLElement>("[data-edge='end']");
    // the start's handle stands on its line's bottom and reaches up (its knob over the line); the end's hangs from its top
    for (const [handle, x, top, height] of [[start, first.left, first.bottom, first.height], [end, last.right, last.top, last.height]] as const) {
      if (handle === null) continue;
      handle.style.left = `${x - origin.left}px`;
      handle.style.top = `${top - origin.top}px`;
      handle.style.setProperty("--line-h", `${height}px`);
    }
    const pill = node.querySelector<HTMLElement>(".markdown-touch-comment");
    if (pill === null) return;
    const top = Math.min(...rects.map((rect) => rect.top)) - origin.top;
    const bottom = Math.max(...rects.map((rect) => rect.bottom)) - origin.top;
    pill.style.top = `${pillTop({ first: top, last: bottom, view: body.scrollTop, height: PILL_H, gap: PILL_GAP, below: PILL_BELOW })}px`;
    const middle = (Math.min(...rects.map((rect) => rect.left)) + Math.max(...rects.map((rect) => rect.right))) / 2 - origin.left;
    const lowest = body.scrollLeft + INSET_PX;
    const highest = body.scrollLeft + body.clientWidth - pill.offsetWidth - INSET_PX;
    pill.style.left = `${Math.max(lowest, Math.min(highest, middle - pill.offsetWidth / 2))}px`;
  }, [surface]);
  useLayoutEffect(place);
  const shown = enabled && selection.current !== null;
  useEffect(() => {
    const body = surface;
    if (!shown || body === null) return;
    const resized = new ResizeObserver(place);
    resized.observe(body);
    if (body.firstElementChild !== null) resized.observe(body.firstElementChild);
    return () => resized.disconnect();
  }, [shown, surface, place]);

  /** A handle's drag: the finger keeps its distance from the end it moves; the ends swap as they cross. */
  const drag = useRef<{ pointer: number; edge: "start" | "end"; dx: number; dy: number; model: TextModel } | null>(null);
  const onHandleDown = (event: ReactPointerEvent<HTMLElement>): void => {
    const range = selection.current;
    const edge = event.currentTarget.dataset.edge === "start" ? "start" : "end";
    if (range === null) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rects = lineRects(range, latest.current.roots());
    const line = edge === "start" ? rects[0] : rects[rects.length - 1];
    if (line === undefined) return;
    const x = edge === "start" ? line.left : line.right;
    drag.current = { pointer: event.pointerId, edge, dx: x - event.clientX, dy: line.top + line.height / 2 - event.clientY, model: textModel(latest.current.roots()) };
    setMoving(true);
  };
  const onHandleMove = (event: ReactPointerEvent<HTMLElement>): void => {
    const now = drag.current;
    const range = selection.current;
    if (now === null || range === null || event.pointerId !== now.pointer) return;
    const caret = caretAt(event.clientX + now.dx, event.clientY + now.dy, layer.current);
    const to = caret === null ? null : now.model.offsetOf(caret.node, caret.offset);
    const start = now.model.offsetOf(range.startContainer, range.startOffset);
    const end = now.model.offsetOf(range.endContainer, range.endOffset);
    if (to === null || start === null || end === null) return;
    const moved = moveEdge(start, end, now.edge, to);
    now.edge = moved.edge;
    if (moved.start === start && moved.end === end) return;
    const next = rangeOf(now.model, moved.start, moved.end);
    if (next !== null) setSelection(next);
  };
  const onHandleUp = (event: ReactPointerEvent<HTMLElement>): void => {
    if (drag.current?.pointer !== event.pointerId) return;
    drag.current = null;
    setMoving(false);
  };

  const comment = (): void => {
    const range = selection.current;
    if (range === null) return;
    const clamped = clampSelection(range, latest.current.roots());
    setSelection(null);
    if (clamped !== null) latest.current.onComment(clamped);
  };

  if (!shown || surface === null) return null;
  const handle = (edge: "start" | "end"): ReactNode => <span key={edge} className="markdown-touch-handle" data-edge={edge} aria-hidden="true"
    onPointerDown={onHandleDown} onPointerMove={onHandleMove} onPointerUp={onHandleUp} onPointerCancel={onHandleUp}>
    <span className="markdown-touch-knob" />
  </span>;
  return createPortal(<div ref={layer} className={`${MARKDOWN_COMMENTS_CLASS} markdown-touch-layer`}>
    {handle("start")}
    {handle("end")}
    {!moving && <button type="button" className="markdown-comment-pill markdown-touch-comment" onClick={comment}>
      <MessageSquarePlus aria-hidden="true" />
      {t("Comment")}
    </button>}
  </div>, surface);
}
