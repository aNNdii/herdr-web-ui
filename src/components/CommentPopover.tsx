/**
 * The open comment of a comment surface (useCommentPopover.ts): beside its pin (`placement`
 * "popover", drawn in place by CommentPins.tsx inside the scrolling content), or as a dialog of its
 * own, centred and a bottom sheet on a phone (`placement` "dialog", portalled here). Every comment
 * opens to be edited, as in Claude: a saved one straight into its field, filled with its text, a
 * new one into an empty field. Top to bottom: the file and lines a comment on a file is on, and why
 * it is shown here, with the quote (at most about five lines), and beside them at the right ✕ (a
 * dialog's and a sheet's only: beside its pin there is none). A sheet has no visible heading: the quote of its line
 * (its number, its text in the viewer's own colours) says what it is on, and its `label` names the dialog to assistive tech. Beside its pin there is no quote, new
 * or saved (the highlighted text beside it shows it): the card is the input box (a file comment's
 * file and lines are said to assistive tech only). Then the field, bare in the card, and a row under it with a saved
 * comment's Delete at the left and the ↑ save button at the right (`useCommentDraft`).
 *
 * Nothing typed is ever lost: Escape, a press outside it (beside its pin) or on the scrim (a
 * dialog) and ✕ (where there is one) close it only while its text is unchanged; otherwise each
 * puts the focus back in the field. Such a press does nothing else: its click opens no comment where it
 * lands (`markDismissingPress`; a drag it starts opens its selection's), but a press on another pin opens that pin's comment. Cmd/Ctrl+Enter saves, Enter is a line break. Delete is
 * immediate, without an undo. The field takes the focus as it opens, its caret at the end, but for
 * a saved comment on a touch screen (`popoverFocusesField`): there the box does, and no keyboard
 * rises until the field is tapped. On close the focus goes back to the `opener` (its pin, found
 * again after the commit), else to the `fallback` (the pane's composer), not on a touch screen:
 * `restoreFocusTarget`. A dialog keeps Tab inside (`useFocusTrap`).
 *
 * Two more placements serve the file viewer's code view (CodeCommentLayer): `row` is the `popover` laid out in place, full
 * width under its code line (the caller draws it, no portal): the field and the actions side by side, no shadow, and it
 * behaves as `popover` does. `sheet` is the `dialog` as a bottom sheet at any width: the quote of the line (`{ code }`)
 * and a Save that says so. There (`framed`) the field is drawn in a frame of its own (FrameField.tsx): iOS focuses it
 * without first working over the viewer's long document.
 */
import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MutableRefObject, type ReactNode, type ReactElement, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ArrowUp, Trash2, X } from "lucide-react";

import "./CommentPopover.css";

import { blockContent } from "../lib/blockComments.ts";
import { markDismissingPress } from "../lib/commentClick.ts";
import { changedAttrs, inPinLayer, POPOVER_CLASS, POPOVER_SCRIM_CLASS } from "../lib/commentDom.ts";
import { popoverFocusesField } from "../lib/commentPopover.ts";
import { useT } from "../lib/i18n.ts";
import type { MarkdownBlock } from "../lib/markdown.ts";
import { isMacPlatform } from "../lib/shortcuts.ts";
import { useFocusTrap } from "../lib/useFocusTrap.ts";
import { CommentField, inAnotherDialog, useCommentDraft } from "./CommentDraft.tsx";
import { FileReferenceLabel, type FileReference } from "./FileReference.tsx";
import { FieldFrameContext, FrameField } from "./FrameField.tsx";
import { MarkdownBlocks } from "./Markdown.tsx";
import { RenderBoundary } from "./RenderBoundary.tsx";

/**
 * Where a comment popover is drawn: next to its pin ("popover"), or as a dialog of its own ("dialog": centred; a sheet on a
 * phone), both by the pin layer (CommentPins.tsx); or by the code view's comment layer (CodeComments.tsx): "row", in place
 * under a code line, and "sheet", a bottom sheet at any width.
 */
export type PopoverPlacement = "popover" | "dialog" | "row" | "sheet";

export interface CommentPopoverProps {
  placement: PopoverPlacement;
  /** `code`: a line of the code view, `source` its `.hl-line` there, whose coloured text the quote copies (`text` where there is none) */
  quote: { text: string } | { block: MarkdownBlock } | { code: { line: number; text: string; source: Element | null } };
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
  /** where the focus goes back to: the pin, found again after the commit */
  opener: (scope: Element | null) => HTMLElement | null;
  /** where it goes when the opener is gone: the pane's composer, or null */
  fallback: (scope: Element | null) => HTMLElement | null;
  /** the code view's `row` and `sheet`: the field in a frame of its own (FrameField.tsx; a row needs its layer's frame) */
  framed?: boolean;
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
  /**
   * a press outside it, beside its pin, or on a dialog's scrim: closes it where nothing would be lost (true); false
   * where it keeps it, the focus back in its field, and the press then moves the focus nowhere else
   */
  dismiss: () => boolean;
  children: ReactNode;
}

const FRAME_CLASS: Record<PopoverPlacement, string> = {
  popover: `${POPOVER_CLASS} is-card`,
  row: `${POPOVER_CLASS} is-card is-row`,
  dialog: `modal ${POPOVER_CLASS} is-dialog`,
  sheet: `modal ${POPOVER_CLASS} is-sheet`,
};

/** Drawn in place beside the text it is on, in the page's flow: a press outside it dismisses it, and it has no ✕, quote or Top row. */
function besideText(placement: PopoverPlacement): boolean {
  return placement === "popover" || placement === "row";
}

/**
 * The box of the popover. Beside its pin it lies in the surface's scrolling content, and a press
 * anywhere outside it but on a pin (whose own click decides, through `show`) is a `dismiss`; a `row`,
 * drawn in place by its caller, is dismissed the same way. As a dialog it is the shared modal primitive,
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
    // a press the popover kept (text typed) gave the focus back to its field: its `mousedown`, which comes after, would
    // move it to what was pressed (or the body), so its default is held back
    let kept = false;
    // nor is a press in a modal dialog that lies over the surface (Settings, a question, the file viewer): that one's own
    const outside = (event: Event): boolean => {
      const target = event.target;
      if (!(target instanceof Node) || (surface.current?.contains(target) ?? false) || inAnotherDialog(target, surface.current)) return false;
      return !inPinLayer(target);
    };
    // a press outside it only dismisses it: closed, or kept with the focus back in its field. Its click opens nothing else, no
    // comment on the block or line under it (`markDismissingPress`); a drag it starts opens its own selection's (`useSelectionComment`). A press on a pin
    // is not one: that pin's comment opens in its place (`show`)
    const onPointer = (event: PointerEvent): void => {
      if (!outside(event)) { kept = false; return; }
      markDismissingPress(event);
      kept = !dismissRef.current();
    };
    const onMouse = (event: MouseEvent): void => {
      if (kept && outside(event)) event.preventDefault();
      kept = false;
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("mousedown", onMouse, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("mousedown", onMouse, true);
    };
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
  // a portal's events still bubble through the React tree: a click on the scrim or in the dialog would reach the
  // surface's block-click handler (ChatView, FileViewer) and open a comment on whatever block is under it. Not
  // `.modal-scrim` in COMMENT_CLICK_IGNORED: the file viewer itself lies in one. A press on the scrim the dialog kept
  // (text typed) leaves the focus in its field
  return createPortal(
    <div className={`modal-scrim ${POPOVER_SCRIM_CLASS}`} onMouseDown={(event) => { if (event.target === event.currentTarget && !dismissRef.current()) event.preventDefault(); }} onClick={(event) => event.stopPropagation()}>{box}</div>,
    document.body,
  );
}

/**
 * The popover's top row: what the comment is on (the file and lines with why it is shown here, then the `quote`,
 * scrolling past about five lines; none where the highlighted text beside it already shows it), and its `actions`
 * (a dialog's ✕) at the right, level with the first line. A dialog with a `label` (a sheet) shows no reference: the
 * quote says what it is on, and the reference stays for assistive tech.
 */
function Top({ quote, reference, label, note, actions }: Pick<CommentPopoverProps, "reference" | "label" | "note"> & {
  quote: CommentPopoverProps["quote"] | null;
  actions: ReactNode | null;
}): ReactElement {
  return <div className="comment-popover-top">
    <div className="comment-popover-context">
      {reference !== undefined && <p className={label === undefined ? "comment-popover-reference" : "comment-popover-reference visually-hidden"}><FileReferenceLabel reference={reference} /></p>}
      {note !== undefined && <p className="comment-popover-note">{note}</p>}
      {quote !== null && <Quote quote={quote} reference={reference} />}
    </div>
    {actions !== null && <div className="comment-popover-actions">{actions}</div>}
  </div>;
}

/**
 * The text of a code line as the viewer draws it: the children of its `.hl-line` cloned (the viewer's own spans, so the
 * colours are the viewer's and no second highlighter runs), cloned again as its highlighting arrives or changes. Without
 * that line (past the lines the viewer draws as elements) the plain `text`.
 */
function QuotedCode({ text, source }: { text: string; source: Element | null }): ReactElement {
  const host = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const node = host.current;
    if (node === null) return;
    if (source === null) {
      node.replaceChildren(text);
      return;
    }
    const copy = (): void => node.replaceChildren(...Array.from(source.childNodes, (child) => child.cloneNode(true)));
    copy();
    const watch = new MutationObserver(copy);
    watch.observe(source, { childList: true, subtree: true, characterData: true });
    return () => watch.disconnect();
  }, [source, text]);
  return <span ref={host} />;
}

function Quote({ quote, reference }: Pick<CommentPopoverProps, "quote" | "reference">): ReactElement {
  return <>
    <div className={"code" in quote ? "comment-popover-quote is-code" : "comment-popover-quote"}>
      {"code" in quote
        // a line of the code view: its number as the gutter draws it, then its text in the viewer's colours
        ? <pre className="comment-popover-plain comment-popover-code"><span className="comment-popover-code-number">{quote.code.line}</span><QuotedCode text={quote.code.text} source={quote.code.source} /></pre>
        : "text" in quote
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
export function CommentPopover({ placement, quote, reference, label, note, comment, startValue, onText, onSave, onDelete, onClose, opener, fallback, framed = false }: CommentPopoverProps): ReactElement {
  const t = useT();
  const rowFrame = useContext(FieldFrameContext);
  const inFrame = framed && (placement === "sheet" || (placement === "row" && rowFrame !== null));
  const saved = comment !== "";
  const inline = besideText(placement);
  const sheet = placement === "sheet";
  // decided as it opens: a saved comment tapped open on a touch screen raises no keyboard (`popoverFocusesField`)
  const [focusField] = useState(() => popoverFocusesField(saved, window.matchMedia("(pointer: coarse)").matches));
  const draft = useCommentDraft(comment, onSave, onClose, { opener, fallback, inline, focusField, startValue, onText });
  const saveTitle = `${t("Save comment")} (${isMacPlatform() ? "⌘↵" : "Ctrl+Enter"})`;
  // beside its pin there is no ✕, as in Claude: Escape and a press outside close it while its text is unchanged. A
  // dialog, and a phone's sheet, keep ✕, the one visible way out where a keyboard covers the page; with a change typed
  // it only puts the focus back in the field
  // beside its pin the card is the input box alone, new or saved: what it is on is
  // the highlighted text beside it. A dialog and a sheet, with that text out of view or under them, quote it
  const quoted = inline ? null : quote;
  const actions = inline ? null : <button type="button" className="icon-button comment-popover-action" aria-label={t("Close")} title={t("Close")} onClick={draft.leave}>
    <X aria-hidden="true" />
  </button>;
  return <Frame placement={placement} surface={draft.surface} label={inline ? undefined : label} focusable={!focusField} changed={draft.changed} onKeyDown={draft.onKeyDown} dismiss={draft.leave}>
    {/* beside its pin the card is the field alone: a file comment's file and lines are no matter while it is written (the
        pin stands on the text), so they are only said to assistive tech; a dialog and a sheet show them over the quote */}
    {inline
      ? reference !== undefined && <p className="comment-popover-reference visually-hidden"><FileReferenceLabel reference={reference} /></p>
      : <Top quote={quoted} reference={reference} label={label} note={note} actions={actions} />}
    <div className="comment-popover-edit">
      {inFrame
        ? <FrameField draft={draft} placement={placement === "row" ? "row" : "sheet"} />
        : <CommentField draft={draft} />}
      <div className="comment-popover-edit-footer">
        {/* always in view, never behind a menu: immediate, the focus handed on to the next pin as it closes (useCommentSurface.tsx) */}
        {saved && <button type="button" className="icon-button comment-popover-delete" aria-label={t("Delete comment")} title={t("Delete comment")} onClick={onDelete}>
          <Trash2 aria-hidden="true" />
        </button>}
        <button type="button" className="comment-popover-save" aria-label={t("Save comment")} title={saveTitle} disabled={!draft.canSave} onClick={draft.save}>
          <ArrowUp aria-hidden="true" />
          {/* a sheet's Save says so (its button is wide enough): fingers have no tooltip */}
          {sheet && <span>{t("Save")}</span>}
        </button>
      </div>
    </div>
  </Frame>;
}
