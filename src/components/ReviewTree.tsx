import { useEffect, useLayoutEffect, useRef } from "react";
import { FileTree, useFileTree } from "@pierre/trees/react";

import type { TreeMark } from "../lib/review.ts";

export interface ReviewTreeProps {
  /** the files shown: every file of the repository, or those a filter keeps; relative to its root */
  paths: readonly string[];
  /** the changed files, marked by their status */
  marks: readonly TreeMark[];
  /** the file shown on the right, selected in the tree */
  selected: string | null;
  /** a filter is active: the folders of the files shown open, so the matches are visible */
  expandAll: boolean;
  /** the files marked as viewed (and unchanged since): a check after their name, `viewedTitle` its tooltip */
  viewed?: ReadonlySet<string>;
  viewedTitle?: string;
  onOpen: (path: string) => void;
}

/** Every folder that holds one of `paths`, as the tree names it (no trailing slash). */
function foldersOf(paths: readonly string[]): string[] {
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

/**
 * The repository's tree (`@pierre/trees`): folders open and close, the changed files are marked.
 * The filter is the Review's own search field (ReviewDialog.tsx), so the tree only gets the paths
 * it keeps. Only files open; a folder click just toggles it.
 */
export function ReviewTree({ paths, marks, selected, expandAll, viewed, viewedTitle = "", onOpen }: ReviewTreeProps) {
  const openRef = useRef(onOpen);
  useLayoutEffect(() => { openRef.current = onOpen; }, [onOpen]);
  // read as the rows draw: the tree takes its decoration once, as it is made
  const viewedRef = useRef({ viewed, title: viewedTitle });
  viewedRef.current = { viewed, title: viewedTitle };

  const { model } = useFileTree({
    paths: [],
    flattenEmptyDirectories: true,
    initialExpansion: "closed",
    // a viewed file's check, in the row's decoration lane before git's mark
    renderRowDecoration: ({ item }) => (viewedRef.current.viewed?.has(item.path) === true ? { text: "✓", title: viewedRef.current.title } : null),
    onSelectionChange: (selectedPaths) => {
      const last = selectedPaths[selectedPaths.length - 1];
      if (last === undefined) return;
      const item = model.getItem(last);
      if (item === null || item.isDirectory()) return;
      openRef.current(last);
    },
  });

  // the folders open with the reset itself: one by one, each would redraw the tree (seconds for a large one)
  useEffect(() => {
    model.resetPaths(paths, expandAll ? { initialExpandedPaths: foldersOf(paths) } : undefined);
  }, [model, paths, expandAll]);
  // set again with the viewed files: the rows redraw, their decorations with them
  useEffect(() => { model.setGitStatus(marks); }, [model, marks, viewed]);
  useEffect(() => {
    // no file shown (a phone's Back): the row lets go, so a tap on the same file is a selection again and opens it
    if (selected === null) {
      for (const path of model.getSelectedPaths()) model.getItem(path)?.deselect();
      return;
    }
    // the folders above the file open, so its row is one the tree draws; then the row is selected and scrolled to
    for (const folder of foldersOf([selected])) {
      const folderItem = model.getItem(folder) ?? model.getItem(`${folder}/`);
      if (folderItem !== null && "expand" in folderItem) folderItem.expand();
    }
    const item = model.getItem(selected);
    if (item !== null && !item.isSelected()) item.select();
    model.scrollToPath(selected);
    // again with new paths: a tree that loads after its file is shown (or a filter's) marks it once it lists it
  }, [model, selected, paths]);

  return <FileTree className="review-tree" model={model} />;
}
