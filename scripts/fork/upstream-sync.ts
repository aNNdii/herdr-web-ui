/**
 * The fork's upstream sync (docs/fork.md): where `main` and `next` stand against upstream's main,
 * and whether merging it into `next` conflicts.
 *
 *   bun scripts/fork/upstream-sync.ts [status] [--fetch] [--json] [--next <ref>] [--main <ref>] [--upstream <ref>]
 *
 * `--fetch` first fetches upstream's main and origin's main and next, without tags: upstream's
 * `vX.Y.Z` tags must never reach the fork, whose installs follow its own `vX.Y.Z-next.N` tags
 * (server/updater.ts). Otherwise it only reads: `git merge-tree` merges in memory and writes no
 * ref, index or file. The refs default to the remote-tracking ones, which is what CI has.
 */

export interface SyncStatus {
  upstream: { ref: string; sha: string };
  /** the mirror: behind upstream, and whether a plain fast-forward reaches it */
  main: { ref: string; behind: number; fastForward: boolean };
  next: { ref: string; behind: number; ahead: number };
  /** merging upstream into next: null when next already has all of it */
  merge: null | { clean: boolean; tree: string | null; conflicts: string[]; message: string; commits: number };
}

const UPSTREAM_URL = "https://github.com/devswha/herdr-web-ui.git";

/** One git call; a nonzero exit throws unless it is one of `allowed`. */
export function git(args: string[], options: { cwd?: string; env?: Record<string, string | undefined>; allowed?: number[] } = {}): { code: number; stdout: string } {
  const result = Bun.spawnSync(["git", ...args], { cwd: options.cwd, env: options.env ?? process.env, stdout: "pipe", stderr: "pipe" });
  const code = result.exitCode ?? 1;
  if (code !== 0 && !(options.allowed ?? []).includes(code)) {
    throw new Error(`git ${args.join(" ")} failed (${code}): ${result.stderr.toString().trim()}`);
  }
  return { code, stdout: result.stdout.toString() };
}

/**
 * `git merge-tree --write-tree --name-only --no-messages` output: the tree on the first line, then,
 * when it conflicts (exit 1), one conflicted path per line. A path conflicting in several ways is
 * listed once.
 */
export function parseMergeTree(code: number, stdout: string): { clean: boolean; tree: string | null; conflicts: string[] } {
  const lines = stdout.split("\n").map((line) => line.trim()).filter((line) => line !== "");
  if (code !== 0 && code !== 1) throw new Error(`git merge-tree exited ${code}`);
  const tree = lines[0] ?? null;
  if (tree === null || !/^[0-9a-f]{40,64}$/.test(tree)) throw new Error("git merge-tree printed no tree");
  return { clean: code === 0, tree: code === 0 ? tree : null, conflicts: code === 0 ? [] : [...new Set(lines.slice(1))] };
}

/**
 * The merge commit's subject, as the fork's syncs have always read:
 * `Merge upstream/main (0.4.7, 0.4.8, 161 commits up to #1084) into next`. `subjects` are the
 * merged upstream commits' subjects; a release names its version in `chore(release): prepare X.Y.Z`.
 */
export function syncMessage(subjects: string[], target = "next"): string {
  const versions = [...new Set(subjects.flatMap((subject) => /^chore\(release\): prepare (\d+\.\d+\.\d+)\b/.exec(subject)?.[1] ?? []))]
    .sort((a, b) => Bun.semver.order(a, b));
  const prs = subjects.flatMap((subject) => /\(#(\d+)\)\s*$/.exec(subject)?.[1] ?? []).map(Number);
  const count = `${subjects.length} commit${subjects.length === 1 ? "" : "s"}${prs.length > 0 ? ` up to #${Math.max(...prs)}` : ""}`;
  return `Merge upstream/main (${[...versions, count].join(", ")}) into ${target}`;
}

export function syncStatus(refs: { next: string; main: string; upstream: string }, cwd?: string): SyncStatus {
  const run = (args: string[], allowed?: number[]) => git(args, { cwd, allowed });
  const count = (range: string) => Number(run(["rev-list", "--count", range]).stdout.trim());
  const upstreamSha = run(["rev-parse", `${refs.upstream}^{commit}`]).stdout.trim();
  const fastForward = run(["merge-base", "--is-ancestor", refs.main, refs.upstream], [1]).code === 0;
  const behind = count(`${refs.next}..${refs.upstream}`);
  let merge: SyncStatus["merge"] = null;
  if (behind > 0) {
    const tree = run(["merge-tree", "--write-tree", "--name-only", "--no-messages", refs.next, refs.upstream], [1]);
    const subjects = run(["log", "--format=%s", `${refs.next}..${refs.upstream}`]).stdout.split("\n").filter((line) => line !== "");
    merge = { ...parseMergeTree(tree.code, tree.stdout), message: syncMessage(subjects), commits: subjects.length };
  }
  return {
    upstream: { ref: refs.upstream, sha: upstreamSha },
    main: { ref: refs.main, behind: count(`${refs.main}..${refs.upstream}`), fastForward },
    next: { ref: refs.next, behind, ahead: count(`${refs.upstream}..${refs.next}`) },
    merge,
  };
}

/** Fetches what the status reads, without tags; adds the `upstream` remote when it is missing. */
function fetchRefs(cwd?: string): void {
  if (git(["remote", "get-url", "upstream"], { cwd, allowed: [2] }).code !== 0) git(["remote", "add", "upstream", UPSTREAM_URL], { cwd });
  git(["fetch", "--quiet", "--no-tags", "upstream", "main"], { cwd });
  git(["fetch", "--quiet", "--no-tags", "origin", "main", "next"], { cwd });
}

function describe(status: SyncStatus): string {
  const lines = [`${status.upstream.ref}: ${status.upstream.sha.slice(0, 12)}`];
  lines.push(`${status.main.ref}: ${status.main.behind === 0 ? "up to date" : `${status.main.behind} behind`}${status.main.fastForward ? "" : ", DIVERGED (has commits upstream lacks)"}`);
  lines.push(`${status.next.ref}: ${status.next.behind} behind, ${status.next.ahead} ahead`);
  if (status.merge === null) lines.push("merge: nothing to merge");
  else if (status.merge.clean) lines.push(`merge: clean — ${status.merge.message}`);
  else lines.push(`merge: ${status.merge.conflicts.length} files conflict — ${status.merge.message}`, ...status.merge.conflicts.map((path) => `  ${path}`));
  return lines.join("\n");
}

if (import.meta.main) {
  const args = process.argv.slice(2).filter((arg) => arg !== "status");
  const option = (name: string, fallback: string): string => {
    const at = args.indexOf(name);
    return at >= 0 && args[at + 1] ? args[at + 1]! : fallback;
  };
  if (args.includes("--fetch")) fetchRefs();
  const status = syncStatus({ next: option("--next", "origin/next"), main: option("--main", "origin/main"), upstream: option("--upstream", "upstream/main") });
  console.log(args.includes("--json") ? JSON.stringify(status, null, 2) : describe(status));
}
