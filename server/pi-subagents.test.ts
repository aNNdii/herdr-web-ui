import { afterEach, describe, expect, it } from "bun:test";
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { forgetPiSubagents, piSubagentActivity, piSubagentCards, piSubagentCounts, type PiSession } from "./pi-subagents.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  forgetPiSubagents();
});

const NOW = Date.parse("2026-10-18T12:00:00.000Z");
const at = (minutes: number): string => new Date(NOW - 60 * 60 * 1000 + minutes * 60 * 1000).toISOString();
const ms = (minutes: number): number => Date.parse(at(minutes));
const json = (value: unknown): string => `${JSON.stringify(value)}\n`;

interface Call { id: string; name: string; args?: Record<string, unknown> }

const SESSION_ID = "22222222-2222-4222-8222-222222222222";

/** A pi session file, written the way pi 1.3 and pi-subagents 0.22.0 write theirs. */
function piSession(cwd = "/work/app") {
  const root = mkdtempSync(join(tmpdir(), "herdr-pi-subagents-"));
  roots.push(root);
  const path = join(root, `2026-10-18T11-00-00-000Z_${SESSION_ID}.jsonl`);
  writeFileSync(path, json({ type: "session", version: 3, id: SESSION_ID, timestamp: at(0), cwd }));
  let n = 0;
  const entry = (minute: number, fields: Record<string, unknown>) => appendFileSync(path, json({ ...fields, id: `e${++n}`, parentId: n > 1 ? `e${n - 1}` : null, timestamp: at(minute) }));
  return {
    path,
    session: (options: Partial<PiSession> = {}): PiSession => ({ path, environ: null, live: true, startedAt: null, ...options }),
    raw: (text: string) => appendFileSync(path, text),
    prompt: (minute: number, text = "go") => entry(minute, { type: "message", message: { role: "user", content: [{ type: "text", text }], timestamp: ms(minute) } }),
    assistant: (minute: number, calls: Call[], stopReason = "toolUse") => entry(minute, {
      type: "message",
      message: { role: "assistant", content: calls.map((call) => ({ type: "toolCall", id: call.id, name: call.name, arguments: call.args ?? {} })), stopReason, timestamp: ms(minute) },
    }),
    result: (minute: number, call: string, toolName: string, details: unknown, text = "ok") => entry(minute, {
      type: "message",
      message: { role: "toolResult", toolCallId: call, toolName, content: [{ type: "text", text }], details, isError: false, timestamp: ms(minute) },
    }),
    record: (minute: number, data: Record<string, unknown>) => entry(minute, { type: "custom", customType: "subagents:record", data: { startedAt: ms(minute) - 60_000, completedAt: ms(minute), ...data } }),
    notify: (minute: number, details: Record<string, unknown>) => entry(minute, { type: "custom_message", customType: "subagent-notification", content: "<task-notification>…</task-notification>", display: true, details }),
    /** an Agent call sent to the background, answered at once with its agent id */
    background(minute: number, agentId: string, args: Record<string, unknown> = {}) {
      const call = `call_${agentId}_${minute}`;
      this.assistant(minute, [{ id: call, name: "Agent", args: { description: `task ${agentId}`, subagent_type: "Explore", prompt: "look", run_in_background: true, ...args } }]);
      this.result(minute, call, "Agent", { displayName: "Explore", description: `task ${agentId}`, subagentType: "Explore", modelName: "haiku 4.5", toolUses: 0, tokens: "", durationMs: 0, status: "background", agentId }, `Agent started in background.\nAgent ID: ${agentId}`);
    },
    workflow(minute: number, runId: string, args: Record<string, unknown> = { name: "review" }) {
      const call = `call_${runId}`;
      this.assistant(minute, [{ id: call, name: "SubagentWorkflow", args }]);
      this.result(minute, call, "SubagentWorkflow", { taskId: runId }, `Workflow started in the background.\nTask ID: ${runId}`);
    },
  };
}

describe("piSubagentActivity", () => {
  it("runs a background agent until its record, with its type, description and model", () => {
    const pi = piSession();
    pi.prompt(1);
    pi.background(2, "a1");
    const running = piSubagentActivity(pi.session(), NOW);
    expect(running.tasks).toEqual([{ id: "a1", title: "task a1", category: "Explore", model: "haiku 4.5", status: "running", started_at: at(2), ended_at: null, turns: null, tool_calls: null, tokens: null }]);
    expect(running.runs).toEqual([]);
    pi.record(5, { id: "a1", type: "Explore", description: "task a1", status: "completed", result: "done" });
    expect(piSubagentActivity(pi.session(), NOW).tasks).toEqual([{ id: "a1", title: "task a1", category: "Explore", model: "haiku 4.5", status: "completed", started_at: at(2), ended_at: at(5), turns: null, tool_calls: null, tokens: null }]);
  });

  it("runs a resumed agent again until its next record, as one row", () => {
    const pi = piSession();
    pi.background(2, "a1");
    pi.record(5, { id: "a1", status: "completed" });
    pi.background(10, "a1", { resume: "a1" });
    const resumed = piSubagentActivity(pi.session(), NOW).tasks;
    expect(resumed.map((task) => [task.id, task.status, task.started_at])).toEqual([["a1", "running", at(10)]]);
    pi.record(12, { id: "a1", status: "stopped" });
    expect(piSubagentActivity(pi.session(), NOW).tasks.map((task) => [task.id, task.status, task.ended_at])).toEqual([["a1", "cancelled", at(12)]]);
  });

  it("keeps a background agent ended whose record pi wrote before the result that started it (parallel tools)", () => {
    const pi = piSession();
    pi.prompt(1);
    pi.assistant(2, [
      { id: "call_bg", name: "Agent", args: { description: "quick", subagent_type: "Explore", run_in_background: true } },
      { id: "call_bash", name: "bash", args: { command: "sleep 60" } },
    ]);
    // the agent ends while bash still runs; the batch's results are written after both
    pi.record(3, { id: "a1", type: "Explore", description: "quick", status: "completed", result: "done" });
    pi.result(4, "call_bg", "Agent", { description: "quick", subagentType: "Explore", durationMs: 0, status: "background", agentId: "a1" });
    pi.result(4, "call_bash", "bash", undefined, "");
    expect(piSubagentActivity(pi.session(), NOW).tasks.map((task) => [task.id, task.status, task.started_at, task.ended_at])).toEqual([["a1", "completed", at(2), at(3)]]);
    expect(piSubagentCounts(pi.session())).toMatchObject({ running: 0, turnRunning: 0 });
    // a later resume still runs again
    pi.background(10, "a1", { resume: "a1" });
    expect(piSubagentActivity(pi.session(), NOW).tasks.map((task) => [task.id, task.status])).toEqual([["a1", "running"]]);
  });

  it("maps pi's statuses and lets the newest record win", () => {
    const pi = piSession();
    const statuses = { s1: "completed", s2: "steered", s3: "stopped", s4: "aborted", s5: "error" };
    for (const [index, id] of Object.keys(statuses).entries()) pi.background(index + 1, id);
    for (const [index, [id, status]] of Object.entries(statuses).entries()) pi.record(10 + index, { id, status });
    pi.record(20, { id: "s5", status: "completed" });
    const byId = new Map(piSubagentActivity(pi.session(), NOW).tasks.map((task) => [task.id, task.status]));
    expect(Object.fromEntries(byId)).toEqual({ s1: "completed", s2: "completed", s3: "cancelled", s4: "failed", s5: "completed" });
  });

  it("lists an agent known only from its record (an @mention or a scheduled one)", () => {
    const pi = piSession();
    pi.record(5, { id: "m1", type: "general-purpose", description: "from a mention", status: "error", startedAt: ms(3) });
    expect(piSubagentActivity(pi.session(), NOW).tasks).toEqual([{ id: "m1", title: "from a mention", category: "general-purpose", model: null, status: "failed", started_at: at(3), ended_at: at(5), turns: null, tool_calls: null, tokens: null }]);
  });

  it("runs a foreground Agent call while its message waits, then ends it with the result's numbers", () => {
    const pi = piSession();
    pi.prompt(1);
    pi.assistant(2, [{ id: "call_fg", name: "Agent", args: { description: "inline look", subagent_type: "Plan", model: "sonnet", prompt: "plan" } }]);
    expect(piSubagentActivity(pi.session(), NOW).tasks).toEqual([{ id: "call_fg", title: "inline look", category: "Plan", model: "sonnet", status: "running", started_at: at(2), ended_at: null, turns: null, tool_calls: null, tokens: null }]);
    expect(piSubagentCounts(pi.session())).toMatchObject({ running: 1, current: true });
    pi.result(6, "call_fg", "Agent", { displayName: "Plan", description: "inline look", subagentType: "Plan", modelName: "sonnet 4.5", toolUses: 5, tokens: "1.2k", durationMs: 240_000, status: "completed", turnCount: 3, agentId: "a-fg" }, "the plan");
    expect(piSubagentActivity(pi.session(), NOW).tasks).toEqual([{ id: "a-fg", title: "inline look", category: "Plan", model: "sonnet 4.5", status: "completed", started_at: at(2), ended_at: at(6), turns: 3, tool_calls: 5, tokens: null }]);
    expect(piSubagentCounts(pi.session()).running).toBe(0);
  });

  it("keeps a foreground result's numbers when its own record comes after it", () => {
    const pi = piSession();
    pi.assistant(2, [{ id: "call_fg", name: "Agent", args: { description: "inline", subagent_type: "Plan" } }]);
    pi.result(6, "call_fg", "Agent", { description: "inline", subagentType: "Plan", toolUses: 4, durationMs: 1000, status: "aborted", turnCount: 9, agentId: "a-fg" });
    pi.record(6, { id: "a-fg", type: "Plan", description: "inline", status: "aborted" });
    const tasks = piSubagentActivity(pi.session(), NOW).tasks;
    expect(tasks.map((task) => [task.id, task.status, task.turns, task.tool_calls, task.started_at])).toEqual([["a-fg", "failed", 9, 4, at(2)]]);
  });

  it("shows a foreground agent once when pi writes its record before its result, as it does", () => {
    const pi = piSession();
    pi.prompt(1);
    pi.assistant(2, [
      { id: "call_fg", name: "Agent", args: { description: "inline", subagent_type: "Plan", model: "sonnet" } },
      { id: "call_bash", name: "bash", args: { command: "sleep 60" } },
    ]);
    pi.record(5, { id: "a-fg", type: "Plan", description: "inline", status: "completed", result: "the plan" });
    // between the record and the result (in parallel mode until the whole batch is done)
    expect(piSubagentActivity(pi.session(), NOW).tasks.map((task) => [task.id, task.status, task.started_at, task.model])).toEqual([["a-fg", "completed", at(2), "sonnet"]]);
    expect(piSubagentCounts(pi.session()).running).toBe(0);
    pi.result(6, "call_fg", "Agent", { description: "inline", subagentType: "Plan", modelName: "sonnet 4.5", toolUses: 2, durationMs: 1000, status: "completed", turnCount: 3, agentId: "a-fg" });
    pi.result(6, "call_bash", "bash", undefined, "");
    expect(piSubagentActivity(pi.session(), NOW).tasks.map((task) => [task.id, task.status, task.started_at, task.turns, task.tool_calls])).toEqual([["a-fg", "completed", at(2), 3, 2]]);
  });

  it("keeps a foreground call running when a background agent of the same description ends meanwhile", () => {
    const pi = piSession();
    pi.background(1, "bg", { description: "same", subagent_type: "Plan" });
    pi.assistant(2, [{ id: "call_fg", name: "Agent", args: { description: "same", subagent_type: "Plan" } }]);
    pi.record(3, { id: "bg", type: "Plan", description: "same", status: "completed" });
    expect(piSubagentActivity(pi.session(), NOW).tasks.map((task) => [task.id, task.status])).toEqual([["call_fg", "running"], ["bg", "completed"]]);
  });

  it("keeps a foreground agent running behind its siblings' results in sequential mode, not behind another message", () => {
    const pi = piSession();
    pi.assistant(2, [{ id: "call_fg", name: "Agent", args: { description: "slow" } }, { id: "call_read", name: "read", args: { path: "a" } }]);
    pi.result(3, "call_read", "read", undefined, "file");
    // a custom message is no `message` entry
    pi.notify(4, { id: "elsewhere", description: "x", status: "completed" });
    expect(piSubagentActivity(pi.session(), NOW).tasks.map((task) => [task.id, task.status])).toEqual([["call_fg", "running"]]);
    pi.prompt(5, "steer");
    expect(piSubagentActivity(pi.session(), NOW).tasks).toEqual([]);
  });

  it("does not run an Agent call of an aborted or finished message", () => {
    const pi = piSession();
    pi.assistant(2, [{ id: "call_a", name: "Agent", args: { description: "never ran" } }], "aborted");
    expect(piSubagentActivity(pi.session(), NOW).tasks).toEqual([]);
    pi.assistant(3, [{ id: "call_b", name: "Agent", args: { description: "said only" } }], "stop");
    expect(piSubagentCounts(pi.session()).running).toBe(0);
  });

  it("runs a workflow until its notification and names it by its meta.name, its notification, its call's name, its script, else workflow", () => {
    const pi = piSession();
    pi.workflow(2, "wf_1", { name: "review", scriptPath: "/work/app/audit.js" });
    pi.workflow(3, "wf_2", { scriptPath: "/work/app/audit.js" });
    pi.workflow(4, "wf_3", { script: "export default async () => {}" });
    const running = piSubagentActivity(pi.session(), NOW).runs;
    expect(running).toEqual([
      { id: "wf_1", name: "review", status: "running", started_at: at(2), ended_at: null, waves: [] },
      { id: "wf_2", name: "audit", status: "running", started_at: at(3), ended_at: null, waves: [] },
      { id: "wf_3", name: "workflow", status: "running", started_at: at(4), ended_at: null, waves: [] },
    ]);
    expect(piSubagentCounts(pi.session()).running).toBe(3);
    pi.notify(8, { id: "wf_1", description: "Workflow Audit pass", status: "completed", toolUses: 3, turnCount: 0, totalTokens: 900, durationMs: 1, resultPreview: "r" });
    pi.notify(9, { id: "wf_2", description: "Workflow wf_2", status: "stopped", toolUses: 0, turnCount: 0, totalTokens: 0, durationMs: 1, resultPreview: "r" });
    pi.notify(10, { id: "wf_3", description: "Workflow wf_3", status: "error", toolUses: 0, turnCount: 0, totalTokens: 0, durationMs: 1, resultPreview: "r" });
    expect(piSubagentActivity(pi.session(), NOW).runs.map((run) => [run.id, run.name, run.status, run.ended_at])).toEqual([
      ["wf_3", "wf_3", "failed", at(10)],
      ["wf_2", "wf_2", "cancelled", at(9)],
      ["wf_1", "Audit pass", "completed", at(8)],
    ]);
  });

  it("ends every id of a combined notification, its `others` too", () => {
    const pi = piSession();
    pi.workflow(2, "wf_1");
    pi.workflow(3, "wf_2");
    pi.background(4, "a1");
    pi.record(6, { id: "a1", status: "completed" });
    pi.notify(7, {
      id: "a1", description: "task a1", status: "completed", toolUses: 1, turnCount: 1, totalTokens: 10, durationMs: 1, resultPreview: "a",
      others: [
        { id: "wf_1", description: "Workflow one", status: "completed", toolUses: 1, turnCount: 0, totalTokens: 10, durationMs: 1, resultPreview: "b" },
        { id: "wf_2", description: "Workflow two", status: "error", toolUses: 1, turnCount: 0, totalTokens: 10, durationMs: 1, resultPreview: "c" },
      ],
    });
    const activity = piSubagentActivity(pi.session(), NOW);
    expect(activity.runs.map((run) => [run.id, run.status]).sort()).toEqual([["wf_1", "completed"], ["wf_2", "failed"]]);
    expect(activity.tasks.map((task) => [task.id, task.status])).toEqual([["a1", "completed"]]);
    expect(piSubagentCounts(pi.session()).running).toBe(0);
  });

  it("calls what was running lost when the pane left pi, ended at its start", () => {
    const pi = piSession();
    pi.background(2, "a1");
    pi.workflow(3, "wf_1");
    pi.assistant(4, [{ id: "call_fg", name: "Agent", args: { description: "inline" } }]);
    const gone = piSubagentActivity(pi.session({ live: false }), NOW);
    expect(gone.tasks.map((task) => [task.id, task.status, task.ended_at])).toEqual([["call_fg", "lost", at(4)], ["a1", "lost", at(2)]]);
    expect(gone.runs.map((run) => [run.id, run.status, run.ended_at])).toEqual([["wf_1", "lost", at(3)]]);
    expect(piSubagentCounts(pi.session({ live: false }))).toMatchObject({ running: 0, turnRunning: 0 });
  });

  it("calls a start older than the pi process (less 60 s) lost, and one within the slack running", () => {
    const pi = piSession();
    pi.background(2, "old");
    pi.background(9.5, "near");
    pi.background(12, "new");
    const session = pi.session({ startedAt: ms(10) });
    const tasks = piSubagentActivity(session, NOW).tasks;
    expect(tasks.map((task) => [task.id, task.status])).toEqual([["near", "running"], ["new", "running"], ["old", "lost"]]);
    expect(piSubagentCounts(session).running).toBe(2);
  });

  it("lists running items oldest first, then at most RECENT_LIMIT that ended within RECENT_MS, newest first, per list", () => {
    const pi = piSession();
    pi.background(5, "r2");
    pi.background(3, "r1");
    for (let index = 0; index < 12; index += 1) {
      pi.background(10 + index, `e${index}`);
      pi.record(30 + index, { id: `e${index}`, status: "completed" });
    }
    for (let index = 0; index < 11; index += 1) {
      pi.workflow(10 + index, `wf_${index}`);
      pi.notify(30 + index, { id: `wf_${index}`, description: `Workflow w${index}`, status: "completed" });
    }
    const activity = piSubagentActivity(pi.session(), NOW + 24 * 60 * 60 * 1000 - 29.5 * 60 * 1000);
    // e0 (ended 30 min in) is past the day; r1 started at minute 3 but was written after r2
    expect(activity.tasks.map((task) => task.id)).toEqual(["r1", "r2", "e11", "e10", "e9", "e8", "e7", "e6", "e5", "e4", "e3", "e2"]);
    expect(activity.runs.map((run) => run.id)).toEqual(["wf_10", "wf_9", "wf_8", "wf_7", "wf_6", "wf_5", "wf_4", "wf_3", "wf_2", "wf_1"]);
  });
});

/** A tmp root holding a session's pi-subagents tasks dir, as output-file.ts lays it out. */
function tasks(encodedCwd = "work-app") {
  const root = mkdtempSync(join(tmpdir(), "herdr-pi-tmp-"));
  roots.push(root);
  const dir = join(root, `pi-subagents-${process.getuid?.() ?? 0}`, encodedCwd, SESSION_ID, "tasks");
  mkdirSync(dir, { recursive: true });
  // as pi-subagents leaves its root
  chmodSync(join(root, `pi-subagents-${process.getuid?.() ?? 0}`), 0o700);
  return {
    root,
    dir,
    environ: ["HOME=/home/dev", `TMPDIR=${root}`],
    /** one `.output` turn: an assistant message with its usage and tool calls, then their results */
    turn(agentId: string, usage: { input: number; output: number; cacheRead: number; cacheWrite: number }, toolCalls = 0, model = "claude-haiku-4-5") {
      const calls = Array.from({ length: toolCalls }, (_, index) => ({ type: "toolCall", id: `t${index}`, name: "read", arguments: {} }));
      appendFileSync(join(dir, `${agentId}.output`), json({ isSidechain: true, agentId, type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "working" }, ...calls], model, usage: { ...usage, totalTokens: 1, cost: { total: 0.1 } }, stopReason: toolCalls > 0 ? "toolUse" : "stop" }, timestamp: at(3), cwd: "/work/app" }));
      for (const call of calls) appendFileSync(join(dir, `${agentId}.output`), json({ isSidechain: true, agentId, type: "toolResult", message: { role: "toolResult", toolCallId: call.id, toolName: "read", content: [{ type: "text", text: "\"type\":\"assistant\"" }] }, timestamp: at(3), cwd: "/work/app" }));
    },
    prompt(agentId: string) {
      appendFileSync(join(dir, `${agentId}.output`), json({ isSidechain: true, agentId, type: "user", message: { role: "user", content: "look" }, timestamp: at(2), cwd: "/work/app" }));
    },
    journal(runId: string, lines: string) { appendFileSync(join(dir, `${runId}.workflow.jsonl`), lines); },
    script(runId: string, source: string) { writeFileSync(join(dir, `${runId}.workflow.js`), source); },
  };
}

const usage = (input: number, output: number, cacheRead: number, cacheWrite: number) => ({ input, output, cacheRead, cacheWrite });
const settled = (index: number, ok: boolean) => json({ index, key: `k${index}`, ok, text: ok ? `answer ${index}` : undefined });

describe("piSubagentActivity enrichment from the tasks dir", () => {
  it("sums an agent's .output: turns, tool calls and tokens without cacheRead, read as it grows", () => {
    const pi = piSession();
    const dir = tasks();
    pi.background(2, "a1");
    dir.prompt("a1");
    dir.turn("a1", usage(100, 20, 5000, 30), 2);
    const session = pi.session({ environ: dir.environ });
    expect(piSubagentActivity(session, NOW).tasks).toEqual([{ id: "a1", title: "task a1", category: "Explore", model: "haiku 4.5", status: "running", started_at: at(2), ended_at: null, turns: 1, tool_calls: 2, tokens: 150 }]);
    dir.turn("a1", usage(200, 10, 9000, 0));
    pi.record(6, { id: "a1", status: "completed" });
    expect(piSubagentActivity(session, NOW).tasks.map((task) => [task.status, task.turns, task.tool_calls, task.tokens])).toEqual([["completed", 2, 2, 360]]);
  });

  it("keeps a foreground result's numbers, takes tokens from .output and never parses details.tokens", () => {
    const pi = piSession();
    const dir = tasks();
    pi.assistant(2, [{ id: "call_fg", name: "Agent", args: { description: "inline" } }]);
    pi.result(6, "call_fg", "Agent", { description: "inline", toolUses: 7, tokens: "1.2k", durationMs: 1000, status: "completed", turnCount: 4, agentId: "a-fg" });
    dir.turn("a-fg", usage(10, 5, 0, 1), 1);
    const [task] = piSubagentActivity(pi.session({ environ: dir.environ }), NOW).tasks;
    expect([task!.turns, task!.tool_calls, task!.tokens]).toEqual([4, 7, 16]);
    // without the file: no tokens at all, never 1200
    rmSync(join(dir.dir, "a-fg.output"));
    expect(piSubagentActivity(pi.session({ environ: dir.environ }), NOW).tasks[0]!.tokens).toBeNull();
  });

  it("takes the model from .output for an agent known only from its record", () => {
    const pi = piSession();
    const dir = tasks();
    pi.record(5, { id: "m1", type: "Explore", description: "mentioned", status: "completed" });
    dir.turn("m1", usage(1, 1, 0, 0), 0, "claude-sonnet-4-5");
    expect(piSubagentActivity(pi.session({ environ: dir.environ }), NOW).tasks.map((task) => [task.model, task.turns, task.tokens])).toEqual([["claude-sonnet-4-5", 1, 2]]);
  });

  it("finds the tasks dir under TMPDIR, then TMP, then TEMP, named as encodeCwd names it", () => {
    const cases: [string, string][] = [
      ["/home/dev/.herdr/worktrees/app", "home-dev-.herdr-worktrees-app"],
      ["C:\\Users\\foo\\project", "Users-foo-project"],
      ["\\\\server\\share\\project", "server-share-project"],
    ];
    for (const [cwd, encoded] of cases) {
      const pi = piSession(cwd);
      const dir = tasks(encoded);
      pi.background(2, "a1");
      dir.turn("a1", usage(1, 2, 0, 0));
      expect(piSubagentActivity(pi.session({ environ: dir.environ }), NOW).tasks[0]!.tokens).toBe(3);
      forgetPiSubagents();
    }
    const pi = piSession();
    const dir = tasks();
    pi.background(2, "a1");
    dir.turn("a1", usage(1, 2, 0, 0));
    const missing = join(dir.root, "nowhere");
    const tokens = (environ: string[]) => { forgetPiSubagents(); return piSubagentActivity(pi.session({ environ }), NOW).tasks[0]!.tokens; };
    expect(tokens([`TMP=${dir.root}/`])).toBe(3);
    expect(tokens([`TEMP=${dir.root}`])).toBe(3);
    expect(tokens([`TEMP=${missing}`, `TMP=${dir.root}`])).toBe(3);
    expect(tokens([`TMP=${dir.root}`, `TMPDIR=${missing}`])).toBeNull();
    expect(tokens(["TMPDIR=", `TMP=${dir.root}`])).toBe(3);
  });

  it("counts a workflow's settled agents from its journal and names it by meta.name", () => {
    const pi = piSession();
    const dir = tasks();
    pi.workflow(2, "wf_1", { name: "saved", scriptPath: "/work/app/audit.js" });
    dir.script("wf_1", [
      "/**",
      " * export const meta = { name: 'in a comment' }",
      " */",
      "export const meta = {",
      "  // a } in a comment",
      "  /* and { here */",
      "  'name': \"Audit {all} \\\"the\\\" files\",",
      "  description: `a template, no substitution: }`,",
      "  whenToUse: 'when \\'}\\' matters',",
      "  phases: [{ title: 'Read' }, { title: \"Judge\", detail: 'x}y', model: 'haiku', }],",
      "  count: -1.5e2, ok: true, none: null,",
      "}",
      "",
      "const result = await agent({ prompt: `look at ${args.path}` })",
    ].join("\n"));
    dir.journal("wf_1", settled(0, true) + settled(1, false) + "not json\n" + settled(2, true) + settled(3, true).slice(0, 20));
    const session = pi.session({ environ: dir.environ });
    expect(piSubagentActivity(session, NOW).runs).toEqual([
      { id: "wf_1", name: 'Audit {all} "the" files', status: "running", started_at: at(2), ended_at: null, waves: [], agents_done: 2, agents_failed: 1 },
    ]);
    dir.journal("wf_1", settled(3, true).slice(20));
    pi.notify(8, { id: "wf_1", description: "Workflow told", status: "completed" });
    expect(piSubagentActivity(session, NOW).runs.map((run) => [run.name, run.status, run.agents_done, run.agents_failed])).toEqual([["Audit {all} \"the\" files", "completed", 3, 1]]);
  });

  it("passes over a meta that is no pure literal, then names the run by what comes after meta.name", () => {
    const pi = piSession();
    const dir = tasks();
    const scripts: [string, Record<string, unknown>, string][] = [
      ["export const meta = { name: helper(), description: 'd' }", { name: "called" }, "called"],
      ["export const meta = { name: `run ${1 + 1}`, description: 'd' }", { scriptPath: "/work/app/subst.js" }, "subst"],
      ["export const meta = { ...base, name: 'spread' }", {}, "workflow"],
      ["export const meta = { name: 'never closed'", { name: "unclosed" }, "unclosed"],
      ["const meta = { name: 'not exported', description: 'd' }", { name: "plain" }, "plain"],
      ["export const meta = { name: '  ', description: 'd' }", { name: "blank" }, "blank"],
      ["export const meta =\n  { name: 'Spaced \\u0041\\x42', description: 'd' }", { name: "call" }, "Spaced AB"],
    ];
    for (const [index, [source, args]] of scripts.entries()) {
      pi.workflow(2 + index, `wf_${index}`, args);
      dir.script(`wf_${index}`, source);
    }
    // no script at all: the notification's description comes first
    pi.workflow(20, "wf_told", { name: "called" });
    pi.notify(21, { id: "wf_told", description: "Workflow Told name", status: "completed" });
    const names = piSubagentActivity(pi.session({ environ: dir.environ }), NOW).runs.map((run) => [run.id, run.name]);
    expect(names).toEqual([...scripts.map(([, , name], index) => [`wf_${index}`, name]), ["wf_told", "Told name"]]);
  });

  it("ends a lost agent and workflow at their files' mtimes, else at their start", () => {
    const pi = piSession();
    const dir = tasks();
    pi.background(2, "a1");
    pi.background(3, "a2");
    pi.workflow(4, "wf_1");
    pi.workflow(5, "wf_2");
    dir.turn("a1", usage(1, 1, 0, 0));
    dir.journal("wf_1", settled(0, true));
    utimesSync(join(dir.dir, "a1.output"), new Date(ms(30)), new Date(ms(30)));
    utimesSync(join(dir.dir, "wf_1.workflow.jsonl"), new Date(ms(40)), new Date(ms(40)));
    const gone = piSubagentActivity(pi.session({ environ: dir.environ, live: false }), NOW);
    expect(gone.tasks.map((task) => [task.id, task.status, task.ended_at])).toEqual([["a1", "lost", at(30)], ["a2", "lost", at(3)]]);
    expect(gone.runs.map((run) => [run.id, run.status, run.ended_at])).toEqual([["wf_1", "lost", at(40)], ["wf_2", "lost", at(5)]]);
  });

  it("reads only plain files", () => {
    const pi = piSession();
    const dir = tasks();
    pi.background(2, "a1");
    pi.background(3, "a2");
    pi.workflow(4, "wf_1", { name: "called" });
    const elsewhere = mkdtempSync(join(tmpdir(), "herdr-pi-elsewhere-"));
    roots.push(elsewhere);
    writeFileSync(join(elsewhere, "real.output"), json({ type: "assistant", message: { role: "assistant", content: [], usage: usage(5, 5, 0, 0) } }));
    writeFileSync(join(elsewhere, "real.js"), "export const meta = { name: 'linked', description: 'd' }");
    writeFileSync(join(elsewhere, "real.jsonl"), settled(0, true));
    symlinkSync(join(elsewhere, "real.output"), join(dir.dir, "a1.output"));
    symlinkSync(join(elsewhere, "real.js"), join(dir.dir, "wf_1.workflow.js"));
    symlinkSync(join(elsewhere, "real.jsonl"), join(dir.dir, "wf_1.workflow.jsonl"));
    mkdirSync(join(dir.dir, "a2.output"));
    const activity = piSubagentActivity(pi.session({ environ: dir.environ }), NOW);
    expect(activity.tasks.map((task) => [task.id, task.turns, task.tokens])).toEqual([["a1", null, null], ["a2", null, null]]);
    expect(activity.runs).toEqual([{ id: "wf_1", name: "called", status: "running", started_at: at(4), ended_at: null, waves: [] }]);
  });

  it("loses only the enrichment when the tasks dir is missing", () => {
    const pi = piSession();
    pi.background(2, "a1");
    pi.workflow(3, "wf_1", { name: "called" });
    const activity = piSubagentActivity(pi.session({ environ: [`TMPDIR=${join(tmpdir(), "herdr-pi-no-such-tmp")}`] }), NOW);
    expect(activity.tasks).toEqual([{ id: "a1", title: "task a1", category: "Explore", model: "haiku 4.5", status: "running", started_at: at(2), ended_at: null, turns: null, tool_calls: null, tokens: null }]);
    expect(activity.runs).toEqual([{ id: "wf_1", name: "called", status: "running", started_at: at(3), ended_at: null, waves: [] }]);
  });

  it.skipIf(process.platform === "win32")("reads no tasks dir under a root another user could write to", () => {
    const pi = piSession();
    const dir = tasks();
    pi.background(2, "a1");
    dir.turn("a1", usage(5, 5, 0, 0));
    const root = join(dir.root, `pi-subagents-${process.getuid?.() ?? 0}`);
    chmodSync(root, 0o777);
    expect(piSubagentActivity(pi.session({ environ: dir.environ }), NOW).tasks.map((task) => task.tokens)).toEqual([null]);
    chmodSync(root, 0o700);
    expect(piSubagentActivity(pi.session({ environ: dir.environ }), NOW).tasks.map((task) => task.tokens)).toEqual([10]);
  });

  it("reads the files of the rows shown only, within one budget shared by them, the rest on later calls", () => {
    const pi = piSession();
    const dir = tasks();
    for (let index = 0; index < 12; index += 1) {
      pi.background(10 + index, `e${index}`);
      pi.record(30 + index, { id: `e${index}`, status: "completed" });
      dir.turn(`e${index}`, usage(index, 0, 0, 0));
    }
    const session = pi.session({ environ: dir.environ });
    // the session file is read in full first; what follows is the enrichment's own budget
    expect(piSubagentCounts(session).current).toBe(true);
    const { size } = statSync(join(dir.dir, "e0.output"));
    // e0 and e1 are not shown: were they read first, e3 and e2 would not fit
    const first = piSubagentActivity(session, NOW, size * 10 + size / 2).tasks;
    expect(first.map((task) => [task.id, task.tokens])).toEqual([11, 10, 9, 8, 7, 6, 5, 4, 3, 2].map((index) => [`e${index}`, index]));
    forgetPiSubagents();
    expect(piSubagentCounts(session).current).toBe(true);
    const partial = piSubagentActivity(session, NOW, size * 4 + size / 2).tasks;
    expect(partial.map((task) => task.tokens)).toEqual([11, 10, 9, 8, null, null, null, null, null, null]);
    const next = piSubagentActivity(session, NOW, size * 4 + size / 2).tasks;
    expect(next.map((task) => task.tokens)).toEqual([11, 10, 9, 8, 7, 6, 5, 4, null, null]);
  });
});

describe("piSubagentCounts", () => {
  it("counts running agents and workflows, and those started since the newest user message", () => {
    const pi = piSession();
    expect(piSubagentCounts(pi.session())).toEqual({ running: 0, turnRunning: 0, promptAt: null, current: true });
    pi.background(2, "a1");
    expect(piSubagentCounts(pi.session())).toEqual({ running: 1, turnRunning: 1, promptAt: null, current: true });
    pi.prompt(5);
    pi.background(6, "a2");
    pi.workflow(7, "wf_1");
    // a notification is a custom message: it starts no turn
    pi.notify(8, { id: "nobody", description: "x", status: "completed" });
    expect(piSubagentCounts(pi.session())).toEqual({ running: 3, turnRunning: 2, promptAt: ms(5), current: true });
  });

  it("answers no session file with nothing", () => {
    const missing: PiSession = { path: join(tmpdir(), "herdr-pi-subagents-missing", "none.jsonl"), environ: null, live: true, startedAt: null };
    expect(piSubagentCounts(missing)).toEqual({ running: 0, turnRunning: 0, promptAt: null, current: true });
    expect(piSubagentActivity(missing, NOW)).toEqual({ tasks: [], runs: [] });
  });

  it("skips malformed lines and waits for a torn one to be finished", () => {
    const pi = piSession();
    pi.raw("not json\n{\"type\":\"message\"\n[1,2]\n");
    pi.background(2, "a1");
    const record = json({ type: "custom", customType: "subagents:record", id: "r", parentId: null, timestamp: at(5), data: { id: "a1", status: "completed" } });
    pi.raw(record.slice(0, 40));
    expect(piSubagentCounts(pi.session())).toMatchObject({ running: 1, current: true });
    pi.raw(record.slice(40));
    expect(piSubagentCounts(pi.session())).toMatchObject({ running: 0, current: true });
  });

  it("reads a large session within its budget, behind until it has read it all, its lists empty meanwhile", () => {
    const pi = piSession();
    pi.background(2, "a1");
    for (let index = 0; index < 40; index += 1) pi.prompt(3, "x".repeat(400));
    pi.record(5, { id: "a1", status: "completed" });
    const session = pi.session();
    const first = piSubagentCounts(session, 4096);
    expect(first.current).toBe(false);
    // a1 was read as running, but its record is not read yet: the list says nothing while behind
    expect(piSubagentActivity(session, NOW, 4096)).toEqual({ tasks: [], runs: [] });
    let counts = first;
    for (let calls = 0; !counts.current && calls < 20; calls += 1) counts = piSubagentCounts(session, 4096);
    expect(counts).toEqual({ running: 0, turnRunning: 0, promptAt: ms(3), current: true });
    expect(piSubagentActivity(session, NOW, 4096).tasks.map((task) => [task.id, task.status])).toEqual([["a1", "completed"]]);
  });

  it("reads a session past one budget before drawing a card, so a settled page keeps the record's result", () => {
    const pi = piSession();
    // more than one READ_BUDGET (8 MiB) of prompts before the agent, as a session with images has
    for (let index = 0; index < 9; index += 1) pi.prompt(1, "x".repeat(1024 * 1024));
    pi.background(2, "a1");
    pi.record(5, { id: "a1", status: "completed", result: "the whole answer" });
    pi.notify(6, { id: "a1", description: "task a1", status: "completed", resultPreview: "the wh…" });
    const lines = readFileSync(pi.path, "utf8").trimEnd().split("\n");
    const cards = piSubagentCards(pi.path, lines.at(-1)!)!;
    expect(cards(JSON.parse(lines.at(-1)!))?.map((card) => card.result)).toEqual(["the whole answer"]);
  });

  it("starts over when the session file is replaced", () => {
    const pi = piSession();
    pi.background(2, "a1");
    expect(piSubagentCounts(pi.session()).running).toBe(1);
    writeFileSync(pi.path, json({ type: "session", version: 3, id: "x", timestamp: at(0), cwd: "/work/app" }));
    expect(piSubagentCounts(pi.session()).running).toBe(0);
  });
});
