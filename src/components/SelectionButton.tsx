/**
 * The Comment button over a selection, for the Markdown comment layer (MarkdownComments.tsx): what a mouse's, a pen's or
 * a keyboard's selection in the comment mode shows where Settings → Comments → When you select text says so
 * (`commentOnSelect` "button", the default), instead of opening the field at once. Its click opens the field, as the
 * other variant does on its own.
 *
 * It has the look of a finger's Comment pill (TouchSelection.tsx, `.markdown-comment-pill` in MarkdownComments.css) at a
 * pointer's size. It is portalled into the scrolling surface, whose content it scrolls with, and placed from the
 * selection's line boxes: under the last line, near the selection's end, kept inside the surface sideways; without room
 * below in the surface's view, above the first line (lib/selectionField.ts `buttonPlace`). It is placed again as the
 * surface or its content is resized, never moved by a transition. Its text not drawn (re-rendered away), it stays where
 * it was.
 *
 * It takes no focus as it shows (the layer moves the focus to it on the next Tab), and a press on it keeps the page's
 * selection: its `mousedown` does nothing of the browser's.
 *
 * Where the layer offers Quote (`quote`: the chat's replies, lib/selectionQuote.ts), Quote stands right of it, the same
 * pill, the pair placed as one and kept inside the surface; the Tab after the Comment button's reaches it. Too long for
 * the draft, it is refused (`aria-disabled`, and says why in its title).
 */
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MessageSquarePlus } from "lucide-react";
import { Quote } from "lucide-react";

import { MARKDOWN_COMMENTS_CLASS } from "../lib/commentDom.ts";
import { useT } from "../lib/i18n.ts";
import { buttonPlace } from "../lib/selectionField.ts";

/** The button's class: the layer finds it by it (its Tab, a press outside it). */
export const SELECTION_BUTTON_CLASS = "markdown-select-comment";
/** Quote's class beside it: a press on it is no press outside. */
export const SELECTION_QUOTE_CLASS = "markdown-select-quote";

/** How far it keeps from the surface's sides and bottom (`--space-2`). */
const INSET_PX = 8;
/** Between it and Quote (`--space-1`). */
const PAIR_GAP_PX = 4;

/** The Comment button in `surface`, placed at `ranges` (the selection's text, in document order); see the module comment. */
export function SelectionButton({ surface, ranges, onComment, quote }: {
  /** the scrolling surface it is portalled into */
  surface: HTMLElement;
  /** the selection's commentable text, in document order */
  ranges: readonly Range[];
  /** clicked (or Enter, Space): the layer opens the field over the selection */
  onComment: () => void;
  /** Quote beside it (`fits`: in the draft; clicked, the layer quotes or says why not); unset: Comment alone */
  quote?: { fits: boolean; onQuote: () => void };
}): ReactNode {
  const t = useT();
  const node = useRef<HTMLButtonElement | null>(null);
  const quoteNode = useRef<HTMLButtonElement | null>(null);
  const quoting = quote !== undefined;
  useLayoutEffect(() => {
    const button = node.current;
    const quoted = quoteNode.current;
    const body = surface;
    if (button === null) return;
    const place = (): void => {
      const rects = ranges.flatMap((range) => [...range.getClientRects()]).filter((rect) => rect.width > 0 || rect.height > 0);
      // its text is not drawn (re-rendered away): it stays where it was
      if (rects.length === 0) return;
      const outer = body.getBoundingClientRect();
      const placed = buttonPlace({
        first: { top: Math.min(...rects.map((rect) => rect.top)) },
        // the end: the last line box of the last range
        last: { bottom: Math.max(...rects.map((rect) => rect.bottom)), right: rects[rects.length - 1]!.right },
        view: { top: outer.top + body.clientTop, left: outer.left + body.clientLeft, width: body.clientWidth, height: body.clientHeight },
        scroll: { top: body.scrollTop, left: body.scrollLeft },
        // with Quote: the pair, as one
        button: { width: button.offsetWidth + (quoted === null ? 0 : PAIR_GAP_PX + quoted.offsetWidth), height: button.offsetHeight },
        inset: INSET_PX,
      });
      button.style.top = `${placed.top}px`;
      button.style.left = `${placed.left}px`;
      if (quoted === null) return;
      quoted.style.top = `${placed.top}px`;
      quoted.style.left = `${placed.left + button.offsetWidth + PAIR_GAP_PX}px`;
    };
    place();
    const resized = new ResizeObserver(place);
    resized.observe(button);
    if (quoted !== null) resized.observe(quoted);
    resized.observe(body);
    if (body.firstElementChild !== null) resized.observe(body.firstElementChild);
    return () => resized.disconnect();
  }, [surface, ranges, quoting]);
  return createPortal(<>
    <button
      ref={node}
      type="button"
      className={`${MARKDOWN_COMMENTS_CLASS} markdown-comment-pill ${SELECTION_BUTTON_CLASS}`}
      aria-label={t("Comment on the selection")}
      // the page's selection stays as it is (and the focus where it was) under a mouse's press
      onMouseDown={(event) => event.preventDefault()}
      onClick={onComment}
    >
      <MessageSquarePlus aria-hidden="true" />
      {t("Comment")}
    </button>
    {quoting && <button
      ref={quoteNode}
      type="button"
      className={`${MARKDOWN_COMMENTS_CLASS} markdown-comment-pill ${SELECTION_QUOTE_CLASS}`}
      aria-disabled={!quote.fits || undefined}
      title={quote.fits ? t("Quote it in your message|comment mode") : t("Too long to quote: shorten the message or the selection.|comment mode")}
      onMouseDown={(event) => event.preventDefault()}
      onClick={quote.onQuote}
    >
      <Quote aria-hidden="true" />
      {t("Quote|comment mode")}
    </button>}
  </>, surface);
}
