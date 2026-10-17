/**
 * Where the comment field over a selection goes (components/MarkdownComments.tsx), without the DOM: below the
 * selection's last line, `FIELD_GAP_PX` clear of it, growing downward, where the Comment button was; without room below
 * in the body's view, above the first line, its bottom there, growing upward. Sideways it is centred on where the
 * selection ends (as the button is), kept inside the scrolling body. All boxes are client pixels; the place is in the
 * body's content coordinates (an absolutely placed child of the scrolling body, which is its containing block).
 *
 * And how far that body scrolls, only it and never the page, to show what the layer opens: a field as it opens
 * (`revealBy`), and a comment the composer's walk stops at with its card or count (`walkScroll`,
 * components/useMarkdownCommentWalk.ts).
 *
 * And where the Comment button goes, which a selection shows instead of the field where Settings say so (`buttonPlace`,
 * components/SelectionButton.tsx): under the selection's last line, near its end.
 */

/** How far the field stays clear of the selection's text. */
export const FIELD_GAP_PX = 8;

export interface FieldPlace {
  /** above the selection: `top` is where the field's bottom edge goes; below it, where its top edge goes */
  above: boolean;
  top: number;
  left: number;
}

/**
 * The field's place for a selection whose first line box starts at `first` and whose last line box ends at
 * `last.bottom` (and `last.right`, where the selection ends), in the scrolling body's client area `view`, scrolled by
 * `scroll`. `field` is its size; `inset` the room it keeps from the body's sides. `above` keeps the side chosen as it
 * opened (a field growing as text wraps does not flip); without it the field goes below when the body's view has room
 * there, else above when it has room there, else below all the same. Without `last.right` it starts at the first line.
 */
export function fieldPlace({ first, last, view, scroll, field, inset, above }: {
  first: { top: number; left: number };
  /** where the selection ends (`right`): the field is centred there, as the Comment button is; unset, it starts at the first line */
  last: { bottom: number; right?: number };
  view: { top: number; left: number; width: number; height: number };
  scroll: { top: number; left: number };
  field: { width: number; height: number };
  inset: number;
  above?: boolean;
}): FieldPlace {
  // below the last line when the view has room there, else above the first line (if there is room there)
  const roomBelow = last.bottom + FIELD_GAP_PX + field.height <= view.top + view.height - inset;
  const roomAbove = first.top - FIELD_GAP_PX - field.height >= view.top + inset;
  const up = above ?? (!roomBelow && roomAbove);
  const top = up ? first.top - view.top + scroll.top - FIELD_GAP_PX : last.bottom - view.top + scroll.top + FIELD_GAP_PX;
  const min = scroll.left + inset;
  const max = scroll.left + view.width - field.width - inset;
  const start = last.right === undefined ? first.left - view.left + scroll.left : last.right - view.left + scroll.left - field.width / 2;
  const left = max < min ? min : Math.min(Math.max(start, min), max);
  return { above: up, top, left };
}

/** How far the Comment button stays clear of the selection's text. */
export const BUTTON_GAP_PX = 8;

/**
 * The Comment button's place for a selection whose first line box starts at `first.top` and whose last line box ends at
 * `last` (its bottom, and its right edge: where the selection ends), in the scrolling body's client area `view`,
 * scrolled by `scroll`; `button` is its size, `inset` the room it keeps from the body's sides and bottom. It goes
 * `BUTTON_GAP_PX` under the last line, centred on the selection's end, kept inside the body sideways; without room
 * below it in the body's view, as far above the first line, if there is room there (else below all the same).
 */
export function buttonPlace({ first, last, view, scroll, button, inset }: {
  first: { top: number };
  last: { bottom: number; right: number };
  view: { top: number; left: number; width: number; height: number };
  scroll: { top: number; left: number };
  button: { width: number; height: number };
  inset: number;
}): { below: boolean; top: number; left: number } {
  const roomBelow = last.bottom + BUTTON_GAP_PX + button.height <= view.top + view.height - inset;
  const roomAbove = first.top - BUTTON_GAP_PX - button.height >= view.top + inset;
  const below = roomBelow || !roomAbove;
  const top = below ? last.bottom - view.top + scroll.top + BUTTON_GAP_PX : first.top - view.top + scroll.top - BUTTON_GAP_PX - button.height;
  const min = scroll.left + inset;
  const max = scroll.left + view.width - button.width - inset;
  const left = max < min ? min : Math.min(Math.max(last.right - view.left + scroll.left - button.width / 2, min), max);
  return { below, top, left };
}

/**
 * How far the scrolling body (its client area's top and height on screen) scrolls to show the field (`field`, its
 * box on screen) with `inset` to spare: nothing while it is in view, else just as far as needed; a field taller than the
 * view shows its top.
 */
export function revealBy(field: { top: number; bottom: number }, view: { top: number; height: number }, inset: number): number {
  const top = view.top + inset;
  const bottom = view.top + view.height - inset;
  if (field.top < top || field.bottom - field.top > bottom - top) return field.top - top;
  if (field.bottom > bottom) return field.bottom - bottom;
  return 0;
}

/**
 * How far the scrolling `view` (its top and height on screen) scrolls for the composer's walk to show a
 * comment's text and its `marker` (the Markdown comment layer's: its card or count): both in the middle when they fit,
 * else the marker's bottom at the view's bottom, so the card or count the walk focuses is on screen.
 */
export function walkScroll(text: { top: number; bottom: number }, marker: { top: number; bottom: number }, view: { top: number; height: number }): number {
  const top = Math.min(text.top, marker.top);
  const bottom = Math.max(text.bottom, marker.bottom);
  return bottom - top > view.height ? marker.bottom - (view.top + view.height) : (top + bottom) / 2 - (view.top + view.height / 2);
}
