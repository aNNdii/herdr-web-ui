import { DIFFS_TAG_NAME } from "@pierre/diffs";

import type { DiffRow } from "./diffSides.ts";

/**
 * The one place that knows how `@pierre/diffs` draws its rows: a code row carries its line number (`data-line`) and its
 * kind (`data-line-type`), in a `<code>` column of the file's shadow root; a split view's left column is
 * `[data-deletions]`, its right one `[data-additions]`. Hunk separators, annotations and the gutter are no code rows.
 */

/** A code row, or anything inside one. */
const ROW = "[data-line]";
/** A split view's left column, where every row has the old file's numbers. */
const LEFT_COLUMN = "[data-deletions]";

/** How many frames `revealRow` keeps correcting a row that is not drawn yet (a virtualized file draws as it scrolls). */
const REVEAL_FRAMES = 30;

/** What a row element says about itself: its attributes, and whether it is in a split view's left column. */
export interface RowFacts { line: string | null; lineType: string | null; leftColumn: boolean }

/**
 * The row these facts name: its number, in the old file's numbering for a removed line or any row of a split view's
 * left column (an unchanged line there has its old number too). Null for a row without a line number.
 */
export function rowFrom({ line, lineType, leftColumn }: RowFacts): DiffRow | null {
  // a missing or empty attribute reads as 0, no line
  const number = Number(line);
  if (!Number.isInteger(number) || number < 1) return null;
  return { line: number, old: (lineType ?? "").includes("deletion") || leftColumn };
}

/** The drawn row `element` is, or is in; null outside a code row. */
export function rowOf(element: Element): DiffRow | null {
  const row = element.closest(ROW);
  if (row === null) return null;
  return rowFrom({ line: row.getAttribute("data-line"), lineType: row.getAttribute("data-line-type"), leftColumn: row.closest(LEFT_COLUMN) !== null });
}

/**
 * Whether the cursor stands on this drawn row: in a split view a removed line on the left and every row on the right
 * (the left column's unchanged lines are the right one's again); in any other view every row.
 */
export function cursorStandsOn({ lineType, leftColumn }: Pick<RowFacts, "lineType" | "leftColumn">): boolean {
  return !leftColumn || (lineType ?? "").includes("deletion");
}

/** The shadow roots the library draws the file in, inside `body`. */
function drawnRoots(body: HTMLElement): ShadowRoot[] {
  return [...body.querySelectorAll(DIFFS_TAG_NAME)].flatMap((host) => (host.shadowRoot === null ? [] : [host.shadowRoot]));
}

/** The element that draws `row` inside `body`; null while it is not drawn (folded away, or not yet in a virtualized file). */
export function rowElement(body: HTMLElement, row: DiffRow): HTMLElement | null {
  for (const root of drawnRoots(body)) {
    for (const element of root.querySelectorAll<HTMLElement>(`[data-line="${row.line}"]`)) {
      const drawn = rowOf(element);
      if (drawn !== null && drawn.old === row.old) return element;
    }
  }
  return null;
}

/** The part of `scroller` the user sees, in client pixels. */
function viewOf(scroller: HTMLElement): { top: number; bottom: number } {
  const box = scroller.getBoundingClientRect();
  const top = box.top + scroller.clientTop;
  return { top, bottom: top + scroller.clientHeight };
}

/**
 * The index of the first item whose top is at or below `top`, for items in order from the top (a column's rows), read
 * by halving so a long file's rows are not all measured; `items.length` when none is.
 */
export function firstAtOrBelow<T>(items: ArrayLike<T>, topOf: (item: T) => number, top: number): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (topOf(items[middle]!) >= top) high = middle;
    else low = middle + 1;
  }
  return low;
}

/**
 * The first row the cursor can stand on that is wholly in `scroller`'s view (in a split view a removed line on the left,
 * else one on the right); a row level with another is the removed one, as unified order puts it first. Null when none is.
 */
export function firstVisibleRow(body: HTMLElement, scroller: HTMLElement): DiffRow | null {
  const view = viewOf(scroller);
  let best: { row: DiffRow; top: number } | null = null;
  for (const root of drawnRoots(body)) {
    for (const column of root.querySelectorAll<HTMLElement>("[data-code]")) {
      const leftColumn = column.matches(LEFT_COLUMN);
      const rows = column.querySelectorAll<HTMLElement>(ROW);
      const topOf = (element: HTMLElement): number => element.getBoundingClientRect().top;
      for (let index = firstAtOrBelow(rows, topOf, view.top); index < rows.length; index++) {
        const element = rows[index]!;
        const box = element.getBoundingClientRect();
        if (box.bottom > view.bottom || best !== null && box.top > best.top) break;
        if (!cursorStandsOn({ lineType: element.getAttribute("data-line-type"), leftColumn })) continue;
        const row = rowOf(element);
        if (row !== null && (best === null || box.top < best.top || box.top === best.top && row.old)) best = { row, top: box.top };
        break;
      }
    }
  }
  return best?.row ?? null;
}

/** Whether `row` is drawn and at least partly in `scroller`'s view. */
export function rowInView(body: HTMLElement, scroller: HTMLElement, row: DiffRow): boolean {
  const element = rowElement(body, row);
  if (element === null) return false;
  const box = element.getBoundingClientRect();
  const view = viewOf(scroller);
  return box.bottom > view.top && box.top < view.bottom;
}

/** How far `scroller` scrolls so the box is in its view: just into it (`nearest`), or into its middle (`center`). */
export function scrollToShow(box: { top: number; bottom: number }, view: { top: number; bottom: number }, block: "nearest" | "center"): number {
  if (block === "center") return (box.top + box.bottom) / 2 - (view.top + view.bottom) / 2;
  if (box.top < view.top || box.bottom - box.top > view.bottom - view.top) return box.top - view.top;
  if (box.bottom > view.bottom) return box.bottom - view.bottom;
  return 0;
}

/**
 * Where an undrawn row's top would be, in client pixels, from the drawn rows of its side: their spacing carried on from
 * the nearest of them. Null without two numbers to go by.
 */
export function estimatedTop(drawn: readonly { line: number; top: number }[], line: number): number | null {
  if (drawn.length === 0) return null;
  const sorted = [...drawn].sort((a, b) => a.line - b.line);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  if (last.line === first.line) return null;
  const perLine = (last.top - first.top) / (last.line - first.line);
  const from = line < first.line ? first : last;
  return from.top + (line - from.line) * perLine;
}

/** The correction still running per scroller: a new reveal there replaces it. */
const revealing = new WeakMap<HTMLElement, number>();

/**
 * Scrolls `scroller` so `row` is in view (`nearest`: just in; `center`: in the middle). A row a virtualized file has not
 * drawn yet is scrolled to where its side's drawn rows put it, then, as the file draws there, corrected each frame until
 * it is drawn, for at most `REVEAL_FRAMES` frames.
 */
export function revealRow(body: HTMLElement, scroller: HTMLElement, row: DiffRow, block: "nearest" | "center"): void {
  const running = revealing.get(scroller);
  if (running !== undefined) cancelAnimationFrame(running);
  revealing.delete(scroller);
  let frames = 0;
  const step = (): void => {
    revealing.delete(scroller);
    const element = rowElement(body, row);
    if (element !== null) {
      scroller.scrollTop += scrollToShow(element.getBoundingClientRect(), viewOf(scroller), block);
      return;
    }
    const drawn = drawnRoots(body).flatMap((root) => [...root.querySelectorAll<HTMLElement>(ROW)])
      .flatMap((one) => {
        const at = rowOf(one);
        return at === null || at.old !== row.old ? [] : [{ line: at.line, top: one.getBoundingClientRect().top }];
      });
    const top = estimatedTop(drawn, row.line);
    if (top === null || frames++ >= REVEAL_FRAMES) return;
    const view = viewOf(scroller);
    scroller.scrollTop += scrollToShow({ top, bottom: top }, view, "center");
    revealing.set(scroller, requestAnimationFrame(step));
  };
  step();
}
