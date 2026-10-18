/**
 * The file viewer's comment layer: comments on lines of the file the viewer shows, kept with the
 * pane it was opened from. It finds this file's comments in the pane's store and places each one
 * on the lines it was written on, or where those lines moved (`placeFileComment`); one that is
 * nowhere to be found is outdated. The Markdown preview's comments are the comment layer's (MarkdownComments.tsx), which
 * this file gives the preview's side (`usePreviewCommentSource`): the comments shown, their highlights, and how a
 * selection there becomes a target; and how the layer's margin shows beside the preview's text (`usePreviewMargin`). The code view has its own layer (CodeComments.tsx), which shares the comments, their
 * targets (`linesTarget`, `targetOf`) and their highlights (`useFileCommentHighlights`) with it. The composer's walk stops
 * at the file's comments (`useFileCommentWalk`): on a card in the code view, on a comment the preview's layer shows
 * (lib/shownComments.ts), an outdated one in a dialog.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode, type RefObject } from "react";

import { blockComments, isFileEntry, useBlockComments } from "../lib/blockComments.ts";
import { popoverOutlived } from "../lib/commentPopover.ts";
import { markCommentSurface } from "../lib/commentHighlight.ts";
import { commentAt } from "../lib/commentSource.ts";
import { lastFileStop } from "../lib/commentWalk.ts";
import { lineElementsIn, lineRanges, measureFileSelection, unfoldAt } from "../lib/fileCommentDom.ts";
import { watchFileCommentHighlights } from "../lib/fileCommentHighlight.ts";
import { fileCommentAt, placeFileComment, type FileComment, type FileTarget, type FileView, type LineRange } from "../lib/fileComments.ts";
import { useT } from "../lib/i18n.ts";
import { marginLayout } from "../lib/commentMargin.ts";
import { useSettings, type CommentLayout } from "../lib/settings.ts";
import { markShownComment, openShownComment } from "../lib/shownComments.ts";
import { CommentPopover } from "./CommentPopover.tsx";
import type { CommentSource, LayerComment } from "./MarkdownComments.tsx";
import { useSurfaceRanges } from "./useSurfaceRanges.ts";

/** The file a viewer shows comments on, and of which pane. */
export interface FileCommentScope {
  /** the pane's store owner, `paneStorageId(machineId, paneId)` */
  owner: string;
  /** absolute, as the viewer resolved it (`FileInfo.path`) */
  path: string;
  /** how a quote names the file (`pathLabel`) */
  label: string;
  view: FileView;
  /** the file's lines as loaded (`fileLines`) */
  lines: readonly string[];
  /** how many leading lines are complete: a file cut at the load limit takes comments up to its cut */
  loaded: number;
  /** whether the file was cut at the load limit: then a comment stays on its lines or is outdated, never moved (`placeFileComment`) */
  truncated: boolean;
}

/** A comment of the file with the lines it is on now. */
export interface PlacedFileComment {
  comment: FileComment;
  lines: LineRange;
}

/** The comments of a file in its pane, as placed in the file loaded (`useFileComments`). */
export interface FileComments {
  /** placed, and of the view shown */
  shown: PlacedFileComment[];
  /** their lines are nowhere in the loaded file */
  outdated: FileComment[];
  /** every comment of the file, of either view */
  all: FileComment[];
}

/** Bound once: a class method handed on loses its `this`. */
const persistFile = blockComments.saveFile.bind(blockComments);

/**
 * The target a stored comment was written on, to edit it: with its stored anchor, so the edit
 * replaces this comment wherever a move left it (`saveFile`), never the one now on its lines' anchor.
 */
export function targetOf(comment: FileComment): FileTarget {
  const { path, label, view, lines, source, quoteLines, selection, anchor, point } = comment;
  return { path, label, view, lines, source, quoteLines, anchor, ...(selection === undefined ? {} : { selection }), ...(point === undefined ? {} : { point }) };
}

/**
 * The target `found` lines make in `scope`'s file as loaded, with the pane it is kept in: the file's raw lines there as
 * its source, `found`'s quote and selection. Null without a scope, or on the cut-off last line of a file cut short (past
 * `scope.loaded`). The preview's source (`usePreviewCommentSource`) and the code view's layer (`useCodeComments`) both build their
 * targets here.
 */
export function linesTarget(scope: FileCommentScope | null, found: { lines: LineRange; quoteLines: string[]; selection?: FileTarget["selection"] }): { owner: string; target: FileTarget } | null {
  if (scope === null || found.lines[1] > scope.loaded) return null;
  return {
    owner: scope.owner,
    target: {
      path: scope.path, label: scope.label, view: scope.view, lines: found.lines,
      source: scope.lines.slice(found.lines[0] - 1, found.lines[1]), quoteLines: found.quoteLines,
      ...(found.selection === undefined ? {} : { selection: found.selection }),
    },
  };
}

/**
 * The comments of `scope`'s file in its pane: those shown (placed, of this view), those outdated
 * (their lines are nowhere in the loaded file) and all of them. Placing runs again only when the
 * comments or the file's lines change. A comment found again on other lines is moved there in the
 * store, once, so the next message names the lines it is on now. With comments turned off the
 * store lists none (`BlockCommentStore.setEnabled`): the file has none, and nothing stored is moved,
 * so what another tab that still has them on stores meanwhile is left as it is.
 */
export function useFileComments(scope: FileCommentScope | null): FileComments {
  const comments = useBlockComments(scope?.owner ?? "");
  const owner = scope?.owner;
  const path = scope?.path;
  const view = scope?.view;
  const lines = scope?.lines;
  const loaded = scope?.loaded ?? 0;
  const truncated = scope?.truncated ?? false;
  const all = useMemo(() => path === undefined ? [] : comments.filter((c): c is FileComment => isFileEntry(c) && c.path === path), [comments, path]);
  const placed = useMemo(() => all.map((comment) => ({ comment, lines: lines === undefined ? null : placeFileComment(comment, lines, loaded, truncated) })), [all, lines, loaded, truncated]);
  const moved = useRef(new Set<string>());
  useEffect(() => {
    if (owner === undefined) return;
    for (const { comment, lines: now } of placed) {
      if (now === null || (now[0] === comment.lines[0] && now[1] === comment.lines[1])) continue;
      const key = `${comment.id}:${now[0]}-${now[1]}`;
      if (moved.current.has(key)) continue;
      moved.current.add(key);
      blockComments.moveFile(owner, comment.id, now);
    }
  }, [owner, placed]);
  return useMemo(() => ({
    shown: placed.filter((p): p is PlacedFileComment => p.lines !== null && p.comment.view === view),
    outdated: placed.filter((p) => p.lines === null).map((p) => p.comment),
    all,
  }), [placed, view, all]);
}

/**
 * The Markdown preview's side of the comment layer (MarkdownComments.tsx `MarkdownCommentLayer`): the comments shown in
 * the preview of `scope`'s file, highlighted in its `content` (its `.markdown` root) inside `surface` (the viewer's
 * scrolling body), and how a selection there becomes a target: the line elements it covers (`measureFileSelection`), in
 * the file's loaded lines (`linesTarget`), on the comment stored there if there is one (`fileCommentAt`). The viewer
 * passes null for the code view, which has its own layer (CodeComments.tsx); with no scope, or comments turned off,
 * there is no source. `comments` are the file's comments as placed (`useFileComments`, called once for both views): in
 * the store's order for a file (lib/fileComments.ts `sortFileComments`: by first line, then selection start), which is
 * reading order.
 */
export function usePreviewCommentSource(scope: FileCommentScope | null, surface: RefObject<HTMLDivElement | null>, content: RefObject<HTMLElement | null>, comments: FileComments): CommentSource<FileTarget> | null {
  const { settings } = useSettings();
  const { shown } = comments;
  const watcher = useRef<FileHighlightWatcher | null>(null);
  const root = useFileCommentHighlights(scope !== null, surface, content, shown, watcher);
  // each comment's ranges as the highlights last built them: what the layer places a comment's field over
  const rangesOf = useSurfaceRanges(surface, root !== null);
  // the viewer's body is the surface the margin's cards and counts bring their text up on (lib/commentHighlight.ts
  // `activateComment`) while the preview takes comments: marked here, as the chat's source marks its scroller
  const enabled = scope !== null && settings.comments;
  useLayoutEffect(() => {
    const body = surface.current;
    if (!enabled || body === null) return;
    return markCommentSurface(body);
  }, [enabled, surface]);
  return useMemo(() => {
    if (scope === null || !settings.comments) return null;
    const { owner } = scope;
    const quoteOf = (target: FileTarget): string => target.selection?.text ?? target.quoteLines.join("\n");
    const shownComments = shown.map(({ comment, lines }): LayerComment<FileTarget> => ({
      id: comment.id,
      comment: comment.comment,
      quote: quoteOf(comment),
      target: targetOf(comment),
      // a comment the highlights have not been rebuilt for yet (just saved: an edit is a comment of a new id) is measured
      // as they will measure it, so its card stays in the margin meanwhile
      ranges: () => rangesOf(comment.id, () => content.current === null ? [] : lineRanges(lineElementsIn(content.current, lines), comment.selection)),
    }));
    return {
      owner,
      comments: shownComments,
      at: (range) => {
        const node = content.current;
        const found = node === null ? null : measureFileSelection(range, node);
        const target = found === null ? null : linesTarget(scope, found)?.target ?? null;
        if (target === null) return null;
        // the comment written there already, as the store finds it on save: an edit replaces it
        const id = fileCommentAt(blockComments.list(owner).filter(isFileEntry), target)?.id;
        return commentAt(shownComments, id, target, quoteOf(target));
      },
      persist: (target, text) => persistFile(owner, target, text),
      remove: (id) => blockComments.remove(owner, [id]),
    };
  }, [scope, settings.comments, shown, content, rangesOf]);
}

/**
 * How the comment layer's margin (MarkdownComments.tsx, CommentMargin.tsx) shows beside the preview's text, while the
 * preview takes comments (`active`): from the free space right of its `content` root (`.file-viewer-markdown`, where
 * Settings → Markdown width puts it, centred) up to the right edge of the viewer's scrolling body (`surface`, its
 * padding included), `marginLayout` says whether cards fit there or counts show (also when `wanted` says cards). The
 * text is only measured: it keeps the place and width it has with comments off. Only the room and the setting decide,
 * never whether there are comments: the first one saved moves nothing. Followed as the text or the body is resized.
 * Returns the text and the layout; null while inactive.
 */
export function usePreviewMargin(active: boolean, content: RefObject<HTMLElement | null>, surface: RefObject<HTMLElement | null>, wanted: CommentLayout): { text: HTMLElement; layout: CommentLayout } | null {
  const [text, setText] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => { setText(active ? content.current : null); });
  const [layout, setLayout] = useState<CommentLayout | null>(null);
  useLayoutEffect(() => {
    const body = surface.current;
    if (text === null || body === null) {
      setLayout(null);
      return;
    }
    const apply = (): void => {
      const box = text.getBoundingClientRect();
      const style = getComputedStyle(text);
      const outer = body.getBoundingClientRect();
      const placed = marginLayout({
        textRight: box.right - Number.parseFloat(style.paddingRight) - Number.parseFloat(style.borderRightWidth),
        containerRight: outer.left + body.clientLeft + body.clientWidth,
        minimapGutter: 0,
        wanted,
        // the layout does not depend on the pointer: only where a count's target goes does (CommentMargin.tsx)
        coarse: false,
      });
      setLayout(placed.layout);
    };
    apply();
    const resized = new ResizeObserver(apply);
    resized.observe(text);
    resized.observe(body);
    return () => resized.disconnect();
  }, [text, surface, wanted]);
  return text === null || layout === null ? null : { text, layout };
}

/** What `watchFileCommentHighlights` returns: `show` the comments, `setPending` the one being written. */
export type FileHighlightWatcher = ReturnType<typeof watchFileCommentHighlights>;

/**
 * Highlights what each of `shown` is on in the file's `content` while the view takes comments (`active`), through
 * `watchFileCommentHighlights` on `surface` (the viewer's body); `watcher` holds the watcher while there is one, for its
 * `setPending`. Returns the content root it watches, as drawn now (another one, a view switched or a file reloaded, is
 * watched anew): a caller shows its pending comment again when it changes. Used by the preview's layer and the code's.
 */
export function useFileCommentHighlights(active: boolean, surface: RefObject<HTMLDivElement | null>, content: RefObject<HTMLElement | null>, shown: readonly PlacedFileComment[], watcher: MutableRefObject<FileHighlightWatcher | null>): HTMLElement | null {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => { setRoot(active ? content.current : null); });
  useLayoutEffect(() => {
    const body = surface.current;
    if (root === null || body === null) return;
    const watching = watchFileCommentHighlights(body, root);
    watcher.current = watching;
    return () => {
      watching.dispose();
      if (watcher.current === watching) watcher.current = null;
    };
  }, [root, surface, watcher]);
  const marks = useMemo(() => shown.map(({ comment, lines }) => ({ id: comment.id, lines, selection: comment.selection })), [shown]);
  useLayoutEffect(() => { watcher.current?.show(marks); }, [marks, root, watcher]);
  return root;
}

/** How long a stop waits for its card or count to be drawn (a view switched, a code block unfolded, the margin placed) before it gives up. */
const STOP_WAIT_MS = 1000;

/**
 * The composer's walk into the viewer's file: `goTo` is one stop, by comment id (the composer's bar walks the comments in
 * the order they are sent, `sortFileComments`). A stop on a comment written in the other view switches the view
 * (`showView`) and goes on once it is drawn. In the code view it stands on the comment's card (`codeStop`, CodeComments.tsx);
 * in the preview a code block that folds its lines away is unfolded first (`unfoldAt`), then the comment layer opens it
 * (`openShownComment`, MarkdownComments.tsx: scrolled to in the viewer's body, its field open in the comment mode, else
 * marked), and its mark goes with the next stop, a click or the viewer. An outdated comment opens in a dialog, its
 * field filled, with a note that its part of the file has changed, and one whose text or card is not drawn within
 * `STOP_WAIT_MS` without a note. `openInEditor` opens a stored comment in that dialog with another note, where its file
 * cannot be shown to place it (the viewer opened at it on a file it cannot read); `editor` goes into the viewer, and
 * `editorOpen` keeps its Escape for the dialog. The dialog closes as the popover does: with comments turned off, and,
 * while nothing is typed in it, once its comment is no longer stored.
 */
export function useFileCommentWalk({ owner, view, comments, surface, content, showView, codeStop }: {
  /** the pane's store owner; null without a pane */
  owner: string | null;
  /** the view shown now; null while it takes no comments */
  view: FileView | null;
  comments: FileComments;
  /** the viewer's body, the comment surface the preview's layer registers its comments on */
  surface: RefObject<HTMLDivElement | null>;
  /** the file's content root in the view shown (the code's `<pre>`, the preview's `.markdown`) */
  content: RefObject<HTMLElement | null>;
  /** shows the file in `view` */
  showView: (view: FileView) => void;
  /** stands on comment `id` in the code view (`useCodeComments().stop`); false while its card is not drawn */
  codeStop: (id: string) => boolean;
}): { goTo: (id: string) => boolean; openInEditor: (comment: FileComment, note: string) => void; editor: ReactNode; editorOpen: boolean } {
  const t = useT();
  const { settings } = useSettings();
  // the comment open in the dialog, and why it is there rather than on its lines
  const [modal, setModal] = useState<{ opening: number; comment: FileComment; note?: string } | null>(null);
  const openings = useRef(0);
  // what its field holds (`onText`): a change typed keeps the dialog when its comment leaves the store
  const modalText = useRef("");
  // where the focus goes back to as the dialog closes: what had it as the dialog opened
  const returnTo = useRef<HTMLElement | null>(null);
  const showModal = useCallback((comment: FileComment, note?: string): void => {
    returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modalText.current = comment.comment;
    setModal({ opening: ++openings.current, comment, ...(note === undefined ? {} : { note }) });
  }, []);
  const stored = useBlockComments(owner ?? "");
  useEffect(() => {
    if (modal === null) return;
    if (!settings.comments || popoverOutlived({ commentId: modal.comment.id, initialComment: modal.comment.comment }, stored, modalText.current)) setModal(null);
  }, [modal, settings.comments, stored]);
  const latest = useRef({ owner, view, comments, showView, content, codeStop });
  latest.current = { owner, view, comments, showView, content, codeStop };
  const frame = useRef(0);
  /** The viewer's body where the preview's layer marks the comment the walk stands on, until the next stop or a click. The code view's card is `codeStop`'s. */
  const current = useRef<Element | null>(null);
  const clearCurrent = useCallback((): void => {
    const view = current.current;
    if (view === null) return;
    markShownComment(view, null);
    current.current = null;
  }, []);
  useEffect(() => {
    // a click, not a press, as in the composer's walk: in the capture phase, so the click that walks on clears the old mark first.
    // A stop still waiting for its comment is given up too: what was clicked meanwhile is not covered by a dialog later. The
    // stop's own click (a Show all) comes while it is not waiting
    const onClick = (): void => {
      window.cancelAnimationFrame(frame.current);
      frame.current = 0;
      clearCurrent();
    };
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.cancelAnimationFrame(frame.current);
      clearCurrent();
    };
  }, [clearCurrent]);

  /**
   * Stands on comment `id` once it is drawn in the view shown: in the code view its card (`codeStop`); in the preview its
   * lines unfolded first (`unfoldAt`), then the comment layer's stop (`openShownComment`). Tried each frame; after
   * `STOP_WAIT_MS` without either, the comment opens in the dialog.
   */
  const stopAt = useCallback((id: string): void => {
    window.cancelAnimationFrame(frame.current);
    const deadline = performance.now() + STOP_WAIT_MS;
    const attempt = (): void => {
      frame.current = 0;
      const body = surface.current;
      const root = latest.current.content.current;
      if (latest.current.view === "code") {
        if (latest.current.codeStop(id)) return;
      } else {
        const placed = latest.current.comments.shown.find(({ comment }) => comment.id === id);
        // the layer scrolls to it and opens it (the mode on) or marks it (off), which the next stop or a click clears
        if (body !== null && root !== null && placed !== undefined && unfoldAt(root, placed.lines[1]) && openShownComment(body, id)) {
          current.current = body;
          return;
        }
      }
      if (performance.now() < deadline) { frame.current = window.requestAnimationFrame(attempt); return; }
      // no card or count by then (its text is not drawn: a line the preview has no element for, a view that did not switch,
      // a file with too many lines for a card): it opens in the dialog
      const comment = latest.current.comments.all.find((c) => c.id === id);
      if (comment !== undefined) showModal(comment);
    };
    attempt();
  }, [surface, showModal]);

  const goTo = useCallback((id: string): boolean => {
    const { owner, view, comments, showView } = latest.current;
    const comment = comments.all.find((c) => c.id === id);
    if (owner === null || comment === undefined) return false;
    lastFileStop.set(owner, id);
    window.cancelAnimationFrame(frame.current);
    clearCurrent();
    if (comments.outdated.some((c) => c.id === id)) {
      showModal(comment, t("This part of the file has changed since."));
      return true;
    }
    if (comment.view !== view) showView(comment.view);
    stopAt(id);
    return true;
  }, [clearCurrent, stopAt, showModal, t]);

  const openInEditor = useCallback((comment: FileComment, note: string): void => {
    const { owner } = latest.current;
    if (owner === null) return;
    lastFileStop.set(owner, comment.id);
    window.cancelAnimationFrame(frame.current);
    clearCurrent();
    showModal(comment, note);
  }, [clearCurrent, showModal]);

  const closeEditor = useCallback(() => setModal(null), []);
  const editor = owner !== null && modal !== null && settings.comments && <CommentPopover
    key={modal.opening}
    placement="dialog"
    quote={{ text: modal.comment.quoteLines.join("\n") }}
    reference={{ path: modal.comment.path, lines: modal.comment.lines }}
    note={modal.note}
    comment={modal.comment.comment}
    onText={(text) => { modalText.current = text; }}
    onSave={(text) => {
      // an edit gives the comment a new id: the walk goes on from it
      const saved = persistFile(owner, targetOf(modal.comment), text);
      if (saved !== null) lastFileStop.set(owner, saved);
      setModal(null);
    }}
    onDelete={() => {
      blockComments.remove(owner, [modal.comment.id]);
      setModal(null);
    }}
    onClose={closeEditor}
    // asked after the commit that closes it: what had the focus as it opened, while it is still there
    opener={() => returnTo.current?.isConnected ? returnTo.current : null}
    fallback={() => null}
  />;
  return { goTo, openInEditor, editor, editorOpen: modal !== null };
}
