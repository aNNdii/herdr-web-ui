import { afterEach, describe, expect, it } from "bun:test";

import { storedHideViewed, storedMarkdownViews, storedNewFilesApart, storedReviewKeysOff, storedShowIgnored, storeHideViewed, storeMarkdownView, storeNewFilesApart, storeReviewKeysOff, storeShowIgnored, workspacePick } from "./review.ts";

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
    expect(storage.get("ovis:review-hide-viewed")).toBe("1");
    expect(storedHideViewed()).toBe(true);
    expect(storedShowIgnored()).toBe(false);
    storeHideViewed(false);
    expect(storage.has("ovis:review-hide-viewed")).toBe(false);
    expect(storedHideViewed()).toBe(false);
  });

  it("keeps Show ignored files under its old key", () => {
    const storage = memoryStorage();
    withStorage(storage);
    storeShowIgnored(true);
    expect(storage.get("ovis:review-show-ignored")).toBe("1");
    expect(storedShowIgnored()).toBe(true);
    expect(storedHideViewed()).toBe(false);
  });

  it("keeps List new files separately under its own key, off until turned on", () => {
    const storage = memoryStorage();
    withStorage(storage);
    expect(storedNewFilesApart()).toBe(false);
    storeNewFilesApart(true);
    expect(storage.get("ovis:review-new-files-apart")).toBe("1");
    expect(storedNewFilesApart()).toBe(true);
    expect(storedHideViewed()).toBe(false);
    storeNewFilesApart(false);
    expect(storage.has("ovis:review-new-files-apart")).toBe(false);
  });

  it("keeps the review keys on until turned off, under their own key", () => {
    const storage = memoryStorage();
    withStorage(storage);
    expect(storedReviewKeysOff()).toBe(false);
    storeReviewKeysOff(true);
    expect([...storage.entries()]).toEqual([["ovis:review-keys-off", "1"]]);
    expect(storedReviewKeysOff()).toBe(true);
    expect(storedHideViewed()).toBe(false);
    storeReviewKeysOff(false);
    expect(storage.size).toBe(0);
    expect(storedReviewKeysOff()).toBe(false);
  });

  it("keeps the review keys on without storage (private mode)", () => {
    const denied = (): never => { throw new Error("denied"); };
    withStorage({ getItem: denied, setItem: denied, removeItem: denied });
    expect(() => storeReviewKeysOff(true)).not.toThrow();
    expect(storedReviewKeysOff()).toBe(false);
  });

  it("stays off and silent without storage (private mode)", () => {
    const denied = (): never => { throw new Error("denied"); };
    withStorage({ getItem: denied, setItem: denied, removeItem: denied });
    expect(() => storeHideViewed(true)).not.toThrow();
    expect(storedHideViewed()).toBe(false);
  });
});

describe("the Markdown view of each list", () => {
  it("starts as Source in Changed files and as Preview in All files", () => {
    withStorage(memoryStorage());
    expect(storedMarkdownViews()).toEqual({ changed: "source", all: "preview" });
  });

  it("writes only the key of the list the choice was made in, and reads it back at the next opening", () => {
    const storage = memoryStorage();
    withStorage(storage);
    const views = storeMarkdownView(storedMarkdownViews(), "changed", "preview");
    expect(views).toEqual({ changed: "preview", all: "preview" });
    expect([...storage.entries()]).toEqual([["ovis:review-markdown-view:changed", "preview"]]);
    expect(storedMarkdownViews()).toEqual({ changed: "preview", all: "preview" });
    expect(storeMarkdownView(views, "all", "source")).toEqual({ changed: "preview", all: "source" });
    expect(storage.get("ovis:review-markdown-view:all")).toBe("source");
    expect(storage.get("ovis:review-markdown-view:changed")).toBe("preview");
  });

  it("keeps a choice that is the default, so another default later does not turn it round", () => {
    const storage = memoryStorage();
    withStorage(storage);
    storeMarkdownView(storedMarkdownViews(), "changed", "source");
    expect(storage.get("ovis:review-markdown-view:changed")).toBe("source");
  });

  it("takes an unknown value for the default", () => {
    const storage = memoryStorage();
    withStorage(storage);
    storage.set("ovis:review-markdown-view:changed", "1");
    storage.set("ovis:review-markdown-view:all", "diff");
    expect(storedMarkdownViews()).toEqual({ changed: "source", all: "preview" });
  });

  it("gives the defaults without storage, and the choice holds for this opening", () => {
    const denied = (): never => { throw new Error("denied"); };
    withStorage({ getItem: denied, setItem: denied, removeItem: denied });
    expect(storedMarkdownViews()).toEqual({ changed: "source", all: "preview" });
    expect(storeMarkdownView(storedMarkdownViews(), "all", "source")).toEqual({ changed: "source", all: "source" });
  });
});
