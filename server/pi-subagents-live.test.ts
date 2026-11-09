import { afterEach, describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import { appendFileSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PI_ASK_BRIDGE_DIRECTORY } from "../shared/pi-ask-bridge.ts";
import { PI_SUBAGENTS_EVENTS, type PiSubagentsLive, type PiSubagentsLiveAgent } from "../shared/pi-subagents-bridge.ts";
import { createPiAskBridge, type PiAskBridge, type PiEventBus } from "../integrations/pi-ask.ts";
import { createPiSubagentsRoster } from "../integrations/pi-subagents-roster.ts";
import type { HerdrPane } from "../shared/protocol.ts";
import { PiSubagentStatus } from "./pi-subagent-status.ts";
import { forgetPiSubagents, piSubagentActivity, piSubagentCounts, piSubagentsMark, type PiLiveView, type PiSession } from "./pi-subagents.ts";
import { askPiSubagentsLive, IDLE_CONFIRM_MS, nextPiLiveState, parsePiSubagentsLive, piLiveView, type PiLiveState } from "./pi-subagents-live.ts";

const posix = process.platform !== "win32";
const roots: string[] = [];
const bridges: PiAskBridge[] = [];
const trackers: PiSubagentStatus[] = [];
afterEach(async () => {
  for (const tracker of trackers.splice(0)) tracker.stop();
  for (const bridge of bridges.splice(0)) await bridge.stop();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  forgetPiSubagents();
});

const NOW = Date.parse("2026-10-18T12:00:00.000Z");
const at = (minutes: number): string => new Date(NOW - 60 * 60 * 1000 + minutes * 60 * 1000).toISOString();
const ms = (minutes: number): number => Date.parse(at(minutes));
const json = (value: unknown): string => `${JSON.stringify(value)}\n`;

function temp(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

/** A pi session file as pi 1.3 and pi-subagents write it: prompts, Agent and SubagentWorkflow calls and their results. */
function piSession() {
  const path = join(temp("herdr-pi-live-"), "2026-10-18T11-00-00-000Z_s1.jsonl");
  writeFileSync(path, json({ type: "session", version: 3, id: "s1", timestamp: at(0), cwd: "/work/app" }));
  const entry = (minute: number, fields: Record<string, unknown>) => appendFileSync(path, json({ ...fields, timestamp: at(minute) }));
  const assistant = (minute: number, calls: { id: string; name: string; args: Record<string, unknown> }[]) => entry(minute, {
    type: "message", message: { role: "assistant", content: calls.map((call) => ({ type: "toolCall", id: call.id, name: call.name, arguments: call.args })), stopReason: "toolUse", timestamp: ms(minute) },
  });
  const result = (minute: number, call: string, toolName: string, details: unknown) => entry(minute, {
    type: "message", message: { role: "toolResult", toolCallId: call, toolName, content: [{ type: "text", text: "ok" }], details, isError: false, timestamp: ms(minute) },
  });
  return {
    path,
    session: (liveView: PiLiveView | null = null): PiSession => ({ path, environ: null, live: true, startedAt: null, liveView }),
    prompt: (minute: number) => entry(minute, { type: "message", message: { role: "user", content: [{ type: "text", text: "go" }], timestamp: ms(minute) } }),
    background(minute: number, agentId: string) {
      assistant(minute, [{ id: `call_${agentId}`, name: "Agent", args: { description: `task ${agentId}`, subagent_type: "Explore", prompt: "look", run_in_background: true } }]);
      result(minute, `call_${agentId}`, "Agent", { description: `task ${agentId}`, subagentType: "Explore", status: "background", agentId });
    },
    /** a foreground Agent call still waiting for its result */
    foreground: (minute: number, call: string, description: string) => assistant(minute, [{ id: call, name: "Agent", args: { description, subagent_type: "Explore", prompt: "look" } }]),
    record: (minute: number, id: string, status: string) => entry(minute, { type: "custom", customType: "subagents:record", data: { id, type: "Explore", description: `task ${id}`, status, result: "done", startedAt: ms(minute) - 60_000, completedAt: ms(minute) } }),
    workflow(minute: number, runId: string) {
      assistant(minute, [{ id: `call_${runId}`, name: "SubagentWorkflow", args: { name: "review" } }]);
      result(minute, `call_${runId}`, "SubagentWorkflow", { taskId: runId });
    },
  };
}

const agent = (id: string, status: PiSubagentsLiveAgent["status"], minute: number, extra: Partial<PiSubagentsLiveAgent> = {}): PiSubagentsLiveAgent =>
  ({ id, type: "Explore", description: `task ${id}`, status, startedAt: ms(minute), ...extra });

const answer = (fields: Partial<PiSubagentsLive> = {}): PiSubagentsLive =>
  ({ version: 1, pid: 10, sessionFile: "/s.jsonl", loaded: true, running: true, agents: [], workflows: [], ...fields });

/** The view of an answer asked for now: what the file was read for so far is judged by it. */
const view = (agents: PiSubagentsLiveAgent[], idle: PiLiveView["idle"] = null): PiLiveView =>
  ({ mark: piSubagentsMark(), agents: new Map(agents.map((one) => [one.id, one])), idle });

const statuses = (session: PiSession) => {
  const { tasks, runs } = piSubagentActivity(session, NOW);
  return { tasks: tasks.map((task) => [task.id, task.status]), runs: runs.map((run) => [run.id, run.status]) };
};

describe("parsePiSubagentsLive", () => {
  it("takes only the answer's shape, and drops agents and workflows it cannot read", () => {
    expect(parsePiSubagentsLive(null)).toBeNull();
    expect(parsePiSubagentsLive({ ...answer(), version: 2 })).toBeNull();
    expect(parsePiSubagentsLive({ ...answer(), running: "yes" })).toBeNull();
    expect(parsePiSubagentsLive({ ...answer(), agents: null })).toBeNull();
    const parsed = parsePiSubagentsLive(answer({
      agents: [agent("a1", "running", 1, { description: "  look  ", tokens: 5 }), { id: "x", status: "queued", startedAt: 1 } as never, { id: "y", status: "running" } as never],
      workflows: [{ id: "wf_1", lastUsageAt: 3, agents: 2 }, { id: "", lastUsageAt: 1, agents: 1 }],
    }));
    expect(parsed?.agents).toEqual([{ id: "a1", type: "Explore", description: "look", status: "running", startedAt: ms(1), tokens: 5 }]);
    expect(parsed?.workflows).toEqual([{ id: "wf_1", lastUsageAt: 3, agents: 2 }]);
  });
});

describe("the idle rule", () => {
  const idle = answer({ running: false });
  const step = (state: PiLiveState | null, next: PiSubagentsLive | null, time: number) => nextPiLiveState(state, next, piSubagentsMark(), time);

  it("confirms idle only after two idle answers at least IDLE_CONFIRM_MS apart", () => {
    let state = step(null, idle, 0);
    expect(piLiveView(state)?.idle).toBeNull();
    const first = state!.mark;
    state = step(state, idle, IDLE_CONFIRM_MS - 1);
    expect(piLiveView(state)?.idle).toBeNull();
    state = step(state, idle, IDLE_CONFIRM_MS);
    expect(piLiveView(state)?.idle).toEqual({ mark: first });
  });

  it("starts over on a running answer, a missing one or anything that happened in between", () => {
    let state = step(null, idle, 0);
    state = step(state, answer({ running: true }), 5_000);
    state = step(state, idle, 6_000);
    state = step(state, idle, 6_000 + IDLE_CONFIRM_MS - 1);
    expect(piLiveView(state)?.idle).toBeNull();
    // no answer: the file alone
    expect(step(state, null, 30_000)).toBeNull();
    // a workflow's stage spent between two idle polls
    state = step(null, answer({ running: false, workflows: [{ id: "wf_1", lastUsageAt: 1, agents: 1 }] }), 0);
    state = step(state, answer({ running: false, workflows: [{ id: "wf_1", lastUsageAt: 2, agents: 2 }] }), IDLE_CONFIRM_MS);
    expect(piLiveView(state)?.idle).toBeNull();
    // an agent that started and ended in between
    state = step(state, answer({ running: false, workflows: [{ id: "wf_1", lastUsageAt: 2, agents: 2 }], agents: [agent("a1", "completed", 1, { endedAt: 9 })] }), 2 * IDLE_CONFIRM_MS);
    state = step(state, answer({ running: false, workflows: [{ id: "wf_1", lastUsageAt: 2, agents: 2 }], agents: [agent("a1", "completed", 1, { endedAt: 9 })] }), 3 * IDLE_CONFIRM_MS);
    expect(piLiveView(state)?.idle).not.toBeNull();
  });

  it("gives no view without pi-subagents loaded, or without a registry's word on idle", () => {
    expect(piLiveView(step(null, answer({ loaded: false }), 0))).toBeNull();
    let state = step(null, answer({ running: null }), 0);
    state = step(state, answer({ running: null }), IDLE_CONFIRM_MS);
    expect(piLiveView(state)).toEqual({ mark: state!.mark, agents: new Map(), idle: null });
  });
});

describe("the live view over the session file", () => {
  it("ends an agent the file has running once pi has it ended, and loses one pi does not know (a /reload)", () => {
    const pi = piSession();
    pi.prompt(1);
    pi.background(2, "a1");
    pi.background(3, "a2");
    pi.background(4, "a3");
    expect(piSubagentCounts(pi.session()).running).toBe(3);
    const live = view([agent("a1", "running", 2), agent("a2", "stopped", 3, { endedAt: ms(5), toolUses: 4 })]);
    expect(piSubagentCounts(pi.session(live))).toMatchObject({ running: 1, turnRunning: 1 });
    expect(statuses(pi.session(live)).tasks).toEqual([["a1", "running"], ["a2", "cancelled"], ["a3", "lost"]]);
    expect(piSubagentActivity(pi.session(live), NOW).tasks.find((task) => task.id === "a2")).toMatchObject({ ended_at: at(5), tool_calls: 4 });
    // without the view the file alone speaks, as before
    expect(piSubagentCounts(pi.session(null)).running).toBe(3);
  });

  it("judges only what the file held before the answer was asked for", () => {
    const pi = piSession();
    pi.background(2, "a1");
    piSubagentCounts(pi.session());
    const live = view([]);
    // written (and read) after the answer was asked for: the answer could not know it yet
    pi.background(3, "a2");
    expect(statuses(pi.session(live)).tasks).toEqual([["a2", "running"], ["a1", "lost"]]);
    expect(piSubagentCounts(pi.session(live)).running).toBe(1);
    // a later answer judges it
    expect(piSubagentCounts(pi.session(view([])))).toMatchObject({ running: 0 });
  });

  it("adds an agent running in pi that the file does not show, counted for the turn it started in", () => {
    const pi = piSession();
    pi.prompt(1);
    pi.prompt(5);
    piSubagentCounts(pi.session());
    const live = view([agent("rpc1", "running", 3, { model: "anthropic/haiku", tokens: 120, toolUses: 2, type: "scheduler" }), agent("old", "completed", 1, { endedAt: ms(2) })]);
    expect(piSubagentCounts(pi.session(live))).toMatchObject({ running: 1, turnRunning: 0, promptAt: ms(5) });
    expect(piSubagentActivity(pi.session(live), NOW).tasks).toEqual([{
      id: "rpc1", title: "task rpc1", category: "scheduler", model: "anthropic/haiku", status: "running",
      started_at: at(3), ended_at: null, turns: null, tool_calls: 2, tokens: 120,
    }]);
  });

  it("runs again an agent the file has ended that pi resumed since, and keeps a stale running answer from undoing an end", () => {
    const pi = piSession();
    pi.background(2, "a1");
    pi.record(4, "a1", "completed");
    pi.background(5, "a2");
    pi.record(7, "a2", "completed");
    piSubagentCounts(pi.session());
    const live = view([agent("a1", "running", 6), agent("a2", "running", 5)]);
    expect(piSubagentActivity(pi.session(live), NOW).tasks.map((task) => [task.id, task.status, task.started_at])).toEqual([["a1", "running", at(6)], ["a2", "completed", at(5)]]);
  });

  it("takes a foreground call for pi's running agent of its description, never as a second row", () => {
    const pi = piSession();
    pi.prompt(1);
    pi.foreground(2, "call_f1", "check the tests");
    piSubagentCounts(pi.session());
    const live = view([agent("f1", "running", 2, { description: "check the tests" })]);
    expect(piSubagentCounts(pi.session(live)).running).toBe(1);
    expect(statuses(pi.session(live)).tasks).toEqual([["call_f1", "running"]]);
  });

  it("loses the workflows and calls the file still runs once pi confirmed idle since before they were read", () => {
    const pi = piSession();
    pi.workflow(2, "wf_1");
    pi.foreground(3, "call_f1", "check");
    piSubagentCounts(pi.session());
    // idle, but not confirmed yet: a stage's gap
    expect(statuses(pi.session(view([])))).toEqual({ tasks: [["call_f1", "running"]], runs: [["wf_1", "running"]] });
    const since = piSubagentsMark();
    expect(statuses(pi.session(view([], { mark: since })))).toEqual({ tasks: [["call_f1", "lost"]], runs: [["wf_1", "lost"]] });
    expect(piSubagentCounts(pi.session(view([], { mark: since }))).running).toBe(0);
  });
});

describe("askPiSubagentsLive", () => {
  /** The web UI's pi extension bridge with its roster, on its socket in a temp agent directory. */
  async function extension(sessionFile: string, pid = 4242) {
    // short: a unix socket path must fit in about 100 bytes
    const agentDir = temp("pal-");
    const emitter = new EventEmitter();
    const events: PiEventBus = { emit: (channel, data) => { emitter.emit(channel, data); }, on: (channel, handler) => { emitter.on(channel, handler); return () => emitter.off(channel, handler); } };
    let running = false;
    const roster = createPiSubagentsRoster(events, { registry: () => ({ hasRunning: () => running }) });
    const bridge = createPiAskBridge({ events, socketPath: join(agentDir, PI_ASK_BRIDGE_DIRECTORY, `${pid}.sock`), pid, subagents: roster.snapshot });
    bridges.push(bridge);
    await bridge.start({ hasUI: true, sessionManager: { getSessionFile: () => sessionFile } });
    return { events, environ: [`PI_CODING_AGENT_DIR=${agentDir}`], bridge, setRunning: (next: boolean) => { running = next; } };
  }

  it("asks the pane's pi process through its extension socket, end to end", async () => {
    if (!posix) return;
    const pi = piSession();
    const ext = await extension(pi.path);
    ext.events.emit(PI_SUBAGENTS_EVENTS.ready, {});
    ext.events.emit(PI_SUBAGENTS_EVENTS.started, { id: "a1", type: "Explore", description: "task a1" });
    ext.setRunning(true);
    const got = await askPiSubagentsLive({ pid: 4242, cwd: null, environ: ext.environ, path: pi.path });
    expect(got).toMatchObject({ pid: 4242, sessionFile: pi.path, loaded: true, running: true, agents: [{ id: "a1", status: "running" }] });
  });

  it("takes an answer only for the located pid and the tracked session file", async () => {
    if (!posix) return;
    const pi = piSession();
    const ext = await extension(pi.path);
    expect(await askPiSubagentsLive({ pid: 4242, cwd: null, environ: ext.environ, path: "/other.jsonl" })).toBeNull();
    // another pid's socket is not there
    expect(await askPiSubagentsLive({ pid: 4243, cwd: null, environ: ext.environ, path: pi.path })).toBeNull();
    // pi names the file through a link: the same file
    const link = join(temp("pal-link-"), "s.jsonl");
    symlinkSync(pi.path, link);
    const linked = await extension(link, 4244);
    expect(await askPiSubagentsLive({ pid: 4244, cwd: null, environ: linked.environ, path: pi.path })).not.toBeNull();
  });

  it("gets nothing from an extension from before the route, or a socket that is gone", async () => {
    if (!posix) return;
    const pi = piSession();
    const agentDir = temp("pal-");
    const old = createPiAskBridge({ events: { on: () => () => {}, emit: () => {} }, socketPath: join(agentDir, PI_ASK_BRIDGE_DIRECTORY, "4242.sock"), pid: 4242 });
    bridges.push(old);
    await old.start({ hasUI: true, sessionManager: { getSessionFile: () => pi.path } });
    const environ = [`PI_CODING_AGENT_DIR=${agentDir}`];
    expect(await askPiSubagentsLive({ pid: 4242, cwd: null, environ, path: pi.path })).toBeNull();
    await old.stop();
    expect(await askPiSubagentsLive({ pid: 4242, cwd: null, environ, path: pi.path })).toBeNull();
  });
});

describe("PiSubagentStatus with the pi process's answers", () => {
  const pane = (id: string): HerdrPane =>
    ({ pane_id: id, agent: "pi", agent_session: { agent: "pi", kind: "path", source: "herdr:pi", value: "s1" }, cwd: "/work/app", agent_status: "idle", focused: false, revision: 1 }) as HerdrPane;
  /** lets the answer asked for at the last poll come in */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  function tracker(path: string, live: () => PiSubagentsLive | null) {
    let time = NOW;
    const changes: [string, number, number, number | null][] = [];
    const status = new PiSubagentStatus({
      pane: async () => null,
      onChange: (...change) => { changes.push(change); },
      locate: async () => ({ path, pid: 10, startedAt: null, environ: null, cwd: null }),
      processStart: () => null,
      live: async () => live(),
      now: () => time,
    });
    trackers.push(status);
    return { status, changes, tick: (ms: number) => { time += ms; } };
  }

  it("ends what a /reload aborted: agents at once, a workflow after two idle polls a minute apart", async () => {
    const pi = piSession();
    pi.prompt(1);
    pi.background(2, "a1");
    pi.workflow(3, "wf_1");
    let reply: PiSubagentsLive | null = answer({ running: true, agents: [agent("a1", "running", 2)] });
    const { status, changes, tick } = tracker(pi.path, () => reply);
    await status.refresh([pane("p1")]);
    await settle();
    expect(status.countOf("p1")).toBe(2);
    // /reload: pi-subagents starts over empty, nothing runs, and the file is as it was
    reply = answer({ running: false });
    status.poll();
    await settle();
    expect(status.countOf("p1")).toBe(1);
    expect((await status.activity("p1"))!.tasks.map((task) => [task.id, task.status])).toEqual([["a1", "lost"]]);
    tick(IDLE_CONFIRM_MS - 1000);
    status.poll();
    await settle();
    expect(status.countOf("p1")).toBe(1);
    tick(1000);
    status.poll();
    await settle();
    expect(status.countOf("p1")).toBe(0);
    expect((await status.activity("p1"))!.runs.map((run) => [run.id, run.status])).toEqual([["wf_1", "lost"]]);
    expect(changes.map(([, running]) => running)).toEqual([2, 1, 0]);
  });

  it("keeps a workflow between its stages, while its agents spend", async () => {
    const pi = piSession();
    pi.workflow(3, "wf_1");
    let usage = 1;
    const { status, tick } = tracker(pi.path, () => answer({ running: false, workflows: [{ id: "wf_1", lastUsageAt: usage, agents: usage }] }));
    await status.refresh([pane("p1")]);
    for (let poll = 0; poll < 5; poll++) {
      tick(IDLE_CONFIRM_MS);
      usage += 1;
      status.poll();
      await settle();
      expect(status.countOf("p1")).toBe(1);
    }
  });

  it("keeps a workflow through a gate of half a minute, while pi runs nothing", async () => {
    const pi = piSession();
    pi.workflow(3, "wf_1");
    // a non-isolated agent completed, and its gate (a test suite) runs: the manager is idle
    const { status, tick } = tracker(pi.path, () => answer({ running: false, workflows: [{ id: "wf_1", lastUsageAt: 1, agents: 1 }] }));
    await status.refresh([pane("p1")]);
    await settle();
    for (let poll = 0; poll < 6; poll++) {
      tick(5_000);
      status.poll();
      await settle();
      expect(status.countOf("p1")).toBe(1);
    }
    expect(IDLE_CONFIRM_MS).toBeGreaterThanOrEqual(30_000);
  });

  it("counts from the file alone without an answer, as before", async () => {
    const pi = piSession();
    pi.background(2, "a1");
    pi.workflow(3, "wf_1");
    const { status, tick } = tracker(pi.path, () => null);
    await status.refresh([pane("p1")]);
    for (let poll = 0; poll < 3; poll++) {
      tick(IDLE_CONFIRM_MS);
      status.poll();
      await settle();
    }
    expect(status.countOf("p1")).toBe(2);
    expect((await status.activity("p1"))!.tasks.map((task) => task.status)).toEqual(["running"]);
  });

  it("adds an agent pi runs that the file does not show yet, and waits on it", async () => {
    const pi = piSession();
    pi.prompt(1);
    const { status, changes } = tracker(pi.path, () => answer({ agents: [agent("rpc1", "running", 2)] }));
    await status.refresh([pane("p1")]);
    await settle();
    expect(changes.at(-1)).toEqual(["p1", 1, 1, ms(1)]);
    expect((await status.activity("p1"))!.tasks.map((task) => [task.id, task.status])).toEqual([["rpc1", "running"]]);
  });
});
