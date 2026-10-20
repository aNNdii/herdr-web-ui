import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePatchFiles } from "@pierre/diffs";

import type { ApiError, RepoBranchList, RepoDiffFileList, RepoDiffFilePatch } from "../shared/protocol.ts";
import { DeviceStore } from "./devices.ts";
import { createServer } from "./index.ts";
import { REPO_BRANCHES_MAX, REPO_DIFF_CONTEXT_LINES, REPO_DIFF_MAX_FILES, REPO_DIFF_MAX_LIST_BYTES, REPO_DIFF_MAX_PATCH_BYTES, repoBranches, repoDiffFile, repoDiffFiles, repoDiffResponse } from "./repo-diff.ts";

/**
 * Real git repositories in a temp folder: the routes are only as right as what git prints, so a
 * stand-in git would prove nothing here. The developer's own git configuration is kept out, for
 * the fixtures and for the code under test alike.
 */
process.env["GIT_CONFIG_GLOBAL"] = "/dev/null";
process.env["GIT_CONFIG_NOSYSTEM"] = "1";

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "herdr-repo-diff-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  return result.stdout.toString();
}

function repository(name: string): string {
  const root = join(scratch, name);
  mkdirSync(root);
  git(root, "init", "-q", "-b", "main");
  return root;
}

const query = (values: Record<string, string> = {}) => new URLSearchParams(values);
const lines = (count: number, prefix = "line") => Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}\n`).join("");
/** What Pierre makes of a patch: the parser the diff view uses, told to throw on anything malformed. */
const parsed = (patch: string | null) => parsePatchFiles(patch ?? "", undefined, true).flatMap((entry) => entry.files);

const UNICODE = "dir with space/ünï 文件.txt";

describe("workspace and staged changes", () => {
  let root: string;
  beforeAll(() => {
    root = repository("changes");
    mkdirSync(join(root, "dir with space"));
    writeFileSync(join(root, "keep.txt"), "a\nb\nc\n");
    writeFileSync(join(root, "gone.txt"), "going\n");
    writeFileSync(join(root, "moved-from.txt"), lines(12));
    writeFileSync(join(root, "pic.bin"), new Uint8Array([0, 1, 2, 3, 0, 255]));
    writeFileSync(join(root, UNICODE), "eins\n");
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "first");
    // staged: a rename with an edit, and a new file
    git(root, "mv", "moved-from.txt", "moved-to.txt");
    writeFileSync(join(root, "moved-to.txt"), lines(12).replace("line 3\n", "line three\n"));
    writeFileSync(join(root, "staged-new.txt"), "fresh\n");
    git(root, "add", "moved-to.txt", "staged-new.txt");
    // unstaged
    writeFileSync(join(root, "keep.txt"), "a\nB\nc\nd\n");
    rmSync(join(root, "gone.txt"));
    writeFileSync(join(root, "pic.bin"), new Uint8Array([9, 0, 9, 0]));
    writeFileSync(join(root, UNICODE), "zwei\n");
    writeFileSync(join(root, "new file.txt"), "one\ntwo\n");
    writeFileSync(join(root, "blob.bin"), new Uint8Array([1, 0, 2, 0]));
  });

  it("lists unstaged and untracked files with status, counts and the repository they are in", async () => {
    const list = await repoDiffFiles(root, query());
    expect(list.repository).toEqual({ root, branch: "main", head: git(root, "rev-parse", "HEAD").trim(), detached: false, unborn: false });
    expect(list).toMatchObject({ scope: "workspace", base: null, head: null, total: 6, truncated: false, limits: { max_files: REPO_DIFF_MAX_FILES, max_list_bytes: REPO_DIFF_MAX_LIST_BYTES } });
    expect(list.files).toEqual([
      { path: "blob.bin", old_path: null, status: "untracked", additions: null, deletions: null, binary: null },
      { path: UNICODE, old_path: null, status: "modified", additions: 1, deletions: 1, binary: false },
      { path: "gone.txt", old_path: null, status: "deleted", additions: 0, deletions: 1, binary: false },
      { path: "keep.txt", old_path: null, status: "modified", additions: 2, deletions: 1, binary: false },
      { path: "new file.txt", old_path: null, status: "untracked", additions: null, deletions: null, binary: null },
      { path: "pic.bin", old_path: null, status: "modified", additions: null, deletions: null, binary: true },
    ]);
  });

  it("answers the same list from a folder below the repository's top", async () => {
    const list = await repoDiffFiles(join(root, "dir with space"), query());
    expect(list.repository.root).toBe(root);
    expect(list.files.map((file) => file.path)).toContain("keep.txt");
  });

  it("lists staged files apart, a rename with where it came from", async () => {
    const list = await repoDiffFiles(root, query({ scope: "staged" }));
    expect(list.files).toEqual([
      { path: "moved-to.txt", old_path: "moved-from.txt", status: "renamed", additions: 1, deletions: 1, binary: false },
      { path: "staged-new.txt", old_path: null, status: "added", additions: 1, deletions: 0, binary: false },
    ]);
  });

  it("gives each text file one whole patch Pierre parses: edit, deletion, untracked, addition, rename", async () => {
    const edit = await repoDiffFile(root, query({ path: "keep.txt" }));
    expect(edit).toMatchObject({ unavailable: null, truncated: false, file: { path: "keep.txt", status: "modified", additions: 2, deletions: 1 }, limits: { max_patch_bytes: REPO_DIFF_MAX_PATCH_BYTES, context_lines: REPO_DIFF_CONTEXT_LINES } });
    expect(edit.patch).toStartWith("diff --git a/keep.txt b/keep.txt\n");
    expect(parsed(edit.patch).map((file) => [file.name, file.type, file.hunks.length])).toEqual([["keep.txt", "change", 1]]);

    const deleted = await repoDiffFile(root, query({ path: "gone.txt" }));
    expect(parsed(deleted.patch).map((file) => [file.name, file.type])).toEqual([["gone.txt", "deleted"]]);

    const untracked = await repoDiffFile(root, query({ path: "new file.txt" }));
    expect(untracked.file).toEqual({ path: "new file.txt", old_path: null, status: "untracked", additions: null, deletions: null, binary: false });
    expect(parsed(untracked.patch).map((file) => [file.name, file.type, file.additionLines])).toEqual([["new file.txt", "new", ["one\n", "two\n"]]]);

    const added = await repoDiffFile(root, query({ scope: "staged", path: "staged-new.txt" }));
    expect(parsed(added.patch).map((file) => [file.name, file.type])).toEqual([["staged-new.txt", "new"]]);

    const renamed = await repoDiffFile(root, query({ scope: "staged", path: "moved-to.txt", old_path: "moved-from.txt" }));
    expect(renamed.file).toMatchObject({ status: "renamed", old_path: "moved-from.txt" });
    expect(parsed(renamed.patch).map((file) => [file.name, file.prevName, file.type])).toEqual([["moved-to.txt", "moved-from.txt", "rename-changed"]]);
  });

  it("keeps a path with spaces and non-ASCII letters as it is, in the list and in the patch", async () => {
    const answer = await repoDiffFile(root, query({ path: UNICODE }));
    expect(answer.file.path).toBe(UNICODE);
    expect(answer.patch).toStartWith(`diff --git a/${UNICODE} b/${UNICODE}\n`);
    expect(parsed(answer.patch).map((file) => [file.name, file.deletionLines, file.additionLines])).toEqual([[UNICODE, ["eins\n"], ["zwei\n"]]]);
  });

  it("says a binary file is binary instead of sending a patch, tracked or not", async () => {
    for (const path of ["pic.bin", "blob.bin"]) {
      const answer = await repoDiffFile(root, query({ path }));
      expect(answer).toMatchObject({ patch: null, unavailable: "binary", truncated: false, file: { path, binary: true } });
    }
  });

  it("refuses a path that is not one inside the repository, and one where nothing changed", async () => {
    for (const path of ["", "../outside.txt", "/etc/hosts", "a//b", "dir/../keep.txt", "./keep.txt", "keep.txt\0"]) {
      await expect(repoDiffFile(root, query({ path }))).rejects.toMatchObject({ code: "invalid_path", status: 400 });
    }
    await expect(repoDiffFile(root, query({ path: "keep.txt", old_path: "../x" }))).rejects.toMatchObject({ code: "invalid_path", status: 400 });
    // pathspec magic and globs are read as plain names
    for (const path of ["staged-new.txt", "*.txt", ":(glob)**", ":/keep.txt"]) {
      await expect(repoDiffFile(root, query({ path }))).rejects.toMatchObject({ code: "not_found", status: 404 });
    }
  });

  it("refuses an unknown scope, and revisions outside the commit scope", async () => {
    await expect(repoDiffFiles(root, query({ scope: "everything" }))).rejects.toMatchObject({ code: "invalid_scope", status: 400 });
    await expect(repoDiffFiles(root, query({ scope: "staged", base: "HEAD" }))).rejects.toMatchObject({ code: "invalid_revision", status: 400 });
  });

  it("refuses an unrelated old path instead of returning another file's patch first", async () => {
    await expect(repoDiffFile(root, query({ path: "keep.txt", old_path: UNICODE }))).rejects.toMatchObject({ code: "invalid_path", status: 400 });
  });

  it("refuses stale rename metadata after the original path is reused", async () => {
    const root = repository("reused-rename-path");
    writeFileSync(join(root, "old.txt"), lines(12));
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "first");
    git(root, "mv", "old.txt", "new.txt");
    writeFileSync(join(root, "old.txt"), "replacement\n");
    git(root, "add", ".");
    await expect(repoDiffFile(root, query({ scope: "staged", path: "new.txt", old_path: "old.txt" }))).rejects.toMatchObject({ code: "invalid_path", status: 400 });
    const answer = await repoDiffFile(root, query({ scope: "staged", path: "new.txt" }));
    expect(parsed(answer.patch).map((file) => file.name)).toEqual(["new.txt"]);
  });
});

/** A patch as Pierre reads it, down to its hunks. */
const shape = (patch: string | null) => parsed(patch).map((file) => [file.name, file.prevName, file.type, file.hunks]);
/** What `git diff HEAD` itself prints for these paths, in the same shape. */
const fromHead = (cwd: string, ...paths: string[]) => shape(git(cwd, "diff", "--no-color", "--find-renames", "HEAD", "--", ...paths));

describe("uncommitted changes against HEAD", () => {
  let root: string;
  beforeAll(() => {
    root = repository("uncommitted");
    writeFileSync(join(root, "staged.txt"), "one\n");
    writeFileSync(join(root, "unstaged.txt"), "one\n");
    writeFileSync(join(root, "partial.txt"), lines(12));
    writeFileSync(join(root, "moved-from.txt"), lines(12, "moving"));
    writeFileSync(join(root, "cached.txt"), "kept on disk\n");
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "first");
    writeFileSync(join(root, "staged.txt"), "one\ntwo\n");
    git(root, "add", "staged.txt");
    writeFileSync(join(root, "unstaged.txt"), "uno\n");
    // partly staged: line 2 in the index, line 11 only on disk
    writeFileSync(join(root, "partial.txt"), lines(12).replace("line 2\n", "line two\n"));
    git(root, "add", "partial.txt");
    writeFileSync(join(root, "partial.txt"), lines(12).replace("line 2\n", "line two\n").replace("line 11\n", "line eleven\n"));
    // a staged rename, edited on disk afterwards
    git(root, "mv", "moved-from.txt", "moved-to.txt");
    writeFileSync(join(root, "moved-to.txt"), lines(12, "moving").replace("moving 5\n", "moving five\n"));
    git(root, "rm", "-q", "--cached", "cached.txt");
    writeFileSync(join(root, "untracked.txt"), "new\n");
    writeFileSync(join(root, "empty.txt"), "");
    const nested = join(root, "nested");
    mkdirSync(nested);
    git(nested, "init", "-q", "-b", "main");
    writeFileSync(join(nested, "inner.txt"), "inner\n");
    git(nested, "add", ".");
    git(nested, "commit", "-q", "-m", "inner");
  });

  it("lists staged, unstaged, partly staged and untracked files once each, against HEAD", async () => {
    const list = await repoDiffFiles(root, query({ scope: "uncommitted" }));
    expect(list).toMatchObject({ scope: "uncommitted", base: null, head: null, total: 8, truncated: false });
    expect("merge_base" in list).toBeFalse();
    expect(list.files).toEqual([
      { path: "cached.txt", old_path: null, status: "deleted", additions: 0, deletions: 1, binary: false },
      { path: "empty.txt", old_path: null, status: "untracked", additions: null, deletions: null, binary: null },
      { path: "moved-to.txt", old_path: "moved-from.txt", status: "renamed", additions: 1, deletions: 1, binary: false },
      { path: "nested/", old_path: null, status: "untracked", additions: null, deletions: null, binary: null },
      { path: "partial.txt", old_path: null, status: "modified", additions: 2, deletions: 2, binary: false },
      { path: "staged.txt", old_path: null, status: "modified", additions: 1, deletions: 0, binary: false },
      { path: "unstaged.txt", old_path: null, status: "modified", additions: 1, deletions: 1, binary: false },
      { path: "untracked.txt", old_path: null, status: "untracked", additions: null, deletions: null, binary: null },
    ]);
    // an empty untracked file and an embedded repository are listed as the workspace scope lists them
    const workspace = await repoDiffFiles(root, query());
    for (const path of ["empty.txt", "nested/"]) expect(list.files.find((file) => file.path === path)).toEqual(workspace.files.find((file) => file.path === path)!);
  });

  it("patches each tracked file as `git diff HEAD` does, and an untracked one as a new file", async () => {
    for (const path of ["staged.txt", "unstaged.txt", "partial.txt"]) {
      const answer = await repoDiffFile(root, query({ scope: "uncommitted", path }));
      expect(answer).toMatchObject({ scope: "uncommitted", base: null, head: null, unavailable: null });
      const expected = fromHead(root, path);
      expect(expected).toHaveLength(1);
      expect(shape(answer.patch)).toEqual(expected);
    }
    const renamed = await repoDiffFile(root, query({ scope: "uncommitted", path: "moved-to.txt", old_path: "moved-from.txt" }));
    expect(renamed.file).toMatchObject({ status: "renamed", old_path: "moved-from.txt" });
    expect(shape(renamed.patch)).toEqual(fromHead(root, "moved-from.txt", "moved-to.txt"));
    expect(parsed(renamed.patch).map((file) => [file.name, file.prevName, file.type])).toEqual([["moved-to.txt", "moved-from.txt", "rename-changed"]]);
    // removed from the index, still on disk: one deletion, not an untracked file as well
    const cached = await repoDiffFile(root, query({ scope: "uncommitted", path: "cached.txt" }));
    expect(cached.file.status).toBe("deleted");
    expect(parsed(cached.patch).map((file) => [file.name, file.type])).toEqual([["cached.txt", "deleted"]]);
    const untracked = await repoDiffFile(root, query({ scope: "uncommitted", path: "untracked.txt" }));
    expect(untracked.file).toEqual({ path: "untracked.txt", old_path: null, status: "untracked", additions: null, deletions: null, binary: false });
    expect(parsed(untracked.patch).map((file) => [file.name, file.type, file.additionLines])).toEqual([["untracked.txt", "new", ["new\n"]]]);
  });

  it("refuses merge_base and head without a base as a malformed ask, never as an unknown scope", async () => {
    const cases: [Record<string, string>, "base" | "head"][] = [[{ merge_base: "1" }, "base"], [{ head: "main" }, "head"], [{ head: "main", merge_base: "1" }, "head"]];
    for (const [extra, param] of cases) {
      await expect(repoDiffFiles(root, query({ scope: "uncommitted", ...extra }))).rejects.toMatchObject({ code: "invalid_revision", status: 400, param });
      await expect(repoDiffFile(root, query({ scope: "uncommitted", path: "staged.txt", ...extra }))).rejects.toMatchObject({ code: "invalid_revision", status: 400, param });
    }
  });

  it("lists a conflicted file as unmerged with no patch, where `git diff HEAD` calls it modified", async () => {
    const conflicted = repository("uncommitted-conflict");
    writeFileSync(join(conflicted, "c.txt"), "base\n");
    writeFileSync(join(conflicted, "other.txt"), "base\n");
    git(conflicted, "add", ".");
    git(conflicted, "commit", "-q", "-m", "base");
    git(conflicted, "checkout", "-q", "-b", "side");
    writeFileSync(join(conflicted, "c.txt"), "side\n");
    git(conflicted, "commit", "-q", "-a", "-m", "side");
    git(conflicted, "checkout", "-q", "main");
    writeFileSync(join(conflicted, "c.txt"), "main\n");
    git(conflicted, "commit", "-q", "-a", "-m", "main");
    expect(Bun.spawnSync(["git", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-C", conflicted, "merge", "side"], { stdout: "ignore", stderr: "ignore" }).exitCode).toBe(1);
    writeFileSync(join(conflicted, "other.txt"), "changed\n");
    expect(git(conflicted, "diff", "--name-status", "HEAD", "--", "c.txt")).toStartWith("M");
    expect((await repoDiffFiles(conflicted, query({ scope: "uncommitted" }))).files).toEqual([
      { path: "c.txt", old_path: null, status: "unmerged", additions: null, deletions: null, binary: null },
      { path: "other.txt", old_path: null, status: "modified", additions: 1, deletions: 1, binary: false },
    ]);
    expect(await repoDiffFile(conflicted, query({ scope: "uncommitted", path: "c.txt" }))).toMatchObject({ patch: null, unavailable: "unmerged", file: { status: "unmerged" } });
  });

  it.skipIf(process.platform === "win32")("says an untracked file swapped for a FIFO cannot be shown, without blocking on it", async () => {
    const swapped = repository("uncommitted-fifo");
    writeFileSync(join(swapped, "a.txt"), "one\n");
    git(swapped, "add", ".");
    git(swapped, "commit", "-q", "-m", "first");
    const target = join(swapped, "pipe.txt");
    writeFileSync(target, "a file while git lists it\n");
    // git lists the file, then it is a FIFO by the time the server reads it
    const swapper = join(scratch, "swapping-git");
    writeFileSync(swapper, `#!/bin/sh\ngit "$@"\ncode=$?\ncase " $* " in *" --others "*) rm -f '${target}' && mkfifo '${target}' ;; esac\nexit $code\n`);
    chmodSync(swapper, 0o755);
    const answer = await repoDiffFile(swapped, query({ scope: "uncommitted", path: "pipe.txt" }), { git: swapper });
    expect(answer).toMatchObject({ patch: null, unavailable: "unsupported", file: { path: "pipe.txt", status: "untracked" } });
  });
});

describe("uncommitted changes before the first commit", () => {
  const probe = join(scratch, "sha256-probe");
  const sha256 = Bun.spawnSync(["git", "init", "-q", "--object-format=sha256", probe], { stdout: "ignore", stderr: "ignore" }).exitCode === 0;

  const unbornCase = async (name: string, format: "sha1" | "sha256") => {
    const root = join(scratch, name);
    mkdirSync(root);
    git(root, "init", "-q", "-b", "main", `--object-format=${format}`);
    expect(git(root, "rev-parse", "--show-object-format").trim()).toBe(format);
    writeFileSync(join(root, "staged.txt"), "staged\n");
    git(root, "add", "staged.txt");
    writeFileSync(join(root, "loose.txt"), "loose\n");
    const list = await repoDiffFiles(root, query({ scope: "uncommitted" }));
    expect(list.repository).toMatchObject({ unborn: true, head: null });
    expect(list).toMatchObject({ scope: "uncommitted", base: null, head: null, total: 2 });
    expect(list.files.map((file) => [file.path, file.status])).toEqual([["loose.txt", "untracked"], ["staged.txt", "added"]]);
    const answer = await repoDiffFile(root, query({ scope: "uncommitted", path: "staged.txt" }));
    expect(parsed(answer.patch).map((file) => [file.name, file.type, file.additionLines])).toEqual([["staged.txt", "new", ["staged\n"]]]);
    // the empty tree is named, never written
    const emptyTree = git(root, "hash-object", "-t", "tree", "--stdin").trim();
    expect(emptyTree).toHaveLength(format === "sha1" ? 40 : 64);
    expect(existsSync(join(root, ".git", "objects", emptyTree.slice(0, 2), emptyTree.slice(2)))).toBeFalse();
  };

  it("compares a SHA-1 repository's index and files with the empty tree", () => unbornCase("unborn-sha1", "sha1"));

  // skipped only where this git cannot make SHA-256 repositories, and never in CI
  it.skipIf(!sha256 && !process.env["CI"])("compares a SHA-256 repository's index and files with the empty tree", async () => {
    if (!sha256) throw new Error("this git cannot create SHA-256 repositories (git init --object-format=sha256 failed)");
    await unbornCase("unborn-sha256", "sha256");
  });
});

describe("uncommitted changes of a branch in its worktree", () => {
  let root: string;
  let worktree: string;
  let forkPoint: string;
  let mainTip: string;
  /** a worktree of `root` at `name`, on `branch` made from main */
  const worktreeFor = (name: string, branch: string): string => {
    const path = join(scratch, name);
    git(root, "worktree", "add", "-q", "-b", branch, path, "main");
    return path;
  };
  beforeAll(() => {
    root = repository("worktrees");
    writeFileSync(join(root, "shared.txt"), "one\n");
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "first");
    forkPoint = git(root, "rev-parse", "HEAD").trim();
    worktree = worktreeFor("worktrees-feat", "feat/x");
    writeFileSync(join(worktree, "feature.txt"), lines(12, "feature"));
    git(worktree, "add", ".");
    git(worktree, "commit", "-q", "-m", "feature");
    // main moves on after feat/x forked from it
    writeFileSync(join(root, "later.txt"), "later\n");
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "main moves on");
    mainTip = git(root, "rev-parse", "HEAD").trim();
    // the worktree's uncommitted work: unstaged, staged and untracked
    writeFileSync(join(worktree, "feature.txt"), lines(12, "feature").replace("feature 4\n", "feature four\n"));
    writeFileSync(join(worktree, "staged.txt"), "staged\n");
    git(worktree, "add", "staged.txt");
    writeFileSync(join(worktree, "loose.txt"), "loose\n");
  });
  const ask = (values: Record<string, string> = {}) => query({ scope: "uncommitted", base: "main", head: "feat/x", merge_base: "1", ...values });

  it("compares where the branch forked with the worktree's files, untracked ones included", async () => {
    const list = await repoDiffFiles(worktree, ask());
    expect(list.repository).toMatchObject({ root: worktree, branch: "feat/x" });
    expect(list).toMatchObject({ scope: "uncommitted", base: mainTip, head: null, merge_base: forkPoint, total: 3, truncated: false });
    expect(list.files.map((file) => [file.path, file.status])).toEqual([["feature.txt", "added"], ["loose.txt", "untracked"], ["staged.txt", "added"]]);
    const answer = await repoDiffFile(worktree, ask({ path: "feature.txt" }));
    expect(answer).toMatchObject({ scope: "uncommitted", base: mainTip, head: null, merge_base: forkPoint, unavailable: null });
    const expected = shape(git(worktree, "diff", "--no-color", "--find-renames", forkPoint, "--", "feature.txt"));
    expect(expected).toHaveLength(1);
    expect(shape(answer.patch)).toEqual(expected);
    expect(parsed(answer.patch)[0]!.additionLines).toContain("feature four\n");
    const untracked = await repoDiffFile(worktree, ask({ path: "loose.txt" }));
    expect(parsed(untracked.patch).map((file) => [file.name, file.type, file.additionLines])).toEqual([["loose.txt", "new", ["loose\n"]]]);
    // what main did since is no part of the branch's change
    await expect(repoDiffFile(worktree, ask({ path: "later.txt" }))).rejects.toMatchObject({ code: "not_found", status: 404 });
  });

  it("compares from base itself without merge_base, and says nothing of a merge base", async () => {
    // head only guards which branch the worktree is on; without it nothing is checked
    for (const values of [{ base: "main", head: "feat/x" }, { base: "main" }] as Record<string, string>[]) {
      const list = await repoDiffFiles(worktree, query({ scope: "uncommitted", ...values }));
      expect(list).toMatchObject({ scope: "uncommitted", base: mainTip, head: null });
      expect("merge_base" in list).toBeFalse();
      expect(list.files.map((file) => [file.path, file.status])).toEqual([["feature.txt", "added"], ["later.txt", "deleted"], ["loose.txt", "untracked"], ["staged.txt", "added"]]);
    }
  });

  it("refuses a worktree that no longer has head checked out, naming head", async () => {
    const moved = worktreeFor("worktrees-moved", "feat/moved");
    git(moved, "checkout", "-q", "-b", "other");
    const refusal = { code: "worktree_moved", status: 409, param: "head" };
    await expect(repoDiffFiles(moved, ask({ head: "feat/moved" }))).rejects.toMatchObject(refusal);
    await expect(repoDiffFile(moved, ask({ head: "feat/moved", path: "shared.txt" }))).rejects.toMatchObject(refusal);
    git(moved, "checkout", "-q", "--detach");
    await expect(repoDiffFiles(moved, ask({ head: "feat/moved" }))).rejects.toMatchObject(refusal);
    await expect(repoDiffFiles(moved, ask({ head: "other" }))).rejects.toMatchObject(refusal);
    // the pane's own checkout is another branch than the one asked for
    await expect(repoDiffFiles(root, ask())).rejects.toMatchObject(refusal);
  });

  it("takes a branch that shares its name with a tag", async () => {
    const dual = worktreeFor("worktrees-dual", "dual");
    git(root, "tag", "dual", forkPoint);
    const list = await repoDiffFiles(dual, ask({ head: "dual" }));
    // made from main's tip, so it forked there
    expect(list).toMatchObject({ base: mainTip, head: null, merge_base: mainTip, files: [] });
  });

  it("never takes a head that is an option, an expression or malformed, and never hands it to git", async () => {
    for (const head of ["", "-x", "--output=/tmp/x", "feat/x\n", "feat\tx", "feat\u0000x", "feat\u007fx", "x".repeat(256)]) {
      await expect(repoDiffFiles(worktree, ask({ head }))).rejects.toMatchObject({ code: "invalid_revision", status: 400, param: "head" });
    }
    // names git would resolve to the checked-out branch are still not that branch's name
    for (const head of ["@{-1}", "HEAD", "@", "refs/heads/feat/x", "heads/feat/x"]) {
      await expect(repoDiffFiles(worktree, ask({ head }))).rejects.toMatchObject({ code: "worktree_moved", status: 409, param: "head" });
    }
    await expect(repoDiffFiles(worktree, ask({ head: `feat/${"x".repeat(250)}` }))).rejects.toMatchObject({ code: "worktree_moved", status: 409 });
    const recorded = join(scratch, "worktree-argv");
    const recorder = join(scratch, "recording-git");
    writeFileSync(recorder, `#!/bin/sh\nprintf '%s\\n' "$@" >> '${recorded}'\nexec git "$@"\n`);
    chmodSync(recorder, 0o755);
    await repoDiffFile(worktree, ask({ path: "feature.txt" }), { git: recorder });
    expect(Bun.file(recorded).size).toBeGreaterThan(0);
    expect(await Bun.file(recorded).text()).not.toContain("feat/x");
  });

  it("refuses merge_base in a worktree with no commit yet, or none in common with base", async () => {
    const orphan = join(scratch, "worktrees-orphan");
    git(root, "worktree", "add", "-q", "--orphan", "-b", "lonely", orphan);
    writeFileSync(join(orphan, "alone.txt"), "alone\n");
    const refusal = { code: "no_merge_base", status: 409, param: "base" };
    await expect(repoDiffFiles(orphan, ask({ head: "lonely" }))).rejects.toMatchObject(refusal);
    git(orphan, "add", ".");
    git(orphan, "commit", "-q", "-m", "alone");
    await expect(repoDiffFiles(orphan, ask({ head: "lonely" }))).rejects.toMatchObject(refusal);
    // without merge_base, base itself is the old side
    const list = await repoDiffFiles(orphan, query({ scope: "uncommitted", base: "main", head: "lonely" }));
    expect(list.files.map((file) => [file.path, file.status])).toEqual([["alone.txt", "added"], ["later.txt", "deleted"], ["shared.txt", "deleted"]]);
  });

  it("names the base a refusal is about, after checking the worktree", async () => {
    await expect(repoDiffFiles(worktree, ask({ base: "no-such-branch" }))).rejects.toMatchObject({ code: "revision_not_found", status: 404, param: "base" });
    await expect(repoDiffFiles(worktree, ask({ base: "HEAD..main" }))).rejects.toMatchObject({ code: "invalid_revision", status: 400, param: "base" });
    await expect(repoDiffFiles(worktree, ask({ base: "no-such-branch", head: "other" }))).rejects.toMatchObject({ code: "worktree_moved", status: 409, param: "head" });
  });
});

describe("comparing two commits", () => {
  let root: string;
  let first: string;
  let second: string;
  beforeAll(() => {
    root = repository("commits");
    writeFileSync(join(root, "a.txt"), "one\n");
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "first");
    first = git(root, "rev-parse", "HEAD").trim();
    writeFileSync(join(root, "a.txt"), "one\ntwo\n");
    writeFileSync(join(root, "b.txt"), "new\n");
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "second");
    second = git(root, "rev-parse", "HEAD").trim();
    git(root, "tag", "v1", first);
    // uncommitted work is no part of a comparison between commits
    writeFileSync(join(root, "a.txt"), "dirty\n");
  });

  it("lists and patches what differs between the two, named as full hashes", async () => {
    const comparisons: Record<string, string>[] = [{ base: "HEAD~1" }, { base: "v1", head: "main" }, { base: first, head: second }];
    for (const revisions of comparisons) {
      const list = await repoDiffFiles(root, query({ scope: "commit", ...revisions }));
      expect(list).toMatchObject({ scope: "commit", base: first, head: second, total: 2, truncated: false });
      expect(list.files.map((file) => [file.path, file.status, file.additions, file.deletions])).toEqual([["a.txt", "modified", 1, 0], ["b.txt", "added", 1, 0]]);
    }
    const answer = await repoDiffFile(root, query({ scope: "commit", base: first, head: second, path: "a.txt" }));
    expect(answer).toMatchObject({ base: first, head: second, unavailable: null });
    expect(parsed(answer.patch).map((file) => [file.name, file.additionLines.includes("two\n"), file.additionLines.includes("dirty\n")])).toEqual([["a.txt", true, false]]);
    expect((await repoDiffFiles(root, query({ scope: "commit", base: second, head: second }))).files).toEqual([]);
  });

  it("refuses a revision that is an option, a range or malformed, and one that names no commit", async () => {
    const marker = join(scratch, "option-ran");
    for (const base of [`--output=${marker}`, "-p", "HEAD..main", "HEAD:a.txt", "HEAD main", "", "x".repeat(201)]) {
      await expect(repoDiffFiles(root, query({ scope: "commit", base }))).rejects.toMatchObject({ code: "invalid_revision", status: 400 });
    }
    expect(existsSync(marker)).toBeFalse();
    await expect(repoDiffFiles(root, query({ scope: "commit" }))).rejects.toMatchObject({ code: "invalid_revision", status: 400 });
    await expect(repoDiffFiles(root, query({ scope: "commit", base: "no-such-branch" }))).rejects.toMatchObject({ code: "revision_not_found", status: 404 });
    await expect(repoDiffFile(root, query({ scope: "commit", base: first, head: "deadbeef", path: "a.txt" }))).rejects.toMatchObject({ code: "revision_not_found", status: 404 });
  });
});

describe("comparing a branch from where it forked", () => {
  let root: string;
  let forkPoint: string;
  let next: string;
  let feature: string;
  beforeAll(() => {
    root = repository("fork");
    writeFileSync(join(root, "shared.txt"), "one\n");
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "first");
    forkPoint = git(root, "rev-parse", "HEAD").trim();
    git(root, "checkout", "-q", "-b", "next");
    git(root, "checkout", "-q", "-b", "feat/x");
    writeFileSync(join(root, "feature.txt"), "feature\n");
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "feature");
    feature = git(root, "rev-parse", "HEAD").trim();
    // next moves on after feat/x forked from it
    git(root, "checkout", "-q", "next");
    writeFileSync(join(root, "next.txt"), "later\n");
    writeFileSync(join(root, "shared.txt"), "one\ntwo\n");
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "next moves on");
    next = git(root, "rev-parse", "HEAD").trim();
    // a branch with no history in common with the others
    git(root, "checkout", "-q", "--orphan", "orphan");
    git(root, "rm", "-q", "-rf", ".");
    writeFileSync(join(root, "alone.txt"), "alone\n");
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "alone");
    git(root, "checkout", "-q", "main");
  });

  it("lists only the branch's own changes and names the merge base git names", async () => {
    expect(git(root, "merge-base", "next", "feat/x").trim()).toBe(forkPoint);
    const list = await repoDiffFiles(root, query({ scope: "commit", base: "next", head: "feat/x", merge_base: "1" }));
    expect(list).toMatchObject({ scope: "commit", base: next, head: feature, merge_base: forkPoint, total: 1, truncated: false });
    expect(list.files.map((file) => [file.path, file.status])).toEqual([["feature.txt", "added"]]);
    const answer = await repoDiffFile(root, query({ scope: "commit", base: "next", head: "feat/x", merge_base: "1", path: "feature.txt" }));
    expect(answer).toMatchObject({ base: next, head: feature, merge_base: forkPoint, unavailable: null });
    expect(parsed(answer.patch).map((file) => [file.name, file.type])).toEqual([["feature.txt", "new"]]);
    // what next did since is no part of the branch's change
    await expect(repoDiffFile(root, query({ scope: "commit", base: "next", head: "feat/x", merge_base: "1", path: "next.txt" }))).rejects.toMatchObject({ code: "not_found", status: 404 });
  });

  it("keeps a commit comparison two-dot without the parameter, and says nothing of a merge base", async () => {
    const list = await repoDiffFiles(root, query({ scope: "commit", base: "next", head: "feat/x" }));
    expect(list).toMatchObject({ base: next, head: feature });
    expect("merge_base" in list).toBeFalse();
    expect(list.files.map((file) => [file.path, file.status])).toEqual([["feature.txt", "added"], ["next.txt", "deleted"], ["shared.txt", "modified"]]);
    const answer = await repoDiffFile(root, query({ scope: "commit", base: "next", head: "feat/x", path: "next.txt" }));
    expect("merge_base" in answer).toBeFalse();
    expect(parsed(answer.patch).map((file) => [file.name, file.type])).toEqual([["next.txt", "deleted"]]);
  });

  it("refuses branches with no history in common, naming the base", async () => {
    const refused = repoDiffFiles(root, query({ scope: "commit", base: "orphan", head: "feat/x", merge_base: "1" }));
    await expect(refused).rejects.toMatchObject({ code: "no_merge_base", status: 409, param: "base" });
    await expect(repoDiffFile(root, query({ scope: "commit", base: "orphan", head: "feat/x", merge_base: "1", path: "feature.txt" }))).rejects.toMatchObject({ code: "no_merge_base", status: 409, param: "base" });
  });

  it("names the field a refused revision came from", async () => {
    await expect(repoDiffFiles(root, query({ scope: "commit", base: "next", head: "no-such-branch", merge_base: "1" }))).rejects.toMatchObject({ code: "revision_not_found", status: 404, param: "head" });
    await expect(repoDiffFiles(root, query({ scope: "commit", base: "no-such-branch", head: "feat/x" }))).rejects.toMatchObject({ code: "revision_not_found", status: 404, param: "base" });
    await expect(repoDiffFiles(root, query({ scope: "commit", base: "next", head: "HEAD..main" }))).rejects.toMatchObject({ code: "invalid_revision", status: 400, param: "head" });
    await expect(repoDiffFiles(root, query({ scope: "commit", head: "feat/x" }))).rejects.toMatchObject({ code: "invalid_revision", status: 400, param: "base" });
  });

  it("refuses a merge base outside the commit scope", async () => {
    for (const scope of ["workspace", "staged"]) {
      await expect(repoDiffFiles(root, query({ scope, merge_base: "1" }))).rejects.toMatchObject({ status: 400 });
      await expect(repoDiffFile(root, query({ scope, merge_base: "1", path: "shared.txt" }))).rejects.toMatchObject({ status: 400 });
    }
  });
});

describe("repositories in an unusual state", () => {
  it("reads a repository with no commit yet: nothing, then untracked, then staged", async () => {
    const root = repository("unborn");
    const empty = await repoDiffFiles(root, query());
    expect(empty.repository).toEqual({ root, branch: "main", head: null, detached: false, unborn: true });
    expect(empty).toMatchObject({ files: [], total: 0, truncated: false });
    writeFileSync(join(root, "first.txt"), "hello\n");
    expect((await repoDiffFiles(root, query())).files.map((file) => [file.path, file.status])).toEqual([["first.txt", "untracked"]]);
    git(root, "add", "first.txt");
    expect((await repoDiffFiles(root, query({ scope: "staged" }))).files).toEqual([{ path: "first.txt", old_path: null, status: "added", additions: 1, deletions: 0, binary: false }]);
    const staged = await repoDiffFile(root, query({ scope: "staged", path: "first.txt" }));
    expect(parsed(staged.patch).map((file) => [file.name, file.type])).toEqual([["first.txt", "new"]]);
    await expect(repoDiffFiles(root, query({ scope: "commit", base: "HEAD" }))).rejects.toMatchObject({ code: "revision_not_found", status: 404 });
  });

  it("reads a detached HEAD and a clean tree", async () => {
    const root = repository("detached");
    writeFileSync(join(root, "a.txt"), "one\n");
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "first");
    const head = git(root, "rev-parse", "HEAD").trim();
    git(root, "checkout", "-q", "--detach");
    const list = await repoDiffFiles(root, query());
    expect(list.repository).toEqual({ root, branch: null, head, detached: true, unborn: false });
    expect(list).toMatchObject({ files: [], total: 0, truncated: false });
  });

  it("says a folder outside any repository is not one, and that a conflicted file has no unified patch", async () => {
    const plain = join(scratch, "plain");
    mkdirSync(plain);
    await expect(repoDiffFiles(plain, query())).rejects.toMatchObject({ code: "not_a_repository", status: 409 });
    await expect(repoDiffFile(plain, query({ path: "a.txt" }))).rejects.toMatchObject({ code: "not_a_repository", status: 409 });
    await expect(repoDiffFiles(join(scratch, "missing"), query())).rejects.toMatchObject({ code: "not_a_repository", status: 409 });

    const root = repository("conflict");
    writeFileSync(join(root, "c.txt"), "base\n");
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "base");
    git(root, "checkout", "-q", "-b", "side");
    writeFileSync(join(root, "c.txt"), "side\n");
    git(root, "commit", "-q", "-a", "-m", "side");
    git(root, "checkout", "-q", "main");
    writeFileSync(join(root, "c.txt"), "main\n");
    git(root, "commit", "-q", "-a", "-m", "main");
    expect(Bun.spawnSync(["git", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-C", root, "merge", "side"], { stdout: "ignore", stderr: "ignore" }).exitCode).toBe(1);
    expect((await repoDiffFiles(root, query())).files).toEqual([{ path: "c.txt", old_path: null, status: "unmerged", additions: null, deletions: null, binary: null }]);
    expect(await repoDiffFile(root, query({ path: "c.txt" }))).toMatchObject({ patch: null, unavailable: "unmerged", truncated: false });
  });
});

describe("the branches a review can compare", () => {
  let root: string;
  let checkedOut: string;
  let linked: string;
  /** A commit on `parent`, `seconds` after a fixed committer time, made without moving any branch. */
  const commitAt = (cwd: string, parent: string, seconds: number): string => {
    const result = Bun.spawnSync(["git", "-C", cwd, "commit-tree", `${parent}^{tree}`, "-p", parent, "-m", `at ${seconds}`], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid", GIT_COMMITTER_DATE: `${1_700_000_000 + seconds} +0000` },
    });
    if (result.exitCode !== 0) throw new Error(`git commit-tree failed: ${result.stderr.toString()}`);
    return result.stdout.toString().trim();
  };
  beforeAll(() => {
    root = repository("branches");
    writeFileSync(join(root, "a.txt"), "one\n");
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "first");
    const first = git(root, "rev-parse", "HEAD").trim();
    git(root, "reset", "-q", "--hard", commitAt(root, first, 1_000));
    git(root, "branch", "feat/old", commitAt(root, "main", 2_000));
    git(root, "branch", "feat/new", commitAt(root, "main", 4_000));
    git(root, "branch", "feat/gone", commitAt(root, "main", 1_500));
    git(root, "update-ref", "refs/remotes/origin/main", "main");
    git(root, "update-ref", "refs/remotes/origin/next", commitAt(root, "main", 3_000));
    git(root, "update-ref", "refs/remotes/upstream/feat", commitAt(root, "main", 5_000));
    git(root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/next");
    // feat/new in a worktree of its own, feat/old in one reached through a link, feat/gone in one whose folder is gone
    checkedOut = join(scratch, "branches-new");
    git(root, "worktree", "add", "-q", checkedOut, "feat/new");
    mkdirSync(join(scratch, "branches-real"));
    symlinkSync(join(scratch, "branches-real"), join(scratch, "branches-link"));
    git(root, "worktree", "add", "-q", join(scratch, "branches-link", "old"), "feat/old");
    linked = realpathSync(join(scratch, "branches-link", "old"));
    git(root, "worktree", "add", "-q", join(scratch, "branches-gone"), "feat/gone");
    rmSync(join(scratch, "branches-gone"), { recursive: true, force: true });
    git(root, "worktree", "add", "-q", "--detach", join(scratch, "branches-detached"), "main");
  });

  it("lists local branches, then remote ones, each newest first, without a remote's HEAD, with where each is checked out and its tip commit", async () => {
    const list = await repoBranches(root);
    expect(list.repository).toMatchObject({ root, branch: "main" });
    const tip = (ref: string, seconds: number) => ({ hash: git(root, "rev-parse", ref).trim(), time: 1_700_000_000 + seconds, subject: `at ${seconds}` });
    expect(list.branches).toEqual([
      { name: "feat/new", remote: false, worktree: checkedOut, commit: tip("feat/new", 4_000) },
      { name: "feat/old", remote: false, worktree: linked, commit: tip("feat/old", 2_000) },
      { name: "feat/gone", remote: false, worktree: null, commit: tip("feat/gone", 1_500) },
      { name: "main", remote: false, worktree: root, commit: tip("main", 1_000) },
      { name: "upstream/feat", remote: true, worktree: null, commit: tip("upstream/feat", 5_000) },
      { name: "origin/next", remote: true, worktree: null, commit: tip("origin/next", 3_000) },
      { name: "origin/main", remote: true, worktree: null, commit: tip("origin/main", 1_000) },
    ]);
    expect(list).toMatchObject({ default_base: "origin/next", truncated: false, limits: { max_branches: REPO_BRANCHES_MAX } });
    // the same list from inside another worktree of the repository
    expect((await repoBranches(checkedOut)).branches.map((branch) => branch.name)).toEqual(list.branches.map((branch) => branch.name));
  });

  it("keeps every local branch at the cap and fills the rest with the newest remote ones", async () => {
    const some = await repoBranches(root, { maxBranches: 5 });
    expect(some.branches.map((branch) => branch.name)).toEqual(["feat/new", "feat/old", "feat/gone", "main", "upstream/feat"]);
    expect(some).toMatchObject({ truncated: true, limits: { max_branches: 5 } });
    const locals = await repoBranches(root, { maxBranches: 2 });
    expect(locals.branches.map((branch) => branch.name)).toEqual(["feat/new", "feat/old", "feat/gone", "main"]);
    expect(locals.truncated).toBeTrue();
    expect((await repoBranches(root, { maxBranches: 7 })).truncated).toBeFalse();
  });

  it("keeps any subject apart, cut at 200 characters, and names no commit for a ref whose tip is not one", async () => {
    const odd = repository("branches-odd");
    writeFileSync(join(odd, "a.txt"), "one\n");
    git(odd, "add", ".");
    // a first paragraph over two lines, with a tab, a field-like `%00` and more than 200 characters (the cut counts characters, not bytes)
    const long = `${"ü".repeat(150)}\t%00 ${"x".repeat(100)}`;
    git(odd, "commit", "-q", "-m", `first line\n${long}\n\nthe body stays out`);
    git(odd, "branch", "empty-message", git(odd, "commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", "").trim());
    git(odd, "tag", "-a", "v1", "-m", "a tag");
    // git refuses to point a branch at anything but a commit, so the ref files are written by hand
    writeFileSync(join(odd, ".git", "refs", "heads", "tagged"), git(odd, "rev-parse", "v1"));
    writeFileSync(join(odd, ".git", "refs", "heads", "blob"), git(odd, "rev-parse", "HEAD:a.txt"));
    const byName = new Map((await repoBranches(odd)).branches.map((branch) => [branch.name, branch]));
    const main = byName.get("main")?.commit;
    expect(main?.hash).toBe(git(odd, "rev-parse", "main").trim());
    expect(main?.time).toBe(Number(git(odd, "log", "-1", "--format=%ct", "main").trim()));
    expect(main?.subject).toBe(Array.from(`first line ${long}`).slice(0, 200).join(""));
    expect(Array.from(main?.subject ?? "")).toHaveLength(200);
    expect(byName.get("empty-message")?.commit).toMatchObject({ hash: git(odd, "rev-parse", "empty-message").trim(), subject: "" });
    expect(byName.get("tagged")).toEqual({ name: "tagged", remote: false, worktree: null });
    expect(byName.get("blob")).toEqual({ name: "blob", remote: false, worktree: null });
  });

  it("names the default base: origin/HEAD's branch, else main, else master, else none", async () => {
    const named = repository("default-main");
    writeFileSync(join(named, "a.txt"), "one\n");
    git(named, "add", ".");
    git(named, "commit", "-q", "-m", "first");
    git(named, "branch", "master");
    expect((await repoBranches(named)).default_base).toBe("main");
    git(named, "branch", "-q", "-m", "main", "trunk");
    expect((await repoBranches(named)).default_base).toBe("master");
    git(named, "branch", "-q", "-D", "master");
    expect((await repoBranches(named)).default_base).toBeNull();
  });

  it("lists nothing in a repository with no commit, or with no branch left", async () => {
    const unborn = repository("branches-unborn");
    expect(await repoBranches(unborn)).toMatchObject({ repository: { root: unborn, unborn: true }, branches: [], default_base: null, truncated: false });
    const none = repository("branches-none");
    writeFileSync(join(none, "a.txt"), "one\n");
    git(none, "add", ".");
    git(none, "commit", "-q", "-m", "first");
    git(none, "checkout", "-q", "--detach");
    git(none, "branch", "-q", "-D", "main");
    expect(await repoBranches(none)).toMatchObject({ repository: { detached: true }, branches: [], default_base: null, truncated: false });
    await expect(repoBranches(join(scratch, "missing"))).rejects.toMatchObject({ code: "not_a_repository", status: 409 });
  });

  it("answers as the other diff routes do, refusals in the error envelope", async () => {
    const answered = await repoDiffResponse("branches", root, query());
    expect(answered.status).toBe(200);
    expect(answered.headers.get("cache-control")).toBe("private, no-store");
    expect((await answered.json() as RepoBranchList).default_base).toBe("origin/next");
    const refused = await repoDiffResponse("branches", join(scratch, "missing"), query());
    expect(refused.status).toBe(409);
    expect((await refused.json() as ApiError).error.code).toBe("not_a_repository");
  });
});

describe("bounds", () => {
  let root: string;
  const names = Array.from({ length: 30 }, (_, index) => `f${String(index).padStart(2, "0")}.txt`);
  beforeAll(() => {
    root = repository("bounds");
    writeFileSync(join(root, "big.txt"), lines(400));
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "first");
    writeFileSync(join(root, "big.txt"), lines(400, "changed"));
    for (const name of names) writeFileSync(join(root, name), "x\n");
  });

  it("cuts a list at the file cap and says how many there were", async () => {
    const list = await repoDiffFiles(root, query(), { maxFiles: 5 });
    expect(list).toMatchObject({ total: 31, truncated: true, limits: { max_files: 5 } });
    expect(list.files.map((file) => file.path)).toEqual(["big.txt", ...names.slice(0, 4)]);
  });

  it("cuts a list at the byte cap on a whole name, with the total unknown", async () => {
    const list = await repoDiffFiles(root, query(), { maxListBytes: 64 });
    expect(list).toMatchObject({ total: null, truncated: true, limits: { max_list_bytes: 64 } });
    expect(list.files.length).toBeGreaterThan(0);
    expect(list.files.length).toBeLessThan(31);
    for (const file of list.files) expect(["big.txt", ...names]).toContain(file.path);
  });

  it("sends no part of a patch past the cap, for a tracked and an untracked file", async () => {
    const whole = await repoDiffFile(root, query({ path: "big.txt" }));
    expect(parsed(whole.patch).map((file) => [file.name, file.additionLines.length])).toEqual([["big.txt", 400]]);
    const capped = await repoDiffFile(root, query({ path: "big.txt" }), { maxPatchBytes: 512 });
    expect(capped).toMatchObject({ patch: null, unavailable: "too_large", truncated: true, file: { path: "big.txt", additions: 400, deletions: 400 }, limits: { max_patch_bytes: 512 } });
    writeFileSync(join(root, "f00.txt"), lines(200));
    expect(await repoDiffFile(root, query({ path: "f00.txt" }), { maxPatchBytes: 512 })).toMatchObject({ patch: null, unavailable: "too_large", truncated: true });
    // the file fits and its patch (headers, a `+` per line) does not
    writeFileSync(join(root, "f01.txt"), "y\n".repeat(250));
    expect(await repoDiffFile(root, query({ path: "f01.txt" }), { maxPatchBytes: 512 })).toMatchObject({ patch: null, unavailable: "too_large", truncated: true });
  });

  it("does not follow an untracked link out of the repository", async () => {
    const secret = join(scratch, "secret.txt");
    writeFileSync(secret, "do not read\n");
    symlinkSync(secret, join(root, "link.txt"));
    expect(await repoDiffFile(root, query({ path: "link.txt" }))).toMatchObject({ patch: null, unavailable: "unsupported", truncated: false });
  });

  it("stops a git that does not answer by its deadline, and says when there is no git", async () => {
    const hung = join(scratch, "hung-git");
    writeFileSync(hung, "#!/bin/sh\nexec sleep 30\n");
    chmodSync(hung, 0o755);
    await expect(repoDiffFiles(root, query(), { git: hung, deadlineMs: 50 })).rejects.toMatchObject({ code: "git_timeout", status: 504 });
    await expect(repoDiffFiles(root, query(), { git: join(scratch, "no-git-here") })).rejects.toMatchObject({ code: "git_unavailable", status: 503 });
  });

  it("runs none of the programs a repository's configuration names", async () => {
    const hooked = repository("hooked");
    const marker = join(scratch, "program-ran");
    const program = join(scratch, "program.sh");
    writeFileSync(program, `#!/bin/sh\ntouch '${marker}'\n[ -f "$1" ] && cat "$1"\nexit 0\n`);
    chmodSync(program, 0o755);
    writeFileSync(join(hooked, ".gitattributes"), "*.txt diff=marker\n");
    writeFileSync(join(hooked, "a.txt"), "one\n");
    git(hooked, "add", ".");
    git(hooked, "commit", "-q", "-m", "first");
    writeFileSync(join(hooked, "a.txt"), "two\n");
    writeFileSync(join(hooked, "b.txt"), "new\n");
    git(hooked, "config", "diff.external", program);
    git(hooked, "config", "diff.marker.textconv", program);
    git(hooked, "config", "core.fsmonitor", program);
    rmSync(marker, { force: true });
    expect((await repoDiffFiles(hooked, query())).files.map((file) => file.path)).toEqual(["a.txt", "b.txt"]);
    for (const path of ["a.txt", "b.txt"]) expect((await repoDiffFile(hooked, query({ path }))).patch).toStartWith(`diff --git a/${path} b/${path}\n`);
    expect(existsSync(marker)).toBeFalse();
  });
});

describe("GET /api/workspace/diff/*", () => {
  let root: string;
  let server: ReturnType<typeof createServer>;
  let base: string;
  let watchCookie: string;
  const stateDir = mkdtempSync(join(tmpdir(), "herdr-repo-diff-state-"));
  const owner = { authorization: "Bearer test-repo-diff" };
  beforeAll(() => {
    root = repository("http");
    writeFileSync(join(root, "a.txt"), "one\n");
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "first");
    writeFileSync(join(root, "a.txt"), "two\n");
    const store = new DeviceStore(stateDir);
    const watchToken = store.pair(store.startPairing().code, "Watch", "watch")!.token;
    // a first pairing is a device only once its cookie came back: that return is what saves it
    expect(store.match(watchToken)).not.toBeNull();
    watchCookie = `herdr_web_device=${watchToken}`;
    server = createServer({ port: 0, stateDir, token: "test-repo-diff", tailscaleOwner: null, machines: false });
    base = `http://127.0.0.1:${server.port}`;
  });
  afterAll(() => { server.stop(); rmSync(stateDir, { recursive: true, force: true }); });

  const files = (search: string, headers: Record<string, string> = owner, method = "GET") => fetch(`${base}/api/workspace/diff/files?${search}`, { method, headers });
  const directory = () => `directory=${encodeURIComponent(root)}`;

  it("answers a named folder's list and one file's patch, never cached", async () => {
    const listed = await files(directory());
    expect(listed.status).toBe(200);
    expect(listed.headers.get("cache-control")).toBe("private, no-store");
    const list = await listed.json() as RepoDiffFileList;
    expect(list.repository.root).toBe(root);
    expect(list.files).toEqual([{ path: "a.txt", old_path: null, status: "modified", additions: 1, deletions: 1, binary: false }]);
    const response = await fetch(`${base}/api/workspace/diff/file?${directory()}&path=a.txt`, { headers: owner });
    expect(response.status).toBe(200);
    const answer = await response.json() as RepoDiffFilePatch;
    expect(parsed(answer.patch).map((file) => [file.name, file.type])).toEqual([["a.txt", "change"]]);
  });

  it("answers the uncommitted scope on both routes", async () => {
    const listed = await files(`${directory()}&scope=uncommitted`);
    expect(listed.status).toBe(200);
    expect(await listed.json() as RepoDiffFileList).toMatchObject({ scope: "uncommitted", base: null, head: null, files: [{ path: "a.txt", status: "modified" }] });
    const response = await fetch(`${base}/api/workspace/diff/file?${directory()}&scope=uncommitted&path=a.txt`, { headers: owner });
    expect(response.status).toBe(200);
    const answer = await response.json() as RepoDiffFilePatch;
    expect(answer.scope).toBe("uncommitted");
    expect(parsed(answer.patch).map((file) => [file.name, file.type])).toEqual([["a.txt", "change"]]);
  });

  it("answers a branch's worktree named by directory, whatever pane_id says", async () => {
    const worktree = join(scratch, "http-worktree");
    git(root, "worktree", "add", "-q", "-b", "feat/http", worktree, "main");
    writeFileSync(join(worktree, "loose.txt"), "loose\n");
    const fork = git(root, "rev-parse", "main").trim();
    const search = `pane_id=no-such-pane&directory=${encodeURIComponent(worktree)}&scope=uncommitted&base=main&head=feat%2Fhttp&merge_base=1`;
    const listed = await files(search);
    expect(listed.status).toBe(200);
    expect(await listed.json() as RepoDiffFileList).toMatchObject({ repository: { root: worktree }, scope: "uncommitted", base: fork, head: null, merge_base: fork, files: [{ path: "loose.txt", status: "untracked" }] });
    const response = await fetch(`${base}/api/workspace/diff/file?${search}&path=loose.txt`, { headers: owner });
    expect(response.status).toBe(200);
    expect(parsed((await response.json() as RepoDiffFilePatch).patch).map((file) => [file.name, file.type])).toEqual([["loose.txt", "new"]]);
  });

  it("refuses bad input in the error envelope", async () => {
    const cases: [string, number, string][] = [
      ["", 400, "missing_directory"],
      ["directory=relative%2Ffolder", 400, "invalid_cwd"],
      [`directory=${encodeURIComponent(join(scratch, "nowhere"))}`, 400, "invalid_cwd"],
      [`directory=${encodeURIComponent(scratch)}`, 409, "not_a_repository"],
      [`${directory()}&scope=all`, 400, "invalid_scope"],
      [`${directory()}&scope=commit&base=--output%3D%2Ftmp%2Fx`, 400, "invalid_revision"],
      [`${directory()}&scope=commit&base=nope`, 404, "revision_not_found"],
      [`${directory()}&merge_base=1`, 400, "invalid_scope"],
      [`${directory()}&scope=uncommitted&merge_base=1`, 400, "invalid_revision"],
      [`${directory()}&scope=uncommitted&head=main`, 400, "invalid_revision"],
      [`${directory()}&scope=uncommitted&base=main&head=-x`, 400, "invalid_revision"],
      [`${directory()}&scope=uncommitted&base=main&head=other&merge_base=1`, 409, "worktree_moved"],
    ];
    for (const [search, status, code] of cases) {
      const response = await files(search);
      expect([search, response.status]).toEqual([search, status]);
      const body = await response.json() as ApiError;
      expect(body.error.code).toBe(code);
      expect(typeof body.error.message).toBe("string");
    }
    for (const [path, status, code] of [["..%2Fx", 400, "invalid_path"], ["", 400, "invalid_path"], ["absent.txt", 404, "not_found"]] as const) {
      const response = await fetch(`${base}/api/workspace/diff/file?${directory()}&path=${path}`, { headers: owner });
      expect(response.status).toBe(status);
      expect((await response.json() as ApiError).error.code).toBe(code);
    }
    const named = await files(`${directory()}&scope=commit&base=HEAD&head=nope&merge_base=1`);
    expect(named.status).toBe(404);
    expect((await named.json() as ApiError).error).toMatchObject({ code: "revision_not_found", param: "head" });
    const moved = await files(`${directory()}&scope=uncommitted&base=main&head=other&merge_base=1`);
    expect((await moved.json() as ApiError).error).toMatchObject({ code: "worktree_moved", param: "head" });
    const unnamed = await files(`${directory()}&scope=all`);
    expect("param" in (await unnamed.json() as ApiError).error).toBeFalse();
    const posted = await files(directory(), { ...owner, "x-herdr-machine": "1" }, "POST");
    expect(posted.status).toBe(400);
    expect((await posted.json() as ApiError).error.code).toBe("method_not_allowed");
  });

  it("is closed to a stranger, to another site's page and to a device that can only watch", async () => {
    expect((await files(directory(), {})).status).toBe(401);
    const crossSite = await files(directory(), { ...owner, "sec-fetch-site": "cross-site" });
    expect(crossSite.status).toBe(403);
    expect((await crossSite.json() as ApiError).error.code).toBe("cross_site");
    expect((await fetch(`${base}/api/session`, { headers: { cookie: watchCookie } })).status).not.toBe(401);
    for (const path of ["workspace/diff/files", "workspace/diff/file", "machines/pc1/workspace/diff/files", "machines/pc1/workspace/diff/file", "machines/local/workspace/diff/file"]) {
      const response = await fetch(`${base}/api/${path}?${directory()}&path=a.txt`, { headers: { cookie: watchCookie } });
      expect([path, response.status]).toEqual([path, 403]);
      expect((await response.json() as ApiError).error.code).toBe("read_only");
    }
    // a branch's worktree with its uncommitted changes is closed the same way
    const worktreeAsk = `${directory()}&scope=uncommitted&base=main&head=main&merge_base=1&path=a.txt`;
    for (const path of ["workspace/diff/files", "workspace/diff/file"]) {
      const watched = await fetch(`${base}/api/${path}?${worktreeAsk}`, { headers: { cookie: watchCookie } });
      expect([path, watched.status, (await watched.json() as ApiError).error.code]).toEqual([path, 403, "read_only"]);
      const foreign = await fetch(`${base}/api/${path}?${worktreeAsk}`, { headers: { ...owner, "sec-fetch-site": "cross-site" } });
      expect([path, foreign.status, (await foreign.json() as ApiError).error.code]).toEqual([path, 403, "cross_site"]);
    }
  });
});
