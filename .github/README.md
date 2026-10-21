# herdr web ui · aNNdii's fork

This is a fork of [devswha/herdr-web-ui](https://github.com/devswha/herdr-web-ui), the browser and
phone client for [herdr](https://github.com/herdrdev/herdr). What the app is, how it works, its
requirements and its documentation are in **[upstream's README](https://github.com/devswha/herdr-web-ui#readme)**.

This page lists only what the fork adds or does differently. Its default branch, `next`, is
upstream's `main` plus the features below. A workflow merges upstream every day, so `next` stays
current with upstream ([how the fork works](../docs/fork.md)).

## Install

Upstream's one-line installers (`herdrweb.dev/install.sh`, `install.ps1`) install upstream, not this
fork. Install the fork as a herdr plugin, from its newest `vX.Y.Z-next.N` release:

```sh
ref=$(git ls-remote --tags --refs --sort=-v:refname https://github.com/aNNdii/herdr-web-ui.git 'v*-next.*' | head -1 | sed 's#.*refs/tags/##')
herdr plugin install aNNdii/herdr-web-ui --ref "$ref"
```

The requirements are upstream's: herdr 0.9.0+, Bun 1.4+ and Node 18+ (no Node on Windows). See
[upstream's install section](https://github.com/devswha/herdr-web-ui#install) and
[INSTALL.md](../INSTALL.md). Then run herdr's **Start herdr web ui** action.

- **Plugin id `anndii.herdr-web-ui`.** It is a separate plugin from upstream's
  `devswha.herdr-web-ui` and can be installed beside it; the second one takes another port when
  7317 is taken. Usually you want one: `herdr plugin uninstall devswha.herdr-web-ui`.
- **Updates** follow the fork's `vX.Y.Z-next.N` releases, which `next` gets on every push after its
  checks pass. `X.Y.Z` is the upstream version it is built on. A source checkout updates on `next`
  as upstream's does on `main`.
- **Remote PCs** get their bridge from the fork's own `remote-v*` releases, named after the server
  code they carry. After an update, reconnect a PC to install the new bridge; herdr and its panes
  keep running.

## What the fork adds

### Review changes

A review for every file of the pane's repository: its tree beside the file or its diff, built on
`@pierre/trees` and `@pierre/diffs`. Open it from the header's **Review** button, the More menu,
the command palette (**Review changes**) or the Files dialog.

- **Comparisons:** Uncommitted changes (staged, unstaged and untracked, each file once), Staged
  changes, or a branch against its base as a pull request shows it. The branch pickers list local
  and remote branches with their last commit and worktree, and take a tag or a commit as typed. A
  branch checked out in a worktree can include that worktree's uncommitted files.
- **Comments on any line** of a file or a diff, in the unified and the split view, also on a
  branch comparison's removed lines. A comment names the version it is on, follows its text when
  the branch moves on, and goes with the pane's next message.
- **Viewed marks** per changed file, which clear when the file changes again. **View options**
  hide viewed files, show ignored files and list new files apart.
- **A file tree for long paths:** it shortens folder chains and keeps file names' ends, its column
  can be resized, and every row shows its full path on hover.
- **Keys, modelled on Gerrit:** `]` / `[` for the next and previous file, `v` for Viewed, `j` / `k`
  for a line cursor (Shift selects lines), `c` to comment, Space to page. They can be switched off
  in **View options** ([all keys](../docs/guide.md#review-keys)).
- Images, video, audio, PDFs and very large files open in the file viewer inside the review. Files
  opened from the Files dialog, the repository diff or a chat link open in the review.

### Comments on replies, files and code

One app-wide comment mode, switched in the file viewer's header and beside Find in the chat:

- **Select text** in an agent's reply, a Markdown preview or a file's code to comment on it. The
  comments show as cards in the margin or as counts beside the lines, each with its own highlight.
- **Phones and tablets** use the app's own selection and a comment sheet instead of the system menu.
- **The next message carries them**, each quoting what it is on. They only ever go to an agent:
  a shell gets the typed text alone.
- **A comments panel**, opened from the composer's comments bar, lists the pane's comments by
  file, to edit, delete (with Undo) or open at their lines.
- **Settings → Comments** holds every comment setting. Turning comments off asks first, then
  deletes them on that device.

### Pi

- **Pi package commands:** the `/` menu lists the skills and prompts of installed pi packages and
  follows pi's rules for which one wins.
- **`@agent` suggestions:** with `@tintinweb/pi-subagents`, an `@` at the start of a message
  suggests its agents. **Settings → Chat → Composer** switches these suggestions off.
- **Subagents and workflows:** a pi pane shows its running subagents and `SubagentWorkflow` runs,
  with turns, tool calls and tokens, and their results as cards in the chat.
- **Background work** has its own colour and reads BG instead of DONE while it runs.

### Smaller changes

- The sidebar's **Install app** has an × to hide it. **Settings → Phone & devices** shows it again.
- A numbered list in the chat makes room for numbers past 9 and 99.

## Contributing

Pull requests for the fork go into `next`. A change that suits upstream goes to
[devswha/herdr-web-ui](https://github.com/devswha/herdr-web-ui) instead, as its
[CONTRIBUTING.md](../CONTRIBUTING.md) asks. Branches, releases and the upstream sync are described in
[docs/fork.md](../docs/fork.md).

## License

MIT, as upstream: [LICENSE](../LICENSE).
