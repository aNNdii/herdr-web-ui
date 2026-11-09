### Fixed
- A Pi pane's running subagents now come from pi itself, through the web UI's pi extension: after a
  `/reload` the agents it aborted no longer show as running until pi restarts, its workflows end
  once pi has run nothing for about ten seconds, and an agent another extension, the scheduler or
  an @mention started shows while it runs. Without the extension, or with one installed before
  this (run `bun scripts/install-pi-integration.ts` again and restart pi), the session file alone
  is read, as before.
