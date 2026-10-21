import type { CursorKey } from "./reviewKeys.ts";
import type { DiffRow } from "./diffSides.ts";

/**
 * The review's line cursor, kept as a line number plus side (a `DiffRow`), never as a DOM row, so a fold, a Unified or
 * Split switch, a wrap or a redraw after a comment does not lose it. Pure: no DOM and no React; what the page shows
 * comes in through a `CursorView`.
 */

/** The rows the cursor can stand on, in unified order. */
export interface LineTrack {
  readonly length: number;
  /** throws a RangeError outside 0..length-1 */
  row(index: number): DiffRow;
  /** -1: not drawn */
  indexOf(row: DiffRow): number;
}

/** A whole file's lines 1..count, all on the new side: arithmetic, no array, so a huge file costs nothing. */
export function fileTrack(count: number): LineTrack {
  return {
    length: count,
    row(index) {
      if (!Number.isInteger(index) || index < 0 || index >= count) throw new RangeError(`no line at ${index} of ${count}`);
      return { line: index + 1, old: false };
    },
    indexOf(row) {
      return !row.old && Number.isInteger(row.line) && row.line >= 1 && row.line <= count ? row.line - 1 : -1;
    },
  };
}

/** shown false: kept, but not drawn (after a mouse selection) */
export interface LineCursor { at: DiffRow; anchor: DiffRow | null; shown: boolean }

/** What the DOM says when a key is pressed. first() gives the landing row (the jump line, while it is unused and in view). */
export interface CursorView { first(): DiffRow | null; shows(row: DiffRow): boolean }

/** The landing row, or the track's first row when the view names none the track draws; null on an empty track. */
function landing(track: LineTrack, view: CursorView): LineCursor | null {
  if (track.length === 0) return null;
  const first = view.first();
  const index = first === null ? -1 : track.indexOf(first);
  return { at: track.row(Math.max(index, 0)), anchor: null, shown: true };
}

/**
 * No cursor, a hidden one or one out of view: it lands (hidden and in view: it is only shown) and landed is true.
 * Otherwise it moves one row, held at both ends; extend sets the anchor on `at` the first time, without extend it goes.
 */
export function pressCursor(track: LineTrack, cursor: LineCursor | null, key: CursorKey | "land", view: CursorView): { cursor: LineCursor | null; landed: boolean } {
  const index = cursor === null ? -1 : track.indexOf(cursor.at);
  if (cursor === null || index < 0 || !view.shows(cursor.at)) {
    const landed = landing(track, view);
    return { cursor: landed, landed: landed !== null };
  }
  if (!cursor.shown) return { cursor: { ...cursor, shown: true }, landed: true };
  if (key === "land") return { cursor, landed: false };
  const step = key === "down" || key === "extend-down" ? 1 : -1;
  const at = track.row(Math.min(Math.max(index + step, 0), track.length - 1));
  const extend = key === "extend-down" || key === "extend-up";
  return { cursor: { at, anchor: extend ? cursor.anchor ?? cursor.at : null, shown: true }, landed: false };
}

/** A mouse selection: a hidden cursor on its last row the track draws, without an anchor. */
export function followCursor(track: LineTrack, rows: readonly DiffRow[]): LineCursor | null {
  for (let index = rows.length - 1; index >= 0; index--) {
    const at = track.indexOf(rows[index]!);
    if (at >= 0) return { at: track.row(at), anchor: null, shown: false };
  }
  return null;
}

/** Anchor to `at`, min..max in track order: what a comment opens on. Just `at` without an anchor the track draws. */
export function cursorRows(track: LineTrack, cursor: LineCursor): DiffRow[] {
  const end = track.indexOf(cursor.at);
  if (end < 0) return [];
  const anchor = cursor.anchor === null ? -1 : track.indexOf(cursor.anchor);
  const start = anchor < 0 ? end : anchor;
  const rows: DiffRow[] = [];
  for (let index = Math.min(start, end); index <= Math.max(start, end); index++) rows.push(track.row(index));
  return rows;
}

/**
 * A new track (a fold, a new patch, a switch between the diff and the whole file): the same row when it is drawn, with
 * its anchor when that is drawn too. Otherwise the next row after it on the old track that the new one draws, else the
 * one before, without the anchor. null on an empty track, or for a row the old track did not draw.
 */
export function settleCursor(from: LineTrack, to: LineTrack, cursor: LineCursor): LineCursor | null {
  if (to.length === 0) return null;
  const same = to.indexOf(cursor.at);
  if (same >= 0) {
    const anchor = cursor.anchor === null ? -1 : to.indexOf(cursor.anchor);
    return { at: to.row(same), anchor: anchor < 0 ? null : to.row(anchor), shown: cursor.shown };
  }
  const was = from.indexOf(cursor.at);
  if (was < 0) return null;
  const drawn = (index: number): LineCursor | null => {
    const at = to.indexOf(from.row(index));
    return at < 0 ? null : { at: to.row(at), anchor: null, shown: cursor.shown };
  };
  for (let index = was + 1; index < from.length; index++) {
    const found = drawn(index);
    if (found !== null) return found;
  }
  for (let index = was - 1; index >= 0; index--) {
    const found = drawn(index);
    if (found !== null) return found;
  }
  return null;
}
