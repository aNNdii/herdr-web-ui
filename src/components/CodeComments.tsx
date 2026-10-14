/**
 * The code view's comments, as in Claude's code preview (FileViewer uses it instead of the pin layer while the code
 * shows). Commenting is a mode the viewer's header turns on (`codeCommentMode`); off, the code reads and selects as a
 * plain viewer and the cards are read-only.
 *
 * - A saved comment is a card under the last line it is on (`codeCommentRows`), in a row of the layer over the content.
 *   The line gets room below it as tall as its row (`setCommentRooms`: CSS, no text), so the `<pre>`'s text, a copy
 *   and a selection stay the file's. The rows are measured (`ResizeObserver`) and placed at most once a frame. A room
 *   changed lays out its line's chunk of the `<pre>` again (`.hl-chunk`, HighlightedCode.tsx) and moves every line and
 *   row below it, so the open field's room grows in one step at most while it is written (`fieldRoom`), and a pass
 *   that changes no room writes and reads nothing more.
 * - With a mouse or a pen, the ⊕ shows on the hovered line, centred on the divider (CodeCommentAdd.tsx); it opens the
 *   field under the line, on a new comment or the one there (`fileCommentAt`). With the mode on it is also one Tab stop:
 *   the arrow keys move it, and Enter opens the line's field in a row (never the sheet), which gives the focus back to
 *   the ⊕ as it closes. With Settings → File viewer → Click a
 *   line to comment, a plain click on a line (`isCommentClick`) opens it too, and a double click still selects a word.
 * - With a finger, a long press on a line or a tap (Settings → On mobile, comment with) opens it
 *   (CodeCommentTouch.tsx), and turning the mode by touch shows a hint under the header. Which applies is decided per
 *   press by its `pointerType`, not by the screen.
 * - The field is `CommentPopover` in place of the card (`row`), its rules those of every comment popover
 *   (`useCommentPopover`): one at a time, nothing typed lost. One a finger opened is the bottom sheet (`sheet`, with
 *   the line quoted) unless Settings → On mobile, write comments in says Below the line; there the row's text is at
 *   least `--fs-input`, so iOS does not zoom.
 * - What each comment is on is highlighted (`useFileCommentHighlights`), the line of a new one as pending.
 */
import { Fragment, memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type PointerEvent as ReactPointerEvent, type ReactElement, type ReactNode, type RefObject } from "react";
import { Trash2 } from "lucide-react";

import "./CodeComments.css";

import { blockComments, isReplyComment } from "../lib/blockComments.ts";
import { clickFacts, isCommentClick, isDismissingPress } from "../lib/commentClick.ts";
import { COMMENT_ROOM_ATTR, lineAt, lineElement, lineElementIndex, originOf, setCommentRooms, textRows } from "../lib/codeCommentDom.ts";
import { codeCommentRows } from "../lib/codeCommentRows.ts";
import { CODE_COMMENTS_CLASS, FIELD_SLOT_CLASS, focusOpenField } from "../lib/commentDom.ts";
import { FRAMED_CODE_FIELD } from "../lib/frameField.ts";
import { activateComment, PENDING_COMMENT_ID } from "../lib/commentHighlight.ts";
import { focusAfter } from "../lib/commentPins.ts";
import { popoverEscape } from "../lib/commentPopover.ts";
import { fileCommentAt, type FileComment, type FileTarget, type LineRange } from "../lib/fileComments.ts";
import { useT } from "../lib/i18n.ts";
import { useSettings } from "../lib/settings.ts";
import { useMediaQuery } from "../lib/useMediaQuery.ts";
import { CodeCommentAdd, type AddPress } from "./CodeCommentAdd.tsx";
import { CodeCommentHint, useCodeCommentPress, useModeHint } from "./CodeCommentTouch.tsx";
import { CommentPopover, type PopoverPlacement } from "./CommentPopover.tsx";
import { FieldFrameContext, FRAME_HOST_CLASS, slotSized, useFieldFrame } from "./FrameField.tsx";
import { linesTarget, targetOf, useFileCommentHighlights, type FileCommentScope, type FileComments, type FileHighlightWatcher } from "./FileComments.tsx";
import { useCommentPopover } from "./useCommentPopover.ts";

export interface CodeCommentsOptions {
  /** the file's scope while the code view shows it with line elements; null: no comments here */
  scope: FileCommentScope | null;
  /** the file's comments as placed (`useFileComments`) */
  comments: FileComments;
  /** the viewer's scrolling body and the code's <pre> */
  surface: RefObject<HTMLDivElement | null>;
  content: RefObject<HTMLPreElement | null>;
  /** where the focus goes when a Delete leaves no card (the header's comment-mode toggle; null: it is let go) */
  focusFallback: () => HTMLElement | null;
}

/** Bound once: a class method handed on loses its `this`. */
const persistFile = blockComments.saveFile.bind(blockComments);
const NO_ROOMS: ReadonlyMap<number, number> = new Map();

// a card the pointer is over, or whose text button the keyboard's focus is on, brings its comment's text up, as a pin does
// in the preview (CommentPins.tsx): the same `activateComment`, so no second highlight. Not a finger: a touch enters a card on
// every tap and every scroll that starts on it
const pointerOn = (event: ReactPointerEvent<HTMLElement>): void => {
  if (event.pointerType !== "touch") activateComment(event.currentTarget, "pointer", true);
};
const pointerOff = (event: ReactPointerEvent<HTMLElement>): void => activateComment(event.currentTarget, "pointer", false);

/** A saved comment's card in its row: `children` are its text and Delete. The card is the element the highlight reads the comment from (`data-comment-id`). */
function CodeCommentCard({ id, current, onOpen, children }: { id: string; current: boolean; onOpen: (() => void) | undefined; children: ReactNode }): ReactElement {
  const card = useRef<HTMLDivElement>(null);
  // a card that leaves (deleted, opened to edit, the mode turned off) gets no pointerleave or blur: release what it held
  // while it is still in the document, or its text stays up (React runs a layout cleanup before it removes the element)
  useLayoutEffect(() => {
    const node = card.current;
    return () => {
      if (node === null) return;
      activateComment(node, "pointer", false);
      activateComment(node, "focus", false);
    };
  }, []);
  const focusOn = (event: FocusEvent<HTMLElement>): void => {
    if (event.target instanceof HTMLElement && event.target.matches(".code-comment-text:focus-visible") && card.current !== null) activateComment(card.current, "focus", true);
  };
  const focusOff = (event: FocusEvent<HTMLElement>): void => {
    if (event.target instanceof HTMLElement && event.target.matches(".code-comment-text") && card.current !== null) activateComment(card.current, "focus", false);
  };
  return <div ref={card} className={current ? "code-comment-card is-current" : "code-comment-card"} data-comment-id={id} onClick={onOpen} onPointerEnter={pointerOn} onPointerLeave={pointerOff} onFocus={focusOn} onBlur={focusOff}>
    {children}
  </div>;
}

/** A row of the layer: the cards under `line`, and whether the open field goes after them (a new comment, or one without a card here). */
interface LayerRow {
  line: number;
  comments: FileComment[];
  field: boolean;
}

/**
 * The rooms `rows` (line to height) make, with no room the lines have now taken off or made smaller: a room that shrinks
 * as a press closes a field (its row gone, or left with its card) would change the lines' boxes between the press's
 * `pointerdown` and its `mousedown`, and Chrome then puts that press's caret or word selection at the start of the
 * code, not where it was. The settled pass in the next frame shrinks them, where the open field's line is kept in place.
 */
function keepingRooms(pre: HTMLElement, rows: ReadonlyMap<number, number>): Map<number, number> {
  const rooms = new Map(rows);
  for (const element of pre.querySelectorAll<HTMLElement>(`.hl-line[${COMMENT_ROOM_ATTR}]`)) {
    const line = Number(element.dataset["sourceLine"]);
    const now = parseFloat(element.style.getPropertyValue("--comment-room")) || 0;
    if ((rooms.get(line) ?? 0) < now) rooms.set(line, now);
  }
  return rooms;
}

/** The open field in a row of the layer: its textarea, or the slot of its frame (FrameField.tsx), which is as tall and has its cap. */
const FIELD_SELECTOR = ".comment-popover.is-row :is(.comment-editor-field, .comment-field-slot)";
const SLOT_SELECTOR = `.comment-popover.is-row .${FIELD_SLOT_CLASS}`;

/** The room held for the open field's row while it is written: on line `line`, for field `field`, `room` pixels. */
interface HeldRoom {
  line: number;
  field: HTMLElement;
  room: number;
}

/**
 * The room for the open field's row, `height` tall now, given what it held so far (`held`). Every room change lays out
 * its line's chunk again and moves the lines below it, so the pass goes on to read every row's line and place the rows,
 * the ⊕ and the press's tint again; a pass whose rooms are unchanged stops after measuring the rows (`place`). So that a
 * keystroke stays on that short path (the design spec's "Performance" has the measurements,
 * docs/superpowers/specs/2026-10-11-code-view-inline-comments-design.md), while the field is
 * written its room moves once at most: it starts as tall as the row, and the first time the row outgrows it, it takes
 * the row's height with the field at its cap (CommentPopover.css `.comment-editor-field` max-height; past it the field
 * scrolls). It never shrinks while the field is open: the row settles to its card's height once, as the field closes.
 */
function fieldRoom(held: HeldRoom | null, line: number, field: HTMLElement, height: number): HeldRoom {
  if (held === null || held.line !== line || held.field !== field) return { line, field, room: height };
  if (height <= held.room) return held;
  // the layout is clean here (the row was just measured): reading the field's box and style costs nothing more
  const cap = parseFloat(getComputedStyle(field).maxHeight);
  const full = Number.isFinite(cap) ? height - field.getBoundingClientRect().height + cap : height;
  return { line, field, room: Math.max(height, full) };
}

/** Whether two room maps (line to pixels) are the same. */
function sameRooms(a: ReadonlyMap<number, number>, b: ReadonlyMap<number, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [line, px] of a) if (b.get(line) !== px) return false;
  return true;
}

/** What the last pass wrote: the rows it placed, the rooms, and the rows' left and width (the `<pre>`'s). */
interface PlacedPass {
  rows: readonly HTMLElement[];
  rooms: ReadonlyMap<number, number>;
  left: number;
  width: number;
}

/**
 * The layer over the code: one row per line with cards (and the open field), placed in the room after its line, the
 * ⊕, and a finger's press tint (`overlay`). Rows are measured as they render (rooms only added or grown
 * then, `keepingRooms`) and in the next frame, and when they or the `<pre>` resize, at most once a frame; each pass
 * writes the rooms once (`setCommentRooms`), which in a frame also takes the room off a line that lost its row.
 * A pass that only a row's resize asked for and that changes no room (the open field's text, mostly: `fieldRoom`)
 * stops after measuring the rows: the lines did not move, so the rows' tops, the ⊕ and the press's tint stand.
 */
const CodeCommentLayer = memo(function CodeCommentLayer({ surface, pre, rows, mode, openLine, currentId, field, overlay, onAdd, onOpen, onDelete, onPlaced, layerRef }: {
  surface: RefObject<HTMLDivElement | null>;
  pre: HTMLElement;
  rows: readonly LayerRow[];
  /** the comment mode is on: a card opens to edit and has its Delete, and the ⊕ is there (a Tab stop, shown on a hovered or keyboard line) */
  mode: boolean;
  /** the line of the open field the ⊕ rests on: none for a finger's (its line has the held band; a finger has no ⊕) */
  openLine: number | null;
  /** the card the composer's walk stands on */
  currentId: string | null;
  /** the open comment's field, drawn in place of its card or after the row's cards (`touch`: a finger opened it); null with none open */
  field: { commentId: string | null; touch: boolean; node: ReactNode } | null;
  /** what else lies in the layer: the press's tint and the held line's band (CodeCommentTouch.tsx) */
  overlay: ReactNode;
  onAdd: (line: number, press: AddPress) => void;
  onOpen: (comment: FileComment) => void;
  onDelete: (comment: FileComment) => void;
  /** after each pass: the press's tint follows the lines */
  onPlaced: () => void;
  layerRef: RefObject<HTMLDivElement | null>;
}) {
  const t = useT();
  // a card's text names it for its Delete (`aria-describedby`): cards of one line read alike otherwise
  const textIds = useId();
  const placeAdd = useRef<() => void>(() => {});
  const register = useCallback((place: () => void): void => { placeAdd.current = place; }, []);
  // the row field's frame (FrameField.tsx): made once the mode is on, kept while the layer is, placed over the field's slot
  const frameHost = useRef<HTMLDivElement>(null);
  const placeNow = useRef<() => void>(() => {});
  const fieldFrame = useFieldFrame(frameHost, mode && FRAMED_CODE_FIELD, surface, placeNow);

  // the open field's room while it is written (`fieldRoom`), and what the last pass wrote
  const heldRoom = useRef<HeldRoom | null>(null);
  const lastPass = useRef<PlacedPass | null>(null);

  /**
   * Places the rows. `pass`:
   * - `"render"`: in the commit that draws them (or sizes the open field), in full; rooms are only added or grown
   *   (`keepingRooms`).
   * - `"frame"`: in a frame, settled: also shrinks rooms and takes them off lines without a row; a pass that would write the rooms the
   *   last one wrote, for the same rows, stops there.
   * - `"resized"`: in a frame after the `<pre>` resized: settled, in full.
   */
  const place = useCallback((pass: "render" | "frame" | "resized"): void => {
    const settled = pass !== "render";
    const body = surface.current;
    const layer = layerRef.current;
    if (body === null || layer === null) return;
    const placed = [...layer.querySelectorAll<HTMLElement>(":scope > .code-comment-row")];
    // reads and writes kept apart: the rows' width, their heights, the rooms, the lines' places, the rows' tops
    const box = pre.getBoundingClientRect();
    const left = box.left - originOf(body).left;
    const rowLeft = `${left}px`;
    const rowWidth = `${box.width}px`;
    for (const row of placed) {
      if (row.style.left !== rowLeft) row.style.left = rowLeft;
      if (row.style.width !== rowWidth) row.style.width = rowWidth;
    }
    const rooms = new Map<number, number>();
    let held: HeldRoom | null = null;
    for (const row of placed) {
      const line = Number(row.dataset.line);
      const height = row.getBoundingClientRect().height;
      const field = row.querySelector<HTMLElement>(FIELD_SELECTOR);
      if (field === null) {
        rooms.set(line, height);
        continue;
      }
      // a frame's slot not sized yet: its field is drawn in the next commit (FrameField.tsx), which places the rows again
      // then; until that its line keeps the room it has, so its chunk of the <pre> is laid out once for the opening, not twice
      if (field.classList.contains(FIELD_SLOT_CLASS) && !slotSized(field)) continue;
      held = fieldRoom(heldRoom.current, line, field, height);
      rooms.set(line, held.room);
    }
    heldRoom.current = held;
    // the open field's slot in its row (read with the rows, before they move): the frame goes over it once the rows are placed
    let slotAt: { row: HTMLElement; dy: number; dx: number; width: number } | null = null;
    for (const row of placed) {
      const slot = row.querySelector<HTMLElement>(SLOT_SELECTOR);
      if (slot === null) continue;
      const at = slot.getBoundingClientRect();
      const rowBox = row.getBoundingClientRect();
      slotAt = { row, dy: at.top - rowBox.top, dx: at.left - rowBox.left, width: at.width };
      break;
    }
    const placeFrame = (): void => {
      if (slotAt === null) return;
      if (slotAt.row.hidden) fieldFrame.place(null);
      else fieldFrame.place((parseFloat(slotAt.row.style.top) || 0) + slotAt.dy, left + slotAt.dx, slotAt.width);
    };
    const wanted = settled ? rooms : keepingRooms(pre, rooms);
    const last = lastPass.current;
    // When rooms above the open field's line shrink or go (a field closed there as this one opened), the body scrolls up
    // by as much, so that line stays where it was clicked; at the very top of the file, what it cannot scroll moves it
    const fieldRow = placed.find((row) => row.querySelector(FIELD_SELECTOR) !== null) ?? null;
    const anchorLine = fieldRow === null ? null : Number(fieldRow.dataset.line);
    let anchor: HTMLElement | null = null;
    let anchorTop = 0;
    if (settled && anchorLine !== null && last !== null) {
      let gone = false;
      for (const [line, px] of last.rooms) if (line < anchorLine && px > (wanted.get(line) ?? 0)) gone = true;
      // its own room's box both before and after (a line without one is measured by its text, a few px apart)
      const element = lineElement(pre, anchorLine);
      if (gone && element !== null && element.hasAttribute(COMMENT_ROOM_ATTR) && wanted.has(anchorLine)) {
        anchor = element;
        anchorTop = element.getBoundingClientRect().top;
      }
    }
    if (pass === "frame" && last !== null && last.left === left && last.width === box.width && sameRooms(last.rooms, wanted)
      && last.rows.length === placed.length && last.rows.every((row, index) => row === placed[index])) {
      placeFrame();
      return;
    }
    setCommentRooms(pre, wanted);
    lastPass.current = { rows: placed, rooms: wanted, left, width: box.width };
    if (anchor !== null) {
      const moved = anchor.getBoundingClientRect().top - anchorTop;
      if (Math.abs(moved) >= 1) body.scrollTop += moved;
    }
    // after the rooms: the body may have kept its view by scrolling (scroll anchoring)
    const origin = originOf(body);
    const elementOf = placed.length === 0 ? null : lineElementIndex(pre);
    // every line read before any row is written: a row's write between two reads would lay the page out again per row
    const bottoms = placed.map((row) => {
      const element = elementOf?.(Number(row.dataset.line)) ?? null;
      return element === null ? null : textRows(element)?.bottom ?? null;
    });
    placed.forEach((row, index) => {
      const bottom = bottoms[index] ?? null;
      row.hidden = bottom === null;
      if (bottom !== null) row.style.top = `${bottom - origin.top}px`;
    });
    placeFrame();
    placeAdd.current();
    onPlaced();
  }, [surface, layerRef, pre, onPlaced, fieldFrame]);
  placeNow.current = () => place("render");

  // placed in the commit that draws them, before they paint, and settled in the next frame; a row that grew (a field's
  // text, a wrap) or the <pre> that resized (the viewer, a font) is placed again in the next frame, in full (`resized`)
  // only when the <pre> resized
  const frame = useRef(0);
  const forced = useRef(false);
  const schedule = useCallback((preResized: boolean): void => {
    if (preResized) forced.current = true;
    if (frame.current !== 0) return;
    frame.current = window.requestAnimationFrame(() => {
      frame.current = 0;
      const full = forced.current;
      forced.current = false;
      place(full ? "resized" : "frame");
    });
  }, [place]);
  useLayoutEffect(() => {
    place("render");
    schedule(false);
  });
  // two observers: a new one reports each target once, and the rows' come and go with every opening, save and delete,
  // where the <pre>'s report would force a full pass for nothing
  useEffect(() => {
    const resized = new ResizeObserver(() => schedule(true));
    resized.observe(pre);
    return () => resized.disconnect();
  }, [pre, schedule]);
  useEffect(() => {
    const layer = layerRef.current;
    if (layer === null) return;
    const resized = new ResizeObserver(() => schedule(false));
    for (const row of layer.querySelectorAll(":scope > .code-comment-row")) resized.observe(row);
    return () => resized.disconnect();
  }, [rows, field, schedule, layerRef]);
  useEffect(() => () => {
    window.cancelAnimationFrame(frame.current);
    frame.current = 0;
  }, []);
  // gone (comments off, another view): no line keeps a room
  useEffect(() => () => {
    setCommentRooms(pre, NO_ROOMS);
    lastPass.current = null;
    heldRoom.current = null;
  }, [pre]);

  return <FieldFrameContext.Provider value={FRAMED_CODE_FIELD ? fieldFrame : null}><div ref={layerRef} className={mode ? `${CODE_COMMENTS_CLASS} is-mode` : CODE_COMMENTS_CLASS}>
    {/* a static child: React never moves it, so the frame in it is never moved in the document (iOS raises its keyboard
        only for a field it already had). First: React sets its ref before the rows' layout effects run in a commit (in
        tree order), so a row's field finds the host in the layer's first commit (FrameField.tsx `ensure`). Drawn over
        the rows by its z-index (CodeComments.css) */}
    {FRAMED_CODE_FIELD && <div ref={frameHost} className={FRAME_HOST_CLASS} />}
    {rows.map((row) => {
      // a finger's field below the line takes text at least --fs-input (CodeComments.css)
      const touchField = field !== null && field.touch && (row.field || row.comments.some((comment) => comment.id === field.commentId));
      return <div key={row.line} className={touchField ? "code-comment-row is-touch" : "code-comment-row"} data-line={row.line}>
        {row.comments.map((comment) => field !== null && field.commentId === comment.id ? <Fragment key={comment.id}>{field.node}</Fragment>
          // with the mode on a card opens to edit (its text is the button a keyboard reaches) and has its Delete; off, it is read-only
          : <CodeCommentCard key={comment.id} id={comment.id} current={comment.id === currentId} onOpen={mode ? () => onOpen(comment) : undefined}>
            {/* the line is in the names: a card is read out of its row, and several can stack */}
            {mode ? <button type="button" id={`${textIds}-${comment.id}`} className="code-comment-text" aria-label={t("Comment on line {line}: {comment}", { line: row.line, comment: comment.comment })}>{comment.comment}</button> : <div className="code-comment-text">{comment.comment}</div>}
            {mode && <button type="button" className="icon-button code-comment-delete" aria-label={t("Delete comment on line {line}", { line: row.line })} aria-describedby={`${textIds}-${comment.id}`} title={t("Delete comment on line {line}", { line: row.line })} onClick={(event) => { event.stopPropagation(); onDelete(comment); }}>
              <Trash2 aria-hidden="true" />
            </button>}
          </CodeCommentCard>)}
        {row.field && field !== null && field.node}
      </div>;
    })}
    <CodeCommentAdd surface={surface} pre={pre} active={mode} openLine={openLine} onAdd={onAdd} register={register} />
    {overlay}
  </div></FieldFrameContext.Provider>;
});

/**
 * The code view's comment layer (see the module comment) for `scope`'s file.
 * - `layer` goes into the viewer's body after its content.
 * - `escape` is the viewer's Escape asked first (`popoverEscape`): it closes an open field with its text unchanged and
 *   gives a changed one the focus back, true either way.
 * - `stop` is the composer's walk at comment `id`: its card (or the row of its open field) scrolled to and marked
 *   current until the next click, and opened while the mode is on, as a finger opens it on a touch screen (the sheet
 *   or the row); false while it has no card.
 * - `toggleMode` is the header toggle's press, with the `pointerType` that pressed it (a finger's shows the hint).
 */
export function useCodeComments({ scope, comments, surface, content, focusFallback }: CodeCommentsOptions): {
  layer: ReactNode;
  /** the code's comments are shown: the viewer's body is a comment surface (`data-comment-surface`), so a card brings its text up as a pin does */
  shown: boolean;
  escape: () => boolean;
  stop: (id: string) => boolean;
  toggleMode: (pointerType: string) => void;
} {
  const t = useT();
  const { settings, update } = useSettings();
  const mode = settings.codeCommentMode;
  // a walk's stop has no pointer event: a touch screen's is a finger's opening (the sheet, or the row at --fs-input)
  const coarse = useMediaQuery("(pointer: coarse)");
  const coarseRef = useRef(coarse);
  coarseRef.current = coarse;
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;
  // the id the open comment's save gave it: an edit with a changed text is stored under a new id, and its card is where the
  // focus goes back to
  const savedId = useRef<string | null>(null);
  const persist = useCallback((owner: string, target: FileTarget, comment: string): void => { savedId.current = persistFile(owner, target, comment); }, []);
  const { open, show, save, remove, close, text } = useCommentPopover<FileTarget>({ persist, enabled: settings.comments });
  const layerRef = useRef<HTMLDivElement>(null);
  // read by the handlers, which outlive the render that made them
  const latest = useRef({ scope, comments, mode, lineClick: settings.codeCommentLineClick, gesture: settings.mobileCommentGesture, open, focusFallback });
  latest.current = { scope, comments, mode, lineClick: settings.codeCommentLineClick, gesture: settings.mobileCommentGesture, open, focusFallback };

  // an open comment of this file and view is drawn in the layer; one opened before the view moved on (another file, the
  // preview) as a dialog, with what was typed
  const here = open !== null && scope !== null && open.owner === scope.owner && open.target.path === scope.path && open.target.view === scope.view;
  // the line of the open comment's card (the last line it is on now), or of a new one
  const openLineNumber = !here ? null
    : open.commentId === null ? open.target.lines[1]
    : comments.shown.find(({ comment }) => comment.id === open.commentId)?.lines[1] ?? open.target.lines[1];
  // whether a finger opened the open comment: then it is the sheet, or a row with --fs-input text (Settings)
  const [touchOpened, setTouchOpened] = useState(false);
  // whether the ⊕ was pressed with a key: the field then gives the focus back to the ⊕ as it closes
  const [keyOpened, setKeyOpened] = useState(false);
  // the field is closed: the next one is a pointer's or a finger's until a key says otherwise (the closing field has its
  // opener already: `useCommentDraft` reads it once, as it opens)
  const fieldOpen = open !== null;
  useEffect(() => { if (!fieldOpen) setKeyOpened(false); }, [fieldOpen]);
  const touched = here && touchOpened;
  const sheet = touched && settings.mobileCommentInput === "sheet";

  // highlights, and the line a new comment is being written on as pending
  const watcher = useRef<FileHighlightWatcher | null>(null);
  // no focus mode here: a card's hover or focus must not toggle an attribute on the body, which restyles every line of a long file
  const pre = useFileCommentHighlights(scope !== null, surface, content, comments.shown, watcher, false);
  const layerShown = settings.comments && scope !== null && pre !== null;
  const pending: LineRange | null = here && open.commentId === null ? open.target.lines : null;
  const pendingKey = pending === null ? "" : `${pending[0]}-${pending[1]}`;
  useLayoutEffect(() => {
    watcher.current?.setPending(pending === null ? null : { id: PENDING_COMMENT_ID, lines: pending });
  }, [pendingKey, pre]);

  /** Opens the field on `target` (`touch`: a finger opened it; `keyboard`: the ⊕ with a key), else (one with text typed keeps its place) gives that field the focus back. */
  const showOn = useCallback((owner: string, target: FileTarget, existing: { id: string; comment: string } | null, touch: boolean, keyboard = false): void => {
    if (show(owner, target, existing)) {
      savedId.current = null;
      setTouchOpened(touch);
      setKeyOpened(keyboard);
    } else focusOpenField(surface.current);
  }, [show, surface]);
  /** Opens line `line`'s field: the comment on all of it (`fileCommentAt`), else a new one; none past a cut file's last whole line. */
  const openLine = useCallback((line: number, touch = false, keyboard = false): void => {
    const current = latest.current.scope;
    if (current === null) return;
    const made = linesTarget(current, { lines: [line, line], quoteLines: [current.lines[line - 1] ?? ""] });
    if (made === null) return;
    const found = fileCommentAt(blockComments.list(made.owner).filter((c): c is FileComment => !isReplyComment(c)), made.target);
    if (found === undefined) showOn(made.owner, made.target, null, touch, keyboard);
    else showOn(made.owner, targetOf(found), { id: found.id, comment: found.comment }, touch, keyboard);
  }, [showOn]);
  /**
   * The ⊕'s press: a key's is a keyboard opening, in a row even on a touch screen; a finger's (on a ⊕ an iPad's trackpad
   * showed) opens the line as a finger's tap on it does.
   */
  const addLine = useCallback((line: number, press: AddPress): void => openLine(line, press === "touch", press === "keyboard"), [openLine]);
  /** Opens a card's comment on its own target (an edit replaces it, a range comment keeps its range). */
  const openComment = useCallback((comment: FileComment, touch = false): void => {
    const current = latest.current.scope;
    if (current !== null) showOn(current.owner, targetOf(comment), { id: comment.id, comment: comment.comment }, touch);
  }, [showOn]);
  /**
   * A card's Delete takes its button away: the focus goes on to the next card's text button, else the previous one's,
   * else `focusFallback` (the header's comment-mode toggle), once the commit has dropped the card.
   */
  const deleteComment = useCallback((comment: FileComment): void => {
    const current = latest.current.scope;
    if (current === null) return;
    const cards = [...(layerRef.current?.querySelectorAll<HTMLElement>(":scope > .code-comment-row .code-comment-card") ?? [])];
    const near = focusAfter(cards.map((card) => card.dataset["commentId"] ?? ""), comment.id);
    blockComments.remove(current.owner, [comment.id]);
    window.requestAnimationFrame(() => {
      const layer = layerRef.current;
      let card: HTMLElement | null = null;
      for (const id of near) {
        card = layer?.querySelector<HTMLElement>(`.code-comment-card[data-comment-id="${CSS.escape(id)}"] button.code-comment-text`) ?? null;
        if (card !== null) break;
      }
      (card ?? latest.current.focusFallback())?.focus();
    });
  }, []);

  // a finger's long press or tap on a line (CodeCommentTouch.tsx); the line it opened keeps its tint while open
  const openByTouch = useCallback((line: number): void => openLine(line, true), [openLine]);
  const press = useCodeCommentPress({
    surface, pre: layerShown ? pre : null, mode, gesture: settings.mobileCommentGesture, held: touched ? openLineNumber : null, onOpen: openByTouch,
  });
  const { pointer } = press;
  const openCard = useCallback((comment: FileComment): void => openComment(comment, pointer() === "touch"), [openComment, pointer]);
  // the mode on: the viewer's body says so, for the touch CSS (the code raises no callout, CodeComments.css)
  useEffect(() => {
    const body = surface.current;
    if (!layerShown || !mode || body === null) return;
    body.setAttribute("data-code-comments", "");
    return () => body.removeAttribute("data-code-comments");
  }, [layerShown, mode, surface]);

  // the mode turned off: an unchanged field closes, one with text typed stays until it is saved or emptied
  useEffect(() => {
    if (mode) return;
    if (popoverEscape(latest.current.open, text.read()) === "close") close();
  }, [mode, text, close]);

  // Click a line to comment: a mouse's or a pen's plain click on a line opens it (`isCommentClick`), and a double click
  // closes the new, unchanged field its first click opened, so it still selects a word. A press that dismissed an open
  // field (`isDismissingPress`) only did that. A finger's tap has its own way (Settings → On mobile, comment with)
  useEffect(() => {
    const body = surface.current;
    if (body === null) return;
    let dismissing = false;
    const onPress = (event: PointerEvent): void => { dismissing = isDismissingPress(event); };
    const onClick = (event: MouseEvent): void => {
      const dismissed = dismissing;
      dismissing = false;
      const { scope: current, mode: on, lineClick } = latest.current;
      const code = content.current;
      if (dismissed || current === null || !on || !lineClick || pointer() === "touch" || code === null || !(event.target instanceof Node) || !code.contains(event.target)) return;
      // (a double click's second press dismissed the unchanged field its first click opened: `dismissed` above)
      if (!isCommentClick(clickFacts(event))) return;
      const line = lineAt(code, event.target, event.clientY);
      if (line !== null) openLine(line);
    };
    body.addEventListener("pointerdown", onPress, true);
    body.addEventListener("click", onClick);
    return () => {
      body.removeEventListener("pointerdown", onPress, true);
      body.removeEventListener("click", onClick);
    };
  }, [surface, content, openLine, pointer]);

  // the card the composer's walk stands on, until the next click
  const [currentId, setCurrentId] = useState<string | null>(null);
  useEffect(() => {
    if (currentId === null) return;
    const clear = (): void => setCurrentId(null);
    document.addEventListener("click", clear, true);
    return () => document.removeEventListener("click", clear, true);
  }, [currentId]);

  const stop = useCallback((id: string): boolean => {
    const placed = latest.current.comments.shown.find(({ comment }) => comment.id === id);
    const card = layerRef.current?.querySelector<HTMLElement>(`.code-comment-card[data-comment-id="${CSS.escape(id)}"]`) ?? null;
    // its field open already takes the place of its card: the stop gives the field the focus back
    const fieldOpen = latest.current.open?.commentId === id;
    if (placed === undefined || (card === null && !fieldOpen)) return false;
    // a field open already stands in its row, which is the place to show
    const row = card !== null ? null : layerRef.current?.querySelector<HTMLElement>(`.code-comment-row[data-line="${placed.lines[1]}"]`);
    (card ?? row)?.scrollIntoView({ block: "center", behavior: reducedMotionRef.current ? "auto" : "smooth" });
    setCurrentId(id);
    if (latest.current.mode) openComment(placed.comment, coarseRef.current);
    return true;
  }, [openComment]);

  // turned by a finger, the hint says how to comment now, or that the mode is off; a mouse has the ⊕ to show the way
  const { hint, show: showHint } = useModeHint();
  const toggleMode = useCallback((pointerType: string): void => {
    const on = !latest.current.mode;
    update({ codeCommentMode: on });
    if (pointerType === "touch") showHint(on ? latest.current.gesture : "off");
  }, [update, showHint]);

  const escape = (): boolean => {
    const outcome = popoverEscape(open, text.read());
    if (outcome === "close") close();
    else if (outcome === "keep") focusOpenField(surface.current);
    return outcome !== "none";
  };

  // the rows: the cards under the last line each comment is on, and the open field's line (none for the sheet)
  const cardRows = useMemo(() => codeCommentRows(comments.shown), [comments.shown]);
  const fieldLine = sheet ? null : openLineNumber;
  const rows = useMemo<LayerRow[]>(() => {
    const withField = cardRows.map((row) => ({
      ...row,
      field: row.line === fieldLine && !row.comments.some((comment) => comment.id === open?.commentId),
    }));
    if (fieldLine !== null && !cardRows.some((row) => row.line === fieldLine)) {
      withField.push({ line: fieldLine, comments: [], field: true });
      withField.sort((a, b) => a.line - b.line);
    }
    return withField;
  }, [cardRows, fieldLine, open?.commentId]);

  /** The open comment's popover in `placement`: in its row, or the sheet, while it is of this file and view, else a dialog. */
  const popover = useCallback((placement: PopoverPlacement): ReactNode => {
    if (open === null) return null;
    const line = openLineNumber ?? open.target.lines[1];
    // a stored comment is named by the lines it is on now
    const lines: LineRange = open.commentId === null ? open.target.lines
      : comments.shown.find(({ comment }) => comment.id === open.commentId)?.lines ?? open.target.lines;
    // the sheet lies over the code: it quotes the line as the viewer shows it (its number, its coloured text: the line
    // element's own spans), and is named for assistive tech only
    const onSheet = placement === "sheet" && scope !== null;
    return <CommentPopover
      key={open.id}
      placement={placement}
      quote={onSheet ? { code: { line, text: scope.lines[line - 1] ?? "", source: pre === null ? null : lineElement(pre, line) } } : { text: open.target.quoteLines.join("\n") }}
      label={onSheet ? t("Comment on line {line}", { line }) : undefined}
      reference={{ path: open.target.path, lines }}
      comment={open.initialComment}
      startValue={text.read()}
      onText={text.write}
      onSave={save}
      onDelete={remove}
      onClose={close}
      // after the commit that closes it: the ⊕ if a key pressed it and it shows (the mode may have turned off), else the card that was edited, else the first card of its line, else nothing (the focus is let go)
      opener={() => {
        const layer = layerRef.current;
        const add = keyOpened ? layer?.querySelector<HTMLElement>(":scope > .code-comment-add") : null;
        if (add != null && !add.hidden) return add;
        const id = open.commentId === null ? null : savedId.current ?? open.commentId;
        const edited = id === null ? null : layer?.querySelector<HTMLElement>(`.code-comment-card[data-comment-id="${CSS.escape(id)}"] button.code-comment-text`);
        return edited ?? layer?.querySelector<HTMLElement>(`.code-comment-row[data-line="${line}"] button.code-comment-text`) ?? null;
      }}
      fallback={() => null}
      // the row and the sheet: the field in a frame of its own (FrameField.tsx); the dialog of another file's comment is not the code view's
      framed={FRAMED_CODE_FIELD && placement !== "dialog"}
    />;
  }, [open, openLineNumber, comments.shown, scope, pre, t, text, save, remove, close, keyOpened]);

  // kept while the opening and its line are: the layer is not drawn again for every render of the viewer
  const field = useMemo(() => here && !sheet ? { commentId: open.commentId, touch: touchOpened, node: popover("row") } : null, [here, sheet, open, touchOpened, popover]);
  const overlay = useMemo(() => <>
    <div ref={press.band} className="code-comment-held" aria-hidden="true" />
    <div ref={press.tint} className="code-comment-press" aria-hidden="true" />
  </>, [press.band, press.tint]);

  // one opened before the view moved on is a dialog, whether or not the layer is drawn
  const away = open !== null && !here ? popover("dialog") : null;
  let layer: ReactNode = away;
  if (layerShown) {
    layer = <>
      <CodeCommentLayer
        surface={surface}
        pre={pre}
        rows={rows}
        mode={mode}
        openLine={touched ? null : fieldLine}
        currentId={currentId}
        field={field}
        overlay={overlay}
        onAdd={addLine}
        onOpen={openCard}
        onDelete={deleteComment}
        onPlaced={press.place}
        layerRef={layerRef}
      />
      {/* beside the layer, not in it: the hint coming and going draws the layer again for nothing; it lies at the
          body's top left as the layer does (CodeComments.css `.code-comment-status`) */}
      <CodeCommentHint surface={surface} hint={hint} />
      {sheet && popover("sheet")}
      {away}
    </>;
  }
  return { layer, shown: layerShown, escape, stop, toggleMode };
}
