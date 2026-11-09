import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { commentsPanel } from "./commentsPanel.ts";
import { useCommentsPanelDock, type CommentsPanelDock, type CommentsPanelDockParams } from "./commentsPanelDock.ts";

type Place = Omit<CommentsPanelDockParams, "revealFiles">;

function Probe({ place, revealed, seen }: { place: Place; revealed: { count: number }; seen: { current: CommentsPanelDock | null } }) {
  seen.current = useCommentsPanelDock({ ...place, revealFiles: () => { revealed.count += 1; } });
  return null;
}

describe("the docked comments panel and the other panels beside the pane", () => {
  const empty: Place = { available: true, file: null, webPage: null, filesOpen: false, filesDocked: true, filesCovered: false };
  let renderer: ReactTestRenderer | undefined;
  let restoreAct: PropertyDescriptor | undefined;
  const revealed = { count: 0 };
  const seen: { current: CommentsPanelDock | null } = { current: null };

  beforeEach(() => {
    restoreAct = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
    revealed.count = 0;
    commentsPanel.close();
  });

  afterEach(async () => {
    await act(async () => { renderer?.unmount(); });
    renderer = undefined;
    commentsPanel.close();
    if (restoreAct) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", restoreAct);
    else Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  });

  async function show(place: Place): Promise<void> {
    await act(async () => {
      const element = createElement(Probe, { place, revealed, seen });
      if (renderer === undefined) renderer = create(element);
      else renderer.update(element);
    });
  }
  const openPanel = async (): Promise<void> => { await act(async () => { commentsPanel.open("local\nw1:p1", null); }); };

  it("covers a docked file, Files and a web page already there, and gives the place back as it closes", async () => {
    const there = { ...empty, file: "local\nw1:p1\nREADME.md", filesOpen: true, filesCovered: true };
    await show(there);
    expect(seen.current).toMatchObject({ docked: false, filesCovered: true });
    await openPanel();
    expect(seen.current).toMatchObject({ docked: true, filesCovered: true });
    expect(commentsPanel.current()).not.toBeNull();
    await act(async () => { commentsPanel.close(); });
    expect(seen.current).toMatchObject({ docked: false, filesCovered: true });

    await show({ ...empty, filesOpen: true });
    expect(seen.current?.filesCovered).toBe(false);
    await openPanel();
    // Files beside the pane stays mounted under the panel, hidden
    expect(seen.current).toMatchObject({ docked: true, filesCovered: true });
  });

  it("closes as a docked file, a web page or Files beside the pane opens after it", async () => {
    await show(empty);
    await openPanel();
    await show({ ...empty, file: "local\nw1:p1\nREADME.md" });
    expect(commentsPanel.current()).toBeNull();

    await openPanel();
    // the same file still docked under it is no new one
    await show({ ...empty, file: "local\nw1:p1\nREADME.md" });
    expect(commentsPanel.current()).not.toBeNull();
    await show({ ...empty, file: "local\nw1:p1\nREADME.md", webPage: "http://127.0.0.1:5173/" });
    expect(commentsPanel.current()).toBeNull();

    await openPanel();
    await show({ ...empty, filesOpen: true });
    expect(commentsPanel.current()).toBeNull();
  });

  it("closes as Files is asked for again beside the pane, but not for Files as a dialog", async () => {
    await show({ ...empty, filesOpen: true });
    await openPanel();
    await act(async () => { seen.current?.revealFiles(); });
    expect(revealed.count).toBe(1);
    expect(commentsPanel.current()).toBeNull();

    await show({ ...empty, filesDocked: false });
    await openPanel();
    await act(async () => { seen.current?.revealFiles(); });
    expect(revealed.count).toBe(2);
    expect(commentsPanel.current()).not.toBeNull();
  });

  it("leaves everything alone where no file panel docks: the panel is a dialog there", async () => {
    const narrow = { ...empty, available: false, filesDocked: false };
    await show(narrow);
    await openPanel();
    expect(seen.current).toMatchObject({ docked: false, filesCovered: false });
    await show({ ...narrow, webPage: "http://127.0.0.1:5173/" });
    expect(commentsPanel.current()).not.toBeNull();
  });
});
