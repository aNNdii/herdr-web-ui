import type { RepoDiffRepository } from "./repo-diff.ts";

/** GET /api/workspace/diff/tree: every file of the repository, relative to its root, sorted; a capped list says so. */
export interface RepoDiffTree {
  repository: RepoDiffRepository;
  paths: string[];
  /** the files of `paths` git ignores, asked for with `ignored=1`; absent from an older server or bridge */
  ignored?: string[];
  /** a folder outside any repository, listed as it is (asked for with `folder=1`): `repository` names only its root */
  plain?: boolean;
  truncated: boolean;
  limits: { max_files: number; max_list_bytes: number };
}

/** A branch a review can compare, local or a remote's. */
export interface RepoBranch {
  /** as git shortens it: `main`, `feat/x`, `origin/next` */
  name: string;
  remote: boolean;
  /** the absolute folder (symlinks resolved) of the worktree it is checked out in; null when none is, or that worktree's folder is gone */
  worktree: string | null;
  /** its tip commit; absent from an older bridge, and when git names no commit for the ref */
  commit?: RepoBranchCommit;
}

/** A branch's tip commit, as `for-each-ref` reads it. */
export interface RepoBranchCommit {
  /** the full object id */
  hash: string;
  /** committer time, Unix seconds */
  time: number;
  /** the message's first paragraph on one line, cut at 200 characters; may be empty */
  subject: string;
}

/** GET /api/workspace/diff/branches */
export interface RepoBranchList {
  repository: RepoDiffRepository;
  /** every local branch, then the remote ones up to `limits.max_branches`, each group newest commit first; no `<remote>/HEAD` */
  branches: RepoBranch[];
  /** the branch `origin/HEAD` points at, else `main`, else `master` when that local branch exists; null otherwise */
  default_base: string | null;
  /** remote branches were left out at the cap; local ones never are */
  truncated: boolean;
  limits: { max_branches: number };
}
