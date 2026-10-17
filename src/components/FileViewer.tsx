import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";
import { Braces, Check, Code, Copy, Download, Ellipsis, ExternalLink, Maximize2, PanelRight, TriangleAlert, X } from "lucide-react";

import "./FileViewer.css";
import { useCodeComments } from "./CodeComments.tsx";
import { CommentModeHint, useModeHint } from "./CommentModeHint.tsx";
import { CommentModeToggle } from "./CommentModeToggle.tsx";
import { DirectoryBrowser } from "./DirectoryBrowser.tsx";
import { useFileComments, useFileCommentWalk, usePreviewCommentSource, usePreviewMargin, type FileCommentScope } from "./FileComments.tsx";
import { MarkdownCommentLayer, type MarkdownCommentLayerHandle } from "./MarkdownComments.tsx";
import { FileGlyph } from "./FileGlyph.tsx";
import { CODE_CHUNK_LINES, useHighlightedLines } from "./HighlightedCode.tsx";
import { RenderBoundary } from "./RenderBoundary.tsx";
import { TextFileView } from "./TextFileView.tsx";
import { MarkdownImageContext } from "./Markdown.tsx";

import type { FileInfo } from "../../shared/protocol.ts";
import { ApiError } from "../lib/api.ts";
import { blockComments, isReplyComment, useBlockComments } from "../lib/blockComments.ts";
import { leaveKey } from "../lib/commentPopover.ts";
import { formatBytes } from "../lib/bridgeProgress.ts";
import { LOCAL_MACHINE, paneStorageId } from "../../shared/machines.ts";
import { useOpeningPaneLane } from "../lib/chatLane.ts";
import { useMachineApi, useMachineId } from "../lib/machineContext.tsx";
import { copyText, selectContents } from "../lib/clipboard.ts";
import { fileLines, pathLabel, type FileComment, type FileView, type LineRange } from "../lib/fileComments.ts";
import { fileLineTarget, pathParts } from "../lib/filePaths.ts";
import { lineRequest, readBudget, shownSource, sourceLayout, virtualHighlightable } from "../lib/sourcePreview.ts";
import { canHighlight, countLines, languageForPath, LINE_ELEMENT_LIMIT, normalizeCode } from "../lib/highlight.ts";
import { useLocale, useT } from "../lib/i18n.ts";
import { useSettings } from "../lib/settings.ts";
import { useAnnouncedText } from "../lib/useAnnouncedText.ts";
import { MAX_INLINE_IMAGE_BYTES, markdownImagePreview } from "../lib/markdownImages.ts";
import { nativeModalOver, useFocusTrap } from "../lib/useFocusTrap.ts";
import { previewHosts, type MarkdownBlock } from "../lib/markdown.ts";
import { knownPreview, parsePreviewOffThread } from "../lib/markdownPreview.ts";
import { hasPreview, type TextViewMode } from "../lib/textPreview.ts";
import { useSheetSwipe } from "../lib/sheets.ts";
import { readFilePreviewText, SOURCE_PREVIEW_LINES, type FilePreviewText } from "../lib/filePreviewText.ts";
import { readerHref } from "../lib/fileReader.ts";
import type { FilePresentation } from "../lib/filePresentation.ts";

type Preview = { status: "none" | "pending" | "failed" } | { status: "ready"; blocks: MarkdownBlock[] };

const NO_PREVIEW: Preview = { status: "none" };
const PENDING_PREVIEW: Preview = { status: "pending" };
const FAILED_PREVIEW: Preview = { status: "failed" };

/**
 * The Preview of `text` (null: none is asked for), parsed in a worker so the page never waits for
 * the parser: pending until it answers, failed when it gave up or ran over its budget.
 */
function useMarkdownPreview(text: string | null): Preview {
  const known = useMemo((): Preview | null => {
    if (text === null) return NO_PREVIEW;
    const blocks = knownPreview(text);
    if (blocks === undefined) return null;
    return blocks === null ? FAILED_PREVIEW : { status: "ready", blocks };
  }, [text]);
  const [answer, setAnswer] = useState<{ text: string; blocks: MarkdownBlock[] | null } | null>(null);
  useEffect(() => {
    if (known !== null || text === null) return;
    let live = true;
    const job = parsePreviewOffThread(text);
    void job.promise.then((blocks) => { if (live) setAnswer({ text, blocks }); });
    return () => { live = false; job.cancel(); };
  }, [known, text]);
  // a new object each render is fine: only its status and its (stable) blocks are read
  if (known !== null) return known;
  if (answer === null || answer.text !== text) return PENDING_PREVIEW;
  return answer.blocks === null ? FAILED_PREVIEW : { status: "ready", blocks: answer.blocks };
}

export interface FileViewerProps {
  /** absolute, `~/…`, or relative to the pane's folder; optionally with a line reference */
  path: string;
  paneId: string | null;
  /** the PC of the pane (default: the machine context's): its comments are kept under `paneStorageId(machineId, paneId)` */
  machineId?: string;
  /** the pane's working folder (null: not known here): a comment names a file inside it relative to it */
  paneFolder?: string | null;
  /** a file comment of the pane to open at (the composer's walk): its view shows, and the walk stops at it */
  commentId?: string | null;
  onClose: () => void;
  /** Settings can open above this preview; its Escape must not also close the file. */
  keyboardActive?: boolean;
  /** a file chosen in a folder's listing: opened as the preview, so history and a reload keep it */
  onOpen?: (path: string) => void;
  /** the document is the page (a markdown file's own tab, FileReader): no dialog, nothing to close */
  page?: boolean;
  /** a column beside the pane (a wide window), not a dialog over it: the pane stays usable */
  docked?: boolean;
  /** drawn first in the docked column, before the viewer (its resize edge) */
  panelStart?: ReactNode;
  onKind?: (presentation: FilePresentation) => void;
  onTogglePresentation?: () => void;
}

/**
 * Copies the whole file; owns its "copied" flip, so only the button re-renders for it. When nothing
 * copies it (no clipboard API on plain-HTTP LAN, and the browser's copy command refused: copyText)
 * it selects the source `<pre>` instead; in a Markdown Preview there is none, and a virtualized
 * source has no element holding the whole text, so `onShowSource` shows a selectable source first
 * and the viewer selects it once rendered.
 */
function CopyFileButton({ text, sourceRef, onShowSource }: { text: string; sourceRef: RefObject<HTMLElement | null>; onShowSource: () => void }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const label = copied ? t("File copied") : t("Copy file");
  /** Copies the file, or selects its source for a long press; from a Preview, shows the source first. */
  const copy = async (): Promise<void> => {
    // the code <pre> is the source text alone: line numbers are a CSS counter, not text
    const source = sourceRef.current;
    if (await copyText(text, source)) setCopied(true);
    else if (!source) onShowSource();
  };
  return <button type="button" className="icon-button file-viewer-action" aria-label={label} title={label} onClick={() => void copy()}>
    {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
  </button>;
}

/** Selects a source element for a copy by hand: a text box selects its value, anything else its contents. */
function selectSource(element: HTMLElement): void {
  if (element instanceof HTMLTextAreaElement) { element.focus(); element.select(); }
  else selectContents(element);
}

/**
 * A file an agent wrote, opened in the browser: images, video and audio (streamed, so they
 * play and seek at once), PDFs, HTML pages, and the start of a text file (markdown drawn, its images read through the file endpoint). Anything can be downloaded.
 */
export function FileViewer({ path: asked, paneId, machineId: machineProp, paneFolder = null, commentId = null, onClose, onOpen, keyboardActive = true, page = false, docked = false, panelStart, onKind, onTogglePresentation }: FileViewerProps) {
  const t = useT();
  const locale = useLocale();
  // the comment settings: the mode, the layout, the mobile gesture and input (Settings → Chat, File viewer)
  const { settings } = useSettings();
  const { fetchFileInfo, fileUrl, fetchDirectories } = useMachineApi();
  // a remote PC's bridge reads a relative folder from the pane's folder only from its next bundle
  // on; until then it would list the bridge's own folder, so only an absolute or ~/ one is listed there
  const contextMachine = useMachineId();
  const machineId = machineProp ?? contextMachine;
  const remote = machineId !== LOCAL_MACHINE;
  const [directory, setDirectory] = useState<string | null>(null);
  // the path as given, until a choice among files of that name replaces it
  const [path, setPath] = useState(asked);
  const target = useMemo(() => fileLineTarget(path), [path]);
  const [info, setInfo] = useState<FileInfo | null>(null);
  const reportedKind = useRef<string | null>(null);
  const [candidates, setCandidates] = useState<string[] | null>(null);
  // an HTML page shows as the page, or as its source when asked
  const [source, setSource] = useState(false);
  // a phone's one-row header keeps new tab, raw and download in a "More" menu of its own
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  // Escape closes it, Tab stays in it, and the focus goes back to the row that opened it
  // (docked beside the pane, the rest of the page stays reachable: no trap)
  const surface = useFocusTrap<HTMLElement>(!page && !docked);
  // Settings → Chat width, Default: the Preview is as wide as the chat of the pane that opened it
  useOpeningPaneLane(surface, paneId === null ? null : paneStorageId(machineId, paneId));
  // a kind, not a message: it is said in the language of the moment it shows
  const [error, setError] = useState<"missing" | "unreadable" | null>(null);
  const [loaded, setLoaded] = useState<FilePreviewText | null>(null);
  // a line reference defaults to Code; otherwise Preview. A new path never paints the old choice.
  // Opened at a comment: in the view it was written in, so the other one is not drawn first
  const [chosen, setChosen] = useState<{ path: string; mode: TextViewMode } | null>(() => {
    const comment = commentId === null || paneId === null ? undefined : blockComments.list(paneStorageId(machineId, paneId)).find((c) => c.id === commentId);
    return comment === undefined || isReplyComment(comment) ? null : { path: asked, mode: comment.view === "code" ? "code" : "preview" };
  });
  const mode = chosen?.path === path ? chosen.mode : target.line === null ? "preview" : "code";
  // the source element while the code shows (its <pre>, or a virtualized source's text box), which
  // Copy selects when the clipboard is out of reach
  const sourceRef = useRef<HTMLElement>(null);
  // the Markdown preview's root while it shows, where the comments measure a selection
  const previewRef = useRef<HTMLDivElement>(null);
  // a virtualized source shown as one readonly text box, for that selection: its rows hold only a window of the text
  const [selectable, setSelectable] = useState(false);
  // Copy failed in a Preview: select the source as soon as the Code view has rendered
  const selectSourceOnCode = useRef(false);
  /** Switches a Preview to its source and has it selected once rendered, for Copy without a clipboard. */
  const showSourceToSelect = (): void => {
    selectSourceOnCode.current = true;
    setSelectable(true);
    setChosen({ path, mode: "code" });
    setSource(true);
  };
  useLayoutEffect(() => {
    if (!selectSourceOnCode.current || mode !== "code") return;
    selectSourceOnCode.current = false;
    if (sourceRef.current) selectSource(sourceRef.current);
  }, [mode, loaded, source, selectable]);

  useSheetSwipe(surface, page || docked ? null : onClose);
  useEffect(() => setPath(asked), [asked]);
  useEffect(() => setSource(target.line !== null), [path, target.line]);

  useEffect(() => {
    let cancelled = false;
    const abort = new AbortController();
    let deadline: ReturnType<typeof setTimeout> | undefined;
    setInfo(null); setCandidates(null); setError(null); setLoaded(null); setDirectory(null); setSelectable(false);
    fetchFileInfo(target.path, paneId).then(async (next) => {
      if (cancelled) return;
      if ("candidates" in next) { setCandidates(next.candidates); return; }
      setInfo(next);
      if (next.kind !== "text") return;
      // only a bounded part of a text file travels: a range, whatever the file's size, and a line
      // cap, so the rows handed to the viewer are counted (readBudget: a Markdown file keeps its
      // Preview's budget, a larger source reads up to the source budget)
      const budget = readBudget(languageForPath(next.path), next.size);
      // the deadline covers the request; the read gets the rest of it, and on a slow link it keeps
      // what arrived by then as a cut prefix rather than failing the whole file
      const started = Date.now();
      deadline = setTimeout(() => abort.abort(), budget.timeoutMs);
      try {
        const response = await fetch(fileUrl(next.path, paneId), { signal: abort.signal, headers: { range: `bytes=0-${budget.bytes - 1}` } });
        clearTimeout(deadline);
        const timeoutMs = Math.max(1, budget.timeoutMs - (Date.now() - started));
        const body = await readFilePreviewText(response, budget.bytes, { signal: abort.signal, maxLines: budget.lines, timeoutMs, partialOnTimeout: true });
        if (!cancelled) setLoaded(body);
      } finally { clearTimeout(deadline); }
    }).catch(async (reason: unknown) => {
      if (cancelled) return;
      // a folder is listed from the pane's folder, as a file is found from it
      if (reason instanceof ApiError && reason.status === 404 && (!remote || /^(?:\/|~(?:\/|$)|[A-Za-z]:[\\/])/.test(target.path))) {
        try {
          const listing = await fetchDirectories(target.path, false, true, paneId);
          if (!cancelled) setDirectory(listing.path);
          return;
        } catch { /* retain the file error when the target is not a readable directory */ }
      }
      if (cancelled) return;
      setError(reason instanceof ApiError && reason.status === 404 ? "missing" : "unreadable");
    });
    return () => { cancelled = true; clearTimeout(deadline); abort.abort(); };
  }, [target.path, paneId, fetchFileInfo, fileUrl, fetchDirectories, remote]);

  // A comment popover is open: Escape is its own first, wherever the focus is. It leaves it (`leaveOutcome`: what was
  // typed is saved, else it closes), and the viewer stays either way; the walk's dialog takes its own Escape. With none
  // open, Escape closes the viewer. An IME's Escape (`leaveKey`) cancels its conversion and does neither
  const commentEscape = useRef<() => boolean>(() => false);
  const walkDialogOpen = useRef(false);
  useEffect(() => {
    if ((info === null && directory === null) || reportedKind.current === path) return;
    reportedKind.current = path;
    onKind?.(info?.kind === "text" ? "panel" : "popup");
  }, [info, directory, path, onKind]);

  useEffect(() => {
    if (!keyboardActive || page) return;
    // the FilesDialog beneath listens on window too (and stands down while this is open); this
    // one is the topmost overlay, so it takes the key, unless a native modal (Add PC) is over it
    // docked, the pane beside it is live: Escape there is the terminal's, so only one inside the panel closes it
    /** Escape closes the open comment popover, else the viewer, from anywhere in it, unless something in it took the key. */
    const onKey = (event: KeyboardEvent): void => {
      if (!leaveKey(event) || event.defaultPrevented || walkDialogOpen.current || nativeModalOver(surface.current)) return;
      if (docked && !surface.current?.contains(document.activeElement)) return;
      if (commentEscape.current()) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, keyboardActive, page, docked]);

  // the More menu: it takes the focus on its first item; a press outside it, Escape (before the
  // viewer's own) or a wider screen (where More is gone) closes it alone; Escape and a chosen item
  // give the focus back to More
  const closeMore = useCallback((refocus: boolean) => {
    setMoreOpen(false);
    if (refocus) moreRef.current?.querySelector<HTMLElement>(".file-viewer-action")?.focus();
  }, []);
  useEffect(() => {
    if (!moreOpen) return;
    moreRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const onPointer = (event: PointerEvent): void => {
      if (!moreRef.current?.contains(event.target as Node)) closeMore(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.isComposing) return;
      event.stopPropagation();
      closeMore(true);
    };
    const wide = window.matchMedia("(min-width: 601px)");
    const onWide = (): void => { if (wide.matches) closeMore(false); };
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey, true);
    wide.addEventListener("change", onWide);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey, true);
      wide.removeEventListener("change", onWide);
    };
  }, [moreOpen, closeMore]);
  /** Up and Down (Home, End) move among the menu's items, as a menu's do. */
  const moveInMore = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>("[role=menuitem]")];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const to = event.key === "ArrowDown" ? (at + 1) % items.length : event.key === "ArrowUp" ? (at - 1 + items.length) % items.length
      : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : null;
    if (to === null) return;
    event.preventDefault();
    items[to]?.focus();
  };

  // the file found (a bare name may have been found deeper in the folder), else as asked
  const url = fileUrl(info?.path ?? target.path, paneId);
  // drawn by its own script in a sandbox with no origin and no network (server/file-view.ts); a PC
  // whose bridge predates `render` answers with the source, which the frame shows as text
  const htmlPage = info !== null && info.kind === "text" && info.mime === "text/html";
  const pageUrl = `${url}&render=1`;
  // Page | Source: over the HTML file in a dialog, in the docked panel's toolbar
  const modes = <div className="segmented file-viewer-modes" role="group" aria-label={t("Show the HTML file as")}>
    <button type="button" aria-pressed={!source} onClick={() => setSource(false)}>{t("Page")}</button>
    <button type="button" aria-pressed={source} onClick={() => setSource(true)}>{t("Source")}</button>
  </div>;
  const textFile = info?.kind === "text";
  const language = languageForPath(info?.path ?? target.path);
  // a Preview its parser gave up on (too slow, or failed) opens the source instead
  const preview = useMarkdownPreview(textFile && loaded !== null && mode === "preview" && hasPreview(language) ? loaded.text : null);
  const previewRefused = preview.status === "failed";
  const previewable = hasPreview(language) && !previewRefused;
  const view = previewable && mode === "preview" ? "markdown" : "code";
  const codeShown = textFile && loaded !== null && view === "code" && (!htmlPage || source);
  // the text as shown (a cut prefix without the row after its final newline), in either view: the file comments
  // number its lines as the code view draws them
  const shownText = useMemo(() => textFile && loaded !== null ? shownSource(normalizeCode(loaded.text), loaded.truncated) : null, [textFile, loaded]);
  // the source as shown: past VIRTUAL_SOURCE_LINES it is the virtualizer's rows, colored in its worker while small
  // enough (virtualHighlightable), else plain with the notice; below, CodeLines
  const sourceText = codeShown && shownText !== null ? shownText : "";
  const sourceLines = useMemo(() => countLines(sourceText), [sourceText]);
  const layout = sourceLayout(sourceLines);
  const colorable = canHighlight(language);
  const virtual = useMemo(() => codeShown && layout === "virtual" ? { text: sourceText, colored: colorable && virtualHighlightable(sourceText.length, sourceLines) } : null, [codeShown, layout, sourceText, colorable, sourceLines]);
  // CodeLines' code has no length limit of its own (the layout bounds it): only a worker that gave up leaves it plain
  const code = useHighlightedLines(codeShown && layout === "elements" ? sourceText : "", codeShown ? language : null);
  const shownPath = info?.path ?? target.path;
  const { stem, extension } = pathParts(info?.name ?? shownPath);
  const { folder } = pathParts(shownPath);
  // what holds for the whole file is said with its size, where it is seen first, not after a megabyte of text
  const cutShort = textFile && (!htmlPage || source) && loaded !== null && loaded.truncated;
  const budget = textFile ? readBudget(language, info.size) : null;
  // a cut at the byte budget is told in sizes; one at the line cap in lines; one by the deadline
  // (a slow link) only says part is shown, since its size is not the budget's
  const cutBytes = cutShort && budget !== null && loaded.truncatedBy !== "lines" && loaded.truncatedBy !== "time" && (loaded.total ?? info.size) > budget.bytes ? { shown: budget.bytes, total: loaded.total ?? info.size } : null;
  // a cut prefix's lines are the reader's count of complete lines: the line just past the cap is unseen
  const request = useMemo(() => codeShown ? lineRequest(target.line, sourceText, loaded.truncated, loaded.lines) : null, [codeShown, target.line, sourceText, loaded]);
  const requestNotice = (() => {
    if (request === null) return null;
    switch (request.kind) {
      case "shown": return null;
      case "past-preview": return t("Line {line} is past the part of this file shown here. Download it to read the rest.", { line: request.line });
      case "past-end": return t("This file has {count} lines; there is no line {line}.", { count: request.lines, line: request.line });
    }
  })();
  const notes = [
    requestNotice,
    cutShort && (loaded.truncatedBy === "lines"
      ? t("Showing the first {count} lines of this file. Download it to read the rest.", { count: SOURCE_PREVIEW_LINES.toLocaleString(locale) })
      : cutBytes !== null
        ? t("Showing the first {shown} of {total}.", { shown: formatBytes(cutBytes.shown), total: formatBytes(cutBytes.total) })
        : t("Only part of this file is shown. Download it to read the rest.")),
    textFile && loaded !== null && previewRefused && t("Too long to preview"),
    codeShown && (code.tooLong || (virtual !== null && colorable && !virtual.colored)) && t("Too long to highlight"),
  ].filter((note): note is string => typeof note === "string");
  const noticed = notes.length > 0;
  const copyable = textFile && loaded !== null && !loaded.truncated;
  // Comments on the file's lines, kept with the pane the file was opened from: only with a pane, and
  // only on the lines shown. The lines are numbered as the code view numbers them, and a cut file's
  // text ends where its last whole line does
  const owner = paneId === null ? null : paneStorageId(machineId, paneId);
  const filePath = info?.path ?? null;
  // the preview's blocks a comment can follow, from the blocks the preview draws (parsed in the worker
  // with their lines). A preview still parsing takes no comments yet
  const previewBlocks = owner !== null && view === "markdown" && preview.status === "ready" ? preview.blocks : null;
  const hosts = useMemo<LineRange[] | null>(() => previewBlocks === null ? null : previewHosts(previewBlocks), [previewBlocks]);
  // the code view takes comments only with an element per line to put them under (not a virtualized source)
  const lineComments = codeShown && virtual === null && code.lines.length <= LINE_ELEMENT_LIMIT;
  const commentView: FileView | null = lineComments ? "code" : hosts !== null ? "preview" : null;
  // split only where comments can be written: a virtualized source can run to hundreds of thousands of lines
  const commentable = commentView !== null;
  const commentLines = useMemo(() => shownText === null || !commentable ? null : fileLines(shownText), [shownText, commentable]);
  const wholeLines = commentLines === null || loaded === null ? 0 : loaded.truncated && !loaded.text.endsWith("\n") ? commentLines.length - 1 : commentLines.length;
  const scope = useMemo<FileCommentScope | null>(() => owner === null || commentView === null || filePath === null || commentLines === null ? null
    : { owner, path: filePath, label: pathLabel(filePath, paneFolder), view: commentView, lines: commentLines, loaded: wholeLines, truncated: cutShort },
  [owner, commentView, filePath, paneFolder, commentLines, wholeLines, cutShort]);
  const bodyRef = useRef<HTMLDivElement>(null);
  // the body's element as a state too, the preview's comment layer's surface: set by the body's callback ref in the commit
  // that mounts it (the layer is inside the body, so a layout effect of its own would run before the ref is set)
  const [bodyNode, setBodyNode] = useState<HTMLDivElement | null>(null);
  const attachBody = useCallback((node: HTMLDivElement | null): void => {
    bodyRef.current = node;
    setBodyNode(node);
  }, []);
  const codeRef = sourceRef as RefObject<HTMLPreElement>;
  const contentRef = commentView === "preview" ? previewRef : codeRef;
  // the file's comments, placed once for both layers: the preview's (the Markdown comment layer), and the code view's cards
  const fileComments = useFileComments(scope);
  const previewSource = usePreviewCommentSource(commentView === "preview" ? scope : null, bodyRef, previewRef, fileComments);
  // the comments' margin in the free space right of the text, which it never moves, while the preview takes comments
  const previewMargin = usePreviewMargin(previewSource !== null, previewRef, bodyRef, settings.commentLayout);
  // the comment mode's toggle: where a Delete that leaves no card puts the focus (the preview's and the code view's)
  const modeToggleRef = useRef<HTMLButtonElement>(null);
  // the preview's comment layer, beside its body (`MarkdownCommentLayer`, rendered below)
  const markdownLayer = useRef<MarkdownCommentLayerHandle>(null);
  const codeComments = useCodeComments({
    scope: commentView === "code" ? scope : null, comments: fileComments, surface: bodyRef, content: codeRef,
    focusFallback: () => modeToggleRef.current,
  });
  // the composer's walk stops at a file comment, switching to the view it was written in
  const walk = useFileCommentWalk({
    owner, view: commentView, comments: fileComments, surface: bodyRef, content: contentRef,
    showView: (next: FileView) => setChosen({ path, mode: next === "code" ? "code" : "preview" }),
    codeStop: codeComments.stop,
  });
  // Escape is the open field's or popover's first, or the walk's dialog's, before it is the viewer's
  commentEscape.current = commentView === "code" ? codeComments.escape : () => markdownLayer.current?.escape() ?? false;
  walkDialogOpen.current = walk.editorOpen;
  // the pane's comments of any kind: the one the viewer was opened at is looked up among them (none while comments are off)
  const paneComments = useBlockComments(owner ?? "");
  // Opened at a comment (the composer's walk): the walk stops at it once the file's comments are
  // placed, which waits for the file's text (and a preview's parse). Where the file cannot show it
  // (gone, unreadable, no longer text, too long for line elements), it opens in a dialog over what the viewer says
  const [pendingStop, setPendingStop] = useState(commentId);
  useEffect(() => setPendingStop(commentId), [commentId]);
  const { goTo, openInEditor } = walk;
  const previewPending = preview.status === "pending";
  useEffect(() => {
    if (pendingStop === null) return;
    const comment = paneComments.find((c): c is FileComment => !isReplyComment(c) && c.id === pendingStop);
    // gone meanwhile (sent, deleted): the viewer just shows its file
    if (comment === undefined) { setPendingStop(null); return; }
    if (scope !== null) {
      // not among this file's comments: it was written on a path the viewer does not resolve to now
      if (!goTo(comment.id)) openInEditor(comment, t("This part of the file has changed since."));
      setPendingStop(null);
      return;
    }
    const unshown = error !== null ? (error === "missing" ? t("No readable file at this path.") : t("The file could not be opened."))
      : directory !== null || (info !== null && info.kind !== "text") ? t("The file could not be opened.")
      : textFile && loaded !== null && !previewPending ? t("This preview can't be shown.")
      : null;
    // still opening
    if (unshown === null) return;
    openInEditor(comment, unshown);
    setPendingStop(null);
  }, [pendingStop, paneComments, scope, error, directory, info, textFile, loaded, previewPending, goTo, openInEditor, t]);
  const commentCount = fileComments.all.length;
  const outdatedCount = fileComments.outdated.length;
  // the comment mode's toggle: in a view that takes comments (the code view with an element per line, or the preview)
  // of a file of a pane, with comments on
  const toggleShown = owner !== null && settings.comments && commentView !== null;
  // turned by a finger, the hint says how to comment now (the code view's gesture, or selecting text in the preview), or
  // that the mode is off; a mouse has the ⊕ or the text to show the way
  const { hint, show: showHint } = useModeHint();
  const markdown = info?.kind === "text" && /\.(?:md|markdown)$/i.test(info.name);
  // a page of just the document, not the app over it (FileReader)
  const previewUrl = readerHref(machineId, shownPath + (target.line === null ? "" : `#L${target.line}`));
  // images of a markdown file load through the file endpoint, as the file itself does
  const imagePreview = useCallback((src: string) => markdownImagePreview(
    src, shownPath, (target) => fetchFileInfo(target, paneId), (target, download) => fileUrl(target, paneId, download),
  ), [shownPath, paneId, fetchFileInfo, fileUrl]);
  // "Opening…" while the file's info, or a text's content or preview, is on its way. The note is in the
  // viewer from its first render, clipped while empty (never display: none), and its words land a frame
  // after it (lib/useAnnouncedText.ts)
  const opening = directory === null && error === null && candidates === null
    && (info === null || (info.kind === "text" && (!htmlPage || source) && (loaded === null || (view === "markdown" && preview.status !== "ready"))));
  const openingWords = useAnnouncedText(opening ? t("Opening…") : null);
  const openingNote = <p className={openingWords === null ? "visually-hidden" : "file-viewer-note"} role="status">{openingWords}</p>;
  const body = (() => {
    if (directory !== null) return <DirectoryBrowser key={directory} start={directory} onOpenFile={onOpen ?? setPath} />;
    if (error !== null) return <p className="file-viewer-note" role="alert">{error === "missing" ? t("No readable file at this path.") : t("The file could not be opened.")}</p>;
    if (candidates !== null) return <div className="file-viewer-choices">
      <p className="file-viewer-note">{t("Several files are named {name}:", { name: target.path.split("/").pop() ?? target.path })}</p>
      <ul>{candidates.map((candidate) => <li key={candidate}><button type="button" className="btn btn-ghost" onClick={() => setPath(candidate + path.slice(target.path.length))}>{candidate}</button></li>)}</ul>
    </div>;
    if (info === null) return null;
    switch (info.kind) {
      case "image":
        return info.size > MAX_INLINE_IMAGE_BYTES
          ? <p className="file-viewer-note">{t("This image is {size}; download it to view.", { size: formatBytes(info.size) })}</p>
          : <img className="file-viewer-media" src={url} alt={info.name} />;
      case "video":
        return <video className="file-viewer-media" src={url} controls playsInline preload="metadata" />;
      case "audio":
        return <audio className="file-viewer-audio" src={url} controls preload="metadata" />;
      case "pdf":
        return <iframe className="file-viewer-pdf" src={url} title={info.name} />;
      case "text":
        if (htmlPage && !source) return <>
          {!docked && modes}
          <iframe className="file-viewer-page" src={pageUrl} sandbox="allow-scripts" title={info.name} />
        </>;
        return <>
          {htmlPage && !docked && modes}
          {loaded === null || (view === "markdown" && preview.status !== "ready")
          ? null
          // a text the renderer cannot draw fails here, not the app: the header (Show source, Open raw file,
          // Close) stays, and a Preview that fails offers its source
          : <RenderBoundary key={view} resetKey={loaded} fallback={() => view === "markdown"
            ? <div className="file-viewer-note" role="alert">
              <p>{t("This preview can't be shown.")}</p>
              <button type="button" className="btn btn-ghost" onClick={() => setChosen({ path, mode: "code" })}>{t("Show source")}</button>
            </div>
            : <p className="file-viewer-note" role="alert">{t("The file could not be opened.")}</p>}>
            <MarkdownImageContext.Provider value={imagePreview}><TextFileView path={info.path} blocks={view === "markdown" && preview.status === "ready" ? preview.blocks : null} lines={code.lines} virtual={virtual} selectable={selectable} onOpen={onOpen ?? setPath} sourceRef={sourceRef} previewRef={previewRef} markedLine={request?.kind === "shown" ? request.line : null} /></MarkdownImageContext.Provider>
          </RenderBoundary>}
        </>;
      default:
        return <p className="file-viewer-note">{t("This file can't be previewed here. Download it to open it.")} <span className="file-viewer-note-meta">{info.mime}, {formatBytes(info.size)}</span></p>;
    }
  })();

  const Heading = page ? "h1" : "h2";
  // comment mode (the code view's comments, CodeComments.tsx; the preview's, MarkdownComments.tsx), with the file's comment count
  const commentToggle = toggleShown && <div className="file-viewer-group">
    <CommentModeToggle buttonRef={modeToggleRef} className="file-viewer-action file-viewer-comments" count={commentCount} outdated={outdatedCount}
      hintOn={commentView === "code" ? settings.mobileCommentGesture : "select"} showHint={showHint} />
  </div>;
  // where the file is and how much of it shows: under the name in a dialog, in the docked panel's toolbar
  const meta = <p className="file-viewer-meta" title={shownPath}>
    {/* a partial view is told by the size ("256 KB of 1.3 MB") in the warning color, beside an
        icon so the color is not the only sign; what it means is the tooltip (and read out) */}
    {info && (noticed
      ? <span className="file-viewer-notice" title={notes.join("\n")}>
        <TriangleAlert aria-hidden="true" />
        <span>{cutBytes !== null ? t("{done} of {total}", { done: formatBytes(cutBytes.shown), total: formatBytes(cutBytes.total) }) : formatBytes(info.size)}</span>
        <span className="visually-hidden">{notes.join(". ")}</span>
      </span>
      : <span className="file-viewer-size">{formatBytes(info.size)}</span>)}
    {/* the dot is the folder's, so where the folder has no room left no dot dangles */}
    {folder !== "" && <span className="file-viewer-path"><span dir="ltr">{info && <span className="file-viewer-dot" aria-hidden="true">·</span>}{folder}</span></span>}
  </p>;
  // the file itself: a Markdown tab is the reader; raw and download keep the original bytes
  const newTabHref = htmlPage && !source ? pageUrl : markdown ? previewUrl : url;
  const downloadHref = fileUrl(shownPath, paneId, true);
  const fileActions = <>
    {!page && onTogglePresentation && <button type="button" className="icon-button file-viewer-action" aria-label={docked ? t("Show as a popup") : t("Show beside the pane")} title={docked ? t("Show as a popup") : t("Show beside the pane")} onClick={onTogglePresentation}>
      {docked ? <Maximize2 aria-hidden="true" /> : <PanelRight aria-hidden="true" />}
    </button>}
    {/* new tab, raw and download: buttons in the row, and on a phone in the More menu after Copy */}
    {!page && <a className="icon-button file-viewer-action file-viewer-wide" href={newTabHref} target="_blank" rel="noopener" aria-label={t("Open in a new tab")} title={t("Open in a new tab")}><ExternalLink aria-hidden="true" /></a>}
    {(page || markdown) && <a className="icon-button file-viewer-action file-viewer-wide" href={url} target="_blank" rel="noopener" aria-label={t("Open raw file")} title={t("Open raw file")}><Code aria-hidden="true" /></a>}
    <a className="icon-button file-viewer-action file-viewer-wide" href={downloadHref} download={info?.name ?? true} aria-label={t("Download")} title={t("Download")}><Download aria-hidden="true" /></a>
    {copyable && <CopyFileButton text={loaded.text} sourceRef={sourceRef} onShowSource={showSourceToSelect} />}
    {!docked && <div className="file-viewer-more" ref={moreRef}>
      <button type="button" className="icon-button file-viewer-action" aria-label={t("More")} title={t("More")} aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen((open) => !open)}><Ellipsis aria-hidden="true" /></button>
      {moreOpen && <div className="file-viewer-more-menu" role="menu" aria-label={t("More")} onKeyDown={moveInMore}>
        {!page && <a role="menuitem" className="file-viewer-more-item" href={newTabHref} target="_blank" rel="noopener" onClick={() => closeMore(true)}><ExternalLink aria-hidden="true" />{t("Open in a new tab")}</a>}
        {(page || markdown) && <a role="menuitem" className="file-viewer-more-item" href={url} target="_blank" rel="noopener" onClick={() => closeMore(true)}><Code aria-hidden="true" />{t("Open raw file")}</a>}
        <a role="menuitem" className="file-viewer-more-item" href={downloadHref} download={info?.name ?? true} onClick={() => closeMore(true)}><Download aria-hidden="true" />{t("Download")}</a>
      </div>}
    </div>}
  </>;
  const closeButton = !page && <button type="button" className="icon-button file-viewer-action file-viewer-close" aria-label={t("Close file")} title={t("Close file")} onClick={onClose}><X aria-hidden="true" /></button>;
  // Docked, the header is one row (the file's glyph and name, then its actions) and the toolbar
  // under it carries the meta and the view modes, as t3code's file surface and paseo's file bar
  // do; it never stacks, since the panel is never as narrow as a phone.
  const header = docked
    ? <header className="file-viewer-header file-viewer-header-docked">
      <FileGlyph name={info?.name ?? shownPath} className="file-viewer-glyph" />
      {/* a long name is cut inside its stem, so its type stays in view */}
      <h2 className="file-viewer-name"><span className="file-viewer-stem">{stem}</span>{extension}</h2>
      <div className="file-viewer-actions">{commentToggle}{fileActions}</div>
      {closeButton}
    </header>
    : <header className={"modal-header file-viewer-header file-viewer-header-stacked" + (page ? " file-reader-header" : "")}>
      <div className="file-viewer-title">
        {/* a long name is cut inside its stem, so its type stays in view */}
        <Heading className="modal-title"><span className="file-viewer-stem">{stem}</span>{extension}</Heading>
        {meta}
      </div>
      <div className="file-viewer-actions">
        {commentToggle}
        {/* how the text shows: Preview or source is one choice of two, so one toggle; wrapping is a
            setting (Settings → File viewer), not an action here */}
        {textFile && previewable && <div className="file-viewer-group">
          <button type="button" className="icon-button file-viewer-action" aria-pressed={mode === "code"} aria-label={t("Show source")} title={t("Show source")} onClick={() => setChosen({ path, mode: mode === "code" ? "preview" : "code" })}><Braces aria-hidden="true" /></button>
        </div>}
        <div className="file-viewer-group">{fileActions}</div>
      </div>
      {closeButton}
    </header>;
  // the docked toolbar: the meta, and the file's view modes as a segmented control (a Markdown
  // file's Preview | Source stands in for the dialog's Show source toggle)
  const toolbar = docked && directory === null && <div className="file-viewer-toolbar">
    {meta}
    {textFile && previewable && <div className="segmented file-viewer-modes" role="group" aria-label={t("Show the Markdown file as")}>
      <button type="button" aria-pressed={mode === "preview"} onClick={() => setChosen({ path, mode: "preview" })}>{t("Preview")}</button>
      <button type="button" aria-pressed={mode === "code"} onClick={() => setChosen({ path, mode: "code" })}>{t("Source")}</button>
    </div>}
    {htmlPage && modes}
  </div>;
  // a virtualized source fills the viewer: its rows are a window the user scrolls, so the body
  // takes a definite height for the scroll root to fill, instead of growing with the text
  const bodyClass = virtual !== null && view === "code" ? "file-viewer-body file-viewer-body-virtual" : "file-viewer-body";
  // with comments the body is their surface (lib/commentHighlight.ts `COMMENT_SURFACE`: the preview's source and the code
  // view's layer mark it), the place the preview's margin and field over a selection and the code view's cards and field
  // are positioned in; the dialog and the docked panel draw the same one
  const commentableBody = <div ref={attachBody} className={bodyClass}>
    {body}{openingNote}
    <MarkdownCommentLayer ref={markdownLayer} source={previewSource} surface={bodyNode} roots={() => previewRef.current === null ? [] : [previewRef.current]}
      mode={settings.commentMode} margin={previewMargin} focusFallback={() => modeToggleRef.current} />
    {codeComments.layer}
    {/* the mode's hint, at the body's top under the header (CommentModeHint.css `.code-comment-status`) */}
    {toggleShown && <CommentModeHint surface={bodyRef} hint={hint} />}
    {walk.editor}
  </div>;
  if (page) return (
    <main ref={surface} className="file-reader">
      {header}
      <div className={`${bodyClass} file-reader-body`}>{body}{openingNote}</div>
    </main>
  );

  if (docked) return (
    <aside className="file-panel" aria-label={info?.name ?? path} ref={surface}>
      {panelStart}
      <section className="file-viewer file-viewer-docked">
        {header}
        {toolbar}
        {commentableBody}
      </section>
    </aside>
  );

  return (
    <div className="modal-scrim file-viewer-scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      {/* on a desktop a tall code view hangs from a fixed top (FileViewer.css): a comment's row, the mode or the view moves nothing */}
      <section className={virtual !== null && view === "code" ? "modal file-viewer file-viewer-virtual" : "modal file-viewer"} role="dialog" aria-modal="true" aria-label={info?.name ?? path} ref={surface} tabIndex={-1}
        data-tall={lineComments && code.lines.length > CODE_CHUNK_LINES ? "" : undefined}>
        {header}
        {commentableBody}
      </section>
    </div>
  );
}
