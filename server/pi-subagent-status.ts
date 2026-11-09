import type { HerdrPane } from "../shared/protocol.ts";
import { plain, within } from "./claude-subagents.ts";
import { piPaneSession } from "./pi.ts";
import { piSubagentActivity, piSubagentCounts, piSubagentsMark, type PiSession, type PiSubagentActivity } from "./pi-subagents.ts";
import { askPiSubagentsLive, MISSED, nextPiLiveState, piLiveView, type PiLiveAnswer, type PiLiveState, type PiLiveTarget } from "./pi-subagents-live.ts";
import { processStartedAt } from "./process-start.ts";
import { piRunsSubagents } from "./skills/pi-agents.ts";
import { readPiConfig } from "./skills/pi-config.ts";
import { environValue } from "./skills/walk.ts";

/**
 * A Pi subagents pane's session as piSubagentPane locates it from piPaneSession's answer
 * (server/pi.ts): the session file and the pi process that writes it, pid and start null when they
 * cannot be told. `cwd`, the process's own, places a relative PI_CODING_AGENT_DIR, where its
 * extension's socket is.
 */
export interface LocatedPiSession { path: string; pid: number | null; startedAt: number | null; environ: readonly string[] | null; cwd?: string | null }

export interface PiSubagentDeps {
  /** a pane by id, for a pane no snapshot has shown yet */
  pane: (paneId: string) => Promise<HerdrPane | null>;
  /** a pane's running agents and workflows changed, or how many of them its turn started, or its last prompt */
  onChange: (paneId: string, running: number, turnRunning: number, promptAt: number | null) => void;
  /** another session or pi process replaced the one tracked: its counts are 0, and its transition evidence is stale */
  onReset?: (paneId: string) => void;
  /** default piSubagentPane */
  locate?: (pane: HerdrPane) => Promise<LocatedPiSession | null>;
  /** default processStartedAt: tells, without a herdr call, that the tracked pi process is gone or replaced */
  processStart?: (pid: number) => number | null;
  /** default askPiSubagentsLive: what the pane's pi process says itself through the web UI's pi extension, MISSED this time, or null */
  live?: (target: PiLiveTarget) => Promise<PiLiveAnswer>;
  now?: () => number;
  pollMs?: number;
  refreshMs?: number;
}

/** `sig`: the session file's stat when its counts were last read to its end */
interface Tracked {
  /** herdr's agent_session value the session was looked up for */
  key: string;
  /** null: the pane runs pi, but no pi-subagents session was found for it */
  path: string | null;
  pid: number | null; startedAt: number | null; environ: readonly string[] | null; cwd: string | null;
  /** the pi process's own answers (server/pi-subagents-live.ts); null: the file alone */
  liveState: PiLiveState | null;
  /** bumped by every answer but a missing one after none: each one counts the pane again, whatever the file's stat */
  liveSeq: number;
  /** an answer (or none) came for this session and process */
  asked: boolean;
  /** when it was last looked up; -Infinity: due at once */
  at: number;
  live: boolean;
  running: number; turnRunning: number; promptAt: number | null;
  sig: string | null;
}

/**
 * The running agents and workflows of every Pi pane whose pi loads pi-subagents (piSubagentPane), for the
 * pane's count and its list. It knows no pi-subagents format: server/pi-subagents.ts reads the
 * session, which stays the history and the fallback, and server/pi-subagents-live.ts asks the
 * pane's pi process what runs now, through the web UI's pi extension. A pane is looked up when it
 * is first seen as `pi`, when herdr names another session for it, when its pi process is gone or
 * replaced, or (when that cannot be told, or nothing was found) now and then. A pane that leaves pi
 * keeps the session it had, so that its list can say what was left running there is lost; its
 * count is 0. Every poll also asks the pane's pi process (one question out at a time, only with a
 * known pid), and its answer counts the pane again: what the process says of its agents overrides
 * the file (PiLiveView), and no answer leaves the file alone, as without the extension; one that
 * only missed this poll keeps the last answer for a poll or two (nextPiLiveState). A poll
 * whose session file stat and answers are as they were reads nothing, and while the budgeted read
 * is behind, the last counts stand.
 */
export class PiSubagentStatus {
  private readonly panes = new Map<string, Tracked>();
  /** The latest lookup claim per pane; a newer one cancels an older answer. */
  private readonly lookups = new Map<string, object>();
  /** The pi process's answer asked for per pane, while it is out. */
  private readonly asking = new Map<string, Promise<void>>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private refreshing: Promise<void> | null = null;
  private queued: readonly HerdrPane[] | null = null;
  private readonly now: () => number;
  private readonly refreshMs: number;
  private readonly locate: (pane: HerdrPane) => Promise<LocatedPiSession | null>;
  private readonly processStart: (pid: number) => number | null;
  private readonly live: (target: PiLiveTarget) => Promise<PiLiveAnswer>;

  constructor(private readonly deps: PiSubagentDeps) {
    this.now = deps.now ?? Date.now;
    this.refreshMs = deps.refreshMs ?? 5000;
    this.locate = deps.locate ?? piSubagentPane;
    this.processStart = deps.processStart ?? processStartedAt;
    this.live = deps.live ?? ((target) => askPiSubagentsLive(target));
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.poll(), this.deps.pollMs ?? 2000);
    this.timer.unref?.();
  }

  stop(): void {
    this.lookups.clear();
    this.asking.clear();
    this.queued = null;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /** A pi-subagents session is known for the pane, live or left behind: only then does it count and wait as a Pi subagents pane. */
  tracks(paneId: string): boolean {
    return (this.panes.get(paneId)?.path ?? null) !== null;
  }

  countOf(paneId: string): number {
    return this.panes.get(paneId)?.running ?? 0;
  }

  /** Finds the Pi panes of a snapshot and their sessions, then polls; a known one is not looked up again. */
  refresh(panes: readonly HerdrPane[]): Promise<void> {
    const ids = new Set(panes.map((pane) => pane.pane_id));
    for (const paneId of this.panes.keys()) if (!ids.has(paneId)) this.panes.delete(paneId);
    for (const paneId of this.lookups.keys()) if (!ids.has(paneId)) this.lookups.delete(paneId);
    for (const pane of panes) if (pane.agent !== "pi") this.leave(pane.pane_id);
    if (this.refreshing) { this.queued = panes; return this.refreshing; }
    this.refreshing = (async () => {
      try {
        for (let next: readonly HerdrPane[] | null = panes; next !== null; next = this.queued) {
          this.queued = null;
          await Promise.all(next.map((pane) => this.ensure(pane)));
          this.poll();
        }
      } finally { this.refreshing = null; }
    })();
    return this.refreshing;
  }

  /**
   * The pane's agents and workflows, as piSubagentActivity lists them (empty while its read is
   * behind); null only when it is no Pi subagents pane. A pane not known yet is looked up for at
   * most a second: what a slower lookup finds is there next time.
   */
  async activity(paneId: string): Promise<PiSubagentActivity | null> {
    if (!this.panes.has(paneId)) {
      await within(1000, (async () => {
        const pane = await this.deps.pane(paneId);
        if (pane !== null) await this.ensure(pane);
      })());
    }
    const first = this.panes.get(paneId);
    // the pi process was not asked yet: its answer is waited for, as briefly as the lookup
    if (first?.path && !first.asked) await within(1000, this.ask(paneId, first) ?? Promise.resolve());
    const tracked = this.panes.get(paneId);
    if (!tracked?.path) return null;
    return piSubagentActivity(this.session(tracked, tracked.path), this.now());
  }

  /**
   * Reads what the session files gained, of every pane or of one; a pane whose counts changed is
   * told. Each pane's pi process is asked for its own answer meanwhile, which counts the pane
   * again once it is in.
   */
  poll(only?: string): void {
    for (const [paneId, tracked] of this.panes) {
      if (only !== undefined && paneId !== only) continue;
      void this.ask(paneId, tracked);
      this.count(paneId, tracked);
    }
  }

  private count(paneId: string, tracked: Tracked): void {
    let counts = { running: 0, turnRunning: 0, promptAt: null as number | null };
    if (tracked.path !== null && tracked.live) {
      const stat = plain(tracked.path);
      const sig = stat === null ? null : `${stat.id}:${stat.size}:${stat.mtimeMs}:${tracked.startedAt}:${tracked.liveSeq}`;
      if (sig !== null && sig === tracked.sig) return;
      const read = piSubagentCounts(this.session(tracked, tracked.path));
      // the budgeted read is behind: what was read so far is not the count yet, so the last counts stand
      if (!read.current) { tracked.sig = null; return; }
      tracked.sig = sig;
      counts = read;
    }
    else tracked.sig = null;
    if (counts.running === tracked.running && counts.turnRunning === tracked.turnRunning && counts.promptAt === tracked.promptAt) return;
    tracked.running = counts.running;
    tracked.turnRunning = counts.turnRunning;
    tracked.promptAt = counts.promptAt;
    this.deps.onChange(paneId, counts.running, counts.turnRunning, counts.promptAt);
  }

  /**
   * Asks the pane's pi process for its own answer, unless one is out already; null when it cannot
   * be asked (no session, not running pi, or its pid unknown). A read mark is taken first
   * (server/pi-subagents.ts), and the answer counts only for the same session and process.
   */
  private ask(paneId: string, tracked: Tracked): Promise<void> | null {
    const out = this.asking.get(paneId);
    if (out) return out;
    const { path, pid } = tracked;
    if (path === null || pid === null || !tracked.live) return null;
    const mark = piSubagentsMark();
    const request: Promise<void> = this.live({ pid, cwd: tracked.cwd, environ: tracked.environ, path }).catch((): PiLiveAnswer => MISSED).then((answer) => {
      if (this.asking.get(paneId) !== request) return;
      this.asking.delete(paneId);
      const current = this.panes.get(paneId);
      if (!current || current.path !== path || current.pid !== pid || !current.live) return;
      const next = nextPiLiveState(current.liveState, answer, mark, this.now());
      // no answer now, none before: the file alone, as it was
      current.asked = true;
      if (next === null && current.liveState === null) return;
      current.liveState = next;
      // a missed poll: the last answer stands, and so do the counts
      if (answer === MISSED && next !== null) return;
      current.liveSeq += 1;
      this.count(paneId, current);
    });
    this.asking.set(paneId, request);
    return request;
  }

  private session(tracked: Tracked, path: string): PiSession {
    return { path, environ: tracked.environ, live: tracked.live, startedAt: tracked.startedAt, liveView: tracked.live ? piLiveView(tracked.liveState) : null };
  }

  /** The pane does not run pi (any more): what it ran there is lost, and a return to pi is looked up at once. */
  private leave(paneId: string): void {
    this.lookups.delete(paneId);
    const tracked = this.panes.get(paneId);
    if (!tracked) return;
    tracked.live = false;
    tracked.liveState = null;
    tracked.at = -Infinity;
  }

  /** One pane's session, looked up now when it is not known (or not known to be this session's or process's). */
  private async ensure(pane: HerdrPane): Promise<void> {
    const paneId = pane.pane_id;
    if (pane.agent !== "pi") { this.leave(paneId); return; }
    const key = pane.agent_session?.value ?? "";
    const tracked = this.panes.get(paneId);
    const now = this.now();
    const unverified = tracked !== undefined && (tracked.pid === null || tracked.startedAt === null);
    const moved = tracked !== undefined && !unverified && this.processStart(tracked.pid!) !== tracked.startedAt;
    const due = !tracked || tracked.key !== key || moved
      || (now - tracked.at >= this.refreshMs && (tracked.path === null || !tracked.live || unverified));
    if (!due) return;
    const claim = {};
    this.lookups.set(paneId, claim);
    const found = await this.locate(pane).catch(() => null);
    if (this.lookups.get(paneId) !== claim) return;
    this.lookups.delete(paneId);
    const current = this.panes.get(paneId);
    if (found === null) {
      if (current && current.key === key) { current.at = this.now(); return; }
      // another session (not written yet after /new, or one without pi-subagents): only the
      // current session counts, so the old one is dropped, not listed as lost
      if (current?.path) { this.deps.onReset?.(paneId); this.zero(current); current.path = null; current.live = true; }
      if (current) { current.key = key; current.at = this.now(); return; }
      this.panes.set(paneId, { key, path: null, pid: null, startedAt: null, environ: null, cwd: null, liveState: null, liveSeq: 0, asked: false, at: this.now(), live: true, running: 0, turnRunning: 0, promptAt: null, sig: null });
      return;
    }
    const reset = !!current?.path && (current.path !== found.path
      || (current.pid !== null && found.pid !== null && current.pid !== found.pid)
      || (current.startedAt !== null && found.startedAt !== null && current.startedAt !== found.startedAt));
    if (reset) this.deps.onReset?.(paneId);
    const counts = current && !reset ? current : null;
    this.panes.set(paneId, {
      key, path: found.path, pid: found.pid, startedAt: found.startedAt, environ: found.environ, cwd: found.cwd ?? null, at: this.now(), live: true,
      // the same session and process: its answers so far still stand
      ...(counts?.live && counts.path === found.path && counts.pid === found.pid
        ? { liveState: counts.liveState, liveSeq: counts.liveSeq, asked: counts.asked }
        : { liveState: null, liveSeq: (counts?.liveSeq ?? 0) + 1, asked: false }),
      running: counts?.running ?? 0, turnRunning: counts?.turnRunning ?? 0, promptAt: counts?.promptAt ?? null, sig: null,
    });
  }

  /** onReset told the pane's counts are 0. */
  private zero(tracked: Tracked): void {
    tracked.liveState = null;
    tracked.running = 0;
    tracked.turnRunning = 0;
    tracked.promptAt = null;
    tracked.sig = null;
  }
}

/**
 * A Pi subagents pane's session: the pane runs pi, piPaneSession finds its written session, and
 * that pi loads pi-subagents; null for any other pane. Without one verified pi process (`process` null), pi's config is read from this
 * server's home and the pane's cwd, and the process's pid and start stay unknown.
 */
export async function piSubagentPane(pane: HerdrPane): Promise<LocatedPiSession | null> {
  if (pane.agent !== "pi") return null;
  const found = await piPaneSession(pane.pane_id);
  if (found === null || !("path" in found.transcript)) return null;
  const pi = found.process;
  const env = pi?.environ ?? null;
  const home = environValue(env, "HOME") ?? process.env["HOME"] ?? process.env["USERPROFILE"] ?? "";
  const cwd = pi?.cwd ?? pane.foreground_cwd ?? pane.cwd ?? null;
  if (!piRunsSubagents(readPiConfig({ home, cwd, repoRoot: null, env, roots: {} }))) return null;
  return { path: found.transcript.path, pid: pi?.pid ?? null, startedAt: pi === null ? null : processStartedAt(pi.pid), environ: env, cwd: pi?.cwd ?? null };
}
