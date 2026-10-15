/**
 * The margin's open fields, one of the three ways the Markdown comment layer (MarkdownComments.tsx) has a comment open,
 * beside the field over a selection and the sheet (MarkdownCommentSheet.tsx), and in the sheet's shape (`node`,
 * `open`, `leave`, `ids`). The layer keeps one of the three open at a time; these are the margin's own:
 *
 * - In the comment mode a card's click turns the card into its field, in its place (`renderField`, which the margin
 *   draws: CommentMargin.tsx). A count's click opens the fields of its comments, stacked over the first one's text and
 *   placed as one (`node`, SelectionField.tsx; their gap is MarkdownComments.css `.markdown-comments-stack`), and a
 *   second click closes them.
 * - The fields of one opening are left together (Enter, ↑, Escape, a press outside, the mode turned off, the margin
 *   changed between cards and counts), each by lib/commentPopover.ts `leaveEdit`: a change kept, an emptied one deleting
 *   its comment, else nothing. A card's bin and a field's Delete delete at once (`remove`).
 * - A field whose comment is no longer shown (deleted elsewhere, sent and acknowledged, outdated by a change to the
 *   file) closes without storing it again, unless its text was changed (`popoverOutlived`'s rule): a count's field stays,
 *   still drawn over the text, and saving it stores the comment again; a card's has no card left to be drawn in (nor
 *   would the composer's Send find it), so it is saved now, as leaving it would, and goes with its card.
 * - The focus: the field clicked or walked to takes it as its opening is drawn, once (a card's field drawn again later,
 *   its row of the chat's list scrolled away and back, takes it only while it is free). As a field is left by a key, the
 *   focus goes back to its card or count (an edit's new one), else to a card beside it, else to the surface's fallback.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { isCommentUi } from "../lib/commentDom.ts";
import { focusAfter } from "../lib/commentMargin.ts";
import { commentChanged, leaveEdit, type CommentEdit } from "../lib/commentPopover.ts";
import type { CommentLayout } from "../lib/settings.ts";
import { marginCardId, marginCardOrder, marginFocusTarget } from "./CommentMargin.tsx";
import { CommentPopover } from "./CommentPopover.tsx";
import type { CommentSource } from "./MarkdownComments.tsx";
import { SelectionField } from "./SelectionField.tsx";

/**
 * A stored comment whose field the margin opened, as it is being written (`CommentEdit`), and what it quotes. Its `text`
 * is written in place by the field's `onText` (no render per key typed), and leaving reads it; a field drawn again
 * (a remount) starts from it. Never clone an `EditField`: every update of `Editing` carries the same objects, else what
 * was typed is lost.
 */
interface EditField<T> extends CommentEdit<T> {
  id: string;
  quote: string;
}

/** The fields the margin opened: a card's one, in its place; a count's (`layout` "counts"), stacked over the first one's text. */
interface Editing<T> {
  /** one per opening: the fields of another opening are other fields */
  opening: number;
  /** the source they were opened from: it keeps them (their `keep`) and deletes them, also after the surface moved on */
  source: CommentSource<T>;
  layout: CommentLayout;
  fields: readonly EditField<T>[];
  /** opened by the composer's walk, which scrolls to them itself */
  walk: boolean;
  /** the comment whose field takes the focus as they open: the one clicked or walked to (a count's first by a click) */
  focus: string;
}

/** The margin's open fields of one layer (see the module comment). */
export interface MarginFields<T> {
  /** a count's fields, stacked over its first comment's text: a portal into the surface (none while closed, or a card's) */
  node: ReactNode;
  /**
   * leaves the open ones, then opens the fields of the source's shown comments `ids` as the margin's layout draws them (a
   * card's one, a count's several), both as of the last render; `walk`: for the composer's walk, which scrolls to them
   * itself; `focus`: the comment whose field takes the focus (else the first). False where none opens: no source, no
   * margin, the mode off, or none of `ids` shown
   */
  open(ids: readonly string[], options: { walk: boolean; focus?: string }): boolean;
  /** leaves them, each by `leaveEdit`; false with none open */
  leave(): boolean;
  /**
   * deletes the stored comment `id` at once (a card's bin, a field's Delete), by the source its field was opened from,
   * else the layer's: its field, if open, goes without saving. The focus, where it was on that card, goes on to the
   * nearest placed card after it, else before it (`focusAfter`, as the code view's cards do), else `focusFallback`; where
   * it was in a count's fields, to another of them, else `focusFallback`
   */
  remove(id: string): void;
  /** the comments whose fields are open, in their order */
  ids: readonly string[];
  /** a card's field, drawn in its card's place (the cards' margin only); null for any other. Changes only with the open fields */
  renderField(id: string): ReactNode;
}

const NO_IDS: readonly string[] = [];

/**
 * The margin's open fields on the layer's surface (`host`, its element once it is there). `source` is the layer's: the
 * fields open on its comments, its shown comments outlive a field or not, and it deletes where no field is open. `layout`
 * is the margin's (null: none): the fields are drawn as it says, and another one leaves the open fields, which were the
 * other's. They open in the comment mode (`mode`) only. `focusFallback`: see `remove`.
 */
export function useMarginFields<T>({ source, layout, mode, host, focusFallback }: {
  source: CommentSource<T> | null;
  layout: CommentLayout | null;
  mode: boolean;
  host: HTMLElement | null;
  focusFallback?: () => HTMLElement | null;
}): MarginFields<T> {
  // read by the callbacks, which the margin and the layer's listeners call between renders
  const latest = useRef({ source, layout, mode, host, focusFallback });
  latest.current = { source, layout, mode, host, focusFallback };
  // kept in a ref too, as their leaving runs from several listeners of one press
  const [editing, setEditingState] = useState<Editing<T> | null>(null);
  const current = useRef<Editing<T> | null>(null);
  const setEditing = useCallback((next: Editing<T> | null): void => {
    current.current = next;
    setEditingState(next);
  }, []);
  const openings = useRef(0);
  // the opening whose field has taken the focus as it opened: a field drawn again later (its card's row of the chat's
  // list scrolled away and back) is not opened again, and leaves the focus where it is
  const focusedOpening = useRef<number | null>(null);
  // where the focus goes back to as each left field closes, the first of these comments' cards (or counts) still drawn:
  // its own comment, stored under a new id by an edit; deleted (emptied), the cards after its card, then those before
  const returnTo = useRef(new Map<string, readonly string[]>());
  // the text a count's fields are placed over (its first comment's), and their stack's box
  const fieldRanges = useRef<readonly Range[]>([]);
  const box = useRef<HTMLDivElement | null>(null);

  const leave = useCallback((): boolean => {
    const now = current.current;
    if (now === null) return false;
    setEditing(null);
    const cards = marginCardOrder(latest.current.host);
    returnTo.current.clear();
    for (const field of now.fields) {
      const left = leaveEdit(field);
      const kept = left.kind === "saved" ? left.id : field.id;
      returnTo.current.set(field.id, kept !== null ? [kept] : focusAfter(cards, field.id));
    }
    return true;
  }, [setEditing]);

  /** Where the focus goes back to as the left field of comment `id` closes (its `opener`): its card or count, or one beside it. */
  const focusBack = useCallback((id: string, layout: CommentLayout): HTMLElement | null => {
    for (const candidate of returnTo.current.get(id) ?? [id]) {
      const found = marginFocusTarget(latest.current.host, candidate, layout);
      if (found !== null) return found;
    }
    return null;
  }, []);

  const open = useCallback((ids: readonly string[], { walk, focus }: { walk: boolean; focus?: string }): boolean => {
    leave();
    const { source, layout: as, mode: modeOn } = latest.current;
    if (source === null || as === null || !modeOn) return false;
    const fields = ids.flatMap((id): EditField<T>[] => {
      const stored = source.comments.find((comment) => comment.id === id);
      return stored === undefined ? [] : [{ id, target: stored.target, quote: stored.quote, initial: stored.comment, text: stored.comment, keep: source.persist }];
    });
    if (fields.length === 0) return false;
    fieldRanges.current = source.comments.find((comment) => comment.id === fields[0]!.id)?.ranges() ?? [];
    const focused = fields.some((field) => field.id === focus) ? focus! : fields[0]!.id;
    setEditing({ opening: ++openings.current, source, layout: as, fields, walk, focus: focused });
    return true;
  }, [leave, setEditing]);

  const remove = useCallback((id: string): void => {
    const now = current.current;
    const { source: shownBy, host: surface, focusFallback: fallback } = latest.current;
    const source = now?.source ?? shownBy;
    const focused = document.activeElement;
    const onCard = marginCardId(focused) === id;
    // found before the card goes: the cards it is among, placed now
    const nextCard = onCard ? focusAfter(marginCardOrder(surface), id).map((other) => marginFocusTarget(surface, other, "cards")).find((node) => node !== null) ?? null : null;
    const fieldsShown = [...box.current?.querySelectorAll<HTMLElement>("textarea") ?? []];
    const inStack = !onCard && focused !== null && now?.layout === "counts" && (box.current?.contains(focused) ?? false);
    const index = now?.fields.findIndex((field) => field.id === id) ?? -1;
    if (now != null && index >= 0) {
      const rest = now.fields.filter((field) => field.id !== id);
      setEditing(rest.length === 0 ? null : { ...now, fields: rest });
    }
    source?.remove(id);
    const to = onCard ? nextCard
      : inStack ? fieldsShown.find((_, other) => other !== index) ?? null
      : undefined;
    if (to === undefined) return;
    (to ?? fallback?.() ?? null)?.focus({ preventScroll: true });
  }, [setEditing]);

  // a field whose comment is no longer shown (see the module comment): a card's is saved now and goes with its card
  const shown = source?.comments ?? null;
  useEffect(() => {
    const now = current.current;
    if (now === null || shown === null) return;
    const shownIds = new Set(shown.map((comment) => comment.id));
    const changed = (field: EditField<T>): boolean => commentChanged(field.text, field.initial);
    const rest = now.fields.filter((field) => shownIds.has(field.id) || (now.layout === "counts" && changed(field)));
    if (rest.length === now.fields.length) return;
    setEditing(rest.length === 0 ? null : { ...now, fields: rest });
    if (now.layout !== "cards") return;
    for (const field of now.fields) {
      if (!shownIds.has(field.id)) leaveEdit(field);
    }
  }, [shown, editing, setEditing]);
  // the margin changed between cards and counts (the room, the setting): its fields are left, which were the other's
  useEffect(() => {
    if (current.current !== null && current.current.layout !== layout) leave();
  }, [layout, leave]);
  // the layer unmounted (the viewer closed by its shortcut, another pane): what was typed is kept, as leaving would keep
  // it (`leaveEdit`), by the source each field was opened from (with comments off: nothing). Read as of the last render
  useEffect(() => () => {
    for (const field of current.current?.fields ?? []) leaveEdit(field);
  }, []);

  /**
   * Whether a field drawn again within its opening may take the focus back: the focus is nowhere (the body: it was in the
   * field as it went) or in this surface's comment UI, never elsewhere (the message box, another pane). Read as it renders.
   */
  const focusIsFree = (): boolean => {
    const active = document.activeElement;
    return active === null || active === document.body || (isCommentUi(active) && (latest.current.host?.contains(active) ?? false));
  };
  /** The field of one open comment: edits apply as it is left, all of the opening's at once. */
  const editField = (now: Editing<T>, field: EditField<T>, focused: boolean): ReactNode => <CommentPopover
    key={`${now.opening}:${field.id}`}
    placement="row"
    quote={{ text: field.quote }}
    comment={field.initial}
    startValue={field.text}
    // in place: see `EditField`
    onText={(value) => { field.text = value; }}
    onSave={(value) => {
      field.text = value;
      leave();
    }}
    onDelete={() => remove(field.id)}
    onClose={leave}
    // the focus, if it is still in the field as it closes (a key left it), goes back to its card or count (an edit's new
    // one), else to a card beside it, else to the surface's fallback
    opener={() => focusBack(field.id, now.layout)}
    fallback={() => latest.current.focusFallback?.() ?? null}
    // a card's field, or a count's first (or the one the walk stopped at), takes the focus (a click asked for it), as the
    // opening draws it first; drawn again later, only while the focus is free to take; the others wait for a click
    focusOnOpen={focused && (focusedOpening.current !== now.opening || focusIsFree())}
  />;
  // the opening drawn (its fields' mount effects have run, in this commit, before this one): drawn again later, they take
  // no focus
  useLayoutEffect(() => {
    if (editing !== null) focusedOpening.current = editing.opening;
  }, [editing]);

  // a card's field in its place (the cards' margin only), drawn by the margin as it renders
  const editFieldRef = useRef(editField);
  editFieldRef.current = editField;
  const renderField = useCallback((id: string): ReactNode => {
    const one = editing?.layout === "cards" ? editing.fields.find((candidate) => candidate.id === id) : undefined;
    return editing === null || one === undefined ? null : editFieldRef.current(editing, one, true);
  }, [editing]);
  // a count's fields: stacked over its first comment's text, growing upward as one. Drawn again only as they change, not
  // with each render of the layer's host
  const node = useMemo(() => host === null || editing === null || editing.layout !== "counts" ? null : createPortal(
    <SelectionField key={`edit-${editing.opening}`} surface={host} ranges={fieldRanges} box={box} reveal={!editing.walk}>
      <div className="markdown-comments-stack">{editing.fields.map((one) => editFieldRef.current(editing, one, one.id === editing.focus))}</div>
    </SelectionField>,
    host,
  ), [host, editing]);
  const ids = useMemo(() => editing?.fields.map((field) => field.id) ?? NO_IDS, [editing]);

  return { node, open, leave, remove, ids, renderField };
}
