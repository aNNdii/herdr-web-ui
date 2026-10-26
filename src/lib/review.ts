import type { RepoDiffFile, RepoDiffStatus } from "../../shared/protocol.ts";
import type { DiffRow } from "./diffSides.ts";
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
 * The working tree's lines a selection of drawn diff rows comments on: the rows of the old file are left out, and a
 * selection of removed lines only is refused (null), as a working-tree comment has no line in the old file.
 */
export function workspacePick(rows: readonly DiffRow[]): LineRange | null {
  const lines = rows.filter((row) => !row.old).map((row) => row.line).filter((line) => Number.isFinite(line) && line > 0);
  return lines.length === 0 ? null : [Math.min(...lines), Math.max(...lines)];
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
const SHOW_IGNORED_KEY = "ovis:review-show-ignored";

export function storedShowIgnored(): boolean {
  return storedFlag(SHOW_IGNORED_KEY);
}

export function storeShowIgnored(shown: boolean): void {
  storeFlag(SHOW_IGNORED_KEY, shown);
}

/** Whether the review's tree leaves out the viewed files (in Changed files). */
const HIDE_VIEWED_KEY = "ovis:review-hide-viewed";

export function storedHideViewed(): boolean {
  return storedFlag(HIDE_VIEWED_KEY);
}

export function storeHideViewed(hidden: boolean): void {
  storeFlag(HIDE_VIEWED_KEY, hidden);
}

/** Whether the review's tree lists the new (untracked) files apart, under their own heading (in Changed files). */
const NEW_FILES_APART_KEY = "ovis:review-new-files-apart";

export function storedNewFilesApart(): boolean {
  return storedFlag(NEW_FILES_APART_KEY);
}

export function storeNewFilesApart(apart: boolean): void {
  storeFlag(NEW_FILES_APART_KEY, apart);
}

/**
 * Whether the review's own keys (`[` `]` `v` and the line cursor) are turned off on this device; on by default, off for
 * speech input or a habit they get in the way of (WCAG 2.1.4). Escape works either way.
 */
const REVIEW_KEYS_OFF_KEY = "ovis:review-keys-off";

export function storedReviewKeysOff(): boolean {
  return storedFlag(REVIEW_KEYS_OFF_KEY);
}

export function storeReviewKeysOff(off: boolean): void {
  storeFlag(REVIEW_KEYS_OFF_KEY, off);
}

/** How the review shows a Markdown file: its rendered preview, or its source (as a diff in Changed files). */
export type MarkdownView = "preview" | "source";

/** The Markdown view of each list, chosen apart: Changed files is read for its changes, All files for the text. */
export type MarkdownViews = Readonly<Record<"changed" | "all", MarkdownView>>;

const MARKDOWN_VIEW_PREFIX = "ovis:review-markdown-view:";
const MARKDOWN_VIEW_DEFAULTS: MarkdownViews = { changed: "source", all: "preview" };

function storedMarkdownView(scope: keyof MarkdownViews): MarkdownView {
  try {
    const value = window.localStorage.getItem(`${MARKDOWN_VIEW_PREFIX}${scope}`);
    return value === "preview" || value === "source" ? value : MARKDOWN_VIEW_DEFAULTS[scope];
  } catch {
    return MARKDOWN_VIEW_DEFAULTS[scope];
  }
}

/** Each list's Markdown view as last chosen on this device; one never chosen (or unreadable) is its list's default. */
export function storedMarkdownViews(): MarkdownViews {
  return { changed: storedMarkdownView("changed"), all: storedMarkdownView("all") };
}

/**
 * The views with `scope`'s set to `view`, kept for the next opening under that list's key alone. The choice is written
 * as it is, a default too, so another default later leaves it as chosen.
 */
export function storeMarkdownView(views: MarkdownViews, scope: keyof MarkdownViews, view: MarkdownView): MarkdownViews {
  try {
    window.localStorage.setItem(`${MARKDOWN_VIEW_PREFIX}${scope}`, view);
  } catch {
    // private mode: it holds for this opening only
  }
  return { ...views, [scope]: view };
}

/**
 * The changed files a review has marked as viewed, per device: for each repository (by PC and root), each file's path
 * with the stamp it had when it was marked (`RepoDiffFile.stamp`). A file whose stamp is another now has changed since,
 * and is not viewed any more.
 */
const VIEWED_PREFIX = "ovis:review-viewed:";

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
