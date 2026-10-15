import type { CommentLayout } from "./settings.ts";

/** Width of the card margin beside the text. */
export const MARGIN_W = 280;
/** Clear space between the text and the card margin. */
export const MARGIN_GAP = 24;
/** Width of the count column. */
export const COUNT_W = 24;
/** Clear space between the text and the count column. */
export const COUNT_GAP = 4;
/** Where a count's bubble (about 16 px wide) starts in its column: centred in `COUNT_W`. */
export const COUNT_INSET = 4;
/** A finger's count target: 44 px wide at least (CommentMargin.css `max(44px, --touch-target)`). */
export const TOUCH_TARGET_PX = 44;
/** Vertical space between two stacked cards. */
export const CARD_GAP = 8;
/** On touch, counts whose tops are closer than this merge (a 44 px target plus the 8 px gap). */
export const TOUCH_MERGE_PX = 52;

/** Two tops within this many px sit on the same visual line. */
const SAME_LINE_PX = 1;

/** The room beside a text, in one horizontal coordinate space (client pixels): what `marginLayout` decides from. */
export interface MarginRoom {
  /** the right edge of the text's glyphs: its box's content edge (the text's own padding right of it is free space) */
  textRight: number;
  /** the right edge of what the container shows: its padding box (its padding is free space too), no scrollbar */
  containerRight: number;
  /** what the chat's minimap keeps free at the container's right edge: 0 where it shows on the other side, or not at all */
  minimapGutter: number;
  /** Settings → Comments beside the text */
  wanted: CommentLayout;
  /** a finger's targets (`(pointer: coarse)`): a count's is `TOUCH_TARGET_PX` wide */
  coarse: boolean;
}

/** Where the margin goes beside a text: how comments show, and where. */
export interface MarginPlace {
  layout: CommentLayout;
  /** the margin's left edge: its cards', or its count column's (a count's bubble starts `COUNT_INSET` into it) */
  x: number;
  /** what takes a press: a card's box, or a count's target (never over the text's glyphs, never past the container's edge) */
  target: { left: number; width: number };
}

/**
 * Decides how comments show beside a text, and where, from the free space right of it: between its glyphs' right edge
 * and the container's right edge (the text's own right padding, whatever lies between its box and the container, and the
 * container's padding), less the minimap's gutter where the minimap is on that side. The text is never moved or narrowed
 * for the margin: it is only measured.
 *
 * - **Cards** where the free space holds the gap and the card margin (`MARGIN_GAP` + `MARGIN_W`), `MARGIN_GAP` right of
 *   the glyphs; otherwise counts, whatever the setting says.
 * - **Counts** `COUNT_GAP` right of the glyphs where the free space holds them (a mouse: the column, which is its target;
 *   a finger: its 44 px target, from the glyphs' edge); otherwise the column sits at the container's edge, inside its
 *   padding, its bubble never left of the glyphs' edge (with less room than the bubble it runs past the edge rather than
 *   over the text), and its target spans what is free there, up to its width: from the glyphs' edge at most, to the
 *   container's edge at most.
 *
 * Only the room and the setting decide (touch alone does not force counts, and whether there are comments does not
 * matter), so nothing moves as the first comment is saved, and the text is where it is with comments off.
 */
export function marginLayout(room: MarginRoom): MarginPlace {
  const edge = room.containerRight - room.minimapGutter;
  const free = edge - room.textRight;
  if (room.wanted === "cards" && free >= MARGIN_GAP + MARGIN_W) {
    const x = room.textRight + MARGIN_GAP;
    return { layout: "cards", x, target: { left: x, width: MARGIN_W } };
  }
  const beside = room.textRight + COUNT_GAP;
  if (room.coarse ? free >= TOUCH_TARGET_PX : free >= COUNT_GAP + COUNT_W) {
    return { layout: "counts", x: beside, target: room.coarse ? { left: room.textRight, width: TOUCH_TARGET_PX } : { left: beside, width: COUNT_W } };
  }
  const x = Math.max(edge - COUNT_W, room.textRight - COUNT_INSET);
  const left = Math.max(room.textRight, edge - (room.coarse ? TOUCH_TARGET_PX : COUNT_W));
  return { layout: "counts", x, target: { left, width: Math.max(0, edge - left) } };
}

/**
 * Places margin cards in reading order. Each card sits at the top it wants, or just below the
 * previous card when that would overlap it: cards are only ever pushed down, never up.
 */
export function placeCards(cards: readonly { id: string; want: number; height: number }[]): Map<string, number> {
  const tops = new Map<string, number>();
  let previousBottom = Number.NEGATIVE_INFINITY;
  for (const card of cards) {
    const top = Math.max(card.want, previousBottom + CARD_GAP);
    tops.set(card.id, top);
    previousBottom = top + card.height;
  }
  return tops;
}

/**
 * The order the focus goes in when the card `removed` leaves it (the code view's cards, CodeComments.tsx, and the
 * Markdown margin's, CommentMargin.tsx): of the cards' ids in reading order (`anchors`), the ones after it, nearest
 * first, then the ones before it, nearest first. Not just the two next to it: one of them can be missing or not placed
 * (a card not drawn), and the caller takes the first that can take the focus. Empty when nothing else is there; the
 * caller then falls back (the comment mode's toggle, the pane's composer).
 */
export function focusAfter(anchors: readonly string[], removed: string): string[] {
  const at = anchors.indexOf(removed);
  if (at < 0) return [];
  return [...anchors.slice(at + 1), ...anchors.slice(0, at).reverse()];
}

/**
 * Groups the line tops where comments start into counts. Comments that start on the same visual
 * line (tops within 1 px) share a count. On touch a count whose top is less than `TOUCH_MERGE_PX`
 * below the previous count's top merges into it and keeps that first top. Ids stay in reading order.
 */
export function groupCounts(
  starts: readonly { id: string; top: number }[],
  touch: boolean,
): { top: number; ids: string[] }[] {
  const groups: { top: number; ids: string[] }[] = [];
  for (const start of starts) {
    const sameLine = groups.find((group) => Math.abs(group.top - start.top) <= SAME_LINE_PX);
    const previous = groups[groups.length - 1];
    const target = sameLine ?? (touch && previous && start.top - previous.top < TOUCH_MERGE_PX ? previous : undefined);
    if (target) target.ids.push(start.id);
    else groups.push({ top: start.top, ids: [start.id] });
  }
  return groups;
}
