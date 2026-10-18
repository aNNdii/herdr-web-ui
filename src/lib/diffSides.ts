import type { FileDiffMetadata } from "@pierre/diffs";

import type { LineRange } from "./fileComments.ts";

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

export function diffSides(file: FileDiffMetadata): DiffSides {
  const head = { text: [] as (string | undefined)[], hunk: [] as (number | undefined)[] };
  const base = { text: [] as (string | undefined)[], hunk: [] as (number | undefined)[] };
  const unchanged = new Map<number, number>();
  const put = (side: typeof head, line: number, text: string | undefined, hunk: number): void => {
    if (text === undefined || line < 1) return;
    side.text[line - 1] = withoutLineEnd(text);
    side.hunk[line - 1] = hunk;
  };
  file.hunks.forEach((hunk, index) => {
    let oldLine = hunk.deletionStart;
    let newLine = hunk.additionStart;
    for (const content of hunk.hunkContent) {
      if (content.type === "context") {
        for (let at = 0; at < content.lines; at++) {
          put(head, newLine, file.additionLines[content.additionLineIndex + at], index);
          unchanged.set(oldLine, newLine);
          oldLine++;
          newLine++;
        }
        continue;
      }
      for (let at = 0; at < content.deletions; at++) put(base, oldLine++, file.deletionLines[content.deletionLineIndex + at], index);
      for (let at = 0; at < content.additions; at++) put(head, newLine++, file.additionLines[content.additionLineIndex + at], index);
    }
  });
  return { head, base, unchanged };
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
