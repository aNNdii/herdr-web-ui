/**
 * The text of every comment shown in the chat, highlighted with the CSS Custom Highlight API
 * (`::highlight(block-comment)` in BlockComments.css): a selection's text part by part, a comment
 * on a whole part all of that part's text. Over them the comment whose card the pointer or the
 * focus is on (`block-comment-active`), and over that the one the composer's walk stands on
 * (`block-comment-current`). While either is shown the view carries `data-comment-focus`, and the
 * stylesheet fades the other comments' marks so the active one stands out. The selection a comment is being written on in the inline form
 * (`block-comment-pending`) looks the same: the field took the browser's selection away. Where the
 * browser lacks the API there is no highlight. Needs a DOM.
 *
 * The chat is one comment surface; the file viewer is another. An element carrying
 * `data-comment-surface` (`COMMENT_SURFACE`) registers how its cards bring their text up
 * (`registerCommentSurface`): a card's pointer and focus (`activateComment`) and the composer's walk
 * (`markCurrentComment`, `showWalkStop`) reach the surface the card is in, whichever it is.
 */
import { blockComments, draftComment, partSegments, textRange, type BlockComment, type CommentTarget, type PartSegment } from "./blockComments.ts";
import { commentPartOf, outsideMath, partTextNodes } from "./commentSelection.ts";

export const COMMENT_HIGHLIGHT = "block-comment";
export const ACTIVE_COMMENT_HIGHLIGHT = "block-comment-active";
export const CURRENT_COMMENT_HIGHLIGHT = "block-comment-current";
export const PENDING_COMMENT_HIGHLIGHT = "block-comment-pending";
/** Set on a comment surface while a card's comment is up (pointer, keyboard focus or the walk): the stylesheet fades the others. */
export const FOCUS_ATTRIBUTE = "data-comment-focus";
/** Marks an element whose comment cards bring their text up through a registered `CommentSurface`. */
export const COMMENT_SURFACE = "data-comment-surface";

/** How a comment surface shows a card's text: what the walk, the pointer and the focus ask of it. */
export interface CommentSurface {
  /** the walk stands on `note` (a `.block-comment-card`), or on nothing */
  mark(note: HTMLElement | null): void;
  /** the pointer is over the card `note`, or the focus in it (`on`), or no longer */
  activate(note: HTMLElement, by: "pointer" | "focus", on: boolean): void;
  /** the box around the text of the comment `note` shows, if it has some */
  boxOf(note: HTMLElement): DOMRect | null;
}

const surfaces = new WeakMap<Element, CommentSurface>();

/**
 * `view` (which carries `COMMENT_SURFACE`) shows its cards' text through `surface` until the
 * returned cleanup runs. A later registration for the same view takes over; an earlier cleanup then
 * leaves it alone.
 */
export function registerCommentSurface(view: Element, surface: CommentSurface): () => void {
  surfaces.set(view, surface);
  return () => { if (surfaces.get(view) === surface) surfaces.delete(view); };
}

/** The surface `element` lies in (itself included); undefined outside one. */
function surfaceOf(element: Element): CommentSurface | undefined {
  const view = element.closest(`[${COMMENT_SURFACE}]`);
  return view === null ? undefined : surfaces.get(view);
}

/** Which highlight paints over which where they overlap: the walk's over a card's or the one being written over the rest. */
const PRIORITY: Record<string, number> = { [COMMENT_HIGHLIGHT]: 0, [ACTIVE_COMMENT_HIGHLIGHT]: 1, [PENDING_COMMENT_HIGHLIGHT]: 1, [CURRENT_COMMENT_HIGHLIGHT]: 2 };

const supported = (): boolean => typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";

/**
 * The one `Highlight` of `name` every chat view shares (several panes can be mounted), each view
 * adding and deleting only its own ranges; null without the API.
 */
function shared(name: string): Highlight | null {
  if (!supported()) return null;
  let highlight = CSS.highlights.get(name);
  if (highlight === undefined) {
    highlight = new Highlight();
    highlight.priority = PRIORITY[name] ?? 0;
    CSS.highlights.set(name, highlight);
  }
  return highlight;
}

const NO_RANGES: readonly Range[] = [];

/**
 * A view's ranges in one shared highlight (`name`, made on first use with its `PRIORITY`): a change
 * adds and deletes only the ranges that came or went, so several views can share it.
 */
export class SharedRanges {
  private ranges: readonly Range[] = NO_RANGES;

  constructor(private name: string) {}

  set(ranges: readonly Range[]): void {
    const highlight = shared(this.name);
    if (highlight !== null) {
      const next = new Set(ranges);
      for (const range of this.ranges) if (!next.has(range)) highlight.delete(range);
      const had = new Set(this.ranges);
      for (const range of next) if (!had.has(range)) highlight.add(range);
    }
    this.ranges = ranges;
  }
}

/**
 * How far the chat view (`view`, its top and height on screen) scrolls for the walk to show a
 * comment's text and its card below it: both in the middle when they fit, else the card's
 * bottom at the view's bottom, so the card the walk focuses is on screen with the text above it.
 */
export function walkScroll(text: { top: number; bottom: number }, card: { top: number; bottom: number }, view: { top: number; height: number }): number {
  const top = Math.min(text.top, card.top);
  const bottom = Math.max(text.bottom, card.bottom);
  return bottom - top > view.height ? card.bottom - (view.top + view.height) : (top + bottom) / 2 - (view.top + view.height / 2);
}

/**
 * Adds to `next` the ranges of the `segments` in `part`, by comment id, one per segment whose
 * offsets still fit the part's text. A range in `held` (the ranges before) whose boundaries did not
 * move is kept. True when it added one.
 */
function addRanges(part: Element, segments: readonly PartSegment[], held: ReadonlyMap<string, readonly Range[]>, next: Map<string, Range[]>): boolean {
  if (segments.length === 0) return false;
  const nodes = partTextNodes(part);
  const lengths = nodes.map((node) => node.length);
  const total = lengths.reduce((sum, length) => sum + length, 0);
  let added = false;
  for (const { comment, start, end: until } of segments) {
    const end = until ?? total;
    const at = end > start ? textRange(lengths, start, end) : null;
    if (at === null) continue;
    // the offsets count a formula's hidden MathML: a boundary in it moves out, so the range
    // takes the formula whole, its glyphs too
    const [startNode, startOffset] = outsideMath(nodes[at.startNode]!, at.startOffset, false);
    const [endNode, endOffset] = outsideMath(nodes[at.endNode]!, at.endOffset, true);
    const ranges = next.get(comment.id) ?? [];
    const kept = held.get(comment.id)?.[ranges.length];
    const same = kept !== undefined && kept.startContainer === startNode && kept.startOffset === startOffset && kept.endContainer === endNode && kept.endOffset === endOffset;
    let range = kept;
    if (!same) {
      range = document.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);
    }
    ranges.push(range!);
    next.set(comment.id, ranges);
    added = true;
  }
  return added;
}

/** One chat view's ranges, by comment id, and the cards the walk, the pointer and the focus are on. */
class ViewHighlights implements CommentSurface {
  /** each comment's ranges, one per part it covers, in document order */
  private ranges = new Map<string, Range[]>();
  /** the parts those ranges lie in: a change in one of them, or its removal, can move or end a range */
  private parts = new Set<Element>();
  private all = new SharedRanges(COMMENT_HIGHLIGHT);
  private active = new SharedRanges(ACTIVE_COMMENT_HIGHLIGHT);
  private currentShown = new SharedRanges(CURRENT_COMMENT_HIGHLIGHT);
  private pendingShown = new SharedRanges(PENDING_COMMENT_HIGHLIGHT);
  /** the comment being written in the inline form, not saved yet (ChatView), and its ranges */
  private pending: { owner: string; comment: BlockComment } | null = null;
  private pendingRanges = new Map<string, Range[]>();
  private current: HTMLElement | null = null;
  private pointed: HTMLElement | null = null;
  private focused: HTMLElement | null = null;

  constructor(private view: Element, private transcript: Element) {}

  /**
   * Whether these transcript mutations can touch a highlight: a change inside a commented part or
   * one holding a range, a commented part added, or a part holding a range removed. Another turn
   * streaming touches none, and nor does a card or the form changing: they are not a part's text
   * (typing in the form's field is a change in the DOM too). Except a card the pointer, the focus or
   * the walk is on leaving: no pointerleave or blur follows, and a rebuild lets it go.
   */
  touches(records: readonly MutationRecord[]): boolean {
    const held = [this.pointed, this.focused, this.current].filter((note): note is HTMLElement => note !== null);
    for (const record of records) {
      if (held.length > 0) for (const node of record.removedNodes) if (held.some((note) => node.contains(note))) return true;
      const element = record.target instanceof Element ? record.target : record.target.parentElement;
      if (element?.closest(".block-comment-notes")) continue;
      const part = element?.closest(".is-commentable");
      if (part && (part.classList.contains("is-commented") || this.parts.has(part))) return true;
      for (const node of record.addedNodes) {
        if (node instanceof Element && (node.matches(".is-commented") || node.querySelector(".is-commented") !== null)) return true;
      }
      for (const node of record.removedNodes) {
        for (const held of this.parts) if (node.contains(held)) return true;
      }
    }
    return false;
  }

  /**
   * Every comment shown in the transcript gets a range per part it covers (`partSegments`), never
   * one across parts: the cards between them would be painted too. A segment whose offsets no
   * longer fit the part's text gets none. A range whose boundaries did not move is kept, and the
   * shared highlights are touched only for the ranges that came or went. The comment being written
   * gets its ranges the same way (`draftComment`).
   */
  rebuild(): void {
    // a card that left without its pointerleave or blur (re-rendered, deleted) is no longer pointed at, focused or walked to
    if (this.pointed?.isConnected === false) this.pointed = null;
    if (this.focused?.isConnected === false) this.focused = null;
    if (this.current?.isConnected === false) this.current = null;
    const next = new Map<string, Range[]>();
    const parts = new Set<Element>();
    for (const part of this.transcript.querySelectorAll(".is-commented")) {
      const found = commentPartOf(part);
      if (found === undefined) continue;
      const segments = partSegments(blockComments.list(found.owner), found.target, found.parts);
      if (addRanges(part, segments, this.ranges, next)) parts.add(part);
    }
    // the selection a comment is being written on: every part of its reply may hold some of it
    const pending = new Map<string, Range[]>();
    if (this.pending !== null) {
      const { owner, comment } = this.pending;
      for (const part of this.transcript.querySelectorAll(".is-commentable")) {
        const found = commentPartOf(part);
        if (found?.owner === owner && addRanges(part, partSegments([comment], found.target, found.parts), this.pendingRanges, pending)) parts.add(part);
      }
    }
    this.ranges = next;
    this.pendingRanges = pending;
    this.parts = parts;
    const pendingRanges = [...pending.values()].flat();
    // its text takes the tint and the underline every comment has, and the stronger tint over it
    this.all.set([...[...next.values()].flat(), ...pendingRanges]);
    this.pendingShown.set(pendingRanges);
    this.showMarks();
  }

  /** A comment is being written on `target` of `owner`'s pane (null: none any more): its text shows as the comment's will. */
  setPending(pending: { owner: string; target: CommentTarget } | null): void {
    this.pending = pending === null ? null : { owner: pending.owner, comment: draftComment(pending.target) };
    this.rebuild();
  }

  /** The walk stands on `note` (a `.block-comment-card`), or on nothing. Its ranges are the current highlight while the note is in the view. */
  mark(note: HTMLElement | null): void {
    this.current = note;
    this.showMarks();
  }

  /** The pointer is over the card `note`, or the focus in it (`on`), or no longer: its comment's text comes up while either holds. */
  activate(note: HTMLElement, by: "pointer" | "focus", on: boolean): void {
    if (by === "pointer") this.pointed = on ? note : this.pointed === note ? null : this.pointed;
    else this.focused = on ? note : this.focused === note ? null : this.focused;
    this.showMarks();
  }

  /** The box around the text of the comment `note` shows, if it has some. */
  boxOf(note: HTMLElement): DOMRect | null {
    let box: { left: number; top: number; right: number; bottom: number } | null = null;
    for (const range of this.rangesOf(note)) {
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      box = box === null ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
        : { left: Math.min(box.left, rect.left), top: Math.min(box.top, rect.top), right: Math.max(box.right, rect.right), bottom: Math.max(box.bottom, rect.bottom) };
    }
    return box === null ? null : new DOMRect(box.left, box.top, box.right - box.left, box.bottom - box.top);
  }

  /** The ranges of the comment `note` shows, by its current id: an edit gives the comment a new id but keeps the note's element. */
  private rangesOf(note: HTMLElement | null): readonly Range[] {
    const id = note?.isConnected ? note.dataset.commentId : undefined;
    return id === undefined ? NO_RANGES : this.ranges.get(id) ?? NO_RANGES;
  }

  private showMarks(): void {
    const current = this.rangesOf(this.current);
    const active = [...new Set([...this.rangesOf(this.pointed), ...this.rangesOf(this.focused)])];
    this.currentShown.set(current);
    this.active.set(active);
    // focus mode, per view (two panes are independent): the stylesheet fades every other comment's marks while a card's text
    // is up. Only when there is such text: a card whose text is gone would fade the rest for nothing
    this.view.toggleAttribute(FOCUS_ATTRIBUTE, current.length + active.length > 0);
  }

  dispose(): void {
    this.all.set(NO_RANGES);
    this.active.set(NO_RANGES);
    this.currentShown.set(NO_RANGES);
    this.pendingShown.set(NO_RANGES);
    this.ranges.clear();
    this.pendingRanges.clear();
    this.parts.clear();
    this.pending = null;
    this.current = this.pointed = this.focused = null;
    this.view.removeAttribute(FOCUS_ATTRIBUTE);
  }
}

const views = new WeakMap<Element, ViewHighlights>();

/**
 * Highlights the comments in `view`'s `transcript` until the returned cleanup runs: the ranges
 * are rebuilt at most once per frame after a change in the transcript's DOM that can touch them
 * (a poll that re-rendered a commented reply, a page of history, a code block unfolded) or after
 * any comment changed. A rewrap needs nothing: a range follows its text.
 */
export function watchCommentHighlights(view: Element, transcript: Element): () => void {
  const highlights = new ViewHighlights(view, transcript);
  views.set(view, highlights);
  const unregister = registerCommentSurface(view, highlights);
  let frame = 0;
  const schedule = (): void => {
    if (frame === 0) frame = window.requestAnimationFrame(() => { frame = 0; highlights.rebuild(); });
  };
  const observer = new MutationObserver((records) => { if (frame === 0 && highlights.touches(records)) schedule(); });
  observer.observe(transcript, { childList: true, subtree: true, characterData: true });
  const unsubscribe = blockComments.subscribe(schedule);
  schedule();
  return () => {
    window.cancelAnimationFrame(frame);
    observer.disconnect();
    unsubscribe();
    unregister();
    highlights.dispose();
    if (views.get(view) === highlights) views.delete(view);
  };
}

/**
 * The composer's walk stands on `note` in `view` (null: on nothing), whose surface is the one
 * `view` lies in: its comment's text takes the current highlight. Returns the box around that text,
 * for scrolling to it; null without one.
 */
export function markCurrentComment(view: Element, note: HTMLElement | null): DOMRect | null {
  const surface = surfaceOf(view);
  if (surface === undefined) return null;
  surface.mark(note);
  return note === null ? null : surface.boxOf(note);
}

/**
 * The walk's stop on `note` in the scrolling `view`, once the caller has marked it as its own: its
 * text takes the current highlight, and the view scrolls the text and its card into the middle, or,
 * taller than the view, the text's end and the card at its bottom: the focused card is always on
 * screen (`walkScroll`). The card alone where its text could not be found. Then the focus goes to
 * the note.
 */
export function showWalkStop(view: Element, note: HTMLElement): void {
  const marked = markCurrentComment(view, note);
  const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  if (marked === null || marked.height === 0) note.scrollIntoView({ block: "center", behavior });
  else {
    const top = view.getBoundingClientRect().top + view.clientTop;
    view.scrollBy({ top: walkScroll(marked, note.getBoundingClientRect(), { top, height: view.clientHeight }), behavior });
  }
  // the note is a group with its own name: with the focus on it a screen reader reads the comment, and Tab reaches its buttons.
  // An open edit form is a stop too: its field takes the focus, so Escape there is the form's own (it gives up while
  // nothing was typed; either way the focus goes back to the walk control, as from any note)
  (note.querySelector<HTMLElement>("textarea") ?? note).focus({ preventScroll: true });
}

/**
 * A comment is being written on the selection `target` in `view`, of the pane `owner` (null: no
 * longer): its text is highlighted as a comment's, with the stronger tint, until it is saved or
 * given up. Focusing the comment's field took the browser's own selection away.
 */
export function showPendingComment(view: Element, pending: { owner: string; target: CommentTarget } | null): void {
  views.get(view)?.setPending(pending);
}

/** The pointer entered or left the card `note`, or the focus came into or left it (`on`): its comment's text comes up meanwhile. */
export function activateComment(note: HTMLElement, by: "pointer" | "focus", on: boolean): void {
  surfaceOf(note)?.activate(note, by, on);
}
