/**
 * fork: the live state of `@tintinweb/pi-subagents` inside a pi process, as the web UI's pi
 * extension (integrations/pi-ask.ts, its roster in integrations/pi-subagents-roster.ts) serves it
 * on the same unix socket as shared/pi-ask-bridge.ts, and server/pi-subagents-live.ts asks for it.
 *
 *   GET /v1/subagents -> PiSubagentsLive
 *
 * An extension from before this route answers 404: the server then reads the session file alone.
 * Written against pi-subagents 0.23.1 (its README "Events" table and docs/rpc.md "The manager
 * registry"): the lifecycle events speak of top-level agents only, `subagents:usage` of every
 * agent (a workflow's with `workflowId`, a nested one's with `parentAgentId`), and workflows emit no
 * lifecycle event of their own.
 */

export const PI_SUBAGENTS_LIVE_ROUTE = "/v1/subagents";
export const PI_SUBAGENTS_LIVE_VERSION = 1;

/** pi-subagents 0.23.1's channels on `pi.events`. */
export const PI_SUBAGENTS_EVENTS = {
  created: "subagents:created",
  started: "subagents:started",
  completed: "subagents:completed",
  failed: "subagents:failed",
  usage: "subagents:usage",
  ready: "subagents:ready",
  disposed: "subagents:disposed",
} as const;

/** `globalThis[Symbol.for(...)]`: pi-subagents' manager registry, with `hasRunning()` and `getRecord(id)`. */
export const PI_SUBAGENTS_MANAGER_KEY = "pi-subagents:manager";

/** pi's statuses mapped as server/pi-subagents.ts maps them: completed/steered, stopped, error/aborted. */
export type PiSubagentsLiveStatus = "running" | "completed" | "failed" | "stopped";

/** One top-level agent this pi process ran since its session started. Times are the pi process's `Date.now()`. */
export interface PiSubagentsLiveAgent {
  id: string;
  type?: string;
  description?: string;
  status: PiSubagentsLiveStatus;
  /** its latest (re)start; for an agent first seen at its end, that end less its duration */
  startedAt: number;
  endedAt?: number;
  toolUses?: number;
  /** input + output + cacheWrite, as pi-subagents counts `tokens.total` */
  tokens?: number;
  /** `provider/id`, once its session reported it */
  model?: string;
}

/** A `SubagentWorkflow` run, seen only through its agents' `subagents:usage`. */
export interface PiSubagentsLiveWorkflow {
  /** pi-subagents' `workflowId`, the run's task id */
  id: string;
  lastUsageAt: number;
  /** how many of its agents spent something so far */
  agents: number;
}

export interface PiSubagentsLive {
  version: typeof PI_SUBAGENTS_LIVE_VERSION;
  pid: number;
  /** the session file pi is writing, or null before it has one */
  sessionFile: string | null;
  /** pi-subagents runs in this session: its `subagents:ready` came, or its manager registry is there */
  loaded: boolean;
  /** the registry's `hasRunning()` (queued agents count, a workflow's too); null without a registry */
  running: boolean | null;
  agents: PiSubagentsLiveAgent[];
  workflows: PiSubagentsLiveWorkflow[];
}
