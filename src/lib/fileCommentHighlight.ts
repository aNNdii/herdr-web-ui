/**
 * The comments on a file shown in the file viewer, highlighted with the same CSS Custom Highlight
 * API highlights the chat uses (`commentHighlight.ts`): a selection's text, a comment on whole lines
 * all of their text; over them the comment whose card the pointer or the focus is on, and over that
 * the one the composer's walk stands on. A comment on whole lines also marks each of its `.hl-line`s
 * `is-commented`, for the code view's own line styling. The viewer is a comment surface of its own
 * (`registerCommentSurface`), so the cards bring their text up as in the chat. Needs a DOM.
 */
import {
  ACTIVE_COMMENT_HIGHLIGHT, COMMENT_HIGHLIGHT, CURRENT_COMMENT_HIGHLIGHT, FOCUS_ATTRIBUTE, PENDING_COMMENT_HIGHLIGHT,
  registerCommentSurface, SharedRanges, type CommentSurface,
} from "./commentHighlight.ts";
import { lineElementIndex, lineRanges } from "./fileCommentDom.ts";
import type { FileSelection, LineRange } from "./fileComments.ts";

/** A comment to show: its lines, and the selection it is on (none: all of its lines). */
export interface ShownFileComment {
  id: string;
  lines: LineRange;
  selection?: FileSelection;
}

const NO_RANGES: readonly Range[] = [];
const NO_COMMENTS: readonly ShownFileComment[] = [];
const NOTES = ".block-comment-notes";

const sameRange = (a: Range, b: Range): boolean =>
  a.startContainer === b.startContainer && a.startOffset === b.startOffset && a.endContainer === b.endContainer && a.endOffset === b.endOffset;

/** `fresh` with each range swapped for the one at its place in `held` whose boundaries did not move: the shared highlights then touch only what changed. */
function reuse(held: readonly Range[] | undefined, fresh: Range[]): Range[] {
  if (held === undefined) return fresh;
  return fresh.map((range, index) => {
    const before = held[index];
    return before !== undefined && sameRange(before, range) ? before : range;
  });
}

class FileHighlights implements CommentSurface {
  private comments: readonly ShownFileComment[] = [];
  private pending: ShownFileComment | null = null;
  /** each comment's ranges, by id */
  private ranges = new Map<string, Range[]>();
  private pendingRanges: Range[] = [];
  /** the `.hl-line`s marked `is-commented` */
  private marked = new Set<Element>();
  private all = new SharedRanges(COMMENT_HIGHLIGHT);
  private active = new SharedRanges(ACTIVE_COMMENT_HIGHLIGHT);
  private currentShown = new SharedRanges(CURRENT_COMMENT_HIGHLIGHT);
  private pendingShown = new SharedRanges(PENDING_COMMENT_HIGHLIGHT);
  private current: HTMLElement | null = null;
  private pointed: HTMLElement | null = null;
  private focused: HTMLElement | null = null;

  constructor(private surface: Element, private content: Element) {}

  setComments(comments: readonly ShownFileComment[]): void { this.comments = comments; }
  setPending(pending: ShownFileComment | null): void { this.pending = pending; }

  /**
   * Whether these mutations of the content can move or end a range: a change in the lines, not in
   * the comment cards between them (their own text, or one added or taken away). A card the
   * pointer, the focus or the walk is on leaving counts: no pointerleave or blur follows.
   */
  touches(records: readonly MutationRecord[]): boolean {
    const held = [this.pointed, this.focused, this.current].filter((note): note is HTMLElement => note !== null);
    const isNotes = (node: Node): boolean => node instanceof Element && node.matches(NOTES);
    for (const record of records) {
      if (held.length > 0) for (const node of record.removedNodes) if (held.some((note) => node.contains(note))) return true;
      const element = record.target instanceof Element ? record.target : record.target.parentElement;
      if (element?.closest(NOTES)) continue;
      if (record.type === "childList" && record.addedNodes.length + record.removedNodes.length > 0
        && [...record.addedNodes, ...record.removedNodes].every(isNotes)) continue;
      return true;
    }
    return false;
  }

  rebuild(): void {
    // a card that left without its pointerleave or blur (re-rendered, deleted) is no longer pointed at, focused or walked to
    if (this.pointed?.isConnected === false) this.pointed = null;
    if (this.focused?.isConnected === false) this.focused = null;
    if (this.current?.isConnected === false) this.current = null;
    const next = new Map<string, Range[]>();
    const whole = new Set<Element>();
    // the line elements are read once per rebuild, not once per comment: a long file has tens of thousands of them
    const elementsOn = lineElementIndex(this.content);
    for (const { id, lines, selection } of this.comments) {
      const elements = elementsOn(lines);
      next.set(id, reuse(this.ranges.get(id), lineRanges(elements, selection)));
      if (selection !== undefined) continue;
      for (const element of elements) if (element.classList.contains("hl-line")) whole.add(element);
    }
    for (const element of this.marked) if (!whole.has(element)) element.classList.remove("is-commented");
    for (const element of whole) element.classList.add("is-commented");
    this.marked = whole;
    this.ranges = next;
    this.pendingRanges = this.pending === null ? [] : reuse(this.pendingRanges, lineRanges(elementsOn(this.pending.lines), this.pending.selection));
    // the selection being written on takes the tint and underline every comment has, and the stronger tint over it
    this.all.set([...[...next.values()].flat(), ...this.pendingRanges]);
    this.pendingShown.set(this.pendingRanges);
    this.showMarks();
  }

  /** The walk stands on `note` (a `.block-comment-card`), or on nothing. */
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
    // focus mode: the stylesheet fades every other comment's marks while a card's text is up, and only then
    this.surface.toggleAttribute(FOCUS_ATTRIBUTE, current.length + active.length > 0);
  }

  dispose(): void {
    this.all.set(NO_RANGES);
    this.active.set(NO_RANGES);
    this.currentShown.set(NO_RANGES);
    this.pendingShown.set(NO_RANGES);
    for (const element of this.marked) element.classList.remove("is-commented");
    this.marked.clear();
    this.ranges.clear();
    this.pendingRanges = [];
    this.comments = NO_COMMENTS;
    this.pending = null;
    this.current = this.pointed = this.focused = null;
    this.surface.removeAttribute(FOCUS_ATTRIBUTE);
  }
}

/**
 * Shows the comments `show` is given in `content` (the file's lines, inside `surface`, the element
 * carrying `data-comment-surface`) until `dispose` runs; `setPending` shows the one being written
 * (null: none) with the stronger tint. The ranges are rebuilt at most once per frame after a call
 * to either or a change in `content`'s DOM outside the comment cards (a file reloaded, a preview
 * rendered again). A rewrap needs nothing: a range follows its text.
 */
export function watchFileCommentHighlights(surface: Element, content: Element): {
  show(comments: readonly ShownFileComment[]): void;
  setPending(comment: ShownFileComment | null): void;
  dispose(): void;
} {
  const highlights = new FileHighlights(surface, content);
  const unregister = registerCommentSurface(surface, highlights);
  let frame = 0;
  const schedule = (): void => {
    if (frame === 0) frame = window.requestAnimationFrame(() => { frame = 0; highlights.rebuild(); });
  };
  const observer = new MutationObserver((records) => { if (frame === 0 && highlights.touches(records)) schedule(); });
  observer.observe(content, { childList: true, subtree: true, characterData: true });
  return {
    show(comments) {
      highlights.setComments(comments);
      schedule();
    },
    setPending(comment) {
      highlights.setPending(comment);
      schedule();
    },
    dispose() {
      window.cancelAnimationFrame(frame);
      frame = 0;
      observer.disconnect();
      unregister();
      highlights.dispose();
    },
  };
}
