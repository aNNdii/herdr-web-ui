import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { Check, Code, Copy, Download, ExternalLink, TriangleAlert, X } from "lucide-react";

import "./FileViewer.css";
import { DirectoryBrowser } from "./DirectoryBrowser.tsx";
import { TextFileView } from "./TextFileView.tsx";

import type { FileInfo } from "../../shared/protocol.ts";
import { ApiError } from "../lib/api.ts";
import { formatBytes } from "../lib/bridgeProgress.ts";
import { LOCAL_MACHINE } from "../../shared/machines.ts";
import { useMachineApi, useMachineId } from "../lib/machineContext.tsx";
import { copyText, selectContents } from "../lib/clipboard.ts";
import { pathParts } from "../lib/filePaths.ts";
import { languageForPath, tooLongToHighlight } from "../lib/highlight.ts";
import { useT } from "../lib/i18n.ts";
import { useSettings } from "../lib/settings.ts";
import { hasPreview, loadedText, textView, type LoadedText, type TextViewMode } from "../lib/textPreview.ts";

/** Bigger images are offered as a download: a phone decodes an image whole. */
const MAX_INLINE_IMAGE_BYTES = 20 * 1024 * 1024;

export interface FileViewerProps {
  /** absolute, `~/…`, or relative to the pane's folder */
  path: string;
  paneId: string | null;
  onClose: () => void;
  /** a file chosen in a folder's listing: opened as the preview, so history and a reload keep it */
  onOpen?: (path: string) => void;
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
export function FileViewer({ path: asked, paneId, onClose, onOpen }: FileViewerProps) {
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
  const [chosen, setChosen] = useState<{ path: string; mode: TextViewMode } | null>(null);
  const mode = chosen?.path === path ? chosen.mode : "preview";
  // the code <pre> while the code shows, which Copy selects when the clipboard is out of reach
  const sourceRef = useRef<HTMLPreElement>(null);
  // Copy failed in a Preview: select the source as soon as the Code view has rendered
  const selectSourceOnCode = useRef(false);
  const showSourceToSelect = (): void => {
    selectSourceOnCode.current = true;
    setChosen({ path, mode: "code" });
  };
  useLayoutEffect(() => {
    if (!selectSourceOnCode.current || mode !== "code") return;
    selectSourceOnCode.current = false;
    if (sourceRef.current) selectContents(sourceRef.current);
  }, [mode, loaded]);

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
      const body = await response.text();
      if (!cancelled) setLoaded(loadedText(body, next.size, textLoadLimit));
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

  useEffect(() => {
    // the FilesDialog beneath listens on window too (and stands down while this is open); this
    // one is the topmost overlay, so it takes the key
    const onKey = (event: KeyboardEvent): void => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
  // a phone stacks the actions under the name once there are two or more, and one fits beside it:
  // a text file always has Raw, so a second is Show source or Copy
  const stacked = textFile && (hasPreview(language) || copyable);
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
          : <TextFileView path={info.path} text={loaded.text} language={language} view={view} onOpen={onOpen ?? setPath} sourceRef={sourceRef} />;
      default:
        return <p className="file-viewer-note">{info.mime}, {formatBytes(info.size)}. This file can't be shown here; download it instead.</p>;
    }
  })();

  return (
    <div className="modal-scrim file-viewer-scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal file-viewer" role="dialog" aria-modal="true" aria-label={info?.name ?? path}>
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
                  <span>{cutShort ? t("{done} of {total}", { done: formatBytes(loaded.limit), total: formatBytes(info.size) }) : formatBytes(info.size)}</span>
                  <span className="visually-hidden">{notes.join(". ")}</span>
                </span>
                : <span className="file-viewer-size">{formatBytes(info.size)}</span>)}
              {/* the dot is the folder's, so where the folder has no room left no dot dangles */}
              {folder !== "" && <span className="file-viewer-path"><span dir="ltr">{info && <span className="file-viewer-dot" aria-hidden="true">·</span>}{folder}</span></span>}
            </p>
          </div>
          <div className="file-viewer-actions">
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
        <div className="file-viewer-body">{body}</div>
      </section>
    </div>
  );
}
