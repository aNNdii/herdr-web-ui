import { describe, expect, it } from "bun:test";

import { parsePatchFiles, trimPatchContext, type FileDiffMetadata } from "@pierre/diffs";

import { diffSelection, diffSides, diffTrack, sideLines, type DiffRow } from "./diffSides.ts";
import type { LineTrack } from "./lineCursor.ts";

function parsed(patch: string): FileDiffMetadata {
  const file = parsePatchFiles(patch, "diff-sides-test", true)[0]?.files[0];
  if (file === undefined) throw new Error("no file in the patch");
  return file;
}

/**
 * Two hunks of `src/a.ts`: the first swaps `old()` for `new()` on line 30 and drops two lines, the second sits one line
 * further down in the new file than in the old one, so its unchanged lines have other numbers on each side.
 */
const PATCH = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 1111111..2222222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -28,7 +28,5 @@ function a() {",
  " twenty-eight",
  " twenty-nine",
  "-old()",
  "+new()",
  " thirty-one",
  "-gone1",
  "-gone2",
  " thirty-four",
  "@@ -60,3 +58,4 @@ function b() {",
  " sixty",
  "+inserted",
  " sixty-one",
  " sixty-two",
  "",
].join("\n");

describe("diffSides", () => {
  const sides = diffSides(parsed(PATCH));

  it("keeps the head's lines (unchanged and added) by their new numbers, without line ends", () => {
    expect(sideLines(sides.head, [28, 32])).toEqual(["twenty-eight", "twenty-nine", "new()", "thirty-one", "thirty-four"]);
    expect(sideLines(sides.head, [58, 61])).toEqual(["sixty", "inserted", "sixty-one", "sixty-two"]);
  });

  it("keeps only the removed lines on the base side, by their old numbers", () => {
    expect(sideLines(sides.base, [30, 30])).toEqual(["old()"]);
    expect(sideLines(sides.base, [32, 33])).toEqual(["gone1", "gone2"]);
    expect(sides.base.text[27]).toBeUndefined();
    expect(sides.base.text[30]).toBeUndefined();
  });

  it("maps every unchanged line's old number to its new one", () => {
    expect(sides.unchanged.get(28)).toBe(28);
    expect(sides.unchanged.get(31)).toBe(31);
    expect(sides.unchanged.get(34)).toBe(32);
    expect(sides.unchanged.get(60)).toBe(58);
    expect(sides.unchanged.get(62)).toBe(61);
    expect(sides.unchanged.has(30)).toBe(false);
  });

  it("tells which hunk each line is in", () => {
    expect(sides.head.hunk[27]).toBe(0);
    expect(sides.head.hunk[57]).toBe(1);
    expect(sides.base.hunk[31]).toBe(0);
  });

  it("finds no text over the gap between two hunks or outside the patch", () => {
    expect(sideLines(sides.head, [32, 58])).toBeNull();
    expect(sideLines(sides.head, [1, 1])).toBeNull();
    expect(sideLines(sides.base, [29, 30])).toBeNull();
  });

  it("puts a new file's lines on the head side only", () => {
    const added = diffSides(parsed([
      "diff --git a/b.ts b/b.ts",
      "new file mode 100644",
      "index 0000000..3333333",
      "--- /dev/null",
      "+++ b/b.ts",
      "@@ -0,0 +1,2 @@",
      "+first",
      "+second",
      "",
    ].join("\n")));
    expect(sideLines(added.head, [1, 2])).toEqual(["first", "second"]);
    expect(added.base.text.length).toBe(0);
    expect(added.unchanged.size).toBe(0);
  });
});

describe("diffTrack", () => {
  const rows = (track: LineTrack): string[] => Array.from({ length: track.length }, (_, index) => {
    const row = track.row(index);
    return `${row.old ? "-" : "+"}${row.line}`;
  });

  it("runs in unified order: context by its new number, each change's removed lines before its added ones", () => {
    expect(rows(diffTrack(parsed(PATCH)))).toEqual([
      "+28", "+29", "-30", "+30", "+31", "-32", "-33", "+32",
      "+58", "+59", "+60", "+61",
    ]);
  });

  it("leaves out the lines between hunks", () => {
    const track = diffTrack(parsed(PATCH));
    expect(track.indexOf({ line: 40, old: false })).toBe(-1);
    expect(track.indexOf({ line: 1, old: false })).toBe(-1);
    expect(track.indexOf({ line: 33, old: false })).toBe(-1);
  });

  it("finds each drawn row by its line and side", () => {
    const track = diffTrack(parsed(PATCH));
    for (let index = 0; index < track.length; index++) expect(track.indexOf(track.row(index))).toBe(index);
    expect(track.indexOf({ line: 30, old: true })).toBe(2);
    expect(track.indexOf({ line: 30, old: false })).toBe(3);
    expect(track.indexOf({ line: 0, old: false })).toBe(-1);
    expect(track.indexOf({ line: Number.NaN, old: true })).toBe(-1);
  });

  it("finds an unchanged row a split view's left column draws by its old number", () => {
    const track = diffTrack(parsed(PATCH));
    expect(track.indexOf({ line: 34, old: true })).toBe(track.indexOf({ line: 32, old: false }));
    expect(track.indexOf({ line: 60, old: true })).toBe(track.indexOf({ line: 58, old: false }));
  });

  it("follows a folded patch: the context it hides is not on the track", () => {
    const patch = [
      "diff --git a/c.ts b/c.ts",
      "index 1111111..2222222 100644",
      "--- a/c.ts",
      "+++ b/c.ts",
      "@@ -1,9 +1,9 @@",
      " one",
      " two",
      " three",
      " four",
      "-five",
      "+FIVE",
      " six",
      " seven",
      " eight",
      " nine",
      "",
    ].join("\n");
    expect(rows(diffTrack(parsed(patch)))).toEqual(["+1", "+2", "+3", "+4", "-5", "+5", "+6", "+7", "+8", "+9"]);
    expect(rows(diffTrack(parsed(trimPatchContext(patch, 1))))).toEqual(["+4", "-5", "+5", "+6"]);
  });

  it("has no rows for a patch without hunks", () => {
    const track = diffTrack({ ...parsed(PATCH), hunks: [] });
    expect(track.length).toBe(0);
    expect(track.indexOf({ line: 28, old: false })).toBe(-1);
  });
});

describe("diffSelection", () => {
  const sides = diffSides(parsed(PATCH));
  const row = (line: number, old = false): DiffRow => ({ line, old });

  it("keeps the head's line of a drag over -old() and +new()", () => {
    const pick = diffSelection([row(30, true), row(30)], sides);
    expect(pick).toEqual({ side: "head", lines: [30, 30] });
    expect(sideLines(sides.head, pick?.lines ?? [0, 0])).toEqual(["new()"]);
  });

  it("gives an unchanged line in a split view's left column its head number", () => {
    expect(diffSelection([row(60, true)], sides)).toEqual({ side: "head", lines: [58, 58] });
    expect(diffSelection([row(34, true), row(32)], sides)).toEqual({ side: "head", lines: [32, 32] });
  });

  it("lets head lines win over removed ones", () => {
    expect(diffSelection([row(31), row(32, true), row(33, true), row(32)], sides)).toEqual({ side: "head", lines: [31, 32] });
  });

  it("stays on the base side when only removed lines are selected", () => {
    expect(diffSelection([row(32, true), row(33, true)], sides)).toEqual({ side: "base", lines: [32, 33] });
    expect(diffSelection([row(30, true)], sides)).toEqual({ side: "base", lines: [30, 30] });
  });

  it("cuts a selection over two hunks at the hunk it starts in", () => {
    expect(diffSelection([row(31), row(32), row(58), row(59)], sides)).toEqual({ side: "head", lines: [31, 32] });
    expect(diffSelection([row(34, true), row(60, true), row(61, true)], sides)).toEqual({ side: "head", lines: [32, 32] });
  });

  it("finds nothing in no rows or in rows the patch does not have", () => {
    expect(diffSelection([], sides)).toBeNull();
    expect(diffSelection([row(5), row(5, true)], sides)).toBeNull();
    expect(diffSelection([row(0), row(Number.NaN)], sides)).toBeNull();
  });
});
