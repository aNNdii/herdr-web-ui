/**
 * The rows of the `@` menu: the agents a leading `@handle` can address, then the pane's files.
 * Pure and DOM-free; the composer fetches both lists and draws what this returns.
 */

import type { SubagentMention } from "../../shared/protocol.ts";
import type { ActiveTrigger } from "./mentions.ts";

/** an agent to address, or a file path to mention */
export type MentionChoice = SubagentMention | string;

/**
 * Agents only for the message's first word (`trigger.leading`), matched as pi-subagents does:
 * the handle starts with the query, ignoring case. They go before the files.
 */
export function mentionChoices(
  agents: readonly SubagentMention[],
  files: readonly string[],
  trigger: ActiveTrigger | null,
): MentionChoice[] {
  if (trigger?.kind !== "file") return [];
  if (!trigger.leading) return [...files];
  const typed = trigger.query.toLowerCase();
  return [...agents.filter((agent) => agent.handle.toLowerCase().startsWith(typed)), ...files];
}

/** a row id: the path for a file, `subagent:<handle>` for an agent, so a file named like a handle keeps its own row */
export function mentionChoiceId(choice: MentionChoice): string {
  return typeof choice === "string" ? choice : `subagent:${choice.handle}`;
}

/** the token a picked row puts in the message */
export function mentionText(choice: MentionChoice): string {
  return typeof choice === "string" ? `@${choice} ` : `@${choice.handle} `;
}
