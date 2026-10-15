/**
 * The text of every comment shown in the chat, highlighted with the CSS Custom Highlight API (BlockComments.css): a
 * selection's text part by part, a comment on a whole part all of that part's text. Each comment is painted on one of
 * `LAYER_COUNT` layer highlights (`comment-layer-0` … `-3`, lib/commentLayers.ts): comments that overlap get different
 * layers, so their translucent fills add up and the overlap reads darker (ranges inside one highlight never stack).
 * The comment in focus (its card or count under the pointer or the focus, its field open) leaves
 * its layer for the strong fill (`comment-strong`), painted over the other comments' layers. The text a new comment is
 * being written on (`comment-pending`) has the strong fill too. A touch screen's own selection is drawn as
 * `comment-touch-selection` (components/TouchSelection.tsx). Where the browser lacks the API there is no highlight.
 * Needs a DOM.
 *
 * The chat is one comment surface; the file viewer is another. An element carrying
 * `data-comment-surface` (`COMMENT_SURFACE`) registers how its cards bring their text up
 * (`registerCommentSurface`): a card's pointer and focus (`activateComment`) and the open fields
 * (`showOpenComment`) reach the surface the card is in, whichever it is. Every surface shows its comments through a
 * `SurfaceMarks`; only which text a comment covers is the surface's own.
 * A surface also publishes its ranges after each rebuild (`watchSurfaceRanges`): the comment layer
 * (CommentMargin.tsx) places its cards from them. That layer is a sibling of the transcript (of the
 * file's content root), never inside it, so a card drawn or moved is no mutation the highlights
 * watch, and a rebuild never follows from one.
 */
import { blockComments, draftComment, partSegments, textRange, type BlockComment, type CommentTarget, type PartSegment } from "./blockComments.ts";
import { assignLayers, LAYER_COUNT } from "./commentLayers.ts";
import { commentPartOf, outsideMath, partTextNodes } from "./commentSelection.ts";

/** The layers every comment's text is painted on, one highlight each, by layer (`assignLayers`). */
export const COMMENT_LAYER_HIGHLIGHTS: readonly string[] = Array.from({ length: LAYER_COUNT }, (_, layer) => `comment-layer-${layer}`);
/** The comment in focus: its card or count under the pointer or the focus, or its field open. */
export const STRONG_COMMENT_HIGHLIGHT = "comment-strong";
/** The text a new comment is being written on. */
export const PENDING_COMMENT_HIGHLIGHT = "comment-pending";
/** A touch screen's selection in the comment mode, drawn in the app's selection colour. */
export const TOUCH_SELECTION_HIGHLIGHT = "comment-touch-selection";
/**
 * Marks an element whose comment cards bring their text up through a registered `CommentSurface`: set only through
 * `markCommentSurface`, by the surface's comment source (components/ChatComments.tsx, components/FileComments.tsx) or,
 * for the code view, by its layer (components/CodeComments.tsx). Literals elsewhere that a rename changes too:
 * scripts/file-viewer-comments-regression.ts.
 */
export const COMMENT_SURFACE = "data-comment-surface";
/** the id the comment being written (pending) has in a surface's ranges */
export const PENDING_COMMENT_ID = "";

/**
 * How a comment surface shows a comment's text: what the pointer, the focus and the open fields ask of it.
 * A `marker` (a card or a count of the Markdown comment layer's margin, CommentMargin.tsx; a card of the code view's
 * layer) names its comment in `data-comment-id`, or several in `data-comment-ids` (a count), space-separated.
 */
export interface CommentSurface {
  /** the pointer is over `marker`, or the focus on or in it (`on`), or no longer */
  activate(marker: HTMLElement, by: "pointer" | "focus", on: boolean): void;
  /** the field of the saved comment `id` is open (several: a count's fields), or none is (null) */
  open(id: OpenComments): void;
  /**
   * each comment's ranges as of the last rebuild, by id, in document order; the one being written
   * under `PENDING_COMMENT_ID`. The comment layer (CommentMargin.tsx) places its cards from them
   */
  ranges(): ReadonlyMap<string, readonly Range[]>;
}

/** The saved comments whose fields are open on a surface: one id, several, or none (null). */
export type OpenComments = string | readonly string[] | null;

type RangesListener = (ranges: ReadonlyMap<string, readonly Range[]>) => void;

const surfaces = new WeakMap<Element, CommentSurface>();
/** the saved comments whose fields are open on each view (`showOpenComment`), whether a surface is registered on it yet or not */
const openComments = new WeakMap<Element, Exclude<OpenComments, null>>();
/** who follows each view's ranges (`watchSurfaceRanges`), whether a surface is registered on it yet or not */
const rangeListeners = new WeakMap<Element, Set<RangesListener>>();
const NO_RANGE_MAP: ReadonlyMap<string, readonly Range[]> = new Map();

/**
 * Hands the ranges of the surface on `view` (none without one) to everyone following them: a
 * surface calls it at the end of each rebuild.
 */
export function notifyRanges(view: Element): void {
  const listeners = rangeListeners.get(view);
  if (listeners === undefined || listeners.size === 0) return;
  const ranges = surfaces.get(view)?.ranges() ?? NO_RANGE_MAP;
  for (const listener of [...listeners]) listener(ranges);
}

/**
 * `view` (which carries `COMMENT_SURFACE`) shows its cards' text through `surface` until the
 * returned cleanup runs. A later registration for the same view takes over; an earlier cleanup then
 * leaves it alone. Whoever follows the view's ranges hears of either.
 */
export function registerCommentSurface(view: Element, surface: CommentSurface): () => void {
  surfaces.set(view, surface);
  surface.open(openComments.get(view) ?? null);
  notifyRanges(view);
  return () => {
    if (surfaces.get(view) !== surface) return;
    surfaces.delete(view);
    notifyRanges(view);
  };
}

/**
 * Calls `listener` with the ranges of the surface on `view` after each of its rebuilds, and at once
 * if it already has some. Works whether that surface registers before or after this call,
 * and follows a later registration. Returns the cleanup.
 */
export function watchSurfaceRanges(view: Element, listener: (ranges: ReadonlyMap<string, readonly Range[]>) => void): () => void {
  let listeners = rangeListeners.get(view);
  if (listeners === undefined) {
    listeners = new Set();
    rangeListeners.set(view, listeners);
  }
  // a function of its own: the same listener given twice is followed twice, and each cleanup ends one
  const own: RangesListener = (ranges) => listener(ranges);
  listeners.add(own);
  const ranges = surfaces.get(view)?.ranges();
  if (ranges !== undefined && ranges.size > 0) own(ranges);
  return () => { rangeListeners.get(view)?.delete(own); };
}

/** Marks `view` as a comment surface (`COMMENT_SURFACE`) until the returned cleanup runs. */
export function markCommentSurface(view: Element): () => void {
  view.setAttribute(COMMENT_SURFACE, "");
  return () => view.removeAttribute(COMMENT_SURFACE);
}

/** The surface `element` lies in (itself included); undefined outside one. */
function surfaceOf(element: Element): CommentSurface | undefined {
  const view = element.closest(`[${COMMENT_SURFACE}]`);
  return view === null ? undefined : surfaces.get(view);
}

/**
 * Which highlight paints over which where they overlap: the layers at the bottom (equal, so their fills add up), the
 * strong and the pending fill over them, a touch selection over everything.
 */
const PRIORITY: Record<string, number> = {
  ...Object.fromEntries(COMMENT_LAYER_HIGHLIGHTS.map((name) => [name, 0])),
  [STRONG_COMMENT_HIGHLIGHT]: 1,
  [PENDING_COMMENT_HIGHLIGHT]: 1,
  [TOUCH_SELECTION_HIGHLIGHT]: 2,
};

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
const NO_IDS: readonly string[] = [];

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

type Edge = { range: Range; end: boolean };

/** Where two range boundaries stand to each other (`compareBoundaryPoints`); 0 for ranges in different trees. */
function compareEdges(a: Edge, b: Edge): number {
  // the constant names which boundary of `b` (the source) is compared with which of `a`: START_TO_END is a's end, b's start
  const how = a.end ? (b.end ? Range.END_TO_END : Range.START_TO_END) : (b.end ? Range.END_TO_START : Range.START_TO_START);
  try {
    return a.range.compareBoundaryPoints(how, b.range);
  } catch {
    return 0;
  }
}

/**
 * Each comment's layer, by id, from its ranges (in document order: it spans from the first's start to the last's end).
 * A comment without ranges gets none.
 */
function layersOfRanges(comments: ReadonlyMap<string, readonly Range[]>): Map<string, number> {
  const spans: { id: string; start: Edge; end: Edge }[] = [];
  for (const [id, ranges] of comments) {
    const first = ranges[0];
    const last = ranges[ranges.length - 1];
    if (first !== undefined && last !== undefined) spans.push({ id, start: { range: first, end: false }, end: { range: last, end: true } });
  }
  return assignLayers(spans, compareEdges);
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

/**
 * Adds to `next` the ranges of `comment` (a draft, `draftComment`: the one being written) in the commentable parts of
 * `owner`'s pane in `root`, as `addRanges` does; returns the parts that got one.
 */
function addDraftRanges(root: Element, owner: string, comment: BlockComment, held: ReadonlyMap<string, readonly Range[]>, next: Map<string, Range[]>): Element[] {
  const touched: Element[] = [];
  for (const part of root.querySelectorAll(".is-commentable")) {
    const found = commentPartOf(part);
    if (found?.owner === owner && addRanges(part, partSegments([comment], found.target, found.parts), held, next)) touched.push(part);
  }
  return touched;
}

/**
 * The ranges a comment on `target` of `owner`'s pane gets in `root` (a chat view, a reply), as its highlight builds them
 * once it is saved: a block's whole text, or a selection's part by part. The chat's comment layer reads a comment's text
 * here while the highlights have not been rebuilt for it yet (just saved: an edit is a comment of a new id). Needs a DOM.
 */
export function draftRanges(root: Element, owner: string, target: CommentTarget): Range[] {
  const next = new Map<string, Range[]>();
  addDraftRanges(root, owner, draftComment(target), new Map(), next);
  return [...next.values()].flat();
}

/**
 * How strongly a surface shows each comment's text, whatever text that is (the chat's `ViewHighlights`, the file
 * viewer's `FileHighlights` decide it and `publish` it here): every comment the rest fill on its layer
 * (`layersOfRanges`); the comment in focus, whose card the pointer or the focus is on, or whose field is open, the
 * strong fill instead; the one being written the pending fill.
 * Registered as the surface on `view` (`watchSurface`).
 */
export class SurfaceMarks implements CommentSurface {
  private layers = COMMENT_LAYER_HIGHLIGHTS.map((name) => new SharedRanges(name));
  private strong = new SharedRanges(STRONG_COMMENT_HIGHLIGHT);
  private pendingShown = new SharedRanges(PENDING_COMMENT_HIGHLIGHT);
  private commentRanges: ReadonlyMap<string, readonly Range[]> = NO_RANGE_MAP;
  /** each comment's layer as of the last `publish` */
  private layerOf: ReadonlyMap<string, number> = new Map();
  private pendingRanges: readonly Range[] | null = null;
  private pointed: HTMLElement | null = null;
  private focused: HTMLElement | null = null;
  /** the saved comments whose fields are open */
  private opened: readonly string[] = [];

  /** `view` carries `COMMENT_SURFACE`. */
  constructor(readonly view: Element) {}

  /** Each saved comment's ranges as last published: a rebuild keeps those whose boundaries did not move. */
  get comments(): ReadonlyMap<string, readonly Range[]> { return this.commentRanges; }

  /** The ranges of the comment being written as last published; null while none is. */
  get pending(): readonly Range[] | null { return this.pendingRanges; }

  /**
   * A rebuild's result: each saved comment's ranges by id, in document order, and those of the one being written (null:
   * none is). Each comment gets its layer anew. The shared highlights change only by the ranges that came or went;
   * whoever follows the surface's ranges hears of them (`notifyRanges`).
   */
  publish(commentRanges: ReadonlyMap<string, readonly Range[]>, pending: readonly Range[] | null): void {
    // a card that left without its pointerleave or blur (re-rendered, deleted) is no longer pointed at or focused
    if (this.pointed?.isConnected === false) this.pointed = null;
    if (this.focused?.isConnected === false) this.focused = null;
    this.commentRanges = commentRanges;
    this.layerOf = layersOfRanges(commentRanges);
    this.pendingRanges = pending;
    this.pendingShown.set(pending ?? NO_RANGES);
    this.showMarks();
    notifyRanges(this.view);
  }

  /** Each comment's ranges by id, and those of the one being written under `PENDING_COMMENT_ID` while there is one. */
  ranges(): ReadonlyMap<string, readonly Range[]> {
    const all = new Map<string, readonly Range[]>(this.commentRanges);
    if (this.pendingRanges !== null) all.set(PENDING_COMMENT_ID, this.pendingRanges);
    return all;
  }

  /** The pointer is over `marker`, or the focus on it (`on`), or no longer: its comment takes the strong fill while either holds. */
  activate(marker: HTMLElement, by: "pointer" | "focus", on: boolean): void {
    if (by === "pointer") this.pointed = on ? marker : this.pointed === marker ? null : this.pointed;
    else this.focused = on ? marker : this.focused === marker ? null : this.focused;
    this.showMarks();
  }

  /** The field of the saved comment `id` is open (several, or none: null): its text comes up while it is, wherever the focus or the pointer goes. */
  open(id: OpenComments): void {
    this.opened = id === null ? [] : typeof id === "string" ? [id] : id;
    this.showMarks();
  }

  /** The comments `marker` stands for: a count's several (`data-comment-ids`), else its one. */
  private idsOf(marker: HTMLElement | null): readonly string[] {
    if (!marker?.isConnected) return NO_IDS;
    const several = marker.dataset.commentIds;
    if (several !== undefined) return several.split(" ").filter((id) => id !== "");
    const id = marker.dataset.commentId;
    return id === undefined ? NO_IDS : [id];
  }

  private showMarks(): void {
    // the comments in focus leave their layers for the strong fill, which is then their own (about 34 %), not added to
    // the rest fill; another comment's layer under them still adds up
    const focused = new Set<string>();
    for (const id of [...this.idsOf(this.pointed), ...this.idsOf(this.focused), ...this.opened]) {
      if (this.commentRanges.has(id)) focused.add(id);
    }
    const layers: Range[][] = this.layers.map(() => []);
    const strong: Range[] = [];
    for (const [id, ranges] of this.commentRanges) {
      if (focused.has(id)) strong.push(...ranges);
      else layers[this.layerOf.get(id) ?? 0]!.push(...ranges);
    }
    this.layers.forEach((layer, index) => layer.set(layers[index]!));
    this.strong.set(strong);
  }

  dispose(): void {
    for (const layer of this.layers) layer.set(NO_RANGES);
    this.strong.set(NO_RANGES);
    this.pendingShown.set(NO_RANGES);
    this.layerOf = new Map();
    this.commentRanges = NO_RANGE_MAP;
    this.pendingRanges = null;
    this.pointed = this.focused = null;
    this.opened = [];
  }
}

/**
 * Registers `marks` as the surface on its view and runs `rebuild` at most once per frame after `schedule` or a mutation
 * in `observed` that `touches` lets through (any, by default), until `dispose` runs, which clears the marks too.
 */
export function watchSurface(marks: SurfaceMarks, observed: Element, rebuild: () => void, touches: (records: readonly MutationRecord[]) => boolean = () => true): {
  schedule(): void;
  dispose(): void;
} {
  const unregister = registerCommentSurface(marks.view, marks);
  let frame = 0;
  const schedule = (): void => {
    if (frame === 0) frame = window.requestAnimationFrame(() => { frame = 0; rebuild(); });
  };
  const observer = new MutationObserver((records) => { if (frame === 0 && touches(records)) schedule(); });
  observer.observe(observed, { childList: true, subtree: true, characterData: true });
  return {
    schedule,
    dispose() {
      window.cancelAnimationFrame(frame);
      frame = 0;
      observer.disconnect();
      unregister();
      marks.dispose();
    },
  };
}

/**
 * Which text of one chat view's transcript each comment covers, published to the view's `SurfaceMarks`. The text a new
 * comment is being written on is the comment layer's own (MarkdownComments.tsx, the strong fill), not drawn here.
 */
class ViewHighlights {
  /** the parts the ranges lie in: a change in one of them, or its removal, can move or end a range */
  private parts = new Set<Element>();

  constructor(private marks: SurfaceMarks, private transcript: Element) {}

  /**
   * Whether these transcript mutations can touch a highlight: a change inside a commented part or
   * one holding a range, a commented part added, or a part holding a range removed. Another turn
   * streaming touches none, and nor does a card: the comment layer is outside the transcript.
   */
  touches(records: readonly MutationRecord[]): boolean {
    for (const record of records) {
      const element = record.target instanceof Element ? record.target : record.target.parentElement;
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
   * one across parts: what lies between them would be painted too. A segment whose offsets no
   * longer fit the part's text gets none. A range whose boundaries did not move is kept, and the
   * shared highlights are touched only for the ranges that came or went.
   */
  rebuild(): void {
    const next = new Map<string, Range[]>();
    const parts = new Set<Element>();
    for (const part of this.transcript.querySelectorAll(".is-commented")) {
      const found = commentPartOf(part);
      if (found === undefined) continue;
      const segments = partSegments(blockComments.list(found.owner), found.target, found.parts);
      if (addRanges(part, segments, this.marks.comments, next)) parts.add(part);
    }
    this.parts = parts;
    this.marks.publish(next, null);
  }
}

/**
 * Highlights the comments in `view`'s `transcript` until the returned cleanup runs: the ranges
 * are rebuilt at most once per frame after a change in the transcript's DOM that can touch them
 * (a poll that re-rendered a commented reply, a page of history, a code block unfolded) or after
 * any comment changed. A rewrap needs nothing: a range follows its text.
 */
export function watchCommentHighlights(view: Element, transcript: Element): () => void {
  const marks = new SurfaceMarks(view);
  const highlights = new ViewHighlights(marks, transcript);
  const watching = watchSurface(marks, transcript, () => highlights.rebuild(), (records) => highlights.touches(records));
  const unsubscribe = blockComments.subscribe(watching.schedule);
  watching.schedule();
  return () => {
    unsubscribe();
    watching.dispose();
  };
}

/**
 * The field of the saved comment `id` is open on the surface `view` (the element carrying `COMMENT_SURFACE`; several:
 * a count's fields; null: none is): its text takes the strong fill until the field closes, wherever the
 * focus or the pointer goes meanwhile (into the field, out of the card). Kept for the view, so a surface
 * that registers later (its highlights watched anew) shows it too. A new comment has the pending fill instead.
 */
export function showOpenComment(view: Element, id: OpenComments): void {
  if (id === null) openComments.delete(view);
  else openComments.set(view, id);
  surfaces.get(view)?.open(id);
}

/** The pointer entered or left `marker` (a card or a count), or the focus came onto or left it (`on`): its comment's text comes up meanwhile. */
export function activateComment(marker: HTMLElement, by: "pointer" | "focus", on: boolean): void {
  surfaceOf(marker)?.activate(marker, by, on);
}
