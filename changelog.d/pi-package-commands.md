### Added
- The pi command menu lists the skills and prompts of installed pi packages (`/flow`, `/skill:as-plan`
  …) and follows pi 1.3.0's rules for which local skill or prompt wins, the project's settings, the
  skill-command switch and the bundled `/llama` and `/mcp`.
- With `@tintinweb/pi-subagents` active, an `@` at the start of a pi message suggests the agents it
  can start, before the files; an image attached to such a message goes after the `@agent`.
- **Settings → Chat → Composer** has three switches, on by default and shared by every device:
  **Suggest agents after @** (off: a leading `@` lists only files), **Suggest skills after /** and
  **Suggest built-in commands after /** (off: the `/` menu leaves those rows out for every agent; a
  Codex `$` menu keeps its skills). A hidden command can still be typed and sent.
