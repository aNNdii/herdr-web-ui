import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createElement, type ReactElement } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import { SettingsProvider } from "../lib/settings.ts";
import { ReviewOptions, type ReviewOption } from "./ReviewOptions.tsx";

/** A stand-in for a DOM node: it takes the focus, contains only itself, and sits in a fixed box. */
interface FakeNode { name: string; style: Record<string, string>; isConnected: boolean; offsetWidth: number; offsetHeight: number; focus: () => void; contains: (other: unknown) => boolean; getBoundingClientRect: () => { top: number; bottom: number; left: number; right: number } }

// React, the settings and the component stay real; the DOM nodes, the window's listeners and the focus are stand-ins
describe("ReviewOptions", () => {
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  let renderers: ReactTestRenderer[];
  let listeners: Map<string, ((event: unknown) => void)[]>;
  let focused: FakeNode | null;

  beforeEach(() => {
    for (const key of ["window", "document", "navigator", "getComputedStyle", "IS_REACT_ACT_ENVIRONMENT"]) descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    renderers = []; listeners = new Map(); focused = null;
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
    // src/lib/settings.ts reads the stylesheet's --bg when it applies the settings
    Object.defineProperty(globalThis, "getComputedStyle", { configurable: true, value: () => ({ getPropertyValue: () => "#12100e" }) });
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { languages: ["en-US"] } });
    Object.defineProperty(globalThis, "window", { configurable: true, value: {
      innerWidth: 1440, innerHeight: 900,
      localStorage: { getItem: () => null, setItem() {} },
      addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, [...listeners.get(type) ?? [], listener]),
      removeEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, (listeners.get(type) ?? []).filter((one) => one !== listener)),
    } });
    Object.defineProperty(globalThis, "document", { configurable: true, value: {
      documentElement: { dataset: {}, style: { setProperty() {}, removeProperty() {} } },
      querySelector: () => null,
      get activeElement() { return focused; },
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

  /** The nodes handed out, by what they stand for: the button, the menu, and each row by its label's id. */
  const nodes = new Map<string, FakeNode>();
  /** The name of the node that has the focus: "button", "menu" or a row's label id. */
  const focusedName = (): string | undefined => focused?.name;
  const nodeFor = (element: ReactElement): FakeNode => {
    const props = element.props as Record<string, unknown>;
    const name = props["role"] === "menuitemcheckbox" ? String(props["aria-labelledby"]) : props["role"] === "menu" ? "menu" : "button";
    const node: FakeNode = {
      name, style: {}, isConnected: true, offsetWidth: 280, offsetHeight: 160,
      focus: () => { focused = node; },
      contains: (other) => other === node || (name === "menu" && [...nodes.values()].some((one) => one === other && one.name !== "button" && one.name !== "menu")),
      getBoundingClientRect: () => ({ top: 100, bottom: 132, left: 300, right: 332 }),
    };
    nodes.set(name, node);
    return node;
  };

  async function mount(options: ReviewOption[]) {
    nodes.clear();
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(createElement(SettingsProvider, null, createElement(ReviewOptions, { options })), { createNodeMock: nodeFor });
    });
    renderers.push(renderer!);
    const root = renderer!.root;
    const button = (): ReactTestInstance => root.find((node) => node.type === "button" && node.props["aria-label"] === "View options");
    const menu = (): ReactTestInstance | null => root.findAll((node) => node.type === "div" && node.props["role"] === "menu")[0] ?? null;
    const rows = (): ReactTestInstance[] => root.findAll((node) => node.type === "button" && node.props["role"] === "menuitemcheckbox");
    const text = (node: ReactTestInstance): string => node.findAll((one) => typeof one.children[0] === "string").map((one) => one.children.join("")).join("|");
    const update = async (next: ReviewOption[]): Promise<void> => {
      await act(async () => { renderer!.update(createElement(SettingsProvider, null, createElement(ReviewOptions, { options: next }))); });
    };
    const fire = async (type: string, event: Record<string, unknown>): Promise<void> => {
      await act(async () => { for (const listener of listeners.get(type) ?? []) listener({ stopPropagation() {}, preventDefault() {}, ...event }); });
    };
    return { root, button, menu, rows, text, update, fire };
  }

  const option = (id: string, checked: boolean, byDefault: boolean, changes: boolean[] = []): ReviewOption => ({
    id, label: `Show ${id}`, description: `About ${id}`, checked, byDefault, onChange: (on) => changes.push(on),
  });

  it("is absent when no option applies", async () => {
    const { root } = await mount([]);
    expect(root.findAll((node) => node.type === "button")).toHaveLength(0);
  });

  it("is a View options button, with a dot only while an option differs from its default", async () => {
    const view = await mount([option("viewed", true, true), option("ignored", false, false)]);
    expect(view.button().props["aria-haspopup"]).toBe("menu");
    expect(view.button().props["aria-expanded"]).toBe(false);
    expect(view.button().findAll((node) => node.props.className === "review-options-dot")).toHaveLength(0);
    await view.update([option("viewed", false, true), option("ignored", false, false)]);
    expect(view.button().findAll((node) => node.props.className === "review-options-dot")).toHaveLength(1);
  });

  it("opens a menu of checkbox rows, each with its label, its description and a switch, the first focused", async () => {
    const view = await mount([option("viewed", true, true), option("ignored", false, false)]);
    expect(view.menu()).toBeNull();
    await act(async () => { view.button().props.onClick(); });
    expect(view.button().props["aria-expanded"]).toBe(true);
    expect(view.menu()!.props["aria-label"]).toBe("View options");
    expect(view.rows().map((row) => [view.text(row), row.props["aria-checked"]])).toEqual([["Show viewed|About viewed", true], ["Show ignored|About ignored", false]]);
    expect(view.rows().every((row) => row.findAll((node) => node.props.className === "review-option-switch").length === 1)).toBe(true);
    expect(focusedName()).toBe(view.rows()[0]!.props["aria-labelledby"]);
    // placed under the button, right edges lined up
    expect(nodes.get("menu")!.style).toMatchObject({ top: "136px", left: "52px" });
  });

  it("toggles a row and stays open", async () => {
    const changes: boolean[] = [];
    const view = await mount([option("viewed", true, true, changes), option("ignored", false, false, changes)]);
    await act(async () => { view.button().props.onClick(); });
    await act(async () => { view.rows()[1]!.props.onClick(); });
    await act(async () => { view.rows()[0]!.props.onClick(); });
    expect(changes).toEqual([true, false]);
    expect(view.menu()).not.toBeNull();
  });

  it("moves between rows with the arrows, round at the ends", async () => {
    const view = await mount([option("a", true, true), option("b", true, true), option("c", true, true)]);
    await act(async () => { view.button().props.onClick(); });
    const ids = view.rows().map((row) => row.props["aria-labelledby"]);
    const key = async (name: string): Promise<void> => { await act(async () => { view.menu()!.props.onKeyDown({ key: name, preventDefault() {} }); }); };
    await key("ArrowDown");
    expect(focusedName()).toBe(ids[1]);
    await key("ArrowUp");
    await key("ArrowUp");
    expect(focusedName()).toBe(ids[2]);
    await key("Home");
    expect(focusedName()).toBe(ids[0]);
    await key("End");
    expect(focusedName()).toBe(ids[2]);
  });

  it("closes on Escape, the focus back on the button, and the Escape goes no further", async () => {
    const view = await mount([option("viewed", true, true)]);
    await act(async () => { view.button().props.onClick(); });
    let stopped = false;
    await view.fire("keydown", { key: "Escape", stopPropagation: () => { stopped = true; } });
    expect(view.menu()).toBeNull();
    expect(stopped).toBe(true);
    expect(focusedName()).toBe("button");
  });

  it("closes on a press outside, not on one inside it or on its button", async () => {
    const view = await mount([option("viewed", true, true)]);
    await act(async () => { view.button().props.onClick(); });
    await view.fire("pointerdown", { target: nodes.get(String(view.rows()[0]!.props["aria-labelledby"])) });
    await view.fire("pointerdown", { target: nodes.get("button") });
    expect(view.menu()).not.toBeNull();
    await view.fire("pointerdown", { target: { elsewhere: true } });
    expect(view.menu()).toBeNull();
    expect(focusedName()).toBe("button");
  });

  it("drops a row that no longer applies, and closes once none is left", async () => {
    const view = await mount([option("uncommitted", true, true), option("viewed", true, true)]);
    await act(async () => { view.button().props.onClick(); });
    focused = null;
    await view.update([option("viewed", true, true)]);
    expect(view.rows().map((row) => view.text(row))).toEqual(["Show viewed|About viewed"]);
    expect(focusedName()).toBe(view.rows()[0]!.props["aria-labelledby"]);
    await view.update([]);
    await view.update([option("viewed", true, true)]);
    expect(view.menu()).toBeNull();
  });
});
