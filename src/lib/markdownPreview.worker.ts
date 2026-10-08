// Parses a Markdown file for the viewer's Preview off the page (src/lib/markdownPreview.ts): an
// input the parser handles slowly stalls this worker, which is ended past its budget, never the tab.
import { parseMarkdown, type MarkdownBlock } from "./markdown.ts";
import { serveOffThread } from "./offThread.ts";

serveOffThread<string, MarkdownBlock[]>((text) => ({ result: parseMarkdown(text) }));
