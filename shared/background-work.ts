/**
 * The agent kinds whose `background_tasks` count holds only work that wakes the session when it
 * ends (agents and workflows), and whose count drops what a dead host left: OmO's session tasks
 * and Pi's pi-subagents agents and workflows. While any of that work runs, a pane at rest is
 * waiting on it and reads BG (src/lib/status.ts `paneStatus`), and the server holds its turn's
 * end for as long as the work runs (server/background-wait.ts, uncapped).
 *
 * Any other kind's count may hold more. Claude's also holds the background shell commands a turn
 * left running (a dev server), which wake nothing: so the server caps its hold at WAIT_LIMIT_MS
 * (30 minutes), and its count alone does not read as BG, only its turn's hold
 * (`background_wait`) does.
 *
 * Its own file: the browser imports the value, and shared/protocol.ts reads `process.env` as it loads.
 */
export const WAKING_WORK_AGENTS: ReadonlySet<string> = new Set(["pi", "omo"]);

/** The agent's `background_tasks` holds only work that wakes its session (WAKING_WORK_AGENTS). */
export function countsOnlyWakingWork(agent: string | null | undefined): boolean {
  return agent != null && WAKING_WORK_AGENTS.has(agent);
}
