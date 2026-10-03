import { useCallback, type RefObject } from "react";

import { OpenFileContext, resolveFromFile } from "../lib/filePaths.ts";
import { useT } from "../lib/i18n.ts";
import { useSettings } from "../lib/settings.ts";
import { HighlightedCode } from "./HighlightedCode.tsx";
import { Markdown } from "./Markdown.tsx";

export type TextViewMode = "preview" | "code";

export interface TextFileViewProps {
  path: string;
  text: string;
  /** from `languageForPath(path)`; "markdown" gets the Preview | Code switch */
  language: string | null;
  mode: TextViewMode;
  onModeChange: (mode: TextViewMode) => void;
  onOpen: (path: string) => void;
  /** the wrapper of the rendered file: FileViewer finds the code `<pre class="file-viewer-text">` in it to select the source */
  sourceRef: RefObject<HTMLDivElement>;
}

/** The text of a file: Markdown rendered or as code, everything else as highlighted code with line numbers. */
export function TextFileView({ path, text, language, mode, onModeChange, onOpen, sourceRef }: TextFileViewProps) {
  const t = useT();
  const { settings } = useSettings();
  const markdown = language === "markdown";
  // every file link of a long plan reads this context: a stable function keeps them from re-rendering with the viewer
  const openLink = useCallback((href: string) => onOpen(resolveFromFile(path, href)), [path, onOpen]);
  return <>
    {markdown && <div className="file-viewer-toolbar">
      <div className="segmented" role="group" aria-label={t("View")}>
        <button type="button" aria-pressed={mode === "preview"} onClick={() => onModeChange("preview")}>{t("Preview")}</button>
        <button type="button" aria-pressed={mode === "code"} onClick={() => onModeChange("code")}>{t("Code")}</button>
      </div>
    </div>}
    <div className="file-viewer-content" ref={sourceRef}>
      {markdown && mode === "preview"
        ? <OpenFileContext.Provider value={openLink}><Markdown className="file-viewer-markdown">{text}</Markdown></OpenFileContext.Provider>
        : <HighlightedCode className="file-viewer-text" code={text} language={language} limit={settings.highlightLimit} lineNumbers wrap={settings.wrapCode} />}
    </div>
  </>;
}
