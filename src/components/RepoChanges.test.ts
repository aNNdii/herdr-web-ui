import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { createElement } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import type { RepoDiffFile, RepoDiffFileList, RepoDiffScope } from "../../shared/protocol.ts";
import type { RepoComparison } from "../lib/repoDiff.ts";
import { SettingsProvider } from "../lib/settings.ts";
import { RepoChanges } from "./RepoChanges.tsx";

const FILE: RepoDiffFile = { path: "src/money.ts", old_path: null, status: "modified", additions: 3, deletions: 2, binary: false };
const listing = (scope: RepoDiffScope): RepoDiffFileList => ({
  repository: { root: "/repo", branch: "main", head: "a".repeat(40), detached: false, unborn: false },
  scope, base: null, head: null, comparison: null, files: [FILE], total: 1, truncated: false, limits: { max_files: 2000, max_list_bytes: 1 << 20 },
});

// React, the settings, the component and its API functions stay real; only the network and the DOM globals are stand-ins
describe("RepoChanges against a bridge", () => {
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  let renderers: ReactTestRenderer[];
  /** the scope of every list asked, in order */
  let asked: string[];
  /** a bridge from before `uncommitted`: it refuses the scope as unknown */
  let older: boolean;
  /** the refusal every list gets instead, when set */
  let refusal: Response | null;
  /** the animation frames asked for and not yet run */
  let frames: Map<number, ReturnType<typeof setTimeout>>;

  beforeEach(() => {
    for (const key of ["window", "document", "navigator", "getComputedStyle", "IS_REACT_ACT_ENVIRONMENT"]) descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    renderers = []; asked = []; older = false; refusal = null; frames = new Map();
    let frameId = 0;
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
    // src/lib/settings.ts reads the stylesheet's --bg when it applies the settings
    Object.defineProperty(globalThis, "getComputedStyle", { configurable: true, value: () => ({ getPropertyValue: () => "#12100e" }) });
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { languages: ["en-US"] } });
    Object.defineProperty(globalThis, "window", { configurable: true, value: {
      localStorage: { getItem: () => null, setItem() {} },
      requestAnimationFrame: (callback: () => void) => {
        const id = ++frameId;
        frames.set(id, globalThis.setTimeout(() => { frames.delete(id); callback(); }, 0));
        return id;
      },
      cancelAnimationFrame: (id: number) => { globalThis.clearTimeout(frames.get(id)); frames.delete(id); },
      addEventListener() {}, removeEventListener() {},
    } });
    Object.defineProperty(globalThis, "document", { configurable: true, value: {
      documentElement: { dataset: {}, style: { setProperty() {}, removeProperty() {} } },
      querySelector: () => null,
    } });
    const answer = async (input: RequestInfo | URL): Promise<Response> => {
      const url = new URL(String(input), "http://bridge.invalid");
      const scope = url.searchParams.get("scope") ?? "";
      asked.push(scope);
      if (refusal !== null) return refusal.clone();
      if (older && scope === "uncommitted") return Response.json({ error: { code: "invalid_scope", message: "scope must be workspace, staged or commit" } }, { status: 400 });
      return Response.json(listing(scope as RepoDiffScope));
    };
    spyOn(globalThis, "fetch").mockImplementation(Object.assign(answer, { preconnect: globalThis.fetch.preconnect }));
  });

  afterEach(async () => {
    await act(async () => { for (const renderer of renderers) renderer.unmount(); });
    (globalThis.fetch as unknown as { mockRestore: () => void }).mockRestore();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    descriptors.clear();
  });

  async function open() {
    const opened: RepoComparison[] = [];
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(createElement(SettingsProvider, null, createElement(RepoChanges, { paneId: "w1:p1", directory: "/repo", onOpenDiff: (comparison) => opened.push(comparison) })));
    });
    if (!renderer) throw new Error("RepoChanges did not mount");
    renderers.push(renderer);
    const root = renderer.root;
    /** Until the list has its answer and the announced note's frame has passed, a turn at a time. */
    const settle = async (): Promise<void> => {
      const busy = () => root.find((node) => node.type === "div" && node.props.className === "repo-changes").props["aria-busy"] === true;
      const deadline = Date.now() + 5_000;
      while (busy() || frames.size > 0) {
        if (Date.now() > deadline) throw new Error("RepoChanges never settled");
        await act(async () => { await new Promise((resolve) => globalThis.setTimeout(resolve, 0)); });
      }
    };
    await settle();
    const text = (node: ReactTestInstance): string => node.children.map((child) => (typeof child === "string" ? child : text(child))).join("");
    const segments = () => root.find((node) => node.type === "div" && node.props["aria-label"] === "Compare").findAllByType("button");
    return {
      opened,
      segments: () => segments().map((button) => ({ name: text(button), pressed: button.props["aria-pressed"] as boolean })),
      choose: async (name: string) => {
        await act(async () => { segments().find((button) => text(button) === name)!.props.onClick(); });
        await settle();
      },
      /** the bridge note under the segments: its words, null while it is empty */
      note: () => { const words = text(root.find((node) => node.type === "p" && node.props.className?.includes("repo-changes-bridge"))); return words === "" ? null : words; },
      listScope: () => root.find((node) => node.type === "ul" && node.props["aria-label"] === "Changed files").props["data-scope"] as string | undefined,
      error: () => root.findAll((node) => node.type === "p" && node.props.role === "alert").map(text),
      openRow: () => act(async () => { root.find((node) => node.type === "button" && node.props.className === "repo-change").props.onClick(); }),
    };
  }

  it("offers Uncommitted, Staged, Commits and Branch, reads Uncommitted first, and says nothing about a current bridge", async () => {
    const view = await open();
    expect(view.segments()).toEqual([{ name: "Uncommitted", pressed: true }, { name: "Staged", pressed: false }, { name: "Commits", pressed: false }, { name: "Branch", pressed: false }]);
    expect(asked).toEqual(["uncommitted"]);
    expect(view.listScope()).toBe("uncommitted");
    expect(view.note()).toBeNull();
    await view.openRow();
    expect(view.opened).toEqual([{ scope: "uncommitted", base: null, head: null, comparison: null }]);
  });

  it("an older bridge's refusal of uncommitted asks the unstaged list instead, says so, and asks it directly from then on", async () => {
    older = true;
    const view = await open();
    expect(asked).toEqual(["uncommitted", "workspace"]);
    expect(view.listScope()).toBe("workspace");
    expect(view.error()).toEqual([]);
    expect(view.note()).toBe("This PC's bridge leaves out staged changes.");
    // the diff opened from it gets the answered stand-in, with no fallback of its own
    await view.openRow();
    expect(view.opened).toEqual([{ scope: "workspace", base: null, head: null, comparison: null }]);

    await view.choose("Staged");
    expect(asked.at(-1)).toBe("staged");
    expect(view.note()).toBeNull();
    await view.choose("Uncommitted");
    expect(asked).toEqual(["uncommitted", "workspace", "staged", "workspace"]);
    expect(view.segments()[0]).toEqual({ name: "Uncommitted", pressed: true });
    expect(view.note()).toBe("This PC's bridge leaves out staged changes.");
  });

  it("any other refusal is shown as it is and never turns to the stand-in", async () => {
    refusal = Response.json({ error: { code: "not_a_repository", message: "not in git" } }, { status: 404 });
    const view = await open();
    expect(asked).toEqual(["uncommitted"]);
    expect(view.error()).toEqual(["This folder is not in a git repository."]);
    expect(view.note()).toBeNull();
  });
});
