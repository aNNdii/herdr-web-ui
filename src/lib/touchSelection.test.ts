import { describe, expect, test } from "bun:test";

import { fallbackWordBounds, holdStep, moveEdge, pillTop, TOUCH_HOLD_MS, TOUCH_SLOP_PX, wordBounds, type HoldState } from "./touchSelection.ts";

/** Runs `events` through `holdStep` from rest; the actions in order. */
function run(events: Parameters<typeof holdStep>[1][]): { actions: string[]; state: HoldState } {
  let state: HoldState = { kind: "idle" };
  const actions: string[] = [];
  for (const event of events) {
    const step = holdStep(state, event);
    state = step.state;
    actions.push(step.action);
  }
  return { actions, state };
}

describe("the touch rules' values", () => {
  test("a long press is 450 ms, its slop 8 px", () => {
    expect(TOUCH_HOLD_MS).toBe(450);
    expect(TOUCH_SLOP_PX).toBe(8);
  });
});

describe("holdStep", () => {
  test("a finger resting until the timer, within the slop, selects", () => {
    expect(run([
      { type: "down", x: 100, y: 200 },
      { type: "move", x: 105, y: 205 },
      { type: "timer", x: 0, y: 0 },
    ]).actions).toEqual(["none", "none", "select"]);
  });

  test("a move of 8 px is still within the slop", () => {
    expect(run([{ type: "down", x: 100, y: 200 }, { type: "move", x: 108, y: 200 }, { type: "timer", x: 0, y: 0 }]).actions)
      .toEqual(["none", "none", "select"]);
  });

  test("a move of 9 px before the timer cancels (a scroll), and the timer then selects nothing", () => {
    const { actions, state } = run([
      { type: "down", x: 100, y: 200 },
      { type: "move", x: 100, y: 209 },
      { type: "timer", x: 0, y: 0 },
    ]);
    expect(actions).toEqual(["none", "cancel", "none"]);
    expect(state.kind).toBe("idle");
  });

  test("moving on after the selection extends it, at every move, whatever the distance", () => {
    expect(run([
      { type: "down", x: 100, y: 200 },
      { type: "timer", x: 0, y: 0 },
      { type: "move", x: 101, y: 200 },
      { type: "move", x: 300, y: 260 },
    ]).actions).toEqual(["none", "select", "extend", "extend"]);
  });

  test("lifting after the selection ends it, and the next press starts afresh", () => {
    const { actions, state } = run([
      { type: "down", x: 100, y: 200 },
      { type: "timer", x: 0, y: 0 },
      { type: "up", x: 100, y: 200 },
    ]);
    expect(actions).toEqual(["none", "select", "end"]);
    expect(state.kind).toBe("idle");
    expect(holdStep(state, { type: "move", x: 300, y: 300 }).action).toBe("none");
  });

  test("a lift before the timer is a tap: nothing, and its timer selects nothing", () => {
    expect(run([{ type: "down", x: 100, y: 200 }, { type: "up", x: 100, y: 200 }, { type: "timer", x: 0, y: 0 }]).actions)
      .toEqual(["none", "none", "none"]);
  });

  test("a timer or a move with no press does nothing", () => {
    expect(run([{ type: "timer", x: 0, y: 0 }, { type: "move", x: 5, y: 5 }, { type: "up", x: 5, y: 5 }]).actions)
      .toEqual(["none", "none", "none"]);
  });
});

describe("wordBounds", () => {
  test("the word around an offset", () => {
    expect(wordBounds("Run the browser checks", 10)).toEqual([8, 15]);
  });

  test("its first and last letters belong to it", () => {
    expect(wordBounds("Run the browser checks", 8)).toEqual([8, 15]);
    expect(wordBounds("Run the browser checks", 14)).toEqual([8, 15]);
  });

  test("on white space, that one character", () => {
    expect(wordBounds("Run the browser checks", 7)).toEqual([7, 8]);
  });

  test("on punctuation, that one character", () => {
    expect(wordBounds("Run it, then stop.", 6)).toEqual([6, 7]);
  });

  test("a German compound is one word", () => {
    const text = "Die Donaudampfschifffahrtsgesellschaft fährt";
    const start = text.indexOf("Donau");
    expect(wordBounds(text, start + 12, "de")).toEqual([start, start + "Donaudampfschifffahrtsgesellschaft".length]);
    expect(wordBounds(text, text.indexOf("fährt") + 2, "de")).toEqual([text.indexOf("fährt"), text.length]);
  });

  test("an emoji is taken whole, never split inside its grapheme", () => {
    const text = "Ship it 👍🏽 now";
    const start = text.indexOf("👍");
    // every code unit of the emoji and its skin tone gives the whole grapheme
    for (let offset = start; offset < start + "👍🏽".length; offset++) {
      expect(wordBounds(text, offset)).toEqual([start, start + "👍🏽".length]);
    }
  });

  test("a word with a combining mark is one word", () => {
    const text = "a nai\u0308ve plan";
    expect(wordBounds(text, 4)).toEqual([2, 8]);
  });

  test("an offset at the end takes the last character's word", () => {
    expect(wordBounds("Run checks", 10)).toEqual([4, 10]);
  });

  test("an empty text has nothing", () => {
    expect(wordBounds("", 0)).toEqual([0, 0]);
  });
});

describe("fallbackWordBounds (no Intl.Segmenter: Firefox 78, Safari 14)", () => {
  test("the word around an offset, its first and last letters included", () => {
    expect(fallbackWordBounds("Run the browser checks", 10)).toEqual([8, 15]);
    expect(fallbackWordBounds("Run the browser checks", 8)).toEqual([8, 15]);
    expect(fallbackWordBounds("Run the browser checks", 14)).toEqual([8, 15]);
  });

  test("on white space or punctuation, that one character", () => {
    expect(fallbackWordBounds("Run the browser checks", 7)).toEqual([7, 8]);
    expect(fallbackWordBounds("Run it, then stop.", 6)).toEqual([6, 7]);
  });

  test("a German compound, umlauts and digits are one word; an underscore joins one", () => {
    const text = "Die Donaudampfschifffahrtsgesellschaft fährt";
    const start = text.indexOf("Donau");
    expect(fallbackWordBounds(text, start + 12)).toEqual([start, start + "Donaudampfschifffahrtsgesellschaft".length]);
    expect(fallbackWordBounds(text, text.indexOf("fährt") + 2)).toEqual([text.indexOf("fährt"), text.length]);
    expect(fallbackWordBounds("set max_retries2 now", 6)).toEqual([4, 16]);
  });

  test("an apostrophe inside a word belongs to it, one beside a word does not", () => {
    expect(fallbackWordBounds("it don't stop", 4)).toEqual([3, 8]);
    expect(fallbackWordBounds("it don\u2019t stop", 7)).toEqual([3, 8]);
    expect(fallbackWordBounds("say 'go' now", 5)).toEqual([5, 7]);
    expect(fallbackWordBounds("say 'go' now", 4)).toEqual([4, 5]);
  });

  test("an emoji is taken whole, never split inside its surrogate pair or from its skin tone", () => {
    const text = "Ship it 👍🏽 now";
    const start = text.indexOf("👍");
    for (let offset = start; offset < start + "👍🏽".length; offset++) {
      expect(fallbackWordBounds(text, offset)).toEqual([start, start + "👍🏽".length]);
    }
  });

  test("a letter outside the BMP is a letter, and its pair is never split", () => {
    const text = "a 𝒜𝒷 b";
    expect(fallbackWordBounds(text, 3)).toEqual([2, 6]);
  });

  test("a word with a combining mark is one word", () => {
    expect(fallbackWordBounds("a nai\u0308ve plan", 4)).toEqual([2, 8]);
  });

  test("an offset at the end takes the last character's word; an empty text has nothing", () => {
    expect(fallbackWordBounds("Run checks", 10)).toEqual([4, 10]);
    expect(fallbackWordBounds("", 0)).toEqual([0, 0]);
  });
});

describe("wordBounds without Intl.Segmenter", () => {
  test("falls back to the scan", () => {
    const segmenter = Intl.Segmenter;
    try {
      (Intl as { Segmenter?: unknown }).Segmenter = undefined;
      expect(wordBounds("Run the browser checks", 10)).toEqual([8, 15]);
      expect(wordBounds("Ship it 👍🏽 now", 9)).toEqual([8, 12]);
    } finally {
      (Intl as { Segmenter?: unknown }).Segmenter = segmenter;
    }
  });
});

describe("moveEdge", () => {
  test("the end moved past the start: the ends swap, and the dragged edge is the start", () => {
    expect(moveEdge(5, 10, "end", 3)).toEqual({ start: 3, end: 5, edge: "start" });
  });

  test("the start moved past the end: the ends swap, and the dragged edge is the end", () => {
    expect(moveEdge(5, 10, "start", 14)).toEqual({ start: 10, end: 14, edge: "end" });
  });

  test("an end moved on its own side stays that end", () => {
    expect(moveEdge(5, 10, "end", 12)).toEqual({ start: 5, end: 12, edge: "end" });
    expect(moveEdge(5, 10, "end", 7)).toEqual({ start: 5, end: 7, edge: "end" });
    expect(moveEdge(5, 10, "start", 2)).toEqual({ start: 2, end: 10, edge: "start" });
    expect(moveEdge(5, 10, "start", 8)).toEqual({ start: 8, end: 10, edge: "start" });
  });

  test("an end moved onto the other one leaves the selection as it was: it never collapses", () => {
    expect(moveEdge(5, 10, "end", 5)).toEqual({ start: 5, end: 10, edge: "end" });
    expect(moveEdge(5, 10, "start", 10)).toEqual({ start: 5, end: 10, edge: "start" });
  });
});

describe("pillTop", () => {
  // the view's top at 100; the pill 40 px high, 8 px clear of the text
  const place = { view: 100, height: 40, gap: 8, below: 20 };

  test("above the selection where there is room", () => {
    expect(pillTop({ ...place, first: 300, last: 360 })).toBe(300 - 8 - 40);
  });

  test("below the end handle where there is none above", () => {
    expect(pillTop({ ...place, first: 120, last: 160 })).toBe(160 + 20);
  });

  test("exactly enough room above is room", () => {
    expect(pillTop({ ...place, first: 148, last: 170 })).toBe(100);
  });
});
