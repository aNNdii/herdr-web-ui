import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, parseMergeTree, syncMessage, syncStatus } from "./upstream-sync.ts";

describe("syncMessage", () => {
  it("names the upstream releases in order, the commit count and the last pull request", () => {
    expect(syncMessage([
      "fix(sidebar): keep the tree (#1237)",
      "chore(release): prepare 0.4.11 and remote runtime v30 (#1208)",
      "fix(ws): accept origins (#1206)",
      "chore(release): prepare 0.4.10 and remote runtime v29 (#1186)",
      "test(scripts): no number",
    ])).toBe("Merge upstream/main (0.4.10, 0.4.11, 5 commits up to #1237) into next");
  });
  it("reads one commit without a release or a number", () => {
    expect(syncMessage(["docs: a typo"])).toBe("Merge upstream/main (1 commit) into next");
  });
});

describe("parseMergeTree", () => {
  const tree = "a".repeat(40);
  it("takes the tree of a clean merge", () => {
    expect(parseMergeTree(0, `${tree}\n`)).toEqual({ clean: true, tree, conflicts: [] });
  });
  it("lists each conflicted path once and no tree to commit", () => {
    expect(parseMergeTree(1, `${tree}\nsrc/a.ts\nsrc/a.ts\nDESIGN.md\n`)).toEqual({ clean: false, tree: null, conflicts: ["src/a.ts", "DESIGN.md"] });
  });
  it("refuses an exit other than clean or conflicted", () => {
    expect(() => parseMergeTree(128, "")).toThrow();
  });
});

describe("syncStatus", () => {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "herdr-fork-sync-")));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));
  // the user's own git configuration (signing, hooks, templates) stays out of the fixture
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  const fixture = (...args: string[]) => git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "-C", scratch, ...args], { env });
  const commit = (file: string, text: string, message: string) => {
    writeFileSync(join(scratch, file), text);
    fixture("add", file);
    fixture("commit", "-q", "-m", message);
  };

  fixture("init", "-q", "-b", "main");
  commit("a.txt", "one\n", "base");
  fixture("branch", "next");
  fixture("branch", "upstream");
  fixture("switch", "-q", "upstream");
  commit("a.txt", "one\ntwo\n", "chore(release): prepare 1.2.3 (#5)");
  fixture("switch", "-q", "next");
  commit("b.txt", "fork\n", "feat: the fork's own file");
  const refs = { next: "next", main: "main", upstream: "upstream" };

  it("finds a merge with no conflict, and a mirror that fast-forwards", () => {
    const status = syncStatus(refs, scratch);
    expect(status.main).toEqual({ ref: "main", behind: 1, fastForward: true });
    expect(status.next).toEqual({ ref: "next", behind: 1, ahead: 1 });
    expect(status.merge).toMatchObject({ clean: true, conflicts: [], commits: 1, message: "Merge upstream/main (1.2.3, 1 commit up to #5) into next" });
    expect(status.merge?.tree).toMatch(/^[0-9a-f]{40}$/);
  });

  it("names the files that conflict, writing nothing", () => {
    commit("a.txt", "one\nfork\n", "feat: the fork changes the same line");
    const head = fixture("rev-parse", "HEAD").stdout;
    const status = syncStatus(refs, scratch);
    expect(status.merge).toMatchObject({ clean: false, tree: null, conflicts: ["a.txt"] });
    expect(fixture("rev-parse", "HEAD").stdout).toBe(head);
    expect(fixture("status", "--porcelain").stdout).toBe("");
  });

  it("has nothing to merge once next holds upstream", () => {
    fixture("merge", "-q", "-X", "ours", "-m", "sync", "upstream");
    expect(syncStatus(refs, scratch).merge).toBeNull();
  });

  it("tells a mirror that has commits of its own", () => {
    fixture("switch", "-q", "main");
    commit("c.txt", "mirror\n", "a commit upstream lacks");
    expect(syncStatus(refs, scratch).main.fastForward).toBe(false);
  });
});
