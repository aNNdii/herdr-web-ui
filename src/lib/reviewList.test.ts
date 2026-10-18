import { describe, expect, it } from "bun:test";

import { reviewList, type ReviewListInput } from "./reviewList.ts";

const changed = ["src/a.ts", "src/b.ts", "docs/readme.md"];
const list = (input: Partial<ReviewListInput>): ReturnType<typeof reviewList> =>
  reviewList({ scope: "changed", paths: changed, query: "", hidden: null, keep: null, ...input });

describe("reviewList", () => {
  it("shows every path in order when nothing filters or hides", () => {
    expect(list({})).toEqual({ paths: changed, note: null, filtered: false, query: "" });
  });

  it("normalizes the filter and keeps only paths that contain it", () => {
    const result = list({ query: "  SRC/ " });
    expect(result.paths).toEqual(["src/a.ts", "src/b.ts"]);
    expect(result.query).toBe("src/");
    expect(result.filtered).toBe(true);
    expect(result.note).toBeNull();
    expect(list({ query: "   " }).filtered).toBe(false);
  });

  it("hides viewed files in Changed, and never in All", () => {
    const hidden = new Set(["src/a.ts"]);
    expect(list({ hidden }).paths).toEqual(["src/b.ts", "docs/readme.md"]);
    expect(list({ scope: "all", hidden }).paths).toEqual(changed);
    expect(list({ scope: "all", hidden: new Set(changed) }).note).toBeNull();
  });

  it("applies the filter and hiding together", () => {
    expect(list({ query: "src", hidden: new Set(["src/a.ts"]) }).paths).toEqual(["src/b.ts"]);
  });

  it("keeps the shown file through hiding, but not through the filter", () => {
    const hidden = new Set(["src/a.ts", "src/b.ts"]);
    expect(list({ hidden, keep: "src/a.ts" }).paths).toEqual(["src/a.ts", "docs/readme.md"]);
    expect(list({ hidden, keep: "src/a.ts", query: "docs" }).paths).toEqual(["docs/readme.md"]);
    expect(list({ hidden, keep: "gone.ts" }).paths).toEqual(["docs/readme.md"]);
  });

  it("says all changed files are viewed, and still lists the kept file", () => {
    const hidden = new Set(changed);
    expect(list({ hidden })).toEqual({ paths: [], note: "all-viewed", filtered: false, query: "" });
    expect(list({ hidden, keep: "src/b.ts" })).toEqual({ paths: ["src/b.ts"], note: "all-viewed", filtered: false, query: "" });
  });

  it("says all matching files are viewed when a filter is set", () => {
    const result = list({ query: "src", hidden: new Set(["src/a.ts", "src/b.ts"]), keep: "src/a.ts" });
    expect(result.note).toBe("all-matching-viewed");
    expect(result.paths).toEqual(["src/a.ts"]);
  });

  it("ranks nothing-changed before no-match before the viewed notes", () => {
    expect(list({ paths: [] }).note).toBe("nothing-changed");
    expect(list({ paths: [], query: "x", hidden: new Set() }).note).toBe("nothing-changed");
    expect(list({ query: "nope", hidden: new Set(changed) }).note).toBe("no-match");
    expect(list({ scope: "all", paths: [] }).note).toBe("no-match");
    expect(list({ scope: "all", query: "nope" }).note).toBe("no-match");
  });
});
