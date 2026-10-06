import { describe, expect, it } from "bun:test";
import { floatingPlace, focusAfter, lineAt, onLine, placeAtPointer, restoreFocusTarget, sliceText, spanText } from "./commentSelection.ts";

describe("sliceText", () => {
  it("takes the characters start–end across the text units", () => {
    expect(sliceText(["Hello ", "world"], 3, 8)).toBe("lo wo");
    expect(sliceText(["Hello ", "world"], 0, 11)).toBe("Hello world");
  });
  it("keeps a separator only between two selected characters", () => {
    const units = ["a", { sep: "\n" }, "b"];
    expect(sliceText(units, 0, 2)).toBe("a\nb");
    expect(sliceText(units, 0, 1)).toBe("a");
    expect(sliceText(units, 1, 2)).toBe("b");
  });
  it("does not count a separator as a character", () => {
    expect(sliceText(["ab", { sep: "\n" }, "cd"], 1, 3)).toBe("b\nc");
  });
  it("never doubles a separator, and a line break replaces a trailing space", () => {
    expect(sliceText(["a", { sep: "\n" }, { sep: "\n" }, "b"], 0, 2)).toBe("a\nb");
    expect(sliceText(["a", { sep: " " }, { sep: " " }, "b"], 0, 2)).toBe("a b");
    expect(sliceText(["a", { sep: " " }, { sep: "\n" }, "b"], 0, 2)).toBe("a\nb");
    expect(sliceText(["a\n", { sep: " " }, "b"], 0, 3)).toBe("a\nb");
  });
  it("skips empty units", () => {
    expect(sliceText(["", "ab", "", { sep: "\n" }, "", "c"], 1, 3)).toBe("b\nc");
  });
  it("is empty outside the text or for an empty range", () => {
    expect(sliceText(["abc"], 3, 5)).toBe("");
    expect(sliceText(["abc"], 1, 1)).toBe("");
    expect(sliceText([], 0, 2)).toBe("");
  });
});

describe("spanText", () => {
  const para = (text: string) => [text];
  it("quotes a selection inside one part as sliceText does", () => {
    expect(spanText([{ units: ["Hello ", "world"], start: 3, end: 8 }])).toEqual({ first: 0, last: 0, text: "lo wo" });
  });
  it("quotes a selection over several parts whole, a line break between parts", () => {
    const slices = [{ units: para("Alpha beta"), start: 6, end: 10 }, { units: ["one", { sep: "\n" }, "more"], start: 0, end: 7 }, { units: para("Omega end"), start: 0, end: 5 }];
    expect(spanText(slices)).toEqual({ first: 0, last: 2, text: "beta\none\nmore\nOmega" });
  });
  it("starts and ends at the first and last part with selected text", () => {
    // a drag from a paragraph's end into the next, ending at the start of the one after
    const slices = [{ units: para("Alpha"), start: 5, end: 5 }, { units: para("Middle"), start: 0, end: 6 }, { units: para("Omega"), start: 0, end: 0 }];
    expect(spanText(slices)).toEqual({ first: 1, last: 1, text: "Middle" });
  });
  it("skips a part between whose selected text is blank, and keeps its place in the count", () => {
    const slices = [{ units: para("a"), start: 0, end: 1 }, { units: para("  "), start: 0, end: 2 }, { units: para("b"), start: 0, end: 1 }];
    expect(spanText(slices)).toEqual({ first: 0, last: 2, text: "a\nb" });
  });
  it("drops the trailing spaces of each part's text", () => {
    const slices = [{ units: para("Alpha beta  "), start: 6, end: 12 }, { units: para("one "), start: 0, end: 4 }, { units: para("Omega end"), start: 0, end: 6 }];
    expect(spanText(slices)).toEqual({ first: 0, last: 2, text: "beta\none\nOmega" });
  });
  it("is null when nothing but blanks is selected", () => {
    expect(spanText([])).toBeNull();
    expect(spanText([{ units: para("a  b"), start: 1, end: 3 }, { units: para("c"), start: 0, end: 0 }])).toBeNull();
  });
});

describe("floatingPlace", () => {
  const view = { width: 400, height: 600 };
  const size = { width: 100, height: 30 };
  const anchor = { top: 200, bottom: 220, right: 250 };
  it("centres the button on the selection's end, above it", () => {
    expect(floatingPlace(anchor, view, size, { below: false, gap: 8, margin: 8 })).toEqual({ left: 200, top: 162 });
  });
  it("puts it below the selection when asked (a touch screen's menu is above)", () => {
    expect(floatingPlace(anchor, view, size, { below: true, gap: 24, margin: 8 })).toEqual({ left: 200, top: 244 });
  });
  it("keeps it inside the view horizontally", () => {
    expect(floatingPlace({ ...anchor, right: 10 }, view, size, { below: false, gap: 8, margin: 8 }).left).toBe(8);
    expect(floatingPlace({ ...anchor, right: 395 }, view, size, { below: false, gap: 8, margin: 8 }).left).toBe(292);
    // narrower than the button: its start stays in view
    expect(floatingPlace(anchor, { width: 90, height: 600 }, size, { below: false, gap: 8, margin: 8 }).left).toBe(8);
  });
  it("goes to the other side when its own has no room", () => {
    expect(floatingPlace({ top: 10, bottom: 30, right: 250 }, view, size, { below: false, gap: 8, margin: 8 }).top).toBe(38);
    expect(floatingPlace({ top: 560, bottom: 580, right: 250 }, view, size, { below: true, gap: 24, margin: 8 }).top).toBe(506);
  });
  it("stays on its own side when neither has room", () => {
    expect(floatingPlace({ top: 10, bottom: 590, right: 250 }, view, size, { below: false, gap: 8, margin: 8 }).top).toBe(-28);
    expect(floatingPlace({ top: 10, bottom: 590, right: 250 }, view, size, { below: true, gap: 8, margin: 8 }).top).toBe(598);
  });
});

describe("lineAt", () => {
  const lines = [{ top: 100, bottom: 120 }, { top: 120, bottom: 140 }, { top: 200, bottom: 220 }];
  it("takes the line whose span holds the pointer", () => {
    expect(lineAt(lines, 110)).toBe(lines[0]!);
    expect(lineAt(lines, 130)).toBe(lines[1]!);
    expect(lineAt(lines, 210)).toBe(lines[2]!);
  });
  it("takes the nearest line between two", () => {
    expect(lineAt(lines, 150)).toBe(lines[1]!);
    expect(lineAt(lines, 190)).toBe(lines[2]!);
  });
  it("takes the first or last line for a pointer above or below all of them", () => {
    expect(lineAt(lines, 10)).toBe(lines[0]!);
    expect(lineAt(lines, 900)).toBe(lines[2]!);
  });
  it("prefers the thinnest rect that holds the pointer (a wholly selected block is one tall box)", () => {
    const block = { top: 100, bottom: 300 };
    const line = { top: 150, bottom: 170 };
    expect(lineAt([block, line], 160)).toBe(line);
    expect(lineAt([line, block], 160)).toBe(line);
    expect(lineAt([block, line], 250)).toBe(block);
  });
  it("has no line for none", () => {
    expect(lineAt([], 5)).toBeNull();
  });
});

describe("placeAtPointer", () => {
  const view = { width: 400, height: 600 };
  const size = { width: 100, height: 30 };
  const lines = [{ top: 100, bottom: 120 }, { top: 120, bottom: 140 }];
  const opts = { below: false, gap: 8, margin: 8 };
  it("centres on the pointer's x, above the line that holds its y", () => {
    expect(placeAtPointer(lines, { x: 120, y: 130 }, view, size, opts)).toEqual({ left: 70, top: 82 });
    expect(placeAtPointer(lines, { x: 120, y: 110 }, view, size, opts)).toEqual({ left: 70, top: 62 });
  });
  it("uses the nearest line for a pointer between lines", () => {
    const apart = [{ top: 100, bottom: 120 }, { top: 200, bottom: 220 }];
    expect(placeAtPointer(apart, { x: 120, y: 190 }, view, size, opts).top).toBe(162);
    expect(placeAtPointer(apart, { x: 120, y: 130 }, view, size, opts).top).toBe(62);
  });
  it("clamps a pointer outside the view", () => {
    expect(placeAtPointer(lines, { x: -50, y: 110 }, view, size, opts).left).toBe(8);
    expect(placeAtPointer(lines, { x: 900, y: 110 }, view, size, opts).left).toBe(292);
  });
  it("flips below the line when there is no room above", () => {
    expect(placeAtPointer([{ top: 10, bottom: 30 }], { x: 120, y: 20 }, view, size, opts).top).toBe(38);
  });
  it("puts a touch's button below the line", () => {
    expect(placeAtPointer(lines, { x: 120, y: 110 }, view, size, { below: true, gap: 28, margin: 8 }).top).toBe(148);
  });
  it("falls back to the pointer itself without lines", () => {
    expect(placeAtPointer([], { x: 120, y: 300 }, view, size, opts)).toEqual({ left: 70, top: 262 });
  });
});

describe("onLine", () => {
  const lines = [{ top: 100, bottom: 120 }, { top: 120, bottom: 140 }, { top: 200, bottom: 220 }];
  it("holds a y on one of the lines, its edges included", () => {
    expect(onLine(lines, 110)).toBe(true);
    expect(onLine(lines, 120)).toBe(true);
    expect(onLine(lines, 220)).toBe(true);
  });
  it("does not hold a y between, above or below the lines, nor any y without lines", () => {
    expect(onLine(lines, 160)).toBe(false);
    expect(onLine(lines, 90)).toBe(false);
    expect(onLine(lines, 230)).toBe(false);
    expect(onLine([], 110)).toBe(false);
  });
});

describe("focusAfter", () => {
  const cards = ["a", "b", "c"];

  it("is the next card, then the previous one: where the reader was, once the card is gone", () => {
    expect(focusAfter(cards, "a")).toEqual(["b", "c"]);
    expect(focusAfter(cards, "b")).toEqual(["c", "a"]);
    expect(focusAfter(cards, "c")).toEqual(["b", "a"]);
  });
  it("goes on past the nearest two, so an open form (no Edit button) next to the card does not end the search", () => {
    expect(focusAfter(["a", "b", "c", "d", "e"], "c")).toEqual(["d", "e", "b", "a"]);
    expect(focusAfter(["a", "b", "c", "d"], "d")).toEqual(["c", "b", "a"]);
    expect(focusAfter(["a", "b", "c", "d"], "a")).toEqual(["b", "c", "d"]);
  });
  it("is nothing for a host with no other card, or a card that is not in it", () => {
    expect(focusAfter(["a"], "a")).toEqual([]);
    expect(focusAfter([], "a")).toEqual([]);
    expect(focusAfter(cards, "z")).toEqual([]);
  });
});

describe("restoreFocusTarget", () => {
  const live = { isConnected: true };
  const gone = { isConnected: false };
  const other = { isConnected: true };

  it("is the opener while it is connected", () => {
    expect(restoreFocusTarget(live, other, false)).toBe(live);
    expect(restoreFocusTarget(live, other, true)).toBe(live);
  });
  it("is the fallback when the opener is gone (a deleted comment takes its card with it)", () => {
    expect(restoreFocusTarget(gone, other, false)).toBe(other);
    expect(restoreFocusTarget(null, other, true)).toBe(other);
  });
  it("is the fallback for a modal even when it is not connected: nothing else can have the focus", () => {
    expect(restoreFocusTarget(gone, gone, false)).toBe(gone);
    expect(restoreFocusTarget(null, null, false)).toBeNull();
  });
  it("is null for an inline form when the target is not connected, so the focus is left where it is", () => {
    expect(restoreFocusTarget(gone, gone, true)).toBeNull();
    expect(restoreFocusTarget(null, gone, true)).toBeNull();
    expect(restoreFocusTarget(null, null, true)).toBeNull();
  });
});

describe("restoreFocusTarget on a coarse pointer", () => {
  const live = { isConnected: true };
  const other = { isConnected: true };
  const gone = { isConnected: false };

  it("still gives the focus back to the opener", () => {
    expect(restoreFocusTarget(live, other, false, true)).toBe(live);
    expect(restoreFocusTarget(live, other, true, true)).toBe(live);
  });
  it("lets the focus go instead of taking the fallback, which would raise the keyboard", () => {
    expect(restoreFocusTarget(gone, other, false, true)).toBeNull();
    expect(restoreFocusTarget(null, other, true, true)).toBeNull();
  });
  it("keeps the fallback on a fine pointer", () => {
    expect(restoreFocusTarget(gone, other, false, false)).toBe(other);
    expect(restoreFocusTarget(gone, other, false)).toBe(other);
  });
});
