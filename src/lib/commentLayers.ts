/**
 * Which highlight layer each comment's text is painted on (`comment-layer-0` … `-3`, lib/commentHighlight.ts). Every
 * layer is a highlight of its own, and Chromium paints separate highlights over one another, so where two comments
 * overlap on different layers their translucent fills add up and the overlap reads darker; ranges inside one highlight
 * do not stack. Comments that do not overlap can share a layer, so a pool of four serves any number of them; a fifth
 * comment over the same text reuses the last layer. Pure: the caller says how two positions compare (numbers in a
 * test, `Range` boundaries with `compareBoundaryPoints` in the DOM).
 */

/** How many layer highlights there are. */
export const LAYER_COUNT = 4;

/**
 * Each span's layer, by id: greedy in start order (ties keep the given order), the lowest layer whose last span ends at
 * or before this one's start, else `LAYER_COUNT - 1`. A span starting exactly where another ends shares its layer.
 */
export function assignLayers<T>(spans: readonly { id: string; start: T; end: T }[], compare: (a: T, b: T) => number): Map<string, number> {
  const layers = new Map<string, number>();
  /** where each layer's last span ends; undefined while it is empty */
  const ends: (T | undefined)[] = [];
  const ordered = [...spans].sort((a, b) => compare(a.start, b.start));
  for (const span of ordered) {
    let layer = 0;
    while (layer < LAYER_COUNT - 1 && ends[layer] !== undefined && compare(ends[layer]!, span.start) > 0) layer += 1;
    const last = ends[layer];
    // the last layer takes whatever finds no free one: its end is the furthest of all it holds
    ends[layer] = last === undefined || compare(span.end, last) > 0 || compare(last, span.start) <= 0 ? span.end : last;
    layers.set(span.id, layer);
  }
  return layers;
}
