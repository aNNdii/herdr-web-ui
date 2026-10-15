/**
 * The margin of the Markdown comment layer (MarkdownComments.tsx): the comments shown on one text, beside it. It knows
 * nothing of the surface the text is on (the file viewer's preview, a reply of the chat): it is given the text's element
 * and its comments, each with the ranges its text is drawn in (`LayerComment.ranges()`), and measures those.
 *
 * - Where: in the free space right of the text, up to the surface's right edge (lib/commentMargin.ts `marginLayout`,
 *   from the text's content box and the surface's): the text is only measured, never moved or narrowed for the margin,
 *   which may lie outside the text's column (in the chat outside its row, ChatComments.tsx `ReplyMargin`).
 * - **Cards** (`layout` "cards"): one card per comment, in reading order, right of the text (`MARGIN_GAP`) and
 *   `MARGIN_W` wide, each level with the first line box of its text, pushed below the card above where it would overlap
 *   it, `CARD_GAP` apart (lib/commentMargin.ts `placeCards`): cards are only ever pushed down. A card shows its comment's
 *   text only. In the comment mode a click edits it (`onEdit`): the card is then the comment field (`renderField`), in
 *   its place and at the margin's width, and the cards below follow its growing at once. Its bin (`Trash2`, top right)
 *   shows on hover and on focus within, in the mode only, and deletes at once (`onDelete`). With the mode off a card is
 *   read-only: a click does nothing, and it has no bin.
 * - **Counts** (`layout` "counts"): a column `COUNT_W` wide, `COUNT_GAP` right of the text where the free space holds
 *   it (a finger's 44 px target included), else at the surface's right edge, its bubble clear of the text and its target
 *   over the free space only (`marginLayout`'s `target`, set on the margin as `--count-target-*`); one count per visual line
 *   where comments start (`groupCounts`; on a touch screen those whose targets would come too close merge). In the mode
 *   a click opens the fields of its comments (`onEdit` with all of them; the layer draws them over the first one's text)
 *   and a second click closes them (`onEdit([])`). With the mode off a click shows its comments as read-only cards
 *   beside it, and a second click or a press elsewhere hides them; a stop of the composer's walk there (`walkStop`) shows
 *   them as that click does, until the walk moves on or ends (a stop elsewhere: another reply's margin in the chat).
 * - A finger's tap on a card (in the mode) or a count (in the mode or not) opens the sheet instead (`onSheet`, the layer's
 *   MarkdownCommentSheet.tsx): each press acts by its own `pointerType`, so a mouse on a touch screen still edits in
 *   place. On a touch screen a count's target is 44 × 44 px at least (CommentMargin.css).
 * - The pointer over a card or a count, or the keyboard's focus on one, gives its comments' text the strong fill
 *   (lib/commentHighlight.ts `activateComment`: a card names its comment in `data-comment-id`, a count its several in
 *   `data-comment-ids`).
 *
 * Placing runs at most once per animation frame, after the text or a card is resized (`ResizeObserver`: a card in edit
 * growing pushes the cards below in the same frame), the text's DOM changes (`MutationObserver`), its fonts load, or the
 * surface's highlights are rebuilt (`watchSurfaceRanges`: a comment's ranges moved), and synchronously after each render.
 * Nothing is animated. The margin is absolutely placed in its offset parent (the scrolling surface, whose content it
 * scrolls with; in the chat a reply's row, which it overflows to the right, ChatComments.tsx `ReplyMargin`); its root
 * (`MARKDOWN_COMMENTS_CLASS`) is comment UI, never text.
 *
 * The layer and the walk reach the margins drawn in a surface only through `marginCardOrder`, `marginCardId`,
 * `marginPlace` and `marginFocusTarget` below: the margin's DOM (its selectors, how it leaves a card unplaced) is its own.
 * The margin is memoized: its props from the layer stay equal while nothing of it changed, so a render of the host (the
 * file viewer, a reply's row) does not place it again.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent as ReactFocusEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactElement, type ReactNode } from "react";
import { Trash2 } from "lucide-react";

import "./CommentMargin.css";

import { activateComment, COMMENT_SURFACE, watchSurfaceRanges } from "../lib/commentHighlight.ts";
import { MARKDOWN_COMMENTS_CLASS } from "../lib/commentDom.ts";
import { COUNT_INSET, COUNT_W, groupCounts, MARGIN_GAP, MARGIN_W, marginLayout, placeCards } from "../lib/commentMargin.ts";
import { useT } from "../lib/i18n.ts";
import type { CommentLayout } from "../lib/settings.ts";
import { useMediaQuery } from "../lib/useMediaQuery.ts";
import type { LayerComment } from "./MarkdownComments.tsx";

export interface CommentMarginProps {
  /** the comments shown on `text`; one whose text is not drawn now (no ranges) gets no card or count */
  comments: readonly LayerComment[];
  /** the text the margin is beside: the tops are its comments' first line boxes, relative to its top */
  text: HTMLElement;
  layout: CommentLayout;
  /** the comment mode: cards and counts edit; off, they are read-only */
  mode: boolean;
  /** opens the fields of these comments (a card's one, a count's all); none leaves the open ones */
  onEdit(ids: readonly string[]): void;
  /** a card's bin: deletes the comment at once */
  onDelete(id: string): void;
  /** a finger's tap on a card (in the mode) or a count: the layer opens these comments in its sheet */
  onSheet?(ids: readonly string[]): void;
  /** the comments whose fields (or sheet) are open: a card among them is drawn as its field if it has one; a count among them is open */
  editing: readonly string[];
  /** the field of the comment `id`, drawn in its card's place */
  renderField(id: string): ReactNode;
  /**
   * the composer's walk stopped at comment `id` with the mode off (each stop its own `opening`): its count, if it has one,
   * shows its comments as read-only cards, as a click on it does
   */
  walkStop?: { id: string; opening: number } | null;
  /**
   * told after each placing, before it is painted, how far down from the text's top the cards reach (0 with none; for
   * counts, a count's open read-only cards): a chat reply grows by what runs past its text (ChatComments.tsx `ReplyMargin`)
   */
  onExtent?(bottom: number): void;
}

/** A margin's card, and its text (a button in the mode: the card's focus); the cards of a count's read-only list are not. */
const CARD = ".comment-margin > .markdown-comment-card";
const CARD_TEXT = "button.markdown-comment-text";
/** A margin's count (`data-comment-ids`: its comments, in reading order). */
const COUNT = ".comment-margin .markdown-comment-count";

/** Whether the margin placed `card`: one whose text it could not measure as it placed the others is left hidden. */
const isPlaced = (card: HTMLElement): boolean => card.style.visibility !== "hidden";

const cardOf = (surface: Element, id: string): HTMLElement | null => surface.querySelector<HTMLElement>(`${CARD}[data-comment-id="${CSS.escape(id)}"]`);
const countOf = (surface: Element, id: string): HTMLElement | null =>
  [...surface.querySelectorAll<HTMLElement>(COUNT)].find((count) => countIds(count).includes(id)) ?? null;
const countIds = (count: HTMLElement): string[] => (count.dataset.commentIds ?? "").split(" ").filter((id) => id !== "");

/** The comments of the margins' cards in `surface`, placed or not, in document order (one margin's: reading order). */
export function marginCardOrder(surface: Element | null): string[] {
  return [...surface?.querySelectorAll<HTMLElement>(CARD) ?? []].flatMap((card) => card.dataset.commentId === undefined ? [] : [card.dataset.commentId]);
}

/** The comment of the margin's card `node` is in (a count's read-only cards are none), else null. */
export function marginCardId(node: Node | null): string | null {
  const element = node instanceof Element ? node : node?.parentElement ?? null;
  return element?.closest<HTMLElement>(CARD)?.dataset.commentId ?? null;
}

/**
 * Where comment `id` is beside its text in `surface`'s margins: its card (`layout` "cards"), placed, or its count, and
 * the comments drawn there (a count's all, in reading order). Null where it has none drawn, or its card is not placed.
 */
export function marginPlace(surface: Element | null, id: string, layout: CommentLayout): { box: HTMLElement; ids: readonly string[] } | null {
  if (surface === null) return null;
  if (layout === "counts") {
    const count = countOf(surface, id);
    return count === null ? null : { box: count, ids: countIds(count) };
  }
  const card = cardOf(surface, id);
  return card === null || !isPlaced(card) ? null : { box: card, ids: [id] };
}

/**
 * What takes the keyboard's focus for comment `id` in `surface`'s margins: its placed card's text button (in the mode;
 * read-only text takes none), or its count. Null where neither is drawn: a card left unplaced cannot take the focus.
 */
export function marginFocusTarget(surface: Element | null, id: string, layout: CommentLayout): HTMLElement | null {
  const place = marginPlace(surface, id, layout);
  if (place === null) return null;
  return layout === "counts" ? place.box : place.box.querySelector<HTMLElement>(CARD_TEXT);
}

/** Where a comment starts: the top of its text's first line box, relative to the text's top. */
interface Start { id: string; top: number; left: number }

const NO_STARTS: readonly Start[] = [];

/** Two tops this close are the same place: no new render for less. */
const SAME_TOP_PX = 0.5;

/** Where each of `comments` starts on `text`, in reading order (top to bottom, then left to right); those not drawn have none. */
function measureStarts(comments: readonly LayerComment[], text: HTMLElement): Start[] {
  const box = text.getBoundingClientRect();
  const starts: Start[] = [];
  for (const comment of comments) {
    for (const range of comment.ranges()) {
      const rect = [...range.getClientRects()].find((line) => line.width > 0 || line.height > 0);
      if (rect === undefined) continue;
      starts.push({ id: comment.id, top: rect.top - box.top, left: rect.left - box.left });
      break;
    }
  }
  return starts.sort((a, b) => Math.abs(a.top - b.top) > SAME_TOP_PX ? a.top - b.top : a.left - b.left);
}

const sameStarts = (a: readonly Start[], b: readonly Start[]): boolean =>
  a.length === b.length && a.every((start, index) => start.id === b[index]!.id && Math.abs(start.top - b[index]!.top) <= SAME_TOP_PX);

// the pointer over a card or a count, or the keyboard's focus on it: its comments' text comes up (not a finger's touch,
// which enters what it taps)
const pointerOn = (event: ReactPointerEvent<HTMLElement>): void => {
  if (event.pointerType !== "touch") activateComment(event.currentTarget, "pointer", true);
};
const pointerOff = (event: ReactPointerEvent<HTMLElement>): void => activateComment(event.currentTarget, "pointer", false);
const focusOn = (event: ReactFocusEvent<HTMLElement>): void => {
  if (event.target instanceof HTMLElement && event.target.matches(":focus-visible")) activateComment(event.currentTarget, "focus", true);
};
const focusOff = (event: ReactFocusEvent<HTMLElement>): void => {
  if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) activateComment(event.currentTarget, "focus", false);
};
const highlightProps = { onPointerEnter: pointerOn, onPointerLeave: pointerOff, onFocus: focusOn, onBlur: focusOff };

/** A card: the comment's text, and in the mode its bin; a click on it edits it there (`edit`; none: read-only). */
function Card({ comment, edit, remove, field, readOnly = false }: {
  comment: LayerComment;
  /** its click (the event says what pressed) */
  edit: ((event: ReactMouseEvent<HTMLElement>) => void) | null;
  remove: (() => void) | null;
  /** the comment's field, drawn instead while it is open */
  field: ReactNode;
  /** beside an open count (the mode off): floating over the text, not placed in the margin */
  readOnly?: boolean;
}): ReactElement {
  const t = useT();
  const editing = field !== null && field !== undefined && field !== false;
  const className = `markdown-comment-card${editing ? " is-editing" : ""}${readOnly ? " is-readonly" : ""}`;
  // a click anywhere on the card edits it, but on its bin
  const onClick = edit === null ? undefined : (event: ReactMouseEvent<HTMLElement>): void => {
    if (event.target instanceof Element && event.target.closest(".markdown-comment-delete") !== null) return;
    edit(event);
  };
  return <div className={className} data-comment-id={comment.id} onClick={editing ? undefined : onClick} {...highlightProps}>
    {editing ? field : <>
      {/* a button in the mode, for the keyboard (its name is the comment); text only with the mode off */}
      {edit === null
        ? <p className="markdown-comment-text">{comment.comment}</p>
        : <button type="button" className="markdown-comment-text">{comment.comment}</button>}
      {remove !== null && <button type="button" className="icon-button markdown-comment-delete" aria-label={t("Delete comment")} title={t("Delete comment")}
        onClick={(event) => { event.stopPropagation(); remove(); }}>
        <Trash2 aria-hidden="true" />
      </button>}
    </>}
  </div>;
}

/** The margin beside one text (see the module comment). */
export const CommentMargin = memo(function CommentMargin({ comments, text, layout, mode, onEdit, onDelete, onSheet, editing, renderField, walkStop = null, onExtent }: CommentMarginProps): ReactNode {
  const t = useT();
  const root = useRef<HTMLDivElement>(null);
  const [starts, setStarts] = useState<readonly Start[]>(NO_STARTS);
  // the count a click showed as read-only cards (the mode off), by its first comment; the walk's are derived below
  const [shown, setShown] = useState<string | null>(null);
  // the walk's stop (its `opening`) a click or a press elsewhere has left since: its count no longer shows for it
  const [walkLeft, setWalkLeft] = useState<number | null>(null);
  // a touch screen's counts merge where their targets would come too close (no press says which input: the device does)
  const touch = useMediaQuery("(pointer: coarse)");
  const latest = useRef({ comments, text, layout, onExtent, walkStop, coarse: touch });
  latest.current = { comments, text, layout, onExtent, walkStop, coarse: touch };
  // what pressed a card or a count last: a finger's tap opens the sheet, a mouse's or a pen's click edits in place
  const pressedBy = useRef("mouse");
  /** Whether `event`, a click, is a finger's tap the sheet takes (a keyboard's click, detail 0, is a mouse's). */
  const byFinger = (event: ReactMouseEvent<HTMLElement>): boolean => onSheet !== undefined && event.detail !== 0 && pressedBy.current === "touch";

  /** Places the margin beside the text, measures where each comment starts, and places the cards there. */
  const place = useCallback((): void => {
    const node = root.current;
    const { comments: shownComments, text: beside, layout: as, onExtent: extent } = latest.current;
    if (node === null || !beside.isConnected) return;
    // in the free space right of the text's content box (lib/commentMargin.ts `marginLayout`: the text is only measured,
    // never moved), level with its top, in the offset parent's scrolled content
    const box = beside.getBoundingClientRect();
    const style = getComputedStyle(beside);
    const textRight = box.right - Number.parseFloat(style.paddingRight) - Number.parseFloat(style.borderRightWidth);
    const container = beside.closest(`[${COMMENT_SURFACE}]`) ?? node.offsetParent;
    const outerBox = container?.getBoundingClientRect();
    const containerRight = container === null || outerBox === undefined ? Number.POSITIVE_INFINITY : outerBox.left + container.clientLeft + container.clientWidth;
    // the chat's minimap is left of the text (ChatMinimap.css): none of it on the margin's side
    const at = marginLayout({ textRight, containerRight, minimapGutter: 0, wanted: as, coarse: latest.current.coarse });
    // cards the room no longer holds (the layer's layout follows a frame later): where cards go, until then
    let left = at.layout === as ? at.x : textRight + MARGIN_GAP;
    // a count's target, from its column's left (CommentMargin.css): beside the text, or over the free space at the edge
    node.style.setProperty("--count-target-x", `${at.target.left - at.x}px`);
    node.style.setProperty("--count-target-w", `${at.target.width}px`);
    node.style.setProperty("--count-bubble-x", `${at.x + COUNT_INSET - at.target.left}px`);
    let top = box.top;
    const parent = node.offsetParent;
    if (parent instanceof HTMLElement) {
      const outer = parent.getBoundingClientRect();
      left += parent.scrollLeft - outer.left - parent.clientLeft;
      top += parent.scrollTop - outer.top - parent.clientTop;
    }
    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
    const next = measureStarts(shownComments, beside);
    setStarts((now) => sameStarts(now, next) ? now : next);
    if (as !== "cards") {
      // a count's read-only cards (the mode off) hang below it, over the text: their bottom, while they are open
      let below = 0;
      for (const cards of node.querySelectorAll<HTMLElement>(".markdown-comment-readonly")) below = Math.max(below, cards.getBoundingClientRect().bottom - box.top);
      extent?.(below);
      return;
    }
    // each card at its text's first line, else just below the card above: measured heights, a card in edit its field's;
    // one whose text is not drawn now is left hidden (`isPlaced`) until the render that drops it
    const cards = [...node.querySelectorAll<HTMLElement>(CARD)];
    const byId = new Map(cards.map((card) => [card.dataset.commentId ?? "", card]));
    const tops = placeCards(next.flatMap((start) => {
      const card = byId.get(start.id);
      return card === undefined ? [] : [{ id: start.id, want: start.top, height: card.getBoundingClientRect().height }];
    }));
    let bottom = 0;
    for (const card of cards) {
      const at = tops.get(card.dataset.commentId ?? "");
      if (at === undefined) card.style.visibility = "hidden";
      else {
        card.style.top = `${at}px`;
        card.style.visibility = "";
        bottom = Math.max(bottom, at + card.getBoundingClientRect().height);
      }
    }
    extent?.(bottom);
  }, []);

  // after every render, before it is painted: a card drawn or turned into its field is in its place at once
  useLayoutEffect(place);

  // and whenever the text or a card changes size, the text's DOM changes, its fonts load or its highlights are rebuilt;
  // and as the text's column, the margin's offset parent or the surface is resized: the text then moves (centred, at its
  // own width) without a size change of its own, or the free space right of it changes, and the memoized margin is drawn
  // by no render of the host
  const resized = useRef<ResizeObserver | null>(null);
  const observed = useRef(new Set<Element>());
  useEffect(() => {
    let frame = 0;
    let live = true;
    const schedule = (): void => {
      if (frame === 0) frame = window.requestAnimationFrame(() => { frame = 0; place(); });
    };
    // a resize is delivered after layout, before paint: placed at once, the frame's own placing no longer needed
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = 0;
      place();
    });
    resized.current = observer;
    observed.current = new Set();
    observer.observe(text);
    if (text.parentElement !== null) observer.observe(text.parentElement);
    const parent = root.current?.offsetParent ?? null;
    if (parent !== null && parent !== text.parentElement) observer.observe(parent);
    // the container whose right edge bounds the free space (counts short of room sit at it)
    const surface = text.closest(`[${COMMENT_SURFACE}]`);
    if (surface !== null && surface !== parent && surface !== text.parentElement) observer.observe(surface);
    if (root.current !== null) {
      observer.observe(root.current);
      for (const card of root.current.querySelectorAll(CARD)) {
        observed.current.add(card);
        observer.observe(card);
      }
    }
    const mutations = new MutationObserver(schedule);
    mutations.observe(text, { childList: true, subtree: true, characterData: true });
    const view = text.closest(`[${COMMENT_SURFACE}]`);
    const unwatch = view === null ? () => {} : watchSurfaceRanges(view, schedule);
    void document.fonts?.ready.then(() => { if (live) schedule(); });
    return () => {
      live = false;
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      if (resized.current === observer) resized.current = null;
      mutations.disconnect();
      unwatch();
    };
  }, [text, place]);
  // each card is watched too (a card in edit grows with its field), and no longer once it is gone
  useLayoutEffect(() => {
    const observer = resized.current;
    const node = root.current;
    if (observer === null || node === null) return;
    const cards = new Set(node.querySelectorAll(CARD));
    for (const card of observed.current) {
      if (cards.has(card)) continue;
      observer.unobserve(card);
      observed.current.delete(card);
    }
    for (const card of cards) {
      if (observed.current.has(card)) continue;
      observed.current.add(card);
      observer.observe(card);
    }
  });

  const byId = useMemo(() => new Map(comments.map((comment) => [comment.id, comment])), [comments]);
  const placed = starts.flatMap((start) => {
    const comment = byId.get(start.id);
    return comment === undefined ? [] : [{ start, comment }];
  });
  const groups = layout === "counts" ? groupCounts(placed.map(({ start }) => start), touch) : [];

  // the walk's stop with the mode off shows its comment's count, by that count's first comment, as a click there does:
  // derived here, as every margin gets the same stop (the chat has one per reply), so a margin whose comment it is not
  // shows nothing for it, and the count goes as the walk moves on or ends, or a click or a press elsewhere leaves it
  const walkOpen = walkStop === null || mode || walkStop.opening === walkLeft ? null : groups.find((group) => group.ids.includes(walkStop.id))?.ids[0] ?? null;
  // a stop that shows a count here takes the place of one a click showed before it: that one does not come back as the
  // walk moves on (adjusted while rendering, once per stop)
  // during render, not in an effect: an effect would paint one frame with both counts open and re-render after it
  const [walkSeen, setWalkSeen] = useState<number | null>(null);
  if (walkOpen !== null && walkStop!.opening !== walkSeen) {
    setWalkSeen(walkStop!.opening);
    if (shown !== null) setShown(null);
  }
  const showing = walkOpen ?? shown;
  /** Shows the count `first`'s read-only cards (null: none), by a click or a press: the walk's stop, if any, is left. */
  const showCount = useCallback((first: string | null): void => {
    setShown(first);
    setWalkLeft(latest.current.walkStop?.opening ?? null);
  }, []);

  // read-only cards are the mode off's: the mode on hides them; a press anywhere but in the margin does too
  useEffect(() => { if (mode) setShown(null); }, [mode]);
  const anyShown = showing !== null;
  useEffect(() => {
    if (!anyShown) return;
    const onPress = (event: PointerEvent): void => {
      if (!(event.target instanceof Node && root.current?.contains(event.target))) showCount(null);
    };
    document.addEventListener("pointerdown", onPress, true);
    return () => document.removeEventListener("pointerdown", onPress, true);
  }, [anyShown, showCount]);

  const content = (() => {
    if (layout === "cards") {
      return placed.map(({ comment }) => <Card
        key={comment.id}
        comment={comment}
        edit={mode ? (event) => { if (byFinger(event)) onSheet!([comment.id]); else onEdit([comment.id]); } : null}
        remove={mode ? () => onDelete(comment.id) : null}
        field={editing.includes(comment.id) ? renderField(comment.id) : null}
      />);
    }
    return groups.map((group) => {
      const first = group.ids[0]!;
      const count = group.ids.length;
      // its fields or its sheet open (the sheet the mode off's too), or its read-only cards
      const open = group.ids.some((id) => editing.includes(id)) || (!mode && showing === first);
      const press = (event: ReactMouseEvent<HTMLElement>): void => {
        if (byFinger(event)) onSheet!(group.ids);
        else if (mode) onEdit(open ? [] : group.ids);
        else showCount(open ? null : first);
      };
      const label = t(count === 1 ? "{count} comment" : "{count} comments", { count });
      return <div key={first} className="markdown-comment-count-slot" style={{ top: `${group.top}px` }}>
        <button type="button" className="markdown-comment-count" data-comment-ids={group.ids.join(" ")} aria-label={label} title={label}
          aria-expanded={open} onClick={press} {...highlightProps}>
          <span className="markdown-comment-count-bubble" aria-hidden="true">{count}</span>
        </button>
        {!mode && open && <div className="markdown-comment-readonly" style={{ width: `${MARGIN_W}px` }}>
          {group.ids.map((id) => {
            const comment = byId.get(id);
            return comment === undefined ? null : <Card key={id} comment={comment} edit={null} remove={null} field={null} readOnly />;
          })}
        </div>}
      </div>;
    });
  })();

  return <div ref={root} className={`${MARKDOWN_COMMENTS_CLASS} comment-margin`} data-layout={layout}
    onPointerDown={(event) => { pressedBy.current = event.pointerType; }}
    style={{ width: `${layout === "cards" ? MARGIN_W : COUNT_W}px` }}>
    {content}
  </div>;
});
