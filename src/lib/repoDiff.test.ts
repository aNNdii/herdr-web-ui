import { describe, expect, it } from "bun:test";

import type { RepoDiffFilePatch } from "../../shared/protocol.ts";
import { ApiError } from "./api.ts";
import { bridgeAsk, comparisonWord, diffColorable, diffErrorMessage, diffStyleFor, diffTargetFromState, diffTargetState, nothingChangedSentence, nothingChangedWord, refusedUncommitted, REPO_DIFF_SCOPES, repositoryFilePath, shortHash, standInMessage, statusWord, unavailableMessage, worktreeMovedMessage, type RepoComparison, type RepoDiffTarget } from "./repoDiff.ts";
import { VIRTUAL_HIGHLIGHT_LINES } from "./sourcePreview.ts";

const t = (key: string, vars?: Record<string, string | number>): string =>
  vars === undefined ? key : key.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));

const answer = (unavailable: RepoDiffFilePatch["unavailable"]): RepoDiffFilePatch => ({
  repository: { root: "/home/dev/repo", branch: "main", head: "a".repeat(40), detached: false, unborn: false },
  scope: "workspace", base: null, head: null,
  file: { path: "src/a.ts", old_path: null, status: "modified", additions: null, deletions: null, binary: unavailable === "binary" },
  patch: null, unavailable, truncated: unavailable === "too_large",
  limits: { max_patch_bytes: 1024 * 1024, context_lines: 3 },
});

describe("repository diff words", () => {
  it("names every status and comparison", () => {
    expect(statusWord(t, "renamed")).toBe("Renamed");
    expect(statusWord(t, "unmerged")).toBe("Conflict");
    expect(comparisonWord(t, { scope: "uncommitted", base: null, head: null })).toBe("Uncommitted");
    expect(comparisonWord(t, { scope: "uncommitted", base: "a".repeat(40), head: "feat/x" })).toBe("Uncommitted");
    expect(comparisonWord(t, { scope: "workspace", base: null, head: null })).toBe("Unstaged");
    expect(comparisonWord(t, { scope: "staged", base: null, head: null })).toBe("Staged");
    expect(comparisonWord(t, { scope: "commit", base: "0123456789abcdef0123456789abcdef01234567", head: "HEAD" })).toBe("0123456..HEAD");
    expect(shortHash("v1.0")).toBe("v1.0");
  });

  it("says each comparison's empty state in its own words", () => {
    expect(nothingChangedWord(t, "uncommitted")).toBe("No uncommitted changes");
    expect(nothingChangedWord(t, "workspace")).toBe("No unstaged changes");
    expect(nothingChangedWord(t, "staged")).toBe("Nothing staged");
    expect(nothingChangedWord(t, "commit")).toBe("These commits are the same");
    expect(nothingChangedSentence(t, "uncommitted")).toBe("No uncommitted changes.");
    expect(nothingChangedSentence(t, "workspace")).toBe("No unstaged changes.");
    expect(nothingChangedSentence(t, "staged")).toBe("Nothing staged.");
    expect(nothingChangedSentence(t, "commit")).toBe("Nothing changed here.");
  });

  it("knows every scope a history entry may hold", () => {
    expect([...REPO_DIFF_SCOPES].sort()).toEqual(["commit", "staged", "uncommitted", "workspace"]);
  });

  it("says why a patch is missing, with the cap in bytes", () => {
    expect(unavailableMessage(t, answer(null))).toBeNull();
    expect(unavailableMessage(t, answer("binary"))).toBe("This is a binary file; there are no lines to compare.");
    expect(unavailableMessage(t, answer("too_large"))).toBe("This change is larger than 1 MB and is not shown here.");
    expect(unavailableMessage(t, answer("unmerged"))).toContain("merge conflict");
  });

  it("maps the routes' refusals and never shows git's own words", () => {
    expect(diffErrorMessage(t, new ApiError("/api/workspace/diff/files", 409, "fatal: not a git repository", "not_a_repository"))).toBe("This folder is not in a git repository.");
    expect(diffErrorMessage(t, new ApiError("/api/workspace/diff/files", 404, "no such commit", "revision_not_found"))).toBe("No commit by that name.");
    expect(diffErrorMessage(t, new ApiError("/api/workspace/diff/files", 409, "base and head share no history", "no_merge_base"))).toBe("Base and head share no history.");
    expect(diffErrorMessage(t, new ApiError("/api/workspace/diff/files", 404, "Not found", "not_found"))).toBe("This PC's bridge cannot show changes yet.");
    expect(diffErrorMessage(t, new ApiError("/api/workspace/diff/files", 403, "watch only", "read_only"))).toBe("This device can only watch.");
    expect(diffErrorMessage(t, new ApiError("/api/workspace/diff/files", 504, "deadline", "git_timeout"))).toBe("git took too long to answer.");
    expect(diffErrorMessage(t, new ApiError("/api/workspace/diff/file", 409, "the worktree no longer has that branch checked out", "worktree_moved", "head"))).toBe("The branch is no longer checked out in its worktree. Turn off “Show uncommitted changes” in View options or choose the branch again.");
    expect(diffErrorMessage(t, new Error("socket closed"))).toBe("Changes could not be loaded.");
  });
});

describe("an older bridge without the uncommitted scope", () => {
  const pane: RepoComparison = { scope: "uncommitted", base: null, head: null };
  const worktree: RepoComparison = { scope: "uncommitted", base: "origin/next", head: "feat/x", mergeBase: true };
  const refusal = (code: string, status = 400) => new ApiError("/api/workspace/diff/files", status, "refused", code);

  it("asks what was wanted until a bridge refused it", () => {
    expect(bridgeAsk(pane, false)).toEqual({ asked: pane, standIn: null });
    expect(bridgeAsk(worktree, false)).toEqual({ asked: worktree, standIn: null });
  });

  it("asks the unstaged list for a folder and the commits for a branch once refused", () => {
    expect(bridgeAsk(pane, true)).toEqual({ asked: { scope: "workspace", base: null, head: null }, standIn: "unstaged" });
    expect(bridgeAsk(worktree, true)).toEqual({ asked: { scope: "commit", base: "origin/next", head: "feat/x", mergeBase: true }, standIn: "commits" });
  });

  it("leaves every comparison an older bridge knows as it is", () => {
    for (const known of [{ scope: "workspace", base: null, head: null }, { scope: "staged", base: null, head: null }, { scope: "commit", base: "main", head: "feat/x", mergeBase: true }] satisfies RepoComparison[]) {
      expect(bridgeAsk(known, true)).toEqual({ asked: known, standIn: null });
    }
  });

  it("counts only invalid_scope to an uncommitted ask as an older bridge", () => {
    expect(refusedUncommitted(refusal("invalid_scope"), pane)).toBe(true);
    expect(refusedUncommitted(refusal("invalid_scope"), worktree)).toBe(true);
    expect(refusedUncommitted(refusal("not_found", 404), pane)).toBe(false);
    expect(refusedUncommitted(refusal("worktree_moved", 409), worktree)).toBe(false);
    expect(refusedUncommitted(refusal("invalid_revision"), worktree)).toBe(false);
    expect(refusedUncommitted(refusal("invalid_scope"), { scope: "workspace", base: null, head: null })).toBe(false);
    expect(refusedUncommitted(refusal("invalid_scope"), { scope: "commit", base: "main", head: null, mergeBase: true })).toBe(false);
    expect(refusedUncommitted(new Error("invalid_scope"), pane)).toBe(false);
  });

  it("says calmly what the stand-in leaves out, and why a worktree's changes are left out", () => {
    expect(standInMessage(t, "unstaged")).toBe("This PC's bridge leaves out staged changes.");
    expect(standInMessage(t, "commits")).toBe("This PC's bridge compares only commits.");
    expect(worktreeMovedMessage(t, "feat/x")).toBe("feat/x is no longer checked out in its worktree, so uncommitted changes are left out.");
  });
});

describe("repository diff layout", () => {
  it("colors a patch within the source bounds, for a colorable language", () => {
    const patch = "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-const a = 1;\n+const a = 2;\n";
    expect(diffColorable("src/a.ts", patch)).toBe(true);
    expect(diffColorable("notes.unknownext", patch)).toBe(false);
    expect(diffColorable("src/a.ts", `${patch}${"+x\n".repeat(VIRTUAL_HIGHLIGHT_LINES)}`)).toBe(false);
  });

  it("draws one column on a narrow screen whatever the setting says", () => {
    expect(diffStyleFor("split", false)).toBe("split");
    expect(diffStyleFor("split", true)).toBe("unified");
    expect(diffStyleFor("unified", false)).toBe("unified");
  });

  it("joins the repository root and a relative path once", () => {
    expect(repositoryFilePath("/home/dev/repo", "src/a.ts")).toBe("/home/dev/repo/src/a.ts");
    expect(repositoryFilePath("/home/dev/repo/", "docs/a b.md")).toBe("/home/dev/repo/docs/a b.md");
    expect(repositoryFilePath("C:/Users/dev/repo", "src/a.ts")).toBe("C:/Users/dev/repo/src/a.ts");
  });
});

describe("repository diff history entry", () => {
  const target: RepoDiffTarget = { machineId: "local", paneId: "p1", directory: null, scope: "commit", base: "a".repeat(40), head: "b".repeat(40), path: "src/a.ts", oldPath: "src/old.ts" };

  it("keeps the entry's other data and reads its own back", () => {
    const state = diffTargetState({ "herdr-web-ui:file-preview": { path: "x" } }, target);
    expect(state["herdr-web-ui:file-preview"]).toEqual({ path: "x" });
    expect(diffTargetFromState(state)).toEqual(target);
  });

  it("reads back an uncommitted entry and an entry saved before that scope existed", () => {
    const uncommitted: RepoDiffTarget = { ...target, scope: "uncommitted", base: null, head: null, oldPath: null };
    expect(diffTargetFromState(diffTargetState(null, uncommitted))).toEqual(uncommitted);
    const worktree: RepoDiffTarget = { ...target, directory: "/work/feat-x", scope: "uncommitted", base: "c".repeat(40), head: "feat/x" };
    expect(diffTargetFromState(diffTargetState(null, worktree))).toEqual(worktree);
    const saved = { "herdr-web-ui:repo-diff": { machineId: "local", paneId: "p1", directory: null, scope: "workspace", base: null, head: null, path: "src/a.ts", oldPath: null } };
    expect(diffTargetFromState(saved)).toEqual({ machineId: "local", paneId: "p1", directory: null, scope: "workspace", base: null, head: null, path: "src/a.ts", oldPath: null });
  });

  it("ignores an entry of another shape", () => {
    expect(diffTargetFromState(null)).toBeNull();
    expect(diffTargetFromState({})).toBeNull();
    expect(diffTargetFromState({ "herdr-web-ui:repo-diff": { machineId: "local", path: "a", scope: "branches" } })).toBeNull();
    expect(diffTargetFromState({ "herdr-web-ui:repo-diff": { ...target, paneId: 7 } })).toBeNull();
    expect(diffTargetFromState({ "herdr-web-ui:repo-diff": { ...target, path: undefined } })).toBeNull();
  });

  it("releases only the diff when another viewer takes its entry", () => {
    const state = diffTargetState({ marker: "kept" }, target);
    expect(diffTargetState(state, null)).toEqual({ marker: "kept" });
    expect(diffTargetFromState(state)).toEqual(target);
  });
});
