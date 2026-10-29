import { describe, expect, it } from "bun:test";

import type { RepoBranchComparison, RepoDiffFilePatch } from "../../shared/protocol.ts";
import { ApiError } from "./api.ts";
import { comparisonChangedWord, comparisonWord, diffColorable, diffErrorMessage, diffStyleFor, diffTargetFromState, diffTargetState, nothingChangedWord, refName, repositoryFilePath, sameComparison, shortHash, statusWord, unavailableMessage, type RepoDiffTarget } from "./repoDiff.ts";
import { bridgeAsk, nothingChangedSentence, refusedUncommitted, REPO_DIFF_SCOPES, standInMessage, worktreeMovedMessage, type RepoComparison } from "./repoDiff.ts";
import { VIRTUAL_HIGHLIGHT_LINES } from "./sourcePreview.ts";

const t = (key: string, vars?: Record<string, string | number>): string =>
  vars === undefined ? key : key.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));

const identity: RepoBranchComparison = { repository_root: "/home/dev/repo", head_oid: "a".repeat(40), base_oid: "b".repeat(40), merge_base_oid: "c".repeat(40) };

const answer = (unavailable: RepoDiffFilePatch["unavailable"]): RepoDiffFilePatch => ({
  repository: { root: "/home/dev/repo", branch: "main", head: "a".repeat(40), detached: false, unborn: false },
  scope: "workspace", base: null, head: null, comparison: null,
  file: { path: "src/a.ts", old_path: null, status: "modified", additions: null, deletions: null, binary: unavailable === "binary" },
  patch: null, unavailable, truncated: unavailable === "too_large",
  limits: { max_patch_bytes: 1024 * 1024, context_lines: 3 },
});

describe("repository diff words", () => {
  it("names every status and comparison", () => {
    expect(statusWord(t, "renamed")).toBe("Renamed");
    expect(statusWord(t, "unmerged")).toBe("Conflict");
    expect(comparisonWord(t, { scope: "uncommitted", base: null, head: null, comparison: null })).toBe("Uncommitted");
    expect(comparisonWord(t, { scope: "uncommitted", base: "a".repeat(40), head: "feat/x", comparison: null })).toBe("Uncommitted");
    expect(comparisonWord(t, { scope: "workspace", base: null, head: null, comparison: null })).toBe("Unstaged");
    expect(comparisonWord(t, { scope: "staged", base: null, head: null, comparison: null })).toBe("Staged");
    expect(comparisonWord(t, { scope: "commit", base: "0123456789abcdef0123456789abcdef01234567", head: "HEAD", comparison: null })).toBe("0123456..HEAD");
    expect(comparisonWord(t, { scope: "branch", base: "origin/main", head: null, comparison: identity })).toBe("Since origin/main");
    expect(shortHash("v1.0")).toBe("v1.0");
  });

  it("says each comparison's empty state in its own words", () => {
    expect(nothingChangedWord(t, "uncommitted")).toBe("No uncommitted changes");
    expect(nothingChangedWord(t, "workspace")).toBe("No unstaged changes");
    expect(nothingChangedWord(t, "staged")).toBe("Nothing staged");
    expect(nothingChangedWord(t, "commit")).toBe("These commits are the same");
    expect(nothingChangedWord(t, "branch")).toBe("Nothing changed since the base");
    expect(nothingChangedSentence(t, "uncommitted")).toBe("No uncommitted changes.");
    expect(nothingChangedSentence(t, "workspace")).toBe("No unstaged changes.");
    expect(nothingChangedSentence(t, "staged")).toBe("Nothing staged.");
    expect(nothingChangedSentence(t, "commit")).toBe("Nothing changed here.");
    expect(nothingChangedSentence(t, "branch")).toBe("Nothing changed here.");
  });

  it("knows every scope a history entry may hold", () => {
    expect([...REPO_DIFF_SCOPES].sort()).toEqual(["branch", "commit", "staged", "uncommitted", "workspace"]);
  });

  it("names a ref as a reader does, and tells one branch identity from another", () => {
    expect(refName("refs/heads/main")).toBe("main");
    expect(refName("refs/remotes/origin/feat/x")).toBe("origin/feat/x");
    expect(refName("refs/tags/v1")).toBe("refs/tags/v1");
    expect(refName("HEAD~2")).toBe("HEAD~2");
    expect(sameComparison(null, null)).toBe(true);
    expect(sameComparison(identity, null)).toBe(false);
    expect(sameComparison(identity, { ...identity })).toBe(true);
    expect(sameComparison(identity, { ...identity, merge_base_oid: "d".repeat(40) })).toBe(false);
    expect(sameComparison(identity, { ...identity, repository_root: "/elsewhere" })).toBe(false);
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
    expect(diffErrorMessage(t, new ApiError("/api/workspace/diff/file", 409, "the worktree no longer has that branch checked out", "worktree_moved", null, "head"))).toBe("The branch is no longer checked out in its worktree. Turn off “Show uncommitted changes” in View options or choose the branch again.");
    expect(diffErrorMessage(t, new Error("socket closed"))).toBe("Changes could not be loaded.");
    // the branch scope's own refusals, each told apart, and an older bridge that knows no such scope
    expect(diffErrorMessage(t, new ApiError("/api/workspace/diff/files", 409, "no commit yet", "unborn_head"))).toBe("The repository has no commits yet, so there is no branch to compare.");
    expect(diffErrorMessage(t, new ApiError("/api/workspace/diff/files", 409, "unrelated", "no_common_ancestor"))).toBe("That base shares no history with HEAD.");
    expect(diffErrorMessage(t, new ApiError("/api/workspace/diff/file", 409, "moved", "comparison_changed"))).toBe(comparisonChangedWord(t));
    expect(diffErrorMessage(t, new ApiError("/api/workspace/diff/file", 400, "shape", "invalid_comparison"))).toBe("This comparison is not one the list answered; refresh the list.");
    expect(diffErrorMessage(t, new ApiError("/api/workspace/diff/files", 400, "scope must be workspace, staged or commit", "invalid_scope"))).toBe("This PC's bridge cannot compare branches yet.");
    expect(diffErrorMessage(t, new ApiError("/api/workspace/diff/refs", 404, "Not found", "not_found"))).toBe("This PC's bridge cannot show changes yet.");
  });
});

describe("an older bridge without the uncommitted scope", () => {
  const pane: RepoComparison = { scope: "uncommitted", base: null, head: null, comparison: null };
  const worktree: RepoComparison = { scope: "uncommitted", base: "origin/next", head: "feat/x", comparison: null, mergeBase: true };
  const refusal = (code: string, status = 400) => new ApiError("/api/workspace/diff/files", status, "refused", code);

  it("asks what was wanted until a bridge refused it", () => {
    expect(bridgeAsk(pane, false)).toEqual({ asked: pane, standIn: null });
    expect(bridgeAsk(worktree, false)).toEqual({ asked: worktree, standIn: null });
  });

  it("asks the unstaged list for a folder and the commits for a branch once refused", () => {
    expect(bridgeAsk(pane, true)).toEqual({ asked: { scope: "workspace", base: null, head: null, comparison: null }, standIn: "unstaged" });
    expect(bridgeAsk(worktree, true)).toEqual({ asked: { scope: "commit", base: "origin/next", head: "feat/x", comparison: null, mergeBase: true }, standIn: "commits" });
  });

  it("leaves every comparison an older bridge knows as it is", () => {
    for (const known of [{ scope: "workspace", base: null, head: null, comparison: null }, { scope: "staged", base: null, head: null, comparison: null }, { scope: "commit", base: "main", head: "feat/x", comparison: null, mergeBase: true }] satisfies RepoComparison[]) {
      expect(bridgeAsk(known, true)).toEqual({ asked: known, standIn: null });
    }
  });

  it("counts only invalid_scope to an uncommitted ask as an older bridge", () => {
    expect(refusedUncommitted(refusal("invalid_scope"), pane)).toBe(true);
    expect(refusedUncommitted(refusal("invalid_scope"), worktree)).toBe(true);
    expect(refusedUncommitted(refusal("not_found", 404), pane)).toBe(false);
    expect(refusedUncommitted(refusal("worktree_moved", 409), worktree)).toBe(false);
    expect(refusedUncommitted(refusal("invalid_revision"), worktree)).toBe(false);
    expect(refusedUncommitted(refusal("invalid_scope"), { scope: "workspace", base: null, head: null, comparison: null })).toBe(false);
    expect(refusedUncommitted(refusal("invalid_scope"), { scope: "commit", base: "main", head: null, comparison: null, mergeBase: true })).toBe(false);
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
  const target: RepoDiffTarget = { machineId: "local", paneId: "p1", directory: null, scope: "commit", base: "a".repeat(40), head: "b".repeat(40), comparison: null, path: "src/a.ts", oldPath: "src/old.ts" };

  it("keeps the entry's other data and reads its own back", () => {
    const state = diffTargetState({ "ovis:file-preview": { path: "x" } }, target);
    expect(state["ovis:file-preview"]).toEqual({ path: "x" });
    expect(diffTargetFromState(state)).toEqual(target);
  });

  it("reads back an uncommitted entry and an entry saved before that scope existed", () => {
    const uncommitted: RepoDiffTarget = { ...target, scope: "uncommitted", base: null, head: null, oldPath: null };
    expect(diffTargetFromState(diffTargetState(null, uncommitted))).toEqual(uncommitted);
    const worktree: RepoDiffTarget = { ...target, directory: "/work/feat-x", scope: "uncommitted", base: "c".repeat(40), head: "feat/x" };
    expect(diffTargetFromState(diffTargetState(null, worktree))).toEqual(worktree);
    const saved = { "ovis:repo-diff": { machineId: "local", paneId: "p1", directory: null, scope: "workspace", base: null, head: null, path: "src/a.ts", oldPath: null } };
    expect(diffTargetFromState(saved)).toEqual({ machineId: "local", paneId: "p1", directory: null, scope: "workspace", base: null, head: null, comparison: null, path: "src/a.ts", oldPath: null });
  });

  it("ignores an entry of another shape", () => {
    expect(diffTargetFromState(null)).toBeNull();
    expect(diffTargetFromState({})).toBeNull();
    expect(diffTargetFromState({ "ovis:repo-diff": { machineId: "local", path: "a", scope: "branches" } })).toBeNull();
    expect(diffTargetFromState({ "ovis:repo-diff": { ...target, paneId: 7 } })).toBeNull();
    expect(diffTargetFromState({ "ovis:repo-diff": { ...target, path: undefined } })).toBeNull();
  });

  it("keeps a branch comparison's identity whole, and takes none of another shape", () => {
    const branch: RepoDiffTarget = { ...target, scope: "branch", base: "origin/main", head: null, comparison: identity };
    expect(diffTargetFromState(diffTargetState(null, branch))).toEqual(branch);
    // an entry from before the branch scope carries no identity: read as none
    const { comparison: _comparison, ...older } = target;
    expect(diffTargetFromState({ "ovis:repo-diff": older })).toEqual(target);
    expect(diffTargetFromState({ "ovis:repo-diff": { ...branch, comparison: "pinned" } })).toBeNull();
    expect(diffTargetFromState({ "ovis:repo-diff": { ...branch, comparison: { ...identity, merge_base_oid: 7 } } })).toBeNull();
    expect(diffTargetFromState({ "ovis:repo-diff": { ...branch, comparison: { head_oid: identity.head_oid } } })).toBeNull();
  });

  it("releases only the diff when another viewer takes its entry", () => {
    const state = diffTargetState({ marker: "kept" }, target);
    expect(diffTargetState(state, null)).toEqual({ marker: "kept" });
    expect(diffTargetFromState(state)).toEqual(target);
  });
});
