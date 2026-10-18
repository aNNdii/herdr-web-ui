import { describe, expect, it } from "bun:test";

import { foldersOf, treeReset, type DrawnTree } from "./reviewTreeReset.ts";

const paths = ["src/a.ts", "src/lib/b.ts", "docs/readme.md", "top.md"];
const none = (): boolean => false;
/** The tree as drawn for `paths` under `listing`. */
const drawnFor = (shown: readonly string[], listing: string, expandAll: boolean): DrawnTree => treeReset(null, shown, listing, expandAll, none)!.drawn;

describe("foldersOf", () => {
  it("names every folder that holds a path, once, without a trailing slash", () => {
    expect(foldersOf(paths).sort()).toEqual(["docs", "src", "src/lib"]);
    expect(foldersOf(["top.md"])).toEqual([]);
    expect(foldersOf([])).toEqual([]);
  });
});

describe("treeReset", () => {
  it("draws the first list fresh: every folder open with expandAll, none without", () => {
    const open = treeReset(null, paths, "changed|", true, none)!;
    expect(open.expanded.sort()).toEqual(["docs", "src", "src/lib"]);
    expect(open.drawn).toEqual({ paths, folders: new Set(["src", "src/lib", "docs"]), listing: "changed|", expandAll: true });
    expect(treeReset(null, paths, "all|", false, () => true)!.expanded).toEqual([]);
  });

  it("is null for the list already drawn, even as another array", () => {
    const drawn = drawnFor(paths, "changed|", true);
    expect(treeReset(drawn, [...paths], "changed|", true, none)).toBeNull();
  });

  it("keeps the state of the folders drawn under the same listing when a file drops out", () => {
    const drawn = drawnFor(paths, "changed|", true);
    // the reader closed src/lib and docs; then docs/readme.md is hidden
    const isOpen = (folder: string): boolean => folder === "src";
    const next = treeReset(drawn, ["src/a.ts", "src/lib/b.ts", "top.md"], "changed|", true, isOpen)!;
    expect(next.expanded).toEqual(["src"]);
    expect(next.drawn.folders).toEqual(new Set(["src", "src/lib"]));
    expect(next.drawn.paths).toEqual(["src/a.ts", "src/lib/b.ts", "top.md"]);
  });

  it("opens a new folder under the same listing only with expandAll", () => {
    const shown = ["src/a.ts", "top.md"];
    const grown = [...shown, "docs/readme.md"];
    const opened = treeReset(drawnFor(shown, "changed|", true), grown, "changed|", true, none)!;
    expect(opened.expanded).toEqual(["docs"]);
    const closed = treeReset(drawnFor(shown, "all|", false), grown, "all|", false, () => true)!;
    // src was drawn and is open: it stays open; docs is new and stays closed
    expect(closed.expanded).toEqual(["src"]);
  });

  it("draws fresh under another listing, whatever the folders were", () => {
    const drawn = drawnFor(paths, "changed|", true);
    const filtered = treeReset(drawn, ["src/lib/b.ts"], "changed|lib", true, none)!;
    expect(filtered.expanded.sort()).toEqual(["src", "src/lib"]);
    expect(filtered.drawn.listing).toBe("changed|lib");
    const all = treeReset(drawn, paths, "all|", false, () => true)!;
    expect(all.expanded).toEqual([]);
  });

  it("draws fresh when expandAll changes under the same listing", () => {
    const drawn = drawnFor(paths, "all|", false);
    expect(treeReset(drawn, paths, "all|", true, none)!.expanded.sort()).toEqual(["docs", "src", "src/lib"]);
  });
});
