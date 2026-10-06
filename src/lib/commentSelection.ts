/**
 * A comment starts from text selected in an agent's final reply (ChatView). This module measures a
 * selection in the own text of a reply part (`.is-commentable`): the offsets `selectionTarget`
 * keeps, and that the highlight maps back to text nodes with `textRange`. Everything but
 * `sliceText`, `spanText`, `floatingPlace`, `lineAt`, `onLine`, `placeAtPointer`, `focusAfter` and `restoreFocusTarget` needs a DOM.
 */
import type { CommentTarget, PartLookup } from "./blockComments.ts";

/** A rendered part that can carry comments: its pane, its target, and the parts of its reply (`replyParts`). */
export interface CommentPart {
  owner: string;
  target: CommentTarget;
  parts: PartLookup;
}

/** The commentable parts on screen, by element: Markdown.tsx adds one while it is mounted and commentable. */
const parts = new WeakMap<Element, CommentPart>();

export function rememberCommentPart(element: Element, part: CommentPart): void { parts.set(element, part); }
export function forgetCommentPart(element: Element): void { parts.delete(element); }
export function commentPartOf(element: Element): CommentPart | undefined { return parts.get(element); }

/** Never text of a reply, neither counted nor seen as selected: comment cards and their form, controls, a code block's header. */
const NOT_TEXT = ".block-comment-notes, .block-comment-card, .markdown-code-header, button:not(.markdown-file)";

/**
 * Not a part's own text (`NOT_TEXT`): its comment cards, its controls (a file path is a button but reads as the
 * text it replaced), a code block's header, anything hidden from assistive technology. KaTeX draws
 * its formula twice, as MathML and as glyphs (aria-hidden): of a formula only its TeX source counts.
 */
const SKIPPED = `${NOT_TEXT}, [aria-hidden='true']`;
/** Elements that start a new line in the quote; a table cell is set off by a space. */
const BLOCK = /^(?:P|DIV|LI|UL|OL|TR|TABLE|PRE|BLOCKQUOTE|H[1-6])$/;

/** A break between two pieces of text: it is not a character of the part's text, only of its quote. */
export interface Separator { sep: string }

/** The part's own text nodes in document order, with the breaks between its lines, rows and cells. */
function partUnits(part: Element): (Text | Separator)[] {
  const units: (Text | Separator)[] = [];
  const walker = document.createTreeWalker(part, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      if (node instanceof Element) return node.matches(SKIPPED) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      const parent = node.parentElement;
      return parent?.closest(".katex") && !parent.closest("annotation") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node instanceof Text) units.push(node);
    else if (node.nodeName === "BR") units.push({ sep: "\n" });
    else if (node.nodeName === "TD" || node.nodeName === "TH") units.push({ sep: " " });
    else if (BLOCK.test(node.nodeName)) units.push({ sep: "\n" });
  }
  return units;
}

/**
 * The text nodes of a part's own content, in document order: what a selection's offsets count.
 * The lengths of these nodes are what `textRange` takes to map offsets back to a DOM range.
 */
export function partTextNodes(part: Element): Text[] {
  return partUnits(part).filter((unit): unit is Text => unit instanceof Text);
}

/**
 * The characters `start`–`end` of text units (`string`s, counted) and separators (not counted):
 * a separator shows only between two selected characters, never twice in a row, and a line break
 * takes the place of a space before it.
 */
export function sliceText(units: readonly (string | Separator)[], start: number, end: number): string {
  let out = "";
  let at = 0;
  for (const unit of units) {
    if (typeof unit === "string") {
      const from = Math.max(start - at, 0);
      const to = Math.min(end - at, unit.length);
      if (to > from) out += unit.slice(from, to);
      at += unit.length;
      if (at >= end) break;
    } else if (out !== "" && at > start && at < end) {
      if (unit.sep === "\n") { if (!out.endsWith("\n")) out = `${out.replace(/ +$/, "")}\n`; }
      else if (!/\s$/.test(out)) out += unit.sep;
    }
  }
  return out;
}

/** A part a selection runs over: its text units (`partUnits`, text as strings) and the selection's offsets in its text. */
export interface PartSlice {
  units: readonly (string | Separator)[];
  start: number;
  end: number;
}

/**
 * Of the parts a selection runs over, in document order, the first and the last whose selected
 * text is not blank (indexes into `slices`), and the quote: the selected text of each part from
 * the first to the last, its trailing spaces dropped, a line break between two parts, a blank one
 * left out. Null when nothing but blanks is selected.
 */
export function spanText(slices: readonly PartSlice[]): { first: number; last: number; text: string } | null {
  let first = -1;
  let last = -1;
  const texts: string[] = [];
  slices.forEach((slice, index) => {
    const text = sliceText(slice.units, slice.start, slice.end);
    if (text.trim() === "") return;
    if (first < 0) first = index;
    last = index;
    texts.push(text.replace(/[ \t]+$/, ""));
  });
  return first < 0 ? null : { first, last, text: texts.join("\n") };
}

/** Where a boundary point lies in the text of `nodes`: the characters of the nodes before it. */
function offsetIn(nodes: readonly Text[], container: Node, offset: number): number {
  const point = document.createRange();
  point.setStart(container, offset);
  let total = 0;
  for (const node of nodes) {
    if (node === container) return total + Math.min(offset, node.length);
    if (point.comparePoint(node, node.length) > 0) break;
    total += node.length;
  }
  return total;
}

/**
 * A boundary inside a formula moves to its edge (before it for a start, after it for an end): a
 * formula is quoted whole, and highlighted whole (its glyphs, not only its hidden MathML).
 */
export function outsideMath(container: Node, offset: number, after: boolean): [Node, number] {
  const element = container instanceof Element ? container : container.parentElement;
  const math = element?.closest(".katex");
  const parent = math?.parentNode;
  if (!math || !parent) return [container, offset];
  const index = Array.prototype.indexOf.call(parent.childNodes, math);
  return [parent, after ? index + 1 : index];
}

/** What a selection in a chat view can be commented as: the part it starts in, and where it ends when it runs on. */
export interface SelectionComment extends CommentPart {
  /** the selected text of all the parts it covers, its lines kept, a line break between parts (`spanText`) */
  text: string;
  /** offsets in the first part's text (`partTextNodes`); `end` stops at the part's end */
  start: number;
  end: number;
  /** a selection over several parts: the last part with selected text, and the offset in its text where it ends */
  until?: CommentPart & { end: number };
  /**
   * Where the button goes, measured on the user's whole selection (to where it really ends, in this reply): a
   * drag over several paragraphs or list items ends, and the pointer that let go there is, in the last. The last
   * line on screen: a keyboard or touch selection's button goes above or below it.
   */
  placeRect: DOMRect;
  /** every line of selected text on screen, in order (`textRects`): the line under a mouse's release is one of them */
  placeLines: DOMRect[];
}

/**
 * The comment the current selection makes in `view`, or null. It qualifies when it is not
 * collapsed, both ends lie in one reply part's root (`[data-comment-root]`, a final answer), and
 * it selects text that is not blank in a commentable part. It starts in the first such part and,
 * when it runs on over later ones, ends in the last (`until`): an end on a rule, or at the very
 * start of a part (a triple click), belongs to the part before. An end just past the root with
 * nothing selected out there (a triple click on a reply's last paragraph ends at the start of
 * what follows) counts as the root's end.
 */
export function selectionComment(selection: Selection | null, view: Element): SelectionComment | null {
  if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const first = selection.getRangeAt(0);
  const last = selection.getRangeAt(selection.rangeCount - 1);
  const range = document.createRange();
  range.setStart(first.startContainer, first.startOffset);
  range.setEnd(last.endContainer, last.endOffset);
  const root = elementOf(range.startContainer)?.closest("[data-comment-root]");
  if (!root || !view.contains(root)) return null;
  if (elementOf(range.endContainer)?.closest("[data-comment-root]") !== root) {
    const outside = document.createRange();
    outside.setStart(root, root.childNodes.length);
    outside.setEnd(range.endContainer, range.endOffset);
    if (outside.collapsed || outside.toString().trim() !== "") return null;
    range.setEnd(root, root.childNodes.length);
  }
  // the parts the selection reaches into, in document order (no part holds another), measured in their own text
  const from = outsideMath(range.startContainer, range.startOffset, false);
  const to = outsideMath(range.endContainer, range.endOffset, true);
  const parts: CommentPart[] = [];
  const slices: PartSlice[] = [];
  for (const element of root.querySelectorAll(".is-commentable")) {
    const found = range.intersectsNode(element) ? commentPartOf(element) : undefined;
    if (found === undefined) continue;
    const units = partUnits(element);
    const nodes = units.filter((unit): unit is Text => unit instanceof Text);
    parts.push(found);
    slices.push({
      units: units.map((unit) => unit instanceof Text ? unit.data : unit),
      start: offsetIn(nodes, ...from),
      end: offsetIn(nodes, ...to),
    });
  }
  const span = spanText(slices);
  if (span === null) return null;
  const { start, end } = slices[span.first]!;
  const until = span.last === span.first
    ? {}
    : { until: { ...parts[span.last]!, end: slices[span.last]!.end } };
  // the button is placed on the whole selection's text (the root holds both ends: inside the view)
  const rects = textRects(range);
  const placeRect = rects.at(-1) ?? range.getBoundingClientRect();
  const placeLines = rects.length > 0 ? rects : [placeRect];
  return { ...parts[span.first]!, text: span.text, start, end, ...until, placeRect, placeLines };
}

/**
 * Not where a selection shows: as `SKIPPED`, but a formula counts by the glyphs on screen
 * (aria-hidden), not by its MathML, which is there only for assistive technology.
 */
const UNSEEN = `${NOT_TEXT}, .katex-mathml`;

/**
 * The lines of text `range` selects on screen, in document order: the client rects of each text
 * node in it, clipped to its ends, without notes, controls and a code block's header. Not a whole
 * element's box: a part selected whole would be one tall rect around its lines, and the gap
 * between two parts no line.
 */
function textRects(range: Range): DOMRect[] {
  const container = range.commonAncestorContainer;
  const nodes: Text[] = [];
  if (container instanceof Text) nodes.push(container);
  else {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if (node instanceof Text && range.intersectsNode(node)) nodes.push(node);
    }
  }
  const rects: DOMRect[] = [];
  for (const node of nodes) {
    if (node.parentElement?.closest(UNSEEN)) continue;
    const piece = document.createRange();
    piece.selectNodeContents(node);
    if (node === range.startContainer) piece.setStart(node, range.startOffset);
    if (node === range.endContainer) piece.setEnd(node, range.endOffset);
    for (const rect of piece.getClientRects()) if (rect.width > 0 && rect.height > 0) rects.push(rect);
  }
  return rects;
}

function elementOf(node: Node): Element | null {
  return node instanceof Element ? node : node.parentElement;
}

/**
 * Where a floating button of `size` goes for a selection whose line is `anchor`, both in the
 * coordinates of the visible `view`: centred on the anchor's `right`, `gap` above it (or below it,
 * where a touch screen's own menu takes the space above), on the other side when its own has no
 * room and the other has, and `margin` inside the view's sides.
 */
export function floatingPlace(
  anchor: { top: number; bottom: number; right: number },
  view: { width: number; height: number },
  size: { width: number; height: number },
  { below, gap, margin }: { below: boolean; gap: number; margin: number },
): { left: number; top: number } {
  const left = Math.max(margin, Math.min(anchor.right - size.width / 2, view.width - size.width - margin));
  const above = anchor.top - gap - size.height;
  const under = anchor.bottom + gap;
  const fitsAbove = above >= 0;
  const fitsUnder = under + size.height <= view.height;
  const top = below ? (!fitsUnder && fitsAbove ? above : under) : (!fitsAbove && fitsUnder ? under : above);
  return { left, top };
}

/**
 * The line of a selection a mouse let go on: the one whose vertical span holds `y` (the thinnest of
 * them: a block selected whole is one tall box around its lines), else the nearest. Null for none.
 */
export function lineAt<T extends { top: number; bottom: number }>(lines: readonly T[], y: number): T | null {
  let best: T | null = null;
  let bestGap = Infinity;
  for (const line of lines) {
    const gap = y < line.top ? line.top - y : y > line.bottom ? y - line.bottom : 0;
    if (gap < bestGap || (gap === bestGap && best !== null && line.bottom - line.top < best.bottom - best.top)) {
      best = line;
      bestGap = gap;
    }
  }
  return best;
}

/**
 * Whether `y` lies on one of a selection's `lines` (edges included): a mouse's release still stands
 * for a selection that changed only where it is on one of its lines.
 */
export function onLine(lines: readonly { top: number; bottom: number }[], y: number): boolean {
  return lines.some((line) => y >= line.top && y <= line.bottom);
}

/**
 * `floatingPlace` for a button that follows a pointer: centred on the pointer's x, on the line of
 * `lines` under (or nearest to) its y, all in the coordinates of the visible `view`. Without lines
 * the pointer's own height is the line.
 */
export function placeAtPointer(
  lines: readonly { top: number; bottom: number }[],
  pointer: { x: number; y: number },
  view: { width: number; height: number },
  size: { width: number; height: number },
  options: { below: boolean; gap: number; margin: number },
): { left: number; top: number } {
  const line = lineAt(lines, pointer.y) ?? { top: pointer.y, bottom: pointer.y };
  return floatingPlace({ top: line.top, bottom: line.bottom, right: pointer.x }, view, size, options);
}

/**
 * The cards of one host (their anchors, in reading order) that take the focus, in order of
 * preference, when the card `removed` leaves it: the ones after it, nearest first, then the ones
 * before it, nearest first. Not just the two next to it: one of them can be an open form, which
 * has no Edit button (`firstEditButton` takes the first that has one). Empty when nothing else is
 * there; the caller then falls back to the pane's composer.
 */
export function focusAfter(anchors: readonly string[], removed: string): string[] {
  const at = anchors.indexOf(removed);
  if (at < 0) return [];
  return [...anchors.slice(at + 1), ...anchors.slice(0, at).reverse()];
}

/** The composer's field of the pane a chat view is in; null without one. */
export function paneComposer(view: Element | null): HTMLElement | null {
  return view?.closest(".terminal-stack")?.querySelector<HTMLElement>(".composer-text") ?? null;
}

/** The first of the cards at `anchors` (in order of preference) in the chat `view` that has an Edit button, which is that button; null for none. */
export function firstEditButton(view: Element | null, anchors: readonly string[]): HTMLElement | null {
  if (view === null) return null;
  const cards = [...view.querySelectorAll<HTMLElement>(".block-comment-card[data-comment-anchor]")];
  for (const anchor of anchors) {
    const button = cards.find((card) => card.dataset.commentAnchor === anchor)?.querySelector<HTMLElement>(".block-comment-edit");
    if (button) return button;
  }
  return null;
}

/**
 * What a closing comment editor gives the focus back to: its opener while that is still in the
 * document, else `fallback` (a deleted comment takes its own card, the opener, with it). A modal
 * focuses whatever that is; an inline form (`inline`) only an element that is in the document, so it
 * leaves the focus where it is otherwise. On a touch screen (`coarse`) the fallback is a composer's
 * field, and focusing it raises the keyboard unasked: the focus is only let go (null).
 */
export function restoreFocusTarget<T extends { isConnected: boolean }>(opener: T | null, fallback: T | null, inline: boolean, coarse = false): T | null {
  const to = opener?.isConnected ? opener : fallback;
  if (coarse && to === fallback) return null;
  return !inline || to?.isConnected ? to : null;
}
