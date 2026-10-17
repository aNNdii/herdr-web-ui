### Added
- A review for every file: the repository's tree (all files, or the changed ones against the working
  tree, the index or two branches) beside the file or its diff, built on `@pierre/diffs` and
  `@pierre/trees`. Files outside the pane's repository and outside any repository open there too;
  images, video, audio, PDFs and very large text show in the file viewer's view inside it.
- Comments on a file's lines in the review, by selecting text (desktop) or tapping or long-pressing
  a line (touch), in the same comment box as the chat and the Markdown preview. They go with the
  pane's next message.
- A comments panel, opened from the composer's comments bar: the pane's comments grouped by file,
  each with its lines as highlighted code, to edit, delete (with Undo) or open in the review at
  their lines.
- Changed files can be marked as viewed in the review; the mark goes away when the file changes
  again.
- The review can list files git ignores.

### Changed
- Files opened from the Files dialog, the repository diff or a chat link open in the review instead
  of the file viewer.
