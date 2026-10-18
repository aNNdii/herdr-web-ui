import { closeSync, lstatSync, openSync, readSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OmoRun, OmoTask, OmoTaskResult } from "../shared/protocol.ts";
import { workflowTitle } from "../shared/workflow-title.ts";
import { plain, READ_BUDGET, readLines, RECENT_LIMIT, RECENT_MS, remember, START_SLACK_MS } from "./claude-subagents.ts";

/**
 * The agents and `SubagentWorkflow` runs a Pi pane's `@tintinweb/pi-subagents` 0.22.0 started, for
 * the pane's running count, the background list and the chat's result cards. Every rule of
 * pi-subagents' on-disk format lives here, ported, never imported: the pi session file is the
 * truth. The whole file counts, every branch of it.
 *
 * - A background agent starts (or resumes) with an `Agent` tool result whose `details.status` is
 *   `background`, keyed by `details.agentId`, and runs until a later `custom` entry
 *   `subagents:record` for that id (or one written after its call but before that result: pi's
 *   parallel tool mode writes a batch's results last). The newest record wins. An agent known only from its record
 *   (an @mention, the scheduler) is listed as ended.
 * - A foreground agent is an `Agent` tool call that has no result yet, keyed by the call's id. It
 *   runs only while its assistant message stopped for `toolUse` and every later `message` entry is
 *   a `toolResult` of that same message: pi's sequential tool mode writes each result as it
 *   finishes. Any other `Agent` result ends agent `details.agentId` with the result's numbers; its
 *   record may come before or after it. pi writes it before: a record whose description (and
 *   type) is a waiting call's ends that call, unless a background agent of its id still runs.
 * - A workflow starts with a `SubagentWorkflow` tool result carrying `details.taskId` and ends with
 *   the `subagent-notification` custom message naming it, in `details` or `details.others`.
 * - pi's statuses map as completed/steered → completed, stopped → cancelled, aborted (its turn
 *   limit)/error → failed.
 * - What runs lives in the pi process that started it: one the pane no longer runs pi for, or
 *   that started more than START_SLACK_MS before the pi process now in the pane, is lost. That is
 *   worked out when read, never stored.
 * - `/reload` is not seen: it keeps the process and the session file and aborts every agent and
 *   workflow, but (checked with pi 1.3.0 and pi-subagents 0.22.0) writes nothing to the session:
 *   no record for an aborted agent, no notification for a workflow, no marker of the reload. What
 *   ran at a reload stays `running` until pi restarts in the pane, which makes it lost.
 *
 * The file is read from where the last read stopped, at most a budget of bytes per call: until it
 * has been read to its end the answer is behind. The counts say so (`current`), and the list is
 * empty meanwhile. The chat's cards are the exception: they read the file to its end, unbounded,
 * once per session (the index is kept, so later reads go on from there). Malformed and unfinished lines are passed over, the maps are capped, and only plain
 * files are opened.
 *
 * The list's rows, and only those, are enriched from the session's tasks dir, which pi-subagents
 * keeps at `<tmp>/pi-subagents-<uid>/<encodeCwd(cwd)>/<session id>/tasks/` (`<tmp>` is the pi
 * process's TMPDIR, TMP or TEMP, as Node's os.tmpdir() picks it):
 * - `<agentId>.output`, the agent's own transcript: its turns, tool calls and tokens (input +
 *   output + cacheWrite of every assistant line, pi's getLifetimeTotal) and model;
 * - `<runId>.workflow.jsonl`, a workflow's journal: one line per settled agent, `ok` or not;
 * - `<runId>.workflow.js`, its script: the name its `meta` literal gives, parsed, never run.
 *
 * A lost item ended when its file last changed. The dir is only an addition: without it (a
 * reboot, another TMPDIR, a root this user does not own) the rows stay, without those numbers. Its files are read incrementally
 * too, within one budget per call that the rows shown share.
 *
 * In the chat a notification becomes one result card, an entry per id it names. An agent's entry
 * takes the result of its newest record at or before the notification (a resumed agent's later
 * answer belongs to its later card), else the notification's preview; a workflow's takes the
 * `<result>` of its `<task-notification>` block. The chat never reads the tasks dir but for a
 * workflow script's name.
 */

/** One Pi pane's session as the tracker resolved it. */
export interface PiSession {
  /** the pi session file (canonical, as piTranscriptPath returns it) */
  path: string;
  /** the pi process's environment where readable: TMPDIR/TMP/TEMP move the tasks dir; null: this server's os.tmpdir() */
  environ: readonly string[] | null;
  /** the pane still runs pi on this session; false leaves whatever was running lost */
  live: boolean;
  /** when the pi process now in the pane started; a start older than this less START_SLACK_MS is lost */
  startedAt: number | null;
}

export interface PiSubagentCounts {
  /** running agents (background and foreground) and running workflows */
  running: number;
  /** of those, the ones started at or after promptAt */
  turnRunning: number;
  /** the newest `message` entry with role `user`; custom messages do not count */
  promptAt: number | null;
  /** false while the budgeted read is behind: the counts say only what was read so far */
  current: boolean;
}

export interface PiSubagentActivity { tasks: OmoTask[]; runs: OmoRun[] }

/** A page's card mapper: an entry's result card entries, or null when it is no notification it can read. */
export type PiSubagentCards = (entry: unknown) => OmoTaskResult[] | null;

type Ended = "completed" | "failed" | "cancelled";
type Row = Record<string, unknown>;
const row = (value: unknown): Row | null => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Row : null;
const text = (value: unknown): string | null => typeof value === "string" && value.trim().length > 0 ? value.trim().slice(0, 300) : null;
const count = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const stamp = (value: unknown): number | null => { const at = typeof value === "string" ? Date.parse(value) : NaN; return Number.isFinite(at) ? at : null; };
const iso = (at: number): string => new Date(at).toISOString();

const MAX_SESSIONS = 64;
const MAX_AGENTS = 2000;
const MAX_RUNS = 500;
const MAX_CALLS = 512;
const MAX_FILES = 2048;
/** how much of a workflow script is looked through for its `meta` */
const SCRIPT_HEAD = 64 * 1024;
/** a session or task id is a file name's part: nothing that could leave the folder */
const FILE_PART = /^[A-Za-z0-9_-]+$/;
/** how much of an agent's result a card holds, as for OmO's */
const RESULT_MAX = 16_000;
/** how much of a workflow's result its notification holds */
const WORKFLOW_RESULT_MAX = 4_000;
/** the records kept per agent, for the cards of its resumed runs */
const MAX_RECORDS = 4;

/** `seq`: the line it was read from, which orders what one timestamp cannot */
interface Start { at: number; seq: number }

interface AgentFacts {
  id: string;
  title: string | null;
  type: string | null;
  model: string | null;
  /** its latest (re)start */
  start: Start;
  /** how its latest run ended (`seq`: the line that told it); null while it runs */
  end: { status: Ended; at: number; seq: number; turns: number | null; toolCalls: number | null } | null;
  /** the results its records gave, oldest first, each cut to RESULT_MAX */
  records: { at: number; text: string; cut: boolean }[];
}

interface RunFacts {
  id: string;
  callName: string | null;
  scriptPath: string | null;
  start: Start;
  end: { status: Ended; at: number; description: string | null } | null;
}

/** A foreground `Agent` call, running while its assistant message waits for it. */
interface ForegroundCall { id: string; title: string | null; type: string | null; model: string | null; start: Start }

interface SessionIndex {
  fileId: string;
  offset: number;
  skipping: boolean;
  seq: number;
  /** the read stopped for its budget: what it has not seen says nothing yet */
  behind: boolean;
  /** the file's first line: the session's id and the cwd pi started in, which name its tasks dir */
  header: { id: string; cwd: string } | null;
  /** the pi process's temp dir, the tasks dir's root */
  tmpRoot: string;
  agents: Map<string, AgentFacts>;
  runs: Map<string, RunFacts>;
  /** `Agent` and `SubagentWorkflow` calls not answered yet */
  calls: Map<string, { name: "Agent" | "SubagentWorkflow"; args: Row; at: number; seq: number }>;
  /** the newest assistant message while only its own tool results follow: its call ids, and the Agent calls of it still waiting */
  last: { callIds: string[]; open: ForegroundCall[] } | null;
  promptAt: number | null;
}

const indexes = new Map<string, SessionIndex>();

/** Reads what the session file gained since the last call, at most `budget` bytes of it. */
function catchUp(path: string, budget: number, environ?: readonly string[] | null): SessionIndex | null {
  const stat = plain(path);
  if (stat === null) { indexes.delete(path); return null; }
  let index = indexes.get(path);
  if (!index || index.fileId !== stat.id || index.offset > stat.size) {
    index = { fileId: stat.id, offset: 0, skipping: false, seq: 0, behind: false, header: null, tmpRoot: "", agents: new Map(), runs: new Map(), calls: new Map(), last: null, promptAt: null };
  }
  // the chat does not know the pi process: it keeps whatever root the tracker gave
  if (environ !== undefined || index.tmpRoot === "") index.tmpRoot = tmpRootOf(environ ?? null);
  remember(indexes, path, index, MAX_SESSIONS);
  if (index.offset >= stat.size) { index.behind = false; return index; }
  const state = index;
  const read = readLines(path, state.offset, stat.size, budget, (line) => scanLine(state, line), state.skipping);
  state.offset = read.offset;
  state.skipping = read.skipping;
  state.behind = read.more;
  return state;
}

/**
 * catchUp, one budget after another, until the file is read to its end: unbounded. It stops early
 * when a read gets no further (a failed read), leaving the index behind.
 */
function catchUpToEnd(path: string): SessionIndex | null {
  let index = catchUp(path, READ_BUDGET);
  for (let offset = -1; index?.behind && index.offset !== offset;) {
    offset = index.offset;
    index = catchUp(path, READ_BUDGET);
  }
  return index;
}

function scanLine(index: SessionIndex, line: string): void {
  const seq = ++index.seq;
  if (seq === 1 && line.includes('"type":"session"')) { index.header = sessionHeader(line); return; }
  const message = line.includes('"type":"message"');
  if (!message && !line.includes('"subagents:record"') && !line.includes('"subagent-notification"')) return;
  // with no Agent call waiting, a message matters only as a prompt or for an Agent or SubagentWorkflow call
  if (message && !index.last?.open.length && !line.includes('"role":"user"') && !line.includes('"Agent"') && !line.includes('"SubagentWorkflow"')) return;
  let entry: Row | null;
  try { entry = row(JSON.parse(line)); } catch { return; }
  const at = stamp(entry?.["timestamp"]);
  if (entry === null || at === null) return;
  if (entry["type"] === "message") scanMessage(index, row(entry["message"]), { at, seq });
  else if (entry["type"] === "custom" && entry["customType"] === "subagents:record") scanRecord(index, row(entry["data"]), { at, seq });
  else {
    for (const [id, { details }] of notification(entry) ?? []) {
      const run = index.runs.get(id);
      const status = endStatus(details["status"]);
      if (run && status !== null) run.end = { status, at, description: text(details["description"]) };
    }
  }
}

function sessionHeader(line: string): SessionIndex["header"] {
  let entry: Row | null;
  try { entry = row(JSON.parse(line)); } catch { return null; }
  const id = entry?.["id"];
  const cwd = entry?.["cwd"];
  return entry?.["type"] === "session" && typeof id === "string" && typeof cwd === "string" ? { id, cwd } : null;
}

function scanMessage(index: SessionIndex, message: Row | null, start: Start): void {
  const role = message?.["role"];
  if (message === null || role === "user") {
    if (role === "user") index.promptAt = start.at;
    index.last = null;
    return;
  }
  if (role === "assistant") {
    const calls = (Array.isArray(message["content"]) ? message["content"] : []).flatMap((value) => {
      const block = row(value);
      return block?.["type"] === "toolCall" && typeof block["id"] === "string" ? [{ id: block["id"], name: block["name"], args: row(block["arguments"]) ?? {} }] : [];
    });
    for (const call of calls) if (call.name === "Agent" || call.name === "SubagentWorkflow") remember(index.calls, call.id, { name: call.name, args: call.args, at: start.at, seq: start.seq }, MAX_CALLS);
    const open = message["stopReason"] !== "toolUse" ? [] : calls.flatMap((call) => call.name !== "Agent" ? [] : [{
      id: call.id, title: text(call.args["description"]), type: text(call.args["subagent_type"]), model: text(call.args["model"]), start,
    }]);
    index.last = { callIds: calls.map((call) => call.id), open };
    return;
  }
  const callId = message["toolCallId"];
  if (role !== "toolResult" || typeof callId !== "string") { index.last = null; return; }
  if (index.last?.callIds.includes(callId)) index.last.open = index.last.open.filter((call) => call.id !== callId);
  else index.last = null;
  const call = index.calls.get(callId);
  index.calls.delete(callId);
  const details = row(message["details"]);
  if (details === null) return;
  if (message["toolName"] === "Agent") agentResult(index, details, call, start);
  else if (message["toolName"] === "SubagentWorkflow") {
    const id = text(details["taskId"]);
    if (id !== null) remember(index.runs, id, { id, callName: text(call?.args["name"]), scriptPath: text(call?.args["scriptPath"]), start: { at: call?.at ?? start.at, seq: start.seq }, end: null }, MAX_RUNS);
  }
}

/**
 * An `Agent` result: a background (re)start, or the end of a foreground run. pi's parallel tool
 * mode writes a batch's results only once every call of it is done, so a background agent can
 * finish, and its record land, before the result that started it: a record told after the call
 * keeps that run ended.
 */
function agentResult(index: SessionIndex, details: Row, call: { args: Row; at: number; seq: number } | undefined, start: Start): void {
  const id = text(details["agentId"]);
  if (id === null) return;
  const background = details["status"] === "background";
  const status = background ? null : endStatus(details["status"]);
  if (!background && status === null) return;
  const known = index.agents.get(id);
  const args = call?.args ?? {};
  const duration = count(details["durationMs"]);
  const startedAt = call?.at ?? (background || duration === null ? start.at : start.at - duration);
  const endedFirst = background && call !== undefined && known?.end && known.end.seq > call.seq ? known.end : null;
  remember(index.agents, id, {
    id,
    title: text(details["description"]) ?? text(args["description"]) ?? known?.title ?? null,
    type: text(details["subagentType"]) ?? text(args["subagent_type"]) ?? known?.type ?? null,
    model: text(details["modelName"]) ?? text(args["model"]) ?? known?.model ?? null,
    start: { at: startedAt, seq: start.seq },
    end: endedFirst ?? (status === null ? null : { status, at: start.at, seq: start.seq, turns: count(details["turnCount"]), toolCalls: count(details["toolUses"]) }),
    records: known?.records ?? [],
  }, MAX_AGENTS);
}

/** A `subagents:record`: how an agent's run ended. A foreground result told before it keeps its numbers. */
function scanRecord(index: SessionIndex, data: Row | null, start: Start): void {
  const id = text(data?.["id"]);
  const status = endStatus(data?.["status"]);
  if (data === null || id === null || status === null) return;
  const known = index.agents.get(id);
  const end = { status, at: start.at, seq: start.seq, turns: known?.end?.turns ?? null, toolCalls: known?.end?.toolCalls ?? null };
  // a record without a result still counts: the card it ends falls back to its notification's preview
  const result = typeof data["result"] === "string" ? data["result"] : "";
  const record = { at: start.at, text: result.slice(0, RESULT_MAX), cut: result.length > RESULT_MAX };
  // pi writes a foreground agent's record before its result: the waiting call it ends is that agent,
  // not a second row. A background agent still running is not.
  const description = text(data["description"]);
  const type = text(data["type"]);
  const call = known?.end === null ? undefined
    : index.last?.open.find((open) => open.title === description && (open.type === null || open.type === type));
  if (call && index.last) index.last.open = index.last.open.filter((open) => open !== call);
  if (known) {
    known.end = end;
    known.records = [...known.records, record].slice(-MAX_RECORDS);
    if (call) { known.start = call.start; known.model = call.model ?? known.model; }
    return;
  }
  remember(index.agents, id, {
    id, title: description ?? call?.title ?? null, type: type ?? call?.type ?? null, model: call?.model ?? null,
    start: call?.start ?? { at: count(data["startedAt"]) ?? start.at, seq: start.seq }, end, records: [record],
  }, MAX_AGENTS);
}

function endStatus(raw: unknown): Ended | null {
  if (raw === "completed" || raw === "steered") return "completed";
  if (raw === "stopped") return "cancelled";
  if (raw === "aborted" || raw === "error") return "failed";
  return null;
}

/**
 * The ids a `subagent-notification` speaks of, in its order: its `details` and every entry of
 * `details.others`, each with the `<task-notification>` block of its content that names it by
 * `<task-id>`. null for any other entry, or for one that names no id.
 */
function notification(entry: unknown): Map<string, { details: Row; block: string | null }> | null {
  const message = row(entry);
  if (message?.["type"] !== "custom_message" || message["customType"] !== "subagent-notification") return null;
  const details = row(message["details"]);
  if (details === null) return null;
  const blocks = new Map<string, string>();
  const content = typeof message["content"] === "string" ? message["content"] : "";
  for (const [, block = ""] of content.matchAll(/<task-notification>([\s\S]*?)<\/task-notification>/g)) {
    const id = /<task-id>([^<]*)<\/task-id>/.exec(block)?.[1]?.trim();
    if (id) blocks.set(id, block);
  }
  const others = Array.isArray(details["others"]) ? details["others"] : [];
  const told = new Map<string, { details: Row; block: string | null }>();
  for (const raw of [details, ...others.map(row)]) {
    const id = text(raw?.["id"]);
    if (raw && id !== null) told.set(id, { details: raw, block: blocks.get(id) ?? null });
  }
  return told.size > 0 ? told : null;
}

/** pi-subagents' escapeXml undone: `&amp;` last, so an escaped entity stays one. */
function unescapeXml(value: string): string {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** The text of a block's `<tag>`, as escaped as pi wrote it; null without one. */
const blockTag = (block: string | null, tag: string): string | null => block === null ? null : new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(block)?.[1] ?? null;

const cutTo = (result: string, max: number): Pick<OmoTaskResult, "result" | "result_cut"> =>
  ({ result: result.slice(0, max), ...(result.length > max ? { result_cut: true } : {}) });

/** One id's card entry; null when its status is none pi-subagents writes. */
function cardOf(index: SessionIndex | null, id: string, details: Row, block: string | null, at: number, budget: { left: number }): OmoTaskResult | null {
  const status = endStatus(details["status"]);
  if (status === null) return null;
  const numbers = { duration_ms: count(details["durationMs"]), tool_calls: count(details["toolUses"]), tokens: count(details["totalTokens"]) };
  const preview = typeof details["resultPreview"] === "string" ? details["resultPreview"] : "";
  if (id.startsWith("wf_") || index?.runs.has(id)) {
    const known = index?.runs.get(id);
    const run: RunFacts = { ...(known ?? { id, callName: null, scriptPath: null, start: { at, seq: 0 } }), end: { status, at, description: text(details["description"]) } };
    const result = blockTag(block, "result");
    // `Workflow "<name>" <status> — <done>/<total> agents[, <n> replayed from <run>]`: the counts at the end, not digits in the name
    const agents = / — (\d+)\/(\d+) agents(?:, \d+ replayed from [\s\S]*)?$/.exec(unescapeXml(blockTag(block, "summary") ?? "").trim());
    return {
      id, title: runName(run, index, budget), agent: agents ? `${agents[1]}/${agents[2]} agents` : null, model: null, status, ...numbers, turns: null,
      ...cutTo(result === null ? preview : unescapeXml(result), WORKFLOW_RESULT_MAX),
    };
  }
  const facts = index?.agents.get(id);
  // the newest record at or before the notification: a resumed agent's later record belongs to its later card
  const record = facts?.records.filter((candidate) => candidate.at <= at).at(-1);
  return {
    id, title: facts?.title ?? text(details["description"]) ?? facts?.type ?? id, agent: facts?.type ?? null, model: facts?.model ?? null, status, ...numbers,
    turns: count(details["turnCount"]),
    ...(record?.text ? { result: record.text, ...(record.cut ? { result_cut: true } : {}) } : cutTo(preview, RESULT_MAX)),
  };
}

function isLost(start: number, session: Pick<PiSession, "live" | "startedAt">): boolean {
  return !session.live || (session.startedAt !== null && start < session.startedAt - START_SLACK_MS);
}

/**
 * A workflow's name, the first there is of: the `meta.name` of the run's saved script (when `index`
 * is given and its tasks dir holds it), the notification's description less `Workflow `, then
 * workflowTitle's (the call's name, the script's base name, `workflow`).
 */
function runName(run: RunFacts, index: SessionIndex | null, budget: { left: number } = { left: READ_BUDGET }): string {
  const script = index === null ? null : taskFile(index, run.id, ".workflow.js");
  const meta = script === null ? null : scriptName(script, budget);
  if (meta !== null) return meta;
  const told = run.end?.description?.replace(/^Workflow /, "").trim();
  return told || workflowTitle(run.callName, run.scriptPath);
}

/** Node's os.tmpdir() as the pi process sees it: TMPDIR, TMP, TEMP, else /tmp; this server's own when its environment is unknown. */
function tmpRootOf(environ: readonly string[] | null): string {
  if (environ === null) return tmpdir();
  for (const name of ["TMPDIR", "TMP", "TEMP"]) {
    const value = environ.find((entry) => entry.startsWith(`${name}=`))?.slice(name.length + 1);
    if (value) return value.length > 1 && value.endsWith("/") ? value.slice(0, -1) : value;
  }
  return "/tmp";
}

/** Port of pi-subagents' output-file.ts encodeCwd: separators become dashes, less a drive prefix and leading dashes. */
function encodeCwd(cwd: string): string {
  return cwd.replace(/[/\\]/g, "-").replace(/^[A-Za-z]:-/, "").replace(/^-+/, "");
}

/** `<tmp>/pi-subagents-<uid>/<encodeCwd(cwd)>/<session id>/tasks`; null before the header is read, or for one that would leave it. */
function tasksDir(index: SessionIndex): string | null {
  const header = index.header;
  if (header === null || !FILE_PART.test(header.id)) return null;
  const cwd = encodeCwd(header.cwd);
  if (cwd === "." || cwd === "..") return null;
  const root = join(index.tmpRoot, `pi-subagents-${process.getuid?.() ?? 0}`);
  return ownRoot(root) ? join(root, cwd, header.id, "tasks") : null;
}

/**
 * The root sits in a temp dir others may write to: as pi-subagents refuses a root it does not own
 * (its chmod to 0700 fails), only a directory of this user that no one else may write is read.
 */
function ownRoot(root: string): boolean {
  const uid = process.getuid?.();
  // no uids (Windows): the temp dir is the user's own
  if (uid === undefined) return true;
  try {
    const stat = lstatSync(root);
    return stat.isDirectory() && stat.uid === uid && (stat.mode & 0o022) === 0;
  } catch { return false; }
}

function taskFile(index: SessionIndex, id: string, suffix: string): string | null {
  const dir = tasksDir(index);
  return dir === null || !FILE_PART.test(id) ? null : join(dir, `${id}${suffix}`);
}

/** What one tasks-dir file said so far, read from where the last read stopped. */
interface Tally<T> { id: string; offset: number; skipping: boolean; behind: boolean; facts: T }

function tally<T>(cache: Map<string, Tally<T>>, file: string, budget: { left: number }, fresh: () => T, each: (facts: T, line: string) => void): Tally<T> | null {
  const stat = plain(file);
  if (stat === null) { cache.delete(file); return null; }
  let known = cache.get(file);
  if (!known || known.id !== stat.id || known.offset > stat.size) known = { id: stat.id, offset: 0, skipping: false, behind: false, facts: fresh() };
  remember(cache, file, known, MAX_FILES);
  if (known.offset >= stat.size) { known.behind = false; return known; }
  if (budget.left <= 0) { known.behind = true; return known; }
  const state = known;
  const read = readLines(file, state.offset, stat.size, Math.min(budget.left, READ_BUDGET), (line) => each(state.facts, line), state.skipping);
  budget.left -= read.offset - state.offset;
  state.offset = read.offset;
  state.skipping = read.skipping;
  state.behind = read.more;
  return state;
}

const parsed = (line: string): Row | null => { try { return row(JSON.parse(line)); } catch { return null; } };

interface OutputFacts { turns: number; toolCalls: number; tokens: number; model: string | null }
const outputs = new Map<string, Tally<OutputFacts>>();

/** An agent's `.output`: one assistant line per turn, its tool calls, and its usage as pi's getLifetimeTotal sums it. */
function outputStats(file: string, budget: { left: number }): Tally<OutputFacts> | null {
  return tally(outputs, file, budget, () => ({ turns: 0, toolCalls: 0, tokens: 0, model: null }), (facts, line) => {
    // tool results can be long, and say nothing here
    if (!line.includes('"type":"assistant"')) return;
    const entry = parsed(line);
    const message = row(entry?.["message"]);
    if (entry?.["type"] !== "assistant" || message === null) return;
    facts.turns += 1;
    for (const block of Array.isArray(message["content"]) ? message["content"] : []) if (row(block)?.["type"] === "toolCall") facts.toolCalls += 1;
    const usage = row(message["usage"]);
    if (usage !== null) facts.tokens += ["input", "output", "cacheWrite"].reduce((sum, name) => sum + (count(usage[name]) ?? 0), 0);
    facts.model = text(message["model"]) ?? facts.model;
  });
}

interface JournalFacts { done: number; failed: number }
const journals = new Map<string, Tally<JournalFacts>>();

/** A workflow's journal: one line per settled agent, `ok` true or false, counted as written. */
function journalCounts(file: string, budget: { left: number }): Tally<JournalFacts> | null {
  return tally(journals, file, budget, () => ({ done: 0, failed: 0 }), (facts, line) => {
    const ok = parsed(line)?.["ok"];
    if (ok === true) facts.done += 1;
    else if (ok === false) facts.failed += 1;
  });
}

const scripts = new Map<string, { id: string; size: number; name: string | null }>();

/** The `meta.name` of a run's saved script, its head read once. */
function scriptName(file: string, budget: { left: number }): string | null {
  const stat = plain(file);
  if (stat === null) return null;
  const known = scripts.get(file);
  if (known?.id === stat.id && known.size === stat.size) return known.name;
  const length = Math.min(stat.size, SCRIPT_HEAD);
  if (length > budget.left) return null;
  const source = readHead(file, length);
  if (source === null) return null;
  budget.left -= length;
  const name = workflowMetaName(source);
  remember(scripts, file, { id: stat.id, size: stat.size, name }, MAX_FILES);
  return name;
}

function readHead(file: string, length: number): string | null {
  let fd: number;
  try { fd = openSync(file, "r"); } catch { return null; }
  try {
    const buffer = Buffer.alloc(length);
    let got = 0;
    while (got < length) {
      const n = readSync(fd, buffer, got, length - got, got);
      if (n === 0) break;
      got += n;
    }
    return buffer.subarray(0, got).toString("utf8");
  } catch { return null; } finally { closeSync(fd); }
}

/** pi-subagents' workflow/meta.ts: `export const meta =` at a line's start, allowing any inner whitespace. */
const META_DECLARATION = /(^|[\r\n])[ \t]*export[ \t\r\n]+const[ \t\r\n]+meta[ \t\r\n]*=/;

/**
 * `meta.name` as pi's extractMeta finds it: the object after `export const meta =`, to its matching
 * brace. pi evaluates that literal in an empty vm; here it is parsed as a pure literal and nothing
 * runs, so a meta that is not one (a call, a spread, a substitution) has no name.
 */
function workflowMetaName(source: string): string | null {
  const declaration = META_DECLARATION.exec(source);
  if (!declaration) return null;
  const open = source.indexOf("{", declaration.index + declaration[0].length);
  if (open === -1) return null;
  const { end, sawInterpolation } = scanObjectLiteral(source, open);
  if (end === -1 || sawInterpolation) return null;
  let meta: unknown;
  try { meta = pureLiteral(source.slice(open, end)); } catch { return null; }
  return meta instanceof Map ? text(meta.get("name")) : null;
}

/** Port of meta.ts scanObjectLiteral: the index just past the object at `open`, braces in strings, templates, comments and regexes not counted. */
function scanObjectLiteral(source: string, open: number): { end: number; sawInterpolation: boolean } {
  let depth = 0;
  let i = open;
  let sawInterpolation = false;
  let mode: "code" | "line-comment" | "block-comment" | "single" | "double" | "template" | "regex" = "code";
  const templateStack: number[] = [];
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (mode === "line-comment") { if (c === "\n") mode = "code"; i += 1; continue; }
    if (mode === "block-comment") {
      if (c === "*" && next === "/") { mode = "code"; i += 2; continue; }
      i += 1;
      continue;
    }
    if (mode === "single" || mode === "double" || mode === "regex") {
      if (c === "\\") { i += 2; continue; }
      if (mode === "single" && c === "'") mode = "code";
      else if (mode === "double" && c === '"') mode = "code";
      else if (mode === "regex" && c === "/") mode = "code";
      else if (c === "\n" && mode !== "double") mode = "code";
      i += 1;
      continue;
    }
    if (mode === "template") {
      if (c === "\\") { i += 2; continue; }
      if (c === "`") { mode = "code"; i += 1; continue; }
      if (c === "$" && next === "{") { sawInterpolation = true; templateStack.push(depth); depth += 1; mode = "code"; i += 2; continue; }
      i += 1;
      continue;
    }
    if (c === "/" && next === "/") { mode = "line-comment"; i += 2; continue; }
    if (c === "/" && next === "*") { mode = "block-comment"; i += 2; continue; }
    if (c === "'") { mode = "single"; i += 1; continue; }
    if (c === '"') { mode = "double"; i += 1; continue; }
    if (c === "`") { mode = "template"; i += 1; continue; }
    if (c === "/" && isRegexPosition(source, i)) { mode = "regex"; i += 1; continue; }
    if (c === "{") { depth += 1; i += 1; continue; }
    if (c === "}") {
      depth -= 1;
      i += 1;
      if (templateStack.length > 0 && depth === templateStack[templateStack.length - 1]) { templateStack.pop(); mode = "template"; continue; }
      if (depth === 0) return { end: i, sawInterpolation };
      continue;
    }
    i += 1;
  }
  return { end: -1, sawInterpolation };
}

/** A `/` after an operator or opener opens a regex; after a value it divides. */
function isRegexPosition(source: string, i: number): boolean {
  let j = i - 1;
  while (j >= 0 && /\s/.test(source[j]!)) j -= 1;
  return j < 0 || !/[\w$)\]]/.test(source[j]!);
}

const ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", "0": "\0" };
const WORDS = new Map<string, unknown>([["true", true], ["false", false], ["null", null], ["undefined", undefined], ["NaN", NaN], ["Infinity", Infinity]]);

/**
 * A JavaScript object literal made of literals only: objects (as Maps), arrays, strings, templates
 * without substitutions, numbers, true/false/null/undefined. Throws for anything else, never runs it.
 */
function pureLiteral(source: string): unknown {
  let i = 0;
  const fail = (): never => { throw new SyntaxError("not a pure literal"); };
  const match = (pattern: RegExp): string | null => {
    pattern.lastIndex = i;
    const found = pattern.exec(source);
    if (found === null) return null;
    i += found[0].length;
    return found[0];
  };
  const blank = (): void => {
    for (;;) {
      if (match(/\s+/y) !== null) continue;
      if (source.startsWith("//", i)) { const end = source.indexOf("\n", i); i = end === -1 ? source.length : end + 1; continue; }
      if (!source.startsWith("/*", i)) return;
      const end = source.indexOf("*/", i + 2);
      if (end === -1) fail();
      i = end + 2;
    }
  };
  const codePoint = (digits: string | null): string => {
    const point = digits === null ? NaN : parseInt(digits.replace(/[{}]/g, ""), 16);
    return Number.isFinite(point) && point <= 0x10ffff ? String.fromCodePoint(point) : fail();
  };
  const escape = (): string => {
    const c = source[i++] ?? fail();
    if (c === "\r") { if (source[i] === "\n") i += 1; return ""; }
    if (c === "\n" || c === "\u2028" || c === "\u2029") return "";
    // legacy octal is no literal in strict code
    if (/[1-9]/.test(c) || (c === "0" && /\d/.test(source[i] ?? ""))) fail();
    if (c === "x") return codePoint(match(/[\da-fA-F]{2}/y));
    if (c === "u") return codePoint(match(/\{[\da-fA-F]+\}|[\da-fA-F]{4}/y));
    return ESCAPES[c] ?? c;
  };
  const quoted = (): string => {
    const quote = source[i++];
    let out = "";
    for (;;) {
      const c = source[i++] ?? fail();
      if (c === quote) return out;
      if (c === "\\") out += escape();
      else if (quote !== "`" && (c === "\n" || c === "\r")) fail();
      else if (quote === "`" && c === "$" && source[i] === "{") fail();
      else if (quote === "`" && c === "\r") { if (source[i] === "\n") i += 1; out += "\n"; }
      else out += c;
    }
  };
  const NUMBER = /0[xX][\da-fA-F]+|0[oO][0-7]+|0[bB][01]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
  const WORD = /[A-Za-z_$][\w$]*/y;
  const key = (): string => {
    const c = source[i];
    if (c === "'" || c === '"') return quoted();
    const number = match(NUMBER);
    if (number !== null) return String(Number(number));
    return match(WORD) ?? fail();
  };
  const value = (): unknown => {
    blank();
    const c = source[i];
    if (c === "{" || c === "[") {
      i += 1;
      const close = c === "{" ? "}" : "]";
      const object = new Map<string, unknown>();
      const list: unknown[] = [];
      for (;;) {
        blank();
        if (source[i] === close) { i += 1; return c === "{" ? object : list; }
        if (c === "{") {
          const name = key();
          blank();
          if (source[i++] !== ":") fail();
          object.set(name, value());
        } else list.push(value());
        blank();
        if (source[i] === ",") i += 1;
        else if (source[i] !== close) fail();
      }
    }
    if (c === "'" || c === '"' || c === "`") return quoted();
    const sign = c === "-" ? -1 : 1;
    if (c === "-" || c === "+") i += 1;
    const number = match(NUMBER);
    if (number !== null) return sign * Number(number);
    if (c === "-" || c === "+") fail();
    const word = match(WORD);
    return word !== null && WORDS.has(word) ? WORDS.get(word) : fail();
  };
  const result = value();
  blank();
  return i === source.length ? result : fail();
}

interface Item<T, F> { value: T; facts: F; start: Start; endAt: number | null; running: boolean; lost: boolean }

/** running first (oldest first), then at most RECENT_LIMIT that ended within RECENT_MS, newest first */
function listed<T, F>(items: Item<T, F>[], now: number): Item<T, F>[] {
  const running = items.filter((item) => item.running).sort((a, b) => a.start.at - b.start.at || a.start.seq - b.start.seq);
  const ended = items.filter((item) => !item.running && now - (item.endAt ?? item.start.at) <= RECENT_MS)
    .sort((a, b) => (b.endAt ?? b.start.at) - (a.endAt ?? a.start.at));
  return [...running, ...ended.slice(0, RECENT_LIMIT)];
}

type TaskFacts = Omit<AgentFacts, "end" | "records">;

/** What the index says now, for this pane's pi process. */
function view(index: SessionIndex, session: PiSession): { tasks: Item<OmoTask, TaskFacts>[]; runs: Item<OmoRun, RunFacts>[] } {
  const task = (facts: TaskFacts, end: AgentFacts["end"]): Item<OmoTask, TaskFacts> => {
    const lost = end === null && isLost(facts.start.at, session);
    const endAt = end?.at ?? (lost ? facts.start.at : null);
    return {
      facts, start: facts.start, endAt, running: end === null && !lost, lost,
      value: {
        id: facts.id, title: facts.title ?? facts.type ?? facts.id, category: facts.type, model: facts.model,
        status: end?.status ?? (lost ? "lost" : "running"), started_at: iso(facts.start.at), ended_at: endAt === null ? null : iso(endAt),
        turns: end?.turns ?? null, tool_calls: end?.toolCalls ?? null, tokens: null,
      },
    };
  };
  const tasks = [...index.agents.values()].map((facts) => task(facts, facts.end));
  for (const call of index.last?.open ?? []) tasks.push(task(call, null));
  const runs = [...index.runs.values()].map((run): Item<OmoRun, RunFacts> => {
    const lost = run.end === null && isLost(run.start.at, session);
    const endAt = run.end?.at ?? (lost ? run.start.at : null);
    return {
      facts: run, start: run.start, endAt, running: run.end === null && !lost, lost,
      value: { id: run.id, name: runName(run, null), status: run.end?.status ?? (lost ? "lost" : "running"), started_at: iso(run.start.at), ended_at: endAt === null ? null : iso(endAt), waves: [] },
    };
  });
  return { tasks, runs };
}

/** The pane's count, for its `background_tasks` and its wait: what runs now, and how much of it the current turn started. */
export function piSubagentCounts(session: PiSession, budget = READ_BUDGET): PiSubagentCounts {
  const index = catchUp(session.path, budget, session.environ);
  if (index === null) return { running: 0, turnRunning: 0, promptAt: null, current: true };
  const { tasks, runs } = view(index, session);
  const running = [...tasks, ...runs].filter((item) => item.running);
  const { promptAt } = index;
  return { running: running.length, turnRunning: running.filter((item) => promptAt === null || item.start.at >= promptAt).length, promptAt, current: !index.behind };
}

/**
 * The pane's agents and workflows, per list: running items oldest first, then at most RECENT_LIMIT
 * that ended (or were lost) within RECENT_MS, newest first. Both lists are empty while the read is
 * behind (and without a session file): a list from part of the file could show as running what
 * already ended. The rows shown are enriched from the tasks dir within one `budget` of their own;
 * a file not read to its end yet adds nothing until it is.
 */
export function piSubagentActivity(session: PiSession, now = Date.now(), budget = READ_BUDGET): PiSubagentActivity {
  const index = catchUp(session.path, budget, session.environ);
  if (index === null || index.behind) return { tasks: [], runs: [] };
  const { tasks, runs } = view(index, session);
  // a lost item ended when its file last changed: known before the list is cut, from a stat alone
  const lostAt = (item: Item<OmoTask | OmoRun, unknown>, suffix: string): void => {
    const file = item.lost ? taskFile(index, item.value.id, suffix) : null;
    const mtime = file === null ? undefined : plain(file)?.mtimeMs;
    if (mtime === undefined) return;
    item.endAt = Math.max(item.start.at, mtime);
    item.value.ended_at = iso(item.endAt);
  };
  for (const item of tasks) lostAt(item, ".output");
  for (const item of runs) lostAt(item, ".workflow.jsonl");
  const shared = { left: budget };
  return {
    tasks: listed(tasks, now).map(({ value }): OmoTask => {
      const file = taskFile(index, value.id, ".output");
      const stats = file === null ? null : outputStats(file, shared);
      if (stats === null || stats.behind) return value;
      const { facts } = stats;
      // a foreground result's own numbers stand; tokens are counted only here (details.tokens is a formatted string)
      return { ...value, model: value.model ?? facts.model, turns: value.turns ?? facts.turns, tool_calls: value.tool_calls ?? facts.toolCalls, tokens: facts.tokens };
    }),
    runs: listed(runs, now).map(({ value, facts }): OmoRun => {
      const name = runName(facts, index, shared);
      const file = taskFile(index, value.id, ".workflow.jsonl");
      const journal = file === null ? null : journalCounts(file, shared);
      return journal === null || journal.behind ? { ...value, name } : { ...value, name, agents_done: journal.facts.done, agents_failed: journal.facts.failed };
    }),
  };
}

/**
 * The chat's result cards (one `task_result` part per notification, an entry per id) for a pi
 * page: undefined when the page holds no notification; otherwise the mapper over the session's
 * index, read to the file's end first, with no byte limit: a settled page's cards are kept, so
 * one drawn from a read still behind would keep the notification's preview. That unbounded read
 * happens once per session file (its index is kept, among the last MAX_SESSIONS, so later pages
 * read only what the file gained), and the tracker pays it anyway, a budget at a time.
 */
export function piSubagentCards(path: string, page: string): PiSubagentCards | undefined {
  if (!page.includes('"subagent-notification"')) return undefined;
  const index = catchUpToEnd(path);
  const budget = { left: READ_BUDGET };
  return (entry) => {
    const told = notification(entry);
    const at = stamp(row(entry)?.["timestamp"]);
    if (told === null || at === null) return null;
    const cards = [...told].flatMap(([id, { details, block }]) => cardOf(index, id, details, block, at, budget) ?? []);
    return cards.length > 0 ? cards : null;
  };
}

/** Forget every read kept between calls (tests compare against a cold read). */
export function forgetPiSubagents(): void {
  indexes.clear();
  outputs.clear();
  journals.clear();
  scripts.clear();
}
