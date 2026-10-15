import { describe, expect, it } from "bun:test";
import { isCommentClick, isDismissingPress, markDismissingPress, type ClickFacts } from "./commentClick.ts";

const plain: ClickFacts = { button: 0, detail: 1, interactive: false, selectionCollapsed: true, dismissesKeyboard: false };

describe("isCommentClick", () => {
  it("takes a plain primary click", () => {
    expect(isCommentClick(plain)).toBe(true);
  });
  it("ignores another button", () => {
    expect(isCommentClick({ ...plain, button: 2 })).toBe(false);
  });
  it("ignores a double or triple click", () => {
    expect(isCommentClick({ ...plain, detail: 2 })).toBe(false);
    expect(isCommentClick({ ...plain, detail: 3 })).toBe(false);
  });
  it("ignores a click on something interactive", () => {
    expect(isCommentClick({ ...plain, interactive: true })).toBe(false);
  });
  it("ignores a click that ends a selection", () => {
    expect(isCommentClick({ ...plain, selectionCollapsed: false })).toBe(false);
  });
  it("ignores a tap that puts the keyboard away", () => {
    expect(isCommentClick({ ...plain, dismissesKeyboard: true })).toBe(false);
  });
});

describe("isDismissingPress", () => {
  it("holds for the press that dismissed a popover, and only for it", () => {
    const press = new Event("pointerdown");
    const next = new Event("pointerdown");
    expect(isDismissingPress(press)).toBe(false);
    markDismissingPress(press);
    expect(isDismissingPress(press)).toBe(true);
    expect(isDismissingPress(next)).toBe(false);
  });
  it("holds for no press", () => {
    expect(isDismissingPress(null)).toBe(false);
    expect(isDismissingPress(undefined)).toBe(false);
  });
});
