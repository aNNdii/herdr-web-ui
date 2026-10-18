import { afterEach, describe, expect, it } from "bun:test";

import { storedHideViewed, storedShowIgnored, storeHideViewed, storeShowIgnored } from "./review.ts";

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

  it("stays off and silent without storage (private mode)", () => {
    const denied = (): never => { throw new Error("denied"); };
    withStorage({ getItem: denied, setItem: denied, removeItem: denied });
    expect(() => storeHideViewed(true)).not.toThrow();
    expect(storedHideViewed()).toBe(false);
  });
});
