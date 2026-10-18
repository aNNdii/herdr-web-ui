import { describe, expect, it } from "bun:test";

import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";

import { branchAnchor, branchCommentAt, branchQuote, branchTarget, branchTargetOf, isBranchComment, placeBranchComments, placeOf, sortBranchComments, type BranchComment, type BranchTarget } from "./branchComments.ts";
import type { BranchComparison } from "./branchReview.ts";
import { diffSides, type DiffRow } from "./diffSides.ts";
import { fileAnchor, type FileComment } from "./fileComments.ts";

function parsed(patch: string): FileDiffMetadata {
  const file = parsePatchFiles(patch, "branch-comments-test", true)[0]?.files[0];
  if (file === undefined) throw new Error("no file in the patch");
  return file;
}

/** `src/a.ts` with `old()` swapped for `new()` on line 30, and two lines dropped after it */
function patchAt(start: number): string {
  return [
    "diff --git a/src/a.ts b/src/a.ts",
    "index 1111111..2222222 100644",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    `@@ -${start - 2},7 +${start - 2},5 @@ function a() {`,
    " twenty-eight",
    " twenty-nine",
    "-old()",
    "+new()",
    " thirty-one",
    "-gone1",
    "-gone2",
    " thirty-four",
    "",
  ].join("\n");
}

const HEAD = "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d";
const MERGE_BASE = "9f8e7d6c5b4a39281706f5e4d3c2b1a098765432";
const BASE_TIP = "abcdef0123456789abcdef0123456789abcdef01";
const comparison: BranchComparison = {
  head: { name: "feat/x", hash: HEAD, worktree: "/home/dev/wt/feat-x" },
  base: { name: "origin/next", hash: BASE_TIP },
  mergeBase: MERGE_BASE,
};
const file = { path: "/repo/src/a.ts", label: "src/a.ts" };
const sides = diffSides(parsed(patchAt(30)));
const row = (line: number, old = false): DiffRow => ({ line, old });

const stored = (target: BranchTarget, id: string, created = 1): BranchComment => ({ ...target, kind: "branch", id, anchor: branchAnchor(target), created, comment: id });

describe("branchTarget", () => {
  it("keeps the head's line of a drag over -old() and +new(), with the head's version", () => {
    expect(branchTarget(comparison, file, sides, [row(30, true), row(30)])).toEqual({
      ...file, lines: [30, 30], source: ["new()"], place: { side: "head", head: "feat/x", commit: HEAD, worktree: "/home/dev/wt/feat-x" },
    });
  });
  it("puts removed lines on the base side, from the merge base", () => {
    expect(branchTarget(comparison, file, sides, [row(32, true), row(33, true)])).toEqual({
      ...file, lines: [32, 33], source: ["gone1", "gone2"], place: { side: "base", head: "feat/x", base: "origin/next", commit: MERGE_BASE },
    });
  });
  it("is null for rows the patch does not have", () => {
    expect(branchTarget(comparison, file, sides, [])).toBeNull();
    expect(branchTarget(comparison, file, sides, [row(5)])).toBeNull();
  });
});

describe("placeOf", () => {
  it("takes base's tip without a merge base (an older bridge)", () => {
    expect(placeOf({ ...comparison, mergeBase: null }, "base")).toEqual({ side: "base", head: "feat/x", base: "origin/next", commit: BASE_TIP });
  });
});

describe("branchQuote", () => {
  const head = branchTarget(comparison, file, sides, [row(30)])!;
  it("names the head with its short hash and worktree", () => {
    expect(branchQuote(stored(head, "h"))).toBe("> src/a.ts:30 @ feat/x (1a2b3c4) · worktree /home/dev/wt/feat-x\n> new()");
  });
  it("names the base with the merge base, never a worktree", () => {
    const base = branchTarget(comparison, file, sides, [row(30, true)])!;
    expect(branchQuote(stored(base, "b"))).toBe("> src/a.ts:30 @ origin/next (9f8e7d6)\n> old()");
  });
  it("names free text as typed, and a head checked out nowhere without a worktree", () => {
    const typed: BranchComparison = { ...comparison, head: { name: "HEAD~3", hash: HEAD, worktree: null } };
    const target = branchTarget(typed, file, sides, [row(28), row(29)])!;
    expect(branchQuote(stored(target, "t"))).toBe("> src/a.ts:28-29 @ HEAD~3 (1a2b3c4)\n> twenty-eight\n> twenty-nine");
  });
  it("names base's tip when an older bridge compared the tips", () => {
    const tips: BranchComparison = { ...comparison, head: { ...comparison.head, worktree: null }, mergeBase: null };
    expect(branchQuote(stored(branchTarget(tips, file, sides, [row(32, true)])!, "p"))).toBe("> src/a.ts:32 @ origin/next (abcdef0)\n> gone1");
  });
});

describe("placeBranchComments", () => {
  const head = stored(branchTarget(comparison, file, sides, [row(30)])!, "head");
  const base = stored(branchTarget(comparison, file, sides, [row(32, true)])!, "base");
  const fileTarget = { ...file, view: "code" as const, lines: [30, 30] as [number, number], source: ["new()"], quoteLines: ["new()"] };
  const onFile: FileComment = { ...fileTarget, kind: "file", id: "file", anchor: fileAnchor(fileTarget), created: 1, comment: "file" };
  const ids = (list: readonly { comment: BranchComment }[]) => list.map((p) => p.comment.id);

  it("shows a head comment by head name, a base comment only with the same base too, and nothing of another file", () => {
    expect(ids(placeBranchComments([head, base, onFile], comparison, file.path, sides))).toEqual(["head", "base"]);
    const otherBase: BranchComparison = { ...comparison, base: { name: "main", hash: BASE_TIP } };
    expect(ids(placeBranchComments([head, base], otherBase, file.path, sides))).toEqual(["head"]);
    const otherHead: BranchComparison = { ...comparison, head: { ...comparison.head, name: "feat/y" } };
    expect(ids(placeBranchComments([head, base], otherHead, file.path, sides))).toEqual([]);
    expect(ids(placeBranchComments([head, base], comparison, "/repo/src/b.ts", sides))).toEqual([]);
  });

  it("leaves a comment that stayed alone: no move, even in a later commit", () => {
    const later: BranchComparison = { ...comparison, head: { ...comparison.head, hash: "3c4d5e6f".padEnd(40, "0") } };
    expect(placeBranchComments([head, base], later, file.path, sides)).toEqual([
      { comment: head, lines: [30, 30], moved: null },
      { comment: base, lines: [32, 32], moved: null },
    ]);
  });

  it("moves a comment whose lines moved, to the lines and the version shown", () => {
    const later: BranchComparison = { ...comparison, head: { ...comparison.head, hash: "3c4d5e6f".padEnd(40, "0") }, mergeBase: "5e6f".padEnd(40, "1") };
    const shifted = diffSides(parsed(patchAt(40)));
    expect(placeBranchComments([head, base], later, file.path, shifted)).toEqual([
      { comment: head, lines: [40, 40], moved: { lines: [40, 40], place: { side: "head", head: "feat/x", commit: later.head.hash, worktree: "/home/dev/wt/feat-x" } } },
      { comment: base, lines: [42, 42], moved: { lines: [42, 42], place: { side: "base", head: "feat/x", base: "origin/next", commit: later.mergeBase! } } },
    ]);
  });

  it("moves a comment up as well, to lines before the end of the side its old lines lay past", () => {
    // saved on line 40 and 42, then lines above it went: the side now ends at 34
    const high = diffSides(parsed(patchAt(40)));
    const headHigh = stored(branchTarget(comparison, file, high, [row(40)])!, "head");
    const baseHigh = stored(branchTarget(comparison, file, high, [row(42, true)])!, "base");
    expect(placeBranchComments([headHigh, baseHigh], comparison, file.path, sides)).toEqual([
      { comment: headHigh, lines: [30, 30], moved: { lines: [30, 30], place: placeOf(comparison, "head") } },
      { comment: baseHigh, lines: [32, 32], moved: { lines: [32, 32], place: placeOf(comparison, "base") } },
    ]);
  });

  it("is outdated where its text is gone, and is then sent as saved", () => {
    const rewritten = { ...head, source: ["newer()"] };
    expect(placeBranchComments([rewritten], comparison, file.path, sides)).toEqual([{ comment: rewritten, lines: null, moved: null }]);
    expect(branchQuote(rewritten)).toBe("> src/a.ts:30 @ feat/x (1a2b3c4) · worktree /home/dev/wt/feat-x\n> newer()");
  });

  it("never matches a gap the patch does not show, not even with an empty line", () => {
    // line 31 is unchanged, a gap on the base side between removed lines 30 and 32
    const blank = stored({ ...file, lines: [31, 31], source: [""], place: placeOf(comparison, "base") }, "blank");
    expect(placeBranchComments([blank], comparison, file.path, sides)).toEqual([{ comment: blank, lines: null, moved: null }]);
    // the base side holds only removed lines: an unchanged one is a gap there
    const unchanged = stored({ ...file, lines: [28, 28], source: ["twenty-eight"], place: placeOf(comparison, "base") }, "unchanged");
    expect(placeBranchComments([unchanged], comparison, file.path, sides)[0]?.lines).toBeNull();
  });
});

describe("branchAnchor and branchCommentAt", () => {
  const head = branchTarget(comparison, file, sides, [row(30)])!;
  const base = branchTarget(comparison, file, sides, [row(30, true)])!;
  it("names path, side, the names and lines, never the commit", () => {
    expect(branchAnchor(head)).toBe("branch:/repo/src/a.ts:head:feat/x:30-30");
    expect(branchAnchor(base)).toBe("branch:/repo/src/a.ts:base:feat/x:origin/next:30-30");
    expect(branchAnchor({ ...head, place: { ...head.place, commit: "0".repeat(40) } })).toBe(branchAnchor(head));
  });
  it("finds a new comment's place by where a comment is with the same text, an edit by its anchor", () => {
    const comment = stored(head, "c");
    expect(branchCommentAt([comment], head)).toBe(comment);
    expect(branchCommentAt([comment], { ...head, source: ["other()"] })).toBeUndefined();
    expect(branchCommentAt([comment], base)).toBeUndefined();
    expect(branchCommentAt([comment], { ...base, anchor: comment.anchor })).toBe(comment);
    expect(branchTargetOf(comment)).toEqual({ ...head, anchor: comment.anchor });
  });
});

describe("sortBranchComments", () => {
  it("groups by file and head in order of the first comment, then by line, the head side first, then creation", () => {
    const at = (id: string, path: string, line: number, created: number, side: "head" | "base" = "head"): BranchComment =>
      stored({ path, label: path, lines: [line, line], source: ["x"], place: placeOf(comparison, side) }, id, created);
    const sorted = sortBranchComments([at("b2", "/b", 1, 5), at("a9", "/a", 9, 1), at("b1", "/b", 1, 9, "base"), at("a2", "/a", 2, 7)]);
    expect(sorted.map((c) => c.id)).toEqual(["a2", "a9", "b2", "b1"]);
  });
});

describe("isBranchComment", () => {
  const valid = stored(branchTarget(comparison, file, sides, [row(32, true), row(33, true)])!, "v");
  it("accepts a well-formed comment of either side", () => {
    expect(isBranchComment(valid)).toBe(true);
    expect(isBranchComment(stored(branchTarget(comparison, file, sides, [row(30)])!, "h"))).toBe(true);
    expect(isBranchComment(JSON.parse(JSON.stringify(valid)))).toBe(true);
  });
  it("rejects a broken range, source or place, and another kind", () => {
    expect(isBranchComment({ ...valid, lines: [33, 32] })).toBe(false);
    expect(isBranchComment({ ...valid, source: ["gone1"] })).toBe(false);
    expect(isBranchComment({ ...valid, kind: "file" })).toBe(false);
    expect(isBranchComment({ ...valid, place: { side: "base", head: "feat/x", commit: MERGE_BASE } })).toBe(false);
    expect(isBranchComment({ ...valid, place: { side: "head", head: "feat/x", commit: HEAD } })).toBe(false);
    expect(isBranchComment({ ...valid, place: { side: "other", head: "feat/x", base: "next", commit: HEAD } })).toBe(false);
    expect(isBranchComment({ ...valid, place: { ...valid.place, commit: "" } })).toBe(false);
    expect(isBranchComment({ ...valid, created: Number.NaN })).toBe(false);
    expect(isBranchComment(null)).toBe(false);
  });
});
