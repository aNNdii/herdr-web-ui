import { useEffect, useLayoutEffect, useRef, type PointerEvent } from "react";
import { FileTree, useFileTree } from "@pierre/trees/react";
import type { FileTree as FileTreeModel } from "@pierre/trees";

// the tree's own rules in its shadow root: how a long path gives way (see the file)
import treeCss from "./ReviewTree.shadow.css?inline";

import type { TreeMark } from "../lib/review.ts";
import { foldersOf, treeReset, type DrawnTree } from "../lib/reviewTreeReset.ts";

export interface ReviewTreeProps {
  /** the files shown: every file of the repository, or those a filter keeps; relative to its root */
  paths: readonly string[];
  /** the changed files, marked by their status */
  marks: readonly TreeMark[];
  /** the file shown on the right, selected in the tree */
  selected: string | null;
  /** what `paths` lists (scope and filter): a new one draws the tree fresh, the same one keeps the folders as they are */
  listing: string;
  /** a filter is active: the folders of the files shown open, so the matches are visible */
  expandAll: boolean;
  /** the files marked as viewed (and unchanged since): a check after their name, `viewedTitle` its tooltip */
  viewed?: ReadonlySet<string>;
  viewedTitle?: string;
  onOpen: (path: string) => void;
}

/** Whether the tree shows `folder` open (the tree may name it with a trailing slash). */
function isOpen(model: FileTreeModel, folder: string): boolean {
  const item = model.getItem(folder) ?? model.getItem(`${folder}/`);
  return item !== null && "isExpanded" in item && item.isExpanded();
}

/**
 * The full path of the row under the pointer as the tree's tooltip, relative to the repository's root: the rows are in
 * the tree's shadow root, so the host carries it. A flattened folder row names its deepest folder.
 */
function showRowPath(event: PointerEvent<HTMLElement>): void {
  const row = event.nativeEvent.composedPath().find((node): node is HTMLElement => node instanceof HTMLElement && node.dataset["itemPath"] !== undefined);
  // a folder's path ends with a slash in the tree
  const path = row?.dataset["itemPath"]?.replace(/\/$/, "");
  if (path === undefined) event.currentTarget.removeAttribute("title");
  else event.currentTarget.title = path;
}

/**
 * The repository's tree (`@pierre/trees`): folders open and close, the changed files are marked.
 * The filter is the Review's own search field (ReviewDialog.tsx), so the tree only gets the paths
 * it keeps. Only files open; a folder click just toggles it.
 */
export function ReviewTree({ paths, marks, selected, listing, expandAll, viewed, viewedTitle = "", onOpen }: ReviewTreeProps) {
  const openRef = useRef(onOpen);
  useLayoutEffect(() => { openRef.current = onOpen; }, [onOpen]);
  // read as the rows draw: the tree takes its decoration once, as it is made
  const viewedRef = useRef({ viewed, title: viewedTitle });
  viewedRef.current = { viewed, title: viewedTitle };

  const { model } = useFileTree({
    paths: [],
    flattenEmptyDirectories: true,
    initialExpansion: "closed",
    unsafeCSS: treeCss,
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

  // the paths drawn; the file whose folders were last opened, under which listing, and whether the tree listed it
  const drawnRef = useRef<DrawnTree | null>(null);
  const revealedRef = useRef<{ selected: string; listing: string | null; listed: boolean } | null>(null);
  // the folders open with the reset itself: one by one, each would redraw the tree (seconds for a large one). Under the
  // same listing (a viewed file hidden) the folders stay as the reader left them
  useEffect(() => {
    const reset = treeReset(drawnRef.current, paths, listing, expandAll, (folder) => isOpen(model, folder));
    if (reset === null) return;
    model.resetPaths(paths, { initialExpandedPaths: reset.expanded });
    drawnRef.current = reset.drawn;
  }, [model, paths, listing, expandAll]);
  useEffect(() => { model.setGitStatus(marks); }, [model, marks]);
  // the rows ask for their decoration (the viewed check) only as they draw, and the tree has no call to redraw them:
  // setGitStatus with the same marks does nothing, so a check would wait for another row's redraw (another file
  // chosen). Setting the icons again (the default set, as made) redraws every row, and a sprite sheet that is already
  // there is kept
  const viewedDrawn = useRef(viewed);
  useEffect(() => {
    if (viewedDrawn.current === viewed) return;
    viewedDrawn.current = viewed;
    model.setIcons(undefined);
  }, [model, viewed]);
  useEffect(() => {
    // no file shown (a phone's Back): the row lets go, so a tap on the same file is a selection again and opens it
    if (selected === null) {
      for (const path of model.getSelectedPaths()) model.getItem(path)?.deselect();
      revealedRef.current = null;
      return;
    }
    // the same file, listed already under the same listing (a viewed file hidden or shown again): its folders stay as
    // the reader left them
    const drawn = drawnRef.current, revealed = revealedRef.current;
    if (revealed?.selected === selected && revealed.listing === (drawn?.listing ?? null) && revealed.listed) return;
    revealedRef.current = { selected, listing: drawn?.listing ?? null, listed: drawn?.paths.includes(selected) === true };
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

  return <FileTree className="review-tree" model={model} onPointerOver={showRowPath} />;
}
