### Added
- The review's Branches fields offer the repository's branches: local ones first, then remote ones,
  each newest first. Typing filters the list, the arrow keys, Enter and Escape work it, and Enter
  takes any other name as typed (a tag, a commit, `HEAD~3`). A branch checked out in a worktree
  names its folder ("this worktree" for the review's own).
- Comments on any line of a branch comparison's diff: added, unchanged and removed lines, in the
  unified and the split view. A comment says which version it is on (`src/a.ts:12 @ feat/x
  (1a2b3c4)`, with the worktree the branch is checked out in), and one on removed lines names the
  base at the commit the branch started from. A comment follows its text when the branch moves on,
  and shows again whenever the same branch is compared. After updating, reload every open tab of
  the app: a tab still running the old version drops these comments when it saves its own.

### Changed
- A branch comparison in the review shows only the branch's own changes, from where it left its
  base, as a pull request does, not the base's later commits. Compare stands above Base, both start
  on the checked-out branch and the default base, and a choice loads at once: the Show changes
  button is gone. The review's title reads `feat/x → origin/next`.
- The review's Staged comparison says that comments on staged changes aren't supported.
