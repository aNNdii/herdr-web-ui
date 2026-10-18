import type { AgentCommandSource } from "./index.ts";
import { subagentMentions } from "./pi-agents.ts";
import { readPiConfig } from "./pi-config.ts";
import { piLoads } from "./pi-resources.ts";
import type { BundledExtension } from "./pi-resources.ts";

// The adapter: every pi rule sits behind readPiConfig (the files), piLoads (what pi loads) and
// subagentMentions (what pi-subagents routes).

/**
 * Pi 1.3.0 `dist/core/slash-commands.js`, in its order, as name, text and argument hint, less
 * /tree — the way omp's list curates its own commands. The chat reads pi's tree browser as nothing
 * at all: no card, and the pane still looks idle while the terminal waits for arrow keys. Offering
 * the one command that opens it from the chat would walk a reader into a state only the terminal
 * lens can leave. Navigating stays in the terminal; the chat's place is the abandoned-turns marker,
 * which says where a /tree left off.
 */
const PI_BUILTINS: ReadonlyArray<readonly [name: string, text: string, hint?: string]> = [
  ["settings", "Open settings menu"],
  ["model", "Select model (opens selector UI)", "<provider/model>"],
  ["thinking", "Set thinking level", "<level>"],
  ["scoped-models", "Enable/disable models for Ctrl+P cycling"],
  ["export", "Export session (HTML default, or specify path: .html/.jsonl)"],
  ["import", "Import and resume a session from a JSONL file"],
  ["share", "Share session via a Radius artifact or a GitHub gist"],
  ["bug", "Report a bug to the Pi developers", "<description>"],
  ["copy", "Copy last agent message to clipboard"],
  ["name", "Set session display name"],
  ["session", "Show session info and stats"],
  ["changelog", "Show changelog entries"],
  ["hotkeys", "Show all keyboard shortcuts"],
  ["fork", "Create a new fork from a previous user message"],
  ["clone", "Duplicate the current session at the current position"],
  ["trust", "Save project trust decision for future sessions"],
  ["login", "Configure provider authentication", "<provider>"],
  ["logout", "Remove provider authentication"],
  ["new", "Start a new session"],
  ["compact", "Manually compact the session context"],
  ["resume", "Resume a different session"],
  ["reload", "Reload keybindings, extensions, skills, prompts, themes, and context files"],
  ["quit", "Quit pi"],
];

/** The commands of Pi 1.3.0's bundled extensions (`dist/extensions/llama`, `dist/extensions/mcp`). */
const BUNDLED: Record<BundledExtension, string> = {
  llama: "Manage llama.cpp router models",
  mcp: "Manage MCP servers: sign in, reconnect, enable or disable, and change exposure",
};

export const source: AgentCommandSource = {
  builtins: PI_BUILTINS.map(([name]) => name),
  descriptions: Object.fromEntries(PI_BUILTINS.map(([name, text, hint]) => [name, hint ? `${hint} — ${text}` : text])),
  discover(ctx) {
    // commands that other extensions register stay out: no file scan can know them, and they are
    // in the terminal's own `/` menu either way
    const pi = readPiConfig(ctx);
    const loaded = piLoads(pi);
    return [
      ...loaded.bundled.map((name) => ({ name, description: BUNDLED[name], source: "builtin" as const })),
      ...loaded.prompts.map(({ name, description, origin }) => ({ name, description, source: origin === "package" ? "plugin" as const : origin })),
      ...(pi.skillCommands ? loaded.skills.map(({ name, description, origin }) => ({ name: `skill:${name}`, description, source: "skill" as const, origin: origin === "package" ? "plugin" as const : origin })) : []),
    ];
  },
  subagents: (ctx) => subagentMentions(readPiConfig(ctx)),
};
