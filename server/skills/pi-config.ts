import { readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentCommandContext } from "./index.ts";
import { environValue, plainObject } from "./walk.ts";

// Pi 1.3.0's files on disk, read once per menu: the agent directory, project trust, and the user's
// and the project's settings.json after pi's own migration (`dist/core/settings-manager.js`). Every
// other module reads pi through PiConfig, never the files.

export type PiScope = "user" | "project";
export type PiKind = "skills" | "prompts" | "extensions";
export type PiFilters = Readonly<Partial<Record<PiKind, readonly string[]>>>;
/** Which resources a package entry asks for. */
export type Selection =
  /** a string entry: the package's manifest, else its folders */
  | { readonly mode: "manifest" }
  /** an object entry: per kind its patterns, the manifest or the folder for a kind without */
  | { readonly mode: "filter"; readonly filters: PiFilters }
  /** an object entry with autoload: false: only what its patterns name, on the user's entry in a project */
  | { readonly mode: "delta"; readonly filters: PiFilters };
export interface PiPackageEntry {
  readonly source: string;
  readonly scope: PiScope;
  /** npm:<name> | git:<host>/<path> | local:<abs>, the same for every form of one package */
  readonly identity: string;
  /** where this scope installs it, or the local path; null when that would leave the install root */
  readonly root: string | null;
  readonly selection: Selection;
}
export interface PiSettings {
  readonly scope: PiScope;
  /** where the entries of this file resolve: the agent dir, or `<cwd>/.pi` */
  readonly base: string;
  readonly packages: readonly PiPackageEntry[];
  readonly skills: readonly string[];
  readonly prompts: readonly string[];
  readonly extensions: readonly string[];
}
export interface PiConfig {
  readonly home: string;
  readonly agentDir: string;
  readonly cwd: string | null;
  /** project ?? user; the legacy skills.enableSkillCommands counts only without the top-level key; default true */
  readonly skillCommands: boolean;
  readonly user: PiSettings;
  /** null without a cwd or without trust */
  readonly project: PiSettings | null;
}

const readJson = (path: string): unknown => {
  try { return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "")); } catch { return null; /* absent or not JSON */ }
};
const canonical = (path: string): string => { try { return realpathSync(path); } catch { return resolve(path); } };
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

/** PI_CODING_AGENT_DIR from the pane's own environ first, then the server's, else ~/.pi/agent. */
function agentDirectory(home: string, env: readonly string[] | null, serverEnv: AgentCommandContext["serverEnv"]): string {
  const own = environValue(env, "PI_CODING_AGENT_DIR");
  const dir = own || (serverEnv ?? process.env)["PI_CODING_AGENT_DIR"];
  if (!dir) return join(home, ".pi", "agent");
  return dir === "~" || dir.startsWith("~/") ? join(home, dir.slice(2)) : dir;
}

/** Saved decisions in trust.json: an absolute path mapped to true/false, or a list of trusted paths. */
function savedDecisions(value: unknown, into = new Map<string, boolean>()): Map<string, boolean> {
  if (Array.isArray(value)) {
    for (const entry of value) if (typeof entry === "string" && isAbsolute(entry)) into.set(canonical(entry), true);
    return into;
  }
  for (const [key, entry] of Object.entries(plainObject(value))) {
    const fields = plainObject(entry);
    const verdict = typeof entry === "boolean" ? entry : typeof fields["trusted"] === "boolean" ? fields["trusted"] : typeof fields["trust"] === "boolean" ? fields["trust"] : null;
    if (isAbsolute(key) && verdict !== null) into.set(canonical(key), verdict);
    else if (!isAbsolute(key) && typeof entry === "object" && entry !== null) savedDecisions(entry, into);
  }
  return into;
}

/** pi's order without an interactive prompt: the closest saved decision, else defaultProjectTrust. */
function projectTrusted(agentDir: string, settings: Record<string, unknown>, cwd: string): boolean {
  const decisions = savedDecisions(readJson(join(agentDir, "trust.json")));
  for (let directory = canonical(cwd); ; directory = dirname(directory)) {
    const decision = decisions.get(directory);
    if (decision !== undefined) return decision;
    if (directory === dirname(directory)) break;
  }
  return settings["defaultProjectTrust"] === "always";
}

/**
 * pi's migration of one file: the old `skills` object gives its enableSkillCommands (only where the
 * top-level key is absent) and its customDirectories as the skills list.
 */
function migrated(raw: Record<string, unknown>): Record<string, unknown> {
  const legacy = raw["skills"];
  if (typeof legacy !== "object" || legacy === null || Array.isArray(legacy)) return raw;
  const fields = plainObject(legacy);
  const settings: Record<string, unknown> = { ...raw, skills: Array.isArray(fields["customDirectories"]) ? fields["customDirectories"] : undefined };
  if (fields["enableSkillCommands"] !== undefined && raw["enableSkillCommands"] === undefined) settings["enableSkillCommands"] = fields["enableSkillCommands"];
  return settings;
}

/** pi's resolvePath for a settings entry: trimmed, `~` and file: URLs expanded, relative to base. */
export function resolvePiPath(home: string, entry: string, base: string): string {
  const trimmed = entry.trim();
  const expanded = trimmed === "~" ? home : trimmed.startsWith("~/") ? join(home, trimmed.slice(2)) : trimmed;
  const path = /^file:\/\//.test(expanded) ? fileURLToPath(expanded) : expanded;
  return isAbsolute(path) ? resolve(path) : resolve(base, path);
}

/** pi's resolveManagedPath: a path below root, else null. */
function managed(root: string, ...parts: string[]): string | null {
  const path = resolve(root, ...parts);
  return path === resolve(root) || path.startsWith(`${resolve(root)}${sep}`) ? path : null;
}

/** `dist/utils/paths.js` isLocalPath: anything without a known non-local prefix. */
const isLocalSource = (source: string): boolean => !/^(npm|git|github|http|https|ssh|builtin):/.test(source.trim());

/** pi's splitRef: a trailing `@ref` off the repository path, in scp, URL and shorthand form. */
function withoutRef(url: string): string {
  const scp = /^git@([^:]+):(.+)$/.exec(url);
  if (scp) {
    const at = (scp[2] ?? "").indexOf("@");
    return at > 0 && at < (scp[2] ?? "").length - 1 ? `git@${scp[1] ?? ""}:${(scp[2] ?? "").slice(0, at)}` : url;
  }
  if (url.includes("://")) {
    try {
      const parsed = new URL(url);
      const path = parsed.pathname.replace(/^\/+/, "");
      const at = path.indexOf("@");
      if (at <= 0 || at === path.length - 1) return url;
      parsed.pathname = `/${path.slice(0, at)}`;
      return parsed.toString().replace(/\/$/, "");
    } catch { return url; /* not a URL */ }
  }
  const slash = url.indexOf("/");
  const path = slash < 0 ? "" : url.slice(slash + 1);
  const at = path.indexOf("@");
  return at > 0 && at < path.length - 1 ? `${url.slice(0, slash)}/${path.slice(0, at)}` : url;
}

const unsafe = (value: string, slash: boolean): boolean => {
  let decoded: string;
  try { decoded = decodeURIComponent(value); } catch { return true; /* malformed escape */ }
  return [value, decoded].some((candidate) => candidate.includes("\0") || candidate.includes("\\") || candidate.startsWith("/")
    || (!slash && candidate.includes("/")) || candidate.split("/").includes(".."));
};

/**
 * `dist/utils/git.js` parseGitUrl as host and path, without hosted-git-info: with `git:` every
 * shorthand, without only explicit protocol URLs; null where pi reads a local path instead.
 */
function gitSource(source: string): { host: string; path: string } | null {
  const trimmed = source.trim();
  const prefixed = trimmed.startsWith("git:");
  const url = prefixed ? trimmed.slice(4).trim() : trimmed;
  if (!prefixed && !/^(https?|ssh|git):\/\//i.test(url)) return null;
  const repo = withoutRef(url);
  let host = "";
  let path = "";
  const scp = /^git@([^:]+):(.+)$/.exec(repo);
  if (scp) [host, path] = [scp[1] ?? "", scp[2] ?? ""];
  else if (/^(https?|ssh|git):\/\//.test(repo)) {
    try { const parsed = new URL(repo); [host, path] = [parsed.hostname, parsed.pathname.replace(/^\/+/, "")]; } catch { return null; /* not a URL */ }
  } else {
    const slash = repo.indexOf("/");
    if (slash < 0) return null;
    [host, path] = [repo.slice(0, slash), repo.slice(slash + 1)];
    if (!host.includes(".") && host !== "localhost") return null;
  }
  if (path.startsWith("/")) return null;
  const normalized = path.replace(/\.git$/, "").replace(/^\/+/, "");
  if (!host || !normalized || normalized.split("/").length < 2 || unsafe(host, false) || unsafe(normalized, true)) return null;
  return { host, path: normalized };
}

/** pi's parseSource and getPackageIdentity, and where this scope installs the package. */
function packageSource(home: string, source: string, base: string): { identity: string; root: string | null } {
  if (source.startsWith("npm:")) {
    const spec = source.slice(4).trim();
    const name = /^(@?[^@]+(?:\/[^@]+)?)(?:@(.+))?$/.exec(spec)?.[1] ?? spec;
    return { identity: `npm:${name}`, root: managed(join(base, "npm", "node_modules"), name) };
  }
  const git = isLocalSource(source) ? null : gitSource(source);
  if (git) return { identity: `git:${git.host}/${git.path}`, root: managed(join(base, "git"), git.host, git.path) };
  const path = resolvePiPath(home, source, base);
  return { identity: `local:${path}`, root: path };
}

const KINDS: readonly PiKind[] = ["skills", "prompts", "extensions"];

/** One `packages` entry: a string, or an object with a source; anything else pi could not load. */
function packageEntry(home: string, scope: PiScope, base: string, value: unknown): PiPackageEntry | null {
  const fields = plainObject(value);
  const source = typeof value === "string" ? value : fields["source"];
  if (typeof source !== "string") return null;
  const filters: PiFilters = Object.fromEntries(KINDS.filter((kind) => Array.isArray(fields[kind])).map((kind) => [kind, strings(fields[kind])]));
  const selection: Selection = typeof value === "string" ? { mode: "manifest" } : fields["autoload"] === false ? { mode: "delta", filters } : { mode: "filter", filters };
  return { source, scope, ...packageSource(home, source, base), selection };
}

const piSettings = (home: string, scope: PiScope, base: string, settings: Record<string, unknown>): PiSettings => ({
  scope,
  base,
  packages: (Array.isArray(settings["packages"]) ? settings["packages"] : []).flatMap((value: unknown) => packageEntry(home, scope, base, value) ?? []),
  skills: strings(settings["skills"]), prompts: strings(settings["prompts"]), extensions: strings(settings["extensions"]),
});

export function readPiConfig({ home, cwd, env, serverEnv }: AgentCommandContext): PiConfig {
  const agentDir = agentDirectory(home, env, serverEnv);
  const userRaw = migrated(plainObject(readJson(join(agentDir, "settings.json"))));
  const trusted = typeof cwd === "string" && cwd !== "" && projectTrusted(agentDir, userRaw, cwd);
  const projectBase = trusted ? join(cwd, ".pi") : null;
  const projectRaw = projectBase ? migrated(plainObject(readJson(join(projectBase, "settings.json")))) : {};
  const flag = (settings: Record<string, unknown>): boolean | undefined => typeof settings["enableSkillCommands"] === "boolean" ? settings["enableSkillCommands"] : undefined;
  return {
    home,
    agentDir,
    cwd: cwd || null,
    skillCommands: flag(projectRaw) ?? flag(userRaw) ?? true,
    user: piSettings(home, "user", agentDir, userRaw),
    project: projectBase ? piSettings(home, "project", projectBase, projectRaw) : null,
  };
}
