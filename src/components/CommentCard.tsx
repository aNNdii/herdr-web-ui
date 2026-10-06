/**
 * A block comment in the chat, as an inline card under the part where its selection ends, and the
 * inline form that writes or edits one in the same place (Markdown.tsx puts both in a part's
 * `.block-comment-notes`). The card has no author: a "Pending" badge, as the comment goes with the
 * next message, an Edit and a Delete button, and the comment in full; the text it is on is the
 * highlight, not repeated in the card. The form is a card of the same frame holding the field,
 * with Cancel and Save, as one surface like the message box (BlockComments.css); the text it is on
 * also stays highlighted in the reply (lib/commentHighlight.ts). It is in the chat's flow, not over
 * it, so the chat stays usable: Cancel gives up, and so does Escape from inside it while nothing was
 * typed (what was typed is kept: `commentTyped`), Save and Cmd/Ctrl+Enter save, a blank comment
 * deletes (`useCommentDraft`), and a press outside does not close it.
 */
import { createContext, useEffect, useLayoutEffect, useRef, type FocusEvent, type PointerEvent } from "react";
import { Check, Pencil, Trash2 } from "lucide-react";

import "./BlockComments.css";

import { quoteExcerpt, type BlockComment, type CommentTarget } from "../lib/blockComments.ts";
import { activateComment } from "../lib/commentHighlight.ts";
import { firstEditButton, focusAfter, paneComposer, restoreFocusTarget } from "../lib/commentSelection.ts";
import { useT } from "../lib/i18n.ts";
import { isMacPlatform } from "../lib/shortcuts.ts";
import { CommentField, useCommentDraft } from "./CommentDraft.tsx";

/**
 * The chat's one open comment form, which the part it belongs to draws (`formPlace`): provided by
 * ChatView, null while none is open or while the modal editor stands in for it.
 */
export interface CommentEdit {
  /** one per opening: another comment opened is another form */
  id: number;
  owner: string;
  target: CommentTarget;
  /** "" for a new comment */
  initialComment: string;
  /** what the field holds now, for a form drawn again (its part re-rendered elsewhere) to start with */
  draft: () => string;
  /** told the field's text as it changes */
  text: (value: string) => void;
  /** "" deletes */
  save: (comment: string) => void;
  close: () => void;
  /** the form is drawn: told on mount, and on unmount (returned), so the chat can fall back to the modal when none is */
  attach: (id: number) => () => void;
}

export const CommentEditContext = createContext<CommentEdit | null>(null);

// a card the pointer is over or the keyboard's focus is in brings its comment's text up
// (lib/commentHighlight.ts). Not a focus a click left, or one handed back after the form closed
// from a click: the text would stay up after the pointer has gone. Not a finger either: a touch enters a card for every tap
// and every scroll that starts on it, and the whole chat's marks would fade and come back each time
const pointerOn = (event: PointerEvent<HTMLElement>): void => {
  if (event.pointerType !== "touch") activateComment(event.currentTarget, "pointer", true);
};
const pointerOff = (event: PointerEvent<HTMLElement>): void => activateComment(event.currentTarget, "pointer", false);
const focusOn = (event: FocusEvent<HTMLElement>): void => {
  if (event.target instanceof Element && event.target.matches(":focus-visible")) activateComment(event.currentTarget, "focus", true);
};
const focusOff = (event: FocusEvent<HTMLElement>): void => {
  // moving between the card's own buttons is still being in it
  if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) activateComment(event.currentTarget, "focus", false);
};

export interface CommentCardProps {
  comment: BlockComment;
  /** the anchors of every card of the host, in order: after a delete the focus goes to a neighbour's */
  anchors: readonly string[];
  onEdit: () => void;
  onDelete: () => void;
}

/** One saved comment: a group, not a button, with the Edit and Delete buttons in its header. */
export function CommentCard({ comment, anchors, onEdit, onDelete }: CommentCardProps) {
  const t = useT();
  const card = useRef<HTMLDivElement>(null);
  // a card swapped for the form (Edit) or deleted gets no pointerleave or blur, and nothing in the store changes when the
  // form is then cancelled: release what it held while it is still in the document, or its text stays up (React runs a
  // layout cleanup before it removes the elements)
  useLayoutEffect(() => {
    const node = card.current;
    return () => {
      if (node === null) return;
      activateComment(node, "pointer", false);
      activateComment(node, "focus", false);
    };
  }, []);
  // a selection's excerpt is in the name; a comment on a whole part has no excerpt, only its own text below
  const label = comment.quote === undefined ? t("Comment") : t("Comment on “{quote}”: {comment}", { quote: quoteExcerpt(comment.quote), comment: comment.comment });
  return (
    <div
      ref={card} className="block-comment-card" role="group" aria-label={label}
      // focusable by script only: the composer's walk puts the focus on the card it stands on, so it is read
      tabIndex={-1} data-comment-id={comment.id} data-comment-anchor={comment.anchor}
      onPointerEnter={pointerOn} onPointerLeave={pointerOff} onFocus={focusOn} onBlur={focusOff}
    >
      <div className="block-comment-head">
        <span className="badge block-comment-badge" title={t("Goes with your next message")}>{t("Pending")}</span>
        <button type="button" className="icon-button block-comment-action block-comment-edit" aria-label={t("Edit comment")} title={t("Edit comment")} onClick={onEdit}>
          <Pencil aria-hidden="true" />
        </button>
        <button
          type="button" className="icon-button block-comment-action" aria-label={t("Delete comment")} title={t("Delete comment")}
          onClick={(event) => {
            // gone at once, no question: the composer's bar undoes a removal, a comment is cheap to write again.
            // The focus goes to the next card's Edit button, else the previous one's, else the pane's composer
            // (not on a touch screen: that would raise the keyboard unasked)
            const view = event.currentTarget.closest(".chat-view");
            const near = focusAfter(anchors, comment.anchor);
            onDelete();
            queueMicrotask(() => restoreFocusTarget(firstEditButton(view, near), paneComposer(view), true, window.matchMedia("(pointer: coarse)").matches)?.focus({ preventScroll: true }));
          }}
        >
          <Trash2 aria-hidden="true" />
        </button>
      </div>
      <div className="block-comment-text">{comment.comment}</div>
    </div>
  );
}

export interface CommentFormProps {
  edit: CommentEdit;
  /** the comment this edits, whose card it takes the place of; null for a new comment */
  replaces: BlockComment | null;
  /** the anchors of every card of the host, in order: closing the form of a deleted comment gives the focus to a neighbour */
  anchors: readonly string[];
}

/** The form for a new comment or an edit: one input surface, the field with Cancel and Save inside it. */
export function CommentForm({ edit, replaces, anchors }: CommentFormProps) {
  const t = useT();
  const near = replaces === null ? [] : [replaces.anchor, ...focusAfter(anchors, replaces.anchor)];
  // asked after the commit that closes the form: the card it edited is drawn again then, or is gone with a blank save
  const nearRef = useRef(near);
  nearRef.current = near;
  const draft = useCommentDraft(edit.initialComment, edit.save, edit.close, {
    opener: replaces === null ? null : (scope) => firstEditButton(scope, nearRef.current),
    fallback: paneComposer,
    inline: true,
    startValue: edit.draft(),
    onText: edit.text,
  });
  const saveTitle = `${t("Save")} (${isMacPlatform() ? "⌘↵" : "Ctrl+Enter"})`;
  const { attach, id } = edit;
  useLayoutEffect(() => attach(id), [attach, id]);
  // brought into view as it opens, after the field took the focus: the least scrolling that shows it
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => draft.surface.current?.scrollIntoView({ block: "nearest" }));
    return () => window.cancelAnimationFrame(frame);
  }, [draft.surface]);
  return (
    <div
      ref={draft.surface} className="block-comment-card is-editing" role="group" aria-label={t("Comment")} onKeyDown={draft.onKeyDown}
      // an edit stands for its card: the composer's walk counts it, and takes it for the note it stands on
      tabIndex={replaces === null ? undefined : -1} data-comment-id={replaces?.id} data-comment-anchor={replaces?.anchor}
    >
      <CommentField draft={draft} />
      <div className="block-comment-actions">
        <button type="button" className="btn btn-ghost" onClick={edit.close}>{t("Cancel")}</button>
        <button type="button" className="block-comment-save" aria-label={t("Save")} title={saveTitle} disabled={!draft.canSave} onClick={draft.save}>
          <Check aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
