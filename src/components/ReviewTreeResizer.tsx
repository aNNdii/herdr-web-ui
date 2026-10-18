import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { useT } from "../lib/i18n.ts";
import { clampReviewTreeWidth, keyedReviewTreeWidth, REVIEW_TREE_MIN_WIDTH, reviewTreeMaxWidth, storeReviewTreeWidth } from "../lib/reviewTreeWidth.ts";

export interface ReviewTreeResizerProps {
  /** the chosen width in px; null is the default one */
  width: number | null;
  onResize(width: number | null): void;
}

/**
 * The review tree column's right edge: drag it or move it with the arrow keys, double-click to go back to the default
 * width. Drawn in `.review-body`, in the column's grid area (the tree's pane clips what overflows it); the body's grid
 * track draws the limits, so a width is stored as chosen and only a real move stores one.
 */
export function ReviewTreeResizer({ width, onResize }: ReviewTreeResizerProps) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ left: number; grip: number; width: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  // what the column measures now: the default width is a track, and a narrow body caps a chosen one
  const [shown, setShown] = useState(width ?? REVIEW_TREE_MIN_WIDTH);
  // the widest the keys allow in this body
  const [limit, setLimit] = useState(REVIEW_TREE_MIN_WIDTH);
  const body = (): HTMLElement | null => ref.current?.parentElement ?? null;
  const pane = (): HTMLElement | null => body()?.querySelector<HTMLElement>(".review-tree-pane") ?? null;
  const bodyWidth = (): number => body()?.getBoundingClientRect().width ?? Number.POSITIVE_INFINITY;
  const measure = (): number => {
    const measured = Math.round(pane()?.getBoundingClientRect().width ?? 0);
    // a column that measures nothing keeps the last width it showed as the value
    if (measured > 0) setShown(measured);
    setLimit(reviewTreeMaxWidth(bodyWidth()));
    return measured > 0 ? measured : shown;
  };
  useLayoutEffect(() => { measure(); }, [width]);
  useEffect(() => {
    const element = body();
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => { measure(); });
    observer.observe(element);
    const column = pane();
    if (column) observer.observe(column);
    return () => observer.disconnect();
  }, []);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    const column = pane()?.getBoundingClientRect();
    if (!column) return;
    // no text selection in the tree or the file while the edge moves
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { left: column.left, grip: event.clientX - column.right, width: Math.round(column.width), moved: false };
    setDragging(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const state = drag.current;
    if (!state) return;
    // the column's left edge stays put, so the width is what lies between it and the grip
    const next = clampReviewTreeWidth(event.clientX - state.grip - state.left, bodyWidth());
    if (next === state.width) return;
    state.width = next;
    state.moved = true;
    onResize(next);
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>): void => {
    const state = drag.current;
    if (!state) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    // a press that moved nothing chooses no width
    if (state.moved) storeReviewTreeWidth(state.width);
  };
  const reset = (): void => {
    storeReviewTreeWidth(null);
    onResize(null);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const next = keyedReviewTreeWidth(measure(), event.key, bodyWidth());
    if (next === null) return;
    event.preventDefault();
    storeReviewTreeWidth(next);
    onResize(next);
  };

  return (
    <div
      ref={ref}
      className={`review-tree-resizer${dragging ? " is-dragging" : ""}`}
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={t("Resize file tree")}
      aria-valuemin={REVIEW_TREE_MIN_WIDTH}
      aria-valuemax={limit}
      aria-valuenow={shown}
      title={t("Drag to resize · double-click to reset")}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={reset}
      onFocus={measure}
      onKeyDown={onKeyDown}
    />
  );
}
