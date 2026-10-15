import { describe, expect, test } from "bun:test";

import { focusAfter, groupCounts, marginLayout, placeCards } from "./commentMargin.ts";

describe("marginLayout", () => {
  // the text's glyphs end at 1000; what is right of them, up to the container's edge, is the free space
  const room = (containerRight: number, more: Partial<Parameters<typeof marginLayout>[0]> = {}): Parameters<typeof marginLayout>[0] =>
    ({ textRight: 1000, containerRight, minimapGutter: 0, wanted: "cards", coarse: false, ...more });

  test("cards where the free space holds the gap and the card margin, 24 px right of the text", () => {
    expect(marginLayout(room(1304))).toEqual({ layout: "cards", x: 1024, target: { left: 1024, width: 280 } });
    expect(marginLayout(room(1600))).toEqual({ layout: "cards", x: 1024, target: { left: 1024, width: 280 } });
  });

  test("counts one px short of the cards' room, whatever the setting says", () => {
    expect(marginLayout(room(1303)).layout).toBe("counts");
  });

  test("counts where counts are wanted, though cards would fit", () => {
    expect(marginLayout(room(1600, { wanted: "counts" }))).toEqual({ layout: "counts", x: 1004, target: { left: 1004, width: 24 } });
  });

  test("the minimap's gutter on the margin's side is no free space", () => {
    expect(marginLayout(room(1336, { minimapGutter: 32 })).layout).toBe("cards");
    expect(marginLayout(room(1335, { minimapGutter: 32 })).layout).toBe("counts");
    // the counts keep clear of it too
    expect(marginLayout(room(1040, { minimapGutter: 32 }))).toEqual({ layout: "counts", x: 996, target: { left: 1000, width: 8 } });
  });

  test("a mouse's counts sit 4 px right of the text where the column fits, the column its target", () => {
    expect(marginLayout(room(1028))).toEqual({ layout: "counts", x: 1004, target: { left: 1004, width: 24 } });
  });

  test("a finger's counts sit there too where the 44 px target fits from the text's edge", () => {
    expect(marginLayout(room(1044, { coarse: true }))).toEqual({ layout: "counts", x: 1004, target: { left: 1000, width: 44 } });
    expect(marginLayout(room(1300, { coarse: true }))).toEqual({ layout: "counts", x: 1004, target: { left: 1000, width: 44 } });
  });

  test("short of that, counts sit at the container's edge, their target never over the glyphs nor past the edge", () => {
    // a mouse, 26 px free: the column flush with the edge, its target the column
    expect(marginLayout(room(1026))).toEqual({ layout: "counts", x: 1002, target: { left: 1002, width: 24 } });
    // a finger, 40 px free: the column at the edge, the target from the glyphs' edge to it
    expect(marginLayout(room(1040, { coarse: true }))).toEqual({ layout: "counts", x: 1016, target: { left: 1000, width: 40 } });
    // 20 px free (the preview at full width: the text's 8 px padding and the body's 12): the bubble (4 px into the
    // column) starts at the glyphs' edge, the target with it
    expect(marginLayout(room(1020))).toEqual({ layout: "counts", x: 996, target: { left: 1000, width: 20 } });
    expect(marginLayout(room(1020, { coarse: true }))).toEqual({ layout: "counts", x: 996, target: { left: 1000, width: 20 } });
  });

  test("with less room than the bubble the bubble still starts clear of the glyphs", () => {
    expect(marginLayout(room(1010))).toEqual({ layout: "counts", x: 996, target: { left: 1000, width: 10 } });
    expect(marginLayout(room(1000))).toEqual({ layout: "counts", x: 996, target: { left: 1000, width: 0 } });
  });

  test("the text is an input, never an output: only the free space and the setting decide", () => {
    for (const containerRight of [1000, 1020, 1100, 1304, 2000]) {
      for (const coarse of [false, true]) {
        const placed = marginLayout(room(containerRight, { coarse }));
        expect(placed.target.left).toBeGreaterThanOrEqual(1000);
        expect(placed.x + 4).toBeGreaterThanOrEqual(1000);
        if (placed.layout === "cards") expect(placed.x + 280).toBeLessThanOrEqual(containerRight);
      }
    }
  });
});

describe("placeCards", () => {
  test("keeps each wanted top when the cards are apart", () => {
    const tops = placeCards([
      { id: "a", want: 0, height: 40 },
      { id: "b", want: 100, height: 40 },
    ]);
    expect(tops.get("a")).toBe(0);
    expect(tops.get("b")).toBe(100);
  });

  test("pushes an overlapping card below the previous one", () => {
    const tops = placeCards([
      { id: "a", want: 10, height: 50 },
      { id: "b", want: 30, height: 40 },
    ]);
    expect(tops.get("a")).toBe(10);
    expect(tops.get("b")).toBe(68);
  });

  test("never moves a card up", () => {
    const tops = placeCards([
      { id: "a", want: 200, height: 40 },
      { id: "b", want: 20, height: 40 },
    ]);
    expect(tops.get("a")).toBe(200);
    expect(tops.get("b")).toBe(248);
  });

  test("keeps a chain of three pushed down in order", () => {
    const tops = placeCards([
      { id: "a", want: 0, height: 50 },
      { id: "b", want: 10, height: 50 },
      { id: "c", want: 20, height: 50 },
    ]);
    expect(tops.get("a")).toBe(0);
    expect(tops.get("b")).toBe(58);
    expect(tops.get("c")).toBe(116);
  });

  test("returns an empty map for no cards", () => {
    expect(placeCards([]).size).toBe(0);
  });
});

describe("groupCounts", () => {
  test("merges starts on the same visual line, within 1 px", () => {
    expect(
      groupCounts(
        [
          { id: "a", top: 100 },
          { id: "b", top: 101 },
          { id: "c", top: 100 },
        ],
        false,
      ),
    ).toEqual([{ top: 100, ids: ["a", "b", "c"] }]);
  });

  test("keeps tops 30 px apart with a mouse", () => {
    expect(
      groupCounts(
        [
          { id: "a", top: 100 },
          { id: "b", top: 130 },
        ],
        false,
      ),
    ).toEqual([
      { top: 100, ids: ["a"] },
      { top: 130, ids: ["b"] },
    ]);
  });

  test("merges tops 30 px apart on touch, keeping the first top", () => {
    expect(
      groupCounts(
        [
          { id: "a", top: 100 },
          { id: "b", top: 130 },
        ],
        true,
      ),
    ).toEqual([{ top: 100, ids: ["a", "b"] }]);
  });

  test("keeps tops 60 px apart on touch", () => {
    expect(
      groupCounts(
        [
          { id: "a", top: 100 },
          { id: "b", top: 160 },
        ],
        true,
      ),
    ).toEqual([
      { top: 100, ids: ["a"] },
      { top: 160, ids: ["b"] },
    ]);
  });

  test("a merged touch count measures the next gap from its first top", () => {
    expect(
      groupCounts(
        [
          { id: "a", top: 100 },
          { id: "b", top: 140 },
          { id: "c", top: 160 },
        ],
        true,
      ),
    ).toEqual([
      { top: 100, ids: ["a", "b"] },
      { top: 160, ids: ["c"] },
    ]);
  });

  test("returns nothing for no starts", () => {
    expect(groupCounts([], true)).toEqual([]);
  });
});

describe("focusAfter", () => {
  const cards = ["a", "b", "c"];

  test("is the next card, then the previous one: where the reader was, once the card is gone", () => {
    expect(focusAfter(cards, "a")).toEqual(["b", "c"]);
    expect(focusAfter(cards, "b")).toEqual(["c", "a"]);
    expect(focusAfter(cards, "c")).toEqual(["b", "a"]);
  });
  test("goes on past the nearest two, so a card not drawn or not placed next to the removed one does not end the search", () => {
    expect(focusAfter(["a", "b", "c", "d", "e"], "c")).toEqual(["d", "e", "b", "a"]);
    expect(focusAfter(["a", "b", "c", "d"], "d")).toEqual(["c", "b", "a"]);
    expect(focusAfter(["a", "b", "c", "d"], "a")).toEqual(["b", "c", "d"]);
  });
  test("is nothing for a host with no other card, or a card that is not in it", () => {
    expect(focusAfter(["a"], "a")).toEqual([]);
    expect(focusAfter([], "a")).toEqual([]);
    expect(focusAfter(cards, "z")).toEqual([]);
  });
});
