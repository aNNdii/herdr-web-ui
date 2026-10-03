import { describe, expect, it } from "bun:test";
import {
  CHAT_HIGHLIGHT_LIMIT,
  highlightLines,
  languageForFence,
  languageForPath,
  type HighlightResult,
} from "./highlight.ts";

describe("languageForFence", () => {
  it("knows aliases and the first word only", () => {
    expect(languageForFence("ts")).toBe("typescript");
    expect(languageForFence("TSX title=x")).toBe("typescript");
    expect(languageForFence("sh")).toBe("bash");
    expect(languageForFence("yml")).toBe("yaml");
    expect(languageForFence("dockerfile")).toBe("dockerfile");
  });
  it("returns null for nothing or the unknown", () => {
    expect(languageForFence("")).toBeNull();
    expect(languageForFence("klingon")).toBeNull();
  });
});

describe("languageForPath", () => {
  it.each([
    ["/r/Dockerfile", "dockerfile"], ["/r/Dockerfile.dev", "dockerfile"], ["/r/Makefile", "makefile"],
    ["/r/.gitignore", "ini"], ["/r/.env.local", "ini"], ["/r/x.tsx", "typescript"], ["/r/x.mjs", "javascript"],
    ["/r/README.md", "markdown"], ["/r/a.toml", "ini"], ["/r/a.svg", "xml"], ["/r/a.py", "python"],
    ["C:\\r\\a.rs", "rust"],
  ])("%s → %s", (path, language) => expect(languageForPath(path)).toBe(language));
  it("decides what is Markdown, by name only and ignoring case", () => {
    expect(languageForPath("/r/notes.MARKDOWN")).toBe("markdown");
    expect(languageForPath("/r/x.mdx")).toBeNull();
  });
  it("returns null for the unknown", () => {
    expect(languageForPath("/r/notes.xyz")).toBeNull();
    expect(languageForPath("/r/LICENSE")).toBeNull();
  });
});

describe("highlightLines", () => {
  const text = (result: HighlightResult) => result.lines.map((line) => line.map((token) => token.text).join(""));
  it("keeps a multi-line comment's role on every line it spans", () => {
    const result = highlightLines("/* a\nb */\nconst x = 1;", "typescript", CHAT_HIGHLIGHT_LIMIT);
    expect(text(result)).toEqual(["/* a", "b */", "const x = 1;"]);
    expect(result.lines[0]!.every((t) => t.role === "comment")).toBe(true);
    expect(result.lines[1]!.every((t) => t.role === "comment")).toBe(true);
    expect(result.lines[2]!.find((t) => t.text === "const")?.role).toBe("keyword");
    expect(result.lines[2]!.find((t) => t.text === "1")?.role).toBe("number");
  });
  it("keeps a template string's role across lines", () => {
    const result = highlightLines("const s = `a\nb`;", "javascript", CHAT_HIGHLIGHT_LIMIT);
    expect(result.lines[1]!.find((t) => t.text.includes("b"))?.role).toBe("string");
  });
  it("maps diff lines to inserted and deleted", () => {
    const result = highlightLines("+added\n-removed", "diff", CHAT_HIGHLIGHT_LIMIT);
    expect(result.lines[0]![0]!.role).toBe("inserted");
    expect(result.lines[1]![0]!.role).toBe("deleted");
  });
  it("drops the empty line after a final newline, and an empty file is one empty line", () => {
    expect(text(highlightLines("a\nb\n", "typescript", CHAT_HIGHLIGHT_LIMIT))).toEqual(["a", "b"]);
    expect(highlightLines("", null, CHAT_HIGHLIGHT_LIMIT).lines).toEqual([[]]);
  });
  it("splits CRLF without keeping the carriage return", () => {
    expect(text(highlightLines("a\r\nb", "typescript", CHAT_HIGHLIGHT_LIMIT))).toEqual(["a", "b"]);
    expect(text(highlightLines("a\r\nb", null, CHAT_HIGHLIGHT_LIMIT))).toEqual(["a", "b"]);
  });
  it("is plain without a language", () => {
    const result = highlightLines("const x", null, CHAT_HIGHLIGHT_LIMIT);
    expect(result).toEqual({ lines: [[{ text: "const x", role: null }]], tooLong: false });
  });
  it("is plain and says so above the limit", () => {
    const result = highlightLines("const x = 1;", "typescript", 5);
    expect(result).toEqual({ lines: [[{ text: "const x = 1;", role: null }]], tooLong: true });
  });
  it("is plain when the language is not registered", () => {
    expect(highlightLines("x", "klingon", CHAT_HIGHLIGHT_LIMIT)).toEqual({ lines: [[{ text: "x", role: null }]], tooLong: false });
  });
});
