import { describe, expect, it } from "bun:test";
import { columnUnit, lineLookup, trimSeparators, unitsColumn, unitsText } from "./fileCommentDom.ts";
import type { LineRange } from "./fileComments.ts";

describe("file comment columns", () => {
  const units = ["a", { sep: " | " }, "bc", { sep: " | " }, "d"];
  it("reads a row with its cell separators", () => expect(unitsText(units)).toBe("a | bc | d"));
  it("counts separators in a column", () => expect(unitsColumn(units, 2, 1)).toBe(5));
  it("maps a column back, snapping out of a separator", () => {
    expect(columnUnit(units, 5, false)).toEqual({ unit: 2, offset: 1 });
    expect(columnUnit(units, 2, false)).toEqual({ unit: 2, offset: 0 });
    expect(columnUnit(units, 2, true)).toEqual({ unit: 0, offset: 1 });
    expect(columnUnit(units, 99, true)).toBeNull();
  });

  it("drops the separators at a line's ends, so its quote and its columns start at its text", () => {
    // a table row: a separator before its first cell; a paragraph line: the <br> that closes it
    const row = [{ sep: " | " }, "a", { sep: " | " }, "bc", { sep: "\n" }];
    const line = trimSeparators(row);
    expect(unitsText(line)).toBe("a | bc");
    expect(unitsColumn(line, 2, 0)).toBe(4);
    expect(columnUnit(line, 0, false)).toEqual({ unit: 0, offset: 0 });
    expect(columnUnit(line, 6, true)).toEqual({ unit: 2, offset: 2 });
    expect(trimSeparators([{ sep: "\n" }, { sep: " | " }])).toEqual([]);
    expect(trimSeparators(units)).toEqual(units);
  });
});

describe("lineLookup", () => {
  // a heading on line 1, a paragraph over lines 3–5 (data-source-end), a table row on 7, a block over 8–10
  const items: { name: string; span: LineRange }[] = [
    { name: "heading", span: [1, 1] },
    { name: "paragraph", span: [3, 5] },
    { name: "row", span: [7, 7] },
    { name: "block", span: [8, 10] },
  ];
  const on = lineLookup(items, (item) => item.span);
  const names = (lines: LineRange) => on(lines).map((item) => item.name);

  it("finds an item spanning several lines from any line it covers", () => {
    for (const line of [3, 4, 5]) expect(names([line, line])).toEqual(["paragraph"]);
    for (const line of [8, 9, 10]) expect(names([line, line])).toEqual(["block"]);
  });
  it("gives every item a range meets once, in document order", () => {
    expect(names([4, 9])).toEqual(["paragraph", "row", "block"]);
    expect(names([1, 10])).toEqual(["heading", "paragraph", "row", "block"]);
    expect(names([0, 99])).toEqual(["heading", "paragraph", "row", "block"]);
  });
  it("finds nothing between or past the items", () => {
    expect(names([2, 2])).toEqual([]);
    expect(names([6, 6])).toEqual([]);
    expect(names([11, 20])).toEqual([]);
  });
  it("never finds an item without a finite span", () => {
    const lookup = lineLookup([{ span: [Number.NaN, Number.NaN] as LineRange }, { span: [2, 2] as LineRange }], (item) => item.span);
    expect(lookup([1, 3])).toHaveLength(1);
  });
});
