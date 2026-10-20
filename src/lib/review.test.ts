import { afterEach, describe, expect, it } from "bun:test";

import { storedHideViewed, storedNewFilesApart, storedShowIgnored, storeHideViewed, storeNewFilesApart, storeShowIgnored, workspacePick } from "./review.ts";

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

describe("workspacePick", () => {
  it("spans the working tree's lines of a selection, whichever way it was dragged", () => {
    expect(workspacePick([{ line: 14, old: false }, { line: 12, old: false }, { line: 13, old: false }])).toEqual([12, 14]);
  });

  it("leaves out the old file's rows when the working tree's are in it", () => {
    expect(workspacePick([{ line: 40, old: true }, { line: 30, old: false }, { line: 31, old: false }])).toEqual([30, 31]);
  });

  it("refuses a selection of removed lines only", () => {
    expect(workspacePick([{ line: 30, old: true }, { line: 31, old: true }])).toBeNull();
  });

  it("finds nothing without a numbered line", () => {
    expect(workspacePick([])).toBeNull();
    expect(workspacePick([{ line: 0, old: false }, { line: Number.NaN, old: false }])).toBeNull();
  });
});

describe("the review's per-device toggles", () => {
  it("keeps Hide viewed files under its own key, apart from Show ignored files", () => {
    const storage = memoryStorage();
    withStorage(storage);
    expect(storedHideViewed()).toBe(false);
    storeHideViewed(true);
    expect(storage.get("herdr-web-ui:review-hide-viewed")).toBe("1");
    expect(storedHideViewed()).toBe(true);
    expect(storedShowIgnored()).toBe(false);
    storeHideViewed(false);
    expect(storage.has("herdr-web-ui:review-hide-viewed")).toBe(false);
    expect(storedHideViewed()).toBe(false);
  });

  it("keeps Show ignored files under its old key", () => {
    const storage = memoryStorage();
    withStorage(storage);
    storeShowIgnored(true);
    expect(storage.get("herdr-web-ui:review-show-ignored")).toBe("1");
    expect(storedShowIgnored()).toBe(true);
    expect(storedHideViewed()).toBe(false);
  });

  it("keeps List new files separately under its own key, off until turned on", () => {
    const storage = memoryStorage();
    withStorage(storage);
    expect(storedNewFilesApart()).toBe(false);
    storeNewFilesApart(true);
    expect(storage.get("herdr-web-ui:review-new-files-apart")).toBe("1");
    expect(storedNewFilesApart()).toBe(true);
    expect(storedHideViewed()).toBe(false);
    storeNewFilesApart(false);
    expect(storage.has("herdr-web-ui:review-new-files-apart")).toBe(false);
  });

  it("stays off and silent without storage (private mode)", () => {
    const denied = (): never => { throw new Error("denied"); };
    withStorage({ getItem: denied, setItem: denied, removeItem: denied });
    expect(() => storeHideViewed(true)).not.toThrow();
    expect(storedHideViewed()).toBe(false);
  });
});
