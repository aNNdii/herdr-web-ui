import { describe, expect, it } from "bun:test";

import { parsePatchFiles } from "@pierre/diffs";

import { diffTrack, type DiffRow } from "./diffSides.ts";
import { cursorRows, fileTrack, followCursor, pressCursor, settleCursor, type CursorView, type LineCursor, type LineTrack } from "./lineCursor.ts";
import { workspacePick } from "./review.ts";

const added = (line: number): DiffRow => ({ line, old: false });
const removed = (line: number): DiffRow => ({ line, old: true });

/** a track over these rows, in this order */
function listTrack(rows: readonly DiffRow[]): LineTrack {
  return {
    length: rows.length,
    row: (index) => {
      const row = rows[index];
      if (row === undefined) throw new RangeError(`no row ${index}`);
      return row;
    },
    indexOf: (row) => rows.findIndex((at) => at.line === row.line && at.old === row.old),
  };
}

/** the DOM as a press sees it: the landing row, and the rows in the viewport */
function view(first: DiffRow | null, visible: (row: DiffRow) => boolean = () => true): CursorView {
  return { first: () => first, shows: visible };
}

const shown = (at: DiffRow, anchor: DiffRow | null = null): LineCursor => ({ at, anchor, shown: true });

describe("fileTrack", () => {
  it("numbers lines 1..count on the new side", () => {
    const track = fileTrack(3);
    expect(track.length).toBe(3);
    expect([0, 1, 2].map((index) => track.row(index))).toEqual([added(1), added(2), added(3)]);
    expect(track.indexOf(added(2))).toBe(1);
  });

  it("finds no removed row, no row outside the file and no broken number", () => {
    const track = fileTrack(3);
    expect(track.indexOf(removed(2))).toBe(-1);
    expect(track.indexOf(added(0))).toBe(-1);
    expect(track.indexOf(added(4))).toBe(-1);
    expect(track.indexOf(added(1.5))).toBe(-1);
    expect(track.indexOf(added(Number.NaN))).toBe(-1);
    expect(() => track.row(3)).toThrow(RangeError);
  });

  it("handles a huge file by arithmetic, without building its rows", () => {
    const started = performance.now();
    const track = fileTrack(500_000);
    expect(track.length).toBe(500_000);
    expect(track.row(499_999)).toEqual(added(500_000));
    expect(track.indexOf(added(250_000))).toBe(249_999);
    expect(performance.now() - started).toBeLessThan(50);
  });
});

describe("pressCursor", () => {
  const track = fileTrack(10);

  it("lands a first press on the landing row without moving on", () => {
    for (const key of ["down", "up", "extend-down", "extend-up", "land"] as const) {
      expect(pressCursor(track, null, key, view(added(4)))).toEqual({ cursor: shown(added(4)), landed: true });
    }
  });

  it("lands on the first row when the view names none it draws", () => {
    expect(pressCursor(track, null, "down", view(null))).toEqual({ cursor: shown(added(1)), landed: true });
    expect(pressCursor(track, null, "down", view(removed(4)))).toEqual({ cursor: shown(added(1)), landed: true });
  });

  it("lands nowhere on an empty track", () => {
    expect(pressCursor(fileTrack(0), null, "down", view(null))).toEqual({ cursor: null, landed: false });
  });

  it("only shows a hidden cursor that is in view", () => {
    const hidden: LineCursor = { at: added(7), anchor: null, shown: false };
    expect(pressCursor(track, hidden, "down", view(added(2)))).toEqual({ cursor: shown(added(7)), landed: true });
    expect(pressCursor(track, hidden, "land", view(added(2)))).toEqual({ cursor: shown(added(7)), landed: true });
  });

  it("lands again when the cursor is out of view, hidden or shown, and drops its anchor", () => {
    const away = (row: DiffRow): boolean => row.line < 5;
    expect(pressCursor(track, { at: added(8), anchor: null, shown: false }, "down", view(added(2), away))).toEqual({ cursor: shown(added(2)), landed: true });
    expect(pressCursor(track, shown(added(8), added(6)), "up", view(added(2), away))).toEqual({ cursor: shown(added(2)), landed: true });
  });

  it("lands again when the cursor's row is not on the track", () => {
    expect(pressCursor(track, shown(added(12)), "down", view(added(3)))).toEqual({ cursor: shown(added(3)), landed: true });
  });

  it("moves a shown cursor in view by one row", () => {
    expect(pressCursor(track, shown(added(4)), "down", view(added(1)))).toEqual({ cursor: shown(added(5)), landed: false });
    expect(pressCursor(track, shown(added(4)), "up", view(added(1)))).toEqual({ cursor: shown(added(3)), landed: false });
  });

  it("stops at both ends", () => {
    expect(pressCursor(track, shown(added(10)), "down", view(added(1)))).toEqual({ cursor: shown(added(10)), landed: false });
    expect(pressCursor(track, shown(added(1)), "up", view(added(1)))).toEqual({ cursor: shown(added(1)), landed: false });
    expect(pressCursor(track, shown(added(10), added(8)), "extend-down", view(added(1)))).toEqual({ cursor: shown(added(10), added(8)), landed: false });
  });

  it("sets the anchor on the first extend and moves only the end after it", () => {
    const first = pressCursor(track, shown(added(4)), "extend-down", view(added(1))).cursor;
    expect(first).toEqual(shown(added(5), added(4)));
    const second = pressCursor(track, first, "extend-down", view(added(1))).cursor;
    expect(second).toEqual(shown(added(6), added(4)));
  });

  it("shrinks the range when extend-up follows extend-down, and crosses the anchor", () => {
    let cursor = pressCursor(track, shown(added(6), added(4)), "extend-up", view(added(1))).cursor;
    expect(cursor).toEqual(shown(added(5), added(4)));
    expect(cursorRows(track, cursor!)).toEqual([added(4), added(5)]);
    cursor = pressCursor(track, cursor, "extend-up", view(added(1))).cursor;
    cursor = pressCursor(track, cursor, "extend-up", view(added(1))).cursor;
    expect(cursor).toEqual(shown(added(3), added(4)));
    expect(cursorRows(track, cursor!)).toEqual([added(3), added(4)]);
  });

  it("moves on from the end without shift and drops the anchor", () => {
    expect(pressCursor(track, shown(added(6), added(4)), "down", view(added(1)))).toEqual({ cursor: shown(added(7)), landed: false });
    expect(pressCursor(track, shown(added(6), added(4)), "up", view(added(1)))).toEqual({ cursor: shown(added(5)), landed: false });
  });

  it("does not land when a shown cursor is in view", () => {
    const cursor = shown(added(6), added(4));
    expect(pressCursor(track, cursor, "land", view(added(1)))).toEqual({ cursor, landed: false });
  });

  it("walks a diff's removed and added rows in unified order", () => {
    const diff = listTrack([added(28), removed(30), added(30), added(31)]);
    expect(pressCursor(diff, shown(added(28)), "down", view(added(28))).cursor).toEqual(shown(removed(30)));
    expect(pressCursor(diff, shown(removed(30)), "down", view(added(28))).cursor).toEqual(shown(added(30)));
  });
});

describe("followCursor", () => {
  const track = fileTrack(10);

  it("puts a hidden cursor on a mouse selection's last row, without an anchor", () => {
    expect(followCursor(track, [added(3), added(4), added(5)])).toEqual({ at: added(5), anchor: null, shown: false });
    expect(followCursor(track, [added(5), added(4)])).toEqual({ at: added(4), anchor: null, shown: false });
  });

  it("skips rows the track does not draw, and follows none without rows", () => {
    expect(followCursor(track, [added(3), added(40)])).toEqual({ at: added(3), anchor: null, shown: false });
    expect(followCursor(track, [added(40)])).toBeNull();
    expect(followCursor(track, [])).toBeNull();
  });
});

describe("cursorRows", () => {
  const track = listTrack([added(1), removed(2), removed(3), added(2), added(3)]);

  it("gives the cursor's row alone without an anchor", () => {
    expect(cursorRows(track, shown(removed(3)))).toEqual([removed(3)]);
  });

  it("gives anchor to end as min..max in track order, either way round", () => {
    expect(cursorRows(track, shown(added(2), removed(2)))).toEqual([removed(2), removed(3), added(2)]);
    expect(cursorRows(track, shown(removed(2), added(2)))).toEqual([removed(2), removed(3), added(2)]);
  });

  it("gives the end alone when the anchor is not on the track, and nothing when the end is not", () => {
    expect(cursorRows(track, shown(added(3), added(9)))).toEqual([added(3)]);
    expect(cursorRows(track, shown(added(9)))).toEqual([]);
  });

  it("gives removed rows only, which the working tree's comment refuses", () => {
    const diff = diffTrack(parsePatchFiles([
      "diff --git a/d.ts b/d.ts",
      "index 1111111..2222222 100644",
      "--- a/d.ts",
      "+++ b/d.ts",
      "@@ -1,4 +1,2 @@",
      " keep",
      "-gone1",
      "-gone2",
      " last",
      "",
    ].join("\n"), "line-cursor-test", true)[0]!.files[0]!);
    const rows = cursorRows(diff, shown(removed(3), removed(2)));
    expect(rows).toEqual([removed(2), removed(3)]);
    expect(workspacePick(rows)).toBeNull();
    expect(workspacePick(cursorRows(diff, shown(added(2), removed(2))))).toEqual([2, 2]);
  });
});

describe("settleCursor", () => {
  const before = listTrack([added(1), added(2), removed(3), added(3), added(4), added(5)]);

  it("keeps the cursor and its anchor when both are still drawn", () => {
    const after = listTrack([added(2), removed(3), added(3), added(4)]);
    expect(settleCursor(before, after, shown(added(4), added(2)))).toEqual(shown(added(4), added(2)));
  });

  it("keeps a hidden cursor hidden", () => {
    expect(settleCursor(before, before, { at: added(3), anchor: null, shown: false })).toEqual({ at: added(3), anchor: null, shown: false });
  });

  it("drops the anchor when it is no longer drawn", () => {
    const after = listTrack([added(3), added(4)]);
    expect(settleCursor(before, after, shown(added(4), added(2)))).toEqual(shown(added(4)));
  });

  it("moves to the next drawn row after a row that is gone, and drops the anchor", () => {
    const after = listTrack([added(1), added(4), added(5)]);
    expect(settleCursor(before, after, shown(removed(3), added(1)))).toEqual(shown(added(4)));
  });

  it("moves to the drawn row before when none is drawn after", () => {
    const after = listTrack([added(1), added(2)]);
    expect(settleCursor(before, after, shown(added(4)))).toEqual(shown(added(2)));
  });

  it("settles nowhere on an empty track or for a row the old track did not draw", () => {
    expect(settleCursor(before, listTrack([]), shown(added(2)))).toBeNull();
    expect(settleCursor(before, listTrack([added(7)]), shown(added(9)))).toBeNull();
  });

  it("goes from a diff to the whole file and back", () => {
    const diff = diffTrack(parsePatchFiles([
      "diff --git a/e.ts b/e.ts",
      "index 1111111..2222222 100644",
      "--- a/e.ts",
      "+++ b/e.ts",
      "@@ -20,3 +20,3 @@",
      " twenty",
      "-old",
      "+new",
      " twenty-two",
      "",
    ].join("\n"), "line-cursor-test", true)[0]!.files[0]!);
    const whole = fileTrack(40);
    expect(settleCursor(diff, whole, shown(added(21), added(20)))).toEqual(shown(added(21), added(20)));
    expect(settleCursor(diff, whole, shown(removed(21)))).toEqual(shown(added(21)));
    expect(settleCursor(whole, diff, shown(added(5)))).toEqual(shown(added(20)));
    expect(settleCursor(whole, diff, shown(added(30)))).toEqual(shown(added(22)));
    expect(settleCursor(whole, diff, shown(added(22)))).toEqual(shown(added(22)));
  });
});
