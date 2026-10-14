import { describe, expect, it } from "bun:test";
import { codeCommentRows } from "./codeCommentRows.ts";
import type { FileComment, LineRange } from "./fileComments.ts";

let nextId = 0;

function fileComment({ lines, created, selection }: { lines: LineRange; created: number; selection?: FileComment["selection"] }): FileComment {
  const id = `c${nextId++}`;
  return {
    kind: "file",
    id,
    anchor: `${id}-anchor`,
    created,
    comment: id,
    path: "/repo/src/sync.ts",
    label: "src/sync.ts",
    view: "code",
    lines,
    source: [],
    quoteLines: [],
    ...(selection ? { selection } : {}),
  };
}

const placed = (comment: FileComment, lines: LineRange = comment.lines) => ({ comment, lines });
const selection = { text: "x", start: [0, 1], end: [2, 3] } satisfies NonNullable<FileComment["selection"]>;

describe("codeCommentRows", () => {
  it("is empty for no comments", () => expect(codeCommentRows([])).toEqual([]));

  it("puts a comment on the last line of its range", () => {
    const c = fileComment({ lines: [3, 5], created: 1 });
    expect(codeCommentRows([placed(c)])).toEqual([{ line: 5, comments: [c] }]);
  });

  it("puts a one-line comment on its line", () => {
    const c = fileComment({ lines: [5, 5], created: 1 });
    expect(codeCommentRows([placed(c)])).toEqual([{ line: 5, comments: [c] }]);
  });

  it("uses the lines the comment is placed on, not the ones it was saved with", () => {
    const c = fileComment({ lines: [3, 5], created: 1 });
    expect(codeCommentRows([placed(c, [10, 12])])).toEqual([{ line: 12, comments: [c] }]);
  });

  it("holds the comments ending on one line in one row, in send order", () => {
    const whole = fileComment({ lines: [5, 5], created: 20 });
    const range = fileComment({ lines: [3, 5], created: 10, selection });
    // send order is by first line: the range starts at 3, the whole-line comment at 5
    const rows = codeCommentRows([placed(whole), placed(range)]);
    expect(rows).toEqual([{ line: 5, comments: [range, whole] }]);
    expect(codeCommentRows([placed(range), placed(whole)])).toEqual(rows);
  });

  it("orders comments of the same lines by selection start, then creation", () => {
    const late = fileComment({ lines: [5, 5], created: 30 });
    const early = fileComment({ lines: [5, 5], created: 10 });
    const selected = fileComment({ lines: [5, 5], created: 5, selection });
    const rows = codeCommentRows([placed(selected), placed(late), placed(early)]);
    // a whole-line comment first (oldest first), then the selection
    expect(rows).toEqual([{ line: 5, comments: [early, late, selected] }]);
  });

  it("gives the rows by ascending line", () => {
    const a = fileComment({ lines: [9, 9], created: 1 });
    const b = fileComment({ lines: [2, 4], created: 2 });
    const c = fileComment({ lines: [6, 6], created: 3 });
    expect(codeCommentRows([placed(a), placed(b), placed(c)]).map((row) => row.line)).toEqual([4, 6, 9]);
  });

  it("does not change its input", () => {
    const a = fileComment({ lines: [9, 9], created: 1 });
    const b = fileComment({ lines: [2, 4], created: 2 });
    const input = [placed(a), placed(b)];
    codeCommentRows(input);
    expect(input.map((p) => p.comment)).toEqual([a, b]);
  });
});
