/**
 * The files the review tree lists (components/ReviewDialog.tsx): the scope's paths, narrowed by
 * the filter and, in Changed, by hiding viewed files. The file being shown stays through hiding,
 * so marking it viewed does not pull it out from under the reader, but a filter that misses it
 * still drops it. The note says why the list is short, in this order: nothing changed, the filter
 * matches nothing, every remaining file is viewed. A kept file is still listed under that note.
 */

export type ReviewListNote = "nothing-changed" | "no-match" | "all-viewed" | "all-matching-viewed";

export interface ReviewListInput {
  scope: "all" | "changed";
  paths: readonly string[];
  /** the filter as typed */
  query: string;
  /** viewed paths to leave out, or null when nothing is hidden; All never hides */
  hidden: ReadonlySet<string> | null;
  /** the file being shown, listed even when hidden */
  keep: string | null;
}

export interface ReviewList {
  paths: readonly string[];
  note: ReviewListNote | null;
  /** a filter narrows the list */
  filtered: boolean;
  /** the filter trimmed and lowercased, as matched */
  query: string;
}

export function reviewList({ scope, paths, query, hidden, keep }: ReviewListInput): ReviewList {
  const filter = query.trim().toLowerCase();
  const filtered = filter !== "";
  const matching = filtered ? paths.filter((path) => path.toLowerCase().includes(filter)) : paths;
  const hide = scope === "changed" ? hidden : null;
  const shown = hide === null ? matching : matching.filter((path) => !hide.has(path) || path === keep);
  let note: ReviewListNote | null = null;
  if (scope === "changed" && paths.length === 0) note = "nothing-changed";
  else if (matching.length === 0) note = "no-match";
  else if (hide !== null && matching.every((path) => hide.has(path))) note = filtered ? "all-matching-viewed" : "all-viewed";
  return { paths: shown, note, filtered, query: filter };
}
