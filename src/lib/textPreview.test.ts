import { describe, expect, it } from "bun:test";
import { dropPartialLastLine } from "./textPreview.ts";

describe("dropPartialLastLine", () => {
  it("cuts the incomplete last line of a truncated text only", () => {
    expect(dropPartialLastLine("a\nb\nhal", true)).toBe("a\nb\n");
    expect(dropPartialLastLine("a\nb\nhal", false)).toBe("a\nb\nhal");
    // one huge line (minified JSON): nothing to cut back to, so it stays
    expect(dropPartialLastLine("{\"a\":1,\"b\"", true)).toBe("{\"a\":1,\"b\"");
    // the cut may land inside a UTF-8 sequence, which decodes to U+FFFD: drop only that
    expect(dropPartialLastLine("{\"a\":\"ä\uFFFD", true)).toBe("{\"a\":\"ä");
    expect(dropPartialLastLine("", true)).toBe("");
  });
});
