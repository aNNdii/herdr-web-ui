/**
 * The fork's `next` release (docs/fork.md, .github/workflows/fork-release-next.yml): the tag a
 * validated commit of `next` gets, and its GitHub release notes.
 *
 *   bun scripts/fork/next-release.ts --sha <commit> [--repo owner/name]
 *
 * Prints JSON: `{ "tag": "v0.4.11-next.2", "previous": "v0.4.11-next.1", "notes": "…" }`, or
 * `{ "tag": null, "reason": "…" }` when the commit already has a next tag. It only reads: the
 * workflow creates the tag, after CI passed on that exact commit.
 *
 * A tag is `vX.Y.Z-next.N`: X.Y.Z is the upstream version in the commit's package.json, N counts
 * that version's next releases from 1. git's version sort puts it after upstream's vX.Y.Z and before
 * vX.Y.(Z+1), which is the order the fork's installs follow (server/updater.ts `RELEASE_TAG`).
 */
import { git } from "./upstream-sync.ts";

export const NEXT_TAG = /^v(\d+\.\d+\.\d+)-next\.(\d+)$/;
const UPSTREAM_REPO = "devswha/herdr-web-ui";

export function nextReleaseTag(version: string, tags: string[]): string {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`package.json version ${JSON.stringify(version)} is not X.Y.Z`);
  const counts = tags.flatMap((tag) => {
    const match = NEXT_TAG.exec(tag);
    return match && match[1] === version ? [Number(match[2])] : [];
  });
  return `v${version}-next.${Math.max(0, ...counts) + 1}`;
}

/** The highest next tag by version, of those given (the ones the released commit contains). */
export function latestNextTag(tags: string[]): string | null {
  const ordered = tags.filter((tag) => NEXT_TAG.test(tag)).sort((a, b) => {
    const [, av, an] = NEXT_TAG.exec(a)!, [, bv, bn] = NEXT_TAG.exec(b)!;
    return Bun.semver.order(av!, bv!) || Number(an) - Number(bn);
  });
  return ordered.at(-1) ?? null;
}

export interface FirstParentCommit { subject: string; body: string }

/**
 * The release body: the upstream release it builds on, then what reached `next` since the previous
 * next release, one line per first-parent commit. A merged pull request reads as its title (the
 * merge commit's body) with its number; the upstream syncs are listed apart from the fork's own work.
 */
export function releaseNotes(options: { tag: string; version: string; previous: string | null; repo: string; commits: FirstParentCommit[] }): string {
  const upstream: string[] = [], fork: string[] = [];
  for (const commit of options.commits) {
    const pull = /^Merge pull request #(\d+) from (\S+)/.exec(commit.subject);
    const title = pull ? `${commit.body.split("\n").map((line) => line.trim()).find((line) => line !== "") ?? pull[2]} (#${pull[1]})` : commit.subject;
    (/^Merge upstream\/main\b/.test(title) ? upstream : fork).push(`- ${title}`);
  }
  const sections = [
    `Fork release of herdr web ui: upstream [v${options.version}](https://github.com/${UPSTREAM_REPO}/releases/tag/v${options.version}) with the fork's features (\`next\`).`,
  ];
  if (upstream.length > 0) sections.push(`### Upstream\n\n${upstream.join("\n")}`);
  if (fork.length > 0) sections.push(`### Fork\n\n${fork.join("\n")}`);
  if (options.previous !== null) sections.push(`Changes since ${options.previous}: https://github.com/${options.repo}/compare/${options.previous}...${options.tag}`);
  return `${sections.join("\n\n")}\n`;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const option = (name: string): string | undefined => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : undefined;
  };
  const sha = option("--sha");
  if (!sha) throw new Error("Usage: bun scripts/fork/next-release.ts --sha <commit> [--repo owner/name]");
  const repo = option("--repo") ?? process.env["GH_REPO"] ?? "aNNdii/herdr-web-ui";
  const lines = (out: string) => out.split("\n").map((line) => line.trim()).filter((line) => line !== "");
  const tagged = lines(git(["tag", "--points-at", sha]).stdout).filter((tag) => NEXT_TAG.test(tag));
  if (tagged.length > 0) {
    console.log(JSON.stringify({ tag: null, reason: `${sha} is already released as ${tagged.join(", ")}` }));
  } else {
    const version = (JSON.parse(git(["show", `${sha}:package.json`]).stdout) as { version: string }).version;
    const tag = nextReleaseTag(version, lines(git(["tag", "--list", "v*-next.*"]).stdout));
    const previous = latestNextTag(lines(git(["tag", "--list", "v*-next.*", "--merged", sha]).stdout));
    const log = git(["log", "--first-parent", "--format=%s%x1f%b%x1e", previous === null ? sha : `${previous}..${sha}`, ...(previous === null ? ["-n", "30"] : [])]).stdout;
    const commits = log.split("\x1e").map((entry) => entry.replace(/^\n/, "")).filter((entry) => entry !== "").map((entry) => {
      const [subject = "", body = ""] = entry.split("\x1f");
      return { subject: subject.trim(), body };
    });
    console.log(JSON.stringify({ tag, previous, notes: releaseNotes({ tag, version, previous, repo, commits }) }));
  }
}
