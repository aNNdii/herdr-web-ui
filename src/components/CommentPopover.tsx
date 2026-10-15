/**
 * The open comment of a comment surface (useCommentPopover.ts): in place beside or under the text it is on (`placement`
 * "row", drawn by its caller, no portal: the code view's field under a line, the Markdown comment layer's field over a
 * selection, a card in edit and the fields behind a count), or as a dialog of its own, centred and a bottom sheet on a
 * phone (`placement` "dialog", portalled here). Every comment
 * opens to be edited, as in Claude: a saved one straight into its field, filled with its text, a
 * new one into an empty field. Top to bottom: the file and lines a comment on a file is on, and why
 * it is shown here, with the quote (at most about five lines), and beside them at the right ✕ (a
 * dialog's and a sheet's only: in place there is none). A sheet has no visible heading: its quote (`sheetQuote`, the
 * text the comment is on, plain, never a line number) says what it is on, and its `label` names the dialog to assistive
 * tech. In place there is no quote, new
 * or saved (the highlighted text beside it shows it): the card is the input box (a file comment's
 * file and lines are said to assistive tech only). Then the field, bare in the card, and a row under it with a saved
 * comment's Delete at the left and the ↑ save button at the right (`useCommentDraft`).
 *
 * Leaving it keeps what was typed (`leaveOutcome`): Escape, a press outside it (in place) or on the scrim (a
 * dialog) and ✕ (where there is one) save a change (an emptied edit deletes the comment), and close it while its text
 * is unchanged or a new one holds only blanks. Such a press does nothing else: its click opens no comment where it
 * lands (`markDismissingPress`), but a press in the comment layer (a card, a count, the ⊕) is its own: that one opens in
 * its place (`show`, which saves this one first). Enter saves, Shift+Enter is a line break. Delete is
 * immediate, without an undo. The field takes the focus as it opens, its caret at the end, but for
 * a saved comment on a touch screen (`popoverFocusesField`): there the box does, and no keyboard
 * rises until the field is tapped. On close the focus goes back to the `opener` (its card, found
 * again after the commit), else to the `fallback` (the pane's composer), not on a touch screen:
 * `restoreFocusTarget`. A dialog keeps Tab inside (`useFocusTrap`).
 *
 * Two more placements: `row` is laid out in place, full
 * width under its code line (the code view's CodeCommentLayer), or as the Markdown layer's field (a card of the margin
 * or the field over a selection): the field and the actions side by side, no shadow. `sheet` is the `dialog` as a bottom sheet at any width: under the grip the commented text
 * (`sheetQuote`, a blockquote of three lines at most, no line number), its own input, and text-only actions, Delete
 * (`btn btn-ghost`, saved comments only) at the left and Save (`btn btn-primary`) at the right. There (`framed`) the field
 * is drawn in a frame of its own (FrameField.tsx): iOS focuses it without first working over the viewer's long document.
 * The Markdown comment layer's sheet (MarkdownCommentSheet.tsx) adds `paging` (‹ › and "1 of 2" left of ✕, through a
 * count's comments, the draft started again for each: `resetKey`) and `readOnly` (the comment as text, no input and no
 * actions: the comment mode off).
 */
import { useCallback, useContext, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MutableRefObject, type ReactNode, type ReactElement, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ArrowUp, ChevronLeft, ChevronRight, Trash2, X } from "lucide-react";

import "./CommentPopover.css";

import { blockContent } from "../lib/blockComments.ts";
import { markDismissingPress } from "../lib/commentClick.ts";
import { changedAttrs, inCommentLayer, POPOVER_CLASS, POPOVER_SCRIM_CLASS } from "../lib/commentDom.ts";
import { popoverFocusesField } from "../lib/commentPopover.ts";
import { useT } from "../lib/i18n.ts";
import type { MarkdownBlock } from "../lib/markdown.ts";
import { useFocusTrap } from "../lib/useFocusTrap.ts";
import { CommentField, inAnotherDialog, useCommentDraft } from "./CommentDraft.tsx";
import { FileReferenceLabel, type FileReference } from "./FileReference.tsx";
import { FieldFrameContext, FrameField } from "./FrameField.tsx";
import { MarkdownBlocks } from "./Markdown.tsx";
import { RenderBoundary } from "./RenderBoundary.tsx";

/**
 * Where a comment popover is drawn: as a dialog of its own ("dialog": centred; a sheet on a phone), in place ("row":
 * under a code line, over a selection, as a card of the margin) or as "sheet", a bottom sheet at any width. The code view's
 * layer (CodeComments.tsx) and the Markdown comment layer (MarkdownComments.tsx) draw the last two.
 */
export type PopoverPlacement = "dialog" | "row" | "sheet";

export interface CommentPopoverProps {
  placement: PopoverPlacement;
  /** what a dialog quotes: the text the comment is on, or (a whole-block comment from before selections) its block, drawn as Markdown */
  quote: { text: string } | { block: MarkdownBlock };
  /** a `sheet`'s quote of what the comment is on (`lineQuote`): plain text, drawn as a blockquote clamped to three lines; a sheet draws this and not `quote`, and none where it is empty */
  sheetQuote?: string;
  reference?: FileReference;
  /** the dialog's accessible name where it has no visible title (a sheet's); the file reference then stays for assistive tech only */
  label?: string;
  /** why it is shown here (an outdated file comment) */
  note?: string;
  /** the saved comment; "" for a new one */
  comment: string;
  /** the field's text when it is not `comment`: what was typed before a redraw */
  startValue?: string;
  onText?: (value: string) => void;
  onSave: (text: string) => void;
  /** a saved comment's Delete; a new one has none */
  onDelete: () => void;
  onClose: () => void;
  /** where the focus goes back to: the card, found again after the commit */
  opener: (scope: Element | null) => HTMLElement | null;
  /** where it goes when the opener is gone: the pane's composer, or null */
  fallback: (scope: Element | null) => HTMLElement | null;
  /** the code view's `row` and `sheet`: the field in a frame of its own (FrameField.tsx; a row needs its layer's frame) */
  framed?: boolean;
  /**
   * False: it takes no focus as it opens (the field over a selection, MarkdownComments.tsx, whose first printable key
   * moves the focus into it: `useCommentDraft`'s `focusOnOpen`). Default true
   */
  focusOnOpen?: boolean;
  /** a `sheet` paging through several comments (`index` from 1): ‹ › and "{index} of {count}" left of ✕; ‹ and › do not wrap */
  paging?: { index: number; count: number; onPrevious(): void; onNext(): void };
  /** a `sheet`'s comment shown as text, with no input and no actions (the comment mode off) */
  readOnly?: boolean;
  /** another value starts the field again from `startValue` or `comment` (`useCommentDraft`): a sheet paged to another comment */
  resetKey?: string | number;
}

interface FrameProps {
  placement: PopoverPlacement;
  surface: RefObject<HTMLDivElement | null>;
  /** the dialog's accessible name; without one it is named "Comment" */
  label: string | undefined;
  /** the box takes the focus itself (a saved comment opened on a touch screen: its field does not) */
  focusable: boolean;
  /** its text is changed (`commentChanged`): the composer's Send comes here first (`data-comment-changed`) */
  changed: boolean;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  /** a press outside it, in place, or on a dialog's scrim: leaves it (`useCommentDraft`'s `leave`), which ends it */
  dismiss: () => void;
  children: ReactNode;
}

const FRAME_CLASS: Record<PopoverPlacement, string> = {
  row: `${POPOVER_CLASS} is-card is-row`,
  dialog: `modal ${POPOVER_CLASS} is-dialog`,
  sheet: `modal ${POPOVER_CLASS} is-sheet`,
};

/** Drawn in place beside the text it is on, in the page's flow: a press outside it dismisses it, and it has no ✕, quote or Top row. */
function besideText(placement: PopoverPlacement): boolean {
  return placement === "row";
}

/**
 * The box of the popover. A `row`, drawn in place by its caller, lies in the surface's scrolling content, and a press
 * anywhere outside it but in the comment layer (whose own click decides, through `show`) is a `dismiss`. As a dialog it is the shared modal primitive,
 * a bottom sheet at phone width with a grip (a `sheet`: at any width, `is-sheet`), and a press
 * on the scrim is a `dismiss`; it is the topmost focus trap then (`useFocusTrap`), so a dialog it
 * lies over (the file viewer) does not pull Tab out of it. Where the focus goes as it closes is
 * the popover's own to say (`restoreFocusTarget`), not the trap's.
 */
function Frame({ placement, surface, label, focusable, changed, onKeyDown, dismiss, children }: FrameProps): ReactElement {
  const t = useT();
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;
  const dialog = placement === "dialog" || placement === "sheet";
  const trap = useFocusTrap<HTMLDivElement>(dialog, { shouldRestore: () => false });
  const setBox = useCallback((node: HTMLDivElement | null): void => {
    (surface as MutableRefObject<HTMLDivElement | null>).current = node;
    trap.current = node;
  }, [surface, trap]);
  useEffect(() => {
    if (!besideText(placement)) return;
    // a press in the box is not outside it, nor is a press in a modal dialog that lies over the surface (Settings, a question, the file viewer): that one's own
    const outside = (event: Event): boolean => {
      const target = event.target;
      if (!(target instanceof Node) || (surface.current?.contains(target) ?? false) || inAnotherDialog(target, surface.current)) return false;
      return !inCommentLayer(target);
    };
    // a press outside it only leaves it (saved, or closed with nothing to keep). Its click opens nothing else, no
    // comment on the line under it (`markDismissingPress`). A press in the comment layer
    // is not one: that card's comment opens in its place (`show`, which saves this one first)
    const onPointer = (event: PointerEvent): void => {
      if (!outside(event)) return;
      markDismissingPress(event);
      dismissRef.current();
    };
    document.addEventListener("pointerdown", onPointer, true);
    return () => document.removeEventListener("pointerdown", onPointer, true);
  }, [placement, surface]);

  const box = (
    <div
      ref={setBox}
      className={FRAME_CLASS[placement]}
      role="dialog"
      aria-modal={dialog ? true : undefined}
      aria-label={label ?? t("Comment")}
      tabIndex={focusable ? -1 : undefined}
      {...changedAttrs(changed)}
      onKeyDown={onKeyDown}
    >
      {dialog && <span className="comment-popover-grip" aria-hidden="true" />}
      {children}
    </div>
  );
  if (!dialog) return box;
  // a portal's events still bubble through the React tree: a click on the scrim or in the dialog would reach the React
  // handlers of the surface it was opened from (ChatView, FileViewer), as if it landed there. Not `.modal-scrim` in
  // COMMENT_CLICK_IGNORED: the file viewer itself lies in one. A press on the scrim leaves the dialog
  return createPortal(
    <div className={`modal-scrim ${POPOVER_SCRIM_CLASS}`} onMouseDown={(event) => { if (event.target === event.currentTarget) dismissRef.current(); }} onClick={(event) => event.stopPropagation()}>{box}</div>,
    document.body,
  );
}

/**
 * The popover's top row: what the comment is on (the file and lines with why it is shown here, then the `quote`,
 * scrolling past about five lines; none where the highlighted text beside it already shows it), and its `actions`
 * (a dialog's ✕) at the right, level with the first line. A dialog with a `label` (a sheet) shows no reference: the
 * quote says what it is on, and the reference stays for assistive tech.
 */
function Top({ quote, sheetQuote, reference, label, note, actions }: Pick<CommentPopoverProps, "reference" | "label" | "note" | "sheetQuote"> & {
  quote: CommentPopoverProps["quote"] | null;
  actions: ReactNode | null;
}): ReactElement {
  return <div className="comment-popover-top">
    <div className="comment-popover-context">
      {reference !== undefined && <p className={label === undefined ? "comment-popover-reference" : "comment-popover-reference visually-hidden"}><FileReferenceLabel reference={reference} /></p>}
      {note !== undefined && <p className="comment-popover-note">{note}</p>}
      {quote !== null && <Quote quote={quote} reference={reference} />}
      {sheetQuote !== undefined && sheetQuote !== "" && <p className="comment-sheet-quote">{sheetQuote}</p>}
    </div>
    {actions !== null && <div className="comment-popover-actions">{actions}</div>}
  </div>;
}

function Quote({ quote, reference }: Pick<CommentPopoverProps, "quote" | "reference">): ReactElement {
  return <>
    <div className="comment-popover-quote">
      {"text" in quote
        ? reference !== undefined ? <pre className="comment-popover-plain">{quote.text}</pre> : <p className="comment-popover-plain">{quote.text}</p>
        // a stored block comes from localStorage, maybe from another version: one that cannot be drawn shows as text
        : <RenderBoundary resetKey={quote.block} fallback={() => <p className="comment-popover-plain">{blockContent(quote.block)}</p>}>
          <MarkdownBlocks blocks={[quote.block]} quoted />
        </RenderBoundary>}
    </div>
  </>;
}

/**
 * The popover of one opening: a new comment, or a saved one, to edit. A caller keys it by the opening
 * (`OpenComment.id`), so another comment opened is another popover.
 */
export function CommentPopover({ placement, quote, sheetQuote, reference, label, note, comment, startValue, onText, onSave, onDelete, onClose, opener, fallback, framed = false, focusOnOpen = true, paging, readOnly = false, resetKey }: CommentPopoverProps): ReactElement {
  const t = useT();
  const rowFrame = useContext(FieldFrameContext);
  const inFrame = framed && (placement === "sheet" || (placement === "row" && rowFrame !== null));
  const saved = comment !== "";
  const inline = besideText(placement);
  const sheet = placement === "sheet";
  // decided as it opens: a saved comment tapped open on a touch screen raises no keyboard (`popoverFocusesField`)
  // read-only, its box takes the focus: there is no field
  const [focusField] = useState(() => !readOnly && popoverFocusesField(saved, window.matchMedia("(pointer: coarse)").matches));
  const draft = useCommentDraft(comment, onSave, onClose, { opener, fallback, inline, focusField, focusOnOpen, startValue, onText, resetKey });
  // Enter in the field saves (`submitKey`), with or without Cmd/Ctrl
  const saveTitle = `${t("Save comment")} (↵)`;
  // in place there is no ✕, as in Claude: Escape and a press outside leave it. A dialog, and a phone's sheet,
  // keep ✕, the one visible way out where a keyboard covers the page; it leaves it the same way (saving a change)
  // in place the card is the input box alone, new or saved: what it is on is
  // the highlighted text beside it. A dialog and a sheet, with that text out of view or under them, quote it
  const quoted = inline || sheet ? null : quote;
  const close = <button type="button" className="icon-button comment-popover-action" aria-label={t("Close")} title={t("Close")} onClick={draft.leave}>
    <X aria-hidden="true" />
  </button>;
  // a sheet's paging shares the top line with ✕, left of it
  const pages = sheet && paging !== undefined && paging.count > 1 ? <>
    <button type="button" className="icon-button comment-popover-action" aria-label={t("Previous comment")} title={t("Previous comment")}
      disabled={paging.index <= 1} onClick={paging.onPrevious}>
      <ChevronLeft aria-hidden="true" />
    </button>
    <span className="comment-sheet-page">{t("{index} of {count}", { index: paging.index, count: paging.count })}</span>
    <button type="button" className="icon-button comment-popover-action" aria-label={t("Next comment")} title={t("Next comment")}
      disabled={paging.index >= paging.count} onClick={paging.onNext}>
      <ChevronRight aria-hidden="true" />
    </button>
  </> : null;
  const actions = inline ? null : <>{pages}{close}</>;
  return <Frame placement={placement} surface={draft.surface} label={inline ? undefined : label} focusable={!focusField} changed={draft.changed} onKeyDown={draft.onKeyDown} dismiss={draft.leave}>
    {/* in place the card is the field alone: a file comment's file and lines are no matter while it is written (the
        highlighted text stands beside it), so they are only said to assistive tech; a dialog and a sheet show them over the quote */}
    {inline
      ? reference !== undefined && <p className="comment-popover-reference visually-hidden"><FileReferenceLabel reference={reference} /></p>
      : <Top quote={quoted} sheetQuote={sheet ? sheetQuote : undefined} reference={reference} label={label} note={note} actions={actions} />}
    {sheet && readOnly ? <p className="comment-sheet-text">{comment}</p> : <div className="comment-popover-edit">
      {inFrame
        ? <FrameField draft={draft} placement={placement === "row" ? "row" : "sheet"} />
        : <CommentField draft={draft} />}
      <div className="comment-popover-edit-footer">
        {/* always in view, never behind a menu: immediate */}
        {sheet
          // a sheet's actions are words, no icon: Delete quiet at the left, Save the one primary at the right
          ? <>
            {saved && <button type="button" className="btn btn-ghost comment-sheet-delete" onClick={onDelete}>{t("Delete")}</button>}
            <button type="button" className="btn btn-primary" title={saveTitle} disabled={!draft.canSave} onClick={draft.save}>{t("Save")}</button>
          </>
          : <>
            {saved && <button type="button" className="icon-button comment-popover-delete" aria-label={t("Delete comment")} title={t("Delete comment")} onClick={onDelete}>
              <Trash2 aria-hidden="true" />
            </button>}
            <button type="button" className="comment-popover-save" aria-label={t("Save comment")} title={saveTitle} disabled={!draft.canSave} onClick={draft.save}>
              <ArrowUp aria-hidden="true" />
            </button>
          </>}
      </div>
    </div>}
  </Frame>;
}
