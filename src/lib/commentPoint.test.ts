import { describe, expect, it } from "bun:test";
import { isCommentPoint } from "./commentPoint.ts";

describe("isCommentPoint", () => {
  it("is finite fractions inside the bounds", () => {
    expect(isCommentPoint({ x: 0.5, y: 0.5 })).toBe(true);
    expect(isCommentPoint({ x: -1, y: 2 })).toBe(true);
    expect(isCommentPoint({ x: 8, y: -1 })).toBe(true);
  });
  it("is not anything else", () => {
    for (const value of [null, undefined, 3, "0.5,0.5", [0.5, 0.5], {}, { x: 0.5 }, { x: "0.5", y: 0.5 }, { x: Number.NaN, y: 0 }, { x: Infinity, y: 0 }, { x: 8.01, y: 0 }, { x: -1.01, y: 0 }, { x: 0, y: 2.01 }, { x: 0, y: -1.5 }]) {
      expect(isCommentPoint(value)).toBe(false);
    }
  });
});
