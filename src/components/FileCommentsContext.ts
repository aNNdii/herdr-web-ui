/**
 * What a view of a file in the viewer needs of its comment layer (FileComments.tsx). A module of its
 * own so a view can read it without importing the layer, which imports the comment popover, which
 * imports `Markdown.tsx`.
 */
import { createContext } from "react";

import type { measureFileSelection } from "../lib/fileCommentDom.ts";

/** A selection in the file the viewer can comment on (`measureFileSelection`). */
export type MeasuredFileSelection = ReturnType<typeof measureFileSelection> & {};

/** Whether the view of the file takes comments: its lines then carry their numbers, for a click or a selection to name. */
export const FileCommentsContext = createContext(false);
