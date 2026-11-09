import { realpathSync } from "node:fs";

import {
  PI_SUBAGENTS_LIVE_ROUTE,
  PI_SUBAGENTS_LIVE_VERSION,
  type PiSubagentsLive,
  type PiSubagentsLiveAgent,
  type PiSubagentsLiveStatus,
  type PiSubagentsLiveWorkflow,
} from "../shared/pi-subagents-bridge.ts";
import { piExtensionSocket } from "./pi.ts";
import type { PiLiveView } from "./pi-subagents.ts";
import { userHome } from "./user-home.ts";

/**
 * fork: what a Pi pane's pi process says of its `@tintinweb/pi-subagents` agents itself, through the
 * web UI's pi extension (`GET /v1/subagents` on its socket, shared/pi-subagents-bridge.ts), as the
 * override server/pi-subagents.ts lays over the session file. The socket is the one server/pi.ts
 * finds and checks for the extension's other routes; an answer counts only when it names the
 * pane's located pi pid and the tracked session file. No extension, one from before the route (404),
 * a socket that is gone or too slow, Windows (no socket): no answer, and the file alone speaks.
 *
 * One poll without an answer is no word from pi, and dropping to the file for it would show a
 * `/reload`'s lost agents running again for that poll (and flap the counts and alerts): an answer
 * that may come next poll (too slow, a failed request, no socket, which is also the moment between
 * a `/reload`'s two bridges) is MISSED, and the last answer stands through MAX_MISSED_ANSWERS of
 * them in a row. A definitive one (null: a 404 from an extension without the route, an answer not
 * of its shape, or one for another pid or session file) drops it at once, as does the tracker when
 * the pane's pi process or session changes or the pane leaves pi.
 *
 * pi-subagents tells nothing of a workflow's end, and between two stages of one nothing may run:
 * a `SubagentWorkflow` the file still has running ends (as lost) only once the manager answered
 * idle (`running: false`) on two polls at least IDLE_CONFIRM_MS apart, with every answer between
 * them idle and nothing started, ended or spent in between. That closes a `/reload` (which aborts
 * every workflow and writes nothing) without a stage's gap ending a workflow that goes on.
 *
 * The window is a minute, not seconds: `hasRunning()` counts running and queued agents, a workflow's
 * included, and a script has no filesystem or network of its own, so between two `agent()` calls
 * it only computes. But an agent's `gate` (a shell command, often a test suite, up to ten minutes)
 * runs after a non-isolated child completed, and a paused run starts nothing once its agents
 * finished: the manager is idle meanwhile. A minute covers most gates; a longer gate or pause still
 * ends the workflow as lost. A false end is the worse error (it ends a background wait and fires a
 * done alert early), a late one only keeps a `/reload`'s aborted workflow counted for that minute.
 */

/** how long an answer may take: the extension answers from memory */
export const LIVE_READ_MS = 800;
/** no answer this time, though the next poll may get one: the last answer stands (see above) */
export const MISSED = "missed";
export type PiLiveAnswer = PiSubagentsLive | typeof MISSED | null;
/** the polls in a row the last answer stands through without one */
export const MAX_MISSED_ANSWERS = 2;
/** how long the manager must stay idle before what the file alone still runs counts as ended */
export const IDLE_CONFIRM_MS = 60_000;
const MAX_AGENTS = 1000;
const MAX_WORKFLOWS = 200;

type Row = Record<string, unknown>;
const row = (value: unknown): Row | null => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Row : null;
/** as server/pi-subagents.ts cuts its texts, so a description compares with a call's */
const text = (value: unknown): string | undefined => typeof value === "string" && value.trim().length > 0 ? value.trim().slice(0, 300) : undefined;
const count = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
const STATUSES: ReadonlySet<string> = new Set<PiSubagentsLiveStatus>(["running", "completed", "failed", "stopped"]);

/** A `/v1/subagents` answer, every field checked; null for anything else. */
export function parsePiSubagentsLive(value: unknown): PiSubagentsLive | null {
  const answer = row(value);
  if (answer?.["version"] !== PI_SUBAGENTS_LIVE_VERSION || typeof answer["pid"] !== "number" || typeof answer["loaded"] !== "boolean") return null;
  const sessionFile = answer["sessionFile"];
  const running = answer["running"];
  if ((sessionFile !== null && typeof sessionFile !== "string") || (running !== null && typeof running !== "boolean")) return null;
  if (!Array.isArray(answer["agents"]) || !Array.isArray(answer["workflows"])) return null;
  const agents = answer["agents"].slice(0, MAX_AGENTS).flatMap((raw): PiSubagentsLiveAgent[] => {
    const agent = row(raw);
    const id = text(agent?.["id"]);
    const status = agent?.["status"];
    const startedAt = count(agent?.["startedAt"]);
    if (agent === null || id === undefined || typeof status !== "string" || !STATUSES.has(status) || startedAt === undefined) return [];
    const optional = { type: text(agent["type"]), description: text(agent["description"]), endedAt: count(agent["endedAt"]), toolUses: count(agent["toolUses"]), tokens: count(agent["tokens"]), model: text(agent["model"]) };
    return [{ id, status: status as PiSubagentsLiveStatus, startedAt, ...Object.fromEntries(Object.entries(optional).filter(([, field]) => field !== undefined)) }];
  });
  const workflows = answer["workflows"].slice(0, MAX_WORKFLOWS).flatMap((raw): PiSubagentsLiveWorkflow[] => {
    const workflow = row(raw);
    const id = text(workflow?.["id"]);
    const lastUsageAt = count(workflow?.["lastUsageAt"]);
    return id === undefined || lastUsageAt === undefined ? [] : [{ id, lastUsageAt, agents: count(workflow?.["agents"]) ?? 0 }];
  });
  return { version: PI_SUBAGENTS_LIVE_VERSION, pid: answer["pid"], sessionFile, loaded: answer["loaded"], running, agents, workflows };
}

/** What the extension on `socket` answers; null for a 404 (an older extension) or not its shape, MISSED when no listener, too slow or failed. */
export async function readPiSubagentsLive(socket: string, signal?: AbortSignal): Promise<PiLiveAnswer> {
  try {
    const timeout = AbortSignal.timeout(LIVE_READ_MS);
    const response = await fetch(`http://localhost${PI_SUBAGENTS_LIVE_ROUTE}`, { unix: socket, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (response.status === 404) return null;
    if (!response.ok) return MISSED;
    return parsePiSubagentsLive(await response.json());
  } catch {
    return MISSED;
  }
}

/** The pane's pi process as the tracker located it: its pid, cwd and environment, and the session file it writes. */
export interface PiLiveTarget { pid: number; cwd: string | null; environ: readonly string[] | null; path: string }

/** pi names its session file as it opened it; the tracker holds it canonical. */
function sameFile(named: string | null, path: string): boolean {
  if (named === null) return false;
  if (named === path) return true;
  try { return realpathSync(named) === path; } catch { return false; }
}

/** The live answer of the pane's pi process, through its own extension socket; MISSED without one now (no socket included), null when it does not speak for this pid and session. */
export async function askPiSubagentsLive(target: PiLiveTarget, options: { home?: string; signal?: AbortSignal } = {}): Promise<PiLiveAnswer> {
  const socket = await piExtensionSocket({ pid: target.pid, cwd: target.cwd }, target.environ, options.home ?? userHome());
  if (socket === null) return MISSED;
  const answer = await readPiSubagentsLive(socket, options.signal);
  if (answer === null || answer === MISSED) return answer;
  return answer.pid === target.pid && sameFile(answer.sessionFile, target.path) ? answer : null;
}

/** The answers of one pane's pi so far: the newest, and the idle streak it ends. */
export interface PiLiveState {
  answer: PiSubagentsLive;
  /** piSubagentsMark() taken before it was asked for */
  mark: number;
  /** what was started, ended or spent, as of this answer: another one between two idle answers breaks their streak */
  activity: string;
  /** the idle answers in a row: the first one's time and mark, how many, and the latest one's time */
  idle: { at: number; mark: number; answers: number; lastAt: number } | null;
  /** the polls in a row without an answer since this one */
  missed: number;
}

function activityOf(answer: PiSubagentsLive): string {
  const agents = answer.agents.map((agent) => `${agent.id}:${agent.status}:${agent.startedAt}:${agent.endedAt ?? ""}`).sort();
  const workflows = answer.workflows.map((workflow) => `${workflow.id}:${workflow.lastUsageAt}`).sort();
  return `${agents.join(",")}|${workflows.join(",")}`;
}

/**
 * The state after an answer asked for at `mark` came in at `at` (the tracker's clock); null without
 * an answer: the file alone. A MISSED one keeps the last answer, its mark and idle streak, through
 * MAX_MISSED_ANSWERS in a row.
 */
export function nextPiLiveState(previous: PiLiveState | null, answer: PiLiveAnswer, mark: number, at: number): PiLiveState | null {
  if (answer === MISSED) return previous !== null && previous.missed < MAX_MISSED_ANSWERS ? { ...previous, missed: previous.missed + 1 } : null;
  if (answer === null) return null;
  const activity = activityOf(answer);
  if (answer.running !== false) return { answer, mark, activity, idle: null, missed: 0 };
  const streak = previous?.idle && previous.activity === activity ? previous.idle : null;
  return { answer, mark, activity, idle: streak ? { ...streak, answers: streak.answers + 1, lastAt: at } : { at, mark, answers: 1, lastAt: at }, missed: 0 };
}

/** The override for server/pi-subagents.ts, or null when the pi process does not load pi-subagents (the file alone, as before). */
export function piLiveView(state: PiLiveState | null): PiLiveView | null {
  if (state === null || !state.answer.loaded) return null;
  const idle = state.idle;
  const confirmed = idle !== null && idle.answers >= 2 && idle.lastAt - idle.at >= IDLE_CONFIRM_MS;
  return {
    mark: state.mark,
    agents: new Map(state.answer.agents.map((agent) => [agent.id, agent])),
    idle: confirmed ? { mark: idle.mark } : null,
  };
}
