import { describe, expect, it } from "bun:test";

import { drawnRows, reviewList, type ReviewListInput } from "./reviewList.ts";

const changed = ["src/a.ts", "src/b.ts", "docs/readme.md"];
const list = (input: Partial<ReviewListInput>): ReturnType<typeof reviewList> =>
  reviewList({ scope: "changed", paths: changed, query: "", hidden: null, keep: null, apart: null, ...input });

describe("reviewList", () => {
  it("shows every path in order when nothing filters or hides", () => {
    expect(list({})).toEqual({ paths: changed, newPaths: [], note: null, filtered: false, query: "" });
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
    expect(list({ hidden })).toEqual({ paths: [], newPaths: [], note: "all-viewed", filtered: false, query: "" });
    expect(list({ hidden, keep: "src/b.ts" })).toEqual({ paths: ["src/b.ts"], newPaths: [], note: "all-viewed", filtered: false, query: "" });
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

  describe("new files listed apart", () => {
    const paths = ["src/a.ts", "src/new.ts", "docs/readme.md", "notes.md"];
    const apart = new Set(["src/new.ts", "notes.md", "gone.ts"]);

    it("lists the new files after the others, each group in its order", () => {
      expect(list({ paths, apart })).toEqual({ paths: ["src/a.ts", "docs/readme.md"], newPaths: ["src/new.ts", "notes.md"], note: null, filtered: false, query: "" });
    });

    it("lists them with the others when off, and never apart in All", () => {
      expect(list({ paths }).paths).toEqual(paths);
      expect(list({ paths }).newPaths).toEqual([]);
      expect(list({ scope: "all", paths, apart })).toEqual({ paths, newPaths: [], note: null, filtered: false, query: "" });
    });

    it("filters and hides viewed files in both groups, the shown file kept in its own", () => {
      expect(list({ paths, apart, query: "src" })).toMatchObject({ paths: ["src/a.ts"], newPaths: ["src/new.ts"] });
      const hidden = new Set(["src/a.ts", "src/new.ts", "notes.md"]);
      expect(list({ paths, apart, hidden })).toMatchObject({ paths: ["docs/readme.md"], newPaths: [], note: null });
      expect(list({ paths, apart, hidden, keep: "notes.md" })).toMatchObject({ paths: ["docs/readme.md"], newPaths: ["notes.md"] });
    });

    it("says why the list is short over both groups together", () => {
      expect(list({ paths, apart, hidden: new Set(paths) }).note).toBe("all-viewed");
      expect(list({ paths, apart, query: "nope" }).note).toBe("no-match");
      expect(list({ paths: ["notes.md"], apart })).toMatchObject({ paths: [], newPaths: ["notes.md"], note: null });
    });
  });
});

describe("drawnRows", () => {
  it("counts a row per file and per folder, every folder open", () => {
    expect(drawnRows([])).toBe(0);
    expect(drawnRows(["a.ts", "b.ts"])).toBe(2);
    expect(drawnRows(["src/a.ts", "src/b.ts", "docs/readme.md"])).toBe(5);
  });

  it("draws a folder whose only entry is a folder on that folder's row", () => {
    expect(drawnRows(["a/b/c/file.ts"])).toBe(2);
    expect(drawnRows(["a/b/c/file.ts", "a/b/d/file.ts"])).toBe(5);
    expect(drawnRows(["a/b/file.ts", "a/c.ts"])).toBe(4);
  });
});
