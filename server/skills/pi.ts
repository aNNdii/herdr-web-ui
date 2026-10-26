import type { AgentCommandSource } from "./index.ts";
import { subagentMentions } from "./pi-agents.ts";
import { readPiConfig } from "./pi-config.ts";
import { piLoads } from "./pi-resources.ts";
import type { BundledExtension } from "./pi-resources.ts";

// The adapter: every pi rule sits behind readPiConfig (the files), piLoads (what pi loads) and
// subagentMentions (what pi-subagents routes).

/** pi states what each command opens or does, in its own words, read off its palette. */
const PI_DESCRIPTIONS: Record<string, string> = {
  settings: "Open settings menu", model: "Select model (opens selector UI)", thinking: "Set thinking level",
  "scoped-models": "Enable/disable models for Ctrl+P cycling", login: "Configure provider authentication",
  logout: "Remove provider authentication", new: "Start a new session",
  resume: "Resume a different session", name: "Set session display name", session: "Show session info and stats",
  fork: "Create a new fork from a previous user message",
  clone: "Duplicate the current session at the current position", compact: "Manually compact the session context",
  import: "Import and resume a session from a JSONL file", copy: "Copy last agent message to clipboard",
  export: "Export session (HTML default, or specify path: .html/.jsonl)", share: "Share session via a Radius artifact or a GitHub gist",
  bug: "Report a bug to the Pi developers", trust: "Save project trust decision for future sessions",
  reload: "Reload keybindings, extensions, skills, prompts, themes, and context files", hotkeys: "Show all keyboard shortcuts",
  changelog: "Show changelog entries", quit: "Quit pi", tree: "Navigate session tree (switch branches)",
};

// Canonical builtins and behavior from earendil-works/pi 5c1736f82d201d09664642ab0d88147da94b450e.
const PI_BUILTINS = [
  "settings", "model", "tree", "thinking", "scoped-models", "export", "import", "share", "bug", "copy",
  "name", "session", "changelog", "hotkeys", "fork", "clone", "trust", "login", "logout", "new",
  "compact", "resume", "reload", "quit",
];
const PI_TERMINAL_BOUND = [
  "tree",
];
const PI_FORMS: NonNullable<AgentCommandSource["forms"]> = {
  model: [{ match: "bare", interaction: "dialog", dialog: "pi-model" }, { match: "other", interaction: "none" }],
  thinking: [{ match: "bare", interaction: "dialog", dialog: "pi-thinking" }, { match: "other", interaction: "none" }],
  tree: [{ match: "bare", interaction: "terminal" }],
  fork: [{ match: "bare", interaction: "terminal" }],
  resume: [{ match: "bare", interaction: "terminal" }],
  settings: [{ match: "bare", interaction: "terminal" }],
  "scoped-models": [{ match: "bare", interaction: "terminal" }],
  login: [{ match: "bare", interaction: "terminal" }, { match: "other", interaction: "terminal" }],
  compact: [{ match: "bare", interaction: "none" }],
  session: [{ match: "bare", interaction: "terminal" }],
  hotkeys: [{ match: "bare", interaction: "terminal" }],
  changelog: [{ match: "bare", interaction: "terminal" }],
  logout: [{ match: "bare", interaction: "terminal" }],
  new: [{ match: "bare", interaction: "unknown" }],
  name: [{ match: "bare", interaction: "terminal" }, { match: "other", interaction: "none" }],
  clone: [{ match: "bare", interaction: "unknown" }],
  import: [{ match: "bare", interaction: "terminal" }, { match: "other", interaction: "terminal" }],
  copy: [{ match: "bare", interaction: "terminal" }],
  export: [{ match: "bare", interaction: "terminal" }, { match: "other", interaction: "terminal" }],
  share: [{ match: "bare", interaction: "terminal" }],
  bug: [{ match: "bare", interaction: "terminal" }, { match: "other", interaction: "terminal" }],
  trust: [{ match: "bare", interaction: "terminal" }],
  reload: [{ match: "bare", interaction: "terminal" }],
  quit: [{ match: "bare", interaction: "terminal" }],
};

/** The commands of Pi 1.3.0's bundled extensions (`dist/extensions/llama`, `dist/extensions/mcp`). */
const BUNDLED: Record<BundledExtension, string> = {
  llama: "Manage llama.cpp router models",
  mcp: "Manage MCP servers: sign in, reconnect, enable or disable, and change exposure",
};

export const source: AgentCommandSource = {
  // Commands other extensions register are runtime-only and are not listed (packages' skills and
  // prompts are, see discover); typed commands still send through the terminal and receive an
  // unknown outcome.
  // The upstream quit description uses `${APP_NAME}`; its pinned app name is "pi".
  pin: "1.3.0",
  builtins: PI_BUILTINS,
  descriptions: PI_DESCRIPTIONS,
  forms: PI_FORMS,
  terminalBound: PI_TERMINAL_BOUND,
  discover(ctx) {
    // commands that other extensions register stay out: no file scan can know them, and they are
    // in the terminal's own `/` menu either way
    const pi = readPiConfig(ctx);
    const loaded = piLoads(pi);
    return [
      ...loaded.bundled.map((name) => ({ name, description: BUNDLED[name], source: "builtin" as const })),
      ...loaded.prompts.map(({ name, description, origin }) => ({ name, description, source: origin === "package" ? "plugin" as const : origin })),
      ...(pi.skillCommands ? loaded.skills.map(({ name, description, origin, id }) => ({ name: `skill:${name}`, description, source: "skill" as const, origin: origin === "package" ? "plugin" as const : origin, ...(id ? { id } : {}) })) : []),
    ];
  },
  subagents: (ctx) => subagentMentions(readPiConfig(ctx)),
};
