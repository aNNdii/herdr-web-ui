import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { paneSubagents } from "../commands.ts";
import { piRunsSubagents } from "./pi-agents.ts";
import { readPiConfig } from "./pi-config.ts";

const roots: string[] = [];
const previousHome = process.env.HOME;
const previousAgentDir = process.env["PI_CODING_AGENT_DIR"];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  if (previousAgentDir === undefined) delete process.env["PI_CODING_AGENT_DIR"];
  else process.env["PI_CODING_AGENT_DIR"] = previousAgentDir;
});
function temp(): string {
  const root = mkdtempSync(join(tmpdir(), "pi-agents-"));
  roots.push(root);
  return root;
}
function put(path: string, content: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

const SUBAGENTS = "npm:@tintinweb/pi-subagents";

/** a home whose pi has pi-subagents installed (not yet configured), and a project beside it */
function setup() {
  const home = temp();
  process.env.HOME = home;
  delete process.env["PI_CODING_AGENT_DIR"];
  const agentDir = join(home, ".pi", "agent");
  const cwd = join(temp(), "repo");
  mkdirSync(join(cwd, ".git"), { recursive: true });
  const root = join(agentDir, "npm", "node_modules", "@tintinweb", "pi-subagents");
  put(join(root, "package.json"), JSON.stringify({ name: "@tintinweb/pi-subagents", pi: { extensions: ["./src/index.ts"] } }));
  put(join(root, "src", "index.ts"), "export default () => {};\n");
  return {
    home, agentDir, cwd, root,
    settings: (value: unknown) => put(join(agentDir, "settings.json"), JSON.stringify(value)),
    subagentsJson: (value: unknown) => put(join(agentDir, "subagents.json"), JSON.stringify(value)),
    projectSubagentsJson: (value: unknown) => put(join(cwd, ".pi", "subagents.json"), JSON.stringify(value)),
    handles: () => paneSubagents("pi", cwd, home).map((agent) => agent.handle),
  };
}

describe("paneSubagents", () => {
  it("offers pi-subagents' default agents under their handles", () => {
    const { settings, home, cwd } = setup();
    settings({ packages: [`${SUBAGENTS}@0.22.0`] });
    const agents = paneSubagents("pi", cwd, home);
    expect(agents.map((agent) => agent.handle)).toEqual(["general-purpose", "explore", "plan"]);
    expect(agents.find((agent) => agent.handle === "plan")?.description).toStartWith("Software architect agent for designing implementation plans.");
    for (const agent of agents) expect(agent.handle).toMatch(/^[\w-]+$/);
  });

  it("offers nothing without the package entry", () => {
    const { settings, handles } = setup();
    expect(handles()).toEqual([]);
    settings({ packages: [] });
    expect(handles()).toEqual([]);
  });

  it("offers nothing when the package is not installed", () => {
    const { settings, root, handles } = setup();
    settings({ packages: [SUBAGENTS] });
    rmSync(root, { recursive: true });
    expect(handles()).toEqual([]);
  });

  it("offers nothing when the entry filters src/index.ts out", () => {
    const { settings, handles } = setup();
    settings({ packages: [{ source: SUBAGENTS, extensions: [] }] });
    expect(handles()).toEqual([]);
    settings({ packages: [{ source: SUBAGENTS, extensions: ["-src/index.ts"] }] });
    expect(handles()).toEqual([]);
  });

  it("offers nothing with agentMentions off, the project's subagents.json before the global one", () => {
    const { settings, subagentsJson, projectSubagentsJson, handles } = setup();
    settings({ packages: [SUBAGENTS] });
    subagentsJson({ agentMentions: "off" });
    expect(handles()).toEqual([]);
    subagentsJson({ agentMentions: false });
    expect(handles()).toEqual([]);
    projectSubagentsJson({ agentMentions: "direct" });
    expect(handles()).toHaveLength(3);
    subagentsJson({ agentMentions: true });
    projectSubagentsJson({ agentMentions: false });
    expect(handles()).toEqual([]);
    projectSubagentsJson({ agentMentions: "bogus" });
    expect(handles()).toHaveLength(3);
  });

  it("drops the defaults with disableDefaultAgents", () => {
    const { settings, subagentsJson, projectSubagentsJson, handles } = setup();
    settings({ packages: [SUBAGENTS] });
    subagentsJson({ disableDefaultAgents: true });
    expect(handles()).toEqual([]);
    projectSubagentsJson({ disableDefaultAgents: false });
    expect(handles()).toHaveLength(3);
  });

  it("survives a broken subagents.json", () => {
    const { settings, agentDir, handles } = setup();
    settings({ packages: [SUBAGENTS] });
    put(join(agentDir, "subagents.json"), "{ not json");
    expect(handles()).toHaveLength(3);
  });

  it("adds the agents an installed package declares, as packageAgents admits them", () => {
    const { settings, agentDir, subagentsJson, home, cwd, handles } = setup();
    const acme = join(agentDir, "npm", "node_modules", "@acme", "crew");
    put(join(acme, "package.json"), JSON.stringify({ name: "@acme/crew", pi: { subagents: { agents: ["./agents"] } } }));
    put(join(acme, "agents", "reviewer.md"), "---\ndescription: Reviews a diff.\n---\nYou review.\n");
    settings({ packages: [SUBAGENTS, "npm:@acme/crew@1.0.0"] });
    expect(handles()).toEqual(["general-purpose", "explore", "plan", "reviewer"]);
    expect(paneSubagents("pi", cwd, home).at(-1)).toEqual({ handle: "reviewer", description: "Reviews a diff." });
    for (const gate of [false, [], "", ["other"]]) {
      subagentsJson({ packageAgents: gate });
      expect(handles()).not.toContain("reviewer");
    }
    for (const gate of [true, "crew", ["CREW"], ["@acme/crew"], [" npm:@acme/crew@1.0.0 "]]) {
      subagentsJson({ packageAgents: gate });
      expect(handles()).toContain("reviewer");
    }
  });

  it("reads every manifest spelling, pi.subagents before pi-subagents, and no undeclared agents folder", () => {
    const { settings, agentDir, handles } = setup();
    const make = (name: string, manifest: Record<string, unknown>, agent: string) => {
      const root = join(agentDir, "npm", "node_modules", name);
      put(join(root, "package.json"), JSON.stringify({ name, ...manifest }));
      put(join(root, "agents", `${agent}.md`), `---\ndescription: ${agent}\n---\n`);
      put(join(root, "other", `${agent}-other.md`), `---\ndescription: ${agent}\n---\n`);
      return `npm:${name}`;
    };
    settings({ packages: [SUBAGENTS,
      make("short", { pi: { subagents: ["./agents"] } }, "one"),
      make("top", { "pi-subagents": { agents: ["./agents"] } }, "two"),
      make("top-short", { "pi-subagents": ["./agents"] }, "three"),
      make("both", { pi: { subagents: ["./agents"] }, "pi-subagents": ["./other"] }, "four"),
      make("none", { pi: { skills: [] } }, "five"),
    ] });
    expect(handles()).toEqual(["general-purpose", "explore", "plan", "one", "two", "three", "four"]);
  });

  it("keeps declared paths inside the package, takes single files and honours exclusions", () => {
    const { settings, agentDir, handles } = setup();
    const root = join(agentDir, "npm", "node_modules", "crew");
    put(join(root, "package.json"), JSON.stringify({ name: "crew", pi: { subagents: ["./agents", "!./agents/wip.md", "./extra/solo.md", "./extra/notes.txt", "../outside", "./missing"] } }));
    put(join(root, "agents", "kept.md"), "---\ndescription: kept\n---\n");
    put(join(root, "agents", "wip.md"), "---\ndescription: wip\n---\n");
    put(join(root, "extra", "solo.md"), "---\ndescription: solo\n---\n");
    put(join(root, "extra", "notes.txt"), "---\ndescription: notes\n---\n");
    put(join(root, "..", "outside", "escape.md"), "---\ndescription: escape\n---\n");
    put(join(root, "agents", "huge.md"), `---\ndescription: huge\n---\n${"x".repeat(1_048_577)}`);
    settings({ packages: [SUBAGENTS, "npm:crew"] });
    expect(handles()).toEqual(["general-purpose", "explore", "plan", "kept", "solo"]);
  });

  it("reads project packages only in a trusted project", () => {
    const { settings, cwd, handles } = setup();
    const root = join(cwd, ".pi", "npm", "node_modules", "crew");
    put(join(root, "package.json"), JSON.stringify({ name: "crew", pi: { subagents: ["./agents"] } }));
    put(join(root, "agents", "local.md"), "---\ndescription: local\n---\n");
    put(join(cwd, ".pi", "settings.json"), JSON.stringify({ packages: ["npm:crew"] }));
    settings({ packages: [SUBAGENTS] });
    expect(handles()).not.toContain("local");
    settings({ packages: [SUBAGENTS], defaultProjectTrust: "always" });
    expect(handles()).toContain("local");
  });

  it("loads the agent folders without trust, project before workspace before global before packages", () => {
    const { settings, agentDir, cwd, home } = setup();
    const root = join(agentDir, "npm", "node_modules", "crew");
    put(join(root, "package.json"), JSON.stringify({ name: "crew", pi: { subagents: ["./agents"] } }));
    const agent = (dir: string, file: string, text: string) => put(join(dir, `${file}.md`), `---\ndescription: ${text}\n---\n`);
    for (const name of ["a", "b", "c", "d"]) agent(join(root, "agents"), name, `${name} from package`);
    for (const name of ["b", "c", "d"]) agent(join(agentDir, "agents"), name, `${name} from global`);
    for (const name of ["c", "d"]) agent(join(cwd, ".agents", "agents"), name, `${name} from workspace`);
    agent(join(cwd, ".pi", "agents"), "d", "d from project");
    agent(join(cwd, ".pi", "agents"), "e", "e from project");
    settings({ packages: [SUBAGENTS, "npm:crew"] });
    expect(paneSubagents("pi", cwd, home).slice(3)).toEqual([
      { handle: "a", description: "a from package" },
      { handle: "b", description: "b from global" },
      { handle: "c", description: "c from workspace" },
      { handle: "d", description: "d from project" },
      { handle: "e", description: "e from project" },
    ]);
  });

  it("names an agent by its frontmatter, drops disabled ones, main and names with a colon", () => {
    const { settings, agentDir, cwd, home } = setup();
    const dir = join(agentDir, "agents");
    put(join(dir, "file-name.md"), "---\nname: Code Reviewer\ndescription: Reviews code.\n---\n");
    put(join(dir, "plan.md"), "---\nname: Plan\nenabled: false\n---\n");
    put(join(dir, "main.md"), "---\ndescription: The main one.\n---\n");
    put(join(dir, "scoped.md"), "---\nname: crew:reviewer\ndescription: Scoped.\n---\n");
    put(join(dir, "bare.md"), "Just a prompt, no frontmatter.\n");
    put(join(dir, "empty.md"), "---\nname: Quiet One\ndescription: \"\"\n---\n");
    settings({ packages: [SUBAGENTS] });
    expect(paneSubagents("pi", cwd, home).slice(2)).toEqual([
      { handle: "bare", description: "bare" },
      { handle: "quiet-one", description: "Quiet One" },
      { handle: "code-reviewer", description: "Reviews code." },
    ]);
  });

  it("lists each handle once, the first agent in registry order keeping it", () => {
    const { settings, agentDir, cwd, home } = setup();
    const dir = join(agentDir, "agents");
    put(join(dir, "explore.md"), "---\ndescription: Lowercase explore.\n---\n");
    put(join(dir, "x.md"), "---\nname: Code Reviewer\ndescription: First.\n---\n");
    put(join(dir, "y.md"), "---\nname: code-reviewer\ndescription: Second.\n---\n");
    settings({ packages: [SUBAGENTS] });
    const agents = paneSubagents("pi", cwd, home);
    expect(agents.map((agent) => agent.handle)).toEqual(["general-purpose", "explore", "plan", "code-reviewer"]);
    expect(agents[1]?.description).toStartWith("Fast read-only search agent");
    expect(agents[3]?.description).toBe("First.");
  });

  it("lets an agent file override a default in its place", () => {
    const { settings, agentDir, handles, cwd, home } = setup();
    put(join(agentDir, "agents", "Explore.md"), "---\ndescription: My explorer.\n---\n");
    settings({ packages: [SUBAGENTS] });
    expect(handles()).toEqual(["general-purpose", "explore", "plan"]);
    expect(paneSubagents("pi", cwd, home)[1]?.description).toBe("My explorer.");
    put(join(agentDir, "agents", "Explore.md"), "---\nenabled: false\n---\n");
    expect(handles()).toEqual(["general-purpose", "plan"]);
  });

  it("is empty for agents that route no @handle", () => {
    const { settings, home, cwd } = setup();
    settings({ packages: [SUBAGENTS] });
    expect(paneSubagents("claude", cwd, home)).toEqual([]);
    expect(paneSubagents(null, cwd, home)).toEqual([]);
    expect(paneSubagents("nope", cwd, home)).toEqual([]);
  });
});

describe("piRunsSubagents", () => {
  const runs = (home: string, cwd: string) => piRunsSubagents(readPiConfig({ home, cwd, repoRoot: null, env: null, roots: {} }));

  it("is true only while pi loads the pi-subagents extension", () => {
    const { settings, root, home, cwd } = setup();
    expect(runs(home, cwd)).toBe(false);
    settings({ packages: [`${SUBAGENTS}@0.22.0`] });
    expect(runs(home, cwd)).toBe(true);
    settings({ packages: [{ source: SUBAGENTS, extensions: [] }] });
    expect(runs(home, cwd)).toBe(false);
    settings({ packages: [SUBAGENTS] });
    rmSync(root, { recursive: true });
    expect(runs(home, cwd)).toBe(false);
  });

  it("ignores agentMentions: off silences the menu, not the extension", () => {
    const { settings, subagentsJson, home, cwd } = setup();
    settings({ packages: [SUBAGENTS] });
    subagentsJson({ agentMentions: "off" });
    expect(runs(home, cwd)).toBe(true);
  });
});
