/**
 * What a view of a file in the viewer needs of its comment layer (FileComments.tsx). A module of its
 * own so `Markdown.tsx` can draw a preview's notes without importing the layer, which imports the
 * comment editor, which imports `Markdown.tsx`.
 */
import { createContext, type ReactNode } from "react";

import type { measureFileSelection } from "../lib/fileCommentDom.ts";

/** A selection in the file the viewer can comment on (`measureFileSelection`). */
export type MeasuredFileSelection = ReturnType<typeof measureFileSelection> & {};

/** What a view of the file needs of the comment layer, to draw its notes and open the form. */
export interface FileCommentsApi {
  /** the cards (and the open form) that hang under the host starting at this line; null for none */
  notesFor(hostFirstLine: number): ReactNode;
  /** opens the form for a comment on the selected text */
  openSelection(found: MeasuredFileSelection): void;
  /** a form is open */
  editing: boolean;
  /** the hosts (by first line) that have notes now: a view of thousands of lines asks only these */
  noted: readonly number[];
}

export const FileCommentsContext = createContext<FileCommentsApi | null>(null);
