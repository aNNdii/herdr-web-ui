import type { PaneComment } from "./blockComments.ts";
import type { BranchComparison } from "./branchReview.ts";
import { diffSelection, sideLines, type DiffRow, type DiffSides } from "./diffSides.ts";
import { fileQuote, isLineRange, isStrings, placeFileComment, type LineRange } from "./fileComments.ts";

/**
 * Comments on lines of a branch comparison's diff in the review. This module owns what such a comment is: which
 * version its lines are of (`BranchPlace`), how it is anchored, how it finds its lines again in a later comparison, and
 * how it reads as a quote. Its text comes from the patch, never from the file on disk. Pure, no DOM and no React.
 */

/**
 * The version a comment's lines are of. `head`: the compared branch at `commit`, checked out in `worktree` when it is.
 * `base`: removed lines, from `commit`, the merge base (an older bridge: base's tip); no worktree holds that.
 * `head` and `base` are the names as chosen or typed, what a later comparison finds the comment by.
 */
export type BranchPlace =
  | { side: "head"; head: string; commit: string; worktree: string | null }
  | { side: "base"; head: string; base: string; commit: string };

export interface BranchTarget {
  /** absolute, the file in the review's repository */
  path: string;
  /** how the quote names it, relative to the repository */
  label: string;
  /** on the side `place.side` names, 1-based and inclusive */
  lines: LineRange;
  /** the lines' text in that version, from the patch: what `placeBranchComments` looks for again */
  source: string[];
  place: BranchPlace;
  /** set when the target is a stored comment's, for an edit: a move may have left its anchor on other lines */
  anchor?: string;
}

export interface BranchComment extends BranchTarget {
  kind: "branch";
  id: string;
  anchor: string;
  created: number;
  comment: string;
}

/** Where a stored comment is in the comparison shown: `lines` null when outdated, `moved` set when its lines changed. */
export interface PlacedBranchComment {
  comment: BranchComment;
  lines: LineRange | null;
  /** the lines and the version to rewrite the comment to (`BlockCommentStore.moveBranch`); null: nothing to write */
  moved: { lines: LineRange; place: BranchPlace } | null;
}

/** How many characters of a commit hash a quote shows. */
const SHORT_HASH = 7;

/** The version one side of `comparison` is: the head's tip, or the merge base (an older bridge: base's tip). */
export function placeOf(comparison: BranchComparison, side: "head" | "base"): BranchPlace {
  const { head, base, mergeBase } = comparison;
  return side === "head"
    ? { side: "head", head: head.name, commit: head.hash, worktree: head.worktree }
    : { side: "base", head: head.name, base: base.name, commit: mergeBase ?? base.hash };
}

/**
 * The target for drawn `rows` of `file`'s diff (`diffSelection`): the lines of one side and their text there. Null when
 * the rows hold no line of the patch, or the lines kept hold a gap the patch does not show.
 */
export function branchTarget(comparison: BranchComparison, file: { path: string; label: string }, sides: DiffSides, rows: readonly DiffRow[]): BranchTarget | null {
  const pick = diffSelection(rows, sides);
  if (pick === null) return null;
  const source = sideLines(sides[pick.side], pick.lines);
  if (source === null) return null;
  return { path: file.path, label: file.label, lines: pick.lines, source, place: placeOf(comparison, pick.side) };
}

/** Names the place a comment is on: `branch:<path>:<side>:<head>[:<base>]:<a>-<b>`; the commit is not part of it. */
export function branchAnchor(target: Pick<BranchTarget, "path" | "lines" | "place">): string {
  const { place } = target;
  const names = place.side === "head" ? place.head : `${place.head}:${place.base}`;
  return `branch:${target.path}:${place.side}:${names}:${target.lines[0]}-${target.lines[1]}`;
}

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((line, i) => b[i] === line);
}

/**
 * The comment among `comments` that `target` is written on: for an edit (`target.anchor`), the one stored under that
 * anchor; for a new comment, the one on the target's place with the same text there, as `fileCommentAt` does.
 */
export function branchCommentAt<C extends BranchComment>(comments: readonly C[], target: BranchTarget): C | undefined {
  if (target.anchor !== undefined) return comments.find((c) => c.anchor === target.anchor);
  const place = branchAnchor(target);
  return comments.find((c) => branchAnchor(c) === place && sameStrings(c.source, target.source));
}

/** The target a stored comment was written on, to edit it again. */
export function branchTargetOf(comment: BranchComment): BranchTarget {
  const { path, label, lines, source, place, anchor } = comment;
  return { path, label, lines, source, place, anchor };
}

/**
 * Whether a stored comment belongs in a comparison: the same file and head name, and on the base side the same base
 * name too. The commit is no part of it: a comment follows its branch.
 */
function belongsTo(comment: BranchComment, comparison: BranchComparison, path: string): boolean {
  const { place } = comment;
  if (comment.path !== path || place.head !== comparison.head.name) return false;
  return place.side === "head" || place.base === comparison.base.name;
}

/**
 * The branch comments of `path` in `comparison` (`belongsTo`), each placed on its side by `placeFileComment`: where its
 * lines still read the same, else the one other place they occur, else outdated (`lines` null). A comment whose lines
 * changed is `moved` to them and to the version shown; one that stayed or is outdated keeps what it was saved with.
 */
export function placeBranchComments(comments: readonly PaneComment[], comparison: BranchComparison, path: string, sides: DiffSides): PlacedBranchComment[] {
  const placed: PlacedBranchComment[] = [];
  for (const comment of comments) {
    if (comment.kind !== "branch" || !belongsTo(comment, comparison, path)) continue;
    const { side } = comment.place;
    const text = sides[side].text;
    // the whole side is loaded; its end may lie before lines saved in an older version, which then move up to it.
    // Past the side's end every line is a gap, so nothing there can match.
    const lines = placeFileComment(comment, text, Math.max(text.length, comment.lines[1]));
    const same = lines !== null && lines[0] === comment.lines[0] && lines[1] === comment.lines[1];
    placed.push({ comment, lines, moved: lines === null || same ? null : { lines, place: placeOf(comparison, side) } });
  }
  return placed;
}

/** How a quote names the version: `@ feat/x (1a2b3c4)`, then `· worktree <path>` for a head checked out in one. */
function placeText(place: BranchPlace): string {
  const name = place.side === "head" ? place.head : place.base;
  const worktree = place.side === "head" && place.worktree !== null ? ` · worktree ${place.worktree}` : "";
  return `@ ${name} (${place.commit.slice(0, SHORT_HASH)})${worktree}`;
}

/** The comment as a quote: `> src/a.ts:12-14 @ feat/x (1a2b3c4) · worktree /abs`, then its lines (`fileQuote`). */
export function branchQuote(comment: BranchComment): string {
  return fileQuote({ label: comment.label, lines: comment.lines, quoteLines: comment.source }, placeText(comment.place));
}

/**
 * The order branch comments are sent in: files (one head's) by when their earliest comment was made, within one by
 * first line, the head side first on a tie, then creation.
 */
export function sortBranchComments(comments: readonly BranchComment[]): BranchComment[] {
  const group = (c: BranchComment): string => `${c.path}\0${c.place.head}`;
  const first = new Map<string, number>();
  for (const c of comments) first.set(group(c), Math.min(first.get(group(c)) ?? c.created, c.created));
  const sideRank = (c: BranchComment): number => (c.place.side === "head" ? 0 : 1);
  return [...comments].sort((a, b) => {
    const [ga, gb] = [group(a), group(b)];
    if (ga !== gb) return first.get(ga)! - first.get(gb)! || (ga < gb ? -1 : 1);
    return a.lines[0] - b.lines[0] || sideRank(a) - sideRank(b) || a.created - b.created;
  });
}

const isName = (value: unknown): value is string => typeof value === "string" && value !== "";

function isBranchPlace(value: unknown): value is BranchPlace {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  if (!isName(p.head) || !isName(p.commit)) return false;
  if (p.side === "head") return p.worktree === null || isName(p.worktree);
  return p.side === "base" && isName(p.base);
}

/** Whether a stored value is a branch comment this module can place and quote (storage may hold anything). */
export function isBranchComment(value: unknown): value is BranchComment {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  if (c.kind !== "branch" || !isBranchPlace(c.place)) return false;
  if (typeof c.id !== "string" || typeof c.anchor !== "string" || typeof c.path !== "string" || typeof c.label !== "string" || typeof c.comment !== "string") return false;
  if (typeof c.created !== "number" || !Number.isFinite(c.created)) return false;
  if (!isLineRange(c.lines) || !isStrings(c.source)) return false;
  return c.source.length === c.lines[1] - c.lines[0] + 1;
}
