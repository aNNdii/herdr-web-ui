import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useLayoutEffect, useState, type ReactNode, type Ref, type RefObject } from "react";
import { parsePatchFiles, trimPatchContext, type FileDiffMetadata, type SelectedLineRange } from "@pierre/diffs";
import { File, FileDiff, Virtualizer, type DiffLineAnnotation, type FileDiffOptions, type FileOptions, type LineAnnotation } from "@pierre/diffs/react";
import { Circle, CircleCheck, Columns2, Download, ExternalLink, FoldVertical, Rows3, WrapText } from "lucide-react";

import { createPortal } from "react-dom";
import { CommentAtRest } from "./CommentAtRest.tsx";
import { CommentPopover } from "./CommentPopover.tsx";
import { FileViewer } from "./FileViewer.tsx";
import { CommentModeToggle } from "./CommentModeToggle.tsx";
import { CommentModeHint, useModeHint } from "./CommentModeHint.tsx";
import { SelectionButton, SELECTION_BUTTON_CLASS } from "./SelectionButton.tsx";
import { useFileComments, usePreviewCommentSource, usePreviewMargin, type FileCommentScope } from "./FileComments.tsx";
import { MarkdownCommentLayer, type MarkdownCommentLayerHandle } from "./MarkdownComments.tsx";
import { DiffWorkerPool } from "./DiffWorkerPool.tsx";
import { ProgressiveMarkdown } from "./Markdown.tsx";
import { useLineCursor, type CursorField, type LineCursorControl } from "./useLineCursor.ts";
// a saved comment is drawn as the file viewer draws one (`.code-comment-card`)
import "./CodeComments.css";
import "./ReviewDialog.css";

import type { RepoDiffFile, RepoDiffFilePatch } from "../../shared/protocol.ts";
import { blockComments, useBlockComments } from "../lib/blockComments.ts";
import { branchTarget, branchTargetOf, placeBranchComments, type BranchComment, type BranchTarget } from "../lib/branchComments.ts";
import { commentPlace, diffQueryOf, type ReviewComparison } from "../lib/branchReview.ts";
import { rowElement, rowOf } from "../lib/diffRowDom.ts";
import { diffSides, diffTrack, type DiffRow } from "../lib/diffSides.ts";
import { fileLines, isFileComment, pathLabel, type FileComment, type LineRange } from "../lib/fileComments.ts";
import { formatBytes } from "../lib/bridgeProgress.ts";
import { LINE_ELEMENT_LIMIT } from "../lib/highlight.ts";
import { useT } from "../lib/i18n.ts";
import type { MarkdownBlock } from "../lib/markdown.ts";
import { fileTrack } from "../lib/lineCursor.ts";
import { knownPreview, parsePreviewOffThread } from "../lib/markdownPreview.ts";
import { useMachineApi, useMachineId } from "../lib/machineContext.tsx";
import { diffColorable, diffErrorMessage, diffStyleFor, statusWord, unavailableMessage } from "../lib/repoDiff.ts";
import { repositoryFile, reviewTarget, workspacePick, type MarkdownView } from "../lib/review.ts";
import type { ReviewKey } from "../lib/reviewKeys.ts";
import { fieldPlace, revealBy } from "../lib/selectionField.ts";
import { useSettings, type MobileCommentGesture } from "../lib/settings.ts";
import { SHEET_QUERY } from "../lib/sheets.ts";
import { VIRTUAL_HIGHLIGHT_LINES } from "../lib/sourcePreview.ts";
import { contentKey, DIFF_SHADOW_CSS, SCROLL_CONFIG, SOURCE_THEME } from "../lib/sourceTheme.ts";
import { useMediaQuery } from "../lib/useMediaQuery.ts";
import { lineQuote } from "../lib/commentPopover.ts";

/** A file larger than this is not read for the review: its diff still shows, its whole text the file viewer shows (in part, without comments). */
export const REVIEW_MAX_BYTES = 10 * 1024 * 1024;
/** How much of the view Space and PageDown scroll, as the browser pages: the rest stays in sight. */
const PAGE_FRACTION = 0.875;
/** How far an arrow scrolls where no line cursor runs (the preview), as the browser's arrow does. */
const LINE_STEP_PX = 40;

/** Unchanged lines kept around each change when the context is folded (the package's trimmer needs at least 1). */
const FOLD_CONTEXT_LINES = 1;

/**
 * The review's code: the diff's shared shadow CSS (sourceTheme.ts), then its own :host values, which come later and so win.
 * Larger type than the Changes view's, and stronger row tints, so a diff reads at a glance. The Changes view keeps its own.
 */
/** The highlight of the text a new comment is being written on (drawn in the diff's shadow root, by REVIEW_CSS). */
const DRAFT_HIGHLIGHT = "review-draft";

/**
 * The line cursor's mark (useLineCursor, drawn as the library's selected lines): a bar in the strongest text colour at
 * the line number, as the selection's tint alone barely shows. Not the accent: on a changed line under the selection's
 * blue tint it falls below 3:1 in several palettes (scripts/herdr-themes.test.ts checks every one). Only where the code's host has `CURSOR` (a mouse's drag is drawn as the
 * library's selection, without it). A split view draws a selected row in both columns; the host's side class keeps the
 * bar on the cursor's side: a removed line's on the left, any other's on the right.
 */
const CURSOR = "review-cursor";
const CURSOR_OLD = "review-cursor-old";
const CURSOR_NEW = "review-cursor-new";

/**
 * The classes of the code's host for the cursor's lines (null: none drawn), its side by the range's end, the cursor's
 * row. Exported for its tests.
 */
export function cursorClass(cursorLines: SelectedLineRange | null): string {
  if (cursorLines === null) return "";
  return `${CURSOR} ${(cursorLines.endSide ?? cursorLines.side) === "deletions" ? CURSOR_OLD : CURSOR_NEW}`;
}

/**
 * How many lines the library draws for a whole file's text: one per newline, and one more for a text after the last;
 * a last newline starts no line of its own. The cursor's track has these. Exported for its tests.
 */
export function drawnLineCount(text: string): number {
  if (text === "") return 0;
  let count = 0;
  for (let at = text.indexOf("\n"); at >= 0; at = text.indexOf("\n", at + 1)) count += 1;
  return text.endsWith("\n") ? count : count + 1;
}

const REVIEW_CSS = `${DIFF_SHADOW_CSS}
::highlight(${DRAFT_HIGHLIGHT}) {
  background-color: var(--comment-fill-strong);
  color: var(--text-strong);
}
:host {
  --diffs-font-size: var(--fs-sm);
  --diffs-line-height: calc(var(--fs-sm) * 1.6);
  --diffs-bg-addition-override: color-mix(in srgb, var(--git-added) 12%, var(--bg));
  --diffs-bg-deletion-override: color-mix(in srgb, var(--git-deleted) 12%, var(--bg));
  --diffs-bg-addition-emphasis-override: color-mix(in srgb, var(--git-added) 22%, var(--bg));
  --diffs-bg-deletion-emphasis-override: color-mix(in srgb, var(--git-deleted) 22%, var(--bg));
  -webkit-touch-callout: none;
}
:host(.${CURSOR}) [data-column-number][data-selected-line] {
  box-shadow: inset calc(-1 * var(--rail-w)) 0 0 var(--text-strong);
}
:host(.${CURSOR_NEW}) [data-deletions] [data-column-number][data-selected-line],
:host(.${CURSOR_OLD}) [data-additions] [data-column-number][data-selected-line] {
  box-shadow: none;
}
`;

/** The added and removed lines of a patch, the file headers aside. */
function countLines(patch: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) removed += 1;
  }
  return { added, removed };
}

/** The popover's focus goes back to nothing here: the element that had it is not known at the close. */
const noFocus = (): null => null;

/** The wait for a file or a diff: a stepped spinner (as the app's others) and the word, so the empty area reads as loading. */
export function ReviewLoading() {
  const t = useT();
  return <p className="review-loading" role="status"><span className="review-spinner" aria-hidden="true" />{t("Opening…")}</p>;
}

export interface ReviewFileProps {
  /** the comment store's owner: the pane's storage id, so the comments go to that pane's chat */
  owner: string;
  paneId: string | null;
  /** the pane's folder, read when the pane is gone */
  directory: string | null;
  /** the repository's top folder, absolute */
  root: string;
  /** the file's path, relative to the repository root */
  path: string;
  /** the file's change, when git lists it as changed; null for an unchanged file */
  change: RepoDiffFile | null;
  /** the Changed list is shown: a changed file opens as its diff; All files opens it whole */
  diffMode: boolean;
  /** what the change is compared with, as the file list resolved it: the working tree, the index, or two branches; null
      until the list answered */
  comparison: ReviewComparison | null;
  /** a folder outside any repository: the header names the file alone (the dialog's header names the folder) */
  plain?: boolean;
  /** a file git ignores, which the header says */
  ignored?: boolean;
  /** a changed file's Viewed mark (null: none to set, the file did not change), and its setter */
  viewed?: boolean | null;
  onViewed?: (on: boolean) => void;
  /** the file viewer's Close, where it shows the file (media, or text too large for the review) */
  onClose: () => void;
  /** a file the file viewer opens from this one (a folder's listing) */
  onOpen: (path: string) => void;
  /** a line to show (a comment's place): the file opens scrolled to it, a Markdown file as its source */
  line?: number;
  /** how a Markdown file is shown, as the list keeps it (ReviewDialog), and its choice: a click on Preview or Source */
  markdownView: MarkdownView;
  onMarkdownView: (view: MarkdownView) => void;
  /** the dialog's way to ask the file about a review key first */
  keyboard?: Ref<ReviewFileKeyboard>;
  /** whether the review keys are on (View options): only then does the Viewed button name its key */
  keysOn?: boolean;
}

/**
 * The file's answer to a review key: taken (it acted, the dialog prevents the default), passed (the dialog's to act on:
 * the next file, Viewed, Escape's close) or blocked (a comment is open: the key does nothing, Escape is the field's).
 */
export type KeyAnswer = "taken" | "passed" | "blocked";

export interface ReviewFileKeyboard {
  /** `focused`: the element that had the focus when the key came */
  press(key: ReviewKey, focused: Element | null): KeyAnswer;
}

/** What the file is, for a review key (`pressFile`). */
export interface FilePress {
  /** a new or a saved comment is being written */
  writing: boolean;
  /** the line cursor runs here (a diff, a whole file); not in the preview, the file viewer's view or a note */
  tracked: boolean;
  /** a key may start a comment here (`keyCommentable`) */
  commentsByKey: boolean;
  cursor: Pick<LineCursorControl, "clear" | "land" | "move" | "rows">;
  /** opens the field on the rows, or refuses them (removed lines in the working tree's diff) */
  open: (rows: DiffRow[]) => void;
  /** scrolls the file's body a page or a line down (1) or up (-1); false where it has none (the file viewer's view, a note) */
  scroll: (direction: 1 | -1, by: "page" | "line") => boolean;
}

/**
 * The file's answer to a review key. While a comment is open none acts but Escape, which the field has. Escape takes a
 * Shift range away; the page keys page the body; the cursor keys move the cursor where it runs, even at an end, where it
 * stays, and scroll the body a line where it does not (the preview), as the arrows do with the review keys off. The
 * focus rests on the dialog, not on the body, so the browser's own scrolling would find nothing to scroll. c and Enter, where a key may comment, first land a cursor that is not
 * shown in view, and open the field on its rows only once it is. Exported for its tests.
 */
export function pressFile(key: ReviewKey, file: FilePress): KeyAnswer {
  if (file.writing) return key === "clear" ? "passed" : "blocked";
  if (key === "clear") return file.cursor.clear() ? "taken" : "passed";
  if (key === "page-down" || key === "page-up") return file.scroll(key === "page-down" ? 1 : -1, "page") ? "taken" : "passed";
  if (key === "line-down" || key === "line-up" || !file.tracked && (key === "down" || key === "up")) {
    return file.scroll(key === "line-down" || key === "down" ? 1 : -1, "line") ? "taken" : "passed";
  }
  if (key === "next" || key === "previous" || key === "viewed" || !file.tracked) return "passed";
  if (key === "comment") {
    if (!file.commentsByKey) return "passed";
    if (file.cursor.land()) return "taken";
    const rows = file.cursor.rows();
    if (rows.length === 0) return "passed";
    file.open(rows);
    return "taken";
  }
  return file.cursor.move(key) ? "taken" : "passed";
}

/**
 * Whether a key may start a comment: the mouse's rule, comment mode aside (the key turns it on). Settings' comments on,
 * the data a comment needs there (`canComment`), and in a diff a comparison that takes comments (not the staged
 * changes'); a whole file takes one under any comparison and in a plain folder, the preview none. Exported for its tests.
 */
export function keyCommentable({ comments, canComment, shown, commentsOnDiff }: { comments: boolean; canComment: boolean; shown: Shown["kind"]; commentsOnDiff: boolean }): boolean {
  return comments && canComment && (shown === "diff" ? commentsOnDiff : shown !== "preview");
}

/**
 * What an annotation on a line of the review is: a saved comment, on the lines it is drawn on (a branch comment's as
 * placed in the diff shown) and on their side, a removed line's being the old file's. A new one is not an annotation but
 * a card portalled into the scrolling body (`DraftField`): a change of the annotations redraws the file, and the scroll
 * place with it.
 */
interface ReviewNote { comment: FileComment | BranchComment; lines: LineRange; side: "additions" | "deletions" }

/**
 * The saved comment a key opens to edit instead of a new one: on one line, the newest whose card is under it (its last
 * line, on its side); on a Shift range, the newest on exactly those lines. None: the key starts a new comment.
 * Exported for its tests.
 */
export function savedCommentAt<Note extends Pick<ReviewNote, "lines" | "side"> & { comment: { created: number } }>(notes: readonly Note[], rows: readonly DiffRow[]): Note | null {
  const first = rows[0], last = rows[rows.length - 1];
  if (first === undefined || last === undefined || first.old !== last.old) return null;
  const side = last.old ? "deletions" : "additions";
  const single = rows.length === 1;
  let found: Note | null = null;
  for (const note of notes) {
    if (note.side !== side || note.lines[1] !== last.line || !single && note.lines[0] !== first.line) continue;
    if (found === null || note.comment.created >= found.comment.created) found = note;
  }
  return found;
}

/**
 * The comment field open on the file, for the line cursor (`useLineCursor`): a new comment on the rows it was opened on,
 * else a saved one edited, on its lines and side; null when none is open. Exported for its tests.
 */
export function openField(opening: { rows: readonly DiffRow[]; byKey: boolean } | null, editing: Pick<ReviewNote, "lines" | "side"> | null, editByKey: boolean): CursorField | null {
  if (opening !== null) return { rows: opening.rows, byKey: opening.byKey };
  if (editing === null) return null;
  const old = editing.side === "deletions";
  return { rows: [{ line: editing.lines[0], old }, { line: editing.lines[1], old }], byKey: editByKey };
}

/**
 * A new comment being written: on lines of the working tree's file, or, in a branch comparison's diff, on lines of one
 * of its versions (`BranchTarget`, its text from the patch).
 */
type Draft = { kind: "file"; lines: LineRange } | { kind: "branch"; target: BranchTarget };

/**
 * Where a new comment was opened from: a mouse's selection, press or touch (its text's boxes and ranges), or a key (the
 * element that had the focus, which gets it back as the field closes).
 */
type DraftFrom = { rects?: DOMRect[]; ranges?: Range[] } | { opener: HTMLElement | null };

function draftLines(draft: Draft): LineRange {
  return draft.kind === "file" ? draft.lines : draft.target.lines;
}

/** Whether a new comment is on removed lines, which the diff draws as the old file's rows. */
function draftOnBase(draft: Draft): boolean {
  return draft.kind === "branch" && draft.target.place.side === "base";
}

/** A sheet's quote of a branch comment's lines: their text in its version, not the file's on disk. */
function versionQuote(source: readonly string[]): string {
  return lineQuote(source, [1, source.length]);
}

/** What a selected text, a press or a picked range starts a comment on: the drawn rows, and the text's boxes and ranges. */
type OnComment = (rows: readonly DiffRow[], rects?: DOMRect[], ranges?: Range[]) => void;

type Source =
  | { status: "pending" }
  /** shown by the file viewer, in its docked view (FileViewer.tsx): an image, a video, audio, a PDF, a page, or text too
      large for the review (`media`: not text at all, so not even a diff of it shows here) */
  | { status: "viewer"; media: boolean; size: number }
  | { status: "ready"; text: string }
  | { status: "none"; note: string }
  | { status: "failed"; error: unknown };

type Patch =
  | { status: "pending" }
  | { status: "ready"; answer: RepoDiffFilePatch }
  | { status: "failed"; error: unknown };

/** What the file's place says where it draws no lines: a wait, a failure, a patch without lines, or the source's own note. */
type BodyNote =
  | { of: "loading" }
  | { of: "error"; error: unknown }
  | { of: "unavailable"; answer: RepoDiffFilePatch }
  | { of: "unparsable" }
  | { of: "said"; text: string };

/**
 * The one thing the file's place shows: a Markdown file's preview, the change's diff, the whole file (drawn whole, or
 * `virtual` past `LINE_ELEMENT_LIMIT` lines), the file viewer's view, or a note.
 */
type Shown =
  | { kind: "preview" }
  | { kind: "diff"; file: FileDiffMetadata }
  | { kind: "lines"; text: string }
  | { kind: "virtual"; text: string }
  | { kind: "viewer"; media: boolean; size: number }
  | { kind: "note"; note: BodyNote };

interface ShownFacts {
  isMarkdown: boolean;
  /** the Markdown view the list keeps */
  markdownView: MarkdownView;
  /** a line asked for: the file's source is where it is */
  line: number | undefined;
  source: Source;
  /** the change is shown as its diff (Changed files) */
  showDiff: boolean;
  patch: Patch;
  diffFile: FileDiffMetadata | null;
  lines: readonly string[] | null;
}

/**
 * What the file's place shows, decided here alone. A Markdown file shows its preview where its list keeps Preview and no
 * line is asked for, once its text is there (until then, or without one, its diff or its note). A file the review cannot
 * draw is the file viewer's, media even in a diff; a large text's diff stays the review's. Exported for its tests.
 */
export function shownBody({ isMarkdown, markdownView, line, source, showDiff, patch, diffFile, lines }: ShownFacts): Shown {
  if (isMarkdown && markdownView === "preview" && line === undefined && source.status === "ready") return { kind: "preview" };
  if (source.status === "viewer" && (source.media || !showDiff)) return { kind: "viewer", media: source.media, size: source.size };
  if (showDiff) {
    if (patch.status === "pending") return { kind: "note", note: { of: "loading" } };
    if (patch.status === "failed") return { kind: "note", note: { of: "error", error: patch.error } };
    if (patch.answer.patch === null) return { kind: "note", note: { of: "unavailable", answer: patch.answer } };
    if (diffFile === null) return { kind: "note", note: { of: "unparsable" } };
    return { kind: "diff", file: diffFile };
  }
  switch (source.status) {
    case "pending": return { kind: "note", note: { of: "loading" } };
    case "ready": return lines !== null && lines.length <= LINE_ELEMENT_LIMIT ? { kind: "lines", text: source.text } : { kind: "virtual", text: source.text };
    case "none": return { kind: "note", note: { of: "said", text: source.note } };
    case "failed": return { kind: "note", note: { of: "error", error: source.error } };
    // not reached: a viewer's file returned above
    case "viewer": return { kind: "viewer", media: source.media, size: source.size };
  }
}

/**
 * A Markdown file's preview blocks, as the file viewer parses them (in a worker, unless known already):
 * "pending" until they are there, "failed" when the parser gave up. Null text asks for nothing.
 */
function useReviewPreview(text: string | null): MarkdownBlock[] | "pending" | "failed" {
  const known = useMemo(() => (text === null ? undefined : knownPreview(text)), [text]);
  const [answer, setAnswer] = useState<{ text: string; blocks: MarkdownBlock[] | null } | null>(null);
  useEffect(() => {
    if (text === null || known !== undefined) return;
    let live = true;
    const job = parsePreviewOffThread(text);
    void job.promise.then((blocks) => { if (live) setAnswer({ text, blocks }); });
    return () => { live = false; job.cancel(); };
  }, [known, text]);
  if (text === null) return "pending";
  if (known !== undefined) return known === null ? "failed" : known;
  if (answer === null || answer.text !== text) return "pending";
  return answer.blocks ?? "failed";
}

function parseFile(text: string): FileDiffMetadata | null {
  return parsePatchFiles(text, contentKey("review-diff", text), true)[0]?.files[0] ?? null;
}

/** A line's press on a touch screen: a tap, or a long press (Settings' gesture), starts its comment; a move (a scroll) does not. */
const HOLD_MS = 450;
/** how long a deleted comment's Undo is offered */
const UNDO_MS = 10_000;
const TAP_MS = 400;
const MOVE_PX = 10;
type LinePress = { x: number; y: number; row: DiffRow; started: number; timer: number | undefined };
function useTouchLinePress(host: RefObject<HTMLDivElement | null>, gesture: MobileCommentGesture | null, onPress: (row: DiffRow) => void): void {
  const latest = useRef(onPress);
  latest.current = onPress;
  useEffect(() => {
    const element = host.current;
    if (element === null || gesture === null) return;
    let press: LinePress | null = null;
    const cancel = (): void => {
      if (press?.timer !== undefined) window.clearTimeout(press.timer);
      press = null;
    };
    const down = (event: PointerEvent): void => {
      if (event.pointerType === "mouse") return;
      const element = event.composedPath().find((node): node is HTMLElement => node instanceof HTMLElement && node.hasAttribute("data-line"));
      const row = element === undefined ? null : rowOf(element);
      if (row === null) return;
      const started: LinePress = { x: event.clientX, y: event.clientY, row, started: event.timeStamp, timer: undefined };
      press = started;
      if (gesture === "hold") {
        started.timer = window.setTimeout(() => {
          press = null;
          latest.current(started.row);
        }, HOLD_MS);
      }
    };
    const move = (event: PointerEvent): void => {
      if (press !== null && Math.hypot(event.clientX - press.x, event.clientY - press.y) > MOVE_PX) cancel();
    };
    const up = (event: PointerEvent): void => {
      const done: LinePress | null = press;
      cancel();
      if (done !== null && gesture === "tap" && event.timeStamp - done.started < TAP_MS) latest.current(done.row);
    };
    element.addEventListener("pointerdown", down);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", cancel);
    return () => {
      cancel();
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", cancel);
    };
  }, [host, gesture]);
}

/** A selected text of the diff: its root (the diff's shadow root), its ranges, and the drawn rows it spans. */
interface DiffSelection { root: SelectableRoot; ranges: Range[]; rows: DiffRow[] }

type RangeEnds = Pick<Range, "startContainer" | "startOffset" | "endContainer" | "endOffset">;
/**
 * Whether a selection read again is the one already offered: the same root and the same ends. A key's keyup reads the
 * selection again; the same one must stay the same object, or the line cursor would follow it back on every key.
 * Exported for its tests.
 */
export function sameSelection(offered: { root: unknown; ranges: readonly RangeEnds[] } | null, root: unknown, range: RangeEnds): boolean {
  const was = offered?.ranges[0];
  return offered !== null && was !== undefined && offered.root === root
    && was.startContainer === range.startContainer && was.startOffset === range.startOffset
    && was.endContainer === range.endContainer && was.endOffset === range.endOffset;
}
type SelectableRoot = ShadowRoot & { getSelection?: () => Selection | null };
type ComposedSelection = Selection & { getComposedRanges?: (options: { shadowRoots: ShadowRoot[] }) => StaticRange[] };
/** A composed range as a live Range, which can tell what it intersects. */
function liveRange(range: StaticRange): Range {
  const live = document.createRange();
  live.setStart(range.startContainer, range.startOffset);
  live.setEnd(range.endContainer, range.endOffset);
  return live;
}

/**
 * The text selected in the diff, not its line numbers: the rows it spans, offered a Comment button as a Markdown preview
 * offers one. The diff draws its code in shadow roots, so the selection is read from the root the text is in. Read in
 * every mode: the line cursor follows a selection whether or not the Comment button is offered for it.
 */
function useDiffSelection(host: RefObject<HTMLDivElement | null>): DiffSelection | null {
  const [offer, setOffer] = useState<DiffSelection | null>(null);
  useEffect(() => {
    // the selection offered last, kept as it is while the page's selection stays the same (`sameSelection`)
    let offered: DiffSelection | null = null;
    const offerNext = (next: DiffSelection | null): void => {
      offered = next;
      setOffer(next);
    };
    const check = (): void => {
      let found: DiffSelection | null = null;
      const page = document.getSelection() as ComposedSelection | null;
      for (const element of host.current?.querySelectorAll<HTMLElement>("*") ?? []) {
        const root = element.shadowRoot as SelectableRoot | null;
        if (root === null || page === null) continue;
        // the page's selection composed into this shadow root, as the library reads its own (editor.js); the root's own otherwise
        const composed = (page.getComposedRanges?.({ shadowRoots: [root] }) ?? []).map(liveRange);
        const own = root.getSelection?.() ?? null;
        const range = composed[0] ?? (own !== null && own.rangeCount > 0 ? own.getRangeAt(0) : undefined);
        if (range === undefined || range.collapsed || range.toString().trim() === "") continue;
        if (sameSelection(offered, root, range)) {
          found = offered;
          break;
        }
        // every row, the old file's too: which of them a comment keeps is the comparison's to say (`pick`)
        const rows = [...root.querySelectorAll<HTMLElement>("[data-line]")].filter((row) => range.intersectsNode(row))
          .flatMap((row) => rowOf(row) ?? []);
        if (rows.length === 0) continue;
        found = { root, ranges: [range], rows };
        break;
      }
      offerNext(found);
    };
    // the button comes once the press is over (a drag, a long press), not while the selection is still being made
    let pressed = false;
    const down = (event: Event): void => {
      // a press on the Comment button is its click: it must not hide the button before the click lands
      if (event.target instanceof Element && event.target.closest(`.${SELECTION_BUTTON_CLASS}`) !== null) return;
      pressed = true;
      offerNext(null);
    };
    const up = (): void => {
      pressed = false;
      check();
    };
    const changed = (): void => {
      if (pressed) offerNext(null);
      else check();
    };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", up, true);
    document.addEventListener("keyup", up, true);
    document.addEventListener("selectionchange", changed);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", up, true);
      document.removeEventListener("keyup", up, true);
      document.removeEventListener("selectionchange", changed);
    };
  }, [host]);
  return offer;
}

/** The views' parts for the line cursor: the lines it draws (never undefined, so the library's selection is controlled
 *  from the mount), the code host's classes (`cursorClass`) and what a mouse selection tells it. */
interface CursorParts {
  selection: SelectedLineRange | null;
  bodyClass: string;
  onFollow: (rows: readonly DiffRow[]) => void;
}

/** The cursor follows the text selected in the view (to its last row), offered the Comment button or not. */
function useFollowSelection(offer: DiffSelection | null, onFollow: CursorParts["onFollow"]): void {
  useEffect(() => {
    if (offer !== null) onFollow(offer.rows);
  }, [offer, onFollow]);
}

function DiffView({ file, options, notes, renderNote, onComment, commenting, gesture, selection, bodyClass, onFollow }: CursorParts & {
  file: FileDiffMetadata;
  options: FileDiffOptions<ReviewNote, undefined>;
  notes: DiffLineAnnotation<ReviewNote>[];
  renderNote: (annotation: LineAnnotation<ReviewNote>) => ReactNode;
  onComment: OnComment;
  commenting: boolean;
  gesture: MobileCommentGesture | null;
}) {
  const host = useRef<HTMLDivElement>(null);
  const offer = useDiffSelection(host);
  useFollowSelection(offer, onFollow);
  const drawn = useDrawn(host, file);
  const scroller = useRef<HTMLDivElement>(null);
  useKeepScrollPlace(scroller, notes, file);
  useTouchLinePress(host, gesture, (row) => onComment([row]));
  // no browser menu over the diff: its own Comment button is the one way to act on a selection, as in the Markdown preview
  useEffect(() => {
    const element = host.current;
    const menu = (event: Event): void => event.preventDefault();
    element?.addEventListener("contextmenu", menu);
    return () => element?.removeEventListener("contextmenu", menu);
  }, [host]);
  const comment = useCallback((): void => {
    if (offer === null) return;
    // the rects before the selection is cleared: they are where the card goes
    const rects = offer.ranges.flatMap((range) => [...range.getClientRects()]);
    // copies, kept past the selection's end: the selected text stays marked while its comment is written
    const kept = offer.ranges.map((range) => range.cloneRange());
    offer.root.getSelection?.()?.removeAllRanges();
    document.getSelection()?.removeAllRanges();
    onComment(offer.rows, rects, kept);
  }, [offer, onComment]);
  return <div ref={host} className="review-view">
    <DiffWorkerPool>
      <div ref={scroller} className="review-scroll">
        <FileDiff className={bodyClass} fileDiff={file} options={options} selectedLines={selection} lineAnnotations={notes} renderAnnotation={renderNote} />
      </div>
    </DiffWorkerPool>
    {!drawn && <div className="review-drawing"><ReviewLoading /></div>}
    {commenting && offer !== null && host.current !== null && <SelectionButton surface={host.current} ranges={offer.ranges} onComment={comment} />}
  </div>;
}

/**
 * Keeps the scroll place of `root` while its file is drawn again for a change of its annotations (a comment opened or
 * closed): the library rebuilds the drawn lines then, and for a moment the scroll root is short, so the browser moves
 * the place to the top. A new file (`resetKey`) starts at the top, as before.
 */
function useKeepScrollPlace(root: RefObject<HTMLElement | null>, notes: unknown, resetKey: unknown): void {
  const place = useRef(0);
  const lastReset = useRef<unknown>(resetKey);
  // the cleanup runs as `notes` changes, before the library draws again: the place read there is still the old one
  useLayoutEffect(() => () => {
    if (root.current !== null) {
      place.current = root.current.scrollTop;
      // the library takes its lines down for the redraw: the block keeps its height, so the scroll root is not clamped to 0
      const block = root.current.querySelector<HTMLElement>(".review-file-body");
      if (block !== null) block.style.minHeight = `${block.getBoundingClientRect().height}px`;
    }
  }, [root, notes]);
  useEffect(() => {
    const element = root.current;
    if (element === null) return;
    if (lastReset.current !== resetKey) {
      lastReset.current = resetKey;
      return;
    }
    let frame = 0;
    let count = 0;
    const restore = (): void => {
      if (element.scrollTop !== place.current) element.scrollTop = place.current;
      count += 1;
      if (count < 30) frame = requestAnimationFrame(restore);
      else element.querySelector<HTMLElement>(".review-file-body")?.style.removeProperty("min-height");
    };
    frame = requestAnimationFrame(restore);
    return () => cancelAnimationFrame(frame);
  }, [root, notes, resetKey]);
}

/** How far the new comment's field keeps from the body's sides, as the chat's and the preview's (SelectionField.tsx). */
const FIELD_INSET_PX = 8;

/** Where a new comment is on: its text's first and last line boxes, in the scrolling body's content coordinates. */
interface DraftAnchor {
  scroller: HTMLElement;
  firstTop: number;
  firstLeft: number;
  lastBottom: number;
  /** where a selection's text ends: the field is centred there; unset for a whole line, whose field starts at its text */
  lastRight?: number;
}

/**
 * The text a new comment is on, read once as it opens: the selection's line boxes it was opened from (as the Comment
 * button read them, lib/selectionField.ts `buttonPlace`), else, for a line picked by a press or a touch, the line's own
 * box (the right side's in the split view, a removed line's own row on the left). In content coordinates, so it holds
 * however the body scrolls.
 */
function useDraftAnchor(root: RefObject<HTMLElement | null>, draft: Draft | null, rects: DOMRect[] | null): DraftAnchor | null {
  const [anchor, setAnchor] = useState<DraftAnchor | null>(null);
  useEffect(() => {
    if (draft === null) {
      setAnchor(null);
      return;
    }
    let frames = 0;
    let frame = 0;
    // a selection's boxes end where its text ends; a whole line's box runs to the body's right edge, so its field starts
    // at the line's text, as its saved comment's card does
    const anchorAt = (scroller: HTMLElement, boxes: readonly DOMRect[], selection: boolean): void => {
      const outer = scroller.getBoundingClientRect();
      const x = scroller.scrollLeft - outer.left - scroller.clientLeft;
      const y = scroller.scrollTop - outer.top - scroller.clientTop;
      setAnchor({
        scroller,
        firstTop: Math.min(...boxes.map((box) => box.top)) + y,
        firstLeft: boxes[0]!.left + x,
        lastBottom: Math.max(...boxes.map((box) => box.bottom)) + y,
        ...(selection ? { lastRight: boxes[boxes.length - 1]!.right + x } : {}),
      });
    };
    const find = (): void => {
      const scroller = root.current?.querySelector<HTMLElement>(".review-scroll") ?? null;
      if (scroller === null) return;
      const drawn = (rects ?? []).filter((rect) => rect.width > 0 || rect.height > 0);
      if (drawn.length > 0) {
        anchorAt(scroller, drawn, true);
        return;
      }
      // a comment on removed lines goes under its removed row, whose number is the old file's; any other on its row of
      // the new file (the right side in the split view); else on whatever row has that number
      const body = root.current;
      const last = { line: draftLines(draft)[1], old: draftOnBase(draft) };
      const line = body === null ? null : rowElement(body, last) ?? rowElement(body, { ...last, old: !last.old });
      if (line !== null) {
        anchorAt(scroller, [line.getBoundingClientRect()], false);
        return;
      }
      if (frames++ < 30) frame = requestAnimationFrame(find);
    };
    frame = requestAnimationFrame(find);
    return () => cancelAnimationFrame(frame);
  }, [draft, rects, root]);
  return anchor;
}

/**
 * A new comment's box, as the chat's and the Markdown preview's (SelectionField.tsx, the same class and placement): under
 * the text's last line, centred where the text ends, where the Comment button was; above the first line where there is
 * no room below, growing upward (lib/selectionField.ts `fieldPlace`). Placed again as it grows and as the body resizes,
 * and scrolled into view once as it opens. Portalled into the scrolling body, whose content it scrolls with.
 */
function DraftField({ anchor, children }: { anchor: DraftAnchor; children: ReactNode }): ReactNode {
  const box = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const node = box.current;
    const body = anchor.scroller;
    if (node === null) return;
    let above: boolean | undefined;
    let revealed = false;
    const place = (): void => {
      const outer = body.getBoundingClientRect();
      const view = { top: outer.top + body.clientTop, left: outer.left + body.clientLeft, width: body.clientWidth, height: body.clientHeight };
      // the anchor's content coordinates back on screen, as the chat's field reads its ranges' boxes
      const x = view.left - body.scrollLeft;
      const y = view.top - body.scrollTop;
      const placed = fieldPlace({
        first: { top: anchor.firstTop + y, left: anchor.firstLeft + x },
        last: { bottom: anchor.lastBottom + y, ...(anchor.lastRight === undefined ? {} : { right: anchor.lastRight + x }) },
        view,
        scroll: { top: body.scrollTop, left: body.scrollLeft },
        field: { width: node.offsetWidth, height: node.offsetHeight },
        inset: FIELD_INSET_PX,
        above,
      });
      above = placed.above;
      node.style.top = `${placed.top}px`;
      node.style.left = `${placed.left}px`;
      node.toggleAttribute("data-above", placed.above);
      if (revealed) return;
      revealed = true;
      const by = revealBy(node.getBoundingClientRect(), view, FIELD_INSET_PX);
      if (by !== 0) body.scrollBy({ top: by });
    };
    place();
    const resized = new ResizeObserver(place);
    resized.observe(node);
    resized.observe(body);
    return () => resized.disconnect();
  }, [anchor]);
  return createPortal(<div ref={box} className="markdown-comments-field review-draft" data-draft="">{children}</div>, anchor.scroller);
}

/** Whether the library has drawn the first line of its file in `host` (for this `key`): until then the loader covers the area. */
function useDrawn(host: RefObject<HTMLDivElement | null>, key: unknown): boolean {
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    setDrawn(false);
    const started = performance.now();
    let frame = 0;
    const check = (): void => {
      const firstLine = host.current?.querySelector("diffs-container")?.shadowRoot?.querySelector("[data-line]");
      if (firstLine || performance.now() - started > 8000) setDrawn(true);
      else frame = requestAnimationFrame(check);
    };
    frame = requestAnimationFrame(check);
    return () => cancelAnimationFrame(frame);
  }, [host, key]);
  return drawn;
}

/**
 * A file of up to `LINE_ELEMENT_LIMIT` lines, drawn whole by the library and commented as a diff is: a selected text
 * takes the Comment button, a tap or a long press on a line (Settings' gesture) its field.
 */
function LinesView({ name, contents, options, notes, renderNote, onComment, commenting, gesture, selection, bodyClass, onFollow }: CursorParts & {
  name: string;
  contents: string;
  options: FileOptions<ReviewNote, undefined>;
  notes: LineAnnotation<ReviewNote>[];
  renderNote: (annotation: LineAnnotation<ReviewNote>) => ReactNode;
  onComment: OnComment;
  commenting: boolean;
  gesture: MobileCommentGesture | null;
}) {
  const host = useRef<HTMLDivElement>(null);
  const offer = useDiffSelection(host);
  useFollowSelection(offer, onFollow);
  useTouchLinePress(host, gesture, (row) => onComment([row]));
  const drawn = useDrawn(host, contents);
  const scroller = useRef<HTMLDivElement>(null);
  useKeepScrollPlace(scroller, notes, contents);
  // no browser menu over the file: its own Comment button is the one way to act on a selection, as in the diff
  useEffect(() => {
    const element = host.current;
    const menu = (event: Event): void => event.preventDefault();
    element?.addEventListener("contextmenu", menu);
    return () => element?.removeEventListener("contextmenu", menu);
  }, []);
  const comment = useCallback((): void => {
    if (offer === null) return;
    // the rects before the selection is cleared: they are where the card goes
    const rects = offer.ranges.flatMap((range) => [...range.getClientRects()]);
    // copies, kept past the selection's end: the selected text stays marked while its comment is written
    const kept = offer.ranges.map((range) => range.cloneRange());
    offer.root.getSelection?.()?.removeAllRanges();
    document.getSelection()?.removeAllRanges();
    onComment(offer.rows, rects, kept);
  }, [offer, onComment]);
  const file = useMemo(() => ({ name, contents }), [name, contents]);
  return <div ref={host} className="review-view">
    <DiffWorkerPool>
      <div ref={scroller} className="review-scroll">
        <File className={bodyClass} file={file} options={options} selectedLines={selection} lineAnnotations={notes} renderAnnotation={renderNote} />
      </div>
    </DiffWorkerPool>
    {!drawn && <div className="review-drawing"><ReviewLoading /></div>}
    {commenting && offer !== null && host.current !== null && <SelectionButton surface={host.current} ranges={offer.ranges} onComment={comment} />}
  </div>;
}

/** The whole file, its lines with the comments under them. A mouse selection is the library's (`options`), which the
 *  line cursor follows and draws while it is made. */
function FileView({ name, contents, options, notes, renderNote, onComment, gesture, selection, bodyClass }: Pick<CursorParts, "selection" | "bodyClass"> & {
  name: string;
  contents: string;
  options: FileOptions<ReviewNote, undefined>;
  notes: LineAnnotation<ReviewNote>[];
  renderNote: (annotation: LineAnnotation<ReviewNote>) => ReactNode;
  onComment: OnComment;
  gesture: MobileCommentGesture | null;
}) {
  const host = useRef<HTMLDivElement>(null);
  useTouchLinePress(host, gesture, (row) => onComment([row]));
  const file = useMemo(() => ({ name, contents }), [name, contents]);
  return <div ref={host} className="review-view">
    <DiffWorkerPool>
      <Virtualizer className="review-scroll" contentClassName="review-column" config={SCROLL_CONFIG}>
        <File className={bodyClass} file={file} options={options} selectedLines={selection} lineAnnotations={notes} renderAnnotation={renderNote} />
      </Virtualizer>
    </DiffWorkerPool>
  </div>;
}

/**
 * One file of the review: its diff when git lists it changed (or its whole text, for All files), and
 * the comments on its lines. A comment starts from a selected text's Comment button, or on a touch
 * screen from a tap or a long press on a line (Settings' gesture), and is written in the same field as
 * the file viewer's (`CommentPopover`). Comments are kept per pane (`owner`), where the pane's chat
 * sends them with its next message: on the working tree's lines, or in a branch comparison's diff on
 * the lines of the version they are in, read from the patch (lib/branchComments.ts), so that diff takes
 * comments whether or not the file is on disk. A file that cannot be read is shown without comments.
 */
export function ReviewFile({ owner, paneId, directory, root, path, change, diffMode, comparison, plain = false, ignored = false, viewed = null, onViewed, onClose, onOpen, line, markdownView, onMarkdownView, keyboard, keysOn = true }: ReviewFileProps) {
  const t = useT();
  const { settings, update, resolvedTheme } = useSettings();
  const { fetchFileInfo, fileUrl, fetchRepoDiffFile } = useMachineApi();
  const machineId = useMachineId();
  const narrow = useMediaQuery(SHEET_QUERY);
  // a touch screen takes its comment field as the viewer does: a sheet over the keyboard (mobileCommentInput), not a row in the text
  const touch = useMediaQuery("(pointer: coarse)");
  const sheetInput = touch && settings.mobileCommentInput === "sheet";
  // the gesture that starts a comment on a line, on a touch screen, in comment mode only (Settings: tap or long press)
  const touchGesture = settings.commentMode ? settings.mobileCommentGesture : null;
  const { hint, show: showHint } = useModeHint();
  const bodyRef = useRef<HTMLDivElement>(null);
  const absolute = repositoryFile(root, path);
  const changed = change !== null;
  const oldPath = change?.old_path ?? null;
  const deleted = change?.status === "deleted";

  const [source, setSource] = useState<Source>({ status: "pending" });
  const [patch, setPatch] = useState<Patch>({ status: "pending" });
  const [draft, setDraft] = useState<Draft | null>(null);
  // the drawn rows the new comment was opened on (the line cursor draws them while it is written), and whether a key
  // opened it, from which element
  const [opening, setOpening] = useState<{ rows: readonly DiffRow[]; byKey: boolean; opener: HTMLElement | null } | null>(null);
  const [draftText, setDraftText] = useState<Range[] | null>(null);
  const [anchor, setAnchor] = useState<DOMRect[] | null>(null);
  const [refused, setRefused] = useState(false);
  const [folded, setFolded] = useState(false);
  // the saved comment being edited, by its id: its card turns into the field. A key that opened it names the element the
  // focus goes back to as it closes (`byKey`); the mouse's has none
  const [editing, setEditing] = useState<string | null>(null);
  const [editByKey, setEditByKey] = useState<{ opener: HTMLElement | null } | null>(null);
  const edit = useCallback((id: string | null, byKey: { opener: HTMLElement | null } | null = null) => { setEditing(id); setEditByKey(byKey); }, []);
  const comments = useBlockComments(owner);

  useEffect(() => {
    let live = true;
    setSource({ status: "pending" });
    if (deleted) {
      setSource({ status: "none", note: t("This file was deleted, so there is no text to show.") });
      return () => { live = false; };
    }
    fetchFileInfo(absolute, paneId).then(async (info) => {
      if (!live) return;
      if ("candidates" in info) {
        setSource({ status: "none", note: t("This file is not text, so it can't be shown here.") });
        return;
      }
      if (info.kind !== "text" || info.size > REVIEW_MAX_BYTES) {
        setSource({ status: "viewer", media: info.kind !== "text", size: info.size });
        return;
      }
      const response = await fetch(fileUrl(absolute, paneId));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      if (live) setSource({ status: "ready", text: text.replace(/\r\n/g, "\n") });
    }).catch((error: unknown) => { if (live) setSource({ status: "failed", error }); });
    return () => { live = false; };
  }, [absolute, paneId, deleted, fetchFileInfo, fileUrl, t]);

  // a patch is asked for by the hashes the file list resolved (a branch comparison's), so it matches the list
  const diffQuery = useMemo(() => (comparison === null ? null : diffQueryOf(comparison)), [comparison]);
  useEffect(() => {
    let live = true;
    setPatch({ status: "pending" });
    if (!changed || diffQuery === null) return () => { live = false; };
    fetchRepoDiffFile({ paneId, directory, ...diffQuery }, path, oldPath).then(
      (answer) => { if (live) setPatch({ status: "ready", answer }); },
      (error: unknown) => { if (live) setPatch({ status: "failed", error }); },
    );
    return () => { live = false; };
  }, [changed, oldPath, path, paneId, directory, diffQuery, fetchRepoDiffFile]);

  const text = source.status === "ready" ? source.text : null;
  const lines = useMemo(() => (text === null ? null : fileLines(text)), [text]);
  const showDiff = diffMode && changed;
  // where the comparison's comments go: on the file on disk, on a branch comparison's versions, or nowhere
  const place = comparison === null ? null : commentPlace(comparison);
  // the branch comparison whose diff is shown: its comments are on the patch's lines, not the file's on disk
  const branch = place?.kind === "branch" ? place.branches : null;
  const diffBranch = showDiff ? branch : null;
  // a Markdown file opens as its list keeps it (its rendered preview, the file viewer's renderer, or its source); the
  // other is one click away
  const isMarkdown = /\.(md|markdown)$/i.test(path);
  const previewBlocks = useReviewPreview(isMarkdown && source.status === "ready" ? source.text : null);
  const answer = patch.status === "ready" ? patch.answer : null;
  const diffPatch = answer?.patch ?? null;
  // the whole patch, unfolded: a branch comparison's comments are placed by it (the folded one hides unchanged lines)
  const fullFile = useMemo(() => (diffPatch === null || folded && branch === null ? null : parseFile(diffPatch)), [diffPatch, folded, branch]);
  const diffFile = useMemo(() => (diffPatch !== null && folded ? parseFile(trimPatchContext(diffPatch, FOLD_CONTEXT_LINES)) : fullFile), [diffPatch, folded, fullFile]);
  // what the file's place shows: everything below that draws the body reads it from here
  const shown = shownBody({ isMarkdown, markdownView, line, source, showDiff, patch, diffFile, lines });
  const previewShown = shown.kind === "preview";

  // the Markdown preview takes comments as the file viewer's preview does: the same sources, margin and layer, on the same store
  const previewText = useRef<HTMLDivElement>(null);
  const previewBody = useRef<HTMLDivElement>(null);
  const [previewNode, setPreviewNode] = useState<HTMLDivElement | null>(null);
  const attachPreview = useCallback((node: HTMLDivElement | null): void => {
    previewBody.current = node;
    setPreviewNode(node);
  }, []);
  const previewLayer = useRef<MarkdownCommentLayerHandle>(null);
  const previewScope = useMemo<FileCommentScope | null>(() => previewShown && lines !== null
    ? { owner, path: absolute, label: pathLabel(absolute, directory), view: "preview", lines, loaded: lines.length, truncated: false }
    : null, [previewShown, lines, owner, absolute, directory]);
  const previewComments = useFileComments(previewScope);
  const previewSource = usePreviewCommentSource(previewScope, previewBody, previewText, previewComments);
  const previewMargin = usePreviewMargin(previewSource !== null, previewText, previewBody, settings.commentLayout);
  // the two versions' lines the patch shows, which a branch comment is on
  const sides = useMemo(() => (branch === null || fullFile === null ? null : diffSides(fullFile)), [branch, fullFile]);
  // the data a comment needs is there: a branch diff's two versions, or else the file's text
  const canComment = diffBranch !== null ? sides !== null : lines !== null;
  // the mouse comments in comment mode only
  const commentable = settings.commentMode && canComment;
  const colored = diffPatch !== null && diffColorable(path, diffPatch);
  const counts = useMemo(() => (diffPatch === null ? null : countLines(diffPatch)), [diffPatch]);
  // the path's folder, muted, and its name, bold, as the file's bar shows them
  const slash = path.lastIndexOf("/");
  const folder = slash < 0 ? "" : path.slice(0, slash + 1);
  const fileName = path.slice(slash + 1);
  const diffStyle = diffStyleFor(settings.diffStyle, narrow);

  // the saved comments on this file's working-tree lines
  const savedHere = useMemo(() => comments.filter(isFileComment).filter((comment) => comment.path === absolute), [comments, absolute]);
  const fileShown = useMemo(() => savedHere.map((comment): ReviewNote => ({ comment, lines: comment.lines, side: "additions" })), [savedHere]);
  // the branch comments of this file in the comparison, each where its text is now; an outdated one is not drawn
  const placed = useMemo(() => (branch === null || sides === null ? [] : placeBranchComments(comments, branch, absolute, sides)), [comments, branch, absolute, sides]);
  const branchShown = useMemo(() => placed.flatMap(({ comment, lines: at }): ReviewNote[] => (at === null ? [] : [{ comment, lines: at, side: comment.place.side === "head" ? "additions" : "deletions" }])), [placed]);
  // a branch comment whose text moved is rewritten to its new lines and the version shown, once: then it stays
  useEffect(() => {
    for (const one of placed) if (one.moved !== null) blockComments.moveBranch(owner, one.comment.id, one.moved);
  }, [owner, placed]);
  // the comments drawn: the sheet edits one of them
  const notesShown = diffBranch !== null ? branchShown : fileShown;
  const editingNote = editing === null ? null : notesShown.find((note) => note.comment.id === editing) ?? null;

  // the rows the line cursor runs over: the diff's, or the whole file's lines as the library draws them; none in the
  // preview, the file viewer's view or a note. Kept while their source is the same: a new track settles the cursor
  const diffLineTrack = useMemo(() => (diffFile === null ? null : diffTrack(diffFile)), [diffFile]);
  const fileLineTrack = useMemo(() => (text === null ? null : fileTrack(drawnLineCount(text))), [text]);
  const track = shown.kind === "diff" ? diffLineTrack : shown.kind === "lines" || shown.kind === "virtual" ? fileLineTrack : null;
  const cursorField = useMemo(() => openField(draft !== null ? opening : null, editingNote, editByKey !== null), [draft, opening, editingNote, editByKey]);
  const cursor = useLineCursor(bodyRef, track, line, cursorField);
  // the cursor as the last render left it, for the views' and the library's callbacks, which outlive a render
  const cursorNow = useRef(cursor);
  useLayoutEffect(() => { cursorNow.current = cursor; });
  const follow = useCallback((rows: readonly DiffRow[]): void => cursorNow.current.follow(rows), []);
  // the range a mouse drag in FileView proposes, which the cursor draws as it goes (a state setter: the same every render)
  const { dragging } = cursor;
  const bodyClass = `review-file-body ${cursorClass(cursor.bar ? cursor.selection : null)}`.trim();

  // the saved comments on this file as the lines' annotations, each under its last line
  const fileNotes = useMemo(() => fileShown.map((note): LineAnnotation<ReviewNote> => ({ lineNumber: note.lines[1], metadata: note })), [fileShown]);
  // a working-tree comment is on a line of the working tree, a branch comment on a line of the branch's diff; the
  // index's diff has other line numbers and takes none
  const commentsOnDiff = place !== null && place.kind !== "none";
  const diffShown = place?.kind === "file" ? fileShown : branchShown;
  const diffNotes = useMemo(() => diffShown.map((note): DiffLineAnnotation<ReviewNote> => ({ lineNumber: note.lines[1], side: note.side, metadata: note })), [diffShown]);

  // a new comment's field on drawn rows: in a branch's diff on the lines of one of its versions (`branchTarget`);
  // otherwise on the working tree's (`workspacePick`), a comment on removed lines only refused. True when it opened
  const openDraft = useCallback((rows: readonly DiffRow[], from: DraftFrom): boolean => {
    let next: Draft;
    if (diffBranch !== null) {
      const target = sides === null ? null : branchTarget(diffBranch, { path: absolute, label: path }, sides, rows);
      if (target === null) return false;
      next = { kind: "branch", target };
    } else {
      const at = workspacePick(rows);
      if (at === null) {
        setRefused(true);
        return false;
      }
      next = { kind: "file", lines: at };
    }
    setRefused(false);
    setDraft(next);
    const byKey = "opener" in from;
    setOpening({ rows, byKey, opener: byKey ? from.opener : null });
    setAnchor(byKey ? null : from.rects ?? null);
    setDraftText(byKey ? null : from.ranges ?? null);
    return true;
  }, [diffBranch, sides, absolute, path]);
  // drawn rows the mouse picked (a selection, a press, a touch): a comment in comment mode
  const pick = useCallback((rows: readonly DiffRow[], rects?: DOMRect[], ranges?: Range[]) => {
    if (commentable) openDraft(rows, { rects, ranges });
  }, [commentable, openDraft]);
  // the field closes: the focus goes back to the element that had it when a key opened it, else nowhere
  const draftOpener = useCallback((): HTMLElement | null => opening?.opener ?? null, [opening]);
  const editFocus = useCallback((): HTMLElement | null => editByKey?.opener ?? null, [editByKey]);

  // a review key comes here first (`pressFile`); c and Enter comment as the mouse would, and turn comment mode on once
  // the field opened
  const commentsByKey = keyCommentable({ comments: settings.comments, canComment, shown: shown.kind, commentsOnDiff });
  const pressRef = useRef<ReviewFileKeyboard["press"]>(() => "passed");
  useLayoutEffect(() => {
    pressRef.current = (key, focused) => pressFile(key, {
      writing: draft !== null || editing !== null,
      tracked: track !== null,
      commentsByKey,
      cursor,
      scroll: (direction, by) => {
        const body = bodyRef.current?.querySelector<HTMLElement>(".review-scroll, .review-preview") ?? null;
        if (body === null) return false;
        // the browser's own steps: a page of seven eighths of the view, so a line or two stays in sight, and its arrow's line
        body.scrollBy({ top: direction * (by === "page" ? body.clientHeight * PAGE_FRACTION : LINE_STEP_PX) });
        return true;
      },
      open: (rows) => {
        const opener = focused instanceof HTMLElement ? focused : null;
        // a line that has a comment opens it to edit, as a click on its card does; else a new one
        const saved = savedCommentAt(notesShown, rows);
        if (saved !== null) edit(saved.comment.id, { opener });
        if ((saved !== null || openDraft(rows, { opener })) && !settings.commentMode) update({ commentMode: true });
      },
    });
  });
  useImperativeHandle(keyboard, () => ({ press: (key, focused) => pressRef.current(key, focused) }), []);
  // the text a new comment was opened on keeps a mark (the chat's pending fill) while the comment is written, as the
  // selection itself is gone once the field takes the focus
  useEffect(() => {
    if (draft === null || draftText === null || draftText.length === 0 || typeof CSS === "undefined" || !("highlights" in CSS)) return;
    CSS.highlights.set(DRAFT_HIGHLIGHT, new Highlight(...draftText));
    return () => { CSS.highlights.delete(DRAFT_HIGHLIGHT); };
  }, [draft, draftText]);
  // the library's line selection ends: the cursor follows it, and it stays drawn as the cursor's drag (a click on the
  // one selected line takes it away)
  const onSelect = useCallback((range: SelectedLineRange | null) => {
    dragging(range);
    if (range === null) return;
    const old = range.side === "deletions";
    const rows = [{ line: range.start, old }, { line: range.end, old }];
    follow(rows);
    pick(rows);
  }, [pick, follow, dragging]);

  // a new comment on the lines it was opened on
  const save = useCallback((at: Draft, note: string) => {
    if (at.kind === "branch") blockComments.saveBranch(owner, at.target, note);
    else if (lines !== null) blockComments.saveFile(owner, reviewTarget(absolute, path, at.lines, lines), note);
    else return;
    setDraft(null);
  }, [lines, owner, absolute, path]);

  // an edit keeps the comment's anchor, so the store replaces it rather than adding a second one
  const saveEdit = useCallback((comment: FileComment | BranchComment, note: string) => {
    if (comment.kind === "branch") blockComments.saveBranch(owner, branchTargetOf(comment), note);
    else if (lines !== null) blockComments.saveFile(owner, { ...reviewTarget(absolute, path, comment.lines, lines), anchor: comment.anchor }, note);
    else return;
    setEditing(null);
  }, [lines, owner, absolute, path]);

  // the comment just deleted, for its Undo (the store keeps none): offered until the next delete, another file, or UNDO_MS
  const [undoable, setUndoable] = useState<FileComment | BranchComment | null>(null);
  useEffect(() => {
    if (undoable === null) return;
    const timer = window.setTimeout(() => setUndoable(null), UNDO_MS);
    return () => window.clearTimeout(timer);
  }, [undoable]);
  const removeComment = useCallback((comment: FileComment | BranchComment) => {
    blockComments.remove(owner, [comment.id]);
    setEditing(null);
    setUndoable(comment);
  }, [owner]);
  // back under its own anchor, with its text: the store finds no comment there and adds it again
  const undoDelete = (): void => {
    if (undoable === null) return;
    if (undoable.kind === "branch") {
      blockComments.saveBranch(owner, branchTargetOf(undoable), undoable.comment);
    } else {
      const { kind: _kind, id: _id, created: _created, comment, ...target } = undoable;
      blockComments.saveFile(owner, target, comment);
    }
    setUndoable(null);
  };

  const renderCard = useCallback((annotation: LineAnnotation<ReviewNote>) => {
    const { comment, lines: drawn } = annotation.metadata;
    if (editing === comment.id) {
      if (sheetInput) return null;
      return <CommentPopover placement="row" quote={{ text: "" }} comment={comment.comment} onSave={(value) => saveEdit(comment, value)} onDelete={() => removeComment(comment)} onClose={() => setEditing(null)} opener={editFocus} fallback={noFocus} />;
    }
    // a saved comment is drawn as its open field (CommentAtRest): with the mode on, the text opens it to edit (a click or
    // a key, never the focus alone) and it has its Delete; off, it is read only
    const line = drawn[0];
    return <CommentAtRest text={comment.comment} commentId={comment.id}
      onEdit={settings.commentMode ? () => edit(comment.id) : undefined}
      onDelete={settings.commentMode ? () => removeComment(comment) : undefined}
      editLabel={t("Comment on line {line}: {comment}", { line, comment: comment.comment })}
      deleteLabel={t("Delete comment on line {line}", { line })} />;
  }, [saveEdit, removeComment, editing, edit, editFocus, sheetInput, settings.commentMode, t]);

  // each comment's line gets its own padded box: the space around the field is the box's, which the line's row keeps
  const renderNote = useCallback((annotation: LineAnnotation<ReviewNote>) => <div className="review-note">{renderCard(annotation)}</div>, [renderCard]);

  const draftAnchor = useDraftAnchor(bodyRef, draft, anchor);

  // a new comment takes the focus once it is drawn: only the new field (`data-draft`), at most ten frames, then it lets go
  useEffect(() => {
    if (draft === null) return;
    let frames = 0;
    let frame = 0;
    const focusNew = (): void => {
      const field = document.querySelector<HTMLTextAreaElement>("[data-draft] textarea");
      if (field !== null) {
        // no scrolling to the field: the place the user is at stays (the browser scrolled to the top without it)
        field.focus({ preventScroll: true });
        return;
      }
      if (frames++ < 10) frame = requestAnimationFrame(focusNew);
    };
    frame = requestAnimationFrame(focusNew);
    return () => cancelAnimationFrame(frame);
  }, [draft]);

  const diffOptions = useMemo<FileDiffOptions<ReviewNote, undefined>>(() => ({
    disableFileHeader: true,
    diffStyle,
    hunkSeparators: "line-info",
    overflow: settings.wrapCode ? "wrap" : "scroll",
    theme: SOURCE_THEME,
    themeType: resolvedTheme,
    tokenizeMaxLength: colored ? VIRTUAL_HIGHLIGHT_LINES : 0,
    lineHoverHighlight: "disabled",
    unsafeCSS: REVIEW_CSS,
    enableLineSelection: false,
  }), [diffStyle, settings.wrapCode, resolvedTheme, colored]);

  const fileOptions = useMemo<FileOptions<ReviewNote, undefined>>(() => ({
    theme: SOURCE_THEME,
    themeType: resolvedTheme,
    overflow: settings.wrapCode ? "wrap" : "scroll",
    tokenizeMaxLength: VIRTUAL_HIGHLIGHT_LINES,
    lineHoverHighlight: "disabled",
    unsafeCSS: REVIEW_CSS,
    enableLineSelection: true,
    // the selection is controlled (the cursor's), so the library only proposes a drag: the cursor draws it as it goes
    onLineSelectionStart: dragging,
    onLineSelectionChange: dragging,
    onLineSelectionEnd: onSelect,
  }), [settings.wrapCode, resolvedTheme, dragging, onSelect]);

  const plainOptions = useMemo<FileOptions<ReviewNote, undefined>>(() => ({ ...fileOptions, enableLineSelection: false, onLineSelectionEnd: undefined }), [fileOptions]);

  let body: ReactNode;
  if (shown.kind === "preview") {
    body = previewBlocks === "pending" ? <ReviewLoading />
      : previewBlocks === "failed" ? <p className="repo-diff-note" role="alert">{t("This preview can't be shown.")}</p>
      : <div ref={attachPreview} className="review-preview">
        <div ref={previewText} className={settings.markdownWidth === "readable" ? "review-preview-text review-preview-readable" : "review-preview-text"}><ProgressiveMarkdown className={settings.markdownWidth === "readable" ? "file-viewer-markdown file-viewer-markdown-readable" : "file-viewer-markdown"} blocks={previewBlocks} /></div>
        <MarkdownCommentLayer ref={previewLayer} source={previewSource} reference={(target) => ({ path: target.label, lines: target.lines })} surface={previewNode} roots={() => previewText.current === null ? [] : [previewText.current]} mode={settings.commentMode} margin={previewMargin} focusFallback={noFocus} />
      </div>;
  } else if (shown.kind === "diff") {
    body = <DiffView file={shown.file} options={diffOptions} notes={diffNotes} renderNote={renderNote} onComment={pick} commenting={commentable && commentsOnDiff && !touch} gesture={commentsOnDiff ? touchGesture : null} selection={cursor.selection} bodyClass={bodyClass} onFollow={follow} />;
  } else if (shown.kind === "lines") {
    body = <LinesView name={path} contents={shown.text} options={plainOptions} notes={fileNotes} renderNote={renderNote} onComment={pick} commenting={commentable && !touch} gesture={touchGesture} selection={cursor.selection} bodyClass={bodyClass} onFollow={follow} />;
  } else if (shown.kind === "virtual") {
    body = <FileView name={path} contents={shown.text} options={fileOptions} notes={fileNotes} renderNote={renderNote} onComment={pick} gesture={touchGesture} selection={cursor.selection} bodyClass={bodyClass} />;
  } else if (shown.kind === "viewer") {
    body = null;
  } else {
    const { note } = shown;
    body = note.of === "loading" ? <ReviewLoading />
      : note.of === "error" ? <p className="repo-diff-note" role="alert">{diffErrorMessage(t, note.error)}</p>
      : note.of === "unavailable" ? <p className="repo-diff-note">{unavailableMessage(t, note.answer) || t("No lines changed.")}</p>
      : note.of === "unparsable" ? <p className="repo-diff-note" role="alert">{t("This change can't be shown.")}</p>
      : <p className="repo-diff-note">{note.text}</p>;
  }

  // a file the review cannot draw is the file viewer's, in its docked view, filling the pane; a large text file's diff
  // stays the review's
  // the header's title, the same in every view: the path from the root, its folder dim (a plain folder's file by its
  // name alone: the dialog's header names the folder), a renamed file's old path before it
  const title = <span className="review-file-path" dir="ltr" title={absolute}>
    {change?.old_path != null && change.old_path !== path && <span className="review-file-folder">{change.old_path} → </span>}
    {!plain && folder !== "" && <span className="review-file-folder">{folder}</span>}<span className="review-file-name">{fileName}</span>
  </span>;
  // what the file is, beside its title: its change (and in the diff its counts), that git ignores it, or a long text's length
  const status = change !== null ? <span className="repo-diff-status" data-status={change.status}>{statusWord(t, change.status)}</span>
    : ignored ? <span className="repo-diff-status" data-status="ignored">{t("Ignored")}</span> : null;
  // a changed file is marked as viewed here, as on a pull request: the tree checks it until the file changes again.
  // The last of the file's tools in every view, at the header's right end
  const viewedBox = viewed !== null && <button type="button" className="icon-button repo-diff-action review-viewed" aria-pressed={viewed}
    aria-label={t("Viewed")} aria-keyshortcuts={keysOn ? "v" : undefined}
    title={keysOn ? (viewed ? t("Viewed (V)") : t("Mark as viewed (V)")) : viewed ? t("Viewed") : t("Mark as viewed")} onClick={() => onViewed?.(!viewed)}>
    {viewed ? <CircleCheck aria-hidden="true" /> : <Circle aria-hidden="true" />}
  </button>;
  const long = !showDiff && lines !== null && lines.length > VIRTUAL_HIGHLIGHT_LINES
    ? <span className="review-file-fact">{t("{count} lines", { count: lines.length.toLocaleString() })} · {t("without colours")}</span> : null;

  // the line asked for, once its row is drawn: in the middle of the view. Looked for a few seconds (the library draws
  // later than React); once found, never again, so the user's own scrolling stays. Above the viewer's early return, so
  // a file that turns out to be the viewer's keeps the same hooks
  const jumped = useRef(false);
  const drawnBody = shown.kind === "lines" || shown.kind === "virtual";
  useEffect(() => {
    if (line === undefined || jumped.current || !drawnBody) return;
    let frame = 0;
    let tries = 0;
    const look = (): void => {
      const row = bodyRef.current === null ? null : rowElement(bodyRef.current, { line, old: false });
      if (row !== null) {
        jumped.current = true;
        row.scrollIntoView({ block: "center" });
        return;
      }
      if (tries++ < 180) frame = requestAnimationFrame(look);
    };
    frame = requestAnimationFrame(look);
    return () => cancelAnimationFrame(frame);
  }, [line, drawnBody]);

  // a file the review cannot draw is the file viewer's view, filling the pane under the review's own header (the
  // viewer's header and toolbar are hidden, ReviewDialog.css): its size, and a text's partial view said; a large text
  // file's diff stays the review's
  if (shown.kind === "viewer") return <div className="review-file review-viewer">
    <div className="review-file-head">
      <div className="review-file-title">
        {title}
        <div className="review-file-facts">
          {status}
          <span className="review-file-fact">{formatBytes(shown.size)}{shown.media ? "" : ` · ${t("Partial view")}`}</span>
        </div>
      </div>
      <div className="review-tools">
        <div className="repo-diff-group">
          <a className="icon-button repo-diff-action" href={fileUrl(absolute, paneId)} target="_blank" rel="noopener" aria-label={t("Open in a new tab")} title={t("Open in a new tab")}><ExternalLink aria-hidden="true" /></a>
          <a className="icon-button repo-diff-action" href={fileUrl(absolute, paneId, true)} download={fileName} aria-label={t("Download")} title={t("Download")}><Download aria-hidden="true" /></a>
          {viewedBox}
        </div>
      </div>
    </div>
    <FileViewer docked path={absolute} paneId={paneId} machineId={machineId} paneFolder={directory} onClose={onClose} onOpen={onOpen} keyboardActive={false} />
  </div>;

  // a new or edited comment's lines as a sheet quotes them: a branch comment's from its version, any other's from the file
  const draftAt = draft === null ? null : draftLines(draft);
  const draftQuote = draft === null ? undefined : draft.kind === "branch" ? versionQuote(draft.target.source) : lines === null ? undefined : lineQuote(lines, draft.lines);
  const editingQuote = editingNote === null ? undefined : editingNote.comment.kind === "branch" ? versionQuote(editingNote.comment.source) : lines === null ? undefined : lineQuote(lines, editingNote.lines);

  return <div ref={bodyRef} className="review-file" data-mode={showDiff ? "diff" : "file"}>
    <div className="review-file-head">
      <div className="review-file-title">
        {title}
        {(status !== null || showDiff && counts !== null || long !== null) && <div className="review-file-facts">
          {status}
          {showDiff && counts !== null && <span className="review-counts"><span className="review-count-added">+{counts.added}</span><span className="review-count-removed">−{counts.removed}</span></span>}
          {long}
        </div>}
      </div>
      <div className="review-tools">
        {isMarkdown && source.status === "ready" && <div className="segmented review-mode" role="group" aria-label={t("View")}>
          <button type="button" aria-pressed={previewShown} onClick={() => onMarkdownView("preview")}>{t("Preview")}</button>
          <button type="button" aria-pressed={!previewShown} onClick={() => onMarkdownView("source")}>{t("Source")}</button>
        </div>}
        {/* Unified | Split, where Split fits: a narrow screen has one column only, so there is nothing to choose */}
        {showDiff && !narrow && <div className="segmented repo-diff-styles" role="group" aria-label={t("Diff layout")}>
          <button type="button" aria-pressed={diffStyle === "unified"} onClick={() => update({ diffStyle: "unified" })}><Rows3 aria-hidden="true" /><span>{t("Unified")}</span></button>
          <button type="button" aria-pressed={diffStyle === "split"} onClick={() => update({ diffStyle: "split" })}><Columns2 aria-hidden="true" /><span>{t("Split")}</span></button>
        </div>}
        <div className={isMarkdown && source.status === "ready" || showDiff && !narrow ? "repo-diff-group review-tools-rest" : "repo-diff-group"}>
          {settings.comments && <CommentModeToggle className="review-comments" count={previewShown ? previewComments.shown.length : notesShown.length} hintOn={previewShown ? "select" : settings.mobileCommentGesture} showHint={showHint} />}
          <button type="button" className="icon-button repo-diff-action" aria-pressed={settings.wrapCode} aria-label={t("Wrap lines")} title={t("Wrap lines")} onClick={() => update({ wrapCode: !settings.wrapCode })}><WrapText aria-hidden="true" /></button>
          {showDiff && <button type="button" className="icon-button repo-diff-action" aria-pressed={folded} aria-label={t("Fold context")} title={folded ? t("Showing one line around each change") : t("Fold context")} disabled={diffPatch === null} onClick={() => setFolded(!folded)}><FoldVertical aria-hidden="true" /></button>}
          {viewedBox}
        </div>
      </div>
    </div>
    {settings.comments && <CommentModeHint surface={bodyRef} hint={hint} />}
    {undoable !== null && <p className="review-file-hint review-undo" role="status">
      <span>{t("Comment deleted.")}</span>
      <button type="button" className="btn btn-ghost" onClick={undoDelete}>{t("Undo")}</button>
    </p>}
    {/* the working tree's refusal; a branch diff takes removed lines. In the document from the first render, clipped
        while empty, so its words are announced when they come */}
    <p className={refused && diffBranch === null ? "review-file-hint" : "visually-hidden"} role="status">{refused && diffBranch === null && <>
      {t("Comments go on lines of the file as it is now, not on removed ones.")}
      {/* a branch's worktree compared with its uncommitted changes: without them its diff takes removed lines */}
      {comparison?.scope === "uncommitted" && comparison.worktree !== null && <> {t("Turn off “Show uncommitted changes” in View options to comment on removed lines.")}</>}
    </>}</p>
    {showDiff && place?.kind === "none" && <p className="review-file-hint">{t("Comments on staged changes aren't supported.")}</p>}
    {draft !== null && draftAt !== null && !sheetInput && draftAnchor !== null && <DraftField key={`${draftOnBase(draft) ? "base" : "head"}-${draftAt[0]}-${draftAt[1]}`} anchor={draftAnchor}>
      <CommentPopover placement="row" reference={{ path, lines: draftAt }} showReference quote={{ text: "" }} comment="" onSave={(value) => save(draft, value)} onDelete={() => setDraft(null)} onClose={() => setDraft(null)} opener={draftOpener} fallback={noFocus} />
    </DraftField>}
    {body}
    {sheetInput && draft !== null && draftAt !== null && <CommentPopover placement="sheet" label={t("Comment on line {line}", { line: draftAt[0] })} sheetQuote={draftQuote} quote={{ text: "" }} comment="" onSave={(value) => save(draft, value)} onDelete={() => setDraft(null)} onClose={() => setDraft(null)} opener={draftOpener} fallback={noFocus} />}
    {sheetInput && editingNote !== null && <CommentPopover placement="sheet" label={t("Comment on line {line}", { line: editingNote.lines[0] })} sheetQuote={editingQuote} quote={{ text: "" }} comment={editingNote.comment.comment} onSave={(value) => saveEdit(editingNote.comment, value)} onDelete={() => removeComment(editingNote.comment)} onClose={() => setEditing(null)} opener={editFocus} fallback={noFocus} />}
  </div>;
}
