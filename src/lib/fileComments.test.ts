import { describe, expect, it } from "bun:test";
import { SELECTION_QUOTE_MAX } from "./compose.ts";
import { fileAnchor, fileCommentAt, fileLines, fileQuote, isFileComment, linesText, pathLabel, placeFileComment, QUOTE_LINE_MAX, QUOTE_LINES_MAX, sortFileComments, type FileComment, type LineRange } from "./fileComments.ts";

const base = { path: "/repo/src/sync.ts", label: "src/sync.ts", view: "code" as const };

describe("fileLines", () => {
  it("splits CRLF, CR and LF alike and keeps a last line without newline", () => {
    expect(fileLines("a\r\nb\rc\nd")).toEqual(["a", "b", "c", "d"]);
    expect(fileLines("a\n")).toEqual(["a", ""]);
    expect(fileLines("")).toEqual([""]);
  });
});

describe("pathLabel", () => {
  it("is relative inside the pane's folder, absolute outside", () => {
    expect(pathLabel("/repo/src/a.ts", "/repo")).toBe("src/a.ts");
    expect(pathLabel("/repo/src/a.ts", "/repo/")).toBe("src/a.ts");
    expect(pathLabel("/repository/a.ts", "/repo")).toBe("/repository/a.ts");
    expect(pathLabel("/repo/a.ts", null)).toBe("/repo/a.ts");
    expect(pathLabel("C:\\repo\\a.ts", "C:\\repo")).toBe("a.ts");
  });
  it("is the path itself when it is the folder", () => {
    expect(pathLabel("/repo", "/repo")).toBe("/repo");
    expect(pathLabel("/repo", "/repo/")).toBe("/repo");
  });
});

describe("linesText", () => {
  it("names one line or a range", () => {
    expect(linesText([8, 8])).toBe("8");
    expect(linesText([42, 44])).toBe("42-44");
  });
});

describe("placeFileComment", () => {
  const file = ["a", "b", "c", "d", "c", "d"];
  it("stays where the lines still read the same", () => expect(placeFileComment({ lines: [2, 2], source: ["b"] }, file, 6)).toEqual([2, 2]));
  it("moves to the one other place the lines are", () => expect(placeFileComment({ lines: [1, 2], source: ["b", "c"] }, file, 6)).toEqual([2, 3]));
  it("is outdated when the lines are gone or found twice", () => {
    expect(placeFileComment({ lines: [1, 1], source: ["x"] }, file, 6)).toBeNull();
    expect(placeFileComment({ lines: [1, 2], source: ["c", "d"] }, file, 6)).toBeNull();
  });
  it("is outdated past the loaded lines", () => expect(placeFileComment({ lines: [6, 6], source: ["d"] }, file, 5)).toBeNull());
  it("is outdated without a source", () => expect(placeFileComment({ lines: [1, 1], source: [] }, file, 6)).toBeNull());
  it("never matches a gap, not even with an empty line", () => {
    const gapped = ["a", undefined, "b", undefined, "b"];
    expect(placeFileComment({ lines: [2, 2], source: [""] }, gapped, 5)).toBeNull();
    expect(placeFileComment({ lines: [1, 2], source: ["a", ""] }, gapped, 5)).toBeNull();
    expect(placeFileComment({ lines: [1, 1], source: ["b"] }, gapped, 5)).toBeNull();
    expect(placeFileComment({ lines: [3, 3], source: ["b"] }, gapped, 5)).toEqual([3, 3]);
  });
  it("does not count a match that reaches past the loaded lines", () => expect(placeFileComment({ lines: [1, 2], source: ["c", "d"] }, file, 5)).toEqual([3, 4]));
  it("never moves a comment in a truncated file: it stays where its lines still read the same, else is outdated", () => {
    // "b" is found once in the loaded part, but a second copy may lie past the cut
    expect(placeFileComment({ lines: [1, 1], source: ["b"] }, file, 6, true)).toBeNull();
    expect(placeFileComment({ lines: [1, 1], source: ["b"] }, file, 6)).toEqual([2, 2]);
    expect(placeFileComment({ lines: [2, 2], source: ["b"] }, file, 6, true)).toEqual([2, 2]);
    expect(placeFileComment({ lines: [3, 4], source: ["c", "d"] }, file, 4, true)).toEqual([3, 4]);
  });
});

describe("fileQuote", () => {
  it("quotes a line with its header", () => expect(fileQuote({ ...base, lines: [8, 8], quoteLines: ["if (a < b) {"] })).toBe("> src/sync.ts:8\n> if (a < b) {"));
  it("names a range and quotes a blank line as a bare >", () => expect(fileQuote({ ...base, lines: [7, 9], quoteLines: ["a", "", "b"] })).toBe("> src/sync.ts:7-9\n> a\n>\n> b"));
  it("puts a place after the range", () => expect(fileQuote({ ...base, lines: [7, 8], quoteLines: ["a", "b"] }, "@ feat/x (1a2b3c4)")).toBe("> src/sync.ts:7-8 @ feat/x (1a2b3c4)\n> a\n> b"));
  describe("on a selection", () => {
    const guide = { path: "/repo/docs/guide.md", label: "docs/guide.md", view: "preview" as const };
    it("quotes only the selected words under the header", () => {
      const out = fileQuote({ ...guide, lines: [22, 22], quoteLines: ["Run the browser checks before a release."], selection: { text: "browser checks", start: [0, 8], end: [0, 22] } });
      expect(out).toBe("> docs/guide.md:22\n> browser checks");
    });
    it("keeps the cell separator of a table selection", () => {
      const out = fileQuote({ ...guide, label: "docs/spec.md", lines: [42, 43], quoteLines: ["Older revision | 409 Conflict with the stored note", "Newer revision | 200 with the merged note"], selection: { text: "409 Conflict | Newer revision", start: [0, 17], end: [1, 14] } });
      expect(out.split("\n")).toEqual(["> docs/spec.md:42-43", "> 409 Conflict | Newer revision"]);
    });
    it("quotes each selected line behind > and a blank one as a bare >", () => {
      const out = fileQuote({ ...guide, lines: [3, 5], quoteLines: ["alpha beta", "", "gamma delta"], selection: { text: "beta\n\ngamma", start: [0, 6], end: [2, 5] } });
      expect(out).toBe("> docs/guide.md:3-5\n> beta\n>\n> gamma");
    });
    it("cuts a selected line longer than QUOTE_LINE_MAX at its start", () => {
      const line = `${"x".repeat(300)}NEEDLE${"y".repeat(300)}`;
      const quoted = fileQuote({ ...guide, lines: [1, 1], quoteLines: [line], selection: { text: line, start: [0, 0], end: [0, line.length] } }).split("\n")[1]!.slice(2);
      expect(quoted).toBe(`${"x".repeat(QUOTE_LINE_MAX - 1)}…`);
      expect(Array.from(quoted).length).toBe(QUOTE_LINE_MAX);
    });
    it("never halves an emoji when it cuts", () => {
      const text = "😀".repeat(300);
      const quoted = fileQuote({ ...guide, lines: [1, 1], quoteLines: [text], selection: { text, start: [0, 0], end: [0, text.length] } }).split("\n")[1]!.slice(2);
      expect(quoted).toBe(`${"😀".repeat(QUOTE_LINE_MAX - 1)}…`);
    });
    it("does not quote the unselected rest of a long line", () => {
      const line = `${"x".repeat(300)}NEEDLE${"y".repeat(300)}`;
      expect(fileQuote({ ...guide, lines: [1, 1], quoteLines: [line], selection: { text: "NEEDLE", start: [0, 300], end: [0, 306] } })).toBe("> docs/guide.md:1\n> NEEDLE");
    });
    it("keeps 20 selected lines and counts the rest", () => {
      const lines = Array.from({ length: 54 }, (_, i) => `line ${i + 40}`);
      const out = fileQuote({ ...guide, lines: [40, 93], quoteLines: lines, selection: { text: lines.join("\n"), start: [0, 0], end: [53, 7] } }).split("\n");
      expect(out[0]).toBe("> docs/guide.md:40-93");
      expect(out[1]).toBe("> line 40");
      expect(out.length).toBe(1 + QUOTE_LINES_MAX + 1);
      expect(out.at(-1)).toBe("> … (+34 lines)");
    });
    it("stays within SELECTION_QUOTE_MAX", () => {
      const lines = Array.from({ length: 20 }, () => "w".repeat(190));
      const out = fileQuote({ ...guide, lines: [1, 20], quoteLines: lines, selection: { text: lines.join("\n"), start: [0, 0], end: [19, 190] } });
      expect(Array.from(out.slice(out.indexOf("\n") + 1)).length).toBeLessThanOrEqual(SELECTION_QUOTE_MAX);
      expect(out.endsWith("lines)")).toBe(true);
    });
  });
  it("never halves an emoji", () => {
    const quoted = fileQuote({ ...base, lines: [1, 1], quoteLines: ["😀".repeat(300)] }).split("\n")[1]!.slice(2);
    expect(quoted).toBe(`${"😀".repeat(QUOTE_LINE_MAX - 1)}…`);
  });
  it("keeps 20 lines and counts the rest, the header keeps the range", () => {
    const lines = Array.from({ length: 54 }, (_, i) => `line ${i + 40}`);
    const out = fileQuote({ ...base, lines: [40, 93], quoteLines: lines }).split("\n");
    expect(out[0]).toBe("> src/sync.ts:40-93");
    expect(out.length).toBe(1 + QUOTE_LINES_MAX + 1);
    expect(out.at(-1)).toBe("> … (+34 lines)");
  });
  it("stays within SELECTION_QUOTE_MAX for the whole quote", () => {
    const lines = Array.from({ length: 20 }, () => "w".repeat(190));
    const out = fileQuote({ ...base, lines: [1, 20], quoteLines: lines });
    expect(Array.from(out.slice(out.indexOf("\n") + 1)).length).toBeLessThanOrEqual(SELECTION_QUOTE_MAX);
    expect(out.endsWith("lines)")).toBe(true);
  });
});

describe("sortFileComments", () => {
  it("groups by file in order of the first comment, then by line and start", () => {
    const c = (id: string, path: string, line: number, created: number, col?: number): FileComment => ({ ...base, kind: "file", id, anchor: id, path, label: path, lines: [line, line], source: ["x"], quoteLines: ["x"], created, comment: id, ...(col === undefined ? {} : { selection: { text: "x", start: [0, col], end: [0, col + 1] } }) });
    const sorted = sortFileComments([c("b2", "/b", 1, 5), c("a9", "/a", 9, 1), c("b1", "/b", 1, 9, 4), c("a2", "/a", 2, 7)]);
    expect(sorted.map((x) => x.id)).toEqual(["a2", "a9", "b2", "b1"]);
  });
});

describe("fileCommentAt", () => {
  const line = (n: number) => ({ ...base, lines: [n, n] as LineRange, source: ["x"], quoteLines: ["x"] });
  // moved from line 8 to line 9, its anchor kept (another comment held line 9's then)
  const moved: FileComment = { ...line(9), kind: "file", id: "m", anchor: fileAnchor(line(8)), created: 1, comment: "m" };
  it("finds a new comment's place by where a comment is now, never by a stored anchor that reads the same", () => {
    expect(fileCommentAt([moved], line(8))).toBeUndefined();
    expect(fileCommentAt([moved], line(9))).toBe(moved);
    expect(fileCommentAt([moved], { ...line(9), view: "preview" })).toBeUndefined();
  });
  it("never takes an outdated comment stored on the new comment's place", () => {
    // stored on line 8 when it read "x"; line 8 reads "y" now and "x" is nowhere: it is outdated
    const outdated: FileComment = { ...line(8), kind: "file", id: "o", anchor: fileAnchor(line(8)), created: 1, comment: "o" };
    expect(fileCommentAt([outdated], { ...line(8), source: ["y"], quoteLines: ["y"] })).toBeUndefined();
    expect(fileCommentAt([outdated], line(8))).toBe(outdated);
    // an edit of it (from the outdated list) still finds it by its anchor
    expect(fileCommentAt([outdated], { ...line(8), source: ["y"], quoteLines: ["y"], anchor: outdated.anchor })).toBe(outdated);
  });
  it("finds an edit by the stored anchor it carries, wherever the comment is now", () => {
    expect(fileCommentAt([moved], { ...line(9), anchor: moved.anchor })).toBe(moved);
    expect(fileCommentAt([moved], { ...line(8), anchor: "file:gone" })).toBeUndefined();
  });
});

describe("isFileComment", () => {
  const valid: FileComment = { ...base, kind: "file", id: "i", anchor: "file:/repo/src/sync.ts:code:2-3", lines: [2, 3], source: ["a", "b"], quoteLines: ["a", "b"], created: 1, comment: "note", selection: { text: "a\nb", start: [0, 0], end: [1, 1] } };
  it("accepts a well-formed comment, with or without a selection", () => {
    expect(isFileComment(valid)).toBe(true);
    const { selection: _, ...whole } = valid;
    expect(isFileComment(whole)).toBe(true);
  });
  it("rejects an entry with a broken range or selection", () => {
    expect(isFileComment({ ...valid, lines: [3, 2] })).toBe(false);
    expect(isFileComment({ ...valid, lines: [0, 1], source: ["a", "b"] })).toBe(false);
    expect(isFileComment({ ...valid, source: ["a"] })).toBe(false);
    expect(isFileComment({ ...valid, selection: { text: "a", start: [0, 0], end: [2, 0] } })).toBe(false);
    expect(isFileComment({ ...valid, selection: { text: "a", start: [1, 0], end: [0, 0] } })).toBe(false);
    expect(isFileComment({ ...valid, view: "raw" })).toBe(false);
  });
  it("keeps a valid point, and drops one that is not without losing the comment", () => {
    const pointed = { ...valid, point: { x: 7.5, y: 0.5 } };
    expect(isFileComment(pointed)).toBe(true);
    expect(pointed.point).toEqual({ x: 7.5, y: 0.5 });
    for (const bad of [null, { x: 0.5 }, { x: 0.5, y: Infinity }, { x: 8.5, y: 0 }, { x: 0, y: -1.1 }, "here"]) {
      const entry: Record<string, unknown> = { ...valid, point: bad };
      expect(isFileComment(entry)).toBe(true);
      expect("point" in entry).toBe(false);
    }
  });
  it("is named by its place alone, never by its point", () => {
    const { point: _, ...plain } = { ...valid, point: { x: 0.5, y: 0.5 } };
    expect(fileAnchor({ ...valid, point: { x: 0.5, y: 0.5 } })).toBe(fileAnchor(plain));
    expect(fileCommentAt([valid], { ...plain, anchor: undefined, point: { x: 0.9, y: 0.1 } })).toBe(valid);
  });
  it("rejects an entry of another kind or with a wrong field", () => {
    expect(isFileComment(null)).toBe(false);
    expect(isFileComment({ ...valid, kind: "reply" })).toBe(false);
    expect(isFileComment({ ...valid, id: 1 })).toBe(false);
    expect(isFileComment({ ...valid, created: Number.NaN })).toBe(false);
    expect(isFileComment({ ...valid, quoteLines: ["a", 2] })).toBe(false);
    expect(isFileComment({ ...valid, lines: [1.5, 2.5] })).toBe(false);
  });
});
