/**
 * When the review tree (components/ReviewTree.tsx) draws its paths again, and which folders open then. A new
 * listing (another scope or filter) is drawn fresh, as before: with expandAll every folder opens, so the matches
 * show. Under the same listing a list that changed (a viewed file hidden, or shown again) keeps the folders the
 * reader opened and closed; only a folder it did not have yet opens, and only with expandAll.
 */

/** What the tree drew last: its paths, their folders, the listing they came from, and whether all opened. */
export interface DrawnTree {
  paths: readonly string[];
  folders: ReadonlySet<string>;
  listing: string;
  expandAll: boolean;
}

/** Every folder that holds one of `paths`, as the tree names it (no trailing slash). */
export function foldersOf(paths: readonly string[]): string[] {
  const folders = new Set<string>();
  for (const path of paths) {
    let slash = path.lastIndexOf("/");
    while (slash > 0) {
      const folder = path.slice(0, slash);
      if (folders.has(folder)) break;
      folders.add(folder);
      slash = path.lastIndexOf("/", slash - 1);
    }
  }
  return [...folders];
}

function samePaths(one: readonly string[], other: readonly string[]): boolean {
  return one.length === other.length && one.every((path, index) => path === other[index]);
}

/**
 * The folders to open as `paths` are drawn, and the tree drawn then; null when `paths` is the list drawn already
 * (the same listing, the same paths). `isOpen` reads a folder's state in the tree drawn now.
 */
export function treeReset(drawn: DrawnTree | null, paths: readonly string[], listing: string, expandAll: boolean,
  isOpen: (folder: string) => boolean): { expanded: string[]; drawn: DrawnTree } | null {
  const same = drawn !== null && drawn.listing === listing && drawn.expandAll === expandAll;
  if (same && samePaths(drawn.paths, paths)) return null;
  const folders = foldersOf(paths);
  const expanded = same ? folders.filter((folder) => (drawn.folders.has(folder) ? isOpen(folder) : expandAll)) : expandAll ? folders : [];
  return { expanded, drawn: { paths, folders: new Set(folders), listing, expandAll } };
}
