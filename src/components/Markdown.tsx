import { createContext, memo, useCallback, useContext, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import katex from "katex";

import "./BlockComments.css";

import { foldCode, parseMarkdown, type InlineNode, type ListBlock, type MarkdownBlock } from "../lib/markdown.ts";
import { codeIsFilePath, OpenFileContext, splitFilePaths } from "../lib/filePaths.ts";
import { fileUriPath } from "../lib/terminalFileLinks.ts";
import { CHAT_HIGHLIGHT_LIMIT, languageForFence } from "../lib/highlight.ts";
import { HighlightedCode } from "./HighlightedCode.tsx";
import { useT } from "../lib/i18n.ts";
import { BlockCommentContext, blockComments, commentTarget, formPlace, partAnchor, replyParts, usePartComments, type CommentTarget, type PartLookup } from "../lib/blockComments.ts";
import { forgetCommentPart, rememberCommentPart } from "../lib/commentSelection.ts";
import { CommentCard, CommentEditContext, CommentForm } from "./CommentCard.tsx";

/**
 * Opens the chat's one comment form (ChatView) on `target`, with the comment it holds if any: a
 * comment's Edit button opens it in place of its card, and the Comment button on a selection
 * opens it after the cards of the part where the selection ends.
 */
export const OpenCommentContext = createContext<((owner: string, target: CommentTarget) => void) | null>(null);

/**
 * True inside a quoted block (the comment editor's, `MarkdownBlocks quoted`): the block is shown
 * as context, not used. A code block has no header, copy or fold, and a link reads as its text.
 * They are not rendered, so they are neither in the tab order nor in the accessibility tree.
 */
const QuotedContext = createContext(false);

/**
 * The commentable parts of the reply this `Markdown` renders (`replyParts`): each part takes its
 * target from it, and a comment over several parts finds the parts it covers in it.
 */
const ReplyPartsContext = createContext<PartLookup | null>(null);

function MathExpression({ value, displayMode = false }: { value: string; displayMode?: boolean }) {
  try {
    // KaTeX escapes text and rejects untrusted commands by default.
    const html = katex.renderToString(value, { displayMode, strict: "ignore" });
    return <span className={displayMode ? "markdown-math-display" : "markdown-math"} dangerouslySetInnerHTML={{ __html: html }} />;
  } catch {
    return <span>{displayMode ? `\\[${value}\\]` : `\\(${value}\\)`}</span>;
  }
}

/** A file path the viewer opens: a button that reads as the text or code it replaced. */
function FilePath({ path, code, open }: { path: string; code: boolean; open: (path: string) => void }) {
  const t = useT();
  const label = code ? <code>{path}</code> : path;
  return <button type="button" className={`markdown-file${code ? " is-code" : ""}`} title={t("Open {path}", { path })} onClick={() => open(path)}>{label}</button>;
}

/** `interactive` is false inside a link or file label: nothing clickable nests in another. */
function Inline({ nodes, interactive = true }: { nodes: InlineNode[]; interactive?: boolean }) {
  const context = useContext(OpenFileContext);
  const open = interactive ? context : null;
  const quoted = useContext(QuotedContext);
  const t = useT();
  return <>{nodes.map((node, index) => {
    const key = `${node.type}-${index}`;
    switch (node.type) {
      case "text":
        if (open === null) return <span key={key}>{node.value}</span>;
        return <span key={key}>{splitFilePaths(node.value).map((part, n) => typeof part === "string" ? part : <FilePath key={n} path={part.path} code={false} open={open} />)}</span>;
      case "code": {
        const file = fileUriPath(node.value);
        if (open !== null && file !== null) return <FilePath key={key} path={file} code open={open} />;
        // agents often put an address in backticks: it stays code to the eye, and opens
        if (interactive && !quoted && /^https?:\/\/\S+$/i.test(node.value)) return <a key={key} className="markdown-code-link" href={node.value} target="_blank" rel="noopener noreferrer"><code>{node.value}</code></a>;
        return open !== null && codeIsFilePath(node.value) ? <FilePath key={key} path={node.value} code open={open} /> : <code key={key}>{node.value}</code>;
      }
      case "math": return <MathExpression key={key} value={node.value} />;
      case "strong": return <strong key={key}><Inline nodes={node.children} interactive={interactive} /></strong>;
      case "em": return <em key={key}><Inline nodes={node.children} interactive={interactive} /></em>;
      case "del": return <del key={key}><Inline nodes={node.children} interactive={interactive} /></del>;
      case "link": return quoted
        ? <span key={key}><Inline nodes={node.children} interactive={false} /></span>
        : <a key={key} href={node.href} target="_blank" rel="noopener noreferrer"><Inline nodes={node.children} interactive={false} /></a>;
      // the label opens the file; where nothing can open one, the path shows after it, as Codex's terminal does
      case "file": {
        const label = <Inline nodes={node.children} interactive={false} />;
        return open !== null
          ? <button key={key} type="button" className="markdown-file" title={t("Open {path}", { path: node.path })} onClick={() => open(node.path)}>{label}</button>
          : <span key={key}>{label} (<code>{node.path}</code>)</span>;
      }
    }
  })}</>;
}

/** A list; each item is commentable on its own (`ItemView`), the list as a whole is not. A task
 * item's box stands in for its bullet. */
function List({ block, path, commentable }: { block: ListBlock; path: number[]; commentable: boolean }) {
  const Tag = block.ordered ? "ol" : "ul";
  return (
    <Tag className="markdown-list" start={block.ordered ? block.start : undefined}>
      {block.items.map((_, index) => <ItemView key={index} list={block} index={index} path={[...path, index]} commentable={commentable} />)}
    </Tag>
  );
}

/**
 * One list item: each one is a block of its own for comments, nested items included. The item's
 * own text sits in `.markdown-item` with its notes, so a highlight and a selection's offsets cover the
 * item's words, not its nested blocks (they have their own). The wrapper is there whether or not
 * the item is commentable or commented: adding a comment remounts none of the nested blocks.
 */
function ItemView({ list, index, path, commentable }: { list: ListBlock; index: number; path: number[]; commentable: boolean }) {
  const item = list.items[index]!;
  const comment = useCommentable(path, commentable);
  const id = useId();
  // `list-style` only works on the <li>, so the task class stays there; the comment's classes go on the wrapper
  return (
    <li className={item.checked === undefined ? undefined : "markdown-task"}>
      <div ref={comment.ref} className={comment.className === undefined ? "markdown-item" : `markdown-item ${comment.className}`}>
        {/* a task's box shows its state; the agent's text owns it, so it cannot be ticked here. Drawn,
            not an <input>: a disabled checkbox is greyed by the browser and ignores the accent */}
        {item.checked !== undefined && <span className="markdown-task-box" role="checkbox" aria-checked={item.checked} aria-disabled="true" aria-labelledby={id}>{item.checked && <Check aria-hidden="true" />}</span>}
        {item.checked === undefined ? <Inline nodes={item.content} /> : <span id={id}><Inline nodes={item.content} /></span>}
        {comment.after}
      </div>
      {item.blocks !== undefined && <Blocks blocks={item.blocks} path={path} commentable={commentable} />}
    </li>
  );
}

function CodeBlock({ language, value }: { language: string; value: string }) {
  const t = useT();
  const quoted = useContext(QuotedContext);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const block = useRef<HTMLDivElement>(null);
  // no inner scroll: a long block folds, with a visible "Show all" row
  const fold = useMemo(() => foldCode(value), [value]);
  /** Copies the whole block, folded lines included, and flips the button to "copied" for a moment. */
  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  const folding = useRef(false);
  /** Shows all lines or folds them again; after folding, the block's top is brought back into view. */
  const toggle = (): void => {
    folding.current = expanded;
    setExpanded(!expanded);
  };
  // "Show less" sits at the bottom of a long block: after folding, bring the block's top back
  // into view rather than leave the reader far below it
  useLayoutEffect(() => {
    if (!folding.current) return;
    folding.current = false;
    const node = block.current;
    const view = node?.closest(".chat-view");
    if (node && view && node.getBoundingClientRect().top < view.getBoundingClientRect().top) node.scrollIntoView({ block: "start" });
  }, [expanded]);
  // quoted: the whole block, without header, copy or fold
  if (quoted) return <div className="markdown-code"><pre><code>{value}</code></pre></div>;
  return (
    <div className="markdown-code" ref={block}>
      <div className="markdown-code-header">
        <span>{language || "text"}</span>
        <button type="button" className="icon-button markdown-code-copy" onClick={() => void copy()} aria-label={t(copied ? "Code copied" : "Copy code")}>
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        </button>
      </div>
      <HighlightedCode code={fold !== null && !expanded ? fold.head : value} language={languageForFence(language)} limit={CHAT_HIGHLIGHT_LIMIT} />
      {fold !== null && (
        <button type="button" className="markdown-code-more" aria-expanded={expanded} onClick={toggle}>
          {expanded ? t("Show less") : t("Show all {n} lines", { n: fold.lines })}
        </button>
      )}
    </div>
  );
}

const NO_PATH: number[] = [];

/**
 * `path` locates the blocks inside the reply part (a list item's index is part of it), which is
 * how a comment finds its block again. Inside a blockquote nothing is commentable on its own:
 * the quote is one block.
 */
function Blocks({ blocks, path = NO_PATH, commentable = true }: { blocks: MarkdownBlock[]; path?: number[]; commentable?: boolean }) {
  return <>{blocks.map((block, index) => <BlockView key={`${block.type}-${index}`} block={block} path={[...path, index]} commentable={commentable} />)}</>;
}

/**
 * One block at `path`, with its comment cards where it is commentable. A rule carries no comment,
 * and a list carries them on its items.
 */
function BlockView({ block, path, commentable }: { block: MarkdownBlock; path: number[]; commentable: boolean }): ReactNode {
  const comment = useCommentable(path, commentable && block.type !== "hr" && block.type !== "list");
  const { className, ref } = comment;
  switch (block.type) {
    case "heading": {
      const Tag = `h${block.level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      return <><Tag ref={ref} className={className}><Inline nodes={block.content} /></Tag>{comment.after}</>;
    }
    case "paragraph":
      return <><p ref={ref} className={className}>{block.lines.map((line, lineIndex) => <span key={lineIndex}><Inline nodes={line} />{lineIndex < block.lines.length - 1 && <br />}</span>)}</p>{comment.after}</>;
    case "list": return <List block={block} path={path} commentable={commentable} />;
    case "blockquote": return <><blockquote ref={ref} className={className}><Blocks blocks={block.blocks} path={path} commentable={false} /></blockquote>{comment.after}</>;
    case "hr": return <hr />;
    default: {
      const body = block.type === "code" ? <CodeBlock language={block.language} value={block.value} />
        : block.type === "math" ? <MathExpression value={block.value} displayMode />
        : <div className="markdown-table-wrap">
          <table><thead><tr>{block.header.map((cell, cellIndex) => <th key={cellIndex}><Inline nodes={cell} /></th>)}</tr></thead>
            <tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}><Inline nodes={cell} /></td>)}</tr>)}</tbody>
          </table>
        </div>;
      // a code block, a table or a formula is commentable on a host around it, its notes after. The
      // host is there whether or not the block is commentable, so a reply turning final (or live
      // again) keeps the same element, and a code block the reader unfolded stays unfolded
      return <><div ref={ref} className={className === undefined ? "markdown-block" : `markdown-block ${className}`}>{body}</div>{comment.after}</>;
    }
  }
}

interface Commentable {
  /** undefined where the block is not commentable */
  className: string | undefined;
  /** on the block's element: where it is commentable, the selection handler finds its target from it */
  ref: (node: HTMLElement | null) => void;
  /** the block's notes, one card per comment (and the open form), right after the block's content */
  after: ReactNode;
}

/**
 * What makes the block at `path` commentable; nothing where it is not (outside a final answer,
 * inside a blockquote, a rule). Its target is the reply's part at `path` (`ReplyPartsContext`; a
 * list item's path ends in its index). A comment is made by selecting text in the block (ChatView),
 * which finds the block's target through the element `ref` registers. The block shows the notes of
 * the comments that hang under it (`notesOnPart`): its own, and those of selections that end in it.
 */
function useCommentable(path: number[], enabled: boolean): Commentable {
  const reply = useContext(BlockCommentContext);
  const parts = useContext(ReplyPartsContext);
  const openEditor = useContext(OpenCommentContext);
  const edit = useContext(CommentEditContext);
  const target = enabled && reply !== null ? parts?.get(partAnchor(reply, path))?.target ?? null : null;
  const { notes, touched } = usePartComments(reply?.owner ?? "", target, parts);
  // registered while mounted and commentable, and taken out when either ends
  const registered = useRef<HTMLElement | null>(null);
  const ref = useCallback((node: HTMLElement | null) => {
    if (registered.current !== null) forgetCommentPart(registered.current);
    registered.current = node;
    if (node !== null && target !== null && reply !== null && parts !== null) rememberCommentPart(node, { owner: reply.owner, target, parts });
  }, [reply, target, parts]);
  if (target === null || reply === null) return { className: undefined, ref, after: null };
  // the open form is drawn in the host its card has, or will have once saved (`formPlace`)
  const place = edit !== null && edit.owner === reply.owner && parts !== null ? formPlace(blockComments.list(edit.owner), edit.target, parts) : null;
  const here = edit !== null && place !== null && place.host.anchor === target.anchor ? { edit, replaces: place.replaces } : null;
  const anchors = notes.map((comment) => comment.anchor);
  return {
    // commented: some comment covers its text, its notes may hang under a later part
    className: `is-commentable${touched ? " is-commented" : ""}`,
    ref,
    // one card per comment, in reading order, under the part where its selection ends. Keyed by
    // anchor: an edit gives the comment a new id but keeps its card's element. The text it is on
    // shows as the highlight, not in the card. The form of an edit takes its card's place; a new
    // comment's goes after the cards
    after: (notes.length > 0 || here !== null) && <div className="block-comment-notes">
      {notes.map((comment) => here !== null && here.replaces === comment.id
        ? <CommentForm key={comment.anchor} edit={here.edit} replaces={comment} anchors={anchors} />
        : <CommentCard key={comment.anchor} comment={comment} anchors={anchors}
          onEdit={() => openEditor?.(reply.owner, comment.quote === undefined ? target : commentTarget(comment))}
          onDelete={() => blockComments.remove(reply.owner, [comment.id])} />)}
      {here !== null && here.replaces === null && <CommentForm key={`new-${here.edit.id}`} edit={here.edit} replaces={null} anchors={anchors} />}
    </div>,
  };
}

/**
 * Blocks already parsed, as the chat shows them: a comment's block in the comment editor. With
 * `quoted` they show as a quote, without anything to press: no code header, copy or fold, links
 * as their text, file paths as plain text or code.
 */
export function MarkdownBlocks({ blocks, quoted = false }: { blocks: MarkdownBlock[]; quoted?: boolean }) {
  // the editor is portalled out of a reply but inherits its context: nothing commentable inside it
  const content = <div className="markdown"><Blocks blocks={blocks} /></div>;
  return (
    <BlockCommentContext.Provider value={null}><ReplyPartsContext.Provider value={null}>
      {quoted ? <QuotedContext.Provider value><OpenFileContext.Provider value={null}>{content}</OpenFileContext.Provider></QuotedContext.Provider> : content}
    </ReplyPartsContext.Provider></BlockCommentContext.Provider>
  );
}

/**
 * Markdown rendered. Both props are strings, so `memo` skips a parent's re-render: a long plan in
 * the file viewer is not rendered again every time the app polls.
 */
export const Markdown = memo(function Markdown({ children, className }: { children: string; className?: string }) {
  const blocks = useMemo(() => parseMarkdown(children), [children]);
  // a final reply part: a selection that comments stays inside one (lib/commentSelection.ts)
  const reply = useContext(BlockCommentContext);
  // the same targets across renders while the reply and its text stay: a part re-renders only for its own comments
  const parts = useMemo(() => reply === null ? null : replyParts(reply, blocks), [reply, blocks]);
  return <ReplyPartsContext.Provider value={parts}>
    <div className={className === undefined ? "markdown" : `markdown ${className}`} data-comment-root={reply === null ? undefined : ""}><Blocks blocks={blocks} /></div>
  </ReplyPartsContext.Provider>;
});
