/**
 * The file viewer's comment layer: comments on lines of the file the viewer shows, kept with the
 * pane it was opened from. It finds this file's comments in the pane's store and places each one
 * on the lines it was written on, or where those lines moved (`placeFileComment`); one that is
 * nowhere to be found is outdated. It owns the viewer's one comment form (`useCommentForm`), opened
 * by a selection's Comment button or a card's Edit, as in the chat; and it highlights what each comment is on. The cards and the form
 * are the chat's (CommentCard.tsx); the view draws them where `FileCommentsContext` says. The code
 * view hangs a comment's card under its last line, the Markdown preview under the block that holds
 * its last line (`previewHosts`). The viewer's header walks the file's comments
 * (`useFileCommentWalk`), an outdated one in the modal editor.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";

import { blockComments, isReplyComment, useBlockComments } from "../lib/blockComments.ts";
import { markCurrentComment, showWalkStop } from "../lib/commentHighlight.ts";
import { lastFileStop } from "../lib/commentWalk.ts";
import { codeCopyText, measureFileSelection } from "../lib/fileCommentDom.ts";
import { watchFileCommentHighlights } from "../lib/fileCommentHighlight.ts";
import { assignHosts, fileCommentAt, placeFileComment, sortFileComments, type FileComment, type FileTarget, type FileView, type LineRange } from "../lib/fileComments.ts";
import { useT } from "../lib/i18n.ts";
import { CommentCard, CommentForm } from "./CommentCard.tsx";
import { CommentEditor } from "./CommentEditor.tsx";
import type { FileCommentsApi, MeasuredFileSelection } from "./FileCommentsContext.ts";
import { SelectionCommentButton } from "./SelectionCommentButton.tsx";
import { useCommentForm } from "./useCommentForm.ts";

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
  /**
   * Where the cards hang in the preview: the source lines of each block a card can follow
   * (`previewHosts`), in document order. Null in the code view, where a card follows its comment's last line.
   */
  hosts: readonly LineRange[] | null;
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

export { FileCommentsContext, type FileCommentsApi, type MeasuredFileSelection } from "./FileCommentsContext.ts";

const NONE: readonly never[] = [];

/** Bound once: a class method handed on loses its `this`. */
const persistFile = blockComments.saveFile.bind(blockComments);

/**
 * The target a stored comment was written on, to edit it: with its stored anchor, so the edit
 * replaces this comment wherever a move left it (`saveFile`), never the one now on its lines' anchor.
 */
function targetOf(comment: FileComment): FileTarget {
  const { path, label, view, lines, source, quoteLines, selection, anchor } = comment;
  return { path, label, view, lines, source, quoteLines, anchor, ...(selection === undefined ? {} : { selection }) };
}

/**
 * The comments of `scope`'s file in its pane: those shown (placed, of this view), those outdated
 * (their lines are nowhere in the loaded file) and all of them. Placing runs again only when the
 * comments or the file's lines change. A comment found again on other lines is moved there in the
 * store, once, so the next message names the lines it is on now.
 */
export function useFileComments(scope: FileCommentScope | null): FileComments {
  const comments = useBlockComments(scope?.owner ?? "");
  const owner = scope?.owner;
  const path = scope?.path;
  const view = scope?.view;
  const lines = scope?.lines;
  const loaded = scope?.loaded ?? 0;
  const truncated = scope?.truncated ?? false;
  const all = useMemo(() => path === undefined ? [] : comments.filter((c): c is FileComment => !isReplyComment(c) && c.path === path), [comments, path]);
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

/** The first line of the host a comment on `lines` hangs under: in the preview the block holding its last line (`assignHosts`), in the code that line. */
function hostOf(hosts: readonly LineRange[] | null, lines: LineRange): number | null {
  return hosts === null ? lines[1] : assignHosts(hosts, [{ id: "", lines }]).keys().next().value ?? null;
}

/**
 * The comment layer of the viewer's `surface` (its scrolling body, which carries
 * `data-comment-surface`) over the file's `content` (the code's `<pre>`, or the preview's
 * `.markdown` root), for `scope`'s file; null while the view takes no comments. `api` goes to the view (`FileCommentsContext`); `overlay` goes into the
 * surface (the Comment button, and the modal editor where the view has no place
 * for the form); `formOpen` keeps the viewer's Escape for the form; `comments` are the file's
 * comments as placed, for the header's counter and walk.
 */
export function useFileCommentLayer(scope: FileCommentScope | null, surface: RefObject<HTMLDivElement>, content: RefObject<HTMLElement>): {
  api: FileCommentsApi | null;
  overlay: ReactNode;
  formOpen: boolean;
  comments: FileComments;
} {
  const comments = useFileComments(scope);
  const { shown } = comments;
  const { editing, open, save, close, edit, typed } = useCommentForm<FileTarget>({ view: surface, persist: persistFile });
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const owner = scope?.owner ?? null;
  const path = scope?.path ?? null;
  const view = scope?.view ?? null;
  const hosts = scope?.hosts ?? null;

  /** Opens the form on `target`, with the comment already written there. */
  const openTarget = useCallback((target: FileTarget, fromSelection: boolean): void => {
    const current = scopeRef.current;
    if (current === null) return;
    // the comment written there already, which the form edits (`fileCommentAt`, as the store finds it on save)
    const existing = fileCommentAt(blockComments.list(current.owner).filter((c): c is FileComment => !isReplyComment(c)), target);
    open(current.owner, target, existing?.comment ?? "", fromSelection);
  }, [open]);
  const openSelection = useCallback((found: MeasuredFileSelection): void => {
    const current = scopeRef.current;
    if (current === null || found.lines[1] > current.loaded) return;
    openTarget({
      path: current.path, label: current.label, view: current.view, lines: found.lines,
      source: current.lines.slice(found.lines[0] - 1, found.lines[1]), quoteLines: found.quoteLines, selection: found.selection,
    }, true);
  }, [openTarget]);
  /** A selection in the loaded lines of the file; a card's text or the cut-off last line is none. */
  const measure = useCallback((selection: Selection | null): MeasuredFileSelection | null => {
    const root = content.current;
    const found = root === null ? null : measureFileSelection(selection, root);
    return found !== null && found.lines[1] <= (scopeRef.current?.loaded ?? 0) ? found : null;
  }, [content]);

  // the cards hang under the last line of their comment (code) or the block holding it (preview); the
  // open form under its comment's, or the lines it is written on
  const byHost = useMemo(() => {
    const placed = new Map<number, PlacedFileComment[]>();
    if (hosts === null) {
      for (const one of shown) {
        const list = placed.get(one.lines[1]);
        if (list === undefined) placed.set(one.lines[1], [one]);
        else list.push(one);
      }
      return placed;
    }
    const byId = new Map(shown.map((one) => [one.comment.id, one]));
    for (const [host, ids] of assignHosts(hosts, shown.map(({ comment, lines }) => ({ id: comment.id, lines })))) {
      placed.set(host, ids.map((id) => byId.get(id)!));
    }
    return placed;
  }, [shown, hosts]);
  const form = edit !== null && edit.owner === owner && edit.target.path === path && edit.target.view === view ? edit : null;
  // the card the form takes the place of: the comment its save will replace (`fileCommentAt`)
  const formComment = form === null ? undefined : fileCommentAt(shown.map(({ comment }) => comment), form.target);
  const replaces = formComment === undefined ? null : shown.find(({ comment }) => comment === formComment) ?? null;
  const formHost = form === null ? null : hostOf(hosts, replaces?.lines ?? form.target.lines);
  const notesFor = useCallback((host: number): ReactNode => {
    const items = byHost.get(host) ?? NONE;
    const here = host === formHost ? form : null;
    if (owner === null || (items.length === 0 && here === null)) return null;
    const anchors = items.map(({ comment }) => comment.anchor);
    // keyed by anchor: an edit gives the comment a new id but keeps its card's element. The form of
    // an edit takes its card's place; a new comment's goes after the cards
    return <>
      {items.map(({ comment, lines }) => here !== null && replaces?.comment.id === comment.id
        ? <CommentForm key={comment.anchor} edit={here} replaces={comment} anchors={anchors} reference={{ path: comment.path, lines }} />
        : <CommentCard key={comment.anchor} comment={comment} anchors={anchors} reference={{ path: comment.path, lines }}
          onEdit={() => open(owner, targetOf(comment), comment.comment)}
          onDelete={() => blockComments.remove(owner, [comment.id])} />)}
      {here !== null && replaces === null && <CommentForm key={`new-${here.id}`} edit={here} replaces={null} anchors={anchors} reference={{ path: here.target.path, lines: here.target.lines }} />}
    </>;
  }, [byHost, form, formHost, replaces, owner, open]);
  const noted = useMemo(() => {
    const hosts = [...byHost.keys()];
    if (formHost !== null && !byHost.has(formHost)) hosts.push(formHost);
    return hosts;
  }, [byHost, formHost]);
  const formOpen = editing !== null;
  // the same object while nothing in it changes: the code view rebuilds its notes for a new one
  const active = scope !== null;
  const api = useMemo<FileCommentsApi | null>(() => active ? { notesFor, openSelection, editing: formOpen, noted } : null,
    [active, notesFor, openSelection, formOpen, noted]);

  // the content as drawn now: another one (a view switched, a file reloaded) is watched anew
  const [root, setRoot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => { setRoot(scope === null ? null : content.current); });
  // the code view's <pre>; the preview's copy is the browser's
  const pre = view === "code" && root instanceof HTMLPreElement ? root : null;

  // what each comment is on is highlighted, and the selection the open form is for
  const watcher = useRef<ReturnType<typeof watchFileCommentHighlights> | null>(null);
  useEffect(() => {
    const body = surface.current;
    if (root === null || body === null) return;
    const watching = watchFileCommentHighlights(body, root);
    watcher.current = watching;
    return () => {
      watching.dispose();
      if (watcher.current === watching) watcher.current = null;
    };
  }, [root, surface]);
  const marks = useMemo(() => shown.map(({ comment, lines }) => ({ id: comment.id, lines, selection: comment.selection })), [shown]);
  useEffect(() => { watcher.current?.show(marks); }, [marks, root]);
  const pending = editing !== null && !editing.modal && editing.selection ? editing.target : null;
  useEffect(() => {
    watcher.current?.setPending(pending === null ? null : { id: "", lines: pending.lines, selection: pending.selection });
  }, [pending, root]);

  // In the code view a copy that runs over cards takes the code alone
  useEffect(() => {
    if (pre === null) return;
    const onCopy = (event: ClipboardEvent): void => {
      const selection = window.getSelection();
      const text = selection === null ? null : codeCopyText(selection, pre);
      if (text === null || event.clipboardData === null) return;
      event.preventDefault();
      event.clipboardData.setData("text/plain", text);
    };
    pre.addEventListener("copy", onCopy);
    return () => pre.removeEventListener("copy", onCopy);
  }, [pre]);

  const overlay = <>
    {scope !== null && <SelectionCommentButton view={surface} measure={measure} onComment={openSelection} />}
    {/* the form's place left the view (another view of the file): the modal takes over with what was typed */}
    {editing !== null && editing.modal && <CommentEditor
      reference={{ path: editing.target.path, lines: editing.target.lines }}
      quote={editing.target.quoteLines.join("\n")}
      initialComment={editing.initialComment}
      startValue={typed()}
      onSave={save}
      onClose={close}
      fallback={() => null}
    />}
  </>;
  return { api, overlay, formOpen, comments };
}

/** How long a stop waits for its card to be drawn (a view switched, a code block unfolded) before it gives up. */
const STOP_WAIT_MS = 1000;

/**
 * Where the preview folds the code block a card follows ("Show all") and the comment's `last` line
 * is folded away in it, unfolds it: its text cannot be highlighted or scrolled to while hidden.
 * True when the comment's lines are drawn.
 */
function unfoldFor(card: HTMLElement, last: number): boolean {
  const host = card.closest(".file-comment-notes")?.previousElementSibling ?? null;
  const more = host?.querySelector<HTMLButtonElement>(".markdown-code-more[aria-expanded='false']") ?? null;
  if (host === null || more === null || host.querySelector(`[data-source-line="${last}"]`) !== null) return true;
  more.click();
  return false;
}

/**
 * The walk through the comments of the viewer's file, one stop per tap of the header's counter, in
 * the order they are sent (`sortFileComments`), from the one after the stop visited last
 * (`lastFileStop`), wrapping. A stop on a comment written in the other view switches the view
 * (`showView`) and goes on once its card is drawn; a shown one is marked current, scrolled to and
 * focused (`showWalkStop`), after unfolding a code block that hides its lines; an outdated one opens
 * in the modal editor, with a note that its part of the file has changed. `goTo` is one stop, by
 * comment id; `openInEditor` opens a stored comment in that editor with another note, where its file
 * cannot be shown to place it (the viewer opened at it on a file it cannot read); `editor` goes into
 * the viewer, and `editorOpen` keeps its Escape for the editor.
 */
export function useFileCommentWalk({ owner, view, comments, surface, showView }: {
  /** the pane's store owner; null without a pane */
  owner: string | null;
  /** the view shown now; null while it takes no comments */
  view: FileView | null;
  comments: FileComments;
  /** the viewer's body, the comment surface the cards are in */
  surface: RefObject<HTMLDivElement>;
  /** shows the file in `view` */
  showView: (view: FileView) => void;
}): { next: () => void; goTo: (id: string) => boolean; openInEditor: (comment: FileComment, note: string) => void; editor: ReactNode; editorOpen: boolean } {
  const t = useT();
  // the comment open in the modal editor, and why it is there rather than on its lines
  const [modal, setModal] = useState<{ comment: FileComment; note: string } | null>(null);
  const latest = useRef({ owner, view, comments, showView });
  latest.current = { owner, view, comments, showView };
  // the stop's place in the walk where its id is gone (an edit gives a comment a new id)
  const position = useRef(-1);
  const frame = useRef(0);
  /** The card the walk stands on (`is-current`, set by hand as the composer's walk does), until the next stop or a click. */
  const current = useRef<HTMLElement | null>(null);
  const clearCurrent = useCallback((): void => {
    const note = current.current;
    if (note === null) return;
    note.classList.remove("is-current");
    markCurrentComment(surface.current ?? note, null);
    current.current = null;
  }, [surface]);
  useEffect(() => {
    // a click, not a press, as in the composer's walk: in the capture phase, so the counter's own click clears the old mark first
    const onClick = (): void => clearCurrent();
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.cancelAnimationFrame(frame.current);
      clearCurrent();
    };
  }, [clearCurrent]);

  /** Stands on the card of comment `id` once it is drawn in the view shown, with its lines; gives up after `STOP_WAIT_MS`. */
  const stopAt = useCallback((id: string): void => {
    window.cancelAnimationFrame(frame.current);
    const deadline = performance.now() + STOP_WAIT_MS;
    const attempt = (): void => {
      frame.current = 0;
      const body = surface.current;
      const placed = latest.current.comments.shown.find(({ comment }) => comment.id === id);
      const card = placed === undefined ? null : body?.querySelector<HTMLElement>(`.block-comment-card[data-comment-id="${CSS.escape(id)}"]`) ?? null;
      if (body !== null && placed !== undefined && card !== null && unfoldFor(card, placed.lines[1])) {
        clearCurrent();
        card.classList.add("is-current");
        current.current = card;
        showWalkStop(body, card);
        return;
      }
      if (performance.now() < deadline) frame.current = window.requestAnimationFrame(attempt);
    };
    attempt();
  }, [surface, clearCurrent]);

  const goTo = useCallback((id: string): boolean => {
    const { owner, view, comments, showView } = latest.current;
    const comment = comments.all.find((c) => c.id === id);
    if (owner === null || comment === undefined) return false;
    lastFileStop.set(owner, id);
    window.cancelAnimationFrame(frame.current);
    clearCurrent();
    if (comments.outdated.some((c) => c.id === id)) {
      setModal({ comment, note: t("This part of the file has changed since.") });
      return true;
    }
    if (comment.view !== view) showView(comment.view);
    stopAt(id);
    return true;
  }, [clearCurrent, stopAt, t]);

  const openInEditor = useCallback((comment: FileComment, note: string): void => {
    const { owner } = latest.current;
    if (owner === null) return;
    lastFileStop.set(owner, comment.id);
    window.cancelAnimationFrame(frame.current);
    clearCurrent();
    setModal({ comment, note });
  }, [clearCurrent]);

  const next = useCallback((): void => {
    const { owner, comments } = latest.current;
    if (owner === null) return;
    const stops = sortFileComments(comments.all);
    if (stops.length === 0) return;
    const last = lastFileStop.get(owner);
    const found = stops.findIndex((c) => c.id === last);
    const at = ((found >= 0 ? found : position.current) + 1) % stops.length;
    position.current = at;
    goTo(stops[at]!.id);
  }, [goTo]);

  const closeEditor = useCallback(() => setModal(null), []);
  const editor = owner !== null && modal !== null && <CommentEditor
    reference={{ path: modal.comment.path, lines: modal.comment.lines }}
    quote={modal.comment.quoteLines.join("\n")}
    note={modal.note}
    initialComment={modal.comment.comment}
    onSave={(text) => {
      // an edit gives the comment a new id: the walk goes on from it
      const saved = persistFile(owner, targetOf(modal.comment), text);
      if (saved !== null) lastFileStop.set(owner, saved);
      setModal(null);
    }}
    onClose={closeEditor}
    fallback={() => null}
  />;
  return { next, goTo, openInEditor, editor, editorOpen: modal !== null };
}
