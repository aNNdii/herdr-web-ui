### Added
- "Show uncommitted changes" in the review's View options, for a Branches comparison whose Compare
  branch is checked out in a worktree (the review's own included), on by default: the diff then
  runs from where the branch left its base to that worktree's files on disk, untracked ones too,
  and the whole review reads that worktree's folder. Comments then go on the files on disk, so
  removed lines can't take one; the hint says to turn the option off for that. When the branch is
  no longer checked out there, a note under the comparison says so and the review leaves the
  uncommitted changes out.
- "List new files separately" in the review's View options, off by default and kept per device:
  untracked files follow the other changed files under a "New files" heading, in a tree of their
  own folders.
- The review's branch pickers name each branch's last commit as hash, age and subject, the age in
  the app's language, and the worktree a branch is checked out in.
- "Review changes" opens the review from the command palette on every width, from a Review button
  beside Files in the header on wider windows, and from the More menu on narrower ones, whenever a
  pane is selected.

### Changed
- The review says what it compares in one line under its title: "Uncommitted changes", "Staged
  changes", or Compare vs Base under Branches. Each part opens its picker right under it (a bottom
  sheet on a phone): Compare's has Uncommitted, Staged and Branches on top, both have a search
  field over the local and remote branches, and Enter also takes a tag or a commit as typed. The
  Compare segments and the two branch fields are gone from the file list.
- The review's eye buttons give way to a View options menu beside the filter, each option with a
  short line saying what it does: Show viewed files (off is the former Hide viewed files, kept as
  it was set) and Show ignored files. A dot on the button says an option differs from its default.
- The review's Uncommitted comparison replaces Working tree and is chosen when the review opens:
  it shows every change since the last commit, staged, unstaged and untracked, each file once, and
  takes comments like Working tree did. Staged files now show up there too; Viewed marks keep
  track of what was already checked. The Files dialog's Changes tab offers Uncommitted, Staged and
  Commits.
- A PC whose bridge is older and can't compare uncommitted changes still gets a review: it shows
  the unstaged changes, or only the branch's commits, with a quiet note under the comparison that
  says so.
- The Files dialog's Review button is named "Review changes".

### Fixed
- The review's branch fields no longer flicker the first time the review opens: the comparison
  line and its pickers replace them.
- An untracked file swapped for a FIFO while the review reads it no longer freezes the bridge; the
  file shows as one that can't be displayed.
