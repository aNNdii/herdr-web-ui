/**
 * The comments panel: every comment of one pane that goes with its next message, grouped by where it is (the chat's
 * replies, then each file, with its glyph, name, folder and count), each a card with what it is on (a reply's quote, a
 * file's lines as code with their numbers) and its text. The file and the code open the file in the review at those
 * lines; the text opens to edit in place (CommentPopover's row, drawn as the text at rest is, so nothing moves), the bin
 * deletes it, with an Undo for a while after; Remove all empties the pane. The composer's comments bar opens it; the
 * comment mode stays the chat's own toggle. One panel for the app (lib/commentsPanel.ts), in the file viewer's frame
 * (FileViewer.css): docked, the column beside the panes with its resize edge (App puts it in the docked file's place
 * while it is open), not modal; else the viewer's dialog, a sheet on a phone. Its close button, Escape or the opener
 * again close it.
 */
import { useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { MessageSquareText, X } from "lucide-react";

import "./CommentsPanel.css";

import { CommentAtRest } from "./CommentAtRest.tsx";
import { CommentPopover } from "./CommentPopover.tsx";
import { FileGlyph } from "./FileGlyph.tsx";
import { CodeLines, useHighlightedLines } from "./HighlightedCode.tsx";
import { blockComments, blockContent, commentTarget, isReplyComment, quoteFor, sortPaneComments, useBlockComments, type PaneComment } from "../lib/blockComments.ts";
import { commentsPanel, useCommentsPanel } from "../lib/commentsPanel.ts";
import type { FileComment } from "../lib/fileComments.ts";
import { languageForPath } from "../lib/highlight.ts";
import { useT } from "../lib/i18n.ts";
import { useSettings } from "../lib/settings.ts";
import { useSheetSwipe } from "../lib/sheets.ts";
import { useFocusTrap } from "../lib/useFocusTrap.ts";

/** how long a deletion's Undo is offered */
const UNDO_MS = 10_000;

/** What a reply's card quotes: the selection, else the block; the card cuts it to two lines. */
function replyQuote(comment: PaneComment): string {
  if (isReplyComment(comment)) return comment.quote ?? quoteFor(blockContent(comment.block));
  return comment.selection?.text ?? comment.quoteLines.join("\n");
}

/** Most lines of a file comment's code a card shows; the rest is counted under it. */
const SNIPPET_LINES = 6;

/** The comments of one place: the chat's replies (`path` null), or one file's, in the order the panel lists them. */
interface CommentGroup { path: string | null; label: string; comments: PaneComment[] }

/** The comments grouped by where they are, the chat's replies first, then each file in the order they are sent. */
function groupsOf(comments: readonly PaneComment[]): CommentGroup[] {
  const groups: CommentGroup[] = [];
  for (const comment of comments) {
    const path = isReplyComment(comment) ? null : comment.path;
    const last = groups.at(-1);
    if (last !== undefined && last.path === path) last.comments.push(comment);
    else groups.push({ path, label: isReplyComment(comment) ? "" : comment.label, comments: [comment] });
  }
  return groups;
}

/** A label's folder and name: `src/components/` and `ReviewFile.tsx`. */
function splitLabel(label: string): { folder: string; name: string } {
  const at = Math.max(label.lastIndexOf("/"), label.lastIndexOf("\\"));
  return { folder: label.slice(0, at + 1), name: label.slice(at + 1) };
}

/** A file comment's lines as code, coloured as the review draws them, each with its number in the file. */
function Snippet({ comment }: { comment: FileComment }): ReactElement {
  const t = useT();
  // one line over the cap is shown rather than counted
  const shown = comment.quoteLines.length > SNIPPET_LINES + 1 ? comment.quoteLines.slice(0, SNIPPET_LINES) : comment.quoteLines;
  const { lines } = useHighlightedLines(shown.join("\n"), languageForPath(comment.path));
  const rest = comment.quoteLines.length - shown.length;
  // the numbers' gutter is as wide as the last number shown
  const digits = { "--snippet-digits": String(Math.max(2, String(comment.lines[0] + shown.length - 1).length)) } as CSSProperties;
  return <span className="comments-panel-snippet" style={digits}>
    <CodeLines lines={lines} open={null} lineNumbers chunked firstLine={comment.lines[0]} />
    {rest > 0 && <span className="comments-panel-more">{t("{count} more lines", { count: rest })}</span>}
  </span>;
}

/** Saves `text` as the comment's, at its own place: an edit, or a deleted comment put back. */
function saveAt(owner: string, comment: PaneComment, text: string): void {
  if (isReplyComment(comment)) {
    blockComments.save(owner, commentTarget(comment), text);
    return;
  }
  // its anchor goes along, so the store finds the place it was kept under
  const { kind: _kind, id: _id, created: _created, comment: _text, ...target } = comment;
  blockComments.saveFile(owner, target, text);
}

const noFocus = (): null => null;

/** The panel, while one is open: `docked` in the file panel's column (with its edge, `panelStart`), else a dialog. */
export function CommentsPanel({ docked, panelStart }: { docked: boolean; panelStart?: ReactNode }): ReactElement | null {
  const panel = useCommentsPanel();
  const { settings } = useSettings();
  // comments turned off: there are none to list
  useEffect(() => { if (!settings.comments) commentsPanel.close(); }, [settings.comments]);
  if (panel === null || !settings.comments) return null;
  return <Panel key={panel.owner} owner={panel.owner} opener={panel.opener} openFile={panel.openFile} docked={docked} panelStart={panelStart} />;
}

function Panel({ owner, opener, openFile, docked, panelStart }: { owner: string; opener: HTMLElement | null; openFile: ((path: string) => void) | null; docked: boolean; panelStart?: ReactNode }): ReactElement {
  const t = useT();
  const stored = useBlockComments(owner);
  const comments = useMemo(() => sortPaneComments(stored), [stored]);
  const [editing, setEditing] = useState<string | null>(null);
  // the comments just deleted, for their Undo (the store keeps none)
  const [deleted, setDeleted] = useState<PaneComment[] | null>(null);
  // the dialog holds the focus, as the file viewer's does; docked, the panes beside it stay reachable
  const root = useFocusTrap<HTMLElement>(!docked);
  useSheetSwipe(root, docked ? null : () => close());

  // the panel takes the focus once as it opens, so a keyboard is in it; docked, nothing holds it there
  useEffect(() => { root.current?.focus({ preventScroll: true }); }, [root]);
  useEffect(() => {
    if (deleted === null) return;
    const timer = window.setTimeout(() => setDeleted(null), UNDO_MS);
    return () => window.clearTimeout(timer);
  }, [deleted]);
  // an edited comment gone meanwhile (sent, deleted in another view): its field goes with it
  useEffect(() => {
    if (editing !== null && !comments.some((comment) => comment.id === editing)) setEditing(null);
  }, [comments, editing]);

  const close = (): void => {
    const inside = root.current?.contains(document.activeElement) ?? false;
    commentsPanel.close();
    if (inside && opener?.isConnected) opener.focus({ preventScroll: true });
  };
  const remove = (list: PaneComment[]): void => {
    if (list.length === 0) return;
    blockComments.remove(owner, list.map((comment) => comment.id));
    setEditing(null);
    setDeleted(list);
  };
  const undo = (): void => {
    if (deleted === null) return;
    for (const comment of deleted) saveAt(owner, comment, comment.comment);
    setDeleted(null);
  };

  const count = comments.length;
  const groups = useMemo(() => groupsOf(comments), [comments]);
  // a file (at a line) opens in the review; as a dialog the panel steps aside for it
  const show = openFile === null ? null : (path: string, line: number | null): void => {
    if (!docked) commentsPanel.close();
    openFile(line === null ? path : `${path}:${line}`);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    // an open field leaves on its own Escape first
    if (event.key !== "Escape" || event.defaultPrevented || editing !== null) return;
    event.preventDefault();
    close();
  };
  // the file viewer's docked header: a glyph, the name, then the actions and Close
  const header = <header className="file-viewer-header file-viewer-header-docked comments-panel-head">
    <MessageSquareText className="file-viewer-glyph" aria-hidden="true" />
    <h2 className="file-viewer-name comments-panel-title">
      {t("Comments")}
      {count > 0 && <span className="comments-panel-count">{count}</span>}
    </h2>
    <button type="button" className="icon-button file-viewer-action file-viewer-close" aria-label={t("Close")} title={t("Close")} onClick={close}>
      <X aria-hidden="true" />
    </button>
  </header>;
  const content = <>
    {header}
    <div className="comments-panel-body">
      {count === 0
        ? <p className="comments-panel-empty">{t("No comments yet.")}</p>
        : groups.map((group) => {
          const { folder, name } = splitLabel(group.label);
          const first = group.comments[0];
          const firstLine = first !== undefined && !isReplyComment(first) && first.view === "code" ? first.lines[0] : null;
          return <section key={group.path ?? ""} className="comments-panel-group" aria-label={group.path === null ? t("Chat") : group.label}>
            {/* where the comments are: the chat, or a file (its glyph, name and folder), which opens in the review */}
            <header className="comments-panel-group-head">
              {group.path === null
                ? <span className="comments-panel-place"><MessageSquareText className="comments-panel-glyph" aria-hidden="true" /><span className="comments-panel-name">{t("Chat")}</span></span>
                : <button type="button" className="comments-panel-place" title={group.path} disabled={show === null} onClick={() => show?.(group.path!, firstLine)}>
                  <FileGlyph name={name} className="comments-panel-glyph" />
                  <span className="comments-panel-name">{name}</span>
                  {folder !== "" && <span className="comments-panel-folder" dir="ltr">{folder}</span>}
                </button>}
              <span className="comments-panel-count" aria-hidden="true">{group.comments.length}</span>
            </header>
            <ol className="comments-panel-list">
              {group.comments.map((comment) => {
                const reply = isReplyComment(comment);
                const code = !reply && comment.view === "code" && comment.quoteLines.length > 0;
                const quote = code ? "" : replyQuote(comment);
                return <li key={comment.id} className="comments-panel-card" data-comment-id={comment.id}>
                  {/* what it is on: a file's lines as code (they open the file there), else the quoted text */}
                  {code
                    ? <button type="button" className="comments-panel-code" aria-label={t("Open {file} at line {line}", { file: comment.label, line: comment.lines[0] })} disabled={show === null} onClick={() => show?.(comment.path, comment.lines[0])}>
                      <Snippet comment={comment} />
                    </button>
                    : quote.trim() !== "" && <blockquote className="comments-panel-quote"><span>{quote}</span></blockquote>}
                  {editing === comment.id
                    ? <CommentPopover placement="row" quote={{ text: "" }} comment={comment.comment}
                      onSave={(value) => { saveAt(owner, comment, value); setEditing(null); }}
                      onDelete={() => remove([comment])} onClose={() => setEditing(null)}
                      opener={() => root.current?.querySelector<HTMLElement>(`[data-comment-id="${CSS.escape(comment.id)}"] .comment-rest-text`) ?? null}
                      fallback={() => root.current ?? noFocus()} />
                    : <CommentAtRest text={comment.comment} className="comments-panel-rest" onEdit={() => setEditing(comment.id)} onDelete={() => remove([comment])}
                      editLabel={t("Edit comment: {comment}", { comment: comment.comment })} deleteLabel={t("Delete comment")} />}
                </li>;
              })}
            </ol>
          </section>;
        })}
    </div>
    {(deleted !== null || count > 0) && <footer className="comments-panel-foot">
      {deleted !== null
        ? <p className="comments-panel-undo" role="status">
          <span>{deleted.length === 1 ? t("Comment deleted.") : t("{count} comments deleted.", { count: deleted.length })}</span>
          <button type="button" className="btn btn-ghost" onClick={undo}>{t("Undo")}</button>
        </p>
        : <button type="button" className="btn btn-ghost comments-panel-clear" onClick={() => remove(comments)}>{t("Remove all comments")}</button>}
    </footer>}
  </>;

  if (docked) return (
    <aside ref={root} className="file-panel comments-panel" aria-label={t("Comments")} tabIndex={-1} onKeyDown={onKeyDown}>
      {panelStart}
      <section className="file-viewer-docked comments-panel-frame">{content}</section>
    </aside>
  );
  return (
    <div className="modal-scrim file-viewer-scrim" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <section ref={root} className="modal comments-panel comments-panel-dialog" role="dialog" aria-modal="true" aria-label={t("Comments")} tabIndex={-1} onKeyDown={onKeyDown}>
        {content}
      </section>
    </div>
  );
}
