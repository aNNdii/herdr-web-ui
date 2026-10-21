import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SettingsProvider } from "../lib/settings.ts";
import { ReviewDialog } from "./ReviewDialog.tsx";
import { cursorClass, drawnLineCount, keyCommentable, openField, pressFile, ReviewFile, sameSelection, savedCommentAt, shownBody, type FilePress } from "./ReviewFile.tsx";
import { cursorBar } from "./useLineCursor.ts";
import type { DiffRow } from "../lib/diffSides.ts";
import type { ReviewKey } from "../lib/reviewKeys.ts";

const decode = (text: string): string => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

/** The buttons of the group labelled `label`: their text and whether each is pressed. */
function segments(html: string, label: string): { text: string; pressed: boolean }[] {
  const group = new RegExp(`<div class="segmented review-scope" role="group" aria-label="${label}">(.*?)</div>`).exec(html);
  expect(group, `a group named ${label}`).not.toBeNull();
  return [...group![1]!.matchAll(/<button type="button" aria-pressed="(true|false)"[^>]*>(.*?)<\/button>/g)]
    .map((button) => ({ text: decode(button[2]!.replace(/<[^>]*>/g, "")), pressed: button[1] === "true" }));
}

// The dialog's first render, before any effect: what a review shows as it opens, in English
describe("ReviewDialog as it opens", () => {
  const saved = new Map<string, PropertyDescriptor | undefined>();
  beforeEach(() => {
    for (const key of ["window", "navigator"]) saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { languages: ["en-US"] } });
    Object.defineProperty(globalThis, "window", { configurable: true, value: {
      matchMedia: () => ({ matches: false }),
      localStorage: { getItem: () => null, setItem() {} },
    } });
  });
  afterEach(() => {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });

  const render = (): string => renderToStaticMarkup(createElement(SettingsProvider, {
    children: createElement(ReviewDialog, { paneId: "w1:p1", directory: "/repo", onClose: () => {} }),
  }));

  test("the line under the title compares the uncommitted changes, its picker closed, and the tree column has no Compare fields", () => {
    const html = render();
    const part = /<div class="review-meta"><div class="compare-line">(<button[^>]*>)(.*?)<\/button><\/div><\/div>/.exec(html);
    expect(part, "the comparison's part under the title").not.toBeNull();
    expect(decode(part![2]!.replace(/<[^>]*>/g, ""))).toBe("Uncommitted changes");
    expect(part![1]).toContain("aria-haspopup=\"dialog\"");
    expect(part![1]).toContain("aria-expanded=\"false\"");
    expect(html).not.toContain("role=\"combobox\"");
    expect(html).not.toContain("aria-label=\"Compare\"");
  });

  test("the Changed files list is shown first, and no switch before Branches opens", () => {
    const html = render();
    expect(segments(html, "Files shown").map((button) => button.pressed)).toEqual([false, true]);
    expect(html).not.toContain("role=\"switch\"");
  });

  test("the note under the comparison is in the document from the first render, empty and clipped", () => {
    expect(render()).toContain("<p class=\"visually-hidden review-compare-note\" role=\"status\"></p>");
  });

  test("the line that tells what a review key did is in the document from the first render, empty and clipped", () => {
    expect(render()).toContain("<p class=\"visually-hidden\" role=\"status\"></p>");
  });

  test("a changed file's Viewed button names its key in its tooltip while the keys are on, and the refusal's status line is there before any refusal", () => {
    const file = (viewed: boolean, keysOn = true): string => renderToStaticMarkup(createElement(SettingsProvider, {
      children: createElement(ReviewFile, {
        paneId: "w1:p1", directory: "/repo", root: "/repo", path: "src/a.ts", diffMode: true, comparison: null, viewed, keysOn,
        change: { path: "src/a.ts", status: "modified", stamp: "1" } as never,
        markdownView: "source", onMarkdownView: () => {}, onClose: () => {}, onOpen: () => {},
      } as never),
    }));
    const button = (html: string): string => /<button[^>]*class="icon-button repo-diff-action review-viewed"[^>]*>/.exec(html)?.[0] ?? "";
    expect(button(file(false))).toContain("title=\"Mark as viewed (V)\"");
    expect(button(file(true))).toContain("title=\"Viewed (V)\"");
    expect(button(file(false))).toContain("aria-keyshortcuts=\"v\"");
    // with the review keys off it names no key it would not take
    expect(button(file(false, false))).toContain("title=\"Mark as viewed\"");
    expect(button(file(true, false))).toContain("title=\"Viewed\"");
    expect(button(file(false, false))).not.toContain("aria-keyshortcuts");
    expect(file(false)).toContain("<p class=\"visually-hidden\" role=\"status\"></p>");
  });

  test("View options is there from the first render, without the dot a choice away from its default draws (Keyboard shortcuts on)", () => {
    const button = /<button[^>]*class="icon-button repo-diff-action review-options"[^>]*>(.*?)<\/button>/.exec(render());
    expect(button, "the View options button").not.toBeNull();
    expect(button![1]).not.toContain("review-options-dot");
  });

  test("opens without storage (private mode), Files shown at its default (the stored views' defaults: review.test.ts)", () => {
    const denied = (): never => { throw new Error("denied"); };
    Object.defineProperty(globalThis, "window", { configurable: true, value: {
      matchMedia: () => ({ matches: false }),
      localStorage: { getItem: denied, setItem: denied, removeItem: denied },
    } });
    expect(segments(render(), "Files shown").map((button) => button.pressed)).toEqual([false, true]);
  });
});

// The one decision of what the file's place shows: a Markdown file's view as its list keeps it, a jump to a line its source
describe("the body a reviewed file shows", () => {
  const text = "# Title\n\nSome text.\n";
  const ready = { status: "ready" as const, text };
  const markdown = { isMarkdown: true, line: undefined, source: ready, showDiff: false, patch: { status: "pending" as const }, diffFile: null, lines: text.split("\n") };

  test("a Markdown file in its list's Source view shows its lines, in Preview its preview", () => {
    expect(shownBody({ ...markdown, markdownView: "source" }).kind).toBe("lines");
    expect(shownBody({ ...markdown, markdownView: "preview" }).kind).toBe("preview");
  });

  test("a jump to a line shows the source, whatever the list keeps", () => {
    expect(shownBody({ ...markdown, markdownView: "preview", line: 2 }).kind).toBe("lines");
  });

  test("a Markdown file in Source view of Changed files shows its diff", () => {
    expect(shownBody({ ...markdown, markdownView: "source", showDiff: true, patch: { status: "pending" } })).toEqual({ kind: "note", note: { of: "loading" } });
  });

  test("a preview needs the file's text: without it the diff or its note shows", () => {
    expect(shownBody({ ...markdown, markdownView: "preview", source: { status: "pending" }, lines: null })).toEqual({ kind: "note", note: { of: "loading" } });
    expect(shownBody({ ...markdown, markdownView: "preview", source: { status: "none", note: "gone" }, lines: null })).toEqual({ kind: "note", note: { of: "said", text: "gone" } });
  });

  test("another file ignores the Markdown view", () => {
    expect(shownBody({ ...markdown, isMarkdown: false, markdownView: "preview" }).kind).toBe("lines");
  });

  test("a whole file's cursor runs over the lines the library draws: a last newline starts no line", () => {
    expect(drawnLineCount("a\nb\n")).toBe(2);
    expect(drawnLineCount("a\nb")).toBe(2);
    expect(drawnLineCount("\n")).toBe(1);
    expect(drawnLineCount("a\n\n")).toBe(2);
    expect(drawnLineCount("")).toBe(0);
  });

  test("the cursor's bar is drawn only for its lines, in a split view on its own side: a removed line's left, any other's right", () => {
    expect(cursorClass(null)).toBe("");
    expect(cursorClass({ start: 3, side: "deletions", end: 3, endSide: "deletions" })).toBe("review-cursor review-cursor-old");
    expect(cursorClass({ start: 3, side: "deletions", end: 5, endSide: "additions" })).toBe("review-cursor review-cursor-new");
    expect(cursorClass({ start: 3, end: 5 })).toBe("review-cursor review-cursor-new");
  });

  test("media is the file viewer's even in a diff; a large text only outside the diff", () => {
    const media = { status: "viewer" as const, media: true, size: 10 };
    const large = { status: "viewer" as const, media: false, size: 10 };
    expect(shownBody({ ...markdown, isMarkdown: false, markdownView: "source", source: media, lines: null, showDiff: true }).kind).toBe("viewer");
    expect(shownBody({ ...markdown, isMarkdown: false, markdownView: "source", source: large, lines: null }).kind).toBe("viewer");
    expect(shownBody({ ...markdown, isMarkdown: false, markdownView: "source", source: large, lines: null, showDiff: true }).kind).toBe("note");
  });
});

// Who takes a comment by key: the mouse's rule (the data there, and in a diff a comparison that takes comments), with
// Settings' comments on; not the preview, which has no line cursor
describe("a comment by key", () => {
  const on = { comments: true, canComment: true, commentsOnDiff: true };

  test("a diff takes one where its comparison takes comments: the staged changes' does not", () => {
    expect(keyCommentable({ ...on, shown: "diff" })).toBe(true);
    expect(keyCommentable({ ...on, shown: "diff", commentsOnDiff: false })).toBe(false);
  });

  test("a whole file takes one as the mouse's does, under a staged comparison and in a plain folder too", () => {
    expect(keyCommentable({ ...on, shown: "lines", commentsOnDiff: false })).toBe(true);
    expect(keyCommentable({ ...on, shown: "virtual", commentsOnDiff: false })).toBe(true);
  });

  test("none with Settings' comments off, without the file's data, or in the preview", () => {
    expect(keyCommentable({ ...on, shown: "lines", comments: false })).toBe(false);
    expect(keyCommentable({ ...on, shown: "diff", canComment: false })).toBe(false);
    expect(keyCommentable({ ...on, shown: "preview" })).toBe(false);
  });
});

// The file's answer to a review key: the cursor's keys, and c/Enter, which shows the cursor first and opens the field after
describe("the comment field the line cursor sees", () => {
  const rows: DiffRow[] = [{ line: 3, old: false }, { line: 4, old: false }];

  test("a new comment is on the rows it was opened on, a key's or the mouse's", () => {
    expect(openField({ rows, byKey: true }, null, false)).toEqual({ rows, byKey: true });
    expect(openField({ rows, byKey: false }, { lines: [9, 9], side: "additions" }, true)).toEqual({ rows, byKey: false });
  });

  test("a saved comment edited is a field too, on its lines and side: as it closes, the cursor's range goes", () => {
    expect(openField(null, { lines: [3, 5], side: "deletions" }, true)).toEqual({ rows: [{ line: 3, old: true }, { line: 5, old: true }], byKey: true });
    expect(openField(null, { lines: [7, 7], side: "additions" }, false)?.byKey).toBe(false);
    expect(openField(null, null, true)).toBeNull();
  });

  test("the cursor's bar is drawn for the cursor and a field a key opened, not for a drag or a field the mouse opened", () => {
    const range = { start: 3, side: "additions" as const, end: 4, endSide: "additions" as const };
    expect(cursorBar(range, null, null)).toBe(true);
    expect(cursorBar(range, null, { rows, byKey: true })).toBe(true);
    expect(cursorBar(range, null, { rows, byKey: false })).toBe(false);
    expect(cursorBar(range, range, null)).toBe(false);
    expect(cursorBar(null, null, null)).toBe(false);
  });
});

describe("a text selection read again", () => {
  const root = {}, start = {}, end = {};
  const ends = (startOffset: number, endOffset: number) => ({ startContainer: start as Node, startOffset, endContainer: end as Node, endOffset });
  const offered = { root, ranges: [ends(2, 5)] };

  test("is the one offered while its root and ends stay: a key's keyup must not make the cursor follow it back", () => {
    expect(sameSelection(offered, root, ends(2, 5))).toBe(true);
  });

  test("is a new one once an end moves, in another root, or with none offered", () => {
    expect(sameSelection(offered, root, ends(2, 6))).toBe(false);
    expect(sameSelection(offered, {}, ends(2, 5))).toBe(false);
    expect(sameSelection(offered, root, { ...ends(2, 5), endContainer: {} as Node })).toBe(false);
    expect(sameSelection(null, root, ends(2, 5))).toBe(false);
  });
});

describe("a comment key on a line that has a comment", () => {
  const note = (id: string, lines: [number, number], side: "additions" | "deletions", created: number) => ({ id, lines, side, comment: { created } });
  const notes = [note("a", [3, 5], "additions", 1), note("b", [5, 5], "additions", 2), note("c", [5, 5], "deletions", 3), note("d", [8, 8], "additions", 4)];
  const row = (line: number, old = false): DiffRow => ({ line, old });

  test("one line opens the newest comment whose card is under it, on its side", () => {
    expect(savedCommentAt(notes, [row(5)])?.id).toBe("b");
    expect(savedCommentAt(notes, [row(5, true)])?.id).toBe("c");
    expect(savedCommentAt(notes, [row(8)])?.id).toBe("d");
  });

  test("a line no comment ends on, a line inside one, or the other side starts a new comment", () => {
    expect(savedCommentAt(notes, [row(4)])).toBeNull();
    expect(savedCommentAt(notes, [row(3)])).toBeNull();
    expect(savedCommentAt(notes, [row(8, true)])).toBeNull();
  });

  test("a range opens a comment on exactly its lines, else a new one", () => {
    expect(savedCommentAt(notes, [row(3), row(4), row(5)])?.id).toBe("a");
    expect(savedCommentAt(notes, [row(4), row(5)])).toBeNull();
    expect(savedCommentAt(notes, [row(5, true), row(5)])).toBeNull();
    expect(savedCommentAt(notes, [])).toBeNull();
  });
});

describe("a review key on the file", () => {
  const rows: DiffRow[] = [{ line: 3, old: false }, { line: 4, old: false }];
  /** A file with a shown cursor in view, a range on it, and every call it got. */
  const file = (over: Partial<Omit<FilePress, "cursor">> & { landed?: boolean; cleared?: boolean; moved?: boolean; at?: DiffRow[] } = {}) => {
    const calls: string[] = [];
    const opened: DiffRow[][] = [];
    const press: FilePress = {
      writing: over.writing ?? false,
      tracked: over.tracked ?? true,
      commentsByKey: over.commentsByKey ?? true,
      cursor: {
        clear: () => { calls.push("clear"); return over.cleared ?? true; },
        land: () => { calls.push("land"); return over.landed ?? false; },
        move: (key) => { calls.push(key); return over.moved ?? true; },
        rows: () => over.at ?? rows,
      },
      open: (at) => { opened.push(at); },
      scroll: over.scroll ?? ((direction, by) => { calls.push(`${by} ${direction}`); return true; }),
    };
    return { press, calls, opened };
  };

  test("c and Enter without a shown cursor in view only land it, and open nothing", () => {
    const one = file({ landed: true });
    expect(pressFile("comment", one.press)).toBe("taken");
    expect(one.opened).toEqual([]);
  });

  test("with the cursor shown in view, c and Enter open the field on its rows", () => {
    const one = file();
    expect(pressFile("comment", one.press)).toBe("taken");
    expect(one.calls).toEqual(["land"]);
    expect(one.opened).toEqual([rows]);
  });

  test("where no comment goes, or no cursor runs, the key is passed and nothing opens", () => {
    for (const over of [{ commentsByKey: false }, { tracked: false }, { at: [] }]) {
      const one = file(over);
      expect(pressFile("comment", one.press)).toBe("passed");
      expect(one.opened).toEqual([]);
    }
  });

  test("while a comment is open no key acts: Escape is the field's", () => {
    const keys: ReviewKey[] = ["comment", "down", "extend-up", "next", "viewed"];
    for (const key of keys) expect(pressFile(key, file({ writing: true }).press)).toBe("blocked");
    const one = file({ writing: true });
    expect(pressFile("clear", one.press)).toBe("passed");
    expect(one.calls).toEqual([]);
  });

  test("Escape takes a range away, else the dialog closes; the file's and Viewed keys are the dialog's", () => {
    expect(pressFile("clear", file().press)).toBe("taken");
    expect(pressFile("clear", file({ cleared: false }).press)).toBe("passed");
    for (const key of ["next", "previous", "viewed"] as const) expect(pressFile(key, file().press)).toBe("passed");
  });

  test("Space and the page keys page the file's body, in the preview too; without one they are passed", () => {
    const one = file({ tracked: false });
    expect(pressFile("page-down", one.press)).toBe("taken");
    expect(pressFile("page-up", one.press)).toBe("taken");
    expect(one.calls).toEqual(["page 1", "page -1"]);
    expect(pressFile("page-down", file({ scroll: () => false }).press)).toBe("passed");
    expect(pressFile("page-down", file({ writing: true }).press)).toBe("blocked");
  });

  test("the cursor's keys move it where it runs; elsewhere (the preview) they scroll its body a line", () => {
    const one = file();
    expect(pressFile("extend-down", one.press)).toBe("taken");
    expect(one.calls).toEqual(["extend-down"]);
    expect(pressFile("down", file({ moved: false }).press)).toBe("passed");
    const preview = file({ tracked: false });
    expect(pressFile("down", preview.press)).toBe("taken");
    expect(pressFile("up", preview.press)).toBe("taken");
    expect(pressFile("extend-down", preview.press)).toBe("passed");
    expect(preview.calls).toEqual(["line 1", "line -1"]);
    expect(pressFile("down", file({ tracked: false, scroll: () => false }).press)).toBe("passed");
  });

  test("with the review keys off an arrow scrolls a line, where the cursor runs too, and leaves the cursor alone", () => {
    const one = file();
    expect(pressFile("line-down", one.press)).toBe("taken");
    expect(pressFile("line-up", one.press)).toBe("taken");
    expect(one.calls).toEqual(["line 1", "line -1"]);
  });
});
