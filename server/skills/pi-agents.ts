import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { SubagentMention } from "../../shared/protocol.ts";
import type { PiConfig } from "./pi-config.ts";
import { effectivePackages, piLoadsExtension } from "./pi-resources.ts";
import { plainObject, readFrontmatter } from "./walk.ts";

// A port of @tintinweb/pi-subagents 0.22.0: when its extension is active, which agents a message
// can address with a leading `@handle` (`src/settings.ts`, `src/package-resources.ts`,
// `src/custom-agents.ts`, `src/agent-types.ts`, `src/mention.ts`).

/** The package and the extension entry pi loads from it (`pi.extensions` in its package.json). */
const SUBAGENTS_IDENTITY = "npm:@tintinweb/pi-subagents";
const SUBAGENTS_ENTRY = "src/index.ts";

/** pi-subagents 0.22.0 `src/default-agents.ts`: the agents it registers unless disableDefaultAgents. */
const DEFAULT_AGENTS: ReadonlyArray<readonly [name: string, description: string]> = [
  ["general-purpose", "General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks. When you are searching for a keyword or file and are not confident that you will find the right match in the first few tries use this agent to perform the search for you."],
  ["Explore", "Fast read-only search agent for locating code. Use it to find files by pattern (eg. \"src/components/**/*.tsx\"), grep for symbols or keywords (eg. \"API endpoints\"), or answer \"where is X defined / which files reference Y.\" Do NOT use it for code review, design-doc auditing, cross-file consistency checks, or open-ended analysis — it reads excerpts rather than whole files and will miss content past its read window. When calling, specify search breadth: \"quick\" for a single targeted lookup, \"medium\" for moderate exploration, or \"very thorough\" to search across multiple locations and naming conventions."],
  ["Plan", "Software architect agent for designing implementation plans. Use this when you need to plan the implementation strategy for a task. Returns step-by-step plans, identifies critical files, and considers architectural trade-offs."],
];

/** `packageAgents`: true admits every declaring package, false none, a list the packages it names. */
type PackageGate = boolean | readonly string[];

interface SubagentSettings {
  readonly agentMentions?: "model" | "direct" | "off";
  readonly disableDefaultAgents?: boolean;
  readonly packageAgents?: PackageGate;
}

/** `src/settings.ts` sanitizePackageGate: a string is a one-entry list, an empty one admits nothing. */
function packageGate(value: unknown): PackageGate | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean);
}

/** `src/settings.ts` sanitize, for the keys the menu needs; a broken file counts as empty. */
function settingsFile(path: string): SubagentSettings {
  let raw: Record<string, unknown>;
  try { raw = plainObject(JSON.parse(readFileSync(path, "utf8"))); } catch { return {}; /* absent or not JSON */ }
  const mentions = raw["agentMentions"];
  const gate = packageGate(raw["packageAgents"]);
  return {
    ...(typeof mentions === "boolean" ? { agentMentions: mentions ? "model" : "off" } : mentions === "model" || mentions === "direct" || mentions === "off" ? { agentMentions: mentions } : {}),
    ...(typeof raw["disableDefaultAgents"] === "boolean" ? { disableDefaultAgents: raw["disableDefaultAgents"] } : {}),
    ...(gate === undefined ? {} : { packageAgents: gate }),
  };
}

/** `src/settings.ts` loadSettings: `<agentDir>/subagents.json`, then `<cwd>/.pi/subagents.json` key by key, trust or not. */
const subagentSettings = ({ agentDir, cwd }: PiConfig): SubagentSettings => ({
  ...settingsFile(join(agentDir, "subagents.json")),
  ...(cwd ? settingsFile(join(cwd, ".pi", "subagents.json")) : {}),
});

/** `src/package-resources.ts`: a package file is read only up to this size (Claude Code's plugin-agent limit). */
const MAX_PACKAGE_AGENT_BYTES = 1_048_576;

/** normalizeDeclaration: an all-string list is the agents shorthand, else an object with agents or workflows. */
function declaration(value: unknown): { readonly agents: readonly string[] | undefined } | undefined {
  const list = (entry: unknown): string[] | undefined => Array.isArray(entry) && entry.every((item) => typeof item === "string") ? entry.filter((item): item is string => typeof item === "string") : undefined;
  const shorthand = list(value);
  if (shorthand) return { agents: shorthand };
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const fields = plainObject(value);
  const agents = list(fields["agents"]);
  return agents || list(fields["workflows"]) ? { agents } : undefined;
}

/** readSubagentManifest: `pi.subagents`, else the top-level `pi-subagents`; undefined when it declares nothing. */
function subagentManifest(manifest: Record<string, unknown>): { readonly agents: readonly string[] | undefined } | undefined {
  return declaration(plainObject(manifest["pi"])["subagents"]) ?? declaration(manifest["pi-subagents"]);
}

/** realOrSelf: the canonical path of the nearest existing ancestor, the rest appended. */
function realOrSelf(path: string): string {
  const absolute = resolve(path);
  try { return realpathSync(absolute); } catch {
    const parent = dirname(absolute);
    return parent === absolute ? absolute : join(realOrSelf(parent), basename(absolute));
  }
}

/** isInside: `candidate` lies below `root` after links are resolved; the root itself does not count. */
function isInside(root: string, candidate: string): boolean {
  const rel = relative(realOrSelf(root), realOrSelf(candidate));
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

interface PackagePaths { readonly dirs: string[]; readonly files: string[]; readonly excluded: Set<string> }

/** resolveDeclaredPaths: existing directories and `.md` files inside the package; `!path` excludes exactly. */
function declaredPaths(root: string, entries: readonly string[], into: PackagePaths): void {
  for (const entry of entries) {
    if (!entry.startsWith("!")) continue;
    const target = resolve(root, entry.slice(1));
    if (isInside(root, target)) into.excluded.add(realOrSelf(target));
  }
  const dirs: string[] = [];
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.startsWith("!")) continue;
    const path = resolve(root, entry);
    if (!isInside(root, path) || into.excluded.has(realOrSelf(path))) continue;
    let stats;
    try { stats = statSync(path); } catch { continue; /* missing, or a broken link */ }
    if (stats.isDirectory()) { if (!dirs.includes(path)) dirs.push(path); }
    else if (stats.isFile() && path.endsWith(".md") && !files.includes(path)) files.push(path);
  }
  into.dirs.push(...dirs);
  into.files.push(...files);
}

/** packageAllowed: the gate names the package's unscoped short name, its name or its settings source. */
function packageAllowed(gate: PackageGate | undefined, name: string | undefined, source: string): boolean {
  if (gate === undefined || gate === true) return true;
  if (gate === false) return false;
  const short = name?.startsWith("@") ? name.slice(name.indexOf("/") + 1) : name;
  const candidates = new Set([short?.toLowerCase(), name?.toLowerCase(), source.toLowerCase()]);
  return gate.some((allowed) => candidates.has(allowed.trim().toLowerCase()));
}

/**
 * packageAgentDirs, packageAgentFiles and the exclusions: what the admitted packages declare, in
 * listPiPackages' order (user entries, then project ones), one package per install root. The
 * packages are pi's effective ones, so a project package needs trust and a filter-free duplicate
 * collapses into the entry pi loads.
 */
function packageAgentPaths(config: PiConfig, gate: PackageGate | undefined): PackagePaths {
  const paths: PackagePaths = { dirs: [], files: [], excluded: new Set() };
  if (gate === false || (Array.isArray(gate) && gate.length === 0)) return paths;
  const packages = effectivePackages(config);
  const seen = new Set<string>();
  for (const { root, source } of [...packages.filter((pkg) => pkg.scope === "user"), ...packages.filter((pkg) => pkg.scope === "project")]) {
    if (!root || seen.has(root)) continue;
    let manifest: Record<string, unknown>;
    try { manifest = plainObject(JSON.parse(readFileSync(join(root, "package.json"), "utf8"))); } catch { continue; /* not installed, or no JSON */ }
    const declared = subagentManifest(manifest);
    if (!declared) continue;
    seen.add(root);
    const name = typeof manifest["name"] === "string" ? manifest["name"] : undefined;
    if (packageAllowed(gate, name, source) && declared.agents) declaredPaths(root, declared.agents, paths);
  }
  return paths;
}

interface AgentDefinition { readonly description: string; readonly enabled: boolean }

/**
 * loadOneFile: the agent type is `name:` (the file name without one), one with a `:` is refused,
 * a later file of the same type replaces the earlier one in its place. A header that is no valid
 * YAML reads as none here; pi-subagents skips such a file.
 */
function loadAgentFile(path: string, agents: Map<string, AgentDefinition>, fromPackage: boolean): void {
  try {
    const stats = statSync(path);
    if (!stats.isFile() || (fromPackage && stats.size > MAX_PACKAGE_AGENT_BYTES)) return;
  } catch { return; /* missing, or a broken link */ }
  const fields = readFrontmatter(path) ?? {};
  const declared = typeof fields["name"] === "string" ? fields["name"].trim() : undefined;
  if (declared?.includes(":")) return;
  const name = declared || basename(path, ".md");
  agents.set(name, { description: typeof fields["description"] === "string" ? fields["description"] : name, enabled: fields["enabled"] !== false });
}

/** loadFromDir: the folder's `.md` files, sorted by name here (pi-subagents takes directory order). */
function loadAgentDir(dir: string, agents: Map<string, AgentDefinition>, fromPackage: boolean, excluded?: ReadonlySet<string>): void {
  let names: string[];
  try { names = readdirSync(dir).filter((name) => name.endsWith(".md")).sort(); } catch { return; /* no such folder */ }
  for (const name of names) {
    const path = join(dir, name);
    if (!excluded?.size || !excluded.has(realOrSelf(path))) loadAgentFile(path, agents, fromPackage);
  }
}

/** loadCustomAgents: packages first, then `<agentDir>/agents`, `<cwd>/.agents/agents`, `<cwd>/.pi/agents` (no trust needed). */
function customAgents(config: PiConfig, gate: PackageGate | undefined): Map<string, AgentDefinition> {
  const agents = new Map<string, AgentDefinition>();
  const packages = packageAgentPaths(config, gate);
  for (const dir of packages.dirs) loadAgentDir(dir, agents, true, packages.excluded);
  for (const file of packages.files) loadAgentFile(file, agents, true);
  loadAgentDir(join(config.agentDir, "agents"), agents, false);
  if (config.cwd) {
    loadAgentDir(join(config.cwd, ".agents", "agents"), agents, false);
    loadAgentDir(join(config.cwd, ".pi", "agents"), agents, false);
  }
  return agents;
}

/** `src/mention.ts` handleBase: the agent type's slug in the `[\w-]` the mention grammar allows. */
function handleBase(type: string): string {
  const slug = type.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64).replace(/-+$/, "");
  return slug || "agent";
}

/** `src/mention.ts` RESERVED_HANDLES: `@main` addresses the main conversation, never an agent. */
const RESERVED_HANDLE = "main";

/**
 * buildAgentRegistry (defaults, then the agent files over them), its enabled types, and the handle
 * each resolves under: resolveHandleToType takes the first type with that handle.
 */
export function subagentMentions(config: PiConfig): SubagentMention[] {
  if (!piLoadsExtension(config, SUBAGENTS_IDENTITY, SUBAGENTS_ENTRY)) return [];
  const settings = subagentSettings(config);
  if (settings.agentMentions === "off") return [];
  const registry = new Map<string, AgentDefinition>(settings.disableDefaultAgents ? [] : DEFAULT_AGENTS.map(([name, description]) => [name, { description, enabled: true }]));
  for (const [name, agent] of customAgents(config, settings.packageAgents)) registry.set(name, agent);
  const handles = new Set<string>();
  const mentions: SubagentMention[] = [];
  for (const [name, { description, enabled }] of registry) {
    const handle = handleBase(name);
    if (!enabled || handle === RESERVED_HANDLE || handles.has(handle)) continue;
    handles.add(handle);
    mentions.push({ handle, description: description || name });
  }
  return mentions;
}
