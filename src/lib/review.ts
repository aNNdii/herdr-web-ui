import type { RepoDiffFile, RepoDiffStatus } from "../../shared/protocol.ts";
import type { FileTarget, LineRange } from "./fileComments.ts";

/** The marks `@pierre/trees` draws on a row (its own names for git's statuses). */
export type TreeStatus = "added" | "deleted" | "ignored" | "modified" | "renamed" | "untracked";

/** One file's mark in the tree. */
export interface TreeMark {
  path: string;
  status: TreeStatus;
}

/** git's status as the tree marks it; a conflict or a type change shows as modified. */
export function treeStatus(status: RepoDiffStatus): TreeStatus {
  switch (status) {
    case "added":
    case "untracked":
    case "deleted":
      return status;
    case "renamed":
    case "copied":
      return "renamed";
    default:
      return "modified";
  }
}

/** The tree's marks for the changed files, by their current path. */
export function treeMarks(files: readonly RepoDiffFile[]): TreeMark[] {
  return files.map((file) => ({ path: file.path, status: treeStatus(file.status) }));
}

/** The lines a selection spans, first line first, whichever way it was dragged. */
export function rangeOf(start: number, end: number): LineRange {
  return start <= end ? [start, end] : [end, start];
}

/**
 * A comment on lines of a file's working-tree text, as the comment store keeps one (`FileTarget`).
 * `source` holds exactly the commented lines (the store checks that it spans `lines` when it reads a
 * comment back), and the quote is the same text.
 */
export function reviewTarget(absolutePath: string, relativePath: string, lines: LineRange, fileLines: readonly string[]): FileTarget {
  const commented = fileLines.slice(lines[0] - 1, lines[1]);
  return {
    path: absolutePath,
    label: relativePath,
    view: "code",
    lines,
    source: commented,
    quoteLines: commented,
  };
}

/** The absolute path of a repository file, from the repository's root and the path git names it by. */
export function repositoryFile(root: string, relativePath: string): string {
  return `${root.replace(/[\\/]+$/, "")}/${relativePath}`;
}

/** A toggle of the review's tree, per device, kept in localStorage like the file panel's width: off until turned on. */
function storedFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function storeFlag(key: string, on: boolean): void {
  try {
    if (on) window.localStorage.setItem(key, "1");
    else window.localStorage.removeItem(key);
  } catch {
    // private mode: it holds for this opening only
  }
}

/** Whether the review's tree shows the files git ignores (in All files). */
const SHOW_IGNORED_KEY = "herdr-web-ui:review-show-ignored";

export function storedShowIgnored(): boolean {
  return storedFlag(SHOW_IGNORED_KEY);
}

export function storeShowIgnored(shown: boolean): void {
  storeFlag(SHOW_IGNORED_KEY, shown);
}

/** Whether the review's tree leaves out the viewed files (in Changed files). */
const HIDE_VIEWED_KEY = "herdr-web-ui:review-hide-viewed";

export function storedHideViewed(): boolean {
  return storedFlag(HIDE_VIEWED_KEY);
}

export function storeHideViewed(hidden: boolean): void {
  storeFlag(HIDE_VIEWED_KEY, hidden);
}

/**
 * The changed files a review has marked as viewed, per device: for each repository (by PC and root), each file's path
 * with the stamp it had when it was marked (`RepoDiffFile.stamp`). A file whose stamp is another now has changed since,
 * and is not viewed any more.
 */
const VIEWED_PREFIX = "herdr-web-ui:review-viewed:";

export type ViewedFiles = Readonly<Record<string, string>>;

function viewedKey(machineId: string, root: string): string {
  return `${VIEWED_PREFIX}${machineId}:${root}`;
}

export function storedViewed(machineId: string, root: string): ViewedFiles {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(viewedKey(machineId, root)) ?? "{}");
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return {};
  }
}

/** The marks with `path` viewed at `stamp` (null: not viewed), kept for the next opening. */
export function storeViewed(machineId: string, root: string, viewed: ViewedFiles, path: string, stamp: string | null): ViewedFiles {
  const next: Record<string, string> = { ...viewed };
  if (stamp === null) delete next[path];
  else next[path] = stamp;
  try {
    if (Object.keys(next).length === 0) window.localStorage.removeItem(viewedKey(machineId, root));
    else window.localStorage.setItem(viewedKey(machineId, root), JSON.stringify(next));
  } catch {
    // private mode: the marks hold while the review is open
  }
  return next;
}
