import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { paneCommands } from "../commands.ts";
import { readPiConfig } from "./pi-config.ts";
import { piLoadsExtension } from "./pi-resources.ts";

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
  const root = mkdtempSync(join(tmpdir(), "pi-packages-"));
  roots.push(root);
  return root;
}
function put(path: string, content: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}
const skill = (root: string, name: string, description = `${name} skill`) => put(join(root, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\nbody\n`);
const prompt = (root: string, name: string, description = `${name} prompt`) => put(join(root, `${name}.md`), `---\ndescription: ${description}\n---\nbody\n`);
const manifest = (root: string, pi: unknown) => put(join(root, "package.json"), JSON.stringify({ name: "fixture", pi }));
/** an npm package's package.json without a pi key: pi counts an npm package without one not installed */
const npmPackage = (root: string) => put(join(root, "package.json"), JSON.stringify({ name: basename(root), version: "1.0.0" }));
const extra = (home: string, cwd: string | null = null) => paneCommands("pi", cwd, home).filter((command) => command.source !== "builtin");
const names = (home: string, cwd: string | null = null) => extra(home, cwd).map((command) => command.name).sort();

/** a home with pi's agent dir, and a trusted-on-demand project */
function setup(): { home: string; agentDir: string; repo: string; cwd: string; settings: (value: unknown) => void; project: (value: unknown) => void; trust: () => void } {
  const home = temp();
  process.env.HOME = home;
  delete process.env["PI_CODING_AGENT_DIR"];
  const agentDir = join(home, ".pi", "agent");
  const repo = join(temp(), "repo");
  mkdirSync(join(repo, ".git"), { recursive: true });
  return {
    home, agentDir, repo, cwd: repo,
    settings: (value) => put(join(agentDir, "settings.json"), JSON.stringify(value)),
    project: (value) => put(join(repo, ".pi", "settings.json"), JSON.stringify(value)),
    trust: () => put(join(agentDir, "trust.json"), JSON.stringify({ [repo]: true })),
  };
}

/** The agent-skills manifest's shape: a folder less some skills, a second folder, prompts by glob. */
function agentSkills(root: string): void {
  manifest(root, {
    skills: ["./skills", "!skills/using-agent-skills", "!skills/spec-driven-development", "./pi/skills"],
    prompts: ["./pi/prompts/*.md"],
    subagents: { agents: ["./agents"] },
  });
  skill(join(root, "skills"), "using-agent-skills");
  skill(join(root, "skills"), "spec-driven-development");
  skill(join(root, "skills"), "test-driven-development");
  skill(join(root, "pi", "skills"), "as-spec");
  prompt(join(root, "pi", "prompts"), "flow");
  prompt(join(root, "pi", "prompts", "drafts"), "draft");
  prompt(join(root, "prompts"), "stray");
}

describe("pi's package sources", () => {
  it("loads an npm package from <agentDir>/npm/node_modules, its skills and prompts as plugin rows", () => {
    const { home, agentDir, settings } = setup();
    settings({ packages: ["npm:@scope/tools@1.2.3"] });
    const root = join(agentDir, "npm", "node_modules", "@scope", "tools");
    npmPackage(root);
    skill(join(root, "skills"), "lint");
    prompt(join(root, "prompts"), "review");
    const rows = extra(home);
    expect(rows).toContainEqual({ name: "skill:lint", description: "lint skill", source: "skill", origin: "plugin" });
    expect(rows).toContainEqual({ name: "review", description: "review prompt", source: "plugin" });
  });

  it("loads git packages from <agentDir>/git/<host>/<path>, in scp and https form", () => {
    const { home, agentDir, settings } = setup();
    settings({ packages: ["git:git@github.com:owner/repo.git", "https://gitlab.com/group/other", "git:codeberg.org/someone/third@v1.0"] });
    skill(join(agentDir, "git", "github.com", "owner", "repo", "skills"), "from-scp");
    skill(join(agentDir, "git", "gitlab.com", "group", "other", "skills"), "from-https");
    skill(join(agentDir, "git", "codeberg.org", "someone", "third", "skills"), "from-shorthand");
    expect(names(home)).toEqual(["skill:from-https", "skill:from-scp", "skill:from-shorthand"]);
  });

  it("resolves a local package against the folder of its settings file", () => {
    const { home, agentDir, repo, cwd, settings, project, trust } = setup();
    settings({ packages: ["../shared"] });
    project({ packages: ["./vendored"] });
    trust();
    skill(join(agentDir, "..", "shared", "skills"), "user-local");
    prompt(join(repo, ".pi", "vendored", "prompts"), "project-local");
    expect(names(home, cwd)).toEqual(["project-local", "skill:user-local"]);
  });

  it("loads a trusted project's packages from <cwd>/.pi/npm and <cwd>/.pi/git, and none without trust", () => {
    const { home, repo, cwd, project, trust } = setup();
    project({ packages: ["npm:proj-tools", "git:github.com/owner/proj"] });
    npmPackage(join(repo, ".pi", "npm", "node_modules", "proj-tools"));
    skill(join(repo, ".pi", "npm", "node_modules", "proj-tools", "skills"), "proj-npm");
    skill(join(repo, ".pi", "git", "github.com", "owner", "proj", "skills"), "proj-git");
    expect(names(home, cwd)).toEqual([]);
    trust();
    expect(names(home, cwd)).toEqual(["skill:proj-git", "skill:proj-npm"]);
  });
});

describe("pi's package resources", () => {
  it("takes only the manifest's skills and prompts from a string entry (the agent-skills shape)", () => {
    const { home, agentDir, settings } = setup();
    settings({ packages: ["git:git@github.com:aNNdii/agent-skills"] });
    agentSkills(join(agentDir, "git", "github.com", "aNNdii", "agent-skills"));
    const listed = names(home);
    expect(listed).toContain("skill:as-spec");
    expect(listed).toContain("skill:test-driven-development");
    expect(listed).toContain("flow");
    expect(listed).not.toContain("skill:using-agent-skills");
    expect(listed).not.toContain("skill:spec-driven-development");
    expect(listed).not.toContain("draft");
    expect(listed).not.toContain("stray");
  });

  it("gives nothing of a kind the manifest leaves out, though the package has its folder", () => {
    const { home, agentDir, settings } = setup();
    settings({ packages: ["npm:skills-only"] });
    const root = join(agentDir, "npm", "node_modules", "skills-only");
    manifest(root, { skills: ["./skills"] });
    skill(join(root, "skills"), "kept");
    prompt(join(root, "prompts"), "ignored");
    expect(names(home)).toEqual(["skill:kept"]);
  });

  it("takes the skills and prompts folders of a package without a pi key", () => {
    const { home, agentDir, settings } = setup();
    settings({ packages: ["npm:plain"] });
    const root = join(agentDir, "npm", "node_modules", "plain");
    put(join(root, "package.json"), JSON.stringify({ name: "plain" }));
    skill(join(root, "skills"), "folder-skill");
    prompt(join(root, "prompts", "nested"), "deep");
    expect(names(home)).toEqual(["deep", "skill:folder-skill"]);
  });

  it("filters per kind in an object entry: [] for none, ! and - out, globs in, the manifest or the folder without a filter", () => {
    const { home, agentDir, settings } = setup();
    const root = join(agentDir, "git", "github.com", "aNNdii", "agent-skills");
    agentSkills(root);
    settings({ packages: [{ source: "git:github.com/aNNdii/agent-skills", skills: [] }] });
    expect(names(home)).toEqual(["flow"]);
    settings({ packages: [{ source: "git:github.com/aNNdii/agent-skills", prompts: ["!flow.md"], skills: ["pi/skills/*"] }] });
    expect(names(home)).toEqual(["skill:as-spec"]);
    settings({ packages: [{ source: "git:github.com/aNNdii/agent-skills", skills: ["-pi/skills/as-spec", "+skills/using-agent-skills"] }] });
    expect(names(home)).toEqual(["flow", "skill:test-driven-development"]);
    manifest(root, { skills: ["./skills"] });
    settings({ packages: [{ source: "git:github.com/aNNdii/agent-skills", skills: ["!*"] }] });
    expect(names(home)).toEqual(["stray"]);
  });

  it("lets a trusted project package win a skill name over two user packages, else the first user package", () => {
    const { home, agentDir, repo, cwd, settings, project, trust } = setup();
    settings({ packages: ["npm:first", "npm:second"] });
    project({ packages: ["npm:third"] });
    for (const [base, name] of [[agentDir, "first"], [agentDir, "second"], [join(repo, ".pi"), "third"]] as const) {
      const root = join(base, "npm", "node_modules", name);
      npmPackage(root);
      skill(join(root, "skills"), "same", `from ${name}`);
    }
    expect(extra(home, cwd)).toEqual([{ name: "skill:same", description: "from first", source: "skill", origin: "plugin" }]);
    trust();
    expect(extra(home, cwd)).toEqual([{ name: "skill:same", description: "from third", source: "skill", origin: "plugin" }]);
  });

  it("lets a user folder skill win over a package skill of the same name", () => {
    const { home, agentDir, settings } = setup();
    settings({ packages: ["npm:dup"] });
    npmPackage(join(agentDir, "npm", "node_modules", "dup"));
    skill(join(agentDir, "npm", "node_modules", "dup", "skills"), "same", "from the package");
    skill(join(agentDir, "skills"), "same", "from the user");
    expect(extra(home)).toEqual([{ name: "skill:same", description: "from the user", source: "skill", origin: "user" }]);
  });
});

describe("pi's package scopes", () => {
  it("replaces the user's entry with a trusted project's entry of the same identity", () => {
    const { home, agentDir, repo, cwd, settings, project, trust } = setup();
    settings({ packages: ["npm:shared@1"] });
    project({ packages: ["npm:shared@2"] });
    for (const base of [agentDir, join(repo, ".pi")]) npmPackage(join(base, "npm", "node_modules", "shared"));
    skill(join(agentDir, "npm", "node_modules", "shared", "skills"), "user-copy");
    skill(join(repo, ".pi", "npm", "node_modules", "shared", "skills"), "project-copy");
    expect(names(home, cwd)).toEqual(["skill:user-copy"]);
    trust();
    expect(names(home, cwd)).toEqual(["skill:project-copy"]);
  });

  it("matches a git package across its scp and https forms", () => {
    const { home, agentDir, cwd, settings, project, trust } = setup();
    settings({ packages: ["git:git@github.com:owner/repo"] });
    project({ packages: [{ source: "https://github.com/owner/repo.git", skills: [] }] });
    trust();
    skill(join(agentDir, "git", "github.com", "owner", "repo", "skills"), "hidden");
    expect(names(home, cwd)).toEqual([]);
  });

  it("reads a project entry with autoload: false as a delta on the user's entry", () => {
    const { home, agentDir, cwd, settings, project, trust } = setup();
    const root = join(agentDir, "git", "github.com", "aNNdii", "agent-skills");
    agentSkills(root);
    settings({ packages: ["git:git@github.com:aNNdii/agent-skills"] });
    project({ packages: [{ source: "git:github.com/aNNdii/agent-skills", autoload: false, skills: ["-pi/skills/as-spec"] }] });
    trust();
    expect(names(home, cwd)).toEqual(["flow", "skill:test-driven-development"]);
  });

  it("loads only what a lone autoload: false entry names", () => {
    const { home, agentDir, settings } = setup();
    const root = join(agentDir, "git", "github.com", "aNNdii", "agent-skills");
    agentSkills(root);
    settings({ packages: [{ source: "git:github.com/aNNdii/agent-skills", autoload: false, prompts: ["+pi/prompts/flow.md"] }] });
    expect(names(home)).toEqual(["flow"]);
  });
});

describe("pi's broken packages", () => {
  it("skips a package that is not installed, an entry without a source, and a broken link", () => {
    const { home, agentDir, settings } = setup();
    settings({ packages: ["npm:missing", "git:github.com/owner/absent", { skills: [] }, 42, "npm:linked"] });
    const root = join(agentDir, "npm", "node_modules", "linked");
    npmPackage(root);
    skill(join(root, "skills"), "alive");
    symlinkSync(join(root, "nowhere"), join(root, "skills", "dead"));
    expect(names(home)).toEqual(["skill:alive"]);
    expect(paneCommands("pi", null, home).some((command) => command.name === "model")).toBe(true);
  });

  it("skips a package whose root is a dead link", () => {
    const { home, agentDir, settings } = setup();
    settings({ packages: ["npm:dead", "../dead-local", "npm:alive"] });
    const modules = join(agentDir, "npm", "node_modules");
    mkdirSync(modules, { recursive: true });
    symlinkSync(join(home, "nowhere"), join(modules, "dead"));
    symlinkSync(join(home, "nowhere"), join(agentDir, "..", "dead-local"));
    npmPackage(join(modules, "alive"));
    skill(join(modules, "alive", "skills"), "alive");
    expect(names(home)).toEqual(["skill:alive"]);
  });

  it("still lists the builtins and the folders when settings.json does not parse", () => {
    const { home, agentDir } = setup();
    put(join(agentDir, "settings.json"), "{ \"packages\": [");
    skill(join(agentDir, "skills"), "own");
    const commands = paneCommands("pi", null, home);
    expect(commands.filter((command) => command.source === "builtin").map((command) => command.name)).toContain("model");
    expect(names(home)).toEqual(["skill:own"]);
  });

  it("skips an npm package whose package.json is missing or does not parse, which pi counts as not installed", () => {
    const { home, agentDir, settings } = setup();
    settings({ packages: ["npm:broken", "npm:bare"] });
    const broken = join(agentDir, "npm", "node_modules", "broken");
    put(join(broken, "package.json"), "{ not json");
    skill(join(broken, "skills"), "from-broken");
    skill(join(agentDir, "npm", "node_modules", "bare", "skills"), "from-bare");
    expect(names(home)).toEqual([]);
  });

  it("falls back to the folders of a git or local package whose package.json does not parse", () => {
    const { home, agentDir, settings } = setup();
    settings({ packages: ["git:github.com/owner/broken", "../local-broken"] });
    const git = join(agentDir, "git", "github.com", "owner", "broken");
    const local = join(agentDir, "..", "local-broken");
    for (const root of [git, local]) put(join(root, "package.json"), "{ not json");
    skill(join(git, "skills"), "git-survivor");
    skill(join(local, "skills"), "local-survivor");
    expect(names(home)).toEqual(["skill:git-survivor", "skill:local-survivor"]);
  });
});

describe("piLoadsExtension", () => {
  const SUBAGENTS = "npm:@tintinweb/pi-subagents";
  function subagents(): { home: string; cwd: string; agentDir: string; settings: (value: unknown) => void; project: (value: unknown) => void; trust: () => void; loads: () => boolean } {
    const fixture = setup();
    const root = join(fixture.agentDir, "npm", "node_modules", "@tintinweb", "pi-subagents");
    manifest(root, { extensions: ["./src/index.ts"] });
    put(join(root, "src", "index.ts"), "export default () => {};\n");
    const loads = () => piLoadsExtension(readPiConfig({ home: fixture.home, cwd: fixture.cwd, repoRoot: null, env: null, roots: {} }), SUBAGENTS, "src/index.ts");
    return { ...fixture, loads };
  }

  it("is true for an installed package entry that keeps its extension", () => {
    const { settings, loads } = subagents();
    settings({ packages: ["npm:@tintinweb/pi-subagents@0.22.0"] });
    expect(loads()).toBe(true);
  });

  it("is false without the package entry, or when it is not installed", () => {
    const { agentDir, settings, loads } = subagents();
    settings({ packages: [] });
    expect(loads()).toBe(false);
    settings({ packages: [SUBAGENTS] });
    rmSync(join(agentDir, "npm"), { recursive: true });
    expect(loads()).toBe(false);
  });

  it("is false when the package's package.json does not parse, as pi then counts it not installed", () => {
    const { agentDir, settings, loads } = subagents();
    settings({ packages: [SUBAGENTS] });
    const root = join(agentDir, "npm", "node_modules", "@tintinweb", "pi-subagents");
    // the extensions folder a git or local package would fall back to holds the same entry
    symlinkSync("src", join(root, "extensions"));
    expect(loads()).toBe(true);
    put(join(root, "package.json"), "{ not json");
    expect(loads()).toBe(false);
  });

  it("is false when the entry filters the extension out", () => {
    const { settings, loads } = subagents();
    settings({ packages: [{ source: SUBAGENTS, extensions: [] }] });
    expect(loads()).toBe(false);
    settings({ packages: [{ source: SUBAGENTS, extensions: ["-src/index.ts"] }] });
    expect(loads()).toBe(false);
    settings({ packages: [{ source: SUBAGENTS, skills: [] }] });
    expect(loads()).toBe(true);
  });

  it("follows a trusted project's delta on the user's entry", () => {
    const { settings, project, trust, loads } = subagents();
    settings({ packages: [SUBAGENTS] });
    project({ packages: [{ source: SUBAGENTS, autoload: false, extensions: ["-src/index.ts"] }] });
    expect(loads()).toBe(true);
    trust();
    expect(loads()).toBe(false);
  });
});
