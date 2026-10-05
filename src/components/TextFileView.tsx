import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";

import { OpenFileContext, resolveFromFile } from "../lib/filePaths.ts";
import { useSettings, type MarkdownWidth } from "../lib/settings.ts";
import { HighlightedCode } from "./HighlightedCode.tsx";
import { Markdown } from "./Markdown.tsx";

/** The stored width is a setting's value, not a class name: a rename of either leaves the other alone. */
const MARKDOWN_CLASS: Record<MarkdownWidth, string> = {
  readable: "file-viewer-markdown file-viewer-markdown-readable",
  full: "file-viewer-markdown",
};

export interface TextFileViewProps {
  path: string;
  text: string;
  /** from `languageForPath(path)` */
  language: string | null;
  /** from `textView(language, mode)`: the viewer decides it once, for its header too */
  view: "markdown" | "code";
  onOpen: (path: string) => void;
  /** set to the code `<pre>` while the code shows, for Copy to select when the clipboard is out of reach */
  sourceRef: RefObject<HTMLPreElement>;
}

/** The text of a file: Markdown rendered, or highlighted code with line numbers. */
export function TextFileView({ path, text, language, view, onOpen, sourceRef }: TextFileViewProps) {
  const { settings } = useSettings();
  // the app hands a new onOpen on every render (each poll): read it from a ref, so the context
  // value changes only with the file, and the memoized Markdown and its links are left alone
  const onOpenRef = useRef(onOpen);
  useLayoutEffect(() => { onOpenRef.current = onOpen; });
  const openLink = useCallback((href: string) => onOpenRef.current(resolveFromFile(path, href)), [path]);
  return <div className="file-viewer-content">
    {view === "markdown"
      ? <OpenFileContext.Provider value={openLink}><Markdown className={MARKDOWN_CLASS[settings.markdownWidth]}>{text}</Markdown></OpenFileContext.Provider>
      : <HighlightedCode ref={sourceRef} className="file-viewer-text" code={text} language={language} limit={settings.highlightLimit} tooLongNote={false} lineNumbers wrap={settings.wrapCode} />}
  </div>;
}
