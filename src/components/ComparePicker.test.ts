import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createElement } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import type { BranchChoice } from "../lib/branchReview.ts";
import { SettingsProvider } from "../lib/settings.ts";
import { ComparePicker, type ComparePickerProps } from "./ComparePicker.tsx";

const HOUR = 3600;
const now = Math.floor(Date.now() / 1000);
const BRANCHES: BranchChoice[] = [
  { name: "feat/x", remote: false, worktree: { name: "repo", path: "/repo", here: true }, commit: { hash: "abcdef1234567890", time: now - 3 * HOUR - 60, subject: "Fix the parser" } },
  { name: "other", remote: false, worktree: { name: "wt-other", path: "/wt-other", here: false }, commit: null },
  { name: "main", remote: false, worktree: null, commit: { hash: "1234567abcdef", time: now - 2 * 24 * HOUR - 60, subject: "release: v1" } },
  { name: "origin/main", remote: true, worktree: null, commit: null },
];

const text = (node: ReactTestInstance | string): string => typeof node === "string" ? node : node.children.map(text).join("");

// React, the settings and the picker stay real; the DOM is a stand-in: elements are plain objects that record focus
describe("ComparePicker", () => {
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  let renderers: ReactTestRenderer[];
  let listeners: Map<string, Set<(event: unknown) => void>>;
  /** the class names of the elements focused, in order */
  let focused: string[];

  beforeEach(() => {
    for (const key of ["window", "document", "navigator", "getComputedStyle", "IS_REACT_ACT_ENVIRONMENT"]) descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    renderers = []; listeners = new Map(); focused = [];
    const on = (type: string, listener: (event: unknown) => void): void => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(listener); };
    const off = (type: string, listener: (event: unknown) => void): void => { listeners.get(type)?.delete(listener); };
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
    // src/lib/settings.ts reads the stylesheet's --bg when it applies the settings
    Object.defineProperty(globalThis, "getComputedStyle", { configurable: true, value: () => ({ getPropertyValue: () => "#12100e" }) });
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { languages: ["en-US"] } });
    Object.defineProperty(globalThis, "window", { configurable: true, value: {
      localStorage: { getItem: () => null, setItem() {} },
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
      requestAnimationFrame: () => 0, cancelAnimationFrame() {},
      innerWidth: 1440, innerHeight: 900, visualViewport: null,
      addEventListener: on, removeEventListener: off,
      history: { state: null, replaceState() {}, pushState() {} },
    } });
    Object.defineProperty(globalThis, "document", { configurable: true, value: {
      documentElement: { dataset: {}, style: { setProperty() {}, removeProperty() {} } },
      querySelector: () => null, getElementById: () => null,
      addEventListener() {}, removeEventListener() {},
    } });
  });

  afterEach(async () => {
    await act(async () => { for (const renderer of renderers) renderer.unmount(); });
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    descriptors.clear();
  });

  async function render(props: Partial<ComparePickerProps> = {}) {
    const calls: string[] = [];
    const all: ComparePickerProps = {
      mode: "uncommitted", compare: "feat/x", base: "main", branches: BRANCHES, listLoading: false, truncated: false, invalid: null,
      onTip: (tip) => calls.push(`tip ${tip}`),
      onBranch: (part, name) => calls.push(`${part} ${name}`),
      onBranchesShown: () => calls.push("branches shown"),
      ...props,
    };
    let renderer: ReactTestRenderer | undefined;
    const element = (current: ComparePickerProps) => createElement(SettingsProvider, null, createElement(ComparePicker, current));
    await act(async () => {
      renderer = create(element(all), {
        createNodeMock: (node) => ({
          focus: () => focused.push(String((node.props as { className?: string }).className ?? node.type)),
          getBoundingClientRect: () => ({ top: 40, bottom: 64, left: 100, right: 220, width: 120, height: 24 }),
          contains: () => false,
          offsetWidth: 420, offsetHeight: 300, style: {}, scrollTop: 0, isConnected: true,
        }),
      });
    });
    renderers.push(renderer!);
    const root = renderer!.root;
    const part = (name: "compare" | "base") => root.find((node) => node.type === "button" && node.props["data-part"] === name);
    const picker = () => root.findAll((node) => node.type === "div" && node.props.role === "dialog");
    const input = () => root.find((node) => node.type === "input");
    const key = async (name: string) => act(async () => { input().props.onKeyDown({ key: name, altKey: false, preventDefault() {}, stopPropagation() {} }); });
    return {
      calls,
      part,
      partText: (name: "compare" | "base") => text(part(name)),
      open: async (name: "compare" | "base") => act(async () => { part(name).props.onClick(); }),
      picker,
      tabs: () => root.find((node) => node.type === "div" && node.props.role === "group" && node.props["aria-label"] === "Compare").findAllByType("button")
        .map((button) => ({ text: text(button), pressed: button.props["aria-pressed"] as boolean })),
      tab: async (name: string) => act(async () => {
        root.find((node) => node.type === "div" && node.props.role === "group").findAllByType("button").find((button) => text(button) === name)!.props.onClick();
      }),
      tip: () => root.find((node) => node.type === "button" && node.props.className?.includes("compare-picker-tip")),
      options: () => root.findAll((node) => node.type === "div" && node.props.role === "option")
        .map((option) => ({ text: text(option), selected: option.props["aria-selected"] as boolean, id: option.props.id as string })),
      headings: () => root.findAll((node) => node.props.className === "menu-heading").map(text),
      input,
      type: async (value: string) => act(async () => { input().props.onChange({ target: { value } }); }),
      key,
      escape: async () => act(async () => {
        for (const listener of [...(listeners.get("keydown") ?? [])]) listener({ key: "Escape", preventDefault() {}, stopPropagation() {} });
      }),
      rerender: async (next: Partial<ComparePickerProps>) => act(async () => { renderer!.update(element({ ...all, ...next })); }),
    };
  }

  it("reads a tip as its words, and its picker offers exactly Uncommitted, Staged and Branches", async () => {
    const view = await render();
    expect(view.partText("compare")).toBe("Uncommitted changes");
    expect(view.part("compare").props["aria-expanded"]).toBe(false);
    expect(view.picker()).toEqual([]);
    await view.open("compare");
    expect(view.part("compare").props["aria-expanded"]).toBe(true);
    expect(view.tabs()).toEqual([
      { text: "Uncommitted", pressed: true },
      { text: "Staged", pressed: false },
      { text: "Branches", pressed: false },
    ]);
    // the tip's own row, marked as the one compared
    expect(text(view.tip())).toBe("UncommittedStaged, unstaged and untracked files against HEAD");
    await view.tab("Staged");
    expect(text(view.tip())).toBe("StagedWhat the next commit takes, against HEAD");
    await act(async () => { view.tip().props.onClick(); });
    // the branch list is asked for as the picker opens, so Branches has it ready
    expect(view.calls.filter((call) => call !== "branches shown")).toEqual(["tip staged"]);
    expect(view.picker()).toEqual([]);
    // the focus goes back to the part it opened from
    expect(focused.at(-1)).toContain("compare-part");
  });

  it("reads Branches as compare vs base, a missing base as Choose a base, and marks the refused part", async () => {
    const view = await render({ mode: "branches", compare: "feat/x", base: "" });
    expect(view.partText("compare")).toBe("Compare feat/x");
    expect(view.partText("base")).toBe("Base Choose a base");
    expect(view.part("base").props["aria-invalid"]).toBe(true);
    expect(view.part("compare").props["aria-invalid"]).toBeUndefined();
    await view.rerender({ base: "main", invalid: "compare", errorId: "refusal" });
    expect(view.partText("base")).toBe("Base main");
    expect(view.part("base").props["aria-invalid"]).toBeUndefined();
    expect([view.part("compare").props["aria-invalid"], view.part("compare").props["aria-describedby"]]).toEqual([true, "refusal"]);
  });

  it("lists local branches, then remote ones, the chosen one checked, with worktree, hash, age and subject", async () => {
    const view = await render({ mode: "branches", compare: "feat/x" });
    await view.open("compare");
    expect(view.calls).toEqual(["branches shown"]);
    expect(view.tabs().map((tab) => tab.pressed)).toEqual([false, false, true]);
    expect(view.headings()).toEqual(["Local", "Remote"]);
    expect(view.options().map(({ text, selected }) => [text, selected])).toEqual([
      ["feat/xthis worktree · abcdef1 · 3 hours ago · Fix the parser", true],
      // an older bridge names no commit: the row stays short
      ["otherwt-other", false],
      ["main1234567 · 2 days ago · release: v1", false],
      ["origin/main", false],
    ]);
    // the base's picker has the same list without the tabs, its own name checked
    await view.escape();
    await view.open("base");
    expect(view.options().filter((option) => option.selected).map((option) => option.text)).toEqual(["main1234567 · 2 days ago · release: v1"]);
    expect(view.input().props["aria-label"]).toBe("Base");
  });

  it("filters as typed, moves with the arrows, and Enter takes the active branch or the text as typed", async () => {
    const view = await render({ mode: "branches" });
    await view.open("compare");
    await view.type("othe");
    expect(view.options().map((option) => option.text)).toEqual(["otherwt-other"]);
    await view.key("ArrowDown");
    expect(view.input().props["aria-activedescendant"]).toBe(view.options()[0]!.id);
    await view.key("Enter");
    expect(view.calls.at(-1)).toBe("compare other");
    expect(view.picker()).toEqual([]);
    expect(focused.at(-1)).toContain("compare-part");

    await view.open("base");
    await view.type("v1.0");
    expect(view.options()).toEqual([]);
    await view.key("Enter");
    // nothing typed and nothing active: Enter takes nothing
    await view.open("base");
    await view.key("Enter");
    expect(view.calls.filter((call) => call !== "branches shown")).toEqual(["compare other", "base v1.0"]);
    expect(view.picker().length).toBe(1);
  });

  it("Escape closes only the picker and gives the focus back to its part", async () => {
    const view = await render({ mode: "branches" });
    await view.open("base");
    focused = [];
    await view.escape();
    expect(view.picker()).toEqual([]);
    expect(focused).toEqual([expect.stringContaining("compare-part")]);
    expect(view.calls).toEqual(["branches shown"]);
  });

  it("asks for the branch list as soon as the picker opens on a tip, and says while it loads", async () => {
    const view = await render({ branches: null, listLoading: true });
    expect(view.calls).toEqual([]);
    await view.open("compare");
    expect(view.calls).toEqual(["branches shown"]);
    await view.tab("Branches");
    expect(view.options()).toEqual([]);
    expect(view.picker()[0]!.findAll((node) => node.type === "p").map(text)).toContain("Loading…");
  });
});
