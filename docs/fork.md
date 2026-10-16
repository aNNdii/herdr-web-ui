# The fork

`aNNdii/herdr-web-ui` is a fork of [devswha/herdr-web-ui](https://github.com/devswha/herdr-web-ui).
This page is the fork's own: upstream has no copy of it, so it never conflicts.

## Branches

- **`main`** mirrors upstream's `main`. It only ever fast-forwards to it and holds nothing of the
  fork's; a branch meant for an upstream pull request starts from it.
- **`next`** is the fork's product: upstream's `main` merged in, plus the fork's features. It is the
  default branch, the base of the fork's pull requests and what its installs run.
- **`feat/*`, `fix/*`** branch from `next` for work only the fork ships, or from `main` for work
  offered upstream. One branch per change: no `-next` twin of an upstream branch, which only resolves
  every conflict twice (merge the upstream branch into `next` instead).
- **`sync/upstream-auto`** belongs to the sync workflow; **`sync/upstream-main-next`** to a sync by hand.

## Releases

Every push to `next` is released as `vX.Y.Z-next.N` by
[`fork-release-next.yml`](../.github/workflows/fork-release-next.yml), after CI passed on that exact
commit. `X.Y.Z` is the upstream version in `package.json`; `N` counts that version's next releases
from 1 ([`scripts/fork/next-release.ts`](../scripts/fork/next-release.ts) picks the tag and writes
the notes). git's version sort puts `v0.4.11-next.2` after upstream's `v0.4.11` and before `v0.4.12`,
which is the order the fork's installs follow (`RELEASE_TAG` in `server/updater.ts`).

- Never push a `v*` or `remote-v*` tag to the fork by hand: installs update from tags alone. That
  includes upstream's own `vX.Y.Z` tags, which `git fetch upstream` brings in and `git push --tags`
  would carry over, moving every install onto plain upstream. The
  [`pre-push`](../scripts/fork/pre-push) hook refuses such a push.
- The repository variable `NEXT_AUTO_RELEASE=false` leaves pushes unreleased; **Actions → Fork next
  release → Run workflow** on `next` still releases the branch's head.

## Syncing with upstream

[`fork-upstream-sync.yml`](../.github/workflows/fork-upstream-sync.yml) runs daily (and on demand):

1. `main` fast-forwards to upstream's `main`.
2. When merging upstream's `main` into `next` has **no conflict**, the merge is pushed to
   `sync/upstream-auto` and opened as a pull request into `next`. With `NEXT_SYNC_AUTOMERGE=true` it
   merges itself once CI passes, and the release follows.
3. When it **conflicts**, one issue labelled `upstream-sync` names the files; the run updates it
   while the conflict lasts and closes it once `next` holds upstream again.

`bun scripts/fork/upstream-sync.ts status --fetch` (or `git upstream-status`) prints the same view
locally: how far `main` and `next` are behind, and which files a merge would conflict in. It merges
in memory only and writes nothing but the fetched remote-tracking refs.

### Syncing by hand

In a worktree of its own, so the main checkout stays on `next`:

```sh
git fetch --no-tags upstream main && git fetch origin
git worktree add ../herdr-web-ui-worktrees/sync-upstream-main-next sync/upstream-main-next
cd ../herdr-web-ui-worktrees/sync-upstream-main-next
git merge --ff-only origin/next
git merge --no-commit --no-ff upstream/main   # zdiff3 markers; rerere replays known resolutions
# resolve, then: bun run check fast
git commit -m "$(bun scripts/fork/upstream-sync.ts status | sed -n 's/^merge: .* — //p')"
```

Push the branch and open a pull request into `next`, merged with a merge commit (never squashed,
which would drop upstream's history from `next`).

## Keeping merges small

Upstream merges dozens of pull requests a day, often in the same files the fork extends. A conflict
comes from the fork's lines in an upstream file, so the fork keeps as few of them as it can:

- **Its own files.** A feature lives in files upstream does not have (`ChatComments.tsx`,
  `lib/commentMargin.ts`, …); an upstream file gets one line that hooks it in: an import, a hook
  call, a component.
- **Never reshape an upstream function.** Add a parameter after upstream's, or wrap the function in
  a file of the fork's. Turning `submit()`'s parameters into an options object cost three conflicts
  in one sync, one for each parameter upstream added since.
- **Separate lines for additions.** An icon the fork uses gets an `import { … } from "lucide-react"`
  line of its own, never a name in upstream's import line; the same for any long import list.
- **Changelog** entries go to `changelog.d/` as fragments, never into `CHANGELOG.md`.
- **Removed upstream, removed here.** When upstream drops a feature or setting the fork built on,
  the fork follows rather than keeping a copy alive in upstream's files.
- **Offer what is general upstream** (after agreeing on it in an issue, as upstream's
  `CONTRIBUTING.md` asks): every change upstream takes leaves the fork's diff.

## One-time setup

On GitHub (Settings of the fork):

- **General → Default branch:** `next` (scheduled workflows run from the default branch).
- **Secrets → Actions → `FORK_SYNC_TOKEN`:** a fine-grained token of the fork's owner for this
  repository only, with Contents, Pull requests, Issues and Workflows read and write. `GITHUB_TOKEN`
  cannot push upstream's workflow changes, and a pull request it opens runs no CI.
- **Variables → Actions:** `NEXT_SYNC_AUTOMERGE=true` to merge clean syncs without a click (needs
  **General → Allow auto-merge** and a ruleset on `next` requiring the CI checks);
  `NEXT_AUTO_RELEASE=false` to release only on demand.
- **Actions:** disable upstream's **Website** workflow, which deploys upstream's site after CI on
  `main`, and **Release**, which tags plain `vX.Y.Z` versions.

Locally, once per clone:

```sh
git config rerere.enabled true          # replays a conflict's resolution the next time it appears
git config merge.conflictStyle zdiff3   # markers show the common ancestor too
git config alias.upstream-status '!bun scripts/fork/upstream-sync.ts status --fetch'
cp scripts/fork/pre-push "$(git rev-parse --git-common-dir)/hooks/pre-push"
```

Never set `rerere.autoUpdate`: it would stage the replayed resolutions.
