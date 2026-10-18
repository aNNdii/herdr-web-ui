import { afterEach, describe, expect, it } from "bun:test";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { HerdrPane, OmoRun, OmoTask } from "../shared/protocol.ts";
import { PiSubagentStatus, piSubagentPane, subagentList, type LocatedPiSession, type PiSubagentDeps } from "./pi-subagent-status.ts";
import { forgetPiSubagents } from "./pi-subagents.ts";

const roots: string[] = [];
const trackers: PiSubagentStatus[] = [];
afterEach(() => {
  for (const tracker of trackers.splice(0)) tracker.stop();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  forgetPiSubagents();
});

const NOW = Date.parse("2026-10-18T12:00:00.000Z");
const at = (minutes: number): string => new Date(NOW - 60 * 60 * 1000 + minutes * 60 * 1000).toISOString();
const ms = (minutes: number): number => Date.parse(at(minutes));
const json = (value: unknown): string => `${JSON.stringify(value)}\n`;

/** A pi session file with what the tracker needs: prompts and background `Agent` starts. */
function piSession(name = "s1") {
  const root = mkdtempSync(join(tmpdir(), "herdr-pi-subagent-status-"));
  roots.push(root);
  const path = join(root, `2026-10-18T11-00-00-000Z_${name}.jsonl`);
  writeFileSync(path, json({ type: "session", version: 3, id: name, timestamp: at(0), cwd: "/work/app" }));
  const entry = (minute: number, fields: Record<string, unknown>) => appendFileSync(path, json({ ...fields, timestamp: at(minute) }));
  return {
    path,
    prompt: (minute: number) => entry(minute, { type: "message", message: { role: "user", content: [{ type: "text", text: "go" }], timestamp: ms(minute) } }),
    background(minute: number, agentId: string) {
      const call = `call_${agentId}`;
      entry(minute, { type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: call, name: "Agent", arguments: { description: `task ${agentId}`, subagent_type: "Explore" } }], stopReason: "toolUse", timestamp: ms(minute) } });
      entry(minute, { type: "message", message: { role: "toolResult", toolCallId: call, toolName: "Agent", content: [{ type: "text", text: "started" }], details: { description: `task ${agentId}`, subagentType: "Explore", status: "background", agentId }, isError: false, timestamp: ms(minute) } });
    },
  };
}

const pane = (id: string, agent: string | null, session = "s1"): HerdrPane =>
  ({ pane_id: id, agent, agent_session: agent === "pi" ? { agent: "pi", kind: "path", source: "herdr:pi", value: session } : null, cwd: "/work/app", agent_status: "idle", focused: false, revision: 1 }) as HerdrPane;

function tracker(deps: Partial<PiSubagentDeps> & Pick<PiSubagentDeps, "locate">) {
  const changes: [string, number, number, number | null][] = [];
  const resets: string[] = [];
  const status = new PiSubagentStatus({
    pane: async () => null,
    onChange: (...change) => { changes.push(change); },
    onReset: (paneId) => { resets.push(paneId); },
    processStart: () => null,
    now: () => NOW,
    ...deps,
  });
  trackers.push(status);
  return { status, changes, resets };
}

describe("PiSubagentStatus", () => {
  it("tracks only pi panes with a pi-subagents session", async () => {
    const located: string[] = [];
    const { status, changes } = tracker({ locate: async (p) => { located.push(p.pane_id); return null; } });
    await status.refresh([pane("p1", "pi"), pane("p2", "claude"), pane("p3", null)]);
    expect(located).toEqual(["p1"]);
    for (const id of ["p1", "p2", "p3"]) {
      expect(status.tracks(id)).toBe(false);
      expect(status.countOf(id)).toBe(0);
      expect(await status.activity(id)).toBeNull();
    }
    expect(changes).toEqual([]);
  });

  it("counts a pane's running agents, and gives 0 and a lost list once the pane leaves pi", async () => {
    const pi = piSession();
    pi.prompt(1);
    pi.background(2, "a1");
    const { status, changes } = tracker({ locate: async () => ({ path: pi.path, pid: 10, startedAt: ms(0), environ: null }) });
    await status.refresh([pane("p1", "pi")]);
    expect(status.tracks("p1")).toBe(true);
    expect(status.countOf("p1")).toBe(1);
    expect(changes).toEqual([["p1", 1, 1, ms(1)]]);
    expect((await status.activity("p1"))!.tasks.map((task) => [task.id, task.status])).toEqual([["a1", "running"]]);
    await status.refresh([pane("p1", "shell")]);
    expect(status.countOf("p1")).toBe(0);
    expect(changes.at(-1)).toEqual(["p1", 0, 0, null]);
    expect(status.tracks("p1")).toBe(true);
    expect((await status.activity("p1"))!.tasks.map((task) => [task.id, task.status])).toEqual([["a1", "lost"]]);
  });

  it("loses what started more than START_SLACK_MS before the pi process now in the pane", async () => {
    const pi = piSession();
    pi.background(2, "a1");
    const { status } = tracker({ locate: async () => ({ path: pi.path, pid: 10, startedAt: ms(4), environ: null }) });
    await status.refresh([pane("p1", "pi")]);
    expect(status.countOf("p1")).toBe(0);
    expect((await status.activity("p1"))!.tasks.map((task) => task.status)).toEqual(["lost"]);
  });

  it("tells a change of the count or of promptAt, and nothing when they stay", async () => {
    const pi = piSession();
    pi.prompt(1);
    pi.background(2, "a1");
    const { status, changes } = tracker({ locate: async () => ({ path: pi.path, pid: 10, startedAt: null, environ: null }) });
    await status.refresh([pane("p1", "pi")]);
    status.poll();
    expect(changes).toEqual([["p1", 1, 1, ms(1)]]);
    pi.prompt(3);
    status.poll();
    expect(changes).toEqual([["p1", 1, 1, ms(1)], ["p1", 1, 0, ms(3)]]);
    pi.background(4, "a2");
    status.poll("p1");
    expect(changes.at(-1)).toEqual(["p1", 2, 1, ms(3)]);
  });

  it("does not read a session file whose stat did not change", async () => {
    const pi = piSession();
    pi.background(2, "a1");
    // a whole-millisecond time, which utimes sets back exactly
    const old = new Date(Date.now() - 5000);
    utimesSync(pi.path, old, old);
    const { status } = tracker({ locate: async () => ({ path: pi.path, pid: 10, startedAt: null, environ: null }) });
    await status.refresh([pane("p1", "pi")]);
    expect(status.countOf("p1")).toBe(1);
    // the same size, file and time, but a result that would end the agent if it were read
    const before = statSync(pi.path);
    writeFileSync(pi.path, readFileSync(pi.path, "utf8").replace('"status":"background"', '"status": "completed"'));
    utimesSync(pi.path, old, old);
    expect(statSync(pi.path).size).toBe(before.size);
    forgetPiSubagents();
    status.poll();
    expect(status.countOf("p1")).toBe(1);
    // a change of the stat is read
    appendFileSync(pi.path, "\n");
    status.poll();
    expect(status.countOf("p1")).toBe(0);
  });

  it("resets on a session or pi process change, never on first discovery", async () => {
    const one = piSession("s1");
    const two = piSession("s2");
    let found: LocatedPiSession = { path: one.path, pid: 10, startedAt: ms(0), environ: null };
    let alive = ms(0);
    const { status, resets } = tracker({ locate: async () => found, processStart: (pid) => pid === 10 ? alive : null });
    await status.refresh([pane("p1", "pi", "s1")]);
    expect(resets).toEqual([]);
    await status.refresh([pane("p1", "pi", "s1")]);
    expect(resets).toEqual([]);
    found = { path: two.path, pid: 10, startedAt: ms(0), environ: null };
    await status.refresh([pane("p1", "pi", "s2")]);
    expect(resets).toEqual(["p1"]);
    // pi restarted under the same session: another process
    found = { path: two.path, pid: 11, startedAt: ms(5), environ: null };
    alive = ms(5);
    await status.refresh([pane("p1", "pi", "s2")]);
    expect(resets).toEqual(["p1", "p1"]);
  });

  it("shows nothing of the old session after /new, until the new one is written (edge case /new)", async () => {
    const one = piSession("s1");
    one.prompt(1);
    one.background(2, "a1");
    let found: LocatedPiSession | null = { path: one.path, pid: 10, startedAt: ms(0), environ: null };
    const { status, resets } = tracker({ locate: async () => found, processStart: () => ms(0) });
    await status.refresh([pane("p1", "pi", "s1")]);
    expect(status.countOf("p1")).toBe(1);
    // /new: herdr reports the new session, which pi has not written yet
    found = null;
    await status.refresh([pane("p1", "pi", "s2")]);
    expect(resets).toEqual(["p1"]);
    expect(status.countOf("p1")).toBe(0);
    expect(status.tracks("p1")).toBe(false);
    expect(await status.activity("p1")).toBeNull();
  });

  it("waits at most a second for an unknown pane, and finds it the next time", async () => {
    const pi = piSession();
    pi.background(2, "a1");
    let release!: () => void;
    const slow = new Promise<void>((done) => { release = done; });
    const { status } = tracker({
      pane: async (id) => pane(id, "pi"),
      locate: async () => { await slow; return { path: pi.path, pid: 10, startedAt: null, environ: null }; },
    });
    const started = performance.now();
    expect(await status.activity("p1")).toBeNull();
    const waited = performance.now() - started;
    expect(waited).toBeGreaterThanOrEqual(900);
    expect(waited).toBeLessThan(1500);
    release();
    await slow;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await status.activity("p1"))!.tasks.map((task) => task.id)).toEqual(["a1"]);
  });
});

describe("piSubagentPane", () => {
  it("is null for a pane that does not run pi", async () => {
    expect(await piSubagentPane(pane("p1", "claude"))).toBeNull();
    expect(await piSubagentPane(pane("p1", null))).toBeNull();
  });
});

describe("subagentList", () => {
  const claudeTask: OmoTask = { id: "c1", title: "claude", category: null, model: null, status: "completed", started_at: null, ended_at: null, turns: null, tool_calls: null, tokens: null };
  const piRun: OmoRun = { id: "wf_1", name: "review", status: "running", started_at: null, ended_at: null, waves: [] };
  it("lists a live Claude session first, then Pi, then what a Claude session left behind", async () => {
    const asked: string[] = [];
    const pi = (found: boolean) => async () => { asked.push("pi"); return found ? { tasks: [], runs: [piRun] } : null; };
    const claude = () => [claudeTask];
    // Claude runs live: Pi is not asked
    expect(await subagentList({ live: true }, pi(true), claude)).toEqual({ tasks: [claudeTask], runs: [] });
    expect(asked).toEqual([]);
    // the pane left Claude for Pi: its Pi work
    expect(await subagentList({ live: false }, pi(true), claude)).toEqual({ tasks: [], runs: [piRun] });
    // no Pi subagents pane: the Claude session left behind, else nothing
    expect(await subagentList({ live: false }, pi(false), claude)).toEqual({ tasks: [claudeTask], runs: [] });
    expect(await subagentList(null, pi(false), claude)).toEqual({ tasks: [], runs: [] });
    expect(await subagentList(null, pi(true), claude)).toEqual({ tasks: [], runs: [piRun] });
  });
});
