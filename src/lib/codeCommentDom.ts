/**
 * The DOM side of the code view's inline comments: the line element a target is in, where a line's text rows are, and
 * the room after a line where its cards go. A line's room is CSS (`.file-viewer-text .hl-line[data-comment-room]`
 * in FileViewer.css), written here as an attribute and a custom property on the `.hl-line`, so it adds
 * no text and the `<pre>`'s text stays the file's.
 */

export const COMMENT_ROOM_ATTR = "data-comment-room";
const ROOM_PROPERTY = "--comment-room";

/** The `.hl-line` with a `data-source-line` that `target` is in, with its line number. */
export function lineOf(target: EventTarget | null): { line: number; element: HTMLElement } | null {
  if (!(target instanceof Node)) return null;
  const start = target instanceof Element ? target : target.parentElement;
  const element = start?.closest<HTMLElement>(".hl-line[data-source-line]");
  const line = Number(element?.dataset["sourceLine"]);
  return element && Number.isInteger(line) ? { line, element } : null;
}

/** The body's scrolled content's origin, in client pixels: the layer's coordinates are the content's. */
export function originOf(body: HTMLElement): { left: number; top: number } {
  const box = body.getBoundingClientRect();
  return { left: box.left + body.clientLeft - body.scrollLeft, top: box.top + body.clientTop - body.scrollTop };
}

/**
 * The client top and bottom of the text rows of `element` (a `.hl-line`), without the room after it: a line with a
 * room is one box (its rows, then the room); an inline one has a box per row, each its glyphs' height, centred on its
 * row, which is a line height tall.
 */
export function textRows(element: HTMLElement): { top: number; bottom: number; lineHeight: number } | null {
  const lineHeight = parseFloat(getComputedStyle(element).lineHeight);
  if (element.hasAttribute(COMMENT_ROOM_ATTR)) {
    const box = element.getBoundingClientRect();
    return { top: box.top, bottom: box.bottom - parseFloat(getComputedStyle(element).paddingBottom), lineHeight };
  }
  const rects = element.getClientRects();
  const first = rects[0];
  const last = rects[rects.length - 1];
  if (first === undefined || last === undefined) return null;
  return { top: first.top + first.height / 2 - lineHeight / 2, bottom: last.top + last.height / 2 + lineHeight / 2, lineHeight };
}

/**
 * The code line at a pointer on `target` (at client `y`) in the code's `pre`: the line it is on, else, beside a line's
 * text (right of a short line, the gutter's gap), the line whose number is level with it. Null off the lines (a room).
 */
export function lineAt(pre: HTMLElement, target: EventTarget | null, y: number): number | null {
  if (!(target instanceof Node) || !pre.contains(target)) return null;
  const on = lineOf(target);
  if (on !== null) return on.line;
  const code = pre.querySelector("code");
  if (code === null) return null;
  const left = Math.max(code.getBoundingClientRect().left, pre.getBoundingClientRect().left + pre.clientLeft);
  return lineOf(document.elementFromPoint(left + 1, y))?.line ?? null;
}

/** The `.hl-line` of source line `line` in the code's `<pre>`. */
export function lineElement(pre: HTMLElement, line: number): HTMLElement | null {
  return pre.querySelector<HTMLElement>(`.hl-line[data-source-line="${line}"]`);
}

/** The first and last source line the code's `<pre>` draws; null without lines. */
export function lineBounds(pre: HTMLElement): { first: number; last: number } | null {
  const elements = pre.querySelectorAll<HTMLElement>(".hl-line[data-source-line]");
  const first = Number(elements[0]?.dataset["sourceLine"]);
  const last = Number(elements[elements.length - 1]?.dataset["sourceLine"]);
  return Number.isInteger(first) && Number.isInteger(last) ? { first, last } : null;
}

/** The first line that starts inside `body`'s view (else the last one, when all start above it); null without lines. */
export function firstVisibleLine(pre: HTMLElement, body: HTMLElement): number | null {
  const elements = pre.querySelectorAll<HTMLElement>(".hl-line[data-source-line]");
  const top = body.getBoundingClientRect().top + body.clientTop;
  // the lines are in order from the top: the first that starts at or below the view's top
  let low = 0;
  let high = elements.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (elements[middle]!.getBoundingClientRect().top >= top) high = middle;
    else low = middle + 1;
  }
  const found = elements[Math.min(low, elements.length - 1)];
  const line = Number(found?.dataset["sourceLine"]);
  return Number.isInteger(line) ? line : null;
}

/** How many lines of `line`'s height fit in `body`'s view, at least one: a page for PageUp and PageDown. */
export function linesPerPage(pre: HTMLElement, body: HTMLElement, line: number): number {
  const element = lineElement(pre, line);
  const lineHeight = element === null ? NaN : parseFloat(getComputedStyle(element).lineHeight);
  return lineHeight > 0 ? Math.max(1, Math.floor(body.clientHeight / lineHeight)) : 1;
}

/**
 * `lineElement` for many lines of one render: the `<pre>`'s line elements are read once, so a pass over a few hundred
 * comments in a long file does not query all of its lines per comment. The code's lines are in order from line 1
 * (CodeLines `firstLine`); a line found elsewhere is looked up.
 */
export function lineElementIndex(pre: HTMLElement): (line: number) => HTMLElement | null {
  const elements = pre.querySelectorAll<HTMLElement>(".hl-line[data-source-line]");
  return (line) => {
    const at = elements[line - 1];
    return at !== undefined && at.dataset["sourceLine"] === String(line) ? at : lineElement(pre, line);
  };
}

/**
 * Gives each line in `rooms` (source line to pixels) its room and takes it off every other line that
 * has one. Only a line whose room changes is written, so a style recalculation is not forced for the
 * rest.
 */
export function setCommentRooms(pre: HTMLElement, rooms: ReadonlyMap<number, number>): void {
  const wanted = new Map<HTMLElement, string>();
  const elementOf = rooms.size === 0 ? null : lineElementIndex(pre);
  for (const [line, px] of rooms) {
    const element = elementOf?.(line) ?? null;
    if (element) wanted.set(element, `${px}px`);
  }
  for (const element of pre.querySelectorAll<HTMLElement>(`.hl-line[${COMMENT_ROOM_ATTR}]`)) {
    if (!wanted.has(element)) {
      element.removeAttribute(COMMENT_ROOM_ATTR);
      element.style.removeProperty(ROOM_PROPERTY);
    }
  }
  for (const [element, room] of wanted) {
    if (element.style.getPropertyValue(ROOM_PROPERTY) === room && element.hasAttribute(COMMENT_ROOM_ATTR)) continue;
    element.setAttribute(COMMENT_ROOM_ATTR, "");
    element.style.setProperty(ROOM_PROPERTY, room);
  }
}
