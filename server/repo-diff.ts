import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

import type { RepoBranch, RepoBranchCommit, RepoBranchList, RepoDiffFile, RepoDiffFileList, RepoDiffFilePatch, RepoDiffRepository, RepoDiffScope, RepoDiffStatus, RepoDiffTree } from "../shared/protocol.ts";
import { errorResponse, jsonResponse } from "./http.ts";

/**
 * What changed in the repository a pane (or a named folder) sits in, read with git and never
 * written: the list of changed files, and one file's patch at a time. The two are separate reads
 * so a repository with one enormous change does not cost every other file its diff.
 *
 * Every git call is an argv array (no shell), with external diff drivers, textconv filters, the
 * fsmonitor hook, optional locks and pathspec magic switched off, a byte cap on what is read and
 * a deadline after which the process is killed. A patch is sent whole or not at all: one that
 * passes its cap is reported as unavailable, never cut in the middle of a hunk.
 *
 * It reads what this server's user can read in that repository, which is no more than the
 * terminal the same browser can already type `git diff` into.
 */

/** A list holds at most this many files; `truncated` and `total` say when there were more. */
export const REPO_DIFF_MAX_FILES = 2_000;
/** What one listing command may print before it is stopped (names, statuses, line counts). */
export const REPO_DIFF_MAX_LIST_BYTES = 2 * 1024 * 1024;
/** Every file of the repository a tree lists at most; `truncated` says when there were more. */
export const REPO_TREE_MAX_FILES = 50_000;
/** What the listing command may print before it is stopped (one path per NUL-terminated entry). */
export const REPO_TREE_MAX_LIST_BYTES = 16 * 1024 * 1024;
/** A folder outside any repository (`folder=1`) is listed this deep and this far at most; `truncated` says when there was more. */
export const FOLDER_TREE_MAX_FILES = 5_000;
export const FOLDER_TREE_MAX_DEPTH = 6;
/** Folders a plain folder's listing does not walk into: a repository's own data, and installed dependencies. */
const FOLDER_TREE_SKIPPED = new Set([".git", "node_modules"]);
/** One file's patch; a larger one is answered as `too_large` with no patch text. */
export const REPO_DIFF_MAX_PATCH_BYTES = 1024 * 1024;
/** Unchanged lines around each change, as `git diff` prints by default. */
export const REPO_DIFF_CONTEXT_LINES = 3;
/** How long one git process may run. */
export const REPO_DIFF_DEADLINE_MS = 10_000;
const MAX_PATH_BYTES = 4_096;
const SNIFF_BYTES = 8_192;

export interface RepoDiffOptions {
  /** the git to run (a stand-in, in tests) */
  git?: string;
  deadlineMs?: number;
  maxFiles?: number;
  maxListBytes?: number;
  maxPatchBytes?: number;
  /** the branch list's cap, `REPO_BRANCHES_MAX` by default */
  maxBranches?: number;
}

/** A refusal in the API's own words: it never carries git's stderr. `param` names the query parameter at fault, when one is. */
export class RepoDiffError extends Error {
  constructor(readonly code: string, message: string, readonly status: number, readonly param: "base" | "head" | null = null) { super(message); }
}

interface GitRun { code: number | null; stdout: string; overflow: boolean }

interface Context {
  git: string;
  deadlineMs: number;
  maxFiles: number;
  maxListBytes: number;
  maxPatchBytes: number;
}

function contextOf(options: RepoDiffOptions): Context {
  return {
    git: options.git ?? "git",
    deadlineMs: options.deadlineMs ?? REPO_DIFF_DEADLINE_MS,
    maxFiles: options.maxFiles ?? REPO_DIFF_MAX_FILES,
    maxListBytes: options.maxListBytes ?? REPO_DIFF_MAX_LIST_BYTES,
    maxPatchBytes: options.maxPatchBytes ?? REPO_DIFF_MAX_PATCH_BYTES,
  };
}

function gitEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    // a repository the server itself was started inside (a hook, a test runner) is not the one asked about
    if (value === undefined || name === "GIT_DIR" || name === "GIT_WORK_TREE" || name === "GIT_INDEX_FILE" || name === "GIT_EXTERNAL_DIFF" || name === "GIT_PAGER") continue;
    env[name] = value;
  }
  return { ...env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" };
}

/** One git process in `cwd`: stdout up to `maxBytes`, killed at the deadline or once it prints more. */
async function runGit(context: Context, cwd: string, args: string[], maxBytes: number): Promise<GitRun> {
  const argv = [context.git, "--no-pager", "--no-optional-locks", "--literal-pathspecs", "-c", "core.quotePath=false", "-c", "core.fsmonitor=false", "-c", "color.ui=never", "-C", cwd, ...args];
  let proc: Bun.Subprocess<"ignore", "pipe", "ignore">;
  try {
    proc = Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "ignore", env: gitEnvironment() });
  } catch {
    throw new RepoDiffError("git_unavailable", "git could not be started on this PC", 503);
  }
  const reader = proc.stdout.getReader();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGKILL");
    void reader.cancel().catch(() => undefined);
  }, context.deadlineMs);
  const chunks: Uint8Array[] = [];
  let size = 0;
  let overflow = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        overflow = true;
        const keep = value.byteLength - (size - maxBytes);
        if (keep > 0) chunks.push(value.subarray(0, keep));
        proc.kill("SIGKILL");
        void reader.cancel().catch(() => undefined);
        break;
      }
      chunks.push(value);
    }
    const code = await proc.exited;
    if (timedOut) throw new RepoDiffError("git_timeout", "git did not answer in time", 504);
    return { code: overflow ? null : code, stdout: Buffer.concat(chunks).toString("utf8"), overflow };
  } finally {
    clearTimeout(timer);
  }
}

async function repositoryOf(context: Context, cwd: string): Promise<RepoDiffRepository> {
  const top = await runGit(context, cwd, ["rev-parse", "--show-toplevel"], 16 * 1024);
  const root = top.stdout.replace(/\r?\n$/, "");
  if (top.code !== 0 || root === "") throw new RepoDiffError("not_a_repository", "that folder is not inside a git working tree", 409);
  const [branch, head] = await Promise.all([
    runGit(context, root, ["symbolic-ref", "--quiet", "--short", "HEAD"], 16 * 1024),
    runGit(context, root, ["rev-parse", "--quiet", "--verify", "HEAD^{commit}"], 1024),
  ]);
  const oid = head.code === 0 ? head.stdout.trim() : "";
  const name = branch.code === 0 ? branch.stdout.replace(/\r?\n$/, "") : "";
  return { root, branch: name === "" ? null : name, head: oid === "" ? null : oid, detached: name === "" && oid !== "", unborn: oid === "" };
}

const REVISION = /^[A-Za-z0-9][A-Za-z0-9._/~^@{}-]{0,199}$/;

async function resolveRevision(context: Context, root: string, name: "base" | "head", value: string): Promise<string> {
  if (!REVISION.test(value) || value.includes("..")) throw new RepoDiffError("invalid_revision", `${name} must name one commit: a hash, a branch, a tag or an expression such as HEAD~1`, 400, name);
  const parsed = await runGit(context, root, ["rev-parse", "--quiet", "--verify", "--end-of-options", `${value}^{commit}`], 1024);
  const oid = parsed.stdout.trim();
  if (parsed.code !== 0 || !/^[0-9a-f]{40,64}$/.test(oid)) throw new RepoDiffError("revision_not_found", `${name} names no commit in this repository`, 404, name);
  return oid;
}

/** The best common ancestor of two resolved commits, the first one git names when there are several. */
async function mergeBaseOf(context: Context, root: string, base: string, head: string): Promise<string> {
  const run = await runGit(context, root, ["merge-base", "--end-of-options", base, head], 1024);
  // git answers 1, printing nothing, when the two share no history
  if (run.code === 1) throw new RepoDiffError("no_merge_base", "base and head share no history", 409, "base");
  const oid = run.stdout.split("\n", 1)[0]!.trim();
  if (run.code !== 0 || !/^[0-9a-f]{40,64}$/.test(oid)) throw new RepoDiffError("git_failed", "git could not find where base and head forked", 500);
  return oid;
}

function scopeOf(value: string | null): RepoDiffScope {
  if (value === null || value === "" || value === "workspace") return "workspace";
  if (value === "staged" || value === "commit" || value === "uncommitted") return value;
  throw new RepoDiffError("invalid_scope", "scope must be workspace, staged, commit or uncommitted", 400);
}

/** A path inside the repository, as git names it: relative, forward slashes, no `..`. */
function repositoryPath(name: string, value: string): string {
  const segments = value.split("/");
  if (value === "" || value.includes("\0") || value.startsWith("/") || Buffer.byteLength(value) > MAX_PATH_BYTES || segments.some((segment) => segment === ".." || segment === "." || segment === "")) {
    throw new RepoDiffError("invalid_path", `${name} must be a file path relative to the repository root`, 400);
  }
  return value;
}

/** `mergeBase` is set only when `merge_base=1` asked for it: undefined keeps it out of the answer. */
interface Comparison {
  scope: RepoDiffScope;
  base: string | null;
  head: string | null;
  mergeBase?: string;
  args: string[];
  /** the new side is the working tree: `ls-files --others` joins the list and `ls-files -u` marks conflicts */
  newSideIsWorkingTree: boolean;
}

/** The empty tree's id in this repository's hash, named and never written: what an unborn HEAD is compared as. */
async function emptyTreeOf(context: Context, root: string): Promise<string> {
  // stdin is empty, so this hashes an empty tree; `--no-filters` keeps the repository's clean filters from running
  const run = await runGit(context, root, ["hash-object", "-t", "tree", "--no-filters", "--stdin"], 1024);
  const oid = run.stdout.trim();
  if (run.code !== 0 || !/^[0-9a-f]{40,64}$/.test(oid)) throw new RepoDiffError("git_failed", "git could not name the empty tree", 500);
  return oid;
}

/** A branch name as `head` may give it in `uncommitted`: only ever compared as text, so this keeps out what no branch is called. */
const MAX_BRANCH_BYTES = 255;
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * 409 worktree_moved unless the worktree at `root` still has `branch` checked out, as `refs/heads/<branch>` exactly
 * (`--short` would print `heads/x` beside a tag `x`). `branch` is compared as text and never handed to git.
 */
async function assertCheckedOut(context: Context, root: string, branch: string): Promise<void> {
  const run = await runGit(context, root, ["symbolic-ref", "--quiet", "HEAD"], 16 * 1024);
  if (run.code !== 0 || run.stdout.replace(/\r?\n$/, "") !== `refs/heads/${branch}`) {
    throw new RepoDiffError("worktree_moved", "that worktree no longer has head checked out", 409, "head");
  }
}

async function comparisonOf(context: Context, repository: RepoDiffRepository, params: URLSearchParams): Promise<Comparison> {
  const root = repository.root;
  const scope = scopeOf(params.get("scope"));
  const base = params.get("base");
  const head = params.get("head");
  const fromMergeBase = params.get("merge_base") === "1";
  if (scope === "uncommitted") {
    // a malformed ask is invalid_revision, never invalid_scope: to a client that one means an older bridge
    if (base === null) {
      if (head !== null) throw new RepoDiffError("invalid_revision", "head applies to scope=uncommitted only with a base", 400, "head");
      if (fromMergeBase) throw new RepoDiffError("invalid_revision", "merge_base needs a base revision", 400, "base");
      // HEAD as this request resolved it, so a commit made meanwhile cannot split the names from their counts
      const commit = repository.head ?? (await emptyTreeOf(context, root));
      return { scope, base: null, head: null, args: [commit], newSideIsWorkingTree: true };
    }
    if (head !== null && (head === "" || head.startsWith("-") || CONTROL.test(head) || Buffer.byteLength(head) > MAX_BRANCH_BYTES)) {
      throw new RepoDiffError("invalid_revision", "head must name one local branch", 400, "head");
    }
    // the branch list the ask was made from may be stale: the worktree must still be on that branch. The check and
    // base's lookup need nothing of each other, so both run at once; a moved worktree is named before a bad base
    const [checked, resolved] = await Promise.allSettled([
      head === null ? Promise.resolve() : assertCheckedOut(context, root, head),
      resolveRevision(context, root, "base", base),
    ]);
    if (checked.status === "rejected") throw checked.reason;
    if (resolved.status === "rejected") throw resolved.reason;
    const from = resolved.value;
    // the new side is the working tree, never a commit `head` names
    if (!fromMergeBase) return { scope, base: from, head: null, args: [from], newSideIsWorkingTree: true };
    // HEAD as this request resolved it: a worktree with no commit yet forked from nothing
    if (repository.head === null) throw new RepoDiffError("no_merge_base", "base and head share no history", 409, "base");
    const fork = await mergeBaseOf(context, root, from, repository.head);
    return { scope, base: from, head: null, mergeBase: fork, args: [fork], newSideIsWorkingTree: true };
  }
  if (scope !== "commit") {
    if (base !== null || head !== null) throw new RepoDiffError("invalid_revision", "base and head apply to scope=commit only", 400);
    if (fromMergeBase) throw new RepoDiffError("invalid_scope", "merge_base applies to scope=commit only", 400);
    return { scope, base: null, head: null, args: scope === "staged" ? ["--cached"] : [], newSideIsWorkingTree: scope === "workspace" };
  }
  if (base === null) throw new RepoDiffError("invalid_revision", "scope=commit needs a base revision", 400, "base");
  const [from, to] = await Promise.all([resolveRevision(context, root, "base", base), resolveRevision(context, root, "head", head ?? "HEAD")]);
  if (!fromMergeBase) return { scope, base: from, head: to, args: [from, to], newSideIsWorkingTree: false };
  // `base...head`, as a pull request shows it: what head changed since it forked from base
  const fork = await mergeBaseOf(context, root, from, to);
  return { scope, base: from, head: to, mergeBase: fork, args: [fork, to], newSideIsWorkingTree: false };
}

const DIFF_FLAGS = ["--no-color", "--no-ext-diff", "--no-textconv", "--find-renames", "--ignore-submodules=dirty", "--src-prefix=a/", "--dst-prefix=b/"];

const STATUS: Record<string, RepoDiffStatus> = { A: "added", D: "deleted", M: "modified", R: "renamed", C: "copied", T: "type_changed", U: "unmerged" };

/** The whole NUL-terminated fields of `-z` output: what follows the last NUL was cut short. */
function fields(output: string): string[] {
  const end = output.lastIndexOf("\0");
  return end < 0 ? [] : output.slice(0, end).split("\0");
}

interface Listing { files: RepoDiffFile[]; complete: boolean }

/** The paths with a merge conflict in the index, from `ls-files -u -z` (`<mode> <oid> <stage>\t<path>`, once per stage). */
function conflictedPaths(run: GitRun): Set<string> {
  const paths = new Set<string>();
  for (const entry of fields(run.stdout)) {
    const tab = entry.indexOf("\t");
    if (tab >= 0 && tab < entry.length - 1) paths.add(entry.slice(tab + 1));
  }
  return paths;
}

async function changedFiles(context: Context, root: string, comparison: Comparison, pathspec: string[]): Promise<Listing> {
  const tail = [...comparison.args, "--", ...pathspec];
  const none = Promise.resolve<GitRun>({ code: 0, stdout: "", overflow: false });
  const [names, counts, others, unmerged] = await Promise.all([
    runGit(context, root, ["diff", ...DIFF_FLAGS, "--name-status", "-z", ...tail], context.maxListBytes),
    runGit(context, root, ["diff", ...DIFF_FLAGS, "--numstat", "-z", ...tail], context.maxListBytes),
    comparison.newSideIsWorkingTree ? runGit(context, root, ["ls-files", "-z", "--others", "--exclude-standard", "--", ...pathspec], context.maxListBytes) : none,
    comparison.newSideIsWorkingTree ? runGit(context, root, ["ls-files", "-z", "-u", "--", ...pathspec], context.maxListBytes) : none,
  ]);
  for (const run of [names, counts, others, unmerged]) {
    if (!run.overflow && run.code !== 0) throw new RepoDiffError("git_failed", "git could not compare this repository", 500);
  }
  const stats = new Map<string, { additions: number | null; deletions: number | null; binary: boolean }>();
  const numbers = fields(counts.stdout);
  for (let index = 0; index < numbers.length; index += 1) {
    const [added, deleted, ...rest] = numbers[index]!.split("\t");
    if (added === undefined || deleted === undefined) break;
    let path = rest.join("\t");
    // a rename: the counts stand alone, then the old and the new name
    if (path === "") { path = numbers[index + 2] ?? ""; index += 2; }
    if (path === "") break;
    const binary = added === "-" || deleted === "-";
    stats.set(path, { additions: binary ? null : Number(added), deletions: binary ? null : Number(deleted), binary });
  }
  const found = new Map<string, RepoDiffFile>();
  const named = fields(names.stdout);
  for (let index = 0; index < named.length;) {
    const letter = named[index]![0] ?? "";
    const status = STATUS[letter];
    const paired = letter === "R" || letter === "C";
    const path = named[index + (paired ? 2 : 1)];
    if (status === undefined || path === undefined) break;
    // a conflict's counts are those of a combined diff, which no one is shown
    const stat = status === "unmerged" ? undefined : stats.get(path);
    const file: RepoDiffFile = { path, old_path: paired ? named[index + 1]! : null, status, additions: stat?.additions ?? null, deletions: stat?.deletions ?? null, binary: stat?.binary ?? null };
    // a conflicted file can be named twice; the conflict is what there is to say about it
    if (found.get(path)?.status !== "unmerged") found.set(path, file);
    index += paired ? 3 : 2;
  }
  // `git diff <commit>` names a conflicted file modified; the index says it is a conflict
  for (const path of conflictedPaths(unmerged)) {
    found.set(path, { path, old_path: null, status: "unmerged", additions: null, deletions: null, binary: null });
  }
  for (const path of fields(others.stdout)) {
    if (!found.has(path)) found.set(path, { path, old_path: null, status: "untracked", additions: null, deletions: null, binary: null });
  }
  const files = [...found.values()].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return { files, complete: !names.overflow && !others.overflow && !unmerged.overflow };
}

/**
 * A changed file's stamp: its modification time and size on disk, or that it is deleted or gone. A Viewed mark is kept
 * with the stamp it was set at, so a later write to the file (an agent's next change) takes the mark away.
 */
function fileStamp(root: string, file: RepoDiffFile): string {
  if (file.status === "deleted") return "deleted";
  try {
    const stat = lstatSync(join(root, file.path));
    return `${Math.round(stat.mtimeMs)}:${stat.size}`;
  } catch {
    return "missing";
  }
}

/** GET /api/workspace/diff/files */
export async function repoDiffFiles(cwd: string, params: URLSearchParams, options: RepoDiffOptions = {}): Promise<RepoDiffFileList> {
  const context = contextOf(options);
  const repository = await repositoryOf(context, cwd);
  const comparison = await comparisonOf(context, repository, params);
  const listing = await changedFiles(context, repository.root, comparison, []);
  const files = listing.files.slice(0, context.maxFiles);
  return {
    repository,
    scope: comparison.scope,
    base: comparison.base,
    head: comparison.head,
    ...(comparison.mergeBase === undefined ? {} : { merge_base: comparison.mergeBase }),
    // with `stamps=1` each file says when it last changed on disk, for a review's Viewed mark
    files: params.get("stamps") === "1" ? files.map((file) => ({ ...file, stamp: fileStamp(repository.root, file) })) : files,
    total: listing.complete ? listing.files.length : null,
    truncated: !listing.complete || listing.files.length > context.maxFiles,
    limits: { max_files: context.maxFiles, max_list_bytes: context.maxListBytes },
  };
}

/** Absent on Windows, which has no FIFOs either: there a link is caught by `lstat` before the open. */
const NO_FOLLOW = constants.O_NOFOLLOW as number | undefined;

/**
 * What an untracked path is on disk, without following a link out of the repository. The open itself refuses a link
 * and never waits on a FIFO, and the open file is what is looked at, so a path swapped after git listed it cannot
 * stall the server.
 */
function untrackedKind(path: string, maxBytes: number): "text" | "binary" | "too_large" | "unsupported" {
  let fd: number | null = null;
  try {
    if (NO_FOLLOW === undefined && lstatSync(path).isSymbolicLink()) return "unsupported";
    fd = openSync(path, constants.O_RDONLY | (NO_FOLLOW ?? 0) | ((constants.O_NONBLOCK as number | undefined) ?? 0));
    const stat = fstatSync(fd);
    if (!stat.isFile()) return "unsupported";
    if (stat.size > maxBytes) return "too_large";
    const buffer = Buffer.alloc(SNIFF_BYTES);
    return buffer.subarray(0, readSync(fd, buffer, 0, SNIFF_BYTES, 0)).includes(0) ? "binary" : "text";
  } catch {
    return "unsupported";
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/**
 * GET /api/workspace/diff/tree: every file the repository holds, tracked or not ignored (`git ls-files`),
 * for the review's file tree; with `ignored=1` the files git ignores too, named in `ignored`. Read only,
 * like the rest of this module.
 */
export async function repoDiffTree(cwd: string, params: URLSearchParams, options: RepoDiffOptions = {}): Promise<RepoDiffTree> {
  const context = contextOf(options);
  let repository: RepoDiffRepository;
  try {
    repository = await repositoryOf(context, cwd);
  } catch (error) {
    // with `folder=1` a folder outside any repository answers with its own files, as a plain folder
    if (error instanceof RepoDiffError && error.code === "not_a_repository" && params.get("folder") === "1") return folderTree(cwd);
    throw error;
  }
  const maxBytes = options.maxListBytes ?? REPO_TREE_MAX_LIST_BYTES;
  const listing = await runGit(context, repository.root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], maxBytes);
  if (!listing.overflow && listing.code !== 0) throw new RepoDiffError("git_failed", "git could not list the files of this repository", 503);
  // whole names only (a cut listing ends inside one), and each once: a conflicted file is listed once per stage
  const listed = new Set(fields(listing.stdout).filter((path) => path !== ""));
  let overflow = listing.overflow;
  const ignored = new Set<string>();
  if (params.get("ignored") === "1" && !overflow) {
    const extra = await runGit(context, repository.root, ["ls-files", "-z", "--others", "--ignored", "--exclude-standard"], Math.max(1, maxBytes - listing.stdout.length));
    if (!extra.overflow && extra.code !== 0) throw new RepoDiffError("git_failed", "git could not list the ignored files of this repository", 503);
    overflow = extra.overflow;
    for (const path of fields(extra.stdout)) if (path !== "" && !listed.has(path)) ignored.add(path);
  }
  const paths = [...listed, ...ignored].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)).slice(0, REPO_TREE_MAX_FILES);
  return {
    repository,
    paths,
    ...(params.get("ignored") === "1" ? { ignored: paths.filter((path) => ignored.has(path)) } : {}),
    truncated: overflow || listed.size + ignored.size > REPO_TREE_MAX_FILES,
    limits: { max_files: REPO_TREE_MAX_FILES, max_list_bytes: REPO_TREE_MAX_LIST_BYTES },
  };
}

/**
 * A folder outside any repository, as the review's tree shows it (`plain`): its files, walked breadth first to
 * `FOLDER_TREE_MAX_DEPTH` folders deep and `FOLDER_TREE_MAX_FILES` files at most, without `.git` and `node_modules`;
 * links are listed as files and never followed. Unreadable folders are left out.
 */
async function folderTree(root: string): Promise<RepoDiffTree> {
  const paths: string[] = [];
  let truncated = false;
  let level = [""];
  for (let depth = 0; depth <= FOLDER_TREE_MAX_DEPTH && level.length > 0 && !truncated; depth++) {
    const next: string[] = [];
    for (const folder of level) {
      const entries = await readdir(folder === "" ? root : join(root, folder), { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const path = folder === "" ? entry.name : `${folder}/${entry.name}`;
        if (entry.isDirectory()) {
          if (FOLDER_TREE_SKIPPED.has(entry.name)) continue;
          if (depth === FOLDER_TREE_MAX_DEPTH) truncated = true;
          else next.push(path);
        } else if (paths.length < FOLDER_TREE_MAX_FILES) paths.push(path);
        else truncated = true;
      }
      if (truncated && paths.length >= FOLDER_TREE_MAX_FILES) break;
    }
    level = next;
  }
  if (level.length > 0) truncated = true;
  return {
    repository: { root, branch: null, head: null, detached: false, unborn: false },
    paths: paths.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
    plain: true,
    truncated,
    limits: { max_files: FOLDER_TREE_MAX_FILES, max_list_bytes: REPO_TREE_MAX_LIST_BYTES },
  };
}

/** GET /api/workspace/diff/file */
export async function repoDiffFile(cwd: string, params: URLSearchParams, options: RepoDiffOptions = {}): Promise<RepoDiffFilePatch> {
  const context = contextOf(options);
  const path = repositoryPath("path", params.get("path") ?? "");
  const oldParam = params.get("old_path");
  const oldPath = oldParam === null || oldParam === "" ? null : repositoryPath("old_path", oldParam);
  const repository = await repositoryOf(context, cwd);
  const comparison = await comparisonOf(context, repository, params);
  const pathspec = oldPath !== null && oldPath !== path ? [oldPath, path] : [path];
  const listing = await changedFiles(context, repository.root, comparison, pathspec);
  const file = listing.files.find((candidate) => candidate.path === path);
  if (file === undefined) throw new RepoDiffError("not_found", "nothing changed at that path in this comparison", 404);
  if (oldPath !== null && file.old_path !== oldPath) throw new RepoDiffError("invalid_path", "old_path no longer belongs to this file's change; refresh the list", 400);

  const answer = (patch: string | null, unavailable: RepoDiffFilePatch["unavailable"], described: RepoDiffFile = file): RepoDiffFilePatch => ({
    repository,
    scope: comparison.scope,
    base: comparison.base,
    head: comparison.head,
    ...(comparison.mergeBase === undefined ? {} : { merge_base: comparison.mergeBase }),
    file: described,
    patch,
    unavailable,
    truncated: unavailable === "too_large",
    limits: { max_patch_bytes: context.maxPatchBytes, context_lines: REPO_DIFF_CONTEXT_LINES },
  });

  if (file.status === "unmerged") return answer(null, "unmerged");
  if (file.binary === true) return answer(null, "binary");

  let run: GitRun;
  if (file.status === "untracked") {
    const kind = untrackedKind(join(repository.root, path), context.maxPatchBytes);
    if (kind === "binary") return answer(null, "binary", { ...file, binary: true });
    if (kind !== "text") return answer(null, kind);
    // an untracked file has no index entry to compare with: it is shown as a new file, whole
    run = await runGit(context, repository.root, ["diff", "--no-index", ...DIFF_FLAGS, `-U${REPO_DIFF_CONTEXT_LINES}`, "--", "/dev/null", path], context.maxPatchBytes);
    if (!run.overflow && run.code !== 1 && run.code !== 0) throw new RepoDiffError("git_failed", "git could not read that file", 500);
  } else {
    run = await runGit(context, repository.root, ["diff", ...DIFF_FLAGS, `-U${REPO_DIFF_CONTEXT_LINES}`, ...comparison.args, "--", ...pathspec], context.maxPatchBytes);
    if (!run.overflow && run.code !== 0) throw new RepoDiffError("git_failed", "git could not compare that file", 500);
  }
  if (run.overflow) return answer(null, "too_large");
  // the file changed between the listing and this read, or git printed a form no patch reader takes
  if (run.stdout === "") throw new RepoDiffError("not_found", "nothing changed at that path in this comparison", 404);
  if (!run.stdout.startsWith("diff --git ")) return answer(null, "unsupported");
  return answer(run.stdout, null, file.status === "untracked" ? { ...file, binary: false } : file);
}

/** A review's branch list cut at this many entries; local branches are never left out. */
export const REPO_BRANCHES_MAX = 1_000;

/** A branch's commit subject is cut at this many characters. */
const BRANCH_SUBJECT_MAX = 200;

interface Ref {
  name: string;
  /** absent when the ref's tip is not a commit (a hand-written ref to a tag or a blob) */
  commit?: RepoBranchCommit;
}

/** The tip commit from `for-each-ref`'s fields; undefined when they name no commit (no committer time, or no object id). */
function refCommit(hash: string, time: string, subject: string): RepoBranchCommit | undefined {
  if (!/^[0-9a-f]{40,64}$/.test(hash) || !/^\d+$/.test(time)) return undefined;
  return { hash, time: Number(time), subject: Array.from(subject).slice(0, BRANCH_SUBJECT_MAX).join("") };
}

/**
 * The refs under `prefix` (`refs/heads/`, `refs/remotes/`), newest commit first, named without it, each with its tip
 * commit; symbolic refs (`origin/HEAD`) left out. git prints a subject on one line, so NUL-separated fields keep any text apart.
 */
async function refsUnder(context: Context, root: string, prefix: string): Promise<{ refs: Ref[]; complete: boolean }> {
  const format = "--format=%(refname)%00%(symref)%00%(objectname)%00%(committerdate:unix)%00%(contents:subject)";
  const run = await runGit(context, root, ["for-each-ref", "--sort=-committerdate", format, prefix], context.maxListBytes);
  if (!run.overflow && run.code !== 0) throw new RepoDiffError("git_failed", "git could not list the branches of this repository", 500);
  const lines = run.stdout.split("\n");
  // a cut listing ends inside its last line
  if (run.overflow || lines.at(-1) === "") lines.pop();
  const refs: Ref[] = [];
  for (const line of lines) {
    const [ref = "", symref = "", hash = "", time = "", subject = ""] = line.split("\0");
    if (symref !== "" || !ref.startsWith(prefix) || ref.length === prefix.length) continue;
    const commit = refCommit(hash, time, subject);
    refs.push({ name: ref.slice(prefix.length), ...(commit === undefined ? {} : { commit }) });
  }
  return { refs, complete: !run.overflow };
}

/** Each local branch checked out in a worktree, with that worktree's folder; a detached worktree, or one whose folder is gone, names none. */
async function worktreesOf(context: Context, root: string): Promise<Map<string, string>> {
  const run = await runGit(context, root, ["worktree", "list", "--porcelain"], context.maxListBytes);
  const found = new Map<string, string>();
  if (run.overflow || run.code !== 0) return found;
  for (const record of run.stdout.split("\n\n")) {
    let path: string | null = null;
    let branch: string | null = null;
    let prunable = false;
    for (const line of record.split("\n")) {
      if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
      else if (line.startsWith("branch refs/heads/")) branch = line.slice("branch refs/heads/".length);
      else if (line === "prunable" || line.startsWith("prunable ")) prunable = true;
    }
    if (path === null || branch === null || prunable) continue;
    try {
      found.set(branch, realpathSync(path));
    } catch {
      // gone since git last looked: no folder to name
    }
  }
  return found;
}

/**
 * GET /api/workspace/diff/branches: the branches a review can compare, read only. Every local branch is listed,
 * then the newest remote ones up to the cap, so a repository with many remotes never pushes a local branch out.
 */
export async function repoBranches(cwd: string, options: RepoDiffOptions = {}): Promise<RepoBranchList> {
  const context = contextOf(options);
  const maxBranches = options.maxBranches ?? REPO_BRANCHES_MAX;
  const repository = await repositoryOf(context, cwd);
  const [locals, remotes, worktrees, originHead] = await Promise.all([
    refsUnder(context, repository.root, "refs/heads/"),
    refsUnder(context, repository.root, "refs/remotes/"),
    worktreesOf(context, repository.root),
    runGit(context, repository.root, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"], 16 * 1024),
  ]);
  const room = Math.max(0, maxBranches - locals.refs.length);
  const branches: RepoBranch[] = [
    ...locals.refs.map(({ name, commit }) => ({ name, remote: false, worktree: worktrees.get(name) ?? null, ...(commit === undefined ? {} : { commit }) })),
    ...remotes.refs.slice(0, room).map(({ name, commit }) => ({ name, remote: true, worktree: null, ...(commit === undefined ? {} : { commit }) })),
  ];
  const target = originHead.code === 0 ? originHead.stdout.trim() : "";
  const local = new Set(locals.refs.map((ref) => ref.name));
  const defaultBase = target.startsWith("refs/remotes/") && target.length > "refs/remotes/".length ? target.slice("refs/remotes/".length) : local.has("main") ? "main" : local.has("master") ? "master" : null;
  return {
    repository,
    branches,
    default_base: defaultBase,
    truncated: !remotes.complete || remotes.refs.length > room,
    limits: { max_branches: maxBranches },
  };
}

/** The routes under `/api/workspace/diff/`, by their last path segment. */
export const REPO_DIFF_ROUTES = ["files", "file", "tree", "branches"] as const;
export type RepoDiffRoute = (typeof REPO_DIFF_ROUTES)[number];

async function routeBody(route: RepoDiffRoute, cwd: string, params: URLSearchParams, options: RepoDiffOptions): Promise<unknown> {
  switch (route) {
    case "files": return repoDiffFiles(cwd, params, options);
    case "file": return repoDiffFile(cwd, params, options);
    case "tree": return repoDiffTree(cwd, params, options);
    case "branches": return repoBranches(cwd, options);
  }
}

/** The HTTP answer of each route, with every refusal in the `{ error: { code, message, param? } }` envelope. */
export async function repoDiffResponse(route: RepoDiffRoute, cwd: string, params: URLSearchParams, options: RepoDiffOptions = {}): Promise<Response> {
  try {
    const body = await routeBody(route, cwd, params, options);
    return jsonResponse(body, 200, { "cache-control": "private, no-store" });
  } catch (error) {
    if (error instanceof RepoDiffError) return jsonResponse({ error: { code: error.code, message: error.message, ...(error.param === null ? {} : { param: error.param }) } }, error.status);
    return errorResponse(error);
  }
}
