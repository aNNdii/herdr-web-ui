/**
 * The composer's walk on a surface of the Markdown comment layer (MarkdownComments.tsx): the surface registers what it
 * shows (lib/shownComments.ts), in reading order, and a stop opens one of those comments there. A stop scrolls only the
 * surface, so the comment's text and its card or count are in view (lib/selectionField.ts `walkScroll`), then opens it as
 * a click would in the comment mode (a card's field, a count's fields: `edit`), and with the mode off stands on it
 * (`walkStop`: its text in the strong fill, a count's read-only cards open, until the walk moves on or ends) and has it
 * said (`announce`: nothing takes the focus); on a touch screen it opens the sheet (`sheet`, read-only with the mode
 * off). A comment whose text, card or count is not drawn is not opened: the walk then has its own way (a dialog).
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { walkScroll } from "../lib/selectionField.ts";
import type { CommentLayout } from "../lib/settings.ts";
import { registerShownComments } from "../lib/shownComments.ts";
import { marginPlace } from "./CommentMargin.tsx";
import type { CommentSource, LayerComment } from "./MarkdownComments.tsx";

/** Where the walk stands with the mode off: its comment, one `opening` per stop. */
export interface WalkStop {
  id: string;
  opening: number;
  /** whether it stands on a count (the margin's layout as it stopped): the count shows its read-only cards */
  count: boolean;
}

/**
 * The walk on the layer's surface (`host`, its element once it is there), with the layer's `source`, its margin's
 * `layout` (null: no margin, nothing to stop at) and `mode`, all as rendered; `coarse` says whether the device's pointer is a
 * finger's. `edit` opens the margin's fields on stored comments (the mode on), `sheet` the touch sheet; `announce` says
 * a comment a stop only stands on in the layer's live region. Returns where it stands (see the module comment).
 */
export function useMarkdownCommentWalk<T>({ host, source, layout, mode, coarse, edit, sheet, announce }: {
  host: HTMLElement | null;
  source: CommentSource<T> | null;
  layout: CommentLayout | null;
  mode: boolean;
  coarse: boolean;
  edit: (ids: readonly string[], walk: boolean, focus: string) => void;
  sheet: (source: CommentSource<T>, ids: readonly string[], readOnly: boolean, at?: string) => boolean;
  announce: (comment: LayerComment) => void;
}): { walkStop: WalkStop | null } {
  const [walkStop, setWalkStop] = useState<WalkStop | null>(null);
  const stops = useRef(0);
  // read by the registration, which the walk calls between renders
  const latest = useRef({ source, layout, mode, coarse, edit, sheet, announce });
  latest.current = { source, layout, mode, coarse, edit, sheet, announce };

  const open = useCallback((id: string): boolean => {
    const { source, layout: as, mode: modeOn, coarse: finger } = latest.current;
    const body = host;
    const stored = source?.comments.find((comment) => comment.id === id);
    if (source == null || as === null || body === null || stored === undefined) return false;
    const ranges = stored.ranges();
    const place = marginPlace(body, id, as);
    const rects = ranges.flatMap((range) => [...range.getClientRects()]).filter((rect) => rect.width > 0 || rect.height > 0);
    if (place === null || rects.length === 0) return false;
    // the text and its card or count in the middle of the surface, else the text's end and the card at its bottom; only
    // the surface scrolls, never the page
    const text = { top: Math.min(...rects.map((rect) => rect.top)), bottom: Math.max(...rects.map((rect) => rect.bottom)) };
    const view = { top: body.getBoundingClientRect().top + body.clientTop, height: body.clientHeight };
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    body.scrollBy({ top: walkScroll(text, place.box.getBoundingClientRect(), view), behavior });
    const { ids } = place;
    // a touch screen: the sheet, on the walked comment (read-only with the mode off)
    if (finger) {
      setWalkStop(null);
      return latest.current.sheet(source, ids, !modeOn, id);
    }
    if (modeOn) {
      setWalkStop(null);
      // a card's field, or the fields of its count, in reading order, the walked comment's focused
      latest.current.edit(ids, true, id);
      return true;
    }
    // read-only: stood on, and a count's comments shown as cards beside it
    setWalkStop({ id, opening: ++stops.current, count: as === "counts" });
    latest.current.announce(stored);
    return true;
  }, [host]);

  // the surface tells the composer's walk what it shows, in reading order, and lets it open and mark those comments
  const sourceOwner = source?.owner ?? null;
  useEffect(() => {
    if (host === null || sourceOwner === null) return;
    return registerShownComments(host, {
      // each drawn comment, in the source's order, which is reading order (`CommentSource.comments`): only ranges still in
      // the document (a range whose text was removed is drawn nowhere until the next rebuild)
      ids: () => (latest.current.source?.comments ?? []).flatMap((comment) => {
        const first = comment.ranges()[0];
        return first === undefined || !first.startContainer.isConnected ? [] : [comment.id];
      }),
      // a stop opens and stands on its comment itself; the walk marks only to clear (`null`: it moved on, or ended). A
      // mark elsewhere stands on that comment, its count closed
      open,
      mark: (id) => {
        if (id === null) {
          setWalkStop(null);
          return;
        }
        const opening = ++stops.current;
        setWalkStop((now) => now?.id === id ? now : { id, opening, count: false });
      },
    });
  }, [host, sourceOwner, open]);
  // the surface taking no comments now (another view, file): it stands on none of them
  useEffect(() => {
    if (sourceOwner === null) setWalkStop(null);
  }, [sourceOwner]);

  return { walkStop };
}
