import { afterEach, describe, expect, it } from "bun:test";

import {
  clampReviewTreeWidth,
  keyedReviewTreeWidth,
  parseReviewTreeWidth,
  REVIEW_TREE_MIN_WIDTH,
  REVIEW_TREE_WIDTH_STEP,
  reviewTreeColumn,
  reviewTreeMaxWidth,
  storedReviewTreeWidth,
  storeReviewTreeWidth,
} from "./reviewTreeWidth.ts";

const KEY = "ovis:review-tree-width";
const original = Object.getOwnPropertyDescriptor(globalThis, "window");

function withStorage(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">): void {
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: storage } });
}

function memoryStorage(): Map<string, string> & Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const items = new Map<string, string>();
  return Object.assign(items, {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => { items.set(key, value); },
    removeItem: (key: string) => { items.delete(key); },
  });
}

afterEach(() => {
  if (original) Object.defineProperty(globalThis, "window", original);
  else delete (globalThis as { window?: unknown }).window;
});

describe("reviewTreeMaxWidth", () => {
  it("leaves 360px to the file and never passes 640px", () => {
    expect(reviewTreeMaxWidth(800)).toBe(440);
    expect(reviewTreeMaxWidth(1000)).toBe(640);
    expect(reviewTreeMaxWidth(3000)).toBe(640);
    expect(reviewTreeMaxWidth(800.7)).toBe(440);
  });

  it("never drops below the minimum, even in a narrow body", () => {
    expect(reviewTreeMaxWidth(560)).toBe(REVIEW_TREE_MIN_WIDTH);
    expect(reviewTreeMaxWidth(400)).toBe(REVIEW_TREE_MIN_WIDTH);
    expect(reviewTreeMaxWidth(0)).toBe(REVIEW_TREE_MIN_WIDTH);
  });
});

describe("clampReviewTreeWidth", () => {
  it("keeps the width between 200px and the body's limit, in whole pixels", () => {
    expect(clampReviewTreeWidth(100, 1200)).toBe(200);
    expect(clampReviewTreeWidth(900, 1200)).toBe(640);
    expect(clampReviewTreeWidth(500, 800)).toBe(440);
    expect(clampReviewTreeWidth(333.6, 1200)).toBe(334);
    expect(clampReviewTreeWidth(300, 400)).toBe(200);
  });

  it("caps at 640px when no body width is given", () => {
    expect(clampReviewTreeWidth(9000)).toBe(640);
    expect(clampReviewTreeWidth(50)).toBe(200);
  });
});

describe("keyedReviewTreeWidth", () => {
  it("widens with ArrowRight and narrows with ArrowLeft in 16px steps, as the edge is on the right", () => {
    expect(REVIEW_TREE_WIDTH_STEP).toBe(16);
    expect(keyedReviewTreeWidth(300, "ArrowRight", 1200)).toBe(316);
    expect(keyedReviewTreeWidth(300, "ArrowLeft", 1200)).toBe(284);
    expect(keyedReviewTreeWidth(200, "ArrowLeft", 1200)).toBe(200);
    expect(keyedReviewTreeWidth(640, "ArrowRight", 1200)).toBe(640);
    expect(keyedReviewTreeWidth(430, "ArrowRight", 800)).toBe(440);
  });

  it("moves to the minimum with Home and to the body's limit with End", () => {
    expect(keyedReviewTreeWidth(300, "Home", 1200)).toBe(200);
    expect(keyedReviewTreeWidth(300, "End", 1200)).toBe(640);
    expect(keyedReviewTreeWidth(300, "End", 800)).toBe(440);
    expect(keyedReviewTreeWidth(300, "End", 500)).toBe(200);
  });

  it("leaves every other key alone", () => {
    expect(keyedReviewTreeWidth(300, "Enter", 1200)).toBeNull();
    expect(keyedReviewTreeWidth(300, "ArrowUp", 1200)).toBeNull();
    expect(keyedReviewTreeWidth(300, "a", 1200)).toBeNull();
  });
});

describe("reviewTreeColumn", () => {
  it("draws the default width inside the limits", () => {
    expect(reviewTreeColumn(null)).toBe("clamp(200px, clamp(260px, 22%, 440px), max(200px, min(640px, 100% - 360px)))");
  });

  it("draws a chosen width inside the limits, so a narrow body caps it without changing it", () => {
    expect(reviewTreeColumn(480)).toBe("clamp(200px, 480px, max(200px, min(640px, 100% - 360px)))");
    expect(reviewTreeColumn(9000)).toBe("clamp(200px, 9000px, max(200px, min(640px, 100% - 360px)))");
    expect(reviewTreeColumn(333.6)).toBe("clamp(200px, 334px, max(200px, min(640px, 100% - 360px)))");
  });
});

describe("parseReviewTreeWidth", () => {
  it("reads a stored width without clamping it", () => {
    expect(parseReviewTreeWidth("480")).toBe(480);
    expect(parseReviewTreeWidth("12")).toBe(12);
    expect(parseReviewTreeWidth("9000")).toBe(9000);
  });

  it("falls back to the default width for anything else", () => {
    expect(parseReviewTreeWidth(null)).toBeNull();
    expect(parseReviewTreeWidth("")).toBeNull();
    expect(parseReviewTreeWidth("wide")).toBeNull();
    expect(parseReviewTreeWidth("480px")).toBeNull();
    expect(parseReviewTreeWidth("-20")).toBeNull();
    expect(parseReviewTreeWidth("4.5")).toBeNull();
  });
});

describe("the stored review tree width", () => {
  it("keeps a chosen width per device, unclamped, and forgets it on null", () => {
    const storage = memoryStorage();
    withStorage(storage);
    expect(storedReviewTreeWidth()).toBeNull();
    storeReviewTreeWidth(9000);
    expect(storage.get(KEY)).toBe("9000");
    expect(storedReviewTreeWidth()).toBe(9000);
    storeReviewTreeWidth(333.6);
    expect(storage.get(KEY)).toBe("334");
    storeReviewTreeWidth(null);
    expect(storage.has(KEY)).toBe(false);
    expect(storedReviewTreeWidth()).toBeNull();
  });

  it("stays at the default width and silent without storage (private mode)", () => {
    const denied = (): never => { throw new Error("denied"); };
    withStorage({ getItem: denied, setItem: denied, removeItem: denied });
    expect(() => storeReviewTreeWidth(480)).not.toThrow();
    expect(() => storeReviewTreeWidth(null)).not.toThrow();
    expect(storedReviewTreeWidth()).toBeNull();
  });
});
