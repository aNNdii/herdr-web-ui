import {
  PI_SUBAGENTS_EVENTS,
  PI_SUBAGENTS_LIVE_VERSION,
  PI_SUBAGENTS_MANAGER_KEY,
  type PiSubagentsLive,
  type PiSubagentsLiveAgent,
  type PiSubagentsLiveStatus,
  type PiSubagentsLiveWorkflow,
} from "../shared/pi-subagents-bridge.ts";

/**
 * fork: what `@tintinweb/pi-subagents` runs in this pi process, kept from its own event bus and
 * manager registry (shared/pi-subagents-bridge.ts), for the web UI's `GET /v1/subagents`.
 *
 * - An agent runs from its `subagents:created` (an `Agent` background spawn, queued or not) or
 *   `subagents:started` (any top-level start, RPC, scheduler and @mention spawns included) until
 *   its `subagents:completed` or `subagents:failed`; a start after an end is a resume. Its tokens
 *   and model come from its `subagents:usage`.
 * - Only top-level agents have lifecycle events. A workflow's agents spend with `workflowId`: that
 *   is all that is seen of a workflow. A nested agent's usage is left out.
 * - `running` is the registry's own `hasRunning()`, which counts queued agents and a workflow's.
 * - The maps are capped (an ended agent goes first), and emptied when the session ends
 *   (`session_shutdown`, `subagents:disposed`) or starts: what a `/reload` aborted is not kept.
 */

export interface PiSubagentsRosterBus {
  on(channel: string, handler: (data: unknown) => void): unknown;
}

export interface PiSubagentsRosterOptions {
  now?: () => number;
  /** where the manager registry lives; globalThis by default */
  registry?: () => unknown;
}

export interface PiSubagentsRoster {
  snapshot(bridge: { pid: number; sessionFile: string | null }): PiSubagentsLive;
  /** a session started: its agents are its own (`subagents:ready` may already have come for it) */
  sessionStarted(): void;
  /** the session ended: nothing of it runs any more */
  sessionEnded(): void;
}

export const MAX_ROSTER_AGENTS = 500;
export const MAX_ROSTER_WORKFLOWS = 100;
/** the agent ids remembered per workflow, for its count */
export const MAX_WORKFLOW_AGENTS = 1000;

type Row = Record<string, unknown>;
const row = (value: unknown): Row | null => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Row : null;
const text = (value: unknown): string | undefined => typeof value === "string" && value.trim().length > 0 ? value.trim().slice(0, 300) : undefined;
const count = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

/** pi's AgentRecord statuses, as server/pi-subagents.ts maps them; the channel decides an unknown one. */
function ended(raw: unknown, failed: boolean): Exclude<PiSubagentsLiveStatus, "running"> {
  if (raw === "completed" || raw === "steered") return "completed";
  if (raw === "stopped") return "stopped";
  if (raw === "error" || raw === "aborted") return "failed";
  return failed ? "failed" : "completed";
}

export function createPiSubagentsRoster(events: PiSubagentsRosterBus, options: PiSubagentsRosterOptions = {}): PiSubagentsRoster {
  const now = options.now ?? Date.now;
  const registry = options.registry ?? (() => (globalThis as Record<symbol, unknown>)[Symbol.for(PI_SUBAGENTS_MANAGER_KEY)]);
  const agents = new Map<string, PiSubagentsLiveAgent>();
  const workflows = new Map<string, { id: string; lastUsageAt: number; agents: Set<string> }>();
  let ready = false;

  const keep = (agent: PiSubagentsLiveAgent): void => {
    agents.delete(agent.id);
    agents.set(agent.id, agent);
    while (agents.size > MAX_ROSTER_AGENTS) {
      let oldest: string | undefined;
      for (const [id, known] of agents) if (known.status !== "running") { oldest = id; break; }
      agents.delete(oldest ?? agents.keys().next().value!);
    }
  };

  const start = (data: unknown): void => {
    const event = row(data);
    const id = text(event?.["id"]);
    if (event === null || id === undefined) return;
    const known = agents.get(id);
    const type = text(event["type"]) ?? known?.type;
    const description = text(event["description"]) ?? known?.description;
    // created after started (a foreground call sent to the background, a detached resume) is the same run
    if (known?.status === "running") { keep({ ...known, ...(type ? { type } : {}), ...(description ? { description } : {}) }); return; }
    keep({ id, ...(type ? { type } : {}), ...(description ? { description } : {}), status: "running", startedAt: now(), ...(known?.model ? { model: known.model } : {}) });
  };

  const end = (data: unknown, failed: boolean): void => {
    const event = row(data);
    const id = text(event?.["id"]);
    if (event === null || id === undefined) return;
    const known = agents.get(id);
    const at = now();
    const type = text(event["type"]) ?? known?.type;
    const description = text(event["description"]) ?? known?.description;
    const toolUses = count(event["toolUses"]) ?? known?.toolUses;
    const tokens = count(row(event["tokens"])?.["total"]) ?? known?.tokens;
    const model = known?.model;
    keep({
      id, ...(type ? { type } : {}), ...(description ? { description } : {}),
      status: ended(event["status"], failed),
      startedAt: known?.startedAt ?? at - (count(event["durationMs"]) ?? 0),
      endedAt: at,
      ...(toolUses !== undefined ? { toolUses } : {}), ...(tokens !== undefined ? { tokens } : {}), ...(model ? { model } : {}),
    });
  };

  const usage = (data: unknown): void => {
    const event = row(data);
    const id = text(event?.["id"]);
    if (event === null || id === undefined) return;
    const workflowId = text(event["workflowId"]);
    if (workflowId !== undefined) {
      const known = workflows.get(workflowId) ?? { id: workflowId, lastUsageAt: 0, agents: new Set<string>() };
      known.lastUsageAt = now();
      if (known.agents.size < MAX_WORKFLOW_AGENTS) known.agents.add(id);
      workflows.delete(workflowId);
      workflows.set(workflowId, known);
      while (workflows.size > MAX_ROSTER_WORKFLOWS) workflows.delete(workflows.keys().next().value!);
      return;
    }
    // a nested agent's spend belongs to its parent's run, and an agent never started here is not listed
    const known = agents.get(id);
    if (event["parentAgentId"] !== undefined || known === undefined) return;
    const spend = row(event["usage"]);
    const tokens = ["input", "output", "cacheWrite"].reduce((sum, name) => sum + (count(spend?.[name]) ?? 0), 0);
    const model = text(event["model"]) ?? known.model;
    // the end's own total stands
    agents.set(id, { ...known, ...(known.status === "running" ? { tokens: (known.tokens ?? 0) + tokens } : {}), ...(model ? { model } : {}) });
  };

  const clear = (): void => { agents.clear(); workflows.clear(); };

  events.on(PI_SUBAGENTS_EVENTS.created, start);
  events.on(PI_SUBAGENTS_EVENTS.started, start);
  events.on(PI_SUBAGENTS_EVENTS.completed, (data) => end(data, false));
  events.on(PI_SUBAGENTS_EVENTS.failed, (data) => end(data, true));
  events.on(PI_SUBAGENTS_EVENTS.usage, usage);
  events.on(PI_SUBAGENTS_EVENTS.ready, () => { ready = true; });
  events.on(PI_SUBAGENTS_EVENTS.disposed, () => { clear(); ready = false; });

  const manager = (): { hasRunning?: unknown } | null => {
    try { return row(registry()); } catch { return null; }
  };

  return {
    snapshot: ({ pid, sessionFile }) => {
      const entry = manager();
      let running: boolean | null = null;
      try { if (typeof entry?.hasRunning === "function") running = entry.hasRunning() === true; } catch { running = null; }
      return {
        version: PI_SUBAGENTS_LIVE_VERSION,
        pid,
        sessionFile,
        loaded: ready || typeof entry?.hasRunning === "function",
        running,
        agents: [...agents.values()],
        workflows: [...workflows.values()].map((workflow): PiSubagentsLiveWorkflow => ({ id: workflow.id, lastUsageAt: workflow.lastUsageAt, agents: workflow.agents.size })),
      };
    },
    sessionStarted: clear,
    sessionEnded: () => { clear(); ready = false; },
  };
}
