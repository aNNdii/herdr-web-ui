/**
 * The comments shown on the page's comment layers (components/MarkdownComments.tsx), for the composer's walk: a layer
 * registers what it shows on its element (the file viewer's body, the chat's scroller), and the walk asks the layers in
 * a view (the viewer, a pane's stack) which comments they show, in reading order, opens one there and marks it, without
 * knowing where a comment is drawn (a card, a count, its text). Needs only `contains` and `compareDocumentPosition` of
 * the elements, so it runs without a DOM.
 */

/** What a comment layer shows, as the walk reaches it. */
export interface ShownComments {
  /** the comments it shows now, in reading order */
  ids(): readonly string[];
  /**
   * opens comment `id` for the walk (its field in the comment mode, else read-only) and marks it by itself (its text in
   * the strong fill): no `mark(id)` is needed after it; false where its text is not drawn
   */
  open(id: string): boolean;
  /**
   * the walk stands on comment `id` (its text in the strong fill), or on none of this layer's (null: clears the mark, and
   * what the stop opened read-only). The walk calls it to clear (`markShownComment(view, null)`) as it moves on or ends
   */
  mark(id: string | null): void;
}

interface Registration { element: Element; shown: ShownComments }

const registrations: Registration[] = [];

/** `Node.DOCUMENT_POSITION_FOLLOWING`, `…_PRECEDING`: a constant of its own, as there is no `Node` without a DOM. */
const FOLLOWING = 4;
const PRECEDING = 2;

/**
 * `element` shows `shown` until the returned cleanup runs. A later registration on the same element takes over; the
 * earlier cleanup then leaves it alone.
 */
export function registerShownComments(element: Element, shown: ShownComments): () => void {
  const registration: Registration = { element, shown };
  const index = registrations.findIndex((other) => other.element === element);
  if (index >= 0) registrations.splice(index, 1, registration);
  else registrations.push(registration);
  return () => {
    const at = registrations.indexOf(registration);
    if (at >= 0) registrations.splice(at, 1);
  };
}

/** The registrations on `view` and inside it, in the document order of their elements. */
function within(view: Element): Registration[] {
  return registrations
    .filter(({ element }) => element === view || view.contains(element))
    .sort((a, b) => {
      const position = a.element.compareDocumentPosition(b.element);
      return position & FOLLOWING ? -1 : position & PRECEDING ? 1 : 0;
    });
}

/** The comments the layers in `view` show, in reading order: layer by layer, in the order of their elements. */
export function shownCommentIds(view: Element): string[] {
  return within(view).flatMap(({ shown }) => shown.ids());
}

/** Opens comment `id` on the layer in `view` that shows it (`ShownComments.open`); false where none does or it could not. */
export function openShownComment(view: Element, id: string): boolean {
  const found = within(view).find(({ shown }) => shown.ids().includes(id));
  return found?.shown.open(id) ?? false;
}

/** The walk stands on comment `id` in `view` (null: on none there): the layer showing it marks it, the others clear theirs. */
export function markShownComment(view: Element, id: string | null): void {
  for (const { shown } of within(view)) shown.mark(id !== null && shown.ids().includes(id) ? id : null);
}
