/**
 * How pi-subagents names a `SubagentWorkflow` call: by its `name`, else by its `scriptPath`'s file
 * name less `.js`, else `workflow`. The server's list and tool summary and the client's card all
 * name a call this way.
 *
 * Callers narrow the call's arguments first: each is null when absent, and otherwise a string the
 * caller has already trimmed and checked to be non-empty. `name` is used as given; a `scriptPath`
 * whose file name is empty (one ending in a separator, or just `.js`) falls through to `workflow`.
 * Cutting the title to a length is left to the caller.
 */
export function workflowTitle(name: string | null, scriptPath: string | null): string {
  if (name !== null) return name;
  const base = scriptPath?.split(/[\\/]/).pop()?.replace(/\.js$/, "");
  return base || "workflow";
}
