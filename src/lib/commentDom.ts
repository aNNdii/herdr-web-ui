/**
 * The markup of the comment UI that other code queries: the popover (CommentPopover.tsx) and the comment layers
 * (CodeComments.tsx, MarkdownComments.tsx) render with these names, and everything that has to find them (the composer's
 * Send and walk, the Settings switch, a surface's clicks and focus) asks through the queries here, never with a selector
 * of its own. A
 * change to that markup is then made here once, and a query that no longer finds anything cannot hide in another file.
 *
 * The queries need only `querySelector`/`querySelectorAll`/`closest` and an element's `dataset`, so a stand-in object
 * tests them without a DOM.
 *
 * The code view's field is in a frame of its own (components/FrameField.tsx): its popover holds a slot
 * (`FIELD_SLOT_CLASS`) where the textarea would be, and the queries for a popover's field find it through that slot
 * (lib/frameField.ts `framedField`).
 */
import { fieldAnchor, framedField } from "./frameField.ts";

/** A comment popover's box, in place or as a dialog (`.modal` too, portalled to the document's body). */
export const POPOVER_CLASS = "comment-popover";
/** The scrim under a popover drawn as a dialog. */
export const POPOVER_SCRIM_CLASS = "comment-popover-scrim";
/**
 * The code view's comment layer (CodeComments.tsx): its cards, its ⊕ and the field under a line. It is a comment layer to
 * everything that asks: a press in it does not dismiss the open field (its own click decides), a click
 * in it comments on no line, and its text is no comment's text.
 */
export const CODE_COMMENTS_CLASS = "code-comments";
/**
 * The Markdown comment layer's root (MarkdownComments.tsx, preview and chat): its margin cards, counts and field. Like
 * the code view's layer it is a comment layer to everything that asks, and its text is no comment's text.
 */
export const MARKDOWN_COMMENTS_CLASS = "markdown-comments";
/** In a popover, the place of a field drawn in a frame of its own (components/FrameField.tsx). */
export const FIELD_SLOT_CLASS = "comment-field-slot";
/** On a popover's box while its text is changed (`commentChanged`). */
export const CHANGED_ATTR = "data-comment-changed";

/*
 * The chat's commentable text: each final answer part of a finished reply is a Markdown root (components/Markdown.tsx
 * `ParsedMarkdown`) carrying `COMMENT_ROOT_ATTR`, and its turn's key in `COMMENT_TURN_ATTR` (`commentRootAttrs`). The
 * chat's comment source (components/ChatComments.tsx) and lib/commentSelection.ts find them through these. Kept as
 * literals where nothing can import them, which a rename changes too: components/MarkdownComments.css
 * (`[data-touch-select] [data-comment-root]`) and scripts/block-comments-regression.ts. The surface's own attribute is
 * lib/commentHighlight.ts `COMMENT_SURFACE`.
 */
/** On a commentable Markdown root (a reply part): a selection that comments stays inside one. */
export const COMMENT_ROOT_ATTR = "data-comment-root";
/** On a commentable Markdown root: its turn's key, so the chat finds a comment's text in its own turn only. */
export const COMMENT_TURN_ATTR = "data-comment-turn";

const COMMENT_ROOT = `[${COMMENT_ROOT_ATTR}]`;

const POPOVER = `.${POPOVER_CLASS}`;
const DIALOG = `.modal${POPOVER}`;
const CHANGED = `[${CHANGED_ATTR}]`;
const SLOT = `.${FIELD_SLOT_CLASS}`;

/** The field of the popover `popover` selects in `root`: its textarea, else the one in its slot's frame. */
function fieldIn(root: Pick<ParentNode, "querySelector">, popover: string): HTMLTextAreaElement | null {
  return root.querySelector<HTMLTextAreaElement>(`${popover} textarea`) ?? framedField(root.querySelector(`${popover} ${SLOT}`));
}
/**
 * The comment layers, for a selector of what is not a comment's text (lib/commentSelection.ts). A comment layer here and in
 * `inCommentLayer` means a layer of comment UI over a surface's text: the code view's comment layer
 * (`CODE_COMMENTS_CLASS`: cards, a ⊕ and a field), or the Markdown comment layer of the preview and the chat
 * (`MARKDOWN_COMMENTS_CLASS`: margin cards, counts and the field over a selection).
 */
export const COMMENT_LAYER_SELECTOR = `.${CODE_COMMENTS_CLASS}, .${MARKDOWN_COMMENTS_CLASS}`;
/** The comment UI on a surface: its comment layer (which holds the field) and a popover anywhere. */
export const COMMENT_UI_SELECTOR = `${COMMENT_LAYER_SELECTOR}, ${POPOVER}`;

/** The attributes of a popover's box that say whether its text is changed. */
export function changedAttrs(changed: boolean): Record<typeof CHANGED_ATTR, "" | undefined> {
  return { [CHANGED_ATTR]: changed ? "" : undefined };
}

/** The attributes of a Markdown root: commentable in the turn `turn` (its key), or none (null: not a reply part). */
export function commentRootAttrs(turn: string | null): Record<typeof COMMENT_ROOT_ATTR | typeof COMMENT_TURN_ATTR, string | undefined> {
  return { [COMMENT_ROOT_ATTR]: turn === null ? undefined : "", [COMMENT_TURN_ATTR]: turn ?? undefined };
}

/** The commentable Markdown roots in `scope`, in document order. */
export function commentRootsIn(scope: Pick<ParentNode, "querySelectorAll">): Element[] {
  return [...scope.querySelectorAll(COMMENT_ROOT)];
}

function elementOf(target: EventTarget | null): Element | null {
  if (typeof Element !== "undefined" && target instanceof Element) return target;
  return typeof Node !== "undefined" && target instanceof Node ? target.parentElement : null;
}

/** The commentable Markdown root `node` lies in (itself included), else null. */
export function commentRootOf(node: Node | null): Element | null {
  return elementOf(node)?.closest(COMMENT_ROOT) ?? null;
}

/** Whether `target` lies in the comment UI: a popover (in place or a dialog) or a comment layer. */
export function isCommentUi(target: EventTarget | null): boolean {
  return elementOf(target)?.closest(COMMENT_UI_SELECTOR) != null;
}

/** Whether `target` lies in a surface's comment layer (the code view's cards, ⊕ and field; the Markdown layer's cards, counts and field). */
export function inCommentLayer(target: EventTarget | null): boolean {
  return elementOf(target)?.closest(COMMENT_LAYER_SELECTOR) != null;
}

/** Whether `target` lies in a popover whose text is unchanged: an Escape there closes it. */
export function inUnchangedPopover(target: EventTarget | null): boolean {
  return elementOf(target)?.closest(`${POPOVER}:not(${CHANGED})`) != null;
}

/** Whether `element` lies in a comment popover. */
export function inPopover(element: Element): boolean {
  return element.closest(POPOVER) !== null;
}

/** Whether a comment popover is drawn as a dialog anywhere in `root` (its scrim is up). */
export function hasCommentDialog(root: Pick<ParentNode, "querySelector">): boolean {
  return root.querySelector(`.${POPOVER_SCRIM_CLASS}`) !== null;
}

/**
 * The field of a comment popover in `scope` (a pane's stack, a surface) whose text is changed (`commentChanged`), else
 * of one drawn as a dialog anywhere in `scope`'s document (a phone's sheet; a comment the file viewer opened on another
 * file): a dialog is modal, so it is the one being written in, wherever it came from. Null for none: a message sent or
 * a walk taken then loses nothing.
 */
export function changedField(scope: Element | null): HTMLTextAreaElement | null {
  if (scope === null) return null;
  return fieldIn(scope, `${POPOVER}${CHANGED}`) ?? fieldIn(scope.ownerDocument, `${DIALOG}${CHANGED}`);
}

/**
 * Whether a comment popover anywhere in `root` (the document: in place in any pane, the chat's or the file
 * viewer's, or drawn as a dialog) is changed. Turning comments off would lose it, so Settings asks first.
 */
export function hasChangedComment(root: Pick<ParentNode, "querySelector">): boolean {
  return root.querySelector(`${POPOVER}${CHANGED} textarea`) !== null || root.querySelector(`${POPOVER}${CHANGED} ${SLOT}`) !== null;
}

/**
 * Gives the open popover's field in `scope` (a comment surface), else of one drawn as a dialog in its document, the
 * focus: it puts the user back where the text is.
 */
export function focusOpenField(scope: Element | null): void {
  if (scope === null) return;
  const field = fieldIn(scope, POPOVER) ?? fieldIn(scope.ownerDocument, DIALOG);
  field?.focus({ preventScroll: true });
}

/** Focuses a popover's `field` and brings its popover (the one its frame's slot is in) into view: a send or a walk held back for it shows it. */
export function revealField(field: HTMLTextAreaElement): void {
  field.focus({ preventScroll: true });
  fieldAnchor(field).closest(POPOVER)?.scrollIntoView({ block: "nearest" });
}
