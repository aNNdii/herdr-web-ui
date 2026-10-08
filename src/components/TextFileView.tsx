import { useCallback, useContext, useLayoutEffect, useRef, type RefObject } from "react";

import { OpenFileContext, resolveFromFile } from "../lib/filePaths.ts";
import { useSettings, type MarkdownWidth } from "../lib/settings.ts";
import { FileCommentsContext } from "./FileComments.tsx";
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
  /** set to the preview's `.markdown` root while it shows: the comments measure selections in it */
  previewRef: RefObject<HTMLDivElement>;
}

/**
 * The text of a file: Markdown rendered, or highlighted code with line numbers. In a viewer that
 * takes comments (`FileCommentsContext`) each code line carries its number, and the preview's
 * elements carry the source lines they come from (`Markdown` with `sourceLines`): a comment is on
 * those lines. Nothing of the comments is drawn here: their pins lie in the viewer's pin layer.
 */
export function TextFileView({ path, text, language, view, onOpen, sourceRef, previewRef }: TextFileViewProps) {
  const { settings } = useSettings();
  // the app hands a new onOpen on every render (each poll): read it from a ref, so the context
  // value changes only with the file, and the memoized Markdown and its links are left alone
  const onOpenRef = useRef(onOpen);
  useLayoutEffect(() => { onOpenRef.current = onOpen; });
  const openLink = useCallback((href: string) => onOpenRef.current(resolveFromFile(path, href)), [path]);
  const takesComments = useContext(FileCommentsContext);
  return <div className="file-viewer-content">
    {view === "markdown"
      ? <OpenFileContext.Provider value={openLink}><Markdown ref={previewRef} className={MARKDOWN_CLASS[settings.markdownWidth]} sourceLines={takesComments}>{text}</Markdown></OpenFileContext.Provider>
      : <HighlightedCode ref={sourceRef} className="file-viewer-text" code={text} language={language} limit={settings.highlightLimit} tooLongNote={false} lineNumbers wrap={settings.wrapCode} firstLine={1} />}
  </div>;
}
