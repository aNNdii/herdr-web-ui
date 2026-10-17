/**
 * A saved comment at rest, drawn as its open field is (CommentPopover's row): the same box, padding, face and buttons
 * in the same places, so opening it to edit changes no size. Only the edge takes the accent and the pencil becomes ↑.
 * The Review's annotation rows and the comments panel show their comments with it (CommentAtRest.css).
 */
import type { ReactElement } from "react";
import { Pencil, Trash2 } from "lucide-react";

import "./CommentAtRest.css";

export interface CommentAtRestProps {
  text: string;
  /** opens it to edit; absent, it is read only (no buttons) */
  onEdit?: () => void;
  onDelete?: () => void;
  /** the text button's accessible name, and Delete's */
  editLabel?: string;
  deleteLabel?: string;
  className?: string;
  /** the comment's id, for a caller that finds its text again (the focus back after an edit) */
  commentId?: string;
}

export function CommentAtRest({ text, onEdit, onDelete, editLabel, deleteLabel, className, commentId }: CommentAtRestProps): ReactElement {
  return <div className={className === undefined ? "comment-rest" : `comment-rest ${className}`} data-comment-id={commentId}>
    {onEdit === undefined
      ? <div className="comment-rest-text">{text}</div>
      : <button type="button" className="comment-rest-text" aria-label={editLabel} onClick={onEdit}>{text}</button>}
    {onDelete !== undefined && <button type="button" className="icon-button comment-rest-delete" aria-label={deleteLabel} title={deleteLabel} onClick={onDelete}>
      <Trash2 aria-hidden="true" />
    </button>}
    {/* where ↑ is while it is written: the text opens it too, so the pencil is for the pointer only */}
    {onEdit !== undefined && <button type="button" className="icon-button comment-rest-edit" aria-hidden="true" tabIndex={-1} onClick={onEdit}>
      <Pencil aria-hidden="true" />
    </button>}
  </div>;
}
