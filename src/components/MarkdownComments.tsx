/**
 * The comment layer for rendered Markdown (`MarkdownCommentLayer`): the file viewer's preview (FileComments.tsx
 * `usePreviewCommentSource`), and the chat's replies (ChatComments.tsx `useChatCommentSource`). A surface (the viewer's
 * scrolling body, the chat's scroller) hands it a `CommentSource`: what its comments are, what a selection is on, and how
 * a comment is kept. The layer owns the rest:
 *
 * - In the comment mode (Settings `commentMode`, the viewer header's toggle, the chat's beside Find), a mouse's or a pen's
 *   selection is taken as the button goes up, and a keyboard's (Shift+arrows) as the Shift key is let go: not on each
 *   arrow, so nothing moves while the selection is still being extended. With the mode off a selection is only a
 *   selection.
 * - Taken, it shows the Comment button (SelectionButton.tsx; Settings `commentOnSelect` "button", the default) or opens
 *   the comment field at once ("field"). The button leaves the selection the browser's (copied as ever); its click (or
 *   Enter, Space: the first Tab after it shows reaches it) opens the field as the other variant does, with the focus in
 *   it. It goes, opening nothing, as the selection collapses or changes, on Escape, on a press elsewhere, and as anything
 *   of the layer opens; a new selection shows it anew. No key typed while it shows goes anywhere but where it would.
 * - The selection is first cut to commentable text (lib/markdownSelection.ts `clampSelection`, with where the button
 *   went up: a drag released beside the text is cut back to the block at that height), the visible selection set to
 *   match, then the surface says what it is on (`at`). Selecting a stored comment's place opens that comment, with its text.
 * - The field is `CommentPopover`'s `row` over the selection (SelectionField.tsx: where it goes, and how it scrolls into
 *   view). Opened at once, it takes no focus: the page keeps its selection. The first printable key (no Ctrl, Cmd or Alt)
 *   moves the focus into it inside `keydown`, so that key is typed there. The selection being written on is drawn in the
 *   strong fill (`comment-strong`), as text, never the comment UI or a code block's label (`textRanges`); a stored
 *   comment opened has its own highlight brought up (`showOpenComment`).
 * - Enter saves, Shift+Enter breaks the line; leaving (Escape, a press outside it, the mode turned off, the surface
 *   gone) saves what was typed, or leaves nothing (lib/commentPopover.ts `leaveEdit`), and clears the selection.
 * - A press or a Shift that leaves the selection as it was takes nothing: a selection made before the mode was on (or
 *   one whose button Escape hid) stays only a selection until it changes.
 * - The comments shown sit beside the text (CommentMargin.tsx), in the free space right of it, never moving it: cards,
 *   or counts where the setting says so or that space does not hold the cards. In the mode a card's or a count's click opens its comments' fields (useMarginFields.tsx); with
 *   the mode off cards and counts are read-only.
 * - On a touch screen (`(pointer: coarse)`) a finger never gets the system's selection in the mode: the app's own
 *   (TouchSelection.tsx) and its Comment open the sheet (MarkdownCommentSheet.tsx), and so do a finger's tap on a card
 *   or a count (the mode off: a count's sheet is read-only) and, without a press, the composer's walk.
 * - One comment is open at a time, of the three ways to open one (the field over a selection, the margin's fields, the
 *   sheet): opening one leaves the open one first, as Escape would, what was typed kept, and hides the Comment button.
 * - The composer's walk reaches the comments shown through the surface's registration (useMarkdownCommentWalk.ts).
 * - The margin is beside one text (`margin.text`: the preview's document), portalled into the surface; or, for a surface
 *   that lays out one margin per text (`margin.text` null: the chat's replies, each in a row of its virtualized list), the
 *   layer keeps its fields, sheet and walk as one and draws each text's margin where that text asks for it
 *   (`MarginRowsContext`: its comments are those whose `textKey` is its own), beside itself (ChatComments.tsx `ReplyMargin`).
 * - What takes no focus is said in a polite live region (`role="status"`, visually hidden): the field over a selection
 *   opening at once ("Comment field open"), the Comment button showing ("Comment button shown"), and a walk stop that
 *   only stands on its comment (the mode off: "Comment on “…”: …").
 *
 * Its root (`MARKDOWN_COMMENTS_CLASS`) holds only comment UI, never the Markdown's text: a press in it is the comment
 * UI's (lib/commentDom.ts), and its text is no comment's text.
 */
import { createContext, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";

import "./MarkdownComments.css";

import { quoteExcerpt } from "../lib/blockComments.ts";
import { SharedRanges, showOpenComment, STRONG_COMMENT_HIGHLIGHT } from "../lib/commentHighlight.ts";
import { isCommentUi } from "../lib/commentDom.ts";
import { leaveEdit } from "../lib/commentPopover.ts";
import { commentsByText } from "../lib/commentSource.ts";
import { clampSelection, textRanges } from "../lib/markdownSelection.ts";
import { useT } from "../lib/i18n.ts";
import { useSettings, type CommentLayout } from "../lib/settings.ts";
import { useMediaQuery } from "../lib/useMediaQuery.ts";
import { CommentMargin, type CommentMarginProps } from "./CommentMargin.tsx";
import { useMarkdownCommentSheet } from "./MarkdownCommentSheet.tsx";
import { CommentPopover } from "./CommentPopover.tsx";
import type { FileReference } from "./FileReference.tsx";
import { SelectionButton, SELECTION_BUTTON_CLASS } from "./SelectionButton.tsx";
import { SelectionField } from "./SelectionField.tsx";
import { useCommentPopover } from "./useCommentPopover.ts";
import { TouchSelection } from "./TouchSelection.tsx";
import { useMarginFields } from "./useMarginFields.tsx";
import { useMarkdownCommentWalk } from "./useMarkdownCommentWalk.ts";

/** A comment shown on a surface (`T`: what a comment there is written on, the surface's own). */
export interface LayerComment<T = unknown> {
  id: string;
  comment: string;
  /** the selected text, or the block's text for an old whole-block comment */
  quote: string;
  /** the target it is stored on: an edit kept there replaces it (`CommentSource.persist`) */
  target: T;
  /**
   * the text it is on, where the surface lays out one margin per text (`margin.text` null: the chat's replies, each its
   * turn's key, lib/blockComments.ts `anchorTurn`); unset where one margin is beside all of the surface's text
   */
  textKey?: string;
  /**
   * its text's ranges as the surface's highlights last built them, in document order (none: not drawn now). Cheap: the
   * margin asks for every comment on each placing (a frame at most), the walk for each stop
   */
  ranges(): readonly Range[];
}

/** What a clamped selection is on (`CommentSource.at`): a target, what a comment there quotes, and the comment shown there. */
export interface CommentAt<T> {
  /** where a comment on the selection is written: the stored comment's own target where there is one (`existing`) */
  target: T;
  /** what it quotes: the selection's text (its lines set off by line breaks), or the stored comment's quote */
  quote: string;
  /** the comment shown that is stored there, to edit; null: a new one */
  existing: LayerComment<T> | null;
}

/**
 * What a surface tells the layer (`MarkdownCommentLayer`): its comments, what a selection is on, how a comment is kept.
 * The preview's (FileComments.tsx `usePreviewCommentSource`) and the chat's (ChatComments.tsx `useChatCommentSource`)
 * implement it; both follow their comments' ranges with useSurfaceRanges.ts `useSurfaceRanges`, and both mark their surface element
 * (lib/commentHighlight.ts `markCommentSurface`), which the margin's hover and focus need.
 */
export interface CommentSource<T> {
  /**
   * the store's owner (the pane's `paneStorageId`), which every member below closes over. The layer keys its lifecycle
   * on it: another owner, or no source, leaves what is open
   */
  owner: string;
  /**
   * the comments shown on the surface now, in reading order (the walk stops in it). The same array, and the same
   * objects, until the store or what the surface shows changes: the layer's effects key on its identity (a field or the
   * sheet outlived by its comment)
   */
  comments: readonly LayerComment<T>[];
  /**
   * what `range` is on: a range the layer has clamped to the commentable text of one root (lib/markdownSelection.ts
   * `clampSelection`; a finger's selection is made within one). Its `existing` is one of `comments` or none
   * (lib/commentSource.ts `commentAt`). Null where it makes no target
   */
  at(range: Range): CommentAt<T> | null;
  /**
   * keeps `text` on `target` ("" deletes an edit's comment): the id stored there now, a new one after an edit (the focus
   * goes to its card); null where nothing is stored there now (deleted, or refused: comments off, a selection with
   * nothing to quote). Handed on unbound, as each opening's lib/commentPopover.ts `CommentEdit.keep`
   */
  persist: (target: T, text: string) => string | null;
  /** deletes the stored comment `id` at once; one gone already is no change */
  remove(id: string): void;
}

/** The layer never keeps an open field for a new selection: the press that starts one has left it already. */
const NO_SAME_PLACE = (): boolean => false;

/** Elements whose keys are their own: typing there never moves into the field, and Shift there is no selection's. */
const OWN_KEYS = "input, textarea, select, button, a[href], [contenteditable]:not([contenteditable='false'])";

const ownKeys = (target: EventTarget | null): boolean => target instanceof Element && target.closest(OWN_KEYS) !== null;

/** Whether `selection` runs backwards: its focus before its anchor. */
function isBackward(selection: Selection): boolean {
  const { anchorNode, anchorOffset, focusNode, focusOffset } = selection;
  if (anchorNode === null || focusNode === null || (anchorNode === focusNode && anchorOffset === focusOffset)) return false;
  const range = document.createRange();
  range.setStart(anchorNode, anchorOffset);
  // an end before the start collapses the range onto it
  range.setEnd(focusNode, focusOffset);
  return range.collapsed;
}

const sameRange = (a: Range, b: Range): boolean =>
  a.startContainer === b.startContainer && a.startOffset === b.startOffset && a.endContainer === b.endContainer && a.endOffset === b.endOffset;

/** The whole of the page's selection as one range (from its first range's start to its last's end); null when collapsed or none. */
function selectionRange(selection: Selection | null): Range | null {
  if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const first = selection.getRangeAt(0);
  const last = selection.getRangeAt(selection.rangeCount - 1);
  const range = document.createRange();
  range.setStart(first.startContainer, first.startOffset);
  range.setEnd(last.endContainer, last.endOffset);
  return range;
}

const NO_IDS: readonly string[] = [];
const NO_COMMENTS: readonly LayerComment[] = [];
const NO_FIELD = (): ReactNode => null;

/**
 * The margins of a surface that lays out one per text (`margin.text` null: the chat's replies, each in a row of its
 * virtualized list): each text asks for its own, beside itself. Changes with any of the surface's fields, its sheet or
 * the walk's stop; what each margin is handed of that stays equal while none of it is that text's.
 */
export interface MarginRows {
  /** whether the text `textKey` has comments shown (`LayerComment.textKey`): a text without any draws no margin */
  has(textKey: string): boolean;
  /**
   * the margin (CommentMargin.tsx) beside `text`, the element of the text `textKey`, with the comments on it; `onExtent`
   * is told how far its cards reach (`CommentMarginProps.onExtent`)
   */
  margin(textKey: string, text: HTMLElement, onExtent: (bottom: number) => void): ReactNode;
}

/**
 * A layer's `MarginRows`, which it provides around its children while its margin is one per text (`margin.text` null)
 * and comments show; null otherwise. The chat's replies read it (ChatComments.tsx `ReplyMargin`).
 */
export const MarginRowsContext = createContext<MarginRows | null>(null);

/** What every margin of a layer is handed alike: the layer's side of `CommentMarginProps`, for all of its comments. */
type MarginShared = Pick<CommentMarginProps, "layout" | "mode" | "onEdit" | "onDelete" | "onSheet" | "editing" | "walkStop" | "renderField">;

/**
 * One margin of the layer: `comments`, those on `text`, beside it. It hands the memoized `CommentMargin` only what is
 * its own of `shared` (the open ones among its comments, the walk's stop when it is on one of them, else shared
 * constants), so a field opened beside another text does not draw or place this one again.
 */
function TextMargin({ shared, comments, text, onExtent }: { shared: MarginShared; comments: readonly LayerComment[]; text: HTMLElement; onExtent?: (bottom: number) => void }): ReactNode {
  const own = useMemo(() => new Set(comments.map((comment) => comment.id)), [comments]);
  // joined: a string compares by value, so the memo below gives the same list for the same open ones, whatever else
  // opened or closed
  const ownOpen = shared.editing.filter((id) => own.has(id)).join(" ");
  const editing = useMemo(() => ownOpen === "" ? NO_IDS : ownOpen.split(" "), [ownOpen]);
  const walkStop = shared.walkStop != null && own.has(shared.walkStop.id) ? shared.walkStop : null;
  return <CommentMargin
    comments={comments}
    text={text}
    layout={shared.layout}
    mode={shared.mode}
    onEdit={shared.onEdit}
    onDelete={shared.onDelete}
    onSheet={shared.onSheet}
    editing={editing}
    walkStop={walkStop}
    // only a margin with a field open draws one: the others keep one function
    renderField={editing === NO_IDS ? NO_FIELD : shared.renderField}
    onExtent={onExtent}
  />;
}

/** What a host reaches its layer by (the layer's `ref`); nothing else of the layer is the host's. */
export interface MarkdownCommentLayerHandle {
  /**
   * The surface's Escape: the host asks it first, before its own Escape (closing Find, the viewer). It hides the Comment
   * button, else leaves the comment open on the surface (the field over a selection, the margin's fields or the sheet),
   * what was typed kept; true where one was shown or open, and the host then does nothing more with the key.
   */
  escape(): boolean;
}

/** What a host gives `MarkdownCommentLayer`, and what it must do. */
export interface MarkdownCommentLayerProps<T> {
  /** the file and lines a target is on, shown on its card (the Review shows them; unset, the card names nothing) */
  reference?: (target: T) => FileReference | undefined;
  /** the layer's handle (a plain prop: React 19) */
  ref?: Ref<MarkdownCommentLayerHandle>;
  /** the surface's comments and how they are kept; null: it takes no comments now, and what is open is left */
  source: CommentSource<T> | null;
  /**
   * the scrolling element the comments are on (null: not mounted yet): the fields and the margin are portalled into it
   * and scroll with it. The host keeps it as a state, set in the commit that mounts or changes the element (a callback
   * ref, or a layout effect of an ancestor of it), so the layer has it as it is there, never a render late. One layer per
   * surface element: the composer's walk finds a layer by its element (lib/shownComments.ts `registerShownComments`),
   * and a second layer on it would take the first one's place
   */
  surface: HTMLElement | null;
  /** the surface's commentable Markdown roots, in document order: a selection is cut to them. Read as it is needed */
  roots: () => readonly Element[];
  /** the comment mode (Settings `commentMode`) */
  mode: boolean;
  /**
   * the margin, while it shows: how comments show there (`layout`, cards or counts: lib/commentMargin.ts `marginLayout`)
   * and the one text it is beside (`text`, the preview's document), whose margin the layer draws; `text` null: one
   * margin per text, which each text draws where it is through `MarginRowsContext` (the chat's replies, ChatComments.tsx
   * `ReplyMargin`). Null: no margin
   */
  margin: { text: HTMLElement | null; layout: CommentLayout } | null;
  /**
   * where the keyboard's focus goes when what it was on is deleted and nothing beside it takes it: a card, with no other
   * card placed; a count's field, with none of the count's others left (the comment mode's toggle)
   */
  focusFallback?: () => HTMLElement | null;
  /**
   * drawn inside `MarginRowsContext` (the chat's list). The layer's own sheet, touch selection and live region are drawn
   * after them, where the layer is: so the layer is never inside a live region (`role="log"`, which would read the
   * sheet out): such a region goes in its children
   */
  children?: ReactNode;
}

/** The comment layer of one surface (see the module comment and `MarkdownCommentLayerProps`). */
export function MarkdownCommentLayer<T>({ ref, source, surface: host, roots, mode, margin, focusFallback, reference, children }: MarkdownCommentLayerProps<T>): ReactNode {
  const { settings } = useSettings();
  const t = useT();
  // what the live region says last; `n` makes the same words a new message
  const [said, setSaid] = useState<{ text: string; n: number } | null>(null);
  const say = useCallback((text: string): void => setSaid((now) => ({ text, n: (now?.n ?? 0) + 1 })), []);
  // the field over a selection: kept by the source it was opened from (its `keep`), also after the surface moved on
  // (another view, file)
  const { open, show, save, leave: leavePopover, edit: popoverEdit, remove: removePopover, close, text } = useCommentPopover<T>({ enabled: settings.comments, samePlace: NO_SAME_PLACE });
  // a touch screen: without a press (the walk) it decides; a press decides by its own `pointerType`
  const coarse = useMediaQuery("(pointer: coarse)");
  const layout = margin?.layout ?? null;
  const fields = useMarginFields<T>({ source, layout, mode, host, focusFallback });
  const sheet = useMarkdownCommentSheet<T>(source?.comments ?? null);
  const { open: openFields, leave: leaveFields, remove: removeComment, renderField } = fields;
  const { openNew: sheetNew, openStored: sheetStored, leave: leaveSheet } = sheet;
  // read by the listeners, which outlive the render that made them
  const onSelect = settings.commentOnSelect;
  const latest = useRef({ host, source, roots, mode, open, onSelect });
  latest.current = { host, source, roots, mode, open, onSelect };
  // the Comment button's selection (`range`, cut to commentable text; its text's `ranges`), while it shows; the ref for
  // the listeners, set with the state
  const [offer, setOffer] = useState<{ range: Range; ranges: readonly Range[] } | null>(null);
  const offered = useRef<{ range: Range; ranges: readonly Range[] } | null>(null);
  // whether the field opened next takes the focus (opened by the button), read as its element is made
  const focusField = useRef(false);
  // the text the field over a selection is on, what it quotes, and the field's box
  const fieldRanges = useRef<readonly Range[]>([]);
  const quote = useRef("");
  const box = useRef<HTMLDivElement | null>(null);

  /** Ends the field over a selection without saving (its ✕, or a save with nothing to save), and the selection it was on. */
  const closeField = useCallback((): void => {
    close();
    window.getSelection()?.removeAllRanges();
  }, [close]);

  /** Hides the Comment button, opening nothing; the selection stays as it is. False where it was not shown. */
  const hideOffer = useCallback((): boolean => {
    if (offered.current === null) return false;
    offered.current = null;
    setOffer(null);
    return true;
  }, []);

  /** Leaves the field over a selection (`leaveEdit`): a change kept, else nothing; the selection cleared. False with none open. */
  const leaveSelection = useCallback((): boolean => {
    if (!leavePopover()) return false;
    window.getSelection()?.removeAllRanges();
    return true;
  }, [leavePopover]);

  /**
   * One comment open at a time: as one of the three ways (the field over a selection, the margin's fields, the sheet)
   * opens, the other two are left, each by `leaveEdit`. Each leaves its own open one itself as it opens another.
   */
  const leaveOthers = useCallback((opening: "selection" | "fields" | "sheet"): void => {
    hideOffer();
    if (opening !== "selection") leaveSelection();
    if (opening !== "fields") leaveFields();
    if (opening !== "sheet") leaveSheet();
  }, [hideOffer, leaveSelection, leaveFields, leaveSheet]);

  /**
   * Opens the margin's fields of the stored comments `ids` (none: leaves the open ones), in the mode only
   * (`MarginFields.open`); `walk`: for the composer's walk; `focus`: the comment whose field takes the focus (else the
   * first).
   */
  const editComments = useCallback((ids: readonly string[], walk = false, focus?: string): void => {
    leaveOthers("fields");
    openFields(ids, { walk, focus });
  }, [leaveOthers, openFields]);

  /** Opens the sheet on a new comment on `target` (`MarkdownCommentSheet.openNew`), the others left. */
  const openSheetNew = useCallback((source: CommentSource<T>, target: T, ranges: readonly Range[], quoted: string): void => {
    leaveOthers("sheet");
    sheetNew(source, target, ranges, quoted);
  }, [leaveOthers, sheetNew]);

  /** Opens the sheet on stored comments (`MarkdownCommentSheet.openStored`), the others left. */
  const openSheetStored = useCallback((source: CommentSource<T>, ids: readonly string[], readOnly: boolean, at?: string): boolean => {
    leaveOthers("sheet");
    return sheetStored(source, ids, readOnly, at);
  }, [leaveOthers, sheetStored]);

  /**
   * Opens the field of `source` on what a selection is on (`at`), over `ranges`: on its stored comment, else a new one.
   * `focus`: it takes the focus (opened by the Comment button); else it takes none, and the page keeps its selection.
   */
  const openOn = useCallback((source: CommentSource<T>, at: CommentAt<T>, ranges: readonly Range[], focus = false): boolean => {
    leaveOthers("selection");
    // the open one is left first, by its own source's `keep`
    const existing = at.existing === null ? null : { id: at.existing.id, comment: at.existing.comment };
    focusField.current = focus;
    if (!show({ owner: source.owner, target: at.target, existing, keep: source.persist, fromSelection: true })) return false;
    fieldRanges.current = ranges;
    quote.current = at.quote;
    // without the focus a screen reader is told
    if (!focus) say(t("Comment field open"));
    return true;
  }, [show, leaveOthers, say, t]);

  /** The Comment button's click: the field over its selection, on what the selection is on now, the focus in it. */
  const commentOffer = useCallback((): void => {
    const now = offered.current;
    const { source, roots: rootsOf } = latest.current;
    hideOffer();
    const at = now === null || source === null ? null : source.at(now.range);
    if (now !== null && source !== null && at !== null) openOn(source, at, textRanges(now.range, rootsOf()), true);
  }, [hideOffer, openOn]);

  /**
   * The page's selection, if it is in the surface's commentable text, shows the Comment button or opens its field
   * (`commentOnSelect`): cut to that text (`release`: where a mouse's button went up), the visible selection set to
   * match, on its stored comment if there is one. Not where it is the selection `before` the press or the Shift began:
   * a press or a Shift that changed nothing (a selection made before the mode was on) takes nothing.
   */
  const openSelection = useCallback((release?: { x: number; y: number }, before?: Range | null): void => {
    const { source, roots: rootsOf, mode: modeOn, onSelect: by } = latest.current;
    if (source === null || !modeOn) return;
    const selection = window.getSelection();
    const range = selectionRange(selection);
    if (selection === null || range === null || (before != null && sameRange(before, range))) return;
    const backward = isBackward(selection);
    const rootList = rootsOf();
    const clamped = clampSelection(range, rootList, release === undefined ? undefined : { ...release, backward });
    if (clamped === null) return;
    if (!sameRange(clamped, range)) {
      if (backward) selection.setBaseAndExtent(clamped.endContainer, clamped.endOffset, clamped.startContainer, clamped.startOffset);
      else selection.setBaseAndExtent(clamped.startContainer, clamped.startOffset, clamped.endContainer, clamped.endOffset);
    }
    const at = source.at(clamped);
    if (at === null) return;
    if (by === "field") {
      openOn(source, at, textRanges(clamped, rootList));
      return;
    }
    const shown = { range: clamped, ranges: textRanges(clamped, rootList) };
    offered.current = shown;
    setOffer(shown);
    // it takes no focus (the page keeps its selection): a screen reader is told, once for this selection
    say(t("Comment button shown"));
  }, [openOn, say, t]);

  // the composer's walk: where it stands with the mode off (its comment's text in the strong fill until the walk moves on
  // or ends, a count's read-only cards). A stop that only stands on its comment moves no focus: a screen reader hears it
  const announce = useCallback((comment: LayerComment): void => {
    say(t("Comment on “{quote}”: {comment}", { quote: quoteExcerpt(comment.quote), comment: comment.comment }));
  }, [say, t]);
  const { walkStop } = useMarkdownCommentWalk<T>({ host, source, layout, mode, coarse, edit: editComments, sheet: openSheetStored, announce });
  const sourceOwner = source?.owner ?? null;

  // a mouse's or a pen's selection opens as its button goes up (a frame later, once the browser has settled it); a
  // keyboard's as Shift is let go; either only if the selection changed since the press or the Shift went down. The first
  // printable key while the field is open and unfocused is typed into it
  useEffect(() => {
    let pressed = false;
    let frame = 0;
    // the selection as the press or the Shift began (undefined: no Shift seen going down, as a script's keyup alone)
    let pressedOn: Range | null = null;
    let shiftOn: Range | null | undefined;
    const onPointerDown = (event: PointerEvent): void => {
      // a press anywhere but on the Comment button hides it (a press that selects anew shows it again as it ends)
      if (!(event.target instanceof Element && event.target.closest(`.${SELECTION_BUTTON_CLASS}`) !== null)) hideOffer();
      const body = latest.current.host;
      pressed = (event.pointerType === "mouse" || event.pointerType === "pen") && event.button === 0 && body !== null
        && event.target instanceof Node && body.contains(event.target) && !isCommentUi(event.target);
      if (pressed) pressedOn = selectionRange(window.getSelection());
    };
    const onSelectionChange = (): void => {
      // the Comment button's selection collapsed or changed: it goes
      const shown = offered.current;
      if (shown === null) return;
      const now = selectionRange(window.getSelection());
      if (now === null || !sameRange(now, shown.range)) hideOffer();
    };
    const onPointerUp = (event: PointerEvent): void => {
      if (!pressed) return;
      pressed = false;
      const at = { x: event.clientX, y: event.clientY };
      const before = pressedOn;
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        openSelection(at, before);
      });
    };
    const onPointerCancel = (): void => { pressed = false; };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.key !== "Shift") return;
      const before = shiftOn;
      shiftOn = undefined;
      if (!ownKeys(event.target) && !isCommentUi(event.target)) openSelection(undefined, before);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Shift") {
        if (!event.repeat) shiftOn = selectionRange(window.getSelection());
        return;
      }
      // the first Tab after the Comment button shows goes to it, wherever it lies in the document's order
      if (event.key === "Tab" && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && offered.current !== null
        && !ownKeys(event.target) && !isCommentUi(event.target)) {
        const button = latest.current.host?.querySelector<HTMLElement>(`:scope > .${SELECTION_BUTTON_CLASS}`) ?? null;
        if (button !== null) {
          event.preventDefault();
          button.focus({ preventScroll: true });
        }
        return;
      }
      if (latest.current.open === null || event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
      if (ownKeys(event.target) || isCommentUi(event.target)) return;
      const field = box.current?.querySelector("textarea");
      if (field == null || document.activeElement === field) return;
      // within the key's own keydown: the character it types lands in the field
      field.focus({ preventScroll: true });
      field.setSelectionRange(field.value.length, field.value.length);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("pointercancel", onPointerCancel, true);
    document.addEventListener("keyup", onKeyUp, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("pointercancel", onPointerCancel, true);
      document.removeEventListener("keyup", onKeyUp, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, [openSelection, hideOffer]);

  // the mode turned off, or the surface taking no comments now (another view, another file, comments turned off): the
  // open fields are left. With comments off the store keeps nothing (lib/blockComments.ts `setEnabled`, set before this
  // runs), so what was typed goes with them. The walk's stop is no field: the mode off leaves it, as with the mode off
  // the walk only stands on a comment
  useEffect(() => {
    if (mode && sourceOwner !== null) return;
    hideOffer();
    leaveSelection();
    leaveFields();
  }, [mode, sourceOwner, hideOffer, leaveSelection, leaveFields]);
  // the Comment button goes as the other variant is chosen
  useEffect(() => {
    if (onSelect !== "button") hideOffer();
  }, [onSelect, hideOffer]);
  // the layer unmounted (the viewer closed by its shortcut, another pane): what was typed in the field over a selection
  // is kept, as leaving it would keep it (`leaveEdit`), by the source it was opened from (with comments off: nothing).
  // The margin's fields (useMarginFields.tsx) and the sheet (MarkdownCommentSheet.tsx) keep theirs in their own unmount
  // effects, the same way
  useEffect(() => () => {
    const opened = popoverEdit();
    if (opened !== null) leaveEdit(opened);
  }, [popoverEdit]);
  // the sheet is left as the mode turns either way and as the surface takes no comments now (comments turned off too)
  const sheetMode = useRef(mode);
  useEffect(() => {
    if (sheetMode.current !== mode || sourceOwner === null) leaveSheet();
    sheetMode.current = mode;
  }, [mode, sourceOwner, leaveSheet]);

  // the text being written on: a new comment's selection in the strong fill
  const pending = useRef<SharedRanges | null>(null);
  const openId = open?.id ?? null;
  const openCommentId = open?.commentId ?? null;
  useLayoutEffect(() => {
    pending.current ??= new SharedRanges(STRONG_COMMENT_HIGHLIGHT);
    const marks = pending.current;
    if (openId === null || openCommentId !== null) return;
    marks.set(fieldRanges.current);
    return () => marks.set([]);
  }, [openId, openCommentId]);
  // the margin's open comments: its fields', or the sheet's. Joined: a string compares by value, so the memo changes as
  // the sheet's comments do, not with the new array each render of the sheet makes
  const pagedIds = sheet.ids.join(" ");
  const editIds = useMemo(() => pagedIds === "" ? fields.ids : [...fields.ids, ...pagedIds.split(" ")], [fields.ids, pagedIds]);
  // a stored comment open (over its selection, the margin's fields, the sheet), or the one the walk stands on, has its
  // own highlight brought up. Joined: the effect runs again only as the set of them changes
  const shownOpen = [...new Set([
    ...(openCommentId === null ? [] : [openCommentId]), ...fields.ids, ...(sheet.shownId === null ? [] : [sheet.shownId]), ...(walkStop === null ? [] : [walkStop.id]),
  ])].join(" ");
  useLayoutEffect(() => {
    if (host === null || shownOpen === "") return;
    showOpenComment(host, shownOpen.split(" "));
    return () => showOpenComment(host, null);
  }, [shownOpen, host]);

  /** A stored comment's Delete: at once, without an undo; the selection it was on goes too. */
  const removeOpen = useCallback((): void => {
    removePopover();
    window.getSelection()?.removeAllRanges();
  }, [removePopover]);

  // the field over a selection, portalled into the surface. Drawn again only as it opens or the surface changes, not
  // with each render of the host
  const field = useMemo(() => host === null || open === null ? null : createPortal(
    <SelectionField key={`open-${open.id}`} surface={host} ranges={fieldRanges} box={box}>
      <CommentPopover
        placement="row"
        reference={open === null || reference === undefined ? undefined : reference(open.target)}
        showReference={reference !== undefined}
        quote={{ text: quote.current }}
        comment={open.initialComment}
        startValue={text.read()}
        onText={text.write}
        // saved, it is left as any leaving leaves it: the selection it was on goes too (the chat's list keeps a row holding
        // the selection drawn)
        onSave={(value) => {
          save(value);
          window.getSelection()?.removeAllRanges();
        }}
        onDelete={removeOpen}
        onClose={closeField}
        // nothing takes the focus back as it closes: the page is where the user was
        opener={() => null}
        fallback={() => null}
        // opened by the Comment button: as it was, by its click or its keys; else the page keeps its selection
        focusOnOpen={focusField.current}
      />
    </SelectionField>,
    host,
  ), [host, open, text, save, removeOpen, closeField]);
  // the Comment button, portalled into the surface beside the selection
  const button = useMemo(() => host === null || offer === null ? null
    : <SelectionButton surface={host} ranges={offer.ranges} onComment={commentOffer} />, [host, offer, commentOffer]);

  // a finger's tap: the sheet, read-only with the mode off
  const onSheet = useCallback((ids: readonly string[]): void => {
    const source = latest.current.source;
    if (source !== null) openSheetStored(source, ids, !latest.current.mode);
  }, [openSheetStored]);
  // a count opens its read-only cards for the walk's stop only where the stop stood on it
  const marginStop = walkStop?.count === true ? walkStop : null;
  const shared = useMemo((): MarginShared | null => layout === null ? null : {
    layout, mode, onEdit: editComments, onDelete: removeComment, onSheet, editing: editIds, walkStop: marginStop, renderField,
  }, [layout, mode, editComments, removeComment, onSheet, editIds, marginStop, renderField]);
  const shownList = source?.comments ?? null;
  const byText = useMemo(() => shownList === null ? null : commentsByText(shownList), [shownList]);
  const marginText = margin?.text ?? null;
  const rows = useMemo((): MarginRows | null => shared === null || byText === null || marginText !== null ? null : {
    has: (textKey) => byText.has(textKey),
    margin: (textKey, text, onExtent) => <TextMargin shared={shared} comments={byText.get(textKey) ?? NO_COMMENTS} text={text} onExtent={onExtent} />,
  }, [shared, byText, marginText]);
  const marginNode = useMemo(() => host === null || shared === null || shownList === null || marginText === null ? null
    : createPortal(<TextMargin shared={shared} comments={shownList} text={marginText} />, host), [host, shared, shownList, marginText]);

  useImperativeHandle(ref, () => ({
    // one open at a time: the first that leaves (the Comment button first: it shows only while nothing is open)
    escape: () => hideOffer() || leaveSelection() || leaveFields() || leaveSheet(),
  }), [hideOffer, leaveSelection, leaveFields, leaveSheet]);

  // a finger's own selection in the mode, whose Comment opens the sheet on it (on its stored comment, if it has one)
  const onTouchComment = useCallback((range: Range): void => {
    const source = latest.current.source;
    const at = source?.at(range) ?? null;
    if (source == null || at === null) return;
    if (at.existing !== null) openSheetStored(source, [at.existing.id], false);
    else openSheetNew(source, at.target, textRanges(range, latest.current.roots()), at.quote);
  }, [openSheetStored, openSheetNew]);

  return <>
    <MarginRowsContext.Provider value={rows}>{children}</MarginRowsContext.Provider>
    {marginNode}
    {button}
    {field}
    {fields.node}
    {sheet.node}
    {/* its own component, so a finger's drag renders it alone, never the layer or the host */}
    <TouchSelection surface={host} roots={roots} enabled={mode && coarse && source !== null} onComment={onTouchComment} />
    <p className="visually-hidden markdown-comments-status" role="status">{said !== null && <span key={said.n}>{said.text}</span>}</p>
  </>;
}
