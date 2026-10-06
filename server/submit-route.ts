/** What submitText does with a message agent.prompt refused. */
export type SubmitRoute = "type" | "rethrow" | "refuse-no-agent" | "refuse-busy";

/**
 * Decides the fate of a message after agent.prompt failed with `code`.
 * `queuedOnly`: the agent is a Codex "blocked" only by questions waiting in its queue.
 * `agentOnly`: the message quotes the agent's reply and must never be typed into a pane's input.
 */
export function submitRoute(code: string, queuedOnly: boolean, agentOnly: boolean): SubmitRoute {
  const noAgent = code === "agent_not_found" || code === "agent_not_ready";
  if (!noAgent && !queuedOnly) return "rethrow";
  if (!agentOnly) return "type";
  // an agent-only message is not typed into a Codex busy with its queue either: the typed text would land among its questions
  return queuedOnly ? "refuse-busy" : "refuse-no-agent";
}
