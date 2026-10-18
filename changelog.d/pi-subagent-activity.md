### Added
- Pi panes running `@tintinweb/pi-subagents` show their agents and `SubagentWorkflow` runs: the
  pane's badge counts what still runs, the background list shows each agent with its turns, tool
  calls and tokens and each workflow with how many of its agents finished, and anything a pi that
  quit or restarted left behind shows as lost. A turn waits on its background work as it does on
  Claude Code. When an agent or a workflow ends, the chat shows its result as a card instead of
  the raw notification, and an `Agent` or `SubagentWorkflow` call reads as the description, agent
  type, model and prompt (or the workflow's name and script) instead of JSON. Claude Code panes'
  `Agent` calls read that way too. After a `/reload` what was running stays listed as running
  until pi restarts, because pi writes nothing to its session at a reload.

### Changed
- The background tasks and plan button moved into the strip under the input card, before the
  branch, where that strip shows. On a phone it stays in the card's row, drawn like the icon
  buttons beside it: an icon and a number, no words and no fill.
- BG has its own colour in every theme instead of the working blue: the theme's violet, or its
  orange where the theme's accent is violet. The sidebar's ring, the tab dot, the palette filter
  and the background tasks button take it while something runs.
- BG's ring in the sidebar and the BG badge breathe slowly while the work runs, slower and
  shallower than a working agent's dot. With reduced motion the sidebar's status marks hold still.
- A Pi or OmO pane at rest whose agents or workflows still run reads BG instead of DONE in the
  sidebar, the tabs and the palette, whichever turn started them. A workspace row in the sidebar
  counts the background tasks running in its panes, as an agent row does.
