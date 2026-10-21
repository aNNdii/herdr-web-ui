import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

import { REVIEW_KEYS, reviewKey, reviewKeyOf, type KeyFocus, type ReviewKeyFacts } from "./reviewKeys.ts";

function press(key: string, code: string, extra: Partial<ReviewKeyFacts> = {}): ReviewKeyFacts {
  return { key, code, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, repeat: false, isComposing: false, keyCode: 0, ...extra };
}

const j = press("j", "KeyJ");
const k = press("k", "KeyK");
const down = press("ArrowDown", "ArrowDown");
const up = press("ArrowUp", "ArrowUp");
const next = press("]", "BracketRight");
const previous = press("[", "BracketLeft");
const v = press("v", "KeyV");
const c = press("c", "KeyC");
const enter = press("Enter", "Enter");
const escape = press("Escape", "Escape");
const space = press(" ", "Space");
const pageDown = press("PageDown", "PageDown");
const pageUp = press("PageUp", "PageUp");

describe("reviewKey", () => {
  it("names each review key outside text fields", () => {
    expect(reviewKey(j, "other")).toBe("down");
    expect(reviewKey(down, "other")).toBe("down");
    expect(reviewKey(k, "other")).toBe("up");
    expect(reviewKey(up, "other")).toBe("up");
    expect(reviewKey(next, "other")).toBe("next");
    expect(reviewKey(previous, "other")).toBe("previous");
    expect(reviewKey(v, "other")).toBe("viewed");
    expect(reviewKey(c, "other")).toBe("comment");
    expect(reviewKey(enter, "other")).toBe("comment");
    expect(reviewKey(escape, "other")).toBe("clear");
    expect(reviewKey(press("x", "KeyX"), "other")).toBeNull();
    expect(reviewKey(press("Tab", "Tab"), "other")).toBeNull();
  });

  it("leaves every key with Ctrl, Alt or Meta alone", () => {
    for (const modifier of ["ctrlKey", "altKey", "metaKey"] as const) {
      for (const event of [j, down, next, v, c, enter, escape]) expect(reviewKey({ ...event, [modifier]: true }, "other")).toBeNull();
    }
  });

  it("leaves keys to an IME composition", () => {
    expect(reviewKey({ ...j, isComposing: true }, "other")).toBeNull();
    expect(reviewKey({ ...j, key: "Process", keyCode: 229 }, "other")).toBeNull();
    expect(reviewKey({ ...escape, isComposing: true }, "other")).toBeNull();
  });

  it("does nothing in a text field", () => {
    for (const event of [j, down, next, previous, v, c, enter, escape]) expect(reviewKey(event, "text")).toBeNull();
  });

  it("repeats only j, k, the arrows and the brackets while a key is held", () => {
    for (const event of [j, k, down, up, next, previous]) expect(reviewKey({ ...event, repeat: true }, "other")).not.toBeNull();
    expect(reviewKey({ ...press("J", "KeyJ"), shiftKey: true, repeat: true }, "other")).toBe("extend-down");
    for (const event of [v, c, enter, escape]) expect(reviewKey({ ...event, repeat: true }, "other")).toBeNull();
  });

  it("extends with Shift on j, k and the arrows, and ignores Shift elsewhere", () => {
    expect(reviewKey({ ...press("J", "KeyJ"), shiftKey: true }, "other")).toBe("extend-down");
    expect(reviewKey({ ...down, shiftKey: true }, "other")).toBe("extend-down");
    expect(reviewKey({ ...press("K", "KeyK"), shiftKey: true }, "other")).toBe("extend-up");
    expect(reviewKey({ ...up, shiftKey: true }, "other")).toBe("extend-up");
    expect(reviewKey({ ...press("V", "KeyV"), shiftKey: true }, "other")).toBe("viewed");
    expect(reviewKey({ ...press("C", "KeyC"), shiftKey: true }, "other")).toBe("comment");
    expect(reviewKey({ ...press("}", "BracketRight"), shiftKey: true }, "other")).toBe("next");
    expect(reviewKey({ ...escape, shiftKey: true }, "other")).toBe("clear");
  });

  it("keeps Enter for a focused control and the tree, but c works there", () => {
    for (const focus of ["control", "tree"] as const satisfies readonly KeyFocus[]) {
      expect(reviewKey(enter, focus)).toBeNull();
      expect(reviewKey(c, focus)).toBe("comment");
    }
  });

  it("leaves the arrows to the tree, but j, k, the brackets and v work there", () => {
    for (const event of [down, up, { ...down, shiftKey: true }, { ...up, shiftKey: true }]) expect(reviewKey(event, "tree")).toBeNull();
    expect(reviewKey(j, "tree")).toBe("down");
    expect(reviewKey(k, "tree")).toBe("up");
    expect(reviewKey(next, "tree")).toBe("next");
    expect(reviewKey(previous, "tree")).toBe("previous");
    expect(reviewKey(v, "tree")).toBe("viewed");
    expect(reviewKey(down, "control")).toBe("down");
  });

  it("pages with Space, Shift+Space and the page keys, held too, but leaves them to a focused control, the tree and a text field", () => {
    expect(reviewKey(space, "other")).toBe("page-down");
    expect(reviewKey({ ...space, shiftKey: true }, "other")).toBe("page-up");
    expect(reviewKey(pageDown, "other")).toBe("page-down");
    expect(reviewKey(pageUp, "other")).toBe("page-up");
    expect(reviewKey({ ...pageDown, shiftKey: true }, "other")).toBe("page-down");
    expect(reviewKey({ ...space, repeat: true }, "other")).toBe("page-down");
    for (const focus of ["control", "tree", "text"] as const) for (const event of [space, pageDown, pageUp]) expect(reviewKey(event, focus)).toBeNull();
  });

  it("reads the brackets and non-Latin letters by position", () => {
    // German layout: Ü sits on [ and + on ]
    expect(reviewKey(press("ü", "BracketLeft"), "other")).toBe("previous");
    expect(reviewKey(press("+", "BracketRight"), "other")).toBe("next");
    // Russian layout: о sits on J
    expect(reviewKey(press("о", "KeyJ"), "other")).toBe("down");
    expect(reviewKey(press("м", "KeyV"), "other")).toBe("viewed");
  });
});

interface FakeElement {
  tagName: string;
  isContentEditable: boolean;
  parentElement: FakeElement | null;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  matches(selector: string): boolean;
  closest(selector: string): FakeElement | null;
}

function element(tagName: string, attributes: Record<string, string> = {}, options: { focusVisible?: boolean; editable?: boolean; parent?: FakeElement } = {}): FakeElement {
  const self: FakeElement = {
    tagName,
    isContentEditable: options.editable ?? false,
    parentElement: options.parent ?? null,
    getAttribute: (name) => attributes[name] ?? null,
    hasAttribute: (name) => Object.hasOwn(attributes, name),
    matches: (selector) => selector === ":focus-visible" && (options.focusVisible ?? false),
    closest: (selector) => {
      const role = /^\[role="(\w+)"\]$/.exec(selector)?.[1];
      for (let at: FakeElement | null = self; at !== null; at = at.parentElement) if (role !== undefined && at.getAttribute("role") === role) return at;
      return null;
    },
  };
  return self;
}

function keyboardEvent(facts: ReviewKeyFacts, target: FakeElement | null, defaultPrevented = false): KeyboardEvent {
  return { ...facts, defaultPrevented, target, composedPath: () => (target === null ? [] : [target]) } as unknown as KeyboardEvent;
}

function surfaceWith(popoverOpen: boolean): HTMLElement {
  return { querySelector: (selector: string) => (popoverOpen && selector.includes("aria-expanded") ? {} : null), contains: () => false } as unknown as HTMLElement;
}

describe("reviewKeyOf", () => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  let modals: unknown[] = [];

  beforeEach(() => {
    modals = [];
    Object.defineProperty(globalThis, "document", { configurable: true, value: { querySelectorAll: () => modals } });
  });
  afterEach(() => {
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
  });

  const body = element("BODY");
  const surface = surfaceWith(false);

  it("reads the focus from the event's own target", () => {
    expect(reviewKeyOf(keyboardEvent(j, body), surface, true)).toBe("down");
    expect(reviewKeyOf(keyboardEvent(j, null), surface, true)).toBe("down");
  });

  it("treats an empty input, a textarea, a select and contenteditable as a text field", () => {
    for (const field of [element("INPUT", { value: "" }), element("TEXTAREA"), element("SELECT"), element("DIV", {}, { editable: true })]) {
      expect(reviewKeyOf(keyboardEvent(j, field), surface, true)).toBeNull();
    }
  });

  it("keeps Enter for a keyboard-focused control, not for one a click focused", () => {
    expect(reviewKeyOf(keyboardEvent(enter, element("BUTTON", {}, { focusVisible: true })), surface, true)).toBeNull();
    expect(reviewKeyOf(keyboardEvent(enter, element("A", { href: "#" }, { focusVisible: true })), surface, true)).toBeNull();
    expect(reviewKeyOf(keyboardEvent(enter, element("SUMMARY", {}, { focusVisible: true })), surface, true)).toBeNull();
    expect(reviewKeyOf(keyboardEvent(enter, element("DIV", { role: "menuitemcheckbox" }, { focusVisible: true })), surface, true)).toBeNull();
    expect(reviewKeyOf(keyboardEvent(enter, element("BUTTON")), surface, true)).toBe("comment");
    expect(reviewKeyOf(keyboardEvent(enter, element("A", {}, { focusVisible: true })), surface, true)).toBe("comment");
  });

  it("finds the tree around the focused row", () => {
    const tree = element("DIV", { role: "tree" });
    const row = element("BUTTON", { role: "treeitem" }, { focusVisible: true, parent: tree });
    expect(reviewKeyOf(keyboardEvent(down, row), surface, true)).toBeNull();
    expect(reviewKeyOf(keyboardEvent(enter, row), surface, true)).toBeNull();
    expect(reviewKeyOf(keyboardEvent(j, row), surface, true)).toBe("down");
  });

  it("does nothing for an event already handled, under an open popover or a native dialog", () => {
    expect(reviewKeyOf(keyboardEvent(j, body, true), surface, true)).toBeNull();
    expect(reviewKeyOf(keyboardEvent(j, body), surfaceWith(true), true)).toBeNull();
    modals = [{ matches: () => true, contains: () => false }];
    expect(reviewKeyOf(keyboardEvent(j, body), surface, true)).toBeNull();
  });

  it("lets only the browser's keys through while the review keys are off: Escape, the pages, an arrow as a line's scroll", () => {
    for (const event of [j, k, { ...down, shiftKey: true }, next, previous, v, c, enter]) expect(reviewKeyOf(keyboardEvent(event, body), surface, false)).toBeNull();
    expect(reviewKeyOf(keyboardEvent(down, body), surface, false)).toBe("line-down");
    expect(reviewKeyOf(keyboardEvent(up, body), surface, false)).toBe("line-up");
    expect(reviewKeyOf(keyboardEvent(escape, body), surface, false)).toBe("clear");
    expect(reviewKeyOf(keyboardEvent(space, body), surface, false)).toBe("page-down");
    expect(reviewKeyOf(keyboardEvent(pageUp, body), surface, false)).toBe("page-up");
  });
});

describe("REVIEW_KEYS", () => {
  it("has one row per action", () => {
    const actions = REVIEW_KEYS.map((row) => row.action);
    expect(new Set(actions).size).toBe(actions.length);
    expect([...actions].sort()).toEqual(["clear", "comment", "down", "extend-down", "extend-up", "next", "page-down", "page-up", "previous", "up", "viewed"]);
  });

  it("is documented key by key in the guide's review table", () => {
    const guide = readFileSync(new URL("../../docs/guide.md", import.meta.url), "utf8");
    const start = guide.indexOf("\n### Review keys\n");
    expect(start).toBeGreaterThan(-1);
    const end = guide.indexOf("\n#", start + 1);
    const section = guide.slice(start, end === -1 ? undefined : end);
    for (const row of REVIEW_KEYS) for (const key of row.keys) expect(section).toContain(`\`${key}\``);
  });
});
