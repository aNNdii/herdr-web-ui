import { describe, expect, it } from "bun:test";

import { cursorStandsOn, estimatedTop, firstAtOrBelow, rowFrom, rowOf, scrollToShow } from "./diffRowDom.ts";

/** A drawn element as `rowOf` reads it: its own attributes, the code row it is in, and whether a split's left column holds it. */
function fakeElement(attributes: Record<string, string>, { inRow = true, leftColumn = false } = {}): Element {
  const element = {
    getAttribute: (name: string) => attributes[name] ?? null,
    closest: (selector: string) => (selector === "[data-line]" ? (inRow ? element : null) : selector === "[data-deletions]" && leftColumn ? {} : null),
  };
  return element as unknown as Element;
}

describe("rowFrom", () => {
  it("reads an added or unchanged row as the new file's line", () => {
    expect(rowFrom({ line: "12", lineType: "change-addition", leftColumn: false })).toEqual({ line: 12, old: false });
    expect(rowFrom({ line: "3", lineType: "context", leftColumn: false })).toEqual({ line: 3, old: false });
    expect(rowFrom({ line: "3", lineType: "context-expanded", leftColumn: false })).toEqual({ line: 3, old: false });
  });

  it("reads a removed row, and any row of a split view's left column, as the old file's line", () => {
    expect(rowFrom({ line: "7", lineType: "change-deletion", leftColumn: false })).toEqual({ line: 7, old: true });
    expect(rowFrom({ line: "7", lineType: "change-deletion", leftColumn: true })).toEqual({ line: 7, old: true });
    expect(rowFrom({ line: "5", lineType: "context", leftColumn: true })).toEqual({ line: 5, old: true });
  });

  it("finds no row without a whole line number of at least 1", () => {
    for (const line of [null, "", "0", "-1", "2.5", "x"]) expect(rowFrom({ line, lineType: "context", leftColumn: false })).toBeNull();
  });
});

describe("rowOf", () => {
  it("reads the code row an element is in", () => {
    expect(rowOf(fakeElement({ "data-line": "4", "data-line-type": "change-addition" }))).toEqual({ line: 4, old: false });
    expect(rowOf(fakeElement({ "data-line": "4", "data-line-type": "context" }, { leftColumn: true }))).toEqual({ line: 4, old: true });
  });

  it("finds no row outside a code row (a hunk separator, an annotation, the gutter)", () => {
    expect(rowOf(fakeElement({ "data-column-number": "4" }, { inRow: false }))).toBeNull();
  });
});

describe("cursorStandsOn", () => {
  it("takes a split view's removed rows on the left and every row on the right", () => {
    expect(cursorStandsOn({ lineType: "change-deletion", leftColumn: true })).toBe(true);
    expect(cursorStandsOn({ lineType: "context", leftColumn: true })).toBe(false);
    expect(cursorStandsOn({ lineType: "context", leftColumn: false })).toBe(true);
    expect(cursorStandsOn({ lineType: "change-addition", leftColumn: false })).toBe(true);
  });

  it("takes every row of a unified view or a whole file", () => {
    expect(cursorStandsOn({ lineType: "change-deletion", leftColumn: false })).toBe(true);
    expect(cursorStandsOn({ lineType: null, leftColumn: false })).toBe(true);
  });
});

describe("firstAtOrBelow", () => {
  const tops = [0, 20, 40, 60, 80];
  const at = (top: number) => firstAtOrBelow(tops, (value) => value, top);

  it("finds the first row starting at or below the view's top", () => {
    expect(at(-5)).toBe(0);
    expect(at(40)).toBe(2);
    expect(at(41)).toBe(3);
  });

  it("finds none past the last row, or in an empty column", () => {
    expect(at(81)).toBe(5);
    expect(firstAtOrBelow([], (value: number) => value, 0)).toBe(0);
  });
});

describe("scrollToShow", () => {
  const view = { top: 100, bottom: 300 };

  it("leaves a row in view where it is, and brings one above or below just in", () => {
    expect(scrollToShow({ top: 150, bottom: 170 }, view, "nearest")).toBe(0);
    expect(scrollToShow({ top: 80, bottom: 100 }, view, "nearest")).toBe(-20);
    expect(scrollToShow({ top: 290, bottom: 310 }, view, "nearest")).toBe(10);
  });

  it("puts a row taller than the view at its top", () => {
    expect(scrollToShow({ top: 50, bottom: 400 }, view, "nearest")).toBe(-50);
  });

  it("centres a row", () => {
    expect(scrollToShow({ top: 390, bottom: 410 }, view, "center")).toBe(200);
    expect(scrollToShow({ top: 190, bottom: 210 }, view, "center")).toBe(0);
  });
});

describe("estimatedTop", () => {
  const drawn = [{ line: 100, top: 0 }, { line: 110, top: 200 }];

  it("carries the drawn rows' spacing on past their last or before their first", () => {
    expect(estimatedTop(drawn, 120)).toBe(400);
    expect(estimatedTop(drawn, 90)).toBe(-200);
  });

  it("has nothing to go by without two line numbers", () => {
    expect(estimatedTop([], 5)).toBeNull();
    expect(estimatedTop([{ line: 3, top: 10 }], 5)).toBeNull();
  });
});
