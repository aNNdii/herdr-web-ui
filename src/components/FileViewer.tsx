import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { Check, Code, Copy, Download, ExternalLink, TriangleAlert, X } from "lucide-react";

import "./FileViewer.css";
import { DirectoryBrowser } from "./DirectoryBrowser.tsx";
import { TextFileView, type TextViewMode } from "./TextFileView.tsx";

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
import { dropPartialLastLine } from "../lib/textPreview.ts";

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

/** The code `<pre>` of the open file: the source text alone, with no note and no line numbers (a CSS counter). */
const sourceOf = (wrapper: RefObject<HTMLElement>): HTMLElement | null => wrapper.current?.querySelector<HTMLElement>("pre.file-viewer-text") ?? null;

/**
 * Copies the whole file; owns its "copied" flip, so only the button re-renders for it. Without a
 * clipboard API (plain-HTTP LAN) it selects the source `<pre>` instead; in a Markdown Preview there
 * is none, so `onShowSource` switches to Code first and the viewer selects it once rendered.
 */
function CopyFileButton({ text, sourceRef, onShowSource }: { text: string; sourceRef: RefObject<HTMLElement>; onShowSource: () => void }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const label = copied ? t("File copied") : t("Copy file");
  const copy = async (): Promise<void> => {
    const source = sourceOf(sourceRef);
    if (await copyText(text, source)) setCopied(true);
    else if (!source) onShowSource();
  };
  return <button type="button" className="icon-button" aria-label={label} title={label} onClick={() => void copy()}>
    {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
  </button>;
}

/**
 * A file an agent wrote, opened in the browser: images, video and audio (streamed, so they
 * play and seek at once), PDFs, and the start of a text file. Anything can be downloaded.
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
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  // the mode is the user's choice for this path, else Preview: derived, so a new path never paints the old mode
  const [chosen, setChosen] = useState<{ path: string; mode: TextViewMode } | null>(null);
  const mode = chosen?.path === path ? chosen.mode : "preview";
  // the wrapper of the file's rendered text, where Copy finds the code <pre> to select
  const sourceRef = useRef<HTMLDivElement>(null);
  // Copy failed in a Preview: select the source as soon as the Code view has rendered
  const selectSourceOnCode = useRef(false);
  const showSourceToSelect = useCallback(() => {
    selectSourceOnCode.current = true;
    setChosen({ path, mode: "code" });
  }, [path]);
  useLayoutEffect(() => {
    if (!selectSourceOnCode.current || mode !== "code") return;
    selectSourceOnCode.current = false;
    const source = sourceOf(sourceRef);
    if (source) selectContents(source);
  }, [mode, text]);

  useEffect(() => setPath(asked), [asked]);

  useEffect(() => {
    let cancelled = false;
    setInfo(null); setCandidates(null); setError(null); setText(null); setDirectory(null);
    fetchFileInfo(path, paneId).then(async (next) => {
      if (cancelled) return;
      if ("candidates" in next) { setCandidates(next.candidates); return; }
      setInfo(next);
      if (next.kind !== "text") return;
      // only the first part of a text file travels: a range, whatever the file's size
      const response = await fetch(fileUrl(next.path, paneId), { headers: { range: `bytes=0-${textLoadLimit - 1}` } });
      const body = await response.text();
      if (!cancelled) setText(dropPartialLastLine(body, next.size > textLoadLimit));
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
      setError(reason instanceof ApiError && reason.status === 404 ? t("No readable file at this path.") : t("The file could not be opened."));
    });
    return () => { cancelled = true; };
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
  const truncated = info !== null && info.size > textLoadLimit;
  const codeShown = textFile && text !== null && !(language === "markdown" && mode === "preview");
  const shownPath = info?.path ?? path;
  const { stem, extension } = pathParts(info?.name ?? shownPath);
  const { folder } = pathParts(shownPath);
  // what holds for the whole file is said with its size, where it is seen first, not after a megabyte of text
  const cutShort = textFile && truncated;
  const leftPlain = codeShown && tooLongToHighlight(text, language, settings.highlightLimit);
  const copyable = textFile && text !== null && !truncated;
  // a phone stacks the actions under the name once there are two or more; one fits beside it
  const stacked = textFile && (language === "markdown" ? 1 : 0) + 1 + (copyable ? 1 : 0) > 1;
  const body = (() => {
    if (directory !== null) return <DirectoryBrowser key={directory} start={directory} onOpenFile={onOpen ?? setPath} />;
    if (error !== null) return <p className="file-viewer-note" role="alert">{error}</p>;
    if (candidates !== null) return <div className="file-viewer-choices">
      <p className="file-viewer-note">Several files are named {path.split("/").pop()}:</p>
      <ul>{candidates.map((candidate) => <li key={candidate}><button type="button" className="btn btn-ghost" onClick={() => setPath(candidate)}>{candidate}</button></li>)}</ul>
    </div>;
    if (info === null) return <p className="file-viewer-note">{t("Opening…")}</p>;
    switch (info.kind) {
      case "image":
        return info.size > MAX_INLINE_IMAGE_BYTES
          ? <p className="file-viewer-note">This image is {formatBytes(info.size)}; open it in a new tab to view it.</p>
          : <img className="file-viewer-media" src={url} alt={info.name} />;
      case "video":
        return <video className="file-viewer-media" src={url} controls playsInline preload="metadata" />;
      case "audio":
        return <audio className="file-viewer-audio" src={url} controls preload="metadata" />;
      case "pdf":
        return <iframe className="file-viewer-pdf" src={url} title={info.name} />;
      case "text":
        return text === null
          ? <p className="file-viewer-note">{t("Opening…")}</p>
          : <TextFileView path={info.path} text={text} language={language} mode={mode} onOpen={onOpen ?? setPath} sourceRef={sourceRef} />;
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
                  icon so the color is not the only sign */}
              {info && (cutShort || leftPlain
                ? <span className="file-viewer-notice" title={cutShort ? t("Showing the first {shown}", { shown: formatBytes(textLoadLimit) }) : undefined}>
                  <TriangleAlert aria-hidden="true" />
                  <span>{cutShort ? t("{done} of {total}", { done: formatBytes(textLoadLimit), total: formatBytes(info.size) }) : formatBytes(info.size)}</span>
                  {leftPlain && <span>· {t("Too long to highlight")}</span>}
                </span>
                : <span className="file-viewer-size">{formatBytes(info.size)}</span>)}
              {/* the dot is the folder's, so where the folder has no room left no dot dangles */}
              {folder !== "" && <span className="file-viewer-path"><span dir="ltr">{info && <span className="file-viewer-dot" aria-hidden="true">·</span>}{folder}</span></span>}
            </p>
          </div>
          <div className="file-viewer-actions">
            {/* how the text shows: Preview or source is one choice of two, so one toggle; wrapping is a
                setting (Settings → File viewer), not an action here */}
            {textFile && language === "markdown" && <div className="file-viewer-group">
              <button type="button" className="icon-button" aria-pressed={mode === "code"} aria-label={t("Show source")} title={t("Show source")} onClick={() => setChosen({ path, mode: mode === "code" ? "preview" : "code" })}><Code aria-hidden="true" /></button>
            </div>}
            {/* the file itself: a new tab shows it whole (Raw for text) and saves it from there, so a
                download of its own is offered only for a file no tab can show */}
            <div className="file-viewer-group">
              {info?.kind === "binary"
                ? <a className="icon-button" href={fileUrl(shownPath, paneId, true)} download={info.name} aria-label={t("Download")} title={t("Download")}><Download aria-hidden="true" /></a>
                : <a className="icon-button" href={url} target="_blank" rel="noopener" aria-label={textFile ? t("Raw") : t("Open in a new tab")} title={textFile ? t("Raw") : t("Open in a new tab")}><ExternalLink aria-hidden="true" /></a>}
              {copyable && <CopyFileButton text={text} sourceRef={sourceRef} onShowSource={showSourceToSelect} />}
            </div>
          </div>
          <button type="button" className="icon-button file-viewer-close" aria-label={t("Close file")} title={t("Close file")} onClick={onClose}><X aria-hidden="true" /></button>
        </header>
        <div className="file-viewer-body">{body}</div>
      </section>
    </div>
  );
}
