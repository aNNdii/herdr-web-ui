/**
 * The chat's side of the Markdown comment layer (MarkdownComments.tsx), which the file viewer's preview has too
 * (FileComments.tsx `usePreviewCommentSource`): the comments on this pane's replies, their highlights, how a selection
 * there becomes a target, the margin's room beside the transcript, and each reply's own margin.
 *
 * - The source (`useChatCommentSource`): the commentable text is the final answer parts of finished replies (each a
 *   commentable root, lib/commentDom.ts `commentRootsIn`, `chatCommentRoots`). The layer has cut a selection to the first of them it touches
 *   (lib/markdownSelection.ts `clampSelection`, plan decision 4: never the user's bubble, a selection across two answer
 *   parts or replies counts in the first), and the source measures it as before (lib/commentSelection.ts
 *   `rangeComment`, lib/blockComments.ts `selectionTarget`). A selection on a stored comment's place opens that comment
 *   (`blockComments.get`). Each comment's text is highlighted per comment (lib/commentHighlight.ts
 *   `watchCommentHighlights`, its ranges followed through `watchSurfaceRanges`); a comment the highlights have not been
 *   rebuilt for yet (just saved) is measured as they will measure it (`draftRanges`). Its comments are listed in reading
 *   order (the store's sending order), since the list's rows are not in the document's order.
 * - The room (`useChatMargin`): from the free space right of the transcript, up to the scroller's right edge, and
 *   Settings → Comments beside the text, `marginLayout` says cards or counts. The transcript keeps the place and width
 *   it has with comments off (`--chat-w`, centred; the minimap left of it shows wherever it did); a reply's margin lies
 *   outside its row, to the right, which the row's list container is made to paint (`unclipRow`). Only the room and the
 *   setting decide, never whether there are comments.
 * - Each reply's margin (`ReplyMargin`, in ChatView's `Turn`): the transcript is virtualized (ChatTimeline.tsx), so a
 *   reply's cards or counts are its row's, placed against its own text, pushed down within that reply only; where its
 *   cards reach past its text the reply grows by that much (a `min-height` set before paint, which the list measures
 *   with the row). The layer's fields, sheet and walk stay one per chat view (MarkdownComments.tsx `MarginRowsContext`,
 *   which the layer provides around the list):
 *   each comment says the turn it is on (`LayerComment.textKey`), and the layer draws each reply's margin with those.
 */
import { useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode, type RefObject } from "react";

import { anchorTurn, blockComments, blockContent, commentTarget, isReplyComment, selectionTarget, useBlockComments, type BlockComment, type CommentTarget } from "../lib/blockComments.ts";
import { COMMENT_TURN_ATTR, commentRootsIn } from "../lib/commentDom.ts";
import { draftRanges, markCommentSurface, watchCommentHighlights } from "../lib/commentHighlight.ts";
import { marginLayout } from "../lib/commentMargin.ts";
import { rangeComment } from "../lib/commentSelection.ts";
import { commentAt } from "../lib/commentSource.ts";
import { useSettings, type CommentLayout } from "../lib/settings.ts";
import { MarginRowsContext, type CommentSource, type LayerComment } from "./MarkdownComments.tsx";
import { useSurfaceRanges } from "./useSurfaceRanges.ts";

/** The commentable roots of the chat's transcript in `scroller`: the final answer parts of finished replies, in document order. */
export function chatCommentRoots(scroller: Element | null): readonly Element[] {
  return scroller === null ? [] : commentRootsIn(scroller);
}

/**
 * The chat's comment source (see the module comment) for the pane `owner`, on the list's `scroller` while it shows the
 * conversation (`active`); null otherwise and while comments are turned off.
 */
export function useChatCommentSource(owner: string, scroller: RefObject<HTMLDivElement | null>, active: boolean): CommentSource<CommentTarget> | null {
  const { settings } = useSettings();
  const enabled = active && settings.comments;
  const stored = useBlockComments(owner);
  const replies = useMemo(() => stored.filter(isReplyComment), [stored]);
  // the scroller as a state: it changes with the source, and once the list's chunk arrives
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => { setNode(enabled ? scroller.current : null); });
  // each comment's ranges as the highlights last built them
  const rangesOf = useSurfaceRanges(scroller, enabled);
  useLayoutEffect(() => {
    // the transcript is the scroller's first child: the list's content container, whose rows mount and unmount as they scroll
    const transcript = node?.firstElementChild ?? null;
    if (node === null || transcript === null) return;
    // the surface the cards' and counts' pointer and focus bring their text up on (lib/commentHighlight.ts `activateComment`)
    const unmark = markCommentSurface(node);
    const stop = watchCommentHighlights(node, transcript);
    return () => {
      stop();
      unmark();
    };
  }, [node]);
  return useMemo(() => {
    if (!enabled) return null;
    // a comment the highlights have not built ranges for: measured in its own turn's answer parts, none while that turn
    // is not mounted (the list's window), so the walk's ordering of every comment never searches the whole transcript
    const measure = (comment: BlockComment, turn: string): readonly Range[] => {
      const view = scroller.current;
      if (view === null) return [];
      const parts = view.querySelectorAll(`[${COMMENT_TURN_ATTR}="${CSS.escape(turn)}"]`);
      if (parts.length === 0) return [];
      const target = commentTarget(comment);
      return [...parts].flatMap((part) => draftRanges(part, owner, target));
    };
    const quoteOf = (target: CommentTarget): string => target.quote?.text ?? blockContent(target.block);
    // in the store's sending order, which is reading order: the list's rows are not in the document's order
    const shown = replies.map((comment): LayerComment<CommentTarget> => {
      const turn = anchorTurn(comment.anchor);
      return {
        id: comment.id,
        comment: comment.comment,
        // a whole-block comment from before selections quotes its block
        quote: comment.quote ?? blockContent(comment.block),
        target: commentTarget(comment),
        textKey: turn,
        ranges: () => rangesOf(comment.id, () => measure(comment, turn)),
      };
    });
    return {
      owner,
      comments: shown,
      at: (range) => {
        const view = scroller.current;
        const found = view === null ? null : rangeComment(range, view);
        if (found === null || found.owner !== owner) return null;
        const target = selectionTarget(found.target, found.text, found.start, found.end, found.until === undefined ? undefined : { target: found.until.target, end: found.until.end });
        return commentAt(shown, blockComments.get(owner, target)?.id, target, quoteOf(target));
      },
      persist: (target, text) => {
        blockComments.save(owner, target, text);
        return blockComments.get(owner, target)?.id ?? null;
      },
      remove: (id) => blockComments.remove(owner, [id]),
    };
  }, [enabled, owner, replies, scroller, rangesOf]);
}

/**
 * How the margin shows beside the chat's replies while the chat takes comments (`active`): cards or counts, from the
 * free space right of the transcript (the list's content container, where `--chat-w` puts the text, centred) up to the
 * scroller's right edge, and the setting (`wanted`; lib/commentMargin.ts `marginLayout`). The transcript is only
 * measured: it keeps the place and width it has with comments off. The minimap is left of the text (ChatMinimap.css),
 * so none of that space is its. Followed as the scroller or the transcript is resized. Null while inactive.
 */
export function useChatMargin(scroller: RefObject<HTMLDivElement | null>, active: boolean, wanted: CommentLayout): CommentLayout | null {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => { setNode(active ? scroller.current : null); });
  const [layout, setLayout] = useState<CommentLayout | null>(null);
  useLayoutEffect(() => {
    if (node === null) {
      setLayout(null);
      return;
    }
    // the widths the last `apply` measured: a resize that moved neither (the scroller's height, a row's) measures nothing
    let measured: { scroller: number; content: number } | null = null;
    const apply = (): void => {
      const transcript = node.firstElementChild;
      const widths = { scroller: node.clientWidth, content: transcript?.clientWidth ?? 0 };
      if (transcript === null || (measured !== null && measured.scroller === widths.scroller && measured.content === widths.content)) return;
      measured = widths;
      const outer = node.getBoundingClientRect();
      const placed = marginLayout({
        // a reply's text fills its row, as wide as the transcript (its content box: the transcript has no padding)
        textRight: transcript.getBoundingClientRect().right,
        containerRight: outer.left + node.clientLeft + node.clientWidth,
        minimapGutter: 0,
        wanted,
        // the layout does not depend on the pointer: only where a count's target goes does (CommentMargin.tsx)
        coarse: false,
      });
      setLayout(placed.layout);
    };
    apply();
    // the view resized, or the text's set width changed (Settings → Chat width, the pane's lane): the transcript then resizes
    const resized = new ResizeObserver(apply);
    resized.observe(node);
    if (node.firstElementChild !== null) resized.observe(node.firstElementChild);
    return () => resized.disconnect();
  }, [node, wanted]);
  return node === null ? null : layout;
}

/**
 * The margin of one reply (the turn `turnKey`), beside its text (`textRef`, the turn's `article`), in its row: its
 * comments' cards or counts, drawn by the layer (`MarginRows.margin`: those whose `textKey` is this turn's, handed only what is their
 * own of the layer's open fields and walk stop), and the reply grown by what its cards need past its text. It takes the
 * text's element only while the reply has comments: a reply without any renders nothing more as it mounts.
 */
export function ReplyMargin({ turnKey, textRef }: { turnKey: string; textRef: RefObject<HTMLElement | null> }): ReactNode {
  const rows = useContext(MarginRowsContext);
  const wanted = rows?.has(turnKey) ?? false;
  const [text, setText] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const next = wanted ? textRef.current : null;
    if (next !== text) setText(next);
  });
  const extent = useCallback((bottom: number): void => {
    if (text === null) return;
    const height = bottom > 0 ? `${Math.ceil(bottom)}px` : "";
    if (text.style.minHeight !== height) text.style.minHeight = height;
  }, [text]);
  // no margin (or another text), no growth
  useLayoutEffect(() => () => { if (text !== null) text.style.minHeight = ""; }, [text]);
  // the margin lies right of the row, in the free space beside the transcript: its list container must not clip it
  useLayoutEffect(() => text === null ? undefined : unclipRow(text), [text]);
  return rows === null || !wanted || text === null ? null : rows.margin(turnKey, text, extent);
}

/**
 * Lets the list container of the row `text` is in paint what lies outside it: a reply's margin (CommentMargin.tsx), which
 * sits right of the row, in the free space beside the transcript, so the text keeps its place and width. LegendList
 * (ChatTimeline.tsx) draws each row in an absolutely placed container of its own with `contain: paint layout style`, as
 * an inline style no stylesheet can override; paint containment clips at the container's box. Only that part is
 * dropped, and only from a row whose reply has comments, while it has them: layout containment stays, so the margin is
 * ink overflow (it neither widens the list's scrolling nor changes how the list measures the row), and the rest of the
 * list keeps all three. The container is the row's own while it is mounted (`recycleItems` off), and LegendList never
 * sets `contain` again (React writes a style property only when its value changes). Returns the undo.
 */
export function unclipRow(text: HTMLElement): () => void {
  const container = text.closest("[data-chat-row]")?.parentElement ?? null;
  if (container === null || !/\bpaint\b/.test(container.style.contain)) return () => {};
  const was = container.style.contain;
  container.style.contain = was.replace(/\s*\bpaint\b\s*/, " ").trim();
  return () => {
    if (container.isConnected) container.style.contain = was;
  };
}
