import type { FileDiffMetadata } from "@pierre/diffs";

import type { LineRange } from "./fileComments.ts";
import type { LineTrack } from "./lineCursor.ts";

/**
 * The two sides of a parsed patch, as a comment on a branch diff needs them: which line of which version a drawn row is,
 * and that line's text in that version. Read from the `FileDiffMetadata` `@pierre/diffs` already parsed, so there is no
 * second patch parser. Pure, no DOM and no React.
 */

/**
 * A drawn row of the diff: its line number (`data-line`) and whether it is in the old file's numbering, a removed line
 * or any row of a split view's left column (an unchanged line there carries its old number too).
 */
export interface DiffRow { line: number; old: boolean }

/**
 * One version's lines the patch shows, by line number (index n-1): their text without the line end, and the index of
 * the hunk each is in. Lines the patch does not show (between hunks, outside them) are gaps, `undefined`.
 */
export interface DiffSide { text: readonly (string | undefined)[]; hunk: readonly (number | undefined)[] }

/**
 * `head`: the new version's lines, unchanged and added. `base`: the removed lines only, by the old version's numbers;
 * an unchanged line always belongs to the head. `unchanged`: each unchanged line's old number to its new one.
 */
export interface DiffSides { head: DiffSide; base: DiffSide; unchanged: ReadonlyMap<number, number> }

/** The lines a selection comments on, and the version they are in. */
export interface DiffPick { side: "head" | "base"; lines: LineRange }

function withoutLineEnd(line: string): string {
  return line.replace(/\r?\n$|\r$/, "");
}

/** One line of a hunk as the patch draws it: an unchanged line has both numbers, a removed one the old, an added one the new. */
type HunkLine =
  | { kind: "context"; oldLine: number; newLine: number; text: string | undefined; hunk: number }
  | { kind: "removed"; oldLine: number; text: string | undefined; hunk: number }
  | { kind: "added"; newLine: number; text: string | undefined; hunk: number };

/** Every line of every hunk in unified order: each change's removed lines before its added ones. Gaps between hunks are not visited. */
function eachHunkLine(file: FileDiffMetadata, visit: (line: HunkLine) => void): void {
  file.hunks.forEach((hunk, index) => {
    let oldLine = hunk.deletionStart;
    let newLine = hunk.additionStart;
    for (const content of hunk.hunkContent) {
      if (content.type === "context") {
        for (let at = 0; at < content.lines; at++) {
          visit({ kind: "context", oldLine: oldLine++, newLine: newLine++, text: file.additionLines[content.additionLineIndex + at], hunk: index });
        }
        continue;
      }
      for (let at = 0; at < content.deletions; at++) visit({ kind: "removed", oldLine: oldLine++, text: file.deletionLines[content.deletionLineIndex + at], hunk: index });
      for (let at = 0; at < content.additions; at++) visit({ kind: "added", newLine: newLine++, text: file.additionLines[content.additionLineIndex + at], hunk: index });
    }
  });
}

export function diffSides(file: FileDiffMetadata): DiffSides {
  const head = { text: [] as (string | undefined)[], hunk: [] as (number | undefined)[] };
  const base = { text: [] as (string | undefined)[], hunk: [] as (number | undefined)[] };
  const unchanged = new Map<number, number>();
  const put = (side: typeof head, line: number, text: string | undefined, hunk: number): void => {
    if (text === undefined || line < 1) return;
    side.text[line - 1] = withoutLineEnd(text);
    side.hunk[line - 1] = hunk;
  };
  eachHunkLine(file, (line) => {
    if (line.kind === "context") {
      put(head, line.newLine, line.text, line.hunk);
      unchanged.set(line.oldLine, line.newLine);
    } else if (line.kind === "removed") put(base, line.oldLine, line.text, line.hunk);
    else put(head, line.newLine, line.text, line.hunk);
  });
  return { head, base, unchanged };
}

/** a row's key in the track's index: the new numbers as they are, the old ones negated (line numbers start at 1) */
function rowKey(row: DiffRow): number {
  return row.old ? -row.line : row.line;
}

/**
 * The rows a line cursor walks in a diff, in unified order: an unchanged or added line by its new number (old false),
 * a removed line by its old number (old true), each change's removed lines before its added ones. Lines between hunks
 * are not drawn, so they are not on it. An unchanged line a split view's left column draws by its old number is found
 * too, as the same row.
 */
export function diffTrack(file: FileDiffMetadata): LineTrack {
  const rows: DiffRow[] = [];
  const index = new Map<number, number>();
  eachHunkLine(file, (line) => {
    if (line.kind === "context") {
      if (line.newLine < 1) return;
      if (line.oldLine >= 1) index.set(-line.oldLine, rows.length);
      index.set(line.newLine, rows.length);
      rows.push({ line: line.newLine, old: false });
      return;
    }
    const row = line.kind === "removed" ? { line: line.oldLine, old: true } : { line: line.newLine, old: false };
    if (row.line < 1) return;
    index.set(rowKey(row), rows.length);
    rows.push(row);
  });
  return {
    length: rows.length,
    row(at) {
      const row = rows[at];
      if (row === undefined) throw new RangeError(`no row at ${at} of ${rows.length}`);
      return row;
    },
    indexOf(row) {
      return Number.isInteger(row.line) && row.line >= 1 ? index.get(rowKey(row)) ?? -1 : -1;
    },
  };
}

/** A drawn row as a line of one side: an unchanged line is the head's, by its new number; null when the patch lacks it. */
function rowLine(row: DiffRow, sides: DiffSides): { side: "head" | "base"; line: number } | null {
  if (!Number.isInteger(row.line) || row.line < 1) return null;
  if (row.old) {
    const moved = sides.unchanged.get(row.line);
    if (moved !== undefined) return { side: "head", line: moved };
    return sides.base.text[row.line - 1] === undefined ? null : { side: "base", line: row.line };
  }
  return sides.head.text[row.line - 1] === undefined ? null : { side: "head", line: row.line };
}

/**
 * The lines a selection of drawn rows comments on. Head lines win: a selection over removed and added lines keeps only
 * the head's, and stays on the base side only when it has no head line. A selection over the gap between two hunks is
 * cut to the hunk it starts in (the side's first line), so the lines it keeps are the patch's, without a gap.
 */
export function diffSelection(rows: readonly DiffRow[], sides: DiffSides): DiffPick | null {
  const found = rows.map((row) => rowLine(row, sides)).filter((line) => line !== null);
  const side = found.some((line) => line.side === "head") ? "head" : "base";
  const lines = found.filter((line) => line.side === side).map((line) => line.line);
  if (lines.length === 0) return null;
  const first = Math.min(...lines);
  const hunk = sides[side].hunk[first - 1];
  const kept = lines.filter((line) => sides[side].hunk[line - 1] === hunk);
  return { side, lines: [first, Math.max(...kept)] };
}

/** The text of `lines` on one side, or null when any of them is a gap the patch does not show. */
export function sideLines(side: DiffSide, lines: LineRange): string[] | null {
  const text: string[] = [];
  for (let line = lines[0]; line <= lines[1]; line++) {
    const found = line >= 1 ? side.text[line - 1] : undefined;
    if (found === undefined) return null;
    text.push(found);
  }
  return text;
}
