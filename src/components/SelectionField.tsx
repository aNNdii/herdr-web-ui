/**
 * The box of a comment field over its text, for the Markdown comment layer (MarkdownComments.tsx): the field over a
 * selection, and a count's fields (useMarginFields.tsx), stacked and placed as one over the first one's text. It is
 * portalled into the scrolling surface, whose content it scrolls with, and placed from the text's line boxes: under
 * the last line, `FIELD_GAP_PX` clear, centred on where the text ends; above the first line, growing upward
 * (`data-above`, MarkdownComments.css), where there is no room below (lib/selectionField.ts `fieldPlace`). The side is
 * chosen once, as it opens. It is placed again as it
 * grows and as the surface or its content is resized (the text reflows), and never moved by a transition. It is
 * scrolled into view once, as it opens, by the surface alone and just far enough (`revealBy`, `INSET_PX` to spare).
 * Its text not drawn (re-rendered away), it stays where it was.
 */
import { useLayoutEffect, type MutableRefObject, type ReactNode, type RefObject } from "react";

import { MARKDOWN_COMMENTS_CLASS } from "../lib/commentDom.ts";
import { fieldPlace, revealBy } from "../lib/selectionField.ts";

/** How far the field keeps from the surface's sides, and from its edges when it is scrolled into view (`--space-2`). */
const INSET_PX = 8;

/** The field's box in `surface`, placed from `ranges` (the text it is on, set as it opens); see the module comment. */
export function SelectionField({ surface, ranges, box, reveal = true, children }: {
  /** the scrolling surface it is portalled into */
  surface: HTMLElement;
  /** the text it is placed over, in document order: set by its opener before it opens, not changed while it is open */
  ranges: RefObject<readonly Range[]>;
  /** its box, for its opener's queries (the field in it) */
  box: MutableRefObject<HTMLDivElement | null>;
  /** whether it scrolls itself into view as it opens: not where the walk scrolls to it (a smooth scroll it would cut short) */
  reveal?: boolean;
  children: ReactNode;
}): ReactNode {
  useLayoutEffect(() => {
    const node = box.current;
    const body = surface;
    if (node === null) return;
    let above: boolean | undefined;
    let revealed = !reveal;
    const place = (): void => {
      const rects = ranges.current.flatMap((range) => [...range.getClientRects()]).filter((rect) => rect.width > 0 || rect.height > 0);
      // its text is not drawn (re-rendered away): it stays where it was
      if (rects.length === 0) return;
      const outer = body.getBoundingClientRect();
      const view = { top: outer.top + body.clientTop, left: outer.left + body.clientLeft, width: body.clientWidth, height: body.clientHeight };
      const placed = fieldPlace({
        first: { top: Math.min(...rects.map((rect) => rect.top)), left: rects[0]!.left },
        last: { bottom: Math.max(...rects.map((rect) => rect.bottom)), right: rects[rects.length - 1]!.right },
        view,
        scroll: { top: body.scrollTop, left: body.scrollLeft },
        field: { width: node.offsetWidth, height: node.offsetHeight },
        inset: INSET_PX,
        above,
      });
      above = placed.above;
      node.style.top = `${placed.top}px`;
      node.style.left = `${placed.left}px`;
      node.toggleAttribute("data-above", placed.above);
      if (revealed) return;
      revealed = true;
      const by = revealBy(node.getBoundingClientRect(), view, INSET_PX);
      if (by !== 0) body.scrollBy({ top: by });
    };
    place();
    const resized = new ResizeObserver(place);
    resized.observe(node);
    resized.observe(body);
    if (body.firstElementChild !== null) resized.observe(body.firstElementChild);
    return () => resized.disconnect();
  }, [surface, ranges, box, reveal]);
  return <div ref={box} className={`${MARKDOWN_COMMENTS_CLASS} markdown-comments-field`}>{children}</div>;
}
