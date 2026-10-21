/**
 * The files the review tree lists (components/ReviewDialog.tsx): the scope's paths, narrowed by
 * the filter and, in Changed, by hiding viewed files. The file being shown stays through hiding,
 * so marking it viewed does not pull it out from under the reader, but a filter that misses it
 * still drops it. The note says why the list is short, in this order: nothing changed, the filter
 * matches nothing, every remaining file is viewed. A kept file is still listed under that note.
 * In Changed, the new files can be listed apart (List new files separately), after the others:
 * the filter, hiding and the note work over both groups as over one list.
 */

import { prepareFileTreeInput } from "@pierre/trees";

/** The two lists the review shows: the changed files, or every file of the repository. */
export type ReviewScope = "changed" | "all";

export type ReviewListNote = "nothing-changed" | "no-match" | "all-viewed" | "all-matching-viewed";

export interface ReviewListInput {
  scope: ReviewScope;
  paths: readonly string[];
  /** the filter as typed */
  query: string;
  /** viewed paths to leave out, or null when nothing is hidden; All never hides */
  hidden: ReadonlySet<string> | null;
  /** the file being shown, listed even when hidden */
  keep: string | null;
  /** the new (untracked) files to list apart, or null to list them with the others; All never lists them apart */
  apart: ReadonlySet<string> | null;
}

export interface ReviewList {
  /** the files listed, the new ones listed apart left out */
  paths: readonly string[];
  /** the new files listed apart, under their own heading after `paths`; empty when none are */
  newPaths: readonly string[];
  note: ReviewListNote | null;
  /** a filter narrows the list */
  filtered: boolean;
  /** the filter trimmed and lowercased, as matched */
  query: string;
}

export function reviewList({ scope, paths, query, hidden, keep, apart }: ReviewListInput): ReviewList {
  const filter = query.trim().toLowerCase();
  const filtered = filter !== "";
  const matching = filtered ? paths.filter((path) => path.toLowerCase().includes(filter)) : paths;
  const hide = scope === "changed" ? hidden : null;
  const shown = hide === null ? matching : matching.filter((path) => !hide.has(path) || path === keep);
  let note: ReviewListNote | null = null;
  if (scope === "changed" && paths.length === 0) note = "nothing-changed";
  else if (matching.length === 0) note = "no-match";
  else if (hide !== null && matching.every((path) => hide.has(path))) note = filtered ? "all-matching-viewed" : "all-viewed";
  const split = scope === "changed" ? apart : null;
  if (split === null) return { paths: shown, newPaths: [], note, filtered, query: filter };
  return { paths: shown.filter((path) => !split.has(path)), newPaths: shown.filter((path) => split.has(path)), note, filtered, query: filter };
}

/** The one sort the review tree draws by (components/ReviewTree.tsx) and the file keys step by: folders first, numbers by value, case ignored. */
export const TREE_SORT = "default" as const;

/** A review list in the order its trees draw it. */
export interface TreeOrder {
  readonly paths: readonly string[];
  readonly newPaths: readonly string[];
  /** the path belongs with the new files listed apart */
  isNew(path: string): boolean;
}

const sortedLikeTree = (paths: readonly string[]): readonly string[] => prepareFileTreeInput(paths, { sort: TREE_SORT }).paths;

/** `list.paths` and `list.newPaths`, each in the order its tree draws; `apart` is the set the list was split by, null when it is not split. */
export function treeOrder(list: Pick<ReviewList, "paths" | "newPaths">, apart: ReadonlySet<string> | null): TreeOrder {
  return { paths: sortedLikeTree(list.paths), newPaths: sortedLikeTree(list.newPaths), isNew: (path) => apart?.has(path) === true };
}

/**
 * The file `step` away from `current`: through `paths`, then `newPaths`, without wrapping. With no file open, the first
 * or the last one. A file not listed (filtered out, opened by its path) is placed into its group where the tree would
 * sort it, so the next is the first after it and the previous the last before it. Null when there is none.
 */
export function stepFile(order: TreeOrder, current: string | null, step: 1 | -1): string | null {
  const all = [...order.paths, ...order.newPaths];
  if (all.length === 0) return null;
  if (current === null) return step === 1 ? all[0]! : all[all.length - 1]!;
  const at = all.indexOf(current);
  if (at !== -1) return all[at + step] ?? null;
  const isNew = order.isNew(current);
  const group = isNew ? order.newPaths : order.paths;
  // the files before it in its group, then the files of the groups before that
  const before = sortedLikeTree([...group, current]).indexOf(current) + (isNew ? order.paths.length : 0);
  return all[step === 1 ? before : before - 1] ?? null;
}

/**
 * The rows a review tree draws for `paths` with every folder open: one per file and one per folder, where a folder
 * whose only entry is a folder shares that folder's row (the tree flattens it, `a / b / c`). A list split in two sizes
 * each tree by it.
 */
export function drawnRows(paths: readonly string[]): number {
  // each folder's entries, a folder's own entry named with a trailing slash
  const entries = new Map<string, Set<string>>();
  for (const path of paths) {
    let child = path;
    for (let slash = path.lastIndexOf("/"); slash > 0; slash = path.lastIndexOf("/", slash - 1)) {
      const folder = path.slice(0, slash);
      const known = entries.get(folder);
      if (known === undefined) entries.set(folder, new Set([child]));
      else known.add(child);
      child = `${folder}/`;
    }
  }
  let folders = 0;
  for (const children of entries.values()) {
    const only = children.size === 1 ? [...children][0]! : null;
    if (only === null || !only.endsWith("/")) folders++;
  }
  return paths.length + folders;
}
