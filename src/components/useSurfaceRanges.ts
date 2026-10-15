/**
 * The comment sources' side of `LayerComment.ranges` (MarkdownComments.tsx): the preview's (FileComments.tsx
 * `usePreviewCommentSource`) and the chat's (ChatComments.tsx `useChatCommentSource`) follow their comments' ranges with it.
 */
import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";

import { watchSurfaceRanges } from "../lib/commentHighlight.ts";

const NO_RANGE_MAP: ReadonlyMap<string, readonly Range[]> = new Map();

/**
 * For a source's `LayerComment.ranges`: each comment's ranges as the highlights on `surface` last built them, followed
 * (lib/commentHighlight.ts `watchSurfaceRanges`) while `active`, its element as rendered; else what `measure` finds now
 * (a comment the highlights have not been rebuilt for yet: just saved, an edit being a comment of a new id). The
 * function returned is stable.
 */
export function useSurfaceRanges(surface: RefObject<Element | null>, active: boolean): (id: string, measure: () => readonly Range[]) => readonly Range[] {
  const ranges = useRef(NO_RANGE_MAP);
  const watched = useRef<{ view: Element; stop: () => void } | null>(null);
  // after every render: the surface's element followed as it changes, and dropped while inactive
  useLayoutEffect(() => {
    const view = active ? surface.current : null;
    if ((watched.current?.view ?? null) === view) return;
    watched.current?.stop();
    watched.current = null;
    ranges.current = NO_RANGE_MAP;
    if (view !== null) watched.current = { view, stop: watchSurfaceRanges(view, (next) => { ranges.current = next; }) };
  });
  useLayoutEffect(() => () => {
    watched.current?.stop();
    watched.current = null;
    ranges.current = NO_RANGE_MAP;
  }, []);
  return useCallback((id, measure) => ranges.current.get(id) ?? measure(), []);
}
