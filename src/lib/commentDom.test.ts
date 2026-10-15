import { describe, expect, it } from "bun:test";
import { changedAttrs, changedField, commentRootAttrs, commentRootsIn, focusOpenField, hasChangedComment, hasCommentDialog, revealField } from "./commentDom.ts";
import { setFrameAnchor } from "./frameField.ts";

describe("the attributes the popover renders", () => {
  it("mark a changed popover", () => {
    expect(changedAttrs(true)).toEqual({ "data-comment-changed": "" });
    expect(changedAttrs(false)).toEqual({ "data-comment-changed": undefined });
  });
});

describe("the attributes of a commentable Markdown root", () => {
  it("mark a reply part's root with its turn, and no other root", () => {
    expect(commentRootAttrs("2026-10-04T10:01:05.000Z")).toEqual({ "data-comment-root": "", "data-comment-turn": "2026-10-04T10:01:05.000Z" });
    expect(commentRootAttrs(null)).toEqual({ "data-comment-root": undefined, "data-comment-turn": undefined });
  });
  it("are what the roots are found by", () => {
    const roots = [{ root: 1 }, { root: 2 }];
    const scope = { querySelectorAll: (selector: string) => selector === "[data-comment-root]" ? roots : [] } as unknown as ParentNode;
    expect(commentRootsIn(scope)).toEqual(roots as unknown as Element[]);
  });
});

/** A scope (a pane's stack, a surface) holding `inScope`, in a document holding `portalled`, each found by its selector. */
function scopeWith(inScope: Record<string, object>, portalled: Record<string, object>): Element {
  const ownerDocument = { querySelector: (selector: string) => portalled[selector] ?? null };
  return { ownerDocument, querySelector: (selector: string) => inScope[selector] ?? null } as unknown as Element;
}

describe("changedField", () => {
  const here = { field: "here" };
  const sheet = { field: "sheet" };

  it("finds a changed popover's field in the scope first", () => {
    expect(changedField(scopeWith({ ".comment-popover[data-comment-changed] textarea": here }, { ".modal.comment-popover[data-comment-changed] textarea": sheet }))).toBe(here as unknown as HTMLTextAreaElement);
  });
  it("finds a changed dialog's field portalled to the document's body", () => {
    expect(changedField(scopeWith({}, { ".modal.comment-popover[data-comment-changed] textarea": sheet }))).toBe(sheet as unknown as HTMLTextAreaElement);
  });
  it("is null with nothing changed, or no scope", () => {
    expect(changedField(scopeWith({ ".comment-popover textarea": here }, { ".modal.comment-popover textarea": sheet }))).toBeNull();
    expect(changedField(null)).toBeNull();
  });
});

describe("hasChangedComment and hasCommentDialog", () => {
  const root = (found: Record<string, object>) => ({ querySelector: (selector: string) => found[selector] ?? null }) as unknown as ParentNode;
  it("finds a changed popover or dialog anywhere in the document", () => {
    // a dialog's box is a `.comment-popover` too, so the one selector finds either
    expect(hasChangedComment(root({ ".comment-popover[data-comment-changed] textarea": {} }))).toBe(true);
    expect(hasChangedComment(root({ ".comment-popover textarea": {} }))).toBe(false);
  });
  it("finds a popover drawn as a dialog by its scrim", () => {
    expect(hasCommentDialog(root({ ".comment-popover-scrim": {} }))).toBe(true);
    expect(hasCommentDialog(root({}))).toBe(false);
  });
});

describe("focusOpenField", () => {
  const focusable = (calls: unknown[]) => ({ focus: (options: unknown) => calls.push(options) });

  it("focuses the field in the scope without scrolling, else a dialog's in the document", () => {
    const here: unknown[] = [];
    const sheet: unknown[] = [];
    focusOpenField(scopeWith({ ".comment-popover textarea": focusable(here) }, { ".modal.comment-popover textarea": focusable(sheet) }));
    expect(here).toEqual([{ preventScroll: true }]);
    expect(sheet).toEqual([]);
    focusOpenField(scopeWith({}, { ".modal.comment-popover textarea": focusable(sheet) }));
    expect(sheet).toEqual([{ preventScroll: true }]);
  });
  it("does nothing without one", () => {
    expect(() => focusOpenField(scopeWith({}, {}))).not.toThrow();
    expect(() => focusOpenField(null)).not.toThrow();
  });
});

describe("a field in a frame of its own (the code view's, lib/frameField.ts)", () => {
  const focused: unknown[] = [];
  const textarea = { focus: (options: unknown) => focused.push(options) };
  const frame = { contentDocument: { querySelector: () => textarea } };
  const slot = { slot: true };
  setFrameAnchor(frame as unknown as Element, slot as unknown as Element);
  const field = textarea as unknown as HTMLTextAreaElement;

  it("changedField finds it through its slot, in the scope or in a dialog", () => {
    expect(changedField(scopeWith({ ".comment-popover[data-comment-changed] .comment-field-slot": slot }, {}))).toBe(field);
    expect(changedField(scopeWith({}, { ".modal.comment-popover[data-comment-changed] .comment-field-slot": slot }))).toBe(field);
    expect(changedField(scopeWith({ ".comment-popover .comment-field-slot": slot }, {}))).toBeNull();
  });
  it("focusOpenField focuses it", () => {
    focused.length = 0;
    focusOpenField(scopeWith({ ".comment-popover .comment-field-slot": slot }, {}));
    expect(focused).toEqual([{ preventScroll: true }]);
    focusOpenField(scopeWith({}, { ".modal.comment-popover .comment-field-slot": slot }));
    expect(focused).toEqual([{ preventScroll: true }, { preventScroll: true }]);
  });
  it("hasChangedComment counts its slot", () => {
    const root = (found: Record<string, object>) => ({ querySelector: (selector: string) => found[selector] ?? null }) as unknown as ParentNode;
    expect(hasChangedComment(root({ ".comment-popover[data-comment-changed] .comment-field-slot": slot }))).toBe(true);
    expect(hasChangedComment(root({ ".comment-popover .comment-field-slot": slot }))).toBe(false);
  });
  it("revealField brings the popover of its slot into view", () => {
    const calls: unknown[] = [];
    const popover = { scrollIntoView: (options: unknown) => calls.push(options) };
    const anchored = { closest: (selector: string) => selector === ".comment-popover" ? popover : null };
    const inner = { focus: () => calls.push("focus"), closest: () => null, ownerDocument: { defaultView: { frameElement: frame } } };
    setFrameAnchor(frame as unknown as Element, anchored as unknown as Element);
    revealField(inner as unknown as HTMLTextAreaElement);
    expect(calls).toEqual(["focus", { block: "nearest" }]);
    setFrameAnchor(frame as unknown as Element, slot as unknown as Element);
  });
});

describe("revealField", () => {
  it("focuses the field without scrolling and brings its popover into view", () => {
    const calls: unknown[] = [];
    const popover = { scrollIntoView: (options: unknown) => calls.push(["scroll", options]) };
    const field = { focus: (options: unknown) => calls.push(["focus", options]), closest: (selector: string) => selector === ".comment-popover" ? popover : null };
    revealField(field as unknown as HTMLTextAreaElement);
    expect(calls).toEqual([["focus", { preventScroll: true }], ["scroll", { block: "nearest" }]]);
  });
});
