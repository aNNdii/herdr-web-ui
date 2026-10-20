import { useCallback, useEffect, useMemo, useRef, useLayoutEffect, useState, type ReactNode, type RefObject } from "react";
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
// a saved comment is drawn as the file viewer draws one (`.code-comment-card`)
import "./CodeComments.css";
import "./ReviewDialog.css";

import type { RepoDiffFile, RepoDiffFilePatch } from "../../shared/protocol.ts";
import { blockComments, useBlockComments } from "../lib/blockComments.ts";
import { branchTarget, branchTargetOf, placeBranchComments, type BranchComment, type BranchTarget } from "../lib/branchComments.ts";
import { commentPlace, diffQueryOf, type ReviewComparison } from "../lib/branchReview.ts";
import { diffSides, type DiffRow } from "../lib/diffSides.ts";
import { fileLines, isFileComment, pathLabel, type FileComment, type LineRange } from "../lib/fileComments.ts";
import { formatBytes } from "../lib/bridgeProgress.ts";
import { LINE_ELEMENT_LIMIT } from "../lib/highlight.ts";
import { useT } from "../lib/i18n.ts";
import type { MarkdownBlock } from "../lib/markdown.ts";
import { knownPreview, parsePreviewOffThread } from "../lib/markdownPreview.ts";
import { useMachineApi, useMachineId } from "../lib/machineContext.tsx";
import { diffColorable, diffErrorMessage, diffStyleFor, statusWord, unavailableMessage } from "../lib/repoDiff.ts";
import { repositoryFile, reviewTarget, workspacePick } from "../lib/review.ts";
import { fieldPlace, revealBy } from "../lib/selectionField.ts";
import { useSettings, type MobileCommentGesture } from "../lib/settings.ts";
import { SHEET_QUERY } from "../lib/sheets.ts";
import { VIRTUAL_HIGHLIGHT_LINES } from "../lib/sourcePreview.ts";
import { contentKey, DIFF_SHADOW_CSS, SCROLL_CONFIG, SOURCE_THEME } from "../lib/sourceTheme.ts";
import { useMediaQuery } from "../lib/useMediaQuery.ts";
import { lineQuote } from "../lib/commentPopover.ts";

/** A file larger than this is not read for the review: its diff still shows, its whole text the file viewer shows (in part, without comments). */
export const REVIEW_MAX_BYTES = 10 * 1024 * 1024;
/** Unchanged lines kept around each change when the context is folded (the package's trimmer needs at least 1). */
const FOLD_CONTEXT_LINES = 1;

/**
 * The review's code: the diff's shared shadow CSS (sourceTheme.ts), then its own :host values, which come later and so win.
 * Larger type than the Changes view's, and stronger row tints, so a diff reads at a glance. The Changes view keeps its own.
 */
/** The highlight of the text a new comment is being written on (drawn in the diff's shadow root, by REVIEW_CSS). */
const DRAFT_HIGHLIGHT = "review-draft";

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
}

/**
 * What an annotation on a line of the review is: a saved comment, on the lines it is drawn on (a branch comment's as
 * placed in the diff shown) and on their side, a removed line's being the old file's. A new one is not an annotation but
 * a card portalled into the scrolling body (`DraftField`): a change of the annotations redraws the file, and the scroll
 * place with it.
 */
interface ReviewNote { comment: FileComment | BranchComment; lines: LineRange; side: "additions" | "deletions" }

/**
 * A new comment being written: on lines of the working tree's file, or, in a branch comparison's diff, on lines of one
 * of its versions (`BranchTarget`, its text from the patch).
 */
type Draft = { kind: "file"; lines: LineRange } | { kind: "branch"; target: BranchTarget };

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

/**
 * Whether a drawn row is a line of the old file: a removed line, or any line of a split view's left column, whose
 * numbers are the old file's (an unchanged line there has the old number too).
 */
function onOldSide(row: HTMLElement): boolean {
  return (row.dataset.lineType ?? "").includes("deletion") || row.closest("[data-deletions]") !== null;
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
      const row = event.composedPath().find((node): node is HTMLElement => node instanceof HTMLElement && node.hasAttribute("data-line"));
      const line = Number(row?.dataset.line);
      if (row === undefined || !Number.isFinite(line) || line < 1) return;
      const started: LinePress = { x: event.clientX, y: event.clientY, row: { line, old: onOldSide(row) }, started: event.timeStamp, timer: undefined };
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
 * offers one. The diff draws its code in shadow roots, so the selection is read from the root the text is in.
 */
function useDiffSelection(host: RefObject<HTMLDivElement | null>, enabled: boolean): DiffSelection | null {
  const [offer, setOffer] = useState<DiffSelection | null>(null);
  useEffect(() => {
    if (!enabled) {
      setOffer(null);
      return;
    }
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
        // every row, the old file's too: which of them a comment keeps is the comparison's to say (`pick`)
        const rows = [...root.querySelectorAll<HTMLElement>("[data-line]")].filter((row) => range.intersectsNode(row))
          .map((row) => ({ line: Number(row.dataset.line), old: onOldSide(row) }))
          .filter((row) => Number.isFinite(row.line) && row.line > 0);
        if (rows.length === 0) continue;
        found = { root, ranges: [range], rows };
        break;
      }
      setOffer(found);
    };
    // the button comes once the press is over (a drag, a long press), not while the selection is still being made
    let pressed = false;
    const down = (event: Event): void => {
      // a press on the Comment button is its click: it must not hide the button before the click lands
      if (event.target instanceof Element && event.target.closest(`.${SELECTION_BUTTON_CLASS}`) !== null) return;
      pressed = true;
      setOffer(null);
    };
    const up = (): void => {
      pressed = false;
      check();
    };
    const changed = (): void => {
      if (pressed) setOffer(null);
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
  }, [host, enabled]);
  return offer;
}

function DiffView({ file, options, notes, renderNote, onComment, commenting, gesture }: {
  file: FileDiffMetadata;
  options: FileDiffOptions<ReviewNote, undefined>;
  notes: DiffLineAnnotation<ReviewNote>[];
  renderNote: (annotation: LineAnnotation<ReviewNote>) => ReactNode;
  onComment: OnComment;
  commenting: boolean;
  gesture: MobileCommentGesture | null;
}) {
  const host = useRef<HTMLDivElement>(null);
  const offer = useDiffSelection(host, commenting);
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
        <FileDiff className="review-file-body" fileDiff={file} options={options} lineAnnotations={notes} renderAnnotation={renderNote} />
      </div>
    </DiffWorkerPool>
    {!drawn && <div className="review-drawing"><ReviewLoading /></div>}
    {offer !== null && host.current !== null && <SelectionButton surface={host.current} ranges={offer.ranges} onComment={comment} />}
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
  lastRight: number;
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
    const anchorAt = (scroller: HTMLElement, boxes: readonly DOMRect[]): void => {
      const outer = scroller.getBoundingClientRect();
      const x = scroller.scrollLeft - outer.left - scroller.clientLeft;
      const y = scroller.scrollTop - outer.top - scroller.clientTop;
      setAnchor({
        scroller,
        firstTop: Math.min(...boxes.map((box) => box.top)) + y,
        firstLeft: boxes[0]!.left + x,
        lastBottom: Math.max(...boxes.map((box) => box.bottom)) + y,
        lastRight: boxes[boxes.length - 1]!.right + x,
      });
    };
    const find = (): void => {
      const scroller = root.current?.querySelector<HTMLElement>(".review-scroll") ?? null;
      if (scroller === null) return;
      const drawn = (rects ?? []).filter((rect) => rect.width > 0 || rect.height > 0);
      if (drawn.length > 0) {
        anchorAt(scroller, drawn);
        return;
      }
      const lines = [...(root.current?.querySelector("diffs-container")?.shadowRoot?.querySelectorAll<HTMLElement>(`[data-line="${draftLines(draft)[1]}"]`) ?? [])];
      // a comment on removed lines goes under its removed row, whose number is the old file's
      const removed = draftOnBase(draft) ? lines.find((node) => (node.dataset.lineType ?? "").includes("deletion")) : undefined;
      // split view: the same number is drawn on both sides; any other comment goes on the right side
      const line = removed ?? lines.filter((node) => node.dataset.lineType !== "change-deletion").reduce<HTMLElement | undefined>((best, node) => best === undefined || node.getBoundingClientRect().right > best.getBoundingClientRect().right ? node : best, undefined) ?? lines[0];
      if (line !== undefined) {
        anchorAt(scroller, [line.getBoundingClientRect()]);
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
        last: { bottom: anchor.lastBottom + y, right: anchor.lastRight + x },
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
function LinesView({ name, contents, options, notes, renderNote, onComment, commenting, gesture }: {
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
  const offer = useDiffSelection(host, commenting);
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
        <File className="review-file-body" file={file} options={options} lineAnnotations={notes} renderAnnotation={renderNote} />
      </div>
    </DiffWorkerPool>
    {!drawn && <div className="review-drawing"><ReviewLoading /></div>}
    {offer !== null && host.current !== null && <SelectionButton surface={host.current} ranges={offer.ranges} onComment={comment} />}
  </div>;
}

/** The whole file, its lines with the comments under them. */
function FileView({ name, contents, options, notes, renderNote, onComment, gesture }: {
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
        <File className="review-file-body" file={file} options={options} lineAnnotations={notes} renderAnnotation={renderNote} />
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
export function ReviewFile({ owner, paneId, directory, root, path, change, diffMode, comparison, plain = false, ignored = false, viewed = null, onViewed, onClose, onOpen, line }: ReviewFileProps) {
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
  const [draftText, setDraftText] = useState<Range[] | null>(null);
  const [anchor, setAnchor] = useState<DOMRect[] | null>(null);
  const [refused, setRefused] = useState(false);
  const [folded, setFolded] = useState(false);
  // the saved comment being edited, by its id: its card turns into the field
  const [editing, setEditing] = useState<string | null>(null);
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
  // a Markdown file opens as its rendered preview (the file viewer's renderer); its source is one click away
  const isMarkdown = /\.(md|markdown)$/i.test(path);
  const [preview, setPreview] = useState(isMarkdown && line === undefined);
  const previewBlocks = useReviewPreview(isMarkdown && source.status === "ready" ? source.text : null);
  // the Markdown preview takes comments as the file viewer's preview does: the same sources, margin and layer, on the same store
  const previewText = useRef<HTMLDivElement>(null);
  const previewBody = useRef<HTMLDivElement>(null);
  const [previewNode, setPreviewNode] = useState<HTMLDivElement | null>(null);
  const attachPreview = useCallback((node: HTMLDivElement | null): void => {
    previewBody.current = node;
    setPreviewNode(node);
  }, []);
  const previewLayer = useRef<MarkdownCommentLayerHandle>(null);
  const previewScope = useMemo<FileCommentScope | null>(() => isMarkdown && preview && lines !== null
    ? { owner, path: absolute, label: pathLabel(absolute, directory), view: "preview", lines, loaded: lines.length, truncated: false }
    : null, [isMarkdown, preview, lines, owner, absolute, directory]);
  const previewComments = useFileComments(previewScope);
  const previewSource = usePreviewCommentSource(previewScope, previewBody, previewText, previewComments);
  const previewMargin = usePreviewMargin(previewSource !== null, previewText, previewBody, settings.commentLayout);
  const answer = patch.status === "ready" ? patch.answer : null;
  const diffPatch = answer?.patch ?? null;
  // the whole patch, unfolded: a branch comparison's comments are placed by it (the folded one hides unchanged lines)
  const fullFile = useMemo(() => (diffPatch === null || folded && branch === null ? null : parseFile(diffPatch)), [diffPatch, folded, branch]);
  const diffFile = useMemo(() => (diffPatch !== null && folded ? parseFile(trimPatchContext(diffPatch, FOLD_CONTEXT_LINES)) : fullFile), [diffPatch, folded, fullFile]);
  // the two versions' lines the patch shows, which a branch comment is on
  const sides = useMemo(() => (branch === null || fullFile === null ? null : diffSides(fullFile)), [branch, fullFile]);
  const commentable = settings.commentMode && (diffBranch !== null ? sides !== null : lines !== null);
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
  const shown = diffBranch !== null ? branchShown : fileShown;
  const editingNote = editing === null ? null : shown.find((note) => note.comment.id === editing) ?? null;

  // the saved comments on this file as the lines' annotations, each under its last line
  const fileNotes = useMemo(() => fileShown.map((note): LineAnnotation<ReviewNote> => ({ lineNumber: note.lines[1], metadata: note })), [fileShown]);
  // a working-tree comment is on a line of the working tree, a branch comment on a line of the branch's diff; the
  // index's diff has other line numbers and takes none
  const commentsOnDiff = place !== null && place.kind !== "none";
  const diffShown = place?.kind === "file" ? fileShown : branchShown;
  const diffNotes = useMemo(() => diffShown.map((note): DiffLineAnnotation<ReviewNote> => ({ lineNumber: note.lines[1], side: note.side, metadata: note })), [diffShown]);

  // drawn rows the user picked: in a branch's diff the lines of one of its versions (`branchTarget`); otherwise the
  // working tree's (`workspacePick`), a comment on removed lines only refused
  const pick = useCallback((rows: readonly DiffRow[], rects?: DOMRect[], ranges?: Range[]) => {
    if (!commentable) return;
    let next: Draft;
    if (diffBranch !== null) {
      const target = sides === null ? null : branchTarget(diffBranch, { path: absolute, label: path }, sides, rows);
      if (target === null) return;
      next = { kind: "branch", target };
    } else {
      const at = workspacePick(rows);
      if (at === null) {
        setRefused(true);
        return;
      }
      next = { kind: "file", lines: at };
    }
    setRefused(false);
    setDraft(next);
    setAnchor(rects ?? null);
    setDraftText(ranges ?? null);
  }, [commentable, diffBranch, sides, absolute, path]);
  // the text a new comment was opened on keeps a mark (the chat's pending fill) while the comment is written, as the
  // selection itself is gone once the field takes the focus
  useEffect(() => {
    if (draft === null || draftText === null || draftText.length === 0 || typeof CSS === "undefined" || !("highlights" in CSS)) return;
    CSS.highlights.set(DRAFT_HIGHLIGHT, new Highlight(...draftText));
    return () => { CSS.highlights.delete(DRAFT_HIGHLIGHT); };
  }, [draft, draftText]);
  const onSelect = useCallback((range: SelectedLineRange | null) => {
    if (range === null) return;
    const old = range.side === "deletions";
    pick([{ line: range.start, old }, { line: range.end, old }]);
  }, [pick]);

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
      return <CommentPopover placement="row" quote={{ text: "" }} comment={comment.comment} onSave={(value) => saveEdit(comment, value)} onDelete={() => removeComment(comment)} onClose={() => setEditing(null)} opener={noFocus} fallback={noFocus} />;
    }
    // a saved comment is drawn as its open field (CommentAtRest): with the mode on, the text opens it to edit (a click or
    // a key, never the focus alone) and it has its Delete; off, it is read only
    const line = drawn[0];
    return <CommentAtRest text={comment.comment} commentId={comment.id}
      onEdit={settings.commentMode ? () => setEditing(comment.id) : undefined}
      onDelete={settings.commentMode ? () => removeComment(comment) : undefined}
      editLabel={t("Comment on line {line}: {comment}", { line, comment: comment.comment })}
      deleteLabel={t("Delete comment on line {line}", { line })} />;
  }, [saveEdit, removeComment, editing, sheetInput, settings.commentMode, t]);

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
    onLineSelectionEnd: onSelect,
  }), [settings.wrapCode, resolvedTheme, onSelect]);

  const plainOptions = useMemo<FileOptions<ReviewNote, undefined>>(() => ({ ...fileOptions, enableLineSelection: false, onLineSelectionEnd: undefined }), [fileOptions]);

  let body: ReactNode;
  // the preview needs the file's text: a deleted, too large or unreadable file falls through to its diff or its note
  if (preview && isMarkdown && source.status === "ready") {
    body = previewBlocks === "pending" ? <ReviewLoading />
      : previewBlocks === "failed" ? <p className="repo-diff-note" role="alert">{t("This preview can't be shown.")}</p>
      : <div ref={attachPreview} className="review-preview">
        <div ref={previewText} className={settings.markdownWidth === "readable" ? "review-preview-text review-preview-readable" : "review-preview-text"}><ProgressiveMarkdown className={settings.markdownWidth === "readable" ? "file-viewer-markdown file-viewer-markdown-readable" : "file-viewer-markdown"} blocks={previewBlocks} /></div>
        <MarkdownCommentLayer ref={previewLayer} source={previewSource} reference={(target) => ({ path: target.label, lines: target.lines })} surface={previewNode} roots={() => previewText.current === null ? [] : [previewText.current]} mode={settings.commentMode} margin={previewMargin} focusFallback={noFocus} />
      </div>;
  } else if (showDiff) {
    if (patch.status === "pending") body = <ReviewLoading />;
    else if (patch.status === "failed") body = <p className="repo-diff-note" role="alert">{diffErrorMessage(t, patch.error)}</p>;
    else if (diffPatch === null || answer === null) body = <p className="repo-diff-note">{(answer !== null && unavailableMessage(t, answer)) || t("No lines changed.")}</p>;
    else if (diffFile === null) body = <p className="repo-diff-note" role="alert">{t("This change can't be shown.")}</p>;
    else body = <DiffView file={diffFile} options={diffOptions} notes={diffNotes} renderNote={renderNote} onComment={pick} commenting={commentable && commentsOnDiff && !touch} gesture={commentsOnDiff ? touchGesture : null} />;
  } else if (source.status === "pending") {
    body = <ReviewLoading />;
  } else if (source.status === "ready") {
    body = lines !== null && lines.length <= LINE_ELEMENT_LIMIT
      ? <LinesView name={path} contents={source.text} options={plainOptions} notes={fileNotes} renderNote={renderNote} onComment={pick} commenting={commentable && !touch} gesture={touchGesture} />
      : <FileView name={path} contents={source.text} options={fileOptions} notes={fileNotes} renderNote={renderNote} onComment={pick} gesture={touchGesture} />;
  } else if (source.status === "viewer") {
    body = null;
  } else if (source.status === "none") {
    body = <p className="repo-diff-note">{source.note}</p>;
  } else {
    body = <p className="repo-diff-note" role="alert">{diffErrorMessage(t, source.error)}</p>;
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
    aria-label={t("Viewed")} title={viewed ? t("Viewed") : t("Mark as viewed")} onClick={() => onViewed?.(!viewed)}>
    {viewed ? <CircleCheck aria-hidden="true" /> : <Circle aria-hidden="true" />}
  </button>;
  const long = !showDiff && lines !== null && lines.length > VIRTUAL_HIGHLIGHT_LINES
    ? <span className="review-file-fact">{t("{count} lines", { count: lines.length.toLocaleString() })} · {t("without colours")}</span> : null;

  // the line asked for, once its row is drawn: in the middle of the view. Looked for a few seconds (the library draws
  // later than React); once found, never again, so the user's own scrolling stays. Above the viewer's early return, so
  // a file that turns out to be the viewer's keeps the same hooks
  const jumped = useRef(false);
  const drawnBody = source.status === "ready" && !showDiff && !preview;
  useEffect(() => {
    if (line === undefined || jumped.current || !drawnBody) return;
    let frame = 0;
    let tries = 0;
    const look = (): void => {
      for (const element of bodyRef.current?.querySelectorAll<HTMLElement>("*") ?? []) {
        const row = element.shadowRoot?.querySelector<HTMLElement>(`[data-line="${line}"]`) ?? null;
        if (row === null) continue;
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
  if (source.status === "viewer" && (source.media || !showDiff)) return <div className="review-file review-viewer">
    <div className="review-file-head">
      <div className="review-file-title">
        {title}
        <div className="review-file-facts">
          {status}
          <span className="review-file-fact">{formatBytes(source.size)}{source.media ? "" : ` · ${t("Partial view")}`}</span>
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
          <button type="button" aria-pressed={preview} onClick={() => setPreview(true)}>{t("Preview")}</button>
          <button type="button" aria-pressed={!preview} onClick={() => setPreview(false)}>{t("Source")}</button>
        </div>}
        {/* Unified | Split, where Split fits: a narrow screen has one column only, so there is nothing to choose */}
        {showDiff && !narrow && <div className="segmented repo-diff-styles" role="group" aria-label={t("Diff layout")}>
          <button type="button" aria-pressed={diffStyle === "unified"} onClick={() => update({ diffStyle: "unified" })}><Rows3 aria-hidden="true" /><span>{t("Unified")}</span></button>
          <button type="button" aria-pressed={diffStyle === "split"} onClick={() => update({ diffStyle: "split" })}><Columns2 aria-hidden="true" /><span>{t("Split")}</span></button>
        </div>}
        <div className={isMarkdown && source.status === "ready" || showDiff && !narrow ? "repo-diff-group review-tools-rest" : "repo-diff-group"}>
          {settings.comments && <CommentModeToggle className="review-comments" count={preview && isMarkdown ? previewComments.shown.length : shown.length} hintOn={preview && isMarkdown ? "select" : settings.mobileCommentGesture} showHint={showHint} />}
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
    {/* the working tree's refusal; a branch diff takes removed lines */}
    {refused && diffBranch === null && <p className="review-file-hint" role="status">
      {t("Comments go on lines of the file as it is now, not on removed ones.")}
      {/* a branch's worktree compared with its uncommitted changes: without them its diff takes removed lines */}
      {comparison?.scope === "uncommitted" && comparison.worktree !== null && <> {t("Turn off “Show uncommitted changes” in View options to comment on removed lines.")}</>}
    </p>}
    {showDiff && place?.kind === "none" && <p className="review-file-hint">{t("Comments on staged changes aren't supported.")}</p>}
    {draft !== null && draftAt !== null && !sheetInput && draftAnchor !== null && <DraftField key={`${draftOnBase(draft) ? "base" : "head"}-${draftAt[0]}-${draftAt[1]}`} anchor={draftAnchor}>
      <CommentPopover placement="row" reference={{ path, lines: draftAt }} showReference quote={{ text: "" }} comment="" onSave={(value) => save(draft, value)} onDelete={() => setDraft(null)} onClose={() => setDraft(null)} opener={noFocus} fallback={noFocus} />
    </DraftField>}
    {body}
    {sheetInput && draft !== null && draftAt !== null && <CommentPopover placement="sheet" label={t("Comment on line {line}", { line: draftAt[0] })} sheetQuote={draftQuote} quote={{ text: "" }} comment="" onSave={(value) => save(draft, value)} onDelete={() => setDraft(null)} onClose={() => setDraft(null)} opener={noFocus} fallback={noFocus} />}
    {sheetInput && editingNote !== null && <CommentPopover placement="sheet" label={t("Comment on line {line}", { line: editingNote.lines[0] })} sheetQuote={editingQuote} quote={{ text: "" }} comment={editingNote.comment.comment} onSave={(value) => saveEdit(editingNote.comment, value)} onDelete={() => removeComment(editingNote.comment)} onClose={() => setEditing(null)} opener={noFocus} fallback={noFocus} />}
  </div>;
}
