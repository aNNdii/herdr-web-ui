import type { RepoBranchCommit, RepoBranchList, RepoDiffFileList } from "../../shared/protocol.ts";
import { ApiError } from "./api.ts";
import { folderName } from "./paneName.ts";
import { bridgeAsk, type RepoComparison, type StandIn } from "./repoDiff.ts";

/** What the review's two branch fields hold, as typed or chosen. */
export interface BranchPick {
  compare: string;
  base: string;
}

/** What the review is asked to compare, before the server resolved it. */
export type ReviewChoice =
  | { scope: "uncommitted" }
  | { scope: "staged" }
  | {
    scope: "branches";
    pick: BranchPick;
    /** compare's worktree while its uncommitted changes are included (`here`: the review's own); null otherwise */
    worktree: { path: string; here: boolean } | null;
  };

/** One branch the fields offer; `worktree.here` is the review's own worktree. */
export interface BranchChoice {
  name: string;
  remote: boolean;
  worktree: { name: string; path: string; here: boolean } | null;
  /** its tip commit; null from an older bridge, which names none */
  commit: RepoBranchCommit | null;
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

export type ReviewComparison =
  /** `worktree`: a branch's worktree compared from where it forked, its patches pinned to that commit */
  | { scope: "uncommitted"; worktree: { branch: string; mergeBase: string } | null }
  /** an older bridge's stand-in for `uncommitted` only */
  | { scope: "workspace" }
  | { scope: "staged" }
  | { scope: "branches"; branches: BranchComparison };

export function branchChoices(list: RepoBranchList): BranchChoices {
  return {
    branches: list.branches.map((branch) => ({
      name: branch.name,
      remote: branch.remote,
      worktree: branch.worktree === null
        ? null
        : { name: folderName(branch.worktree), path: branch.worktree, here: branch.worktree === list.repository.root },
      commit: branch.commit ?? null,
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

/** The worktree the local branch `compare` is checked out in, the review's own too; null without a list, a local branch or a worktree. */
export function worktreeOf(choices: BranchChoices | null, compare: string): BranchChoice["worktree"] {
  const name = compare.trim();
  const branch = choices?.branches.find((one) => !one.remote && one.name === name);
  return branch?.worktree ?? null;
}

/**
 * What the review asks and where: `folder` is the worktree read instead of the pane's, only while its uncommitted
 * changes are really asked and it is not the pane's own checkout; null keeps the pane's folder.
 */
export interface ReviewAsk {
  readonly folder: string | null;
  readonly list: RepoComparison;
  readonly standIn: StandIn | null;
}

/** The file list's query for a choice: what the bridge is asked (an older one its stand-in), from which folder. */
export function reviewAsk(choice: ReviewChoice, olderBridge: boolean): ReviewAsk {
  const { asked, standIn } = bridgeAsk(listQuery(choice), olderBridge);
  const worktree = choice.scope === "branches" ? choice.worktree : null;
  const folder = worktree === null || worktree.here || asked.scope !== "uncommitted" ? null : worktree.path;
  return { folder, list: asked, standIn };
}

/** The comparison wanted: branch names, compared from where compare forked off base, with its worktree's changes or without. */
function listQuery(choice: ReviewChoice): RepoComparison {
  switch (choice.scope) {
    case "uncommitted":
    case "staged":
      return { scope: choice.scope, base: null, head: null };
    case "branches": {
      const scope = choice.worktree === null ? "commit" : "uncommitted";
      return { scope, base: choice.pick.base.trim(), head: choice.pick.compare.trim(), mergeBase: true };
    }
  }
}

/** The comparison an answer resolved for what was asked (`asked`, a stand-in too); null until one for it arrived. */
export function reviewComparison(asked: RepoComparison, answer: RepoDiffFileList | null, choices: BranchChoices | null): ReviewComparison | null {
  if (answer === null || answer.scope !== asked.scope) return null;
  switch (asked.scope) {
    case "workspace":
    case "staged":
      return { scope: asked.scope };
    case "uncommitted": {
      if (asked.base === null) return answer.base === null ? { scope: "uncommitted", worktree: null } : null;
      const mergeBase = answer.merge_base ?? null;
      if (asked.head === null || answer.base === null || mergeBase === null) return null;
      return { scope: "uncommitted", worktree: { branch: asked.head, mergeBase } };
    }
    case "commit": {
      if (asked.base === null || asked.head === null || answer.base === null || answer.head === null) return null;
      const mergeBase = answer.merge_base ?? null;
      const compare = asked.head;
      // a worktree holds head's tip, not what a tip-to-tip diff of an older bridge shows
      const worktree = mergeBase === null ? null : worktreeOf(choices, compare)?.path ?? null;
      return {
        scope: "branches",
        branches: {
          head: { name: compare, hash: answer.head, worktree },
          base: { name: asked.base, hash: answer.base },
          mergeBase,
        },
      };
    }
  }
}

/**
 * A patch's query: two-dot from the merge base's hash, or tip to tip without one; a worktree's from the fork the list
 * resolved, naming the branch it must still have checked out.
 */
export function diffQueryOf(comparison: ReviewComparison): RepoComparison {
  switch (comparison.scope) {
    case "uncommitted": {
      const { worktree } = comparison;
      return worktree === null
        ? { scope: "uncommitted", base: null, head: null }
        : { scope: "uncommitted", base: worktree.mergeBase, head: worktree.branch };
    }
    case "workspace":
    case "staged":
      return { scope: comparison.scope, base: null, head: null };
    case "branches": {
      const { head, base, mergeBase } = comparison.branches;
      return { scope: "commit", base: mergeBase ?? base.hash, head: head.hash };
    }
  }
}

/**
 * Where a comment on a comparison's diff goes: on the file on disk where the new side is the working tree, on one of
 * a branch comparison's versions, or nowhere (the index's lines are neither).
 */
export type CommentPlace = { kind: "file" } | { kind: "branch"; branches: BranchComparison } | { kind: "none" };

export function commentPlace(comparison: ReviewComparison): CommentPlace {
  switch (comparison.scope) {
    case "uncommitted":
    case "workspace":
      return { kind: "file" };
    case "staged":
      return { kind: "none" };
    case "branches":
      return { kind: "branch", branches: comparison.branches };
  }
}

const REVISION_ERRORS: ReadonlySet<string> = new Set(["revision_not_found", "invalid_revision"]);

const FOLDER_ERRORS: ReadonlySet<string> = new Set(["invalid_cwd", "not_a_repository"]);

/**
 * Which field a refused comparison belongs under; null for a failure of neither name. An unreadable folder is
 * Compare's only while compare's worktree is read (`readingWorktree`); a moved worktree is the dialog's note.
 */
export function branchFieldError(error: unknown, readingWorktree: boolean): "compare" | "base" | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code === "no_merge_base") return "base";
  if (readingWorktree && error.code !== null && FOLDER_ERRORS.has(error.code)) return "compare";
  if (error.code === null || !REVISION_ERRORS.has(error.code)) return null;
  // an older server names no field
  return error.param === "head" ? "compare" : "base";
}
