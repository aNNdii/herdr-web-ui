import { describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import { PI_SUBAGENTS_EVENTS } from "../shared/pi-subagents-bridge.ts";
import { createPiSubagentsRoster, MAX_ROSTER_AGENTS, MAX_ROSTER_WORKFLOWS, MAX_WORKFLOW_AGENTS } from "./pi-subagents-roster.ts";

/** pi's event bus (core/event-bus.js): a node EventEmitter behind on/emit. */
function bus() {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);
  return {
    emit: (channel: string, data: unknown) => { emitter.emit(channel, data); },
    on: (channel: string, handler: (data: unknown) => void) => { emitter.on(channel, handler); return () => emitter.off(channel, handler); },
  };
}

function roster(registry: () => unknown = () => undefined) {
  const events = bus();
  let time = 1_000;
  const live = createPiSubagentsRoster(events, { now: () => time, registry });
  return { events, live, at: (next: number) => { time = next; }, snapshot: () => live.snapshot({ pid: 7, sessionFile: "/s/one.jsonl" }) };
}

/** pi-subagents 0.23.1's buildEventData for a settled agent */
const settled = (id: string, status: string, extra: Record<string, unknown> = {}) =>
  ({ id, type: "Explore", description: `task ${id}`, status, result: "done", error: undefined, toolUses: 3, durationMs: 500, tokens: { input: 10, output: 5, total: 15 }, ...extra });

describe("pi-subagents roster", () => {
  it("runs an agent from its created or started until it completes or fails, with pi's statuses mapped", () => {
    const { events, at, snapshot } = roster();
    events.emit(PI_SUBAGENTS_EVENTS.created, { id: "a1", type: "Explore", description: "task a1", isBackground: true });
    at(1_100);
    // RPC, scheduler and @mention spawns are first seen at started
    events.emit(PI_SUBAGENTS_EVENTS.started, { id: "a2", type: "general-purpose", description: "task a2" });
    events.emit(PI_SUBAGENTS_EVENTS.started, { id: "a1", type: "Explore", description: "task a1" });
    // the newest touched last; started after created is the same run
    expect(snapshot().agents).toEqual([
      { id: "a2", type: "general-purpose", description: "task a2", status: "running", startedAt: 1_100 },
      { id: "a1", type: "Explore", description: "task a1", status: "running", startedAt: 1_000 },
    ]);
    at(2_000);
    events.emit(PI_SUBAGENTS_EVENTS.completed, settled("a1", "steered"));
    events.emit(PI_SUBAGENTS_EVENTS.failed, settled("a2", "stopped"));
    events.emit(PI_SUBAGENTS_EVENTS.failed, settled("a3", "aborted"));
    events.emit(PI_SUBAGENTS_EVENTS.failed, settled("a4", "error"));
    events.emit(PI_SUBAGENTS_EVENTS.completed, settled("a5", "completed"));
    expect(snapshot().agents.map((agent) => [agent.id, agent.status, agent.startedAt, agent.endedAt])).toEqual([
      ["a1", "completed", 1_000, 2_000],
      ["a2", "stopped", 1_100, 2_000],
      // known only from its end: started its duration before
      ["a3", "failed", 1_500, 2_000],
      ["a4", "failed", 1_500, 2_000],
      ["a5", "completed", 1_500, 2_000],
    ]);
    expect(snapshot().agents[0]).toMatchObject({ toolUses: 3, tokens: 15 });
  });

  it("runs a resumed agent again from its new start, and keeps one run for created after started", () => {
    const { events, at, snapshot } = roster();
    events.emit(PI_SUBAGENTS_EVENTS.started, { id: "a1", type: "Explore", description: "task a1" });
    at(1_500);
    // a foreground call sent to the background: created after started, the same run
    events.emit(PI_SUBAGENTS_EVENTS.created, { id: "a1", type: "Explore", description: "task a1", isBackground: true });
    expect(snapshot().agents.map((agent) => [agent.status, agent.startedAt])).toEqual([["running", 1_000]]);
    at(2_000);
    events.emit(PI_SUBAGENTS_EVENTS.completed, settled("a1", "completed"));
    at(3_000);
    events.emit(PI_SUBAGENTS_EVENTS.started, { id: "a1", type: "Explore", description: "task a1" });
    expect(snapshot().agents).toEqual([{ id: "a1", type: "Explore", description: "task a1", status: "running", startedAt: 3_000 }]);
  });

  it("counts a running agent's tokens and model from its usage, and sees workflows only through theirs", () => {
    const { events, at, snapshot } = roster();
    events.emit(PI_SUBAGENTS_EVENTS.started, { id: "a1", type: "Explore", description: "task a1" });
    const usage = { input: 100, output: 20, cacheRead: 5_000, cacheWrite: 30, totalTokens: 5_150, cost: { total: 0.01 } };
    events.emit(PI_SUBAGENTS_EVENTS.usage, { id: "a1", type: "Explore", description: "task a1", depth: 1, model: "anthropic/claude-haiku-4-5", usage });
    events.emit(PI_SUBAGENTS_EVENTS.usage, { id: "a1", type: "Explore", description: "task a1", depth: 1, usage });
    // a nested agent's spend, and one of an agent never started here, are not listed
    events.emit(PI_SUBAGENTS_EVENTS.usage, { id: "n1", type: "Explore", description: "nested", depth: 2, parentAgentId: "a1", usage });
    events.emit(PI_SUBAGENTS_EVENTS.usage, { id: "x1", type: "Explore", description: "unknown", depth: 1, usage });
    at(1_200);
    events.emit(PI_SUBAGENTS_EVENTS.usage, { id: "w1-a", type: "Explore", description: "step", depth: 1, workflowId: "wf_1", usage });
    at(1_300);
    events.emit(PI_SUBAGENTS_EVENTS.usage, { id: "w1-b", type: "Explore", description: "step", depth: 1, workflowId: "wf_1", usage });
    events.emit(PI_SUBAGENTS_EVENTS.usage, { id: "w1-b", type: "Explore", description: "step", depth: 1, workflowId: "wf_1", usage });
    const now = snapshot();
    expect(now.agents).toEqual([{ id: "a1", type: "Explore", description: "task a1", status: "running", startedAt: 1_000, tokens: 300, model: "anthropic/claude-haiku-4-5" }]);
    expect(now.workflows).toEqual([{ id: "wf_1", lastUsageAt: 1_300, agents: 2 }]);
    // the end's own total stands
    events.emit(PI_SUBAGENTS_EVENTS.completed, settled("a1", "completed"));
    expect(snapshot().agents[0]).toMatchObject({ status: "completed", tokens: 15, model: "anthropic/claude-haiku-4-5" });
  });

  it("is loaded once pi-subagents is ready or its registry is there, and runs as the registry says", () => {
    let registry: unknown;
    const { events, live, snapshot } = roster(() => registry);
    expect(snapshot()).toEqual({ version: 1, pid: 7, sessionFile: "/s/one.jsonl", loaded: false, running: null, agents: [], workflows: [] });
    events.emit(PI_SUBAGENTS_EVENTS.ready, {});
    expect(snapshot()).toMatchObject({ loaded: true, running: null });
    let running = true;
    registry = { hasRunning: () => running, getRecord: () => undefined };
    expect(snapshot()).toMatchObject({ loaded: true, running: true });
    running = false;
    expect(snapshot().running).toBe(false);
    // a registry that throws says nothing
    registry = { hasRunning: () => { throw new Error("gone"); } };
    expect(snapshot().running).toBeNull();
    // a session start keeps ready, which pi-subagents may have sent before this extension's own handler ran
    live.sessionStarted();
    registry = undefined;
    expect(snapshot().loaded).toBe(true);
    live.sessionEnded();
    expect(snapshot().loaded).toBe(false);
  });

  it("starts empty on a session start, a session end and pi-subagents' disposed", () => {
    const { events, live, snapshot } = roster();
    const fill = () => {
      events.emit(PI_SUBAGENTS_EVENTS.ready, {});
      events.emit(PI_SUBAGENTS_EVENTS.started, { id: "a1", type: "Explore", description: "task a1" });
      events.emit(PI_SUBAGENTS_EVENTS.usage, { id: "w", depth: 1, workflowId: "wf_1", usage: { input: 1 } });
    };
    fill();
    live.sessionStarted();
    expect(snapshot()).toMatchObject({ loaded: true, agents: [], workflows: [] });
    fill();
    live.sessionEnded();
    expect(snapshot()).toMatchObject({ loaded: false, agents: [], workflows: [] });
    fill();
    events.emit(PI_SUBAGENTS_EVENTS.disposed, {});
    expect(snapshot()).toMatchObject({ loaded: false, agents: [], workflows: [] });
  });

  it("caps its maps, letting an ended agent go before a running one", () => {
    const { events, snapshot } = roster();
    events.emit(PI_SUBAGENTS_EVENTS.started, { id: "keep", type: "Explore" });
    events.emit(PI_SUBAGENTS_EVENTS.completed, settled("ended", "completed"));
    for (let i = 0; i < MAX_ROSTER_AGENTS - 1; i++) events.emit(PI_SUBAGENTS_EVENTS.started, { id: `r${i}` });
    const agents = snapshot().agents;
    expect(agents).toHaveLength(MAX_ROSTER_AGENTS);
    expect(agents.some((agent) => agent.id === "keep")).toBe(true);
    expect(agents.some((agent) => agent.id === "ended")).toBe(false);
    // only running ones left: the oldest goes
    events.emit(PI_SUBAGENTS_EVENTS.started, { id: "one-more" });
    expect(snapshot().agents.some((agent) => agent.id === "keep")).toBe(false);

    for (let i = 0; i < MAX_ROSTER_WORKFLOWS + 5; i++) events.emit(PI_SUBAGENTS_EVENTS.usage, { id: "w", depth: 1, workflowId: `wf_${i}`, usage: {} });
    const workflows = snapshot().workflows;
    expect(workflows).toHaveLength(MAX_ROSTER_WORKFLOWS);
    expect(workflows[0]!.id).toBe("wf_5");
    for (let i = 0; i < MAX_WORKFLOW_AGENTS + 5; i++) events.emit(PI_SUBAGENTS_EVENTS.usage, { id: `w${i}`, depth: 1, workflowId: "wf_big", usage: {} });
    expect(snapshot().workflows.at(-1)).toMatchObject({ id: "wf_big", agents: MAX_WORKFLOW_AGENTS });
  });

  it("passes over events it cannot read", () => {
    const { events, snapshot } = roster();
    for (const data of [null, "a1", 3, [], {}, { id: "" }, { id: 5 }]) {
      events.emit(PI_SUBAGENTS_EVENTS.started, data);
      events.emit(PI_SUBAGENTS_EVENTS.completed, data);
      events.emit(PI_SUBAGENTS_EVENTS.usage, data);
    }
    expect(snapshot()).toMatchObject({ agents: [], workflows: [] });
  });
});
