import { describe, expect, it } from "bun:test";
import {
  CHAT_HIGHLIGHT_LIMIT,
  highlightLines,
  languageForFence,
  languageForPath,
  tooLongToHighlight,
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
  it("returns null for plain text, which is registered but no language", () => {
    for (const word of ["text", "txt", "plaintext", "TXT"]) expect(languageForFence(word)).toBeNull();
  });
  it("maps the Markdown spellings to markdown", () => {
    for (const word of ["md", "mkd", "mdown", "mkdn"]) expect(languageForFence(word)).toBe("markdown");
  });
});

describe("languageForPath", () => {
  it.each([
    ["/r/Dockerfile", "dockerfile"], ["/r/Dockerfile.dev", "dockerfile"], ["/r/Makefile", "makefile"],
    ["/r/.gitignore", "ini"], ["/r/.env.local", "ini"], ["/r/x.tsx", "typescript"], ["/r/x.mjs", "javascript"],
    ["/r/README.md", "markdown"], ["/r/a.toml", "ini"], ["/r/a.svg", "xml"], ["/r/a.py", "python"],
    ["C:\\r\\a.rs", "rust"], ["/r/a.", null], ["/r/.bashrc", "bash"], ["/r.d/LICENSE", null],
  ])("%s → %s", (path, language) => expect(languageForPath(path)).toBe(language));
  it("decides what is Markdown, by name only and ignoring case", () => {
    expect(languageForPath("/r/notes.MARKDOWN")).toBe("markdown");
    expect(languageForPath("/r/x.mdx")).toBeNull();
    expect(languageForPath("/r/x.mkd")).toBe("markdown");
    expect(languageForPath("/r/x.mdown")).toBe("markdown");
  });
  it("lets a Markdown extension win over a Dockerfile name", () => {
    expect(languageForPath("/r/Dockerfile.md")).toBe("markdown");
    expect(languageForPath("/r/Dockerfile.dev")).toBe("dockerfile");
  });
  it("has no language for plain-text files", () => {
    for (const name of ["a.txt", "a.text", "CMakeLists.txt"]) expect(languageForPath(`/r/${name}`)).toBeNull();
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
  it("never calls a plain-text file too long, whatever its size", () => {
    const big = "a line of text\n".repeat(30_000);
    const result = highlightLines(big, languageForPath("/r/a.txt"), 256 * 1024);
    expect(big.length).toBeGreaterThan(256 * 1024);
    expect(result.tooLong).toBe(false);
    expect(result.lines.every((line) => line.every((token) => token.role === null))).toBe(true);
  });
  it("keeps a blank line before the final newline", () => {
    expect(text(highlightLines("a\n\n", "typescript", CHAT_HIGHLIGHT_LIMIT))).toEqual(["a", ""]);
  });
  it("reads a refined title as its refinement: a class name is a type, a function's a function", () => {
    const result = highlightLines("class Box {}\nfunction run() {}", "typescript", CHAT_HIGHLIGHT_LIMIT);
    expect(result.lines[0]!.find((t) => t.text === "Box")?.role).toBe("type");
    expect(result.lines[1]!.find((t) => t.text === "run")?.role).toBe("function");
  });
  it("keeps emphasis apart from the role", () => {
    const result = highlightLines("some **bold** and *em*", "markdown", CHAT_HIGHLIGHT_LIMIT);
    expect(result.lines[0]!.find((t) => t.text.includes("bold"))?.emphasis).toBe("strong");
    expect(result.lines[0]!.find((t) => t.text.includes("em"))?.emphasis).toBe("em");
  });
  it("returns the same result for the same call, so a remounted view does not tokenize again", () => {
    const code = "const x = 1;";
    expect(highlightLines(code, "typescript", CHAT_HIGHLIGHT_LIMIT)).toBe(highlightLines(code, "typescript", CHAT_HIGHLIGHT_LIMIT));
  });
  it("is plain when the language is not registered", () => {
    expect(highlightLines("x", "klingon", CHAT_HIGHLIGHT_LIMIT)).toEqual({ lines: [[{ text: "x", role: null }]], tooLong: false });
  });
});

describe("tooLongToHighlight", () => {
  it("is true only for a registered language above the limit", () => {
    expect(tooLongToHighlight("x".repeat(11), "ts", 10)).toBe(true);
    expect(tooLongToHighlight("x".repeat(10), "ts", 10)).toBe(false);
    expect(tooLongToHighlight("x".repeat(11), null, 10)).toBe(false);
    expect(tooLongToHighlight("x".repeat(11), "no-such-language", 10)).toBe(false);
  });

  it("measures the raw text, carriage returns included", () => {
    // "a\r\nb" is 4 characters, though it shows as 2
    expect(tooLongToHighlight("a\r\nb", "ts", 3)).toBe(true);
    expect(highlightLines("a\r\nb", "ts", 3).tooLong).toBe(true);
  });
});
