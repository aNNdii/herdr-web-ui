import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Check, Code, Copy, Download, ExternalLink, MessageSquare, TriangleAlert, X } from "lucide-react";

import "./FileViewer.css";
import { DirectoryBrowser } from "./DirectoryBrowser.tsx";
import { FileCommentsContext, useFileCommentLayer, useFileCommentWalk, type FileCommentScope } from "./FileComments.tsx";
import { RenderBoundary } from "./RenderBoundary.tsx";
import { TextFileView } from "./TextFileView.tsx";

import type { FileInfo } from "../../shared/protocol.ts";
import { ApiError } from "../lib/api.ts";
import { blockComments, isReplyComment, useBlockComments } from "../lib/blockComments.ts";
import { formatBytes } from "../lib/bridgeProgress.ts";
import { LOCAL_MACHINE, paneStorageId } from "../../shared/machines.ts";
import { useMachineApi, useMachineId } from "../lib/machineContext.tsx";
import { copyText, selectContents } from "../lib/clipboard.ts";
import { fileLines, pathLabel, type FileComment, type FileView, type LineRange } from "../lib/fileComments.ts";
import { pathParts } from "../lib/filePaths.ts";
import { languageForPath, tooLongToHighlight } from "../lib/highlight.ts";
import { parseMarkdownWithLines, previewHosts } from "../lib/markdown.ts";
import { useT } from "../lib/i18n.ts";
import { useSettings } from "../lib/settings.ts";
import { answeredFileSize, decodeStart, hasPreview, loadedText, textView, type LoadedText, type TextViewMode } from "../lib/textPreview.ts";
import { useFocusTrap } from "../lib/useFocusTrap.ts";

/** Bigger images are offered as a download: a phone decodes an image whole. */
const MAX_INLINE_IMAGE_BYTES = 20 * 1024 * 1024;

export interface FileViewerProps {
  /** absolute, `~/…`, or relative to the pane's folder */
  path: string;
  paneId: string | null;
  /** the PC of the pane: its comments are kept under `paneStorageId(machineId, paneId)` */
  machineId: string;
  /** the pane's working folder (null: not known here): a comment names a file inside it relative to it */
  paneFolder: string | null;
  onClose: () => void;
  /** Settings can open above this preview; its Escape must not also close the file. */
  keyboardActive?: boolean;
  /** a file chosen in a folder's listing: opened as the preview, so history and a reload keep it */
  onOpen?: (path: string) => void;
  /** a file comment of the pane to open at (the composer's walk): its view shows, and the walk stops at it */
  commentId?: string | null;
}

/**
 * Copies the whole file; owns its "copied" flip, so only the button re-renders for it. Without a
 * clipboard API (plain-HTTP LAN) it selects the source `<pre>` instead; in a Markdown Preview there
 * is none, so `onShowSource` switches to Code first and the viewer selects it once rendered.
 */
function CopyFileButton({ text, sourceRef, onShowSource }: { text: string; sourceRef: RefObject<HTMLPreElement>; onShowSource: () => void }) {
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

/**
 * A file an agent wrote, opened in the browser: images, video and audio (streamed, so they
 * play and seek at once), PDFs, and the start of a text file. Each opens whole in a new tab (a
 * text file raw), where it can be saved too; a file no tab can show is offered as a download.
 */
export function FileViewer({ path: asked, paneId, machineId, paneFolder, onClose, onOpen, commentId = null, keyboardActive = true }: FileViewerProps) {
  const t = useT();
  const { settings } = useSettings();
  const { textLoadLimit } = settings;
  const { fetchFileInfo, fileUrl, fetchDirectories } = useMachineApi();
  // a remote PC's bridge reads a relative folder from the pane's folder only from its next bundle
  // on; until then it would list the bridge's own folder, so only an absolute or ~/ one is listed there
  const remote = useMachineId() !== LOCAL_MACHINE;
  const [directory, setDirectory] = useState<string | null>(null);
  // the path as given, until a choice among files of that name replaces it
  const [path, setPath] = useState(asked);
  const [info, setInfo] = useState<FileInfo | null>(null);
  const [candidates, setCandidates] = useState<string[] | null>(null);
  // a kind, not a message: it is said in the language of the moment it shows
  const [error, setError] = useState<"missing" | "unreadable" | null>(null);
  const [loaded, setLoaded] = useState<LoadedText | null>(null);
  // the mode is the user's choice for this path, else Preview: derived, so a new path never paints the old mode
  // opened at a comment: in the view it was written in, so the other one is not drawn first
  const [chosen, setChosen] = useState<{ path: string; mode: TextViewMode } | null>(() => {
    const comment = commentId === null || paneId === null ? undefined : blockComments.list(paneStorageId(machineId, paneId)).find((c) => c.id === commentId);
    return comment === undefined || isReplyComment(comment) ? null : { path: asked, mode: comment.view === "code" ? "code" : "preview" };
  });
  const mode = chosen?.path === path ? chosen.mode : "preview";
  // the code <pre> while the code shows, which Copy selects when the clipboard is out of reach
  const sourceRef = useRef<HTMLPreElement>(null);
  // the Markdown preview's root while it shows, where the comments measure a selection
  const previewRef = useRef<HTMLDivElement>(null);
  // Copy failed in a Preview: select the source as soon as the Code view has rendered
  const selectSourceOnCode = useRef(false);
  /** Switches a Preview to its source and has it selected once rendered, for Copy without a clipboard. */
  const showSourceToSelect = (): void => {
    selectSourceOnCode.current = true;
    setChosen({ path, mode: "code" });
  };
  useLayoutEffect(() => {
    if (!selectSourceOnCode.current || mode !== "code") return;
    selectSourceOnCode.current = false;
    if (sourceRef.current) selectContents(sourceRef.current);
  }, [mode, loaded]);
  // Escape closes it, Tab stays in it, and the focus goes back to the row that opened it
  const surface = useFocusTrap<HTMLElement>(true);
  useEffect(() => setPath(asked), [asked]);

  useEffect(() => {
    let cancelled = false;
    // a closed viewer, or a new limit, stops the download of up to a megabyte
    const download = new AbortController();
    setInfo(null); setCandidates(null); setError(null); setLoaded(null); setDirectory(null);
    fetchFileInfo(path, paneId).then(async (next) => {
      if (cancelled) return;
      if ("candidates" in next) { setCandidates(next.candidates); return; }
      setInfo(next);
      if (next.kind !== "text") return;
      // only the first part of a text file travels: a range, whatever the file's size
      const response = await fetch(fileUrl(next.path, paneId), { headers: { range: `bytes=0-${textLoadLimit - 1}` }, signal: download.signal });
      const range = response.headers.get("content-range");
      // an empty file has no first byte to send: its range answers 416, `bytes */0`
      const empty = response.status === 416 && answeredFileSize(response.status, range, 0) === 0;
      // an error (the file gone since, a remote PC dropped) answers with JSON, never the file's text
      if (!response.ok && !empty) throw new Error(`the file answered ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      // the size as it was sent, not as the stat saw it: a file grown since is still cut short
      const size = answeredFileSize(response.status, range, bytes.length);
      if (!cancelled) setLoaded(loadedText(decodeStart(bytes, textLoadLimit), size, textLoadLimit));
    }).catch(async (reason: unknown) => {
      if (cancelled) return;
      // a folder is listed from the pane's folder, as a file is found from it
      if (reason instanceof ApiError && reason.status === 404 && (!remote || /^(?:\/|~(?:\/|$)|[A-Za-z]:[\\/])/.test(path))) {
        try {
          const listing = await fetchDirectories(path, false, true, paneId);
          if (!cancelled) setDirectory(listing.path);
          return;
        } catch { /* retain the file error when the target is not a readable directory */ }
      }
      if (cancelled) return;
      setError(reason instanceof ApiError && reason.status === 404 ? "missing" : "unreadable");
    });
    return () => { cancelled = true; download.abort(); };
  }, [path, paneId, fetchFileInfo, fileUrl, fetchDirectories, remote, textLoadLimit]);

  // a comment form is open: Escape is the form's (it gives up while nothing is typed), not the viewer's
  const formOpen = useRef(false);
  useEffect(() => {
    if (!keyboardActive) return;
    // the FilesDialog beneath listens on window too (and stands down while this is open); this
    // one is the topmost overlay, so it takes the key
    /** Escape closes the viewer from anywhere in it, unless a comment form or something in it took the key. */
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !event.defaultPrevented && !formOpen.current) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, keyboardActive]);

  // the file found (a bare name may have been found deeper in the folder), else as asked
  const url = fileUrl(info?.path ?? path, paneId);
  const textFile = info?.kind === "text";
  const language = languageForPath(info?.path ?? path);
  const view = textView(language, mode);
  const codeShown = textFile && loaded !== null && view === "code";
  const shownPath = info?.path ?? path;
  const { stem, extension } = pathParts(info?.name ?? shownPath);
  const { folder } = pathParts(shownPath);
  // what holds for the whole file is said with its size, where it is seen first, not after a megabyte of text
  const cutShort = textFile && loaded !== null && loaded.truncated;
  const leftPlain = codeShown && tooLongToHighlight(loaded.text, language, settings.highlightLimit);
  const notes = [
    cutShort && t("Showing the first {shown}", { shown: formatBytes(loaded.limit) }),
    leftPlain && t("Too long to highlight"),
  ].filter((note): note is string => typeof note === "string");
  const copyable = textFile && loaded !== null && !loaded.truncated;
  // Comments on the file's lines, kept with the pane the file was opened from: only with a pane, and
  // only on the lines loaded. The lines are numbered as the code view numbers them: a last line
  // ending is no line of its own, and a cut file's text ends where its last whole line does
  const owner = paneId === null ? null : paneStorageId(machineId, paneId);
  const sourceText = textFile && loaded !== null ? loaded.text : null;
  const sourceLines = useMemo(() => sourceText === null ? null : fileLines(sourceText.replace(/(?:\r\n|\r|\n)$/, "")), [sourceText]);
  const filePath = info?.path ?? null;
  const wholeLines = sourceLines === null || loaded === null ? 0 : loaded.truncated && !/[\r\n]$/.test(loaded.text) ? sourceLines.length - 1 : sourceLines.length;
  // the preview's blocks a card can follow; the parse is the one the preview draws (memoized). A text
  // it cannot parse takes no comments: the preview's own error shows (RenderBoundary below)
  const previewShown = owner !== null && view === "markdown";
  const hosts = useMemo<LineRange[] | null>(() => {
    if (!previewShown || sourceText === null) return null;
    try { return previewHosts(parseMarkdownWithLines(sourceText)); } catch { return null; }
  }, [previewShown, sourceText]);
  const commentView = codeShown ? "code" : hosts !== null ? "preview" : null;
  const scope = useMemo<FileCommentScope | null>(() => owner === null || commentView === null || filePath === null || sourceLines === null ? null
    : { owner, path: filePath, label: pathLabel(filePath, paneFolder), view: commentView, lines: sourceLines, loaded: wholeLines, truncated: cutShort, hosts: commentView === "code" ? null : hosts },
  [owner, commentView, filePath, paneFolder, sourceLines, wholeLines, cutShort, hosts]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const comments = useFileCommentLayer(scope, bodyRef, commentView === "preview" ? previewRef : sourceRef);
  // the header's counter walks this file's comments, switching to the view one was written in
  const walk = useFileCommentWalk({
    owner, view: commentView, comments: comments.comments, surface: bodyRef,
    showView: (next: FileView) => setChosen({ path, mode: next === "code" ? "code" : "preview" }),
  });
  // Escape is the open form's, or the outdated comment's editor's, not the viewer's
  formOpen.current = comments.formOpen || walk.editorOpen;
  // the pane's comments of any kind: the one the viewer was opened at is looked up among them
  const paneComments = useBlockComments(owner ?? "");
  // Opened at a comment (the composer's walk): the walk stops at it once the file's comments are
  // placed, which waits for the file's text. Where the file cannot show it (gone, unreadable, no
  // longer text, a preview that fails), it opens in the modal editor over what the viewer says
  const [pendingStop, setPendingStop] = useState(commentId);
  useEffect(() => setPendingStop(commentId), [commentId]);
  const { goTo, openInEditor } = walk;
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
      : textFile && loaded !== null ? t("This preview can't be shown.")
      : null;
    // still opening
    if (unshown === null) return;
    openInEditor(comment, unshown);
    setPendingStop(null);
  }, [pendingStop, paneComments, scope, error, directory, info, textFile, loaded, goTo, openInEditor, t]);
  const fileComments = comments.comments.all.length;
  const commentsShown = owner !== null && fileComments > 0;
  const outdatedCount = comments.comments.outdated.length;
  const counted = t(fileComments === 1 ? "{count} comment" : "{count} comments", { count: fileComments });
  const countLabel = outdatedCount > 0 ? `${counted} · ${t("{count} outdated", { count: outdatedCount })}` : counted;
  // a phone stacks the actions under the name once there are two or more, and one fits beside it:
  // a text file always has Raw, so a second is Show source, Copy or the comments
  const stacked = textFile && (hasPreview(language) || copyable || commentsShown);
  /** What the viewer shows below its header: a folder, an error, a choice of files, or the file. */
  const body = (() => {
    if (directory !== null) return <DirectoryBrowser key={directory} start={directory} onOpenFile={onOpen ?? setPath} />;
    if (error !== null) return <p className="file-viewer-note" role="alert">{error === "missing" ? t("No readable file at this path.") : t("The file could not be opened.")}</p>;
    if (candidates !== null) return <div className="file-viewer-choices">
      <p className="file-viewer-note">Several files are named {path.split("/").pop()}:</p>
      <ul>{candidates.map((candidate) => <li key={candidate}><button type="button" className="btn btn-ghost" onClick={() => setPath(candidate)}>{candidate}</button></li>)}</ul>
    </div>;
    if (info === null) return <p className="file-viewer-note">{t("Opening…")}</p>;
    switch (info.kind) {
      case "image":
        return info.size > MAX_INLINE_IMAGE_BYTES
          ? <p className="file-viewer-note">{t("This image is {size}; open it in a new tab to view it.", { size: formatBytes(info.size) })}</p>
          : <img className="file-viewer-media" src={url} alt={info.name} />;
      case "video":
        return <video className="file-viewer-media" src={url} controls playsInline preload="metadata" />;
      case "audio":
        return <audio className="file-viewer-audio" src={url} controls preload="metadata" />;
      case "pdf":
        return <iframe className="file-viewer-pdf" src={url} title={info.name} />;
      case "text":
        return loaded === null
          ? <p className="file-viewer-note">{t("Opening…")}</p>
          // a text the renderer cannot draw fails here, not the app: the header (Show source, Raw,
          // Close) stays, and a Preview that fails offers its source
          : <RenderBoundary key={view} resetKey={loaded} fallback={() => view === "markdown"
            ? <div className="file-viewer-note" role="alert">
              <p>{t("This preview can't be shown.")}</p>
              <button type="button" className="btn btn-ghost" onClick={() => setChosen({ path, mode: "code" })}>{t("Show source")}</button>
            </div>
            : <p className="file-viewer-note" role="alert">{t("The file could not be opened.")}</p>}>
            <TextFileView path={info.path} text={loaded.text} language={language} view={view} onOpen={onOpen ?? setPath} sourceRef={sourceRef} previewRef={previewRef} />
          </RenderBoundary>;
      default:
        return <p className="file-viewer-note">{info.mime}, {formatBytes(info.size)}. This file can't be shown here; download it instead.</p>;
    }
  })();

  return (
    <div className="modal-scrim file-viewer-scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={surface} className="modal file-viewer" role="dialog" aria-modal="true" aria-label={info?.name ?? path} tabIndex={-1}>
        {/* three groups, spaced apart: how the text shows, the file itself, the window */}
        <header className={stacked ? "modal-header file-viewer-header file-viewer-header-stacked" : "modal-header file-viewer-header"}>
          <div className="file-viewer-title">
            {/* a long name is cut inside its stem, so its type stays in view */}
            <h2 className="modal-title"><span className="file-viewer-stem">{stem}</span>{extension}</h2>
            <p className="file-viewer-meta" title={shownPath}>
              {/* a partial view is told by the size ("256 KB of 1.3 MB") in the warning color, beside an
                  icon so the color is not the only sign; what it means is the tooltip (and read out) */}
              {info && (cutShort || leftPlain
                ? <span className="file-viewer-notice" title={notes.join("\n")}>
                  <TriangleAlert aria-hidden="true" />
                  <span>{cutShort ? t("{done} of {total}", { done: formatBytes(loaded.limit), total: formatBytes(loaded.size ?? info.size) }) : formatBytes(info.size)}</span>
                  <span className="visually-hidden">{notes.join(". ")}</span>
                </span>
                : <span className="file-viewer-size">{formatBytes(info.size)}</span>)}
              {/* the dot is the folder's, so where the folder has no room left no dot dangles */}
              {folder !== "" && <span className="file-viewer-path"><span dir="ltr">{info && <span className="file-viewer-dot" aria-hidden="true">·</span>}{folder}</span></span>}
            </p>
          </div>
          <div className="file-viewer-actions">
            {/* the comments: this file's, walked one per tap */}
            {commentsShown && <div className="file-viewer-group">
              <button type="button" className="icon-button file-viewer-action file-viewer-comments" aria-label={countLabel} title={`${countLabel}\n${t("Go to the next comment")}`} onClick={walk.next}>
                <MessageSquare aria-hidden="true" />
                {/* the count as a bubble on the icon; the full text (with any outdated) is the name and tooltip */}
                <span className="file-viewer-comments-count" aria-hidden="true">{fileComments > 99 ? "99+" : fileComments}</span>
              </button>
            </div>}
            {/* how the text shows: Preview or source is one choice of two, so one toggle; wrapping is a
                setting (Settings → File viewer), not an action here */}
            {textFile && hasPreview(language) && <div className="file-viewer-group">
              <button type="button" className="icon-button file-viewer-action" aria-pressed={mode === "code"} aria-label={t("Show source")} title={t("Show source")} onClick={() => setChosen({ path, mode: mode === "code" ? "preview" : "code" })}><Code aria-hidden="true" /></button>
            </div>}
            {/* the file itself: a new tab shows it whole (Raw for text) and saves it from there, so a
                download of its own is offered only for a file no tab can show */}
            <div className="file-viewer-group">
              {info?.kind === "binary"
                ? <a className="icon-button file-viewer-action" href={fileUrl(shownPath, paneId, true)} download={info.name} aria-label={t("Download")} title={t("Download")}><Download aria-hidden="true" /></a>
                : <a className="icon-button file-viewer-action" href={url} target="_blank" rel="noopener" aria-label={textFile ? t("Raw") : t("Open in a new tab")} title={textFile ? t("Raw") : t("Open in a new tab")}><ExternalLink aria-hidden="true" /></a>}
              {copyable && <CopyFileButton text={loaded.text} sourceRef={sourceRef} onShowSource={showSourceToSelect} />}
            </div>
          </div>
          <button type="button" className="icon-button file-viewer-action file-viewer-close" aria-label={t("Close file")} title={t("Close file")} onClick={onClose}><X aria-hidden="true" /></button>
        </header>
        {/* with comments the body is their surface (lib/commentHighlight.ts), and the place the Comment button is positioned in */}
        <div ref={bodyRef} className="file-viewer-body" data-comment-surface={scope === null ? undefined : ""}>
          <FileCommentsContext.Provider value={comments.api}>{body}</FileCommentsContext.Provider>
          {comments.overlay}
          {walk.editor}
        </div>
      </section>
    </div>
  );
}
