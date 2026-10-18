/** The review's file tree column when the user has dragged its edge: per device, like the file panel's. */
const KEY = "herdr-web-ui:review-tree-width";

export const REVIEW_TREE_MIN_WIDTH = 200;
const REVIEW_TREE_MAX_WIDTH = 640;
/** what the column leaves to the file beside it */
const REVIEW_FILE_MIN_WIDTH = 360;
/** one arrow key press on the focused edge */
export const REVIEW_TREE_WIDTH_STEP = 16;
/** the column's width until the user chooses one */
const DEFAULT_COLUMN = "clamp(260px, 22%, 440px)";

/** The widest the column may be in a body this wide; never below the minimum. */
export function reviewTreeMaxWidth(bodyWidth: number): number {
  return Math.max(REVIEW_TREE_MIN_WIDTH, Math.min(REVIEW_TREE_MAX_WIDTH, Math.floor(bodyWidth - REVIEW_FILE_MIN_WIDTH)));
}

export function clampReviewTreeWidth(width: number, bodyWidth = Number.POSITIVE_INFINITY): number {
  return Math.round(Math.min(reviewTreeMaxWidth(bodyWidth), Math.max(REVIEW_TREE_MIN_WIDTH, width)));
}

/** Where a key moves the edge from the width `shown`; the edge is the column's right one, so ArrowRight widens. Null for a key that is not the edge's. */
export function keyedReviewTreeWidth(shown: number, key: string, bodyWidth: number): number | null {
  if (key === "ArrowRight") return clampReviewTreeWidth(shown + REVIEW_TREE_WIDTH_STEP, bodyWidth);
  if (key === "ArrowLeft") return clampReviewTreeWidth(shown - REVIEW_TREE_WIDTH_STEP, bodyWidth);
  if (key === "Home") return REVIEW_TREE_MIN_WIDTH;
  if (key === "End") return reviewTreeMaxWidth(bodyWidth);
  return null;
}

/**
 * The column's grid track. The limits are drawn here and only here, against the body's own width,
 * so a stored width a narrow window caps comes back once the window is wide enough again.
 */
export function reviewTreeColumn(width: number | null): string {
  const chosen = width === null ? DEFAULT_COLUMN : `${Math.round(width)}px`;
  const max = `max(${REVIEW_TREE_MIN_WIDTH}px, min(${REVIEW_TREE_MAX_WIDTH}px, 100% - ${REVIEW_FILE_MIN_WIDTH}px))`;
  return `clamp(${REVIEW_TREE_MIN_WIDTH}px, ${chosen}, ${max})`;
}

/** The stored value as a width, unclamped (the track caps it), or null when nothing usable is stored. */
export function parseReviewTreeWidth(stored: string | null): number | null {
  if (stored === null || !/^\d+$/.test(stored)) return null;
  return Number(stored);
}

export function storedReviewTreeWidth(): number | null {
  try {
    return parseReviewTreeWidth(window.localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

/** Stores the width as chosen, never clamped; null forgets it and the column goes back to its default width. */
export function storeReviewTreeWidth(width: number | null): void {
  try {
    if (width === null) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, String(Math.round(width)));
  } catch {
    /* private mode: the width simply is not remembered */
  }
}
