### Added
- Keys in the review, modelled on Gerrit's: `]` and `[` open the next and previous file in the
  order the tree shows them, `v` marks the open file as viewed (or not), `j` and `k` (or the
  arrows) move a line cursor through the diff or the file, Shift with them selects lines, and `c`
  or Enter opens a comment on the cursor's line or the selected lines. Escape drops a selection
  first, then closes the review. The keys are listed in the guide, and the Viewed button's
  tooltip names `v`.
- Space and Shift+Space (and PageDown, PageUp) scroll the reviewed file a page, also with the
  review's keys off; the arrows, `j` and `k` scroll a Markdown preview a line, and with the keys
  off the arrows scroll any file a line.
- `c` on a line that already has a comment opens that comment to edit instead of a new one.
- "Keyboard shortcuts" in the review's View options, on by default and kept per device, turns
  the review's keys off; Escape still closes the review.

### Changed
- A new comment's field on a whole line starts at the line's text instead of at the row's far
  right.
- A Markdown file in the review's Changed files now opens as its source, the diff, instead of
  its preview; All files still opens the preview. Preview or Source, once chosen, holds for every
  Markdown file in that list and is kept per device for each list.
