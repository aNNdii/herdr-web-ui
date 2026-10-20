import { describe, expect, it } from "bun:test";

import type { RepoBranchList, RepoDiffFileList } from "../../shared/protocol.ts";
import { ApiError } from "./api.ts";
import {
  branchChoices, branchDefaults, branchFieldError, commentPlace, diffQueryOf, filterBranches, reviewAsk, reviewComparison,
  worktreeOf, type ReviewChoice, type ReviewComparison,
} from "./branchReview.ts";
import type { RepoComparison } from "./repoDiff.ts";

const ROOT = "/home/dev/repo";
const BASE = "b".repeat(40);
const HEAD = "a".repeat(40);
const FORK = "f".repeat(40);

const repository = (branch: string | null): RepoBranchList["repository"] => ({
  root: ROOT, branch, head: HEAD, detached: branch === null, unborn: false,
});

const list = (over: Partial<RepoBranchList> = {}): RepoBranchList => ({
  repository: repository("feat/x"),
  branches: [
    { name: "feat/x", remote: false, worktree: ROOT },
    { name: "main", remote: false, worktree: null },
    { name: "fix/pin", remote: false, worktree: "/home/dev/wt/fix-pin" },
    { name: "origin/next", remote: true, worktree: null },
  ],
  default_base: "origin/next",
  truncated: false,
  limits: { max_branches: 1000 },
  ...over,
});

const answer = (over: Partial<RepoDiffFileList> = {}): RepoDiffFileList => ({
  repository: repository("feat/x"),
  scope: "commit", base: BASE, head: HEAD, merge_base: FORK,
  files: [], total: 0, truncated: false,
  limits: { max_files: 1000, max_list_bytes: 1024 },
  ...over,
});

const WORKTREE = { path: "/home/dev/wt/fix-pin", here: false };

const branches = (compare: string, base: string, worktree: { path: string; here: boolean } | null = null): ReviewChoice =>
  ({ scope: "branches", pick: { compare, base }, worktree });

describe("branch choices", () => {
  it("names each worktree by its folder and the review's own as here", () => {
    const choices = branchChoices(list());
    expect(choices.current).toBe("feat/x");
    expect(choices.defaultBase).toBe("origin/next");
    expect(choices.truncated).toBe(false);
    expect(choices.branches.map((branch) => branch.name)).toEqual(["feat/x", "main", "fix/pin", "origin/next"]);
    expect(choices.branches[0]?.worktree).toEqual({ name: "repo", path: ROOT, here: true });
    expect(choices.branches[1]?.worktree).toBeNull();
    expect(choices.branches[2]?.worktree).toEqual({ name: "fix-pin", path: "/home/dev/wt/fix-pin", here: false });
    expect(choices.branches[3]?.remote).toBe(true);
  });

  it("passes each branch's tip commit through, none from an older bridge's answer", () => {
    const commit = { hash: HEAD, time: 1_700_000_000, subject: "Fix the pin" };
    const choices = branchChoices(list({ branches: [{ name: "fix/pin", remote: false, worktree: null, commit }, { name: "main", remote: false, worktree: null }] }));
    expect(choices.branches.map((branch) => branch.commit)).toEqual([commit, null]);
  });

  it("keeps the truncation and a detached HEAD", () => {
    const choices = branchChoices(list({ repository: repository(null), truncated: true, default_base: null }));
    expect(choices.current).toBeNull();
    expect(choices.truncated).toBe(true);
    expect(choices.defaultBase).toBeNull();
  });
});

describe("branch defaults", () => {
  it("compares the current branch with the default base", () => {
    expect(branchDefaults(branchChoices(list()), repository("feat/x"))).toEqual({ compare: "feat/x", base: "origin/next" });
  });

  it("compares HEAD when detached", () => {
    const choices = branchChoices(list({ repository: repository(null) }));
    expect(branchDefaults(choices, repository(null))).toEqual({ compare: "HEAD", base: "origin/next" });
  });

  it("leaves the base empty when the repository has no default base", () => {
    expect(branchDefaults(branchChoices(list({ default_base: null })), repository("feat/x"))).toEqual({ compare: "feat/x", base: "" });
  });

  it("falls back to HEAD and main without a list", () => {
    expect(branchDefaults(null, null)).toEqual({ compare: "HEAD", base: "main" });
    expect(branchDefaults(null, { branch: null })).toEqual({ compare: "HEAD", base: "main" });
    expect(branchDefaults(null, { branch: "feat/x" })).toEqual({ compare: "feat/x", base: "main" });
  });
});

describe("branch filter", () => {
  const all = branchChoices(list()).branches;

  it("keeps every branch, in order, for an empty query", () => {
    expect(filterBranches(all, "")).toEqual(all);
    expect(filterBranches(all, "   ")).toEqual(all);
  });

  it("matches any part of the name, ignoring case", () => {
    expect(filterBranches(all, "FEAT").map((branch) => branch.name)).toEqual(["feat/x"]);
    expect(filterBranches(all, " ne").map((branch) => branch.name)).toEqual(["origin/next"]);
    expect(filterBranches(all, "i").map((branch) => branch.name)).toEqual(["main", "fix/pin", "origin/next"]);
    expect(filterBranches(all, "nothing")).toEqual([]);
  });
});

describe("worktree of the compared branch", () => {
  const choices = branchChoices(list());

  it("names the folder a local branch is checked out in, the review's own too", () => {
    expect(worktreeOf(choices, "fix/pin")).toEqual({ name: "fix-pin", path: "/home/dev/wt/fix-pin", here: false });
    expect(worktreeOf(choices, "feat/x")).toEqual({ name: "repo", path: ROOT, here: true });
    expect(worktreeOf(choices, " fix/pin ")).toEqual({ name: "fix-pin", path: "/home/dev/wt/fix-pin", here: false });
  });

  it("names none for a remote branch, a branch checked out nowhere, a name not listed or no list", () => {
    const remote = branchChoices(list({ branches: [{ name: "origin/fix", remote: true, worktree: "/home/dev/wt/odd" }] }));
    expect(worktreeOf(remote, "origin/fix")).toBeNull();
    expect(worktreeOf(choices, "main")).toBeNull();
    expect(worktreeOf(choices, "origin/next")).toBeNull();
    expect(worktreeOf(choices, "feat/gone")).toBeNull();
    expect(worktreeOf(choices, "")).toBeNull();
    expect(worktreeOf(null, "fix/pin")).toBeNull();
  });
});

describe("review ask", () => {
  it("asks the pane's folder for its uncommitted and its staged changes", () => {
    expect(reviewAsk({ scope: "uncommitted" }, false)).toEqual({ folder: null, list: { scope: "uncommitted", base: null, head: null }, standIn: null });
    expect(reviewAsk({ scope: "staged" }, false)).toEqual({ folder: null, list: { scope: "staged", base: null, head: null }, standIn: null });
  });

  it("asks for the names from the merge base while uncommitted changes are left out", () => {
    expect(reviewAsk(branches(" feat/x ", " origin/next "), false))
      .toEqual({ folder: null, list: { scope: "commit", base: "origin/next", head: "feat/x", mergeBase: true }, standIn: null });
  });

  it("asks another worktree's folder for its changes since its branch forked", () => {
    expect(reviewAsk(branches(" fix/pin ", "origin/next", WORKTREE), false)).toEqual({
      folder: "/home/dev/wt/fix-pin",
      list: { scope: "uncommitted", base: "origin/next", head: "fix/pin", mergeBase: true },
      standIn: null,
    });
  });

  it("stays in the pane's folder for the pane's own worktree", () => {
    expect(reviewAsk(branches("feat/x", "origin/next", { path: ROOT, here: true }), false)).toEqual({
      folder: null,
      list: { scope: "uncommitted", base: "origin/next", head: "feat/x", mergeBase: true },
      standIn: null,
    });
  });

  it("asks an older bridge its stand-ins, from the pane's folder", () => {
    expect(reviewAsk({ scope: "uncommitted" }, true)).toEqual({ folder: null, list: { scope: "workspace", base: null, head: null }, standIn: "unstaged" });
    expect(reviewAsk(branches("fix/pin", "origin/next", WORKTREE), true))
      .toEqual({ folder: null, list: { scope: "commit", base: "origin/next", head: "fix/pin", mergeBase: true }, standIn: "commits" });
  });

  it("asks an older bridge what it knows as it is", () => {
    expect(reviewAsk({ scope: "staged" }, true)).toEqual(reviewAsk({ scope: "staged" }, false));
    expect(reviewAsk(branches("feat/x", "origin/next"), true)).toEqual(reviewAsk(branches("feat/x", "origin/next"), false));
  });

  it("asks the same for the same choice", () => {
    for (const older of [false, true]) {
      expect(reviewAsk(branches("fix/pin", "origin/next", { ...WORKTREE }), older)).toEqual(reviewAsk(branches("fix/pin", "origin/next", { ...WORKTREE }), older));
      expect(reviewAsk({ scope: "uncommitted" }, older)).toEqual(reviewAsk({ scope: "uncommitted" }, older));
    }
  });
});

describe("review comparison", () => {
  const choices = branchChoices(list());
  const commits: RepoComparison = { scope: "commit", base: "origin/next", head: "feat/x", mergeBase: true };
  const pane: RepoComparison = { scope: "uncommitted", base: null, head: null };
  const worktree: RepoComparison = { scope: "uncommitted", base: "origin/next", head: "fix/pin", mergeBase: true };
  const uncommitted = (over: Partial<RepoDiffFileList> = {}) => answer({ scope: "uncommitted", base: null, head: null, merge_base: undefined, ...over });

  it("freezes the answered hashes under the asked names, with the head's worktree", () => {
    expect(reviewComparison(commits, answer(), choices)).toEqual({
      scope: "branches",
      branches: {
        head: { name: "feat/x", hash: HEAD, worktree: ROOT },
        base: { name: "origin/next", hash: BASE },
        mergeBase: FORK,
      },
    });
  });

  it("names no worktree for a head checked out nowhere, or with no list", () => {
    expect(reviewComparison({ ...commits, head: "main" }, answer(), choices)).toMatchObject({ branches: { head: { worktree: null } } });
    expect(reviewComparison(commits, answer(), null)).toMatchObject({ branches: { head: { worktree: null } } });
  });

  it("names no worktree and no merge base for an older bridge", () => {
    const old = answer();
    delete old.merge_base;
    expect(reviewComparison(commits, old, choices)).toEqual({
      scope: "branches",
      branches: { head: { name: "feat/x", hash: HEAD, worktree: null }, base: { name: "origin/next", hash: BASE }, mergeBase: null },
    });
    expect(reviewComparison(commits, answer({ merge_base: null }), choices))
      .toMatchObject({ branches: { head: { worktree: null }, mergeBase: null } });
  });

  it("resolves the pane's uncommitted changes", () => {
    expect(reviewComparison(pane, uncommitted(), choices)).toEqual({ scope: "uncommitted", worktree: null });
  });

  it("pins a worktree's changes to the fork the answer resolved, under the asked branch", () => {
    expect(reviewComparison(worktree, uncommitted({ base: BASE, merge_base: FORK }), choices))
      .toEqual({ scope: "uncommitted", worktree: { branch: "fix/pin", mergeBase: FORK } });
  });

  it("resolves an older bridge's stand-in answers like any other", () => {
    const standIn = reviewAsk({ scope: "uncommitted" }, true).list;
    expect(reviewComparison(standIn, answer({ scope: "workspace", base: null, head: null }), choices)).toEqual({ scope: "workspace" });
    const commitsStandIn = reviewAsk(branches("fix/pin", "origin/next", WORKTREE), true).list;
    expect(reviewComparison(commitsStandIn, answer(), choices)).toEqual({
      scope: "branches",
      branches: { head: { name: "fix/pin", hash: HEAD, worktree: "/home/dev/wt/fix-pin" }, base: { name: "origin/next", hash: BASE }, mergeBase: FORK },
    });
  });

  it("passes the staged changes through", () => {
    expect(reviewComparison({ scope: "staged", base: null, head: null }, answer({ scope: "staged", base: null, head: null }), choices)).toEqual({ scope: "staged" });
  });

  it("is null until an answer for what was asked arrives", () => {
    expect(reviewComparison(commits, null, choices)).toBeNull();
    expect(reviewComparison(commits, answer({ scope: "workspace", base: null, head: null }), choices)).toBeNull();
    expect(reviewComparison(commits, uncommitted({ base: BASE, merge_base: FORK }), choices)).toBeNull();
    expect(reviewComparison(pane, answer(), choices)).toBeNull();
    expect(reviewComparison(pane, answer({ scope: "workspace", base: null, head: null }), choices)).toBeNull();
    expect(reviewComparison(pane, uncommitted({ base: BASE, merge_base: FORK }), choices)).toBeNull();
    expect(reviewComparison(worktree, uncommitted(), choices)).toBeNull();
    expect(reviewComparison(worktree, uncommitted({ base: BASE }), choices)).toBeNull();
    expect(reviewComparison(worktree, answer(), choices)).toBeNull();
    expect(reviewComparison({ scope: "workspace", base: null, head: null }, uncommitted(), choices)).toBeNull();
    expect(reviewComparison({ scope: "staged", base: null, head: null }, answer({ scope: "workspace", base: null, head: null }), choices)).toBeNull();
  });
});

describe("diff query", () => {
  const comparison = (mergeBase: string | null): ReviewComparison => ({
    scope: "branches",
    branches: { head: { name: "feat/x", hash: HEAD, worktree: null }, base: { name: "origin/next", hash: BASE }, mergeBase },
  });

  it("asks two-dot from the merge base's hash", () => {
    expect(diffQueryOf(comparison(FORK))).toEqual({ scope: "commit", base: FORK, head: HEAD });
  });

  it("asks from tip to tip without a merge base", () => {
    expect(diffQueryOf(comparison(null))).toEqual({ scope: "commit", base: BASE, head: HEAD });
  });

  it("asks a worktree's patches from the fork the list resolved, for the branch it must still have checked out", () => {
    expect(diffQueryOf({ scope: "uncommitted", worktree: { branch: "fix/pin", mergeBase: FORK } }))
      .toEqual({ scope: "uncommitted", base: FORK, head: "fix/pin" });
  });

  it("asks for the uncommitted, unstaged and staged changes as they are", () => {
    expect(diffQueryOf({ scope: "uncommitted", worktree: null })).toEqual({ scope: "uncommitted", base: null, head: null });
    expect(diffQueryOf({ scope: "workspace" })).toEqual({ scope: "workspace", base: null, head: null });
    expect(diffQueryOf({ scope: "staged" })).toEqual({ scope: "staged", base: null, head: null });
  });
});

describe("comment place", () => {
  const branchComparison = { head: { name: "feat/x", hash: HEAD, worktree: null }, base: { name: "origin/next", hash: BASE }, mergeBase: FORK };

  it("puts comments on the file on disk wherever the new side is the working tree", () => {
    expect(commentPlace({ scope: "uncommitted", worktree: null })).toEqual({ kind: "file" });
    expect(commentPlace({ scope: "uncommitted", worktree: { branch: "fix/pin", mergeBase: FORK } })).toEqual({ kind: "file" });
    expect(commentPlace({ scope: "workspace" })).toEqual({ kind: "file" });
  });

  it("puts comments on a branch comparison's versions", () => {
    expect(commentPlace({ scope: "branches", branches: branchComparison })).toEqual({ kind: "branch", branches: branchComparison });
  });

  it("takes none on the staged changes", () => {
    expect(commentPlace({ scope: "staged" })).toEqual({ kind: "none" });
  });
});

describe("branch field error", () => {
  const refused = (code: string, param: string | null = null, status = 404) =>
    new ApiError("/api/workspace/diff/files", status, "refused", code, param);
  const either = [false, true];

  it("puts an error under the field the server names", () => {
    for (const worktree of either) {
      expect(branchFieldError(refused("revision_not_found", "head"), worktree)).toBe("compare");
      expect(branchFieldError(refused("revision_not_found", "base"), worktree)).toBe("base");
      expect(branchFieldError(refused("invalid_revision", "head", 400), worktree)).toBe("compare");
      expect(branchFieldError(refused("invalid_revision", "base", 400), worktree)).toBe("base");
    }
  });

  it("puts a missing merge base under the base", () => {
    for (const worktree of either) {
      expect(branchFieldError(refused("no_merge_base", null, 409), worktree)).toBe("base");
      expect(branchFieldError(refused("no_merge_base", "base", 409), worktree)).toBe("base");
    }
  });

  it("puts a revision error from an older server under the base", () => {
    for (const worktree of either) {
      expect(branchFieldError(refused("revision_not_found"), worktree)).toBe("base");
      expect(branchFieldError(refused("invalid_revision", null, 400), worktree)).toBe("base");
    }
  });

  it("puts an unreadable worktree folder under Compare, only while a worktree is read", () => {
    expect(branchFieldError(refused("invalid_cwd", null, 400), true)).toBe("compare");
    expect(branchFieldError(refused("not_a_repository", null, 409), true)).toBe("compare");
    expect(branchFieldError(refused("invalid_cwd", null, 400), false)).toBeNull();
    expect(branchFieldError(refused("not_a_repository", null, 409), false)).toBeNull();
  });

  it("leaves a moved worktree to its note and other failures to the list", () => {
    for (const worktree of either) {
      expect(branchFieldError(refused("worktree_moved", "head", 409), worktree)).toBeNull();
      expect(branchFieldError(refused("git_timeout", null, 504), worktree)).toBeNull();
      expect(branchFieldError(new Error("offline"), worktree)).toBeNull();
      expect(branchFieldError(null, worktree)).toBeNull();
    }
  });
});
