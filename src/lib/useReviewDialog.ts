/**
 * App's state for the review (components/ReviewDialog.tsx): the pane, folder and file it opens on, or none while it is
 * closed. Every file a chat, the Files dialog or a diff names opens there (`reviewFile`); the composer's walk to a file
 * comment opens the file viewer at that comment instead (`viewFileComment`, lib/fileCommentNav.ts). A file of the
 * fork's own, so App takes it with one hook call and stays under its hook ceiling (src/app-hooks.test.ts, docs/fork.md).
 */
import { useCallback, useState } from "react";

import type { FileComment } from "./fileComments.ts";
import type { useFileViewer } from "./useFileViewer.ts";

/** The pane a review opens for, and the folder it reviews (its foreground folder as it is now) */
export interface ReviewTarget { paneId: string; directory: string | null; machineId: string }

/** An opened review: `path` is the file it opens on (null: the changes list), `id` mounts a new dialog per opening */
export interface ReviewOpening extends ReviewTarget { path: string | null; id: number }

export function useReviewDialog(openFile: ReturnType<typeof useFileViewer>["openFile"]) {
  const [review, setReview] = useState<ReviewOpening | null>(null);
  const reviewFile = useCallback((path: string, target: ReviewTarget) => setReview({ ...target, path, id: Date.now() }), []);
  // the composer's walk stops at a file comment: its file opens in the viewer, at that comment
  const viewFileComment = useCallback((paneId: string, machineId: string, comment: FileComment) => {
    openFile({ path: comment.path, paneId, machineId, comment: comment.id });
  }, [openFile]);
  return { review, setReview, reviewFile, viewFileComment };
}
