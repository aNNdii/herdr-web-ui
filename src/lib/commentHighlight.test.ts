import { describe, expect, it } from "bun:test";
import { walkScroll } from "./commentHighlight.ts";

describe("walkScroll", () => {
  // a view 100 to 500 on screen
  const view = { top: 100, height: 400 };

  it("centres the text and its card when they fit", () => {
    expect(walkScroll({ top: 600, bottom: 700 }, { top: 710, bottom: 740 }, view)).toBe(370);
    expect(walkScroll({ top: 0, bottom: 40 }, { top: 50, bottom: 80 }, view)).toBe(-260);
  });

  it("brings the card's bottom to the view's bottom when they are taller than the view", () => {
    expect(walkScroll({ top: 200, bottom: 1200 }, { top: 1210, bottom: 1240 }, view)).toBe(740);
    expect(walkScroll({ top: -900, bottom: 80 }, { top: 90, bottom: 120 }, view)).toBe(-380);
  });

  it("keeps the card on screen when the text runs on below it", () => {
    expect(walkScroll({ top: 200, bottom: 1300 }, { top: 1210, bottom: 1240 }, view)).toBe(740);
  });
});
