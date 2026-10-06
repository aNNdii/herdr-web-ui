/**
 * The modal editor for one block comment, where the chat has no place for its inline form
 * (CommentCard.tsx): the composer's walk to a comment whose part is not in the chat, the
 * composer's own editor, and a form whose part left the chat while it was open. What the comment
 * is on shows on top, the comment below: the selected text as plain quoted text, or for a comment
 * on a whole block the block, without controls. Saving a blank comment deletes it, so Delete is
 * `onSave("")`; Save with the text unchanged only closes, so a comment sent while its editor was
 * open does not come back. Escape and the scrim cancel; Tab stays inside; the focus goes back to
 * what opened it. The field and the keys are the inline form's too (`useCommentDraft`).
 */
import { useId } from "react";
import { createPortal } from "react-dom";

import "./CommentEditor.css";

import { blockContent } from "../lib/blockComments.ts";
import { useT } from "../lib/i18n.ts";
import type { MarkdownBlock } from "../lib/markdown.ts";
import { CommentField, useCommentDraft } from "./CommentDraft.tsx";
import { MarkdownBlocks } from "./Markdown.tsx";
import { RenderBoundary } from "./RenderBoundary.tsx";

export interface CommentEditorProps {
  block: MarkdownBlock;
  /** the selected text a selection comment is on; without it the block shows */
  quote?: string;
  /** "" when creating; otherwise the modal also offers Delete */
  initialComment: string;
  /** "" deletes */
  onSave: (comment: string) => void;
  onClose: () => void;
  /** where the focus goes when its opener is gone: the composer of the pane it is in, found while it is mounted */
  fallback: () => HTMLElement | null;
  /** the text the field starts with, when it is not `initialComment`: what was typed in the inline form this takes over from */
  startValue?: string;
}

/** The modal editor for one block comment, portalled to `document.body` (see the file comment). */
export function CommentEditor({ block, quote, initialComment, onSave, onClose, fallback, startValue }: CommentEditorProps) {
  const t = useT();
  const id = useId();
  const draft = useCommentDraft(initialComment, onSave, onClose, { fallback, startValue });

  return createPortal(
    <div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={draft.surface} className="modal comment-editor" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} onKeyDown={draft.onKeyDown}>
        <header className="modal-header"><h2 className="modal-title" id={`${id}-title`}>{t("Comment")}</h2></header>
        <div className="modal-body">
          {/* a stored block comes from localStorage, maybe from another version: one it cannot draw
              shows as text, and the comment stays editable (this editor has no boundary above it) */}
          <div className="comment-editor-block">
            {quote !== undefined
              ? <p className="comment-editor-plain">{quote}</p>
              : <RenderBoundary resetKey={block} fallback={() => <p className="comment-editor-plain">{blockContent(block)}</p>}>
                <MarkdownBlocks blocks={[block]} quoted />
              </RenderBoundary>}
          </div>
          <CommentField draft={draft} />
        </div>
        <footer className="modal-footer">
          {initialComment !== "" && <button type="button" className="btn btn-ghost comment-editor-delete" onClick={() => onSave("")}>{t("Delete")}</button>}
          <button type="button" className="btn" onClick={onClose}>{t("Cancel")}</button>
          <button type="button" className="btn btn-primary" onClick={draft.save}>{t("Save")}</button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
