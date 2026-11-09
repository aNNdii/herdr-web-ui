/**
 * The docked comments panel (CommentsPanel.tsx) beside the pane, which shares that place with upstream's docked file,
 * Files beside the pane and web panel (useFilePanels.ts): one of them shows there at a time, the one opened last.
 *
 * - Opened, the panel covers whichever is there, as a docked file or web page covers Files beside the pane: the file
 *   and the web page are not drawn meanwhile, Files stays mounted but hidden (`filesCovered`). Each is back as the panel
 *   closes; a web page loads again then.
 * - A docked file, a web page or Files beside the pane opened while the panel is open closes it, as a docked file and a
 *   web page take each other's place; so does asking for Files beside the pane again (`revealFiles`: its button, the
 *   palette). Files as a dialog opens over the panel and leaves it.
 *
 * Where no file panel docks (`available` false) the panel is a dialog over everything and none of this applies. A file
 * of the fork's own, so App takes it with one hook call (docs/fork.md, src/app-hooks.test.ts).
 */
import { useCallback, useEffect, useRef } from "react";

import { commentsPanel, useCommentsPanel } from "./commentsPanel.ts";

export interface CommentsPanelDockParams {
  /** a file panel docks beside the pane (App's `filePanelAvailable`) */
  available: boolean;
  /** the docked file's key (`fileViewerKey`), null while no file is docked */
  file: string | null;
  /** the web panel's page, null while none is open */
  webPage: string | null;
  /** useFilePanels' `filesOpen` and `filesDocked`: Files is open, and beside the pane */
  filesOpen: boolean;
  filesDocked: boolean;
  /** useFilePanels' `filesCovered`: a docked file or web page over Files */
  filesCovered: boolean;
  /** useFilePanels' `revealFiles` */
  revealFiles: () => void;
}

export interface CommentsPanelDock {
  /** the panel is open in the place beside the pane: the docked file and the web page are not drawn */
  docked: boolean;
  /** `filesCovered`, or the docked panel over Files */
  filesCovered: boolean;
  /** `revealFiles`, which also closes the docked panel when Files opens beside the pane */
  revealFiles: () => void;
}

export function useCommentsPanelDock({ available, file, webPage, filesOpen, filesDocked, filesCovered, revealFiles }: CommentsPanelDockParams): CommentsPanelDock {
  const panel = useCommentsPanel();
  const docked = available && panel !== null;
  const filesBeside = filesOpen && filesDocked;
  const last = useRef({ file, webPage, filesBeside });
  useEffect(() => {
    const before = last.current;
    last.current = { file, webPage, filesBeside };
    if (!available || commentsPanel.current() === null) return;
    const opened = (file !== null && file !== before.file) || (webPage !== null && webPage !== before.webPage) || (filesBeside && !before.filesBeside);
    if (opened) commentsPanel.close();
  }, [available, file, webPage, filesBeside]);
  const reveal = useCallback(() => {
    if (available && filesDocked) commentsPanel.close();
    revealFiles();
  }, [available, filesDocked, revealFiles]);
  return { docked, filesCovered: filesCovered || docked, revealFiles: reveal };
}
