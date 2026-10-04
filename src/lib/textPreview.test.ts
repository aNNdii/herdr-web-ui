import { describe, expect, it } from "bun:test";
import { hasPreview, loadedText, textView } from "./textPreview.ts";

describe("loadedText", () => {
  it("cuts the incomplete last line of a file longer than the limit only", () => {
    expect(loadedText("a\nb\nhal", 100, 8)).toEqual({ text: "a\nb\n", truncated: true, limit: 8 });
    expect(loadedText("a\nb\nhal", 8, 8)).toEqual({ text: "a\nb\nhal", truncated: false, limit: 8 });
    // one huge line (minified JSON): nothing to cut back to, so it stays
    expect(loadedText("{\"a\":1,\"b\"", 100, 10).text).toBe("{\"a\":1,\"b\"");
    // the cut may land inside a UTF-8 sequence, which decodes to U+FFFD: drop only that
    expect(loadedText("{\"a\":\"ä\uFFFD", 100, 10).text).toBe("{\"a\":\"ä");
    expect(loadedText("", 100, 10)).toEqual({ text: "", truncated: true, limit: 10 });
  });

  it("keeps a file of exactly the limit whole", () => {
    expect(loadedText("abc", 3, 3).truncated).toBe(false);
  });
});

describe("textView", () => {
  it("renders Markdown in Preview and shows everything else as code", () => {
    expect(textView("markdown", "preview")).toBe("markdown");
    expect(textView("markdown", "code")).toBe("code");
    expect(textView("typescript", "preview")).toBe("code");
    expect(textView(null, "preview")).toBe("code");
  });

  it("gives only Markdown a Preview", () => {
    expect(hasPreview("markdown")).toBe(true);
    expect(hasPreview("typescript")).toBe(false);
    expect(hasPreview(null)).toBe(false);
  });
});
