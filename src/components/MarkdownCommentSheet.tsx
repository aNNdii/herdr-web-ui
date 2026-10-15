/**
 * The Markdown comment layer's sheet (MarkdownComments.tsx): how a finger writes, edits and reads comments on rendered
 * Markdown. It is `CommentPopover`'s `sheet`, always (the code view's touch settings do not apply here):
 *
 * - Comment on the app's own selection (TouchSelection.tsx) opens it on a new comment, quoting the selected text.
 * - A finger's tap on a card or a count opens it on that card's comment, or on a count's first in reading order; a count
 *   of several pages through them, ‹ › and "1 of 2" (`paging`): ‹ › do not wrap, and paging away keeps the edit of the
 *   one shown (an emptied one is deleted, lib/commentPopover.ts `leaveEdit`). Delete removes the one shown and stays
 *   on the next, else the one before (`sheetPage`); with one left the row goes.
 * - With the comment mode off it is read-only (`readOnly`): each comment's commented text and its text, no input and no
 *   actions (a count's still page).
 * - ✕, the scrim and Escape leave it (the leave rule: what was typed is kept), and so do the mode turned off and the
 *   surface taking no comments now (`leave`), comments turned off too, where the store keeps nothing. Unmounted with
 *   the layer, it keeps what was typed the same way.
 * - A stored comment no longer shown (deleted elsewhere, sent and acknowledged) leaves the sheet unless its text was
 *   changed there (the margin's fields' rule, `popoverOutlived`'s): the sheet stays on the next one, else the one before,
 *   and closes with none left.
 * - The quote is the comment's own selected text, line breaks shown as spaces, clamped to three lines by CSS. The text of
 *   the comment shown has the strong fill: a stored one's through the layer (`shownId`), a new one's here.
 * - It is one of the layer's three ways to have a comment open: the layer leaves the other two before it opens this one.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { SharedRanges, STRONG_COMMENT_HIGHLIGHT } from "../lib/commentHighlight.ts";
import { commentChanged, editDeleted, leaveEdit, sheetPage, type CommentEdit } from "../lib/commentPopover.ts";
import { useT } from "../lib/i18n.ts";
import { CommentPopover } from "./CommentPopover.tsx";
import type { CommentSource, LayerComment } from "./MarkdownComments.tsx";

/**
 * One comment of the sheet as it is being written (`CommentEdit`): a stored one (`id`), or the new one on a selection
 * (`id` null). Its `id`, `initial` and `text` are written in place (`onText` as it is typed, `keepShown` as it is
 * saved): the sheet's state is not drawn from them, only kept, so no render is wanted for a key typed. Never clone a
 * `SheetItem`: every update of the sheet's state carries the same objects, else what was typed is lost.
 */
interface SheetItem<T> extends CommentEdit<T> {
  quote: string;
  /** a new one's selected text, drawn in the strong fill */
  ranges: readonly Range[];
}

interface SheetState<T> {
  /** one per opening: another opening is another sheet */
  opening: number;
  /** the source it was opened from: it keeps its comments, also after the surface moved on */
  source: CommentSource<T>;
  items: SheetItem<T>[];
  index: number;
  readOnly: boolean;
  /** one per comment shown: the input starts again from it */
  page: number;
}

/** A quote with its line breaks as spaces. */
const oneLine = (text: string): string => text.replace(/\s*\n\s*/g, " ").trim();

export interface MarkdownCommentSheet<T> {
  /** the sheet, a portal of its own (none while closed) */
  node: ReactNode;
  /** opens it on a new comment on `target` (the selected text `ranges`, quoting `quote`) */
  openNew(source: CommentSource<T>, target: T, ranges: readonly Range[], quote: string): void;
  /** opens it on the stored comments `ids` (a card's one, a count's several), at `at` (else the first) */
  openStored(source: CommentSource<T>, ids: readonly string[], readOnly: boolean, at?: string): boolean;
  /** leaves it, keeping what was typed; false while closed */
  leave(): boolean;
  /** the stored comment shown, whose text the layer brings up (null: none, or a new one) */
  shownId: string | null;
  /** the stored comments it pages through: their count is open */
  ids: readonly string[];
}

const NONE: readonly string[] = [];

/** The sheet of one surface's comment layer (see the module comment); `comments` are the surface's shown ones (null: none). */
export function useMarkdownCommentSheet<T>(comments: readonly LayerComment<T>[] | null): MarkdownCommentSheet<T> {
  const t = useT();
  const [sheet, setSheetState] = useState<SheetState<T> | null>(null);
  const current = useRef<SheetState<T> | null>(null);
  const setSheet = useCallback((next: SheetState<T> | null): void => {
    current.current = next;
    setSheetState(next);
  }, []);
  const openings = useRef(0);

  /**
   * Keeps the edit of the comment shown (`leaveEdit`); true where that deleted it (emptied, `editDeleted`: a refusal
   * deletes nothing, and the item stays as it is). An edit stored is the item's from now on, written in place
   * (`SheetItem`): its new id, and its text as what it opened with.
   */
  const keepShown = useCallback((state: SheetState<T>): boolean => {
    const item = state.items[state.index];
    if (item === undefined || state.readOnly) return false;
    const left = leaveEdit(item);
    if (left.kind === "closed") return false;
    if (left.id === null) return editDeleted(item, left);
    item.id = left.id;
    item.initial = item.text;
    return false;
  }, []);

  const leave = useCallback((): boolean => {
    const state = current.current;
    if (state === null) return false;
    keepShown(state);
    setSheet(null);
    return true;
  }, [keepShown, setSheet]);

  // the layer unmounted (the viewer closed by its shortcut, another pane, the chat's lens switched): the edit of the
  // comment shown is kept, as leaving would keep it (`keepShown`), by the source it was opened from (with comments off:
  // nothing). Read as of the last render
  useEffect(() => () => {
    const state = current.current;
    if (state !== null) keepShown(state);
  }, [keepShown]);

  /** Shows the comment `step` from the one shown, its edit kept; or, with `removed`, after the one shown is gone. */
  const turn = useCallback((step: -1 | 0 | 1, removed: boolean): void => {
    const state = current.current;
    if (state === null) return;
    const gone = removed || keepShown(state);
    const next = sheetPage(state.index, state.items.length, step, gone);
    if (next === null) {
      setSheet(null);
      return;
    }
    const items = gone ? state.items.filter((_, at) => at !== state.index) : state.items;
    setSheet({ ...state, items, index: next, page: state.page + 1 });
  }, [keepShown, setSheet]);

  const remove = useCallback((): void => {
    const state = current.current;
    const item = state?.items[state.index];
    if (state == null || item === undefined) return;
    if (item.id !== null) state.source.remove(item.id);
    turn(0, true);
  }, [turn]);

  // a stored comment no longer shown leaves the sheet unless its text was changed; with none left the sheet closes. Only
  // as the shown comments change: a page turned meanwhile has stored its edit already, under the id the item now holds
  useEffect(() => {
    const state = current.current;
    if (state === null || comments === null) return;
    const shownIds = new Set(comments.map((comment) => comment.id));
    const kept = state.items.filter((item) => item.id === null || shownIds.has(item.id) || commentChanged(item.text, item.initial));
    if (kept.length === state.items.length) return;
    if (kept.length === 0) {
      setSheet(null);
      return;
    }
    const shownItem = state.items[state.index]!;
    const stays = kept.indexOf(shownItem);
    // the one shown gone: the next one, else the one before (as Delete)
    const index = stays >= 0 ? stays : Math.min(state.items.slice(0, state.index).filter((item) => kept.includes(item)).length, kept.length - 1);
    setSheet({ ...state, items: kept, index, page: stays >= 0 ? state.page : state.page + 1 });
  }, [comments, setSheet]);

  const openNew = useCallback((source: CommentSource<T>, target: T, ranges: readonly Range[], quote: string): void => {
    leave();
    setSheet({ opening: ++openings.current, source, items: [{ id: null, target, quote, initial: "", text: "", ranges, keep: source.persist }], index: 0, readOnly: false, page: 0 });
  }, [leave, setSheet]);

  const openStored = useCallback((source: CommentSource<T>, ids: readonly string[], readOnly: boolean, at?: string): boolean => {
    leave();
    const items = ids.flatMap((id): SheetItem<T>[] => {
      const stored = source.comments.find((comment) => comment.id === id);
      return stored === undefined ? [] : [{ id, target: stored.target, quote: stored.quote, initial: stored.comment, text: stored.comment, ranges: [], keep: source.persist }];
    });
    if (items.length === 0) return false;
    const index = Math.max(0, items.findIndex((item) => item.id === at));
    setSheet({ opening: ++openings.current, source, items, index, readOnly, page: 0 });
    return true;
  }, [leave, setSheet]);

  // a new comment's selected text in the strong fill while the sheet is on it
  const strong = useRef<SharedRanges | null>(null);
  const shown = sheet?.items[sheet.index] ?? null;
  const newRanges = shown !== null && shown.id === null ? shown.ranges : null;
  useLayoutEffect(() => {
    strong.current ??= new SharedRanges(STRONG_COMMENT_HIGHLIGHT);
    const marks = strong.current;
    if (newRanges === null) return;
    marks.set(newRanges);
    return () => marks.set([]);
  }, [newRanges]);

  const shownId = shown?.id ?? null;
  const pagedIds = sheet === null ? NONE : sheet.items.flatMap((item) => item.id === null ? [] : [item.id]);

  // drawn again only as the sheet changes (another opening or page), not with each render of the layer's host
  const node = useMemo(() => sheet === null || shown === null ? null : <CommentPopover
    key={`sheet-${sheet.opening}`}
    placement="sheet"
    quote={{ text: shown.quote }}
    sheetQuote={oneLine(shown.quote)}
    label={t("Comment")}
    comment={shown.initial}
    startValue={shown.text}
    resetKey={sheet.page}
    readOnly={sheet.readOnly}
    paging={sheet.items.length > 1 ? {
      index: sheet.index + 1,
      count: sheet.items.length,
      onPrevious: () => turn(-1, false),
      onNext: () => turn(1, false),
    } : undefined}
    // in place: see `SheetItem`
    onText={(value) => { shown.text = value; }}
    onSave={(value) => {
      shown.text = value;
      leave();
    }}
    onDelete={remove}
    onClose={() => setSheet(null)}
    // a finger opened it: the focus is let go as it closes, no keyboard raised elsewhere
    opener={() => null}
    fallback={() => null}
  />, [sheet, shown, t, turn, leave, remove, setSheet]);

  return { node, openNew, openStored, leave, shownId, ids: pagedIds };
}
