/**
 * From a browser selection over rendered Markdown to the part of it that can be commented on. A drag can start or
 * end anywhere: on the white space between blocks, on a code block's language label, in the comment UI, past the text
 * in the margin (where Chrome extends the selection to the end of the document, or to its start when dragged
 * backwards), or in a second reply. The comment layer (components/MarkdownComments.tsx) clamps the selection here
 * before its surface measures it (the preview: lib/fileCommentDom.ts `measureFileSelection`), and draws it as `textRanges`.
 */
import { outsideMath, partTextNodes } from "./commentSelection.ts";

/**
 * The unit a drag released beside the text at height `y` belongs to: the last unit whose top is at or above `y`, else
 * the first. `units` are in document order, their spans in the same coordinates as `y`. Only `top` decides, so a
 * release in the gap between two units belongs to the unit above (and one below the last, to the last); `bottom` is
 * not read.
 */
export function releaseBlock(blocks: readonly { top: number; bottom: number }[], y: number): number {
  let found = 0;
  blocks.forEach((block, index) => { if (block.top <= y) found = index; });
  return found;
}

/** The part of one text node that a range covers. */
interface Slice { node: Text; from: number; to: number }

/** The non-blank parts of `range` that lie in `nodes`, in document order. */
function slicesOf(range: Range, nodes: readonly Text[]): Slice[] {
  const slices: Slice[] = [];
  for (const node of nodes) {
    // comparePoint: -1 before the range, 0 inside it (its boundary included), 1 after it. A node the range only
    // starts or ends in is its own container, so its offsets are the range's; any other node is covered whole or not.
    const from = node === range.startContainer ? range.startOffset : range.comparePoint(node, 0) === 0 ? 0 : -1;
    const to = node === range.endContainer ? range.endOffset : range.comparePoint(node, node.length) === 0 ? node.length : -1;
    if (from >= 0 && to > from && node.data.slice(from, to).trim() !== "") slices.push({ node, from, to });
  }
  return slices;
}

/** The blocks of text a release can cut at, when the Markdown has no source lines (the chat): a list item, row, paragraph, heading or code line. */
const TEXT_BLOCK = "li, tr, p, h1, h2, h3, h4, h5, h6, .hl-line";

/**
 * The unit of `root` a piece of text belongs to, which a release height cuts at: the innermost line element of the
 * preview (`[data-source-line]`: a table row, a list item's text, one line of a code block or a paragraph), else the
 * nearest list item, row, paragraph, heading or code line (the chat has no source lines), else the root's child that
 * holds it (or the root itself for text directly in it).
 */
function unitOf(root: Element, node: Text): Element {
  const parent = node.parentElement;
  for (const found of [parent?.closest("[data-source-line]"), parent?.closest(TEXT_BLOCK)]) {
    if (found != null && found !== root && root.contains(found)) return found;
  }
  let child: Node = node;
  while (child.parentNode !== null && child.parentNode !== root) child = child.parentNode;
  return child instanceof Element ? child : root;
}

/**
 * The part of `range` that is commentable text, or null when none is left. Only the first root (of `roots`, in
 * document order) that holds selected text counts: a selection across two replies is the first reply's. Inside it the
 * range runs from its first to its last selected text (`partTextNodes`: never a code block's label, the comment UI or
 * anything aria-hidden), so an end on white space between blocks, on a label or past the root moves into the nearest
 * text on the selection's side. An end inside a formula takes the formula whole (`outsideMath`), also when only its
 * drawn glyphs were selected.
 *
 * `release` is where the mouse button went up, and `backward` whether the drag went from later text to earlier (the
 * selection's focus before its anchor; a `Range` has no direction, so the caller says). When the release is beside
 * the text (x outside every root's box), the end the drag was extending is cut back to the unit at the release height
 * (`unitOf`, `releaseBlock`) instead of wherever Chrome ran the selection on to: the end of that unit for a forward
 * drag, the start of it for a backward one; the other end stays. The result is a plain `Range`: the caller sets the
 * visible selection to it and reapplies the direction with `Selection.setBaseAndExtent`.
 */
export function clampSelection(range: Range, roots: readonly Element[], release?: { x: number; y: number; backward: boolean }): Range | null {
  const whole = range.cloneRange();
  whole.setStart(...outsideMath(range.startContainer, range.startOffset, false));
  whole.setEnd(...outsideMath(range.endContainer, range.endOffset, true));
  const ordered = [...roots].sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  for (const root of ordered) {
    const slices = slicesOf(whole, partTextNodes(root));
    if (slices.length === 0) continue;
    let first = slices[0]!;
    let last = slices[slices.length - 1]!;
    if (release !== undefined && ordered.every((element) => { const box = element.getBoundingClientRect(); return release.x < box.left || release.x > box.right; })) {
      // Beside the text: the units the selection touches in document order; the release height names the one to cut at.
      const units = [...new Set(slices.map((slice) => unitOf(root, slice.node)))];
      const cut = units[releaseBlock(units.map((unit) => unit.getBoundingClientRect()), release.y)];
      if (release.backward) first = slices.find((slice) => unitOf(root, slice.node) === cut) ?? first;
      else last = slices.filter((slice) => unitOf(root, slice.node) === cut).pop() ?? last;
    }
    const clamped = root.ownerDocument.createRange();
    clamped.setStart(first.node, first.from);
    clamped.setEnd(last.node, last.to);
    return clamped;
  }
  return null;
}

/**
 * `range`'s text in `roots` as one range per text node it covers (`partTextNodes`: never a code block's label, the comment
 * UI or anything aria-hidden), blank pieces left out: what a highlight of it paints, which never reaches the comment UI
 * or a label between the blocks it spans. Its first range starts the selection's first line box, its last ends the last.
 */
export function textRanges(range: Range, roots: readonly Element[]): Range[] {
  return roots.flatMap((root) => slicesOf(range, partTextNodes(root)).map(({ node, from, to }) => {
    const piece = node.ownerDocument.createRange();
    piece.setStart(node, from);
    piece.setEnd(node, to);
    return piece;
  }));
}
