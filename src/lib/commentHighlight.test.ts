import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { notifyRanges, PENDING_COMMENT_ID, registerCommentSurface, showOpenComment, SurfaceMarks, watchSurfaceRanges, type CommentSurface, type OpenComments } from "./commentHighlight.ts";

type Ranges = ReadonlyMap<string, readonly Range[]>;

/** A surface with no DOM: only its ranges matter here, and the open comments it is told of (`opened`). */
function fakeSurface(ranges: Ranges, opened: OpenComments[] = []): CommentSurface {
  return { activate() {}, open: (id) => { opened.push(id); }, ranges: () => ranges };
}

/** A view key: the registries are WeakMaps, any object does. */
const fakeView = (): Element => ({}) as Element;

const someRanges = (): Ranges => new Map([["a", [{} as Range]]]);

describe("watchSurfaceRanges", () => {
  it("reaches a watcher that came before the surface registered, at its registration and its rebuilds", () => {
    const view = fakeView();
    const heard: Ranges[] = [];
    watchSurfaceRanges(view, (ranges) => heard.push(ranges));
    expect(heard).toEqual([]);
    const ranges = someRanges();
    registerCommentSurface(view, fakeSurface(ranges));
    expect(heard).toEqual([ranges]);
    notifyRanges(view);
    expect(heard).toEqual([ranges, ranges]);
  });

  it("hands a later watcher the ranges at once, only when there are some", () => {
    const view = fakeView();
    registerCommentSurface(view, fakeSurface(new Map()));
    const none: Ranges[] = [];
    watchSurfaceRanges(view, (ranges) => none.push(ranges));
    expect(none).toEqual([]);
    const other = fakeView();
    const ranges = someRanges();
    registerCommentSurface(other, fakeSurface(ranges));
    const heard: Ranges[] = [];
    watchSurfaceRanges(other, (next) => heard.push(next));
    expect(heard).toEqual([ranges]);
  });

  it("sends an empty map when the surface unregisters", () => {
    const view = fakeView();
    const unregister = registerCommentSurface(view, fakeSurface(someRanges()));
    const heard: Ranges[] = [];
    watchSurfaceRanges(view, (ranges) => heard.push(ranges));
    unregister();
    expect(heard.length).toBe(2);
    expect(heard[1]!.size).toBe(0);
  });

  it("follows a later registration, and a superseded registration's cleanup stays silent", () => {
    const view = fakeView();
    const first = registerCommentSurface(view, fakeSurface(someRanges()));
    const heard: Ranges[] = [];
    watchSurfaceRanges(view, (ranges) => heard.push(ranges));
    const later = someRanges();
    registerCommentSurface(view, fakeSurface(later));
    expect(heard.at(-1)).toBe(later);
    const count = heard.length;
    first();
    expect(heard.length).toBe(count);
    notifyRanges(view);
    expect(heard.at(-1)).toBe(later);
  });

  it("ends only its own subscription: the same listener given twice is followed twice", () => {
    const view = fakeView();
    registerCommentSurface(view, fakeSurface(someRanges()));
    let calls = 0;
    const listener = (): void => { calls += 1; };
    const stop = watchSurfaceRanges(view, listener);
    watchSurfaceRanges(view, listener);
    calls = 0;
    notifyRanges(view);
    expect(calls).toBe(2);
    stop();
    stop();
    notifyRanges(view);
    expect(calls).toBe(3);
  });
});

describe("showOpenComment", () => {
  it("tells the registered surface which saved comment's popover is open, and that none is", () => {
    const view = fakeView();
    const opened: OpenComments[] = [];
    registerCommentSurface(view, fakeSurface(new Map(), opened));
    expect(opened).toEqual([null]);
    showOpenComment(view, "c1");
    showOpenComment(view, null);
    expect(opened).toEqual([null, "c1", null]);
  });

  it("keeps the open comment for a surface that registers later (its highlights watched anew)", () => {
    const view = fakeView();
    showOpenComment(view, "c1");
    const opened: OpenComments[] = [];
    registerCommentSurface(view, fakeSurface(new Map(), opened));
    expect(opened).toEqual(["c1"]);
    showOpenComment(view, null);
    const again: OpenComments[] = [];
    registerCommentSurface(view, fakeSurface(new Map(), again));
    expect(again).toEqual([null]);
  });

  it("tells it of several open at once (a count's fields)", () => {
    const view = fakeView();
    const opened: OpenComments[] = [];
    registerCommentSurface(view, fakeSurface(new Map(), opened));
    showOpenComment(view, ["c1", "c2"]);
    expect(opened).toEqual([null, ["c1", "c2"]]);
    const later: OpenComments[] = [];
    registerCommentSurface(view, fakeSurface(new Map(), later));
    expect(later).toEqual([["c1", "c2"]]);
  });

  it("reaches only its own view", () => {
    const view = fakeView();
    const other = fakeView();
    const opened: OpenComments[] = [];
    registerCommentSurface(other, fakeSurface(new Map(), opened));
    showOpenComment(view, "c1");
    expect(opened).toEqual([null]);
  });
});

describe("SurfaceMarks", () => {
  // the highlight registry, stood in for: a Highlight is a set of ranges, CSS.highlights holds them by name
  const globals = globalThis as unknown as { CSS?: unknown; Highlight?: unknown };
  let saved: { css: unknown; highlight: unknown };
  let registry: Map<string, Set<Range>>;
  beforeEach(() => {
    saved = { css: globals.CSS, highlight: globals.Highlight };
    registry = new Map();
    globals.CSS = { highlights: registry };
    globals.Highlight = class extends Set<Range> { priority = 0; };
  });
  afterEach(() => {
    globals.CSS = saved.css;
    globals.Highlight = saved.highlight;
  });
  /** the ranges `name` holds */
  const painted = (name: string): Range[] => [...(registry.get(name) ?? [])];

  const markedView = (): Element => ({}) as Element;

  it("lists the comment being written under PENDING_COMMENT_ID only while there is one, and tells the watchers", () => {
    const view = markedView();
    const marks = new SurfaceMarks(view);
    registerCommentSurface(view, marks);
    const heard: Ranges[] = [];
    watchSurfaceRanges(view, (ranges) => heard.push(ranges));
    const saved = [{} as Range];
    const pending = [{} as Range];
    marks.publish(new Map([["a", saved]]), pending);
    expect([...heard.at(-1)!]).toEqual([["a", saved], [PENDING_COMMENT_ID, pending]]);
    marks.publish(new Map([["a", saved]]), null);
    expect([...heard.at(-1)!]).toEqual([["a", saved]]);
    expect(marks.comments.get("a")).toBe(saved);
    expect(marks.pending).toBeNull();
  });

  it("brings up the comments a count names (data-comment-ids), and the several open", () => {
    const marks = new SurfaceMarks(markedView());
    // one comment: without a DOM two cannot be given layers (their ranges are compared)
    const text = [{} as Range];
    marks.publish(new Map([["b", text]]), null);
    // at rest the comment is on its layer; in focus it is in the strong highlight instead
    expect(painted("comment-layer-0")).toEqual(text);
    expect(painted("comment-strong")).toEqual([]);
    const pin = (dataset: Record<string, string>): HTMLElement => ({ isConnected: true, dataset }) as unknown as HTMLElement;
    marks.activate(pin({ commentIds: "x y" }), "pointer", true);
    expect(painted("comment-strong")).toEqual([]);
    marks.activate(pin({ commentIds: "x b" }), "pointer", true);
    expect(painted("comment-strong")).toEqual(text);
    expect(painted("comment-layer-0")).toEqual([]);
    marks.activate(pin({ commentId: "z" }), "pointer", true);
    expect(painted("comment-strong")).toEqual([]);
    marks.open(["z", "b"]);
    expect(painted("comment-strong")).toEqual(text);
    marks.open(null);
    expect(painted("comment-strong")).toEqual([]);
    marks.dispose();
    expect(painted("comment-layer-0")).toEqual([]);
  });
});
