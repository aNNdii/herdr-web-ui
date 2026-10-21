/**
 * The review's line cursor in React: the pure cursor (lib/lineCursor.ts) on the rows `@pierre/diffs` draws
 * (lib/diffRowDom.ts), and the selection the library draws for it. ReviewFile owns the track, this hook the cursor.
 */
import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { SelectedLineRange } from "@pierre/diffs";

import { firstVisibleRow, revealRow, rowInView } from "../lib/diffRowDom.ts";
import type { DiffRow } from "../lib/diffSides.ts";
import { cursorRows, followCursor, pressCursor, settleCursor, type CursorView, type LineCursor, type LineTrack } from "../lib/lineCursor.ts";
import type { CursorKey } from "../lib/reviewKeys.ts";

/** The element the review's code scrolls in (ReviewFile's views). */
const SCROLLER = ".review-scroll";

/** A comment field open on the file: the rows it is on, and whether a key opened it (then the cursor's bar shows). */
export interface CursorField {
  rows: readonly DiffRow[];
  byKey: boolean;
}

export interface LineCursorControl {
  /** what the library draws: a drag in FileView (live) > an open field's rows > the shown cursor > null; never undefined */
  readonly selection: SelectedLineRange | null;
  /** whether `selection` is the cursor, drawn with its bar: not a drag, nor a field the mouse opened */
  readonly bar: boolean;
  move(key: CursorKey): boolean;
  /** c/Enter without a shown cursor in view: it lands, or is shown; true when that happened */
  land(): boolean;
  rows(): DiffRow[];
  /** a mouse selection */
  follow(rows: readonly DiffRow[]): void;
  /** FileView's onLineSelectionChange */
  dragging(range: SelectedLineRange | null): void;
  /** Escape: the range goes (true), or there is nothing to do (false) */
  clear(): boolean;
}

/**
 * Whether the drawn selection is the cursor, with its bar: a drag and a field the mouse opened are drawn as a selection
 * without it, as only a key shows the cursor. Exported for its tests.
 */
export function cursorBar(selection: SelectedLineRange | null, drag: SelectedLineRange | null, field: CursorField | null): boolean {
  return selection !== null && drag === null && (field === null || field.byKey);
}

/** The library's range from `start` to `end`, a removed row on the old side. */
function rangeOf(start: DiffRow, end: DiffRow): SelectedLineRange {
  return { start: start.line, side: start.old ? "deletions" : "additions", end: end.line, endSide: end.old ? "deletions" : "additions" };
}

/** The rows' range as the track orders them, the rows it does not draw left out; null when it draws none. */
function trackRange(track: LineTrack, rows: readonly DiffRow[]): SelectedLineRange | null {
  const drawn = rows.map((row) => track.indexOf(row)).filter((index) => index >= 0);
  if (drawn.length === 0) return null;
  return rangeOf(track.row(Math.min(...drawn)), track.row(Math.max(...drawn)));
}

/**
 * Owns the cursor, the track it was placed on (a new one settles it, `settleCursor`; none, as in the preview, drops it)
 * and whether the jump line (`jumpLine`, a line of the new file) was landed on yet: it is the first landing row once,
 * while it is in view. `field`: the comment field open on the file (a new comment or a saved one edited), or null; as it
 * closes, the range goes and the cursor stays on its end.
 */
export function useLineCursor(body: RefObject<HTMLElement | null>, track: LineTrack | null, jumpLine: number | undefined, field: CursorField | null): LineCursorControl {
  const [cursor, setCursor] = useState<LineCursor | null>(null);
  const [drag, setDrag] = useState<SelectedLineRange | null>(null);
  // the cursor as the last key left it, read by the next key before React drew it
  const latest = useRef(cursor);
  useLayoutEffect(() => { latest.current = cursor; }, [cursor]);
  const place = (next: LineCursor | null): void => {
    latest.current = next;
    setCursor(next);
  };
  const jumpUsed = useRef(false);

  // a new track, or a field that closed: the cursor is adjusted as this render runs, before the library draws it. A
  // drag's range is the old track's lines (the whole file's, say, under a diff now): it goes
  const [placedOn, setPlacedOn] = useState(track);
  if (placedOn !== track) {
    setPlacedOn(track);
    setCursor(cursor === null || placedOn === null || track === null ? null : settleCursor(placedOn, track, cursor));
    setDrag(null);
  }
  const fieldOpen = field !== null;
  const [wasOpen, setWasOpen] = useState(fieldOpen);
  if (wasOpen !== fieldOpen) {
    setWasOpen(fieldOpen);
    if (!fieldOpen) {
      setCursor((now) => (now === null ? null : { ...now, anchor: null }));
      setDrag(null);
    }
  }

  const selection = useMemo((): SelectedLineRange | null => {
    if (drag !== null) return drag;
    if (track === null) return null;
    if (field !== null) return trackRange(track, field.rows);
    return cursor === null || !cursor.shown ? null : trackRange(track, cursorRows(track, cursor));
  }, [drag, track, field, cursor]);
  const bar = cursorBar(selection, drag, field);

  /** The body and its scroller, while the file is drawn. */
  const drawn = (): { element: HTMLElement; scroller: HTMLElement } | null => {
    const element = body.current;
    const scroller = element?.querySelector<HTMLElement>(SCROLLER) ?? null;
    return element === null || scroller === null ? null : { element, scroller };
  };
  const viewOf = (element: HTMLElement, scroller: HTMLElement): CursorView => ({
    first: () => {
      const jump = jumpLine === undefined || jumpUsed.current ? null : { line: jumpLine, old: false };
      return jump !== null && rowInView(element, scroller, jump) ? jump : firstVisibleRow(element, scroller);
    },
    shows: (row) => rowInView(element, scroller, row),
  });
  /** A key's press: the cursor it leaves, scrolled into view; false when there is no track or nothing drawn. */
  const press = (key: CursorKey | "land"): boolean => {
    const page = drawn();
    if (track === null || page === null) return false;
    const { cursor: next, landed } = pressCursor(track, latest.current, key, viewOf(page.element, page.scroller));
    if (next === null || key === "land" && !landed) return false;
    jumpUsed.current = true;
    place(next);
    setDrag(null);
    revealRow(page.element, page.scroller, next.at, "nearest");
    return true;
  };

  return {
    selection,
    bar,
    move: (key) => press(key),
    land: () => press("land"),
    rows: () => (track === null || latest.current === null ? [] : cursorRows(track, latest.current)),
    follow: (rows) => {
      const next = track === null ? null : followCursor(track, rows);
      if (next !== null) place(next);
    },
    dragging: setDrag,
    clear: () => {
      const now = latest.current;
      if (now === null || !now.shown || now.anchor === null) return false;
      place({ ...now, anchor: null });
      return true;
    },
  };
}
