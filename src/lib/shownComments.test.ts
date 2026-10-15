import { describe, expect, it } from "bun:test";
import { markShownComment, openShownComment, registerShownComments, shownCommentIds, type ShownComments } from "./shownComments.ts";

/**
 * An element without a DOM: where it stands in the document (`at`, a path of child indexes from the root) is all
 * `contains` and `compareDocumentPosition` look at, as the registry asks only those.
 */
interface FakeElement { at: readonly number[] }
const FOLLOWING = 4;
const PRECEDING = 2;
const CONTAINED_BY = 16;
const CONTAINS = 8;

function fakeElement(...at: number[]): Element {
  const self: FakeElement & Record<string, unknown> = { at };
  const inside = (outer: readonly number[], inner: readonly number[]): boolean =>
    inner.length >= outer.length && outer.every((step, index) => inner[index] === step);
  self.contains = (other: FakeElement | null): boolean => other !== null && inside(at, other.at);
  self.compareDocumentPosition = (other: FakeElement): number => {
    if (other === self) return 0;
    if (inside(at, other.at)) return CONTAINED_BY | FOLLOWING;
    if (inside(other.at, at)) return CONTAINS | PRECEDING;
    for (let index = 0; ; index++) {
      const mine = at[index]!;
      const theirs = other.at[index]!;
      if (mine !== theirs) return theirs > mine ? FOLLOWING : PRECEDING;
    }
  };
  return self as unknown as Element;
}

/** Comments shown on one element: what the registry was asked of them is kept in `calls`. */
function fakeShown(ids: readonly string[], calls: string[] = [], opens = true): ShownComments {
  return {
    ids: () => ids,
    open: (id) => { calls.push(`open ${id}`); return opens; },
    mark: (id) => { calls.push(`mark ${id}`); },
  };
}

describe("shownCommentIds", () => {
  it("lists the comments of the registrations inside the view, in the document order of their elements, not the order they registered in", () => {
    const view = fakeElement(0);
    const cleanups = [
      registerShownComments(fakeElement(0, 3), fakeShown(["c"])),
      registerShownComments(fakeElement(0, 1), fakeShown(["a", "b"])),
      registerShownComments(fakeElement(0, 2, 0), fakeShown(["x"])),
    ];
    expect(shownCommentIds(view)).toEqual(["a", "b", "x", "c"]);
    for (const cleanup of cleanups) cleanup();
  });

  it("counts the view's own registration, and none outside it", () => {
    const view = fakeElement(1);
    const cleanups = [
      registerShownComments(view, fakeShown(["own"])),
      registerShownComments(fakeElement(2), fakeShown(["elsewhere"])),
    ];
    expect(shownCommentIds(view)).toEqual(["own"]);
    for (const cleanup of cleanups) cleanup();
  });

  it("forgets a registration once its cleanup runs", () => {
    const view = fakeElement(3);
    const cleanup = registerShownComments(fakeElement(3, 0), fakeShown(["a"]));
    cleanup();
    expect(shownCommentIds(view)).toEqual([]);
  });

  it("lets a later registration on the same element take over; the earlier cleanup then leaves it alone", () => {
    const element = fakeElement(4);
    const first = registerShownComments(element, fakeShown(["old"]));
    const second = registerShownComments(element, fakeShown(["new"]));
    expect(shownCommentIds(element)).toEqual(["new"]);
    first();
    expect(shownCommentIds(element)).toEqual(["new"]);
    second();
    expect(shownCommentIds(element)).toEqual([]);
  });

  it("asks the registrations for their comments each time: what they show changes without registering again", () => {
    const view = fakeElement(5);
    let ids: readonly string[] = ["a"];
    const cleanup = registerShownComments(view, { ids: () => ids, open: () => true, mark: () => {} });
    expect(shownCommentIds(view)).toEqual(["a"]);
    ids = ["a", "b"];
    expect(shownCommentIds(view)).toEqual(["a", "b"]);
    cleanup();
  });
});

describe("openShownComment", () => {
  it("opens the comment on the registration that shows it, and answers as it does", () => {
    const view = fakeElement(6);
    const first: string[] = [];
    const second: string[] = [];
    const cleanups = [
      registerShownComments(fakeElement(6, 0), fakeShown(["a"], first)),
      registerShownComments(fakeElement(6, 1), fakeShown(["b"], second, false)),
    ];
    expect(openShownComment(view, "a")).toBe(true);
    expect(openShownComment(view, "b")).toBe(false);
    expect(first).toEqual(["open a"]);
    expect(second).toEqual(["open b"]);
    for (const cleanup of cleanups) cleanup();
  });

  it("is false for a comment no registration in the view shows", () => {
    const view = fakeElement(7);
    const calls: string[] = [];
    const cleanups = [
      registerShownComments(fakeElement(7, 0), fakeShown(["a"], calls)),
      registerShownComments(fakeElement(8), fakeShown(["z"], calls)),
    ];
    expect(openShownComment(view, "z")).toBe(false);
    expect(openShownComment(view, "missing")).toBe(false);
    expect(calls).toEqual([]);
    for (const cleanup of cleanups) cleanup();
  });
});

describe("markShownComment", () => {
  it("marks the comment on the registration that shows it and clears the mark on the others in the view", () => {
    const view = fakeElement(9);
    const first: string[] = [];
    const second: string[] = [];
    const outside: string[] = [];
    const cleanups = [
      registerShownComments(fakeElement(9, 0), fakeShown(["a"], first)),
      registerShownComments(fakeElement(9, 1), fakeShown(["b"], second)),
      registerShownComments(fakeElement(10), fakeShown(["b"], outside)),
    ];
    markShownComment(view, "b");
    expect(first).toEqual(["mark null"]);
    expect(second).toEqual(["mark b"]);
    expect(outside).toEqual([]);
    for (const cleanup of cleanups) cleanup();
  });

  it("clears every mark in the view with null", () => {
    const view = fakeElement(11);
    const calls: string[] = [];
    const cleanup = registerShownComments(view, fakeShown(["a"], calls));
    markShownComment(view, null);
    expect(calls).toEqual(["mark null"]);
    cleanup();
  });
});
