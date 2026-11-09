import { afterEach, describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PI_ASK_BRIDGE_DIRECTORY } from "../shared/pi-ask-bridge.ts";
import { PI_SUBAGENTS_EVENTS, PI_SUBAGENTS_LIVE_ROUTE, type PiSubagentsLive } from "../shared/pi-subagents-bridge.ts";
import piAskBridgeExtension, { createPiAskBridge, type PiAskBridge, type PiEventBus, type PiExtensionAPI, type PiSessionContext } from "./pi-ask.ts";
import { createPiSubagentsRoster } from "./pi-subagents-roster.ts";

// fork: GET /v1/subagents on the web UI's pi extension socket (shared/pi-subagents-bridge.ts)

const posix = process.platform !== "win32";
const roots: string[] = [];
const bridges: PiAskBridge[] = [];
afterEach(async () => {
  for (const bridge of bridges.splice(0)) await bridge.stop();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function bus(): PiEventBus {
  const emitter = new EventEmitter();
  return {
    emit: (channel, data) => { emitter.emit(channel, data); },
    on: (channel, handler) => { emitter.on(channel, handler); return () => emitter.off(channel, handler); },
  };
}

function root(): string {
  // short: a unix socket path must fit in about 100 bytes
  const dir = mkdtempSync(join(tmpdir(), "pas-"));
  roots.push(dir);
  return dir;
}

const ui = (file = "/sessions/one.jsonl"): PiSessionContext => ({ hasUI: true, sessionManager: { getSessionFile: () => file } });

async function subagents(path: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`http://localhost${PI_SUBAGENTS_LIVE_ROUTE}`, { unix: path });
  return { status: response.status, body: await response.json() };
}

describe("pi-ask bridge extension: pi-subagents' live state", () => {
  it("serves the roster for its pid and session file", async () => {
    if (!posix) return;
    const events = bus();
    const path = join(root(), "ask", "4242.sock");
    const roster = createPiSubagentsRoster(events, { now: () => 5, registry: () => ({ hasRunning: () => true }) });
    const bridge = createPiAskBridge({ events, socketPath: path, pid: 4242, subagents: roster.snapshot });
    bridges.push(bridge);
    await bridge.start(ui());
    events.emit(PI_SUBAGENTS_EVENTS.started, { id: "a1", type: "Explore", description: "look" });

    expect(await subagents(path)).toEqual({ status: 200, body: {
      version: 1, pid: 4242, sessionFile: "/sessions/one.jsonl", loaded: true, running: true,
      agents: [{ id: "a1", type: "Explore", description: "look", status: "running", startedAt: 5 }], workflows: [],
    } satisfies PiSubagentsLive });
  });

  it("answers 404 without a roster, as an extension from before the route does", async () => {
    if (!posix) return;
    const path = join(root(), "ask", "4242.sock");
    const bridge = createPiAskBridge({ events: bus(), socketPath: path, pid: 4242 });
    bridges.push(bridge);
    await bridge.start(ui());
    expect((await subagents(path)).status).toBe(404);
  });

  it("is wired into the extension pi loads, and gone with its socket when the session ends", async () => {
    if (!posix) return;
    const agentDir = root();
    const handlers = new Map<string, ((event: unknown, context: PiSessionContext) => unknown)[]>();
    const events = bus();
    const pi: PiExtensionAPI = {
      events,
      on: (event, handler) => { handlers.set(event, [...handlers.get(event) ?? [], handler]); },
    };
    const run = async (event: string) => { for (const handler of handlers.get(event) ?? []) await handler({}, ui()); };
    const before = process.env["PI_CODING_AGENT_DIR"];
    process.env["PI_CODING_AGENT_DIR"] = agentDir;
    try { piAskBridgeExtension(pi); } finally {
      if (before === undefined) delete process.env["PI_CODING_AGENT_DIR"];
      else process.env["PI_CODING_AGENT_DIR"] = before;
    }
    const path = join(agentDir, PI_ASK_BRIDGE_DIRECTORY, `${process.pid}.sock`);
    await run("session_start");
    try {
      events.emit(PI_SUBAGENTS_EVENTS.ready, {});
      events.emit(PI_SUBAGENTS_EVENTS.started, { id: "a1", type: "Explore", description: "look" });
      const { body } = await subagents(path);
      expect(body).toMatchObject({ pid: process.pid, sessionFile: "/sessions/one.jsonl", loaded: true, agents: [{ id: "a1", status: "running" }] });
    } finally {
      await run("session_shutdown");
    }
    expect(existsSync(path)).toBe(false);
  });
});
