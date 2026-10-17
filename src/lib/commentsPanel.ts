/**
 * Which pane's comments the comments panel (CommentsPanel.tsx) lists: one panel for the app, opened from the chat's
 * comments button (CommentsButton.tsx) or the composer's comments bar, closed by its own close button or Escape. It
 * remembers its opener, which takes the focus back when the panel closes with the focus inside it.
 */
import { useSyncExternalStore } from "react";

export interface CommentsPanelState {
  /** the comments' owner (`paneStorageId`) */
  owner: string;
  opener: HTMLElement | null;
  /** opens a file of a comment (`path:line`) in the review, for the pane the panel was opened from; null: none to open */
  openFile: ((path: string) => void) | null;
}

let state: CommentsPanelState | null = null;
const listeners = new Set<() => void>();

function set(next: CommentsPanelState | null): void {
  state = next;
  for (const listener of listeners) listener();
}

export const commentsPanel = {
  open(owner: string, opener: HTMLElement | null, openFile: ((path: string) => void) | null = null): void {
    set({ owner, opener, openFile });
  },
  close(): void {
    if (state !== null) set(null);
  },
  /** open for `owner`, or closed when it is open for it already */
  toggle(owner: string, opener: HTMLElement | null, openFile: ((path: string) => void) | null = null): void {
    set(state?.owner === owner ? null : { owner, opener, openFile });
  },
  current(): CommentsPanelState | null {
    return state;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useCommentsPanel(): CommentsPanelState | null {
  return useSyncExternalStore(commentsPanel.subscribe, commentsPanel.current);
}
