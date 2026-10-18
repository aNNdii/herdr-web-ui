import { describe, expect, it } from "bun:test";

import type { RepoBranchList, RepoDiffFileList } from "../../shared/protocol.ts";
import { ApiError } from "./api.ts";
import {
  branchChoices, branchDefaults, branchFieldError, branchHeading, diffQueryOf, filterBranches, listQuery, reviewComparison,
  type ReviewChoice,
} from "./branchReview.ts";

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

const branches = (compare: string, base: string): ReviewChoice => ({ scope: "branches", pick: { compare, base } });

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

describe("list query", () => {
  it("asks for the names from the merge base", () => {
    expect(listQuery(branches(" feat/x ", "origin/next"))).toEqual({ scope: "commit", base: "origin/next", head: "feat/x", mergeBase: true });
  });

  it("asks for the working tree and the staged changes as they are", () => {
    expect(listQuery({ scope: "workspace" })).toEqual({ scope: "workspace", base: null, head: null });
    expect(listQuery({ scope: "staged" })).toEqual({ scope: "staged", base: null, head: null });
  });
});

describe("review comparison", () => {
  const choices = branchChoices(list());

  it("freezes the answered hashes under the chosen names, with the head's worktree", () => {
    expect(reviewComparison(branches("feat/x", "origin/next"), answer(), choices)).toEqual({
      scope: "branches",
      branches: {
        head: { name: "feat/x", hash: HEAD, worktree: ROOT },
        base: { name: "origin/next", hash: BASE },
        mergeBase: FORK,
      },
    });
  });

  it("names no worktree for a head checked out nowhere, or with no list", () => {
    expect(reviewComparison(branches("main", "origin/next"), answer(), choices)).toMatchObject({ branches: { head: { worktree: null } } });
    expect(reviewComparison(branches("feat/x", "origin/next"), answer(), null)).toMatchObject({ branches: { head: { worktree: null } } });
  });

  it("names no worktree and no merge base for an older bridge", () => {
    const old = answer();
    delete old.merge_base;
    expect(reviewComparison(branches("feat/x", "origin/next"), old, choices)).toEqual({
      scope: "branches",
      branches: { head: { name: "feat/x", hash: HEAD, worktree: null }, base: { name: "origin/next", hash: BASE }, mergeBase: null },
    });
    expect(reviewComparison(branches("feat/x", "origin/next"), answer({ merge_base: null }), choices))
      .toMatchObject({ branches: { head: { worktree: null }, mergeBase: null } });
  });

  it("is null until an answer for that choice arrives", () => {
    expect(reviewComparison(branches("feat/x", "origin/next"), null, choices)).toBeNull();
    expect(reviewComparison(branches("feat/x", "origin/next"), answer({ scope: "workspace", base: null, head: null }), choices)).toBeNull();
    expect(reviewComparison({ scope: "workspace" }, answer(), choices)).toBeNull();
    expect(reviewComparison({ scope: "staged" }, answer({ scope: "workspace", base: null, head: null }), choices)).toBeNull();
  });

  it("passes the working tree and the staged changes through", () => {
    expect(reviewComparison({ scope: "workspace" }, answer({ scope: "workspace", base: null, head: null }), choices)).toEqual({ scope: "workspace" });
    expect(reviewComparison({ scope: "staged" }, answer({ scope: "staged", base: null, head: null }), choices)).toEqual({ scope: "staged" });
  });
});

describe("diff query", () => {
  const comparison = (mergeBase: string | null) => ({
    scope: "branches" as const,
    branches: { head: { name: "feat/x", hash: HEAD, worktree: null }, base: { name: "origin/next", hash: BASE }, mergeBase },
  });

  it("asks two-dot from the merge base's hash", () => {
    expect(diffQueryOf(comparison(FORK))).toEqual({ scope: "commit", base: FORK, head: HEAD });
  });

  it("asks from tip to tip without a merge base", () => {
    expect(diffQueryOf(comparison(null))).toEqual({ scope: "commit", base: BASE, head: HEAD });
  });

  it("asks for the working tree and the staged changes", () => {
    expect(diffQueryOf({ scope: "workspace" })).toEqual({ scope: "workspace", base: null, head: null });
    expect(diffQueryOf({ scope: "staged" })).toEqual({ scope: "staged", base: null, head: null });
  });
});

describe("branch heading", () => {
  const pick = { compare: "feat/x", base: "origin/next" };

  it("reads like the fields, compare first", () => {
    expect(branchHeading(pick, null)).toBe("feat/x → origin/next");
    expect(branchHeading(pick, { head: { name: "feat/x", hash: HEAD, worktree: null }, base: { name: "origin/next", hash: BASE }, mergeBase: FORK }))
      .toBe("feat/x → origin/next");
  });

  it("reads as tip to tip for an older bridge", () => {
    expect(branchHeading(pick, { head: { name: "feat/x", hash: HEAD, worktree: null }, base: { name: "origin/next", hash: BASE }, mergeBase: null }))
      .toBe("origin/next..feat/x");
  });
});

describe("branch field error", () => {
  const refused = (code: string, param: string | null = null, status = 404) =>
    new ApiError("/api/workspace/diff/files", status, "refused", code, param);

  it("puts an error under the field the server names", () => {
    expect(branchFieldError(refused("revision_not_found", "head"))).toBe("compare");
    expect(branchFieldError(refused("revision_not_found", "base"))).toBe("base");
    expect(branchFieldError(refused("invalid_revision", "head", 400))).toBe("compare");
  });

  it("puts a missing merge base under the base", () => {
    expect(branchFieldError(refused("no_merge_base", null, 409))).toBe("base");
    expect(branchFieldError(refused("no_merge_base", "base", 409))).toBe("base");
  });

  it("puts a revision error from an older server under the base", () => {
    expect(branchFieldError(refused("revision_not_found"))).toBe("base");
    expect(branchFieldError(refused("invalid_revision", null, 400))).toBe("base");
  });

  it("leaves other failures to the list", () => {
    expect(branchFieldError(refused("not_a_repository", null, 409))).toBeNull();
    expect(branchFieldError(refused("git_timeout", null, 504))).toBeNull();
    expect(branchFieldError(new Error("offline"))).toBeNull();
    expect(branchFieldError(null)).toBeNull();
  });
});
