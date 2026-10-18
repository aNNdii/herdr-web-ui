import type { SlashCommand, SubagentMention } from "../shared/protocol.ts";
import { AGENT_SOURCES } from "./skills/index.ts";
import type { AgentCommandContext, AgentCommandSource, ProcessRoots } from "./skills/index.ts";
import { ancestorsToRepoRoot } from "./skills/walk.ts";

const DESCRIPTIONS: Record<string, string> = {
  clear: "Clear the conversation", compact: "Compact conversation context", config: "Open configuration",
  cost: "Show token usage and cost", help: "Show available commands", init: "Initialize project instructions",
  memory: "Edit agent memory", model: "Choose a model", permissions: "Manage tool permissions", review: "Review changes",
  status: "Show session status", doctor: "Check the installation", login: "Sign in", logout: "Sign out",
  "pr-comments": "Fetch pull request comments", "release-notes": "Show release notes", "terminal-setup": "Configure terminal integration",
  vim: "Toggle Vim mode", new: "Start a new session", sessions: "List sessions", exit: "Exit the agent",
  diff: "Show the current diff", quit: "Exit the agent",
  goal: "[condition|clear] — Keep working until a condition is met",
  effort: "Set effort level for model usage",
};

const agentSource = (agent: string | null | undefined): AgentCommandSource | undefined => agent && Object.hasOwn(AGENT_SOURCES, agent) ? AGENT_SOURCES[agent] : undefined;

function commandContext(cwd: string | null | undefined, home: string, process: ProcessRoots): AgentCommandContext {
  const ancestors = cwd ? ancestorsToRepoRoot(cwd) : [];
  return { home, cwd, repoRoot: ancestors.at(-1) ?? null, env: process.environ ?? null, roots: process };
}

export function paneCommands(agent: string | null | undefined, cwd: string | null | undefined, home = globalThis.process.env.HOME ?? "", process: ProcessRoots = {}): SlashCommand[] {
  const source = agentSource(agent);
  if (!source) return [];
  const commands: SlashCommand[] = source.builtins.map((name) => ({ name, description: source.descriptions?.[name] ?? DESCRIPTIONS[name] ?? `Run /${name}`, source: "builtin" }));
  const discovered = source.discover(commandContext(cwd, home, process));
  const names = new Set<string>();
  for (const command of discovered) {
    if (agent === "omo" && names.has(command.name)) continue;
    names.add(command.name);
    commands.push(command);
  }
  return commands.sort((left, right) => left.name.localeCompare(right.name) || left.source.localeCompare(right.source));
}

/** The agent's source can list subagents at all: without it paneSubagents is [] whatever the pane runs. */
export function hasSubagents(agent: string | null | undefined): boolean {
  return agentSource(agent)?.subagents !== undefined;
}

/** The agents a message to this pane can address with a leading `@handle`; [] for agents without. */
export function paneSubagents(agent: string | null | undefined, cwd: string | null | undefined, home = globalThis.process.env.HOME ?? "", process: ProcessRoots = {}): SubagentMention[] {
  return agentSource(agent)?.subagents?.(commandContext(cwd, home, process)) ?? [];
}
