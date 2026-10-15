/**
 * The point a comment made by a click once kept (`CommentPoint`), which stored entries still carry and `isCommentPoint`
 * still reads. Pure, no DOM.
 */

/**
 * A point on a comment's text as a click once made it: fractions of the bounding box of its highlighted text, 0 at the
 * box's left or top, 1 at its right or bottom. A click right of a short heading is `x > 1`. Nothing draws it now; a
 * stored comment keeps it only so stored entries round-trip (`BlockComment.point`, `FileComment.point`).
 */
export interface CommentPoint { x: number; y: number }

/** The fractions a stored `CommentPoint` may take: anything else is no point (`isCommentPoint`). */
const POINT_BOUNDS = { x: [-1, 8], y: [-1, 2] } as const;

const within = (value: unknown, [low, high]: readonly [number, number]): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= low && value <= high;

/** Whether a stored value is a point: finite fractions inside `POINT_BOUNDS`. */
export function isCommentPoint(value: unknown): value is CommentPoint {
  if (typeof value !== "object" || value === null) return false;
  const { x, y } = value as Record<string, unknown>;
  return within(x, POINT_BOUNDS.x) && within(y, POINT_BOUNDS.y);
}
