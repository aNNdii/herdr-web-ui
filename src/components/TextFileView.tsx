import { useCallback, type RefObject } from "react";

import { OpenFileContext, resolveFromFile } from "../lib/filePaths.ts";
import { useSettings } from "../lib/settings.ts";
import { HighlightedCode } from "./HighlightedCode.tsx";
import { Markdown } from "./Markdown.tsx";

export type TextViewMode = "preview" | "code";

export interface TextFileViewProps {
  path: string;
  text: string;
  /** from `languageForPath(path)`; "markdown" gets the Preview | Code switch */
  language: string | null;
  /** chosen in the viewer's header */
  mode: TextViewMode;
  onOpen: (path: string) => void;
  /** the wrapper of the rendered file: FileViewer finds the code `<pre class="file-viewer-text">` in it to select the source */
  sourceRef: RefObject<HTMLDivElement>;
}

/** The text of a file: Markdown rendered or as code, everything else as highlighted code with line numbers. */
export function TextFileView({ path, text, language, mode, onOpen, sourceRef }: TextFileViewProps) {
  const { settings } = useSettings();
  const markdown = language === "markdown";
  // every file link of a long plan reads this context: a stable function keeps them from re-rendering with the viewer
  const openLink = useCallback((href: string) => onOpen(resolveFromFile(path, href)), [path, onOpen]);
  return <div className="file-viewer-content" ref={sourceRef}>
    {markdown && mode === "preview"
      ? <OpenFileContext.Provider value={openLink}><Markdown className={`file-viewer-markdown file-viewer-markdown-${settings.markdownWidth}`}>{text}</Markdown></OpenFileContext.Provider>
      : <HighlightedCode className="file-viewer-text" code={text} language={language} limit={settings.highlightLimit} tooLongNote={false} lineNumbers wrap={settings.wrapCode} />}
  </div>;
}
