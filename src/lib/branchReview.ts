import type { RepoBranchList, RepoDiffFileList } from "../../shared/protocol.ts";
import { ApiError } from "./api.ts";
import { folderName } from "./paneName.ts";
import type { RepoComparison } from "./repoDiff.ts";

/** What the review's two branch fields hold, as typed or chosen. */
export interface BranchPick {
  compare: string;
  base: string;
}

/** What the review is asked to compare, before the server resolved it. */
export type ReviewChoice = { scope: "workspace" } | { scope: "staged" } | { scope: "branches"; pick: BranchPick };

/** One branch the fields offer; `worktree.here` is the review's own worktree. */
export interface BranchChoice {
  name: string;
  remote: boolean;
  worktree: { name: string; path: string; here: boolean } | null;
}

export interface BranchChoices {
  branches: BranchChoice[];
  defaultBase: string | null;
  /** the review repository's checked-out branch; null on a detached HEAD */
  current: string | null;
  truncated: boolean;
}

/** A branch comparison resolved once: every patch and comment uses these hashes, the UI the names. */
export interface BranchComparison {
  /** `worktree`: where head is checked out, only when the server compared from the merge base */
  head: { name: string; hash: string; worktree: string | null };
  /** base's tip */
  base: { name: string; hash: string };
  /** null: an older bridge, which compares the tips */
  mergeBase: string | null;
}

export type ReviewComparison = { scope: "workspace" } | { scope: "staged" } | { scope: "branches"; branches: BranchComparison };

export function branchChoices(list: RepoBranchList): BranchChoices {
  return {
    branches: list.branches.map((branch) => ({
      name: branch.name,
      remote: branch.remote,
      worktree: branch.worktree === null
        ? null
        : { name: folderName(branch.worktree), path: branch.worktree, here: branch.worktree === list.repository.root },
    })),
    defaultBase: list.default_base,
    current: list.repository.branch,
    truncated: list.truncated,
  };
}

/**
 * The fields' first values: the current branch against the default base. Without a list (an older bridge, or one
 * still loading) the branch the tree names against main, and HEAD where the tree names none (detached, or not there yet).
 */
export function branchDefaults(choices: BranchChoices | null, repository: { branch: string | null } | null): BranchPick {
  const compare = (choices === null ? repository?.branch : choices.current) ?? "HEAD";
  return { compare, base: choices === null ? "main" : choices.defaultBase ?? "" };
}

/** The branches whose name holds the query, ignoring case; every branch for an empty one. */
export function filterBranches(branches: readonly BranchChoice[], query: string): BranchChoice[] {
  const wanted = query.trim().toLowerCase();
  return wanted === "" ? [...branches] : branches.filter((branch) => branch.name.toLowerCase().includes(wanted));
}

/** The file list's query: branch names, compared from where compare forked off base. */
export function listQuery(choice: ReviewChoice): RepoComparison {
  switch (choice.scope) {
    case "workspace":
    case "staged":
      return { scope: choice.scope, base: null, head: null };
    case "branches":
      return { scope: "commit", base: choice.pick.base.trim(), head: choice.pick.compare.trim(), mergeBase: true };
  }
}

/** The comparison an answer resolved for this choice; null until one for its scope arrived. */
export function reviewComparison(choice: ReviewChoice, answer: RepoDiffFileList | null, choices: BranchChoices | null): ReviewComparison | null {
  if (answer === null) return null;
  switch (choice.scope) {
    case "workspace":
    case "staged":
      return answer.scope === choice.scope ? { scope: choice.scope } : null;
    case "branches": {
      if (answer.scope !== "commit" || answer.base === null || answer.head === null) return null;
      const mergeBase = answer.merge_base ?? null;
      const compare = choice.pick.compare.trim();
      // a worktree holds head's tip, not what a tip-to-tip diff of an older bridge shows
      const worktree = mergeBase === null ? null : choices?.branches.find((branch) => branch.name === compare)?.worktree?.path ?? null;
      return {
        scope: "branches",
        branches: {
          head: { name: compare, hash: answer.head, worktree },
          base: { name: choice.pick.base.trim(), hash: answer.base },
          mergeBase,
        },
      };
    }
  }
}

/** A patch's query: two-dot from the merge base's hash, or tip to tip without one. */
export function diffQueryOf(comparison: ReviewComparison): RepoComparison {
  switch (comparison.scope) {
    case "workspace":
    case "staged":
      return { scope: comparison.scope, base: null, head: null };
    case "branches": {
      const { head, base, mergeBase } = comparison.branches;
      return { scope: "commit", base: mergeBase ?? base.hash, head: head.hash };
    }
  }
}

/** The dialog's heading: compare toward base, or `base..compare` when an older bridge compared the tips. */
export function branchHeading(pick: BranchPick, comparison: BranchComparison | null): string {
  const compare = pick.compare.trim();
  const base = pick.base.trim();
  return comparison !== null && comparison.mergeBase === null ? `${base}..${compare}` : `${compare} → ${base}`;
}

const REVISION_ERRORS: ReadonlySet<string> = new Set(["revision_not_found", "invalid_revision"]);

/** Which field a refused comparison belongs under; null for a failure of neither name. */
export function branchFieldError(error: unknown): "compare" | "base" | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code === "no_merge_base") return "base";
  if (error.code === null || !REVISION_ERRORS.has(error.code)) return null;
  // an older server names no field
  return error.param === "head" ? "compare" : "base";
}
