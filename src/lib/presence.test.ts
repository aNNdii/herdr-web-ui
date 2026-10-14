import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { watchWindowPresence } from "./presence.ts";

/** A page window and document with one same-origin frame, enough for `watchWindowPresence` (no DOM in bun:test). */
function fakePage() {
  const page = new EventTarget();
  const frameView = new EventTarget();
  const frame = { localName: "iframe", contentDocument: {}, contentWindow: frameView };
  const body = { localName: "body" };
  const state = { focused: true, active: body as object };
  const doc = Object.defineProperties(new EventTarget(), {
    hasFocus: { value: () => state.focused },
    activeElement: { get: () => state.active },
  });
  return { page, frameView, frame, body, state, doc };
}

/** one turn of the timer queue: the deferred blur check (`watchWindowPresence`, a 0 ms timer set before it) has run */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("watchWindowPresence", () => {
  let fake: ReturnType<typeof fakePage>;
  let calls: string[];
  let stop: () => void;
  const saved = { window: globalThis.window, document: globalThis.document };

  beforeEach(() => {
    fake = fakePage();
    Object.assign(globalThis, { window: fake.page, document: fake.doc });
    calls = [];
    stop = watchWindowPresence(() => calls.push("left"), () => calls.push("back"));
  });
  afterEach(() => {
    stop();
    Object.assign(globalThis, saved);
  });

  /** the focus goes from the page into its frame: the page's window blurs, the document keeps the focus */
  const intoFrame = async (): Promise<void> => {
    fake.state.active = fake.frame;
    fake.page.dispatchEvent(new Event("blur"));
    await tick();
  };

  test("the focus entering the page's own frame is not leaving", async () => {
    await intoFrame();
    expect(calls).toEqual([]);
  });

  test("leaving the app from inside the frame is heard on the frame's window, and so is coming back", async () => {
    await intoFrame();
    fake.state.focused = false;
    fake.frameView.dispatchEvent(new Event("blur"));
    await tick();
    expect(calls).toEqual(["left"]);
    fake.state.focused = true;
    fake.frameView.dispatchEvent(new Event("focus"));
    expect(calls).toEqual(["left", "back"]);
  });

  test("the focus moving from the frame back to the page is not a return", async () => {
    await intoFrame();
    fake.state.active = fake.body;
    fake.page.dispatchEvent(new Event("focus"));
    expect(calls).toEqual([]);
    // the frame is no longer followed
    fake.state.focused = false;
    fake.frameView.dispatchEvent(new Event("blur"));
    await tick();
    expect(calls).toEqual([]);
  });

  test("left from the frame and back into the page is a return", async () => {
    await intoFrame();
    fake.state.focused = false;
    fake.frameView.dispatchEvent(new Event("blur"));
    await tick();
    fake.state.focused = true;
    fake.state.active = fake.body;
    fake.page.dispatchEvent(new Event("focus"));
    expect(calls).toEqual(["left", "back"]);
  });

  test("a plain window blur and focus are leaving and coming back", async () => {
    fake.state.focused = false;
    fake.page.dispatchEvent(new Event("blur"));
    await tick();
    fake.state.focused = true;
    fake.page.dispatchEvent(new Event("focus"));
    expect(calls).toEqual(["left", "back"]);
  });

  test("a removed frame is no longer followed", async () => {
    await intoFrame();
    fake.frameView.dispatchEvent(new Event("pagehide"));
    fake.frameView.dispatchEvent(new Event("focus"));
    expect(calls).toEqual([]);
  });
});
