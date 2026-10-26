import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import type { Dirent, Stats } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { SkillIgnore } from "../skill-ignore.ts";
import { resolvePiPath } from "./pi-config.ts";
import type { PiConfig, PiFilters, PiKind, PiPackageEntry } from "./pi-config.ts";
import { description, plainObject, readFrontmatter, readSkillText } from "./walk.ts";

// What pi loads from the files PiConfig names, ported from Pi 1.3.0: the search and the pattern
// grammar from `dist/core/package-manager.js` (Bun.Glob stands in for minimatch, SkillIgnore for the
// `ignore` package), loading and name dedupe from `skills.js`, `prompt-templates.js` and
// `resource-loader.js`. Every path found gets a rank; the stable sort by rank, then one entry per
// realpath, then the enabled ones, then the first of each name is what pi loads.

/** A command pi's bundled extension registers, by the `builtin:` path that switches it. */
export type BundledExtension = "llama" | "mcp";
const BUNDLED_PATHS: ReadonlyArray<readonly [BundledExtension, string]> = [["llama", "builtin:llama.cpp"], ["mcp", "builtin:mcp"]];

export interface PiCommandFile { readonly name: string; readonly description: string; readonly origin: "user" | "project" | "package"; readonly id?: string }
export interface PiLoaded {
  readonly skills: readonly PiCommandFile[];
  readonly prompts: readonly PiCommandFile[];
  readonly bundled: readonly BundledExtension[];
}

const posix = (path: string): string => path.split(sep).join("/");
/** pi's normalizePath for a pattern: `~` and `~/` expand to the home directory. */
const expandHome = (home: string, pattern: string): string => pattern === "~" ? home : pattern.startsWith("~/") ? join(home, pattern.slice(2)) : pattern;
const globMatch = (pattern: string, candidate: string): boolean => { try { return new Bun.Glob(pattern).match(candidate); } catch { return false; } };

/** A pattern matches a path relative to base, its file name or the whole path; a SKILL.md also by its directory. */
function matchesAnyPattern(home: string, path: string, patterns: readonly string[], base: string): boolean {
  const candidates = [posix(relative(base, path)), basename(path), posix(path)];
  if (basename(path) === "SKILL.md") candidates.push(posix(relative(base, dirname(path))), basename(dirname(path)), posix(dirname(path)));
  return patterns.some((pattern) => {
    const normalized = posix(expandHome(home, pattern));
    return candidates.some((candidate) => globMatch(normalized, candidate));
  });
}

/** `+` and `-` name a path exactly: relative to base or absolute; a SKILL.md also by its directory. */
function matchesAnyExactPattern(home: string, path: string, patterns: readonly string[], base: string): boolean {
  const candidates = [posix(relative(base, path)), posix(path)];
  if (basename(path) === "SKILL.md") candidates.push(posix(relative(base, dirname(path))), posix(dirname(path)));
  return patterns.some((pattern) => candidates.includes(posix(expandHome(home, pattern.startsWith("./") ? pattern.slice(2) : pattern))));
}

const overrides = (entries: readonly string[]): string[] => entries.filter((entry) => entry.startsWith("!") || entry.startsWith("+") || entry.startsWith("-"));

/** Enabled unless `!glob` excludes it; `+path` takes it back in; `-path` takes it out over both. */
function isEnabledByOverrides(home: string, path: string, entries: readonly string[], base: string): boolean {
  const patterns = overrides(entries);
  const of = (prefix: string): string[] => patterns.filter((pattern) => pattern.startsWith(prefix)).map((pattern) => pattern.slice(1));
  let enabled = !matchesAnyPattern(home, path, of("!"), base);
  if (matchesAnyExactPattern(home, path, of("+"), base)) enabled = true;
  if (matchesAnyExactPattern(home, path, of("-"), base)) enabled = false;
  return enabled;
}

/**
 * pi's applyAutoloadDisabledPatterns: the paths some pattern names, in the order first named, each
 * decided by the last pattern that names it (`!` and `-` off, `+` and a plain glob on).
 */
function autoloadVerdicts(home: string, paths: readonly string[], patterns: readonly string[], base: string): Map<string, boolean> {
  const result = new Map<string, boolean>();
  for (const pattern of patterns) {
    const prefixed = /^[!+-]/.test(pattern);
    const target = prefixed ? pattern.slice(1) : pattern;
    const exact = pattern.startsWith("+") || pattern.startsWith("-");
    const enabled = !pattern.startsWith("-") && !pattern.startsWith("!");
    for (const path of paths) {
      if (exact ? matchesAnyExactPattern(home, path, [target], base) : matchesAnyPattern(home, path, [target], base)) result.set(path, enabled);
    }
  }
  return result;
}

/** The last override entry that names a path decides it; undefined where none does. */
const overrideVerdict = (home: string, path: string, entries: readonly string[], base: string): boolean | undefined => autoloadVerdicts(home, [path], overrides(entries), base).get(path);

/** Bundled extensions load unless the user's `extensions` exclude them; a project entry overrides that. */
function bundled({ home, user, project }: PiConfig): BundledExtension[] {
  return BUNDLED_PATHS.filter(([, path]) => {
    const projectVerdict = project ? overrideVerdict(home, path, project.extensions, project.base) : undefined;
    return projectVerdict ?? isEnabledByOverrides(home, path, user.extensions, user.base);
  }).map(([name]) => name);
}

type Kind = PiKind;
/** The kinds the menu lists; a package also brings extensions, for piLoadsExtension. */
const KINDS: readonly Kind[] = ["skills", "prompts"];
const PACKAGE_KINDS: readonly Kind[] = ["skills", "prompts", "extensions"];

/** pi's resourcePrecedenceRank: project settings, project folder, user settings, user folder, package. */
type Rank = 0 | 1 | 2 | 3 | 4;
const ORIGIN: Readonly<Record<Rank, PiCommandFile["origin"]>> = { 0: "project", 1: "project", 2: "user", 3: "user", 4: "package" };
/** Every path found for one kind, by path as found: its rank and whether its patterns enable it. */
type Found = Map<string, { readonly rank: Rank; readonly enabled: boolean }>;

/** pi's addResource: the first add of a path wins. */
function add(found: Found, path: string, rank: Rank, enabled: boolean): void {
  if (!found.has(path)) found.set(path, { rank, enabled });
}

const canonical = (path: string): string => { try { return realpathSync(path); } catch { return path; } };

/** pi's toResolvedPaths, then its enabled filter: stable by rank, one per realpath, enabled only. */
function winners(found: Found): { path: string; origin: PiCommandFile["origin"] }[] {
  const seen = new Set<string>();
  return [...found]
    .sort(([, left], [, right]) => left.rank - right.rank)
    .filter(([path]) => {
      const real = canonical(path);
      if (seen.has(real)) return false;
      seen.add(real);
      return true;
    })
    .filter(([, { enabled }]) => enabled)
    .map(([path, { rank }]) => ({ path, origin: ORIGIN[rank] }));
}

const IGNORE_FILES = [".gitignore", ".ignore", ".fdignore"];
/** pi's addIgnoreRules: a folder's ignore files, their patterns relative to the walk's root. */
function addIgnoreRules(ignore: SkillIgnore, directory: string, root: string): void {
  const prefix = posix(relative(root, directory));
  for (const filename of IGNORE_FILES) {
    try { ignore.add(readFileSync(join(directory, filename), "utf8"), prefix ? `${prefix}/` : ""); } catch { continue; /* optional ignore file */ }
  }
}

/** What an entry is, a link asked of its target; null for a broken link. */
function entryType(directory: string, entry: Dirent): { directory: boolean; file: boolean } | null {
  if (!entry.isSymbolicLink()) return { directory: entry.isDirectory(), file: entry.isFile() };
  try {
    const target = statSync(join(directory, entry.name));
    return { directory: target.isDirectory(), file: target.isFile() };
  } catch { return null; /* broken link */ }
}

const entries = (directory: string): Dirent[] => { try { return readdirSync(directory, { withFileTypes: true }); } catch { return []; } };

/**
 * `walk` below `directory` unless the folder is already on the walk's current path: pi follows
 * folder links without a guard, so a link back to an ancestor would never end. The walk runs
 * synchronously on the server's one thread for every menu.
 */
function descend(directory: string, ancestors: Set<string>, walk: () => string[]): string[] {
  let real: string;
  try { real = realpathSync(directory); } catch { return []; /* gone, or a link loop the system refuses */ }
  if (ancestors.has(real)) return [];
  ancestors.add(real);
  try { return walk(); } finally { ancestors.delete(real); }
}

/**
 * pi's collectSkillEntries: a folder holding SKILL.md is one skill and ends the descent; else loose
 * .md files count at the root (`pi`) or only below it (`agents`), and subfolders are searched.
 */
function skillEntries(directory: string, mode: "pi" | "agents", ignore = new SkillIgnore(), root = directory, ancestors = new Set<string>()): string[] {
  if (!existsSync(directory)) return [];
  return descend(directory, ancestors, () => skillFolder(directory, mode, ignore, root, ancestors));
}

function skillFolder(directory: string, mode: "pi" | "agents", ignore: SkillIgnore, root: string, ancestors: Set<string>): string[] {
  addIgnoreRules(ignore, directory, root);
  const listed = entries(directory);
  const declared = listed.find((entry) => entry.name === "SKILL.md");
  const path = join(directory, "SKILL.md");
  if (declared && entryType(directory, declared)?.file && !ignore.ignores(posix(relative(root, path)))) return [path];
  const result: string[] = [];
  for (const entry of listed) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const type = entryType(directory, entry);
    if (!type) continue;
    const full = join(directory, entry.name);
    const relativePath = posix(relative(root, full));
    const loose = mode === "pi" ? directory === root : directory !== root;
    if (type.file && entry.name.endsWith(".md") && !ignore.ignores(relativePath) && loose) result.push(full);
    else if (type.directory && !ignore.ignores(`${relativePath}/`)) result.push(...skillEntries(full, mode, ignore, root, ancestors));
  }
  return result;
}

/** pi's collectFiles for prompts: every .md below a folder, honouring its ignore files. */
function markdownFiles(directory: string, ignore = new SkillIgnore(), root = directory, ancestors = new Set<string>()): string[] {
  if (!existsSync(directory)) return [];
  return descend(directory, ancestors, () => markdownFolder(directory, ignore, root, ancestors));
}

function markdownFolder(directory: string, ignore: SkillIgnore, root: string, ancestors: Set<string>): string[] {
  addIgnoreRules(ignore, directory, root);
  const result: string[] = [];
  for (const entry of entries(directory)) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const type = entryType(directory, entry);
    if (!type) continue;
    const full = join(directory, entry.name);
    const relativePath = posix(relative(root, full));
    if (ignore.ignores(type.directory ? `${relativePath}/` : relativePath)) continue;
    if (type.directory) result.push(...markdownFiles(full, ignore, root, ancestors));
    else if (type.file && entry.name.endsWith(".md")) result.push(full);
  }
  return result;
}

/** pi's collectAutoPromptEntries: the direct .md children of a prompts folder. */
function promptFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const ignore = new SkillIgnore();
  addIgnoreRules(ignore, directory, directory);
  return entries(directory).filter((entry) => !entry.name.startsWith(".") && entry.name !== "node_modules"
    && !ignore.ignores(entry.name) && entryType(directory, entry)?.file === true && entry.name.endsWith(".md"))
    .map((entry) => join(directory, entry.name));
}

/** pi's resolveExtensionEntries: a folder's manifest extensions that exist, else its index.ts or index.js. */
function extensionEntries(directory: string): string[] | null {
  const listed = readManifest(directory)?.extensions?.map((entry) => resolve(directory, entry)).filter((path) => existsSync(path)) ?? [];
  if (listed.length) return listed;
  const index = [join(directory, "index.ts"), join(directory, "index.js")].find((path) => existsSync(path));
  return index ? [index] : null;
}

/** pi's collectAutoExtensionEntries: the folder as one extension, else its .ts/.js files and extension folders. */
function extensionFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const own = extensionEntries(directory);
  if (own) return own;
  const ignore = new SkillIgnore();
  addIgnoreRules(ignore, directory, directory);
  return entries(directory).flatMap((entry) => {
    if (entry.name.startsWith(".") || entry.name === "node_modules") return [];
    const type = entryType(directory, entry);
    if (!type || ignore.ignores(type.directory ? `${entry.name}/` : entry.name)) return [];
    const full = join(directory, entry.name);
    if (type.file && /\.(ts|js)$/.test(entry.name)) return [full];
    return type.directory ? extensionEntries(full) ?? [] : [];
  });
}

/** pi's collectResourceFiles for a folder of one kind. */
const kindFiles = (directory: string, kind: Kind): string[] => kind === "skills" ? skillEntries(directory, "pi") : kind === "extensions" ? extensionFiles(directory) : markdownFiles(directory);

/** pi's collectFilesFromPaths: a file as it is, a folder searched for its kind. */
function pathFiles(paths: readonly string[], kind: Kind): string[] {
  return paths.flatMap((path) => {
    try {
      const target = statSync(path);
      return target.isFile() ? [path] : target.isDirectory() ? kindFiles(path, kind) : [];
    } catch { return []; /* missing path */ }
  });
}

/** pi's applyPatterns: plain patterns include (all without one), `!` excludes, `+` takes back, `-` removes. */
function enabledBy(home: string, paths: readonly string[], patterns: readonly string[], base: string): Set<string> {
  const of = (prefix: string): string[] => patterns.filter((pattern) => pattern.startsWith(prefix)).map((pattern) => pattern.slice(1));
  const includes = patterns.filter((pattern) => !/^[!+-]/.test(pattern));
  let result = includes.length ? paths.filter((path) => matchesAnyPattern(home, path, includes, base)) : [...paths];
  result = result.filter((path) => !matchesAnyPattern(home, path, of("!"), base));
  for (const path of paths) if (!result.includes(path) && matchesAnyExactPattern(home, path, of("+"), base)) result.push(path);
  return new Set(result.filter((path) => !matchesAnyExactPattern(home, path, of("-"), base)));
}

/**
 * pi's resolveLocalEntries for a settings array: only plain entries find files (a glob or an
 * override is a pattern, so `+path` adds nothing), and the patterns decide which are enabled.
 */
function settingsEntries(home: string, settings: readonly string[], kind: Kind, found: Found, rank: Rank, base: string): void {
  const isPattern = (entry: string): boolean => /^[!+-]/.test(entry) || entry.includes("*") || entry.includes("?");
  const paths = pathFiles(settings.filter((entry) => !isPattern(entry)).map((entry) => resolvePiPath(home, entry, base)), kind);
  const enabled = enabledBy(home, paths, settings.filter(isPattern), base);
  for (const path of paths) add(found, path, rank, enabled.has(path));
}

type Manifest = Readonly<Partial<Record<PiKind, readonly string[]>>>;
/** `dist/core/pi-manifest.js` readPiManifest: the `pi` key's all-string arrays; null without a `pi` object or valid JSON. */
function readManifest(root: string): Manifest | null {
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(join(root, "package.json"), "utf8").replace(/^\uFEFF/, "")); } catch { return null; /* absent or not JSON */ }
  const pi = plainObject(parsed)["pi"];
  if (typeof pi !== "object" || pi === null || Array.isArray(pi)) return null;
  const fields = plainObject(pi);
  return Object.fromEntries(PACKAGE_KINDS.flatMap((kind) => {
    const value: unknown = fields[kind];
    return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? [[kind, value.filter((entry) => typeof entry === "string")]] : [];
  }));
}

const isOverride = (entry: string): boolean => /^[!+-]/.test(entry);

/** pi's expandPackageGlob: the matches below root without a dot segment, sorted. */
function packageGlob(pattern: string, root: string): string[] {
  let matches: string[];
  try { matches = [...new Bun.Glob(pattern).scanSync({ cwd: root, onlyFiles: false })]; } catch { return []; /* unreadable root or bad glob */ }
  return matches.map((match) => resolve(root, match))
    .filter((path) => relative(root, path).split(sep).every((segment) => segment === ".." || !segment.startsWith(".")))
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

/** pi's collectFilesFromManifestEntries: the non-override entries, a glob expanded, a path as it is. */
const manifestFiles = (entries: readonly string[], root: string, kind: Kind): string[] =>
  pathFiles(entries.filter((entry) => !isOverride(entry)).flatMap((entry) => entry.includes("*") || entry.includes("?") ? packageGlob(entry, root) : [resolve(root, entry)]), kind);

/** pi's addManifestEntries: what the entries find and their overrides keep, enabled. */
function manifestEntries(home: string, entries: readonly string[] | undefined, root: string, kind: Kind, found: Found): void {
  if (!entries) return;
  const files = manifestFiles(entries, root, kind);
  const enabled = enabledBy(home, files, entries.filter(isOverride), root);
  for (const path of files) if (enabled.has(path)) add(found, path, 4, true);
}

/** pi's collectManifestFiles: every file a filter chooses from, the manifest's (less its overrides) or the folder's. */
function filterable(home: string, root: string, kind: Kind): string[] {
  const entries = readManifest(root)?.[kind];
  if (entries?.length) {
    const files = manifestFiles(entries, root, kind);
    const patterns = entries.filter(isOverride);
    return patterns.length ? [...enabledBy(home, files, patterns, root)] : files;
  }
  return existsSync(join(root, kind)) ? kindFiles(join(root, kind), kind) : [];
}

/** pi's collectDefaultResources: the manifest's entries of a kind, else its folder. */
function defaultResources(home: string, root: string, kind: Kind, found: Found): void {
  const entries = readManifest(root)?.[kind];
  if (entries) return manifestEntries(home, entries, root, kind, found);
  if (existsSync(join(root, kind))) for (const path of kindFiles(join(root, kind), kind)) add(found, path, 4, true);
}

/** pi's collectPackageResources; false when the package has neither a filter, a manifest nor a folder. */
function packageResources(home: string, root: string, selection: PiPackageEntry["selection"], found: Readonly<Record<Kind, Found>>, kinds: readonly Kind[]): boolean {
  if (selection.mode !== "manifest") {
    const filters: PiFilters = selection.filters;
    for (const kind of kinds) {
      const patterns = filters[kind];
      if (selection.mode === "delta") {
        // pi's applyPackageDeltaFilter: only the files a pattern names, as it decides them
        if (patterns?.length) for (const [path, enabled] of autoloadVerdicts(home, filterable(home, root, kind), patterns, root)) add(found[kind], path, 4, enabled);
      } else if (patterns) {
        // pi's applyPackageFilter: every file, enabled as the patterns say ([] keeps none)
        const files = filterable(home, root, kind);
        const enabled = patterns.length ? enabledBy(home, files, patterns, root) : new Set<string>();
        for (const path of files) add(found[kind], path, 4, enabled.has(path));
      } else defaultResources(home, root, kind, found[kind]);
    }
    return true;
  }
  const manifest = readManifest(root);
  if (manifest) {
    for (const kind of kinds) manifestEntries(home, manifest[kind], root, kind, found[kind]);
    return true;
  }
  let any = false;
  for (const kind of kinds) {
    if (!existsSync(join(root, kind))) continue;
    for (const path of kindFiles(join(root, kind), kind)) add(found[kind], path, 4, true);
    any = true;
  }
  return any;
}

/**
 * pi's dedupePackages and findAutoloadDeltaBase, project entries first: a project entry replaces
 * the user's of the same identity, unless it is a delta, which goes first and then reads the
 * user's installed copy.
 */
export function effectivePackages({ user, project }: PiConfig): PiPackageEntry[] {
  const all = [...(project?.packages ?? []), ...user.packages];
  const result: PiPackageEntry[] = [];
  const seen = new Map<string, number>();
  for (const entry of all) {
    const index = seen.get(entry.identity);
    const existing = index === undefined ? undefined : result[index];
    if (index === undefined || !existing) {
      seen.set(entry.identity, result.length);
      result.push(entry);
    } else if (existing.scope === "project" && entry.scope === "user") {
      if (existing.selection.mode === "delta") result.push(entry);
    } else if (entry.scope === "project") result[index] = entry;
  }
  return result.map((entry) => {
    if (entry.scope !== "project" || entry.selection.mode !== "delta") return entry;
    const base = result.find((other) => other.scope === "user" && other.identity === entry.identity);
    return base ? { ...entry, root: base.root } : entry;
  });
}

/**
 * pi's getInstalledNpmVersion as far as it reads the file: an npm package whose package.json is
 * missing or no JSON is not installed to pi (installedNpmMatchesConfiguredVersion), so it loads
 * nothing from it. A git or local package needs no package.json.
 */
function npmInstalled(root: string): boolean {
  try { JSON.parse(readFileSync(join(root, "package.json"), "utf8").replace(/^\uFEFF/, "")); } catch { return false; /* absent or not JSON */ }
  return true;
}

/**
 * pi's resolvePackageSources for one entry: an npm or git package only where it is installed (no
 * install, no version range check, no legacy global npm root), a local file as one extension, a
 * local folder with nothing to collect as an extension itself.
 */
function collectPackage(home: string, { identity, root, selection }: PiPackageEntry, found: Readonly<Record<Kind, Found>>, kinds: readonly Kind[]): void {
  if (!root) return;
  let target: Stats;
  try { target = statSync(root); } catch { return; /* not installed, or a broken link */ }
  if (!identity.startsWith("local:")) {
    if (identity.startsWith("npm:") && !npmInstalled(root)) return;
    if (target.isDirectory()) packageResources(home, root, selection, found, kinds);
    return;
  }
  if (target.isFile()) add(found.extensions, root, 4, true);
  else if (target.isDirectory() && !packageResources(home, root, selection, found, kinds)) add(found.extensions, root, 4, true);
}

const emptyFound = (): Record<Kind, Found> => ({ skills: new Map(), prompts: new Map(), extensions: new Map() });

/** pi's collectAncestorAgentsSkillDirs: `.agents/skills` from cwd up to the git root, else to `/`. */
function ancestorAgentsSkills(cwd: string): string[] {
  const start = resolve(cwd);
  let repoRoot: string | null = null;
  for (let directory = start; ; directory = dirname(directory)) {
    if (existsSync(join(directory, ".git"))) { repoRoot = directory; break; }
    if (directory === dirname(directory)) break;
  }
  const result: string[] = [];
  for (let directory = start; ; directory = dirname(directory)) {
    result.push(join(directory, ".agents", "skills"));
    if (directory === repoRoot || directory === dirname(directory)) return result;
  }
}

/** pi's addAutoDiscoveredResources: the conventional folders, each switched by its settings' overrides. */
function autoDiscovered({ home, agentDir, cwd, user, project }: PiConfig, found: Readonly<Record<Kind, Found>>): void {
  const auto = (kind: Kind, paths: readonly string[], rank: Rank, settings: readonly string[], base: string): void => {
    for (const path of paths) add(found[kind], path, rank, isEnabledByOverrides(home, path, settings, base));
  };
  const userAgents = join(home, ".agents", "skills");
  if (project && cwd) {
    auto("skills", skillEntries(join(project.base, "skills"), "pi"), 1, project.skills, project.base);
    for (const directory of ancestorAgentsSkills(cwd).filter((directory) => resolve(directory) !== resolve(userAgents))) {
      auto("skills", skillEntries(directory, "agents"), 1, project.skills, dirname(directory));
    }
    auto("prompts", promptFiles(join(project.base, "prompts")), 1, project.prompts, project.base);
  }
  auto("skills", skillEntries(join(agentDir, "skills"), "pi"), 3, user.skills, agentDir);
  auto("skills", skillEntries(userAgents, "agents"), 3, user.skills, dirname(userAgents));
  auto("prompts", promptFiles(join(agentDir, "prompts")), 3, user.prompts, agentDir);
}

/** pi's loadSkills: a .md with a description; name: else its folder's name; one per realpath, first name wins. */
function loadSkills(paths: ReturnType<typeof winners>): PiCommandFile[] {
  const byName = new Map<string, PiCommandFile>();
  const reals = new Set<string>();
  for (const { path, origin } of paths) {
    if (!path.endsWith(".md")) continue;
    const fields = readFrontmatter(path);
    const text = fields?.["description"];
    if (typeof text !== "string" || !text.trim()) continue;
    const name = typeof fields?.["name"] === "string" && fields["name"] ? fields["name"] : basename(dirname(path));
    const real = canonical(path);
    if (reals.has(real) || byName.has(name)) continue;
    byName.set(name, { name, description: text, origin, id: real });
    reals.add(real);
  }
  return [...byName.values()];
}

/** pi's loadPromptTemplates and dedupePrompts: a readable .md named by its file, first name wins. */
function loadPrompts(paths: ReturnType<typeof winners>): PiCommandFile[] {
  const byName = new Map<string, PiCommandFile>();
  for (const { path, origin } of paths) {
    const name = basename(path, ".md");
    if (!path.endsWith(".md") || byName.has(name)) continue;
    let markdown: string;
    try { markdown = readSkillText(path); } catch { continue; /* unreadable or no regular file */ }
    byName.set(name, { name, description: description(markdown), origin });
  }
  return [...byName.values()];
}

export function piLoads(config: PiConfig): PiLoaded {
  const found = emptyFound();
  for (const entry of effectivePackages(config)) collectPackage(config.home, entry, found, KINDS);
  for (const kind of KINDS) {
    if (config.project) settingsEntries(config.home, config.project[kind], kind, found[kind], 0, config.project.base);
    settingsEntries(config.home, config.user[kind], kind, found[kind], 2, config.user.base);
  }
  autoDiscovered(config, found);
  return { skills: loadSkills(winners(found.skills)), prompts: loadPrompts(winners(found.prompts)), bundled: bundled(config) };
}

/**
 * `identity` is an effective, installed package and pi loads `<root>/<entry>` from it as an
 * extension. Only the packages' extensions are resolved: a settings or folder extension pointing
 * at the same file would load the same code anyway.
 */
export function piLoadsExtension(config: PiConfig, identity: string, entry: string): boolean {
  const packages = effectivePackages(config);
  const targets = packages.filter((pkg) => pkg.identity === identity && pkg.root).map((pkg) => canonical(resolve(pkg.root ?? "", entry)));
  if (!targets.length) return false;
  const found = emptyFound();
  for (const pkg of packages) collectPackage(config.home, pkg, found, ["extensions"]);
  return winners(found.extensions).some(({ path }) => targets.includes(canonical(path)));
}
