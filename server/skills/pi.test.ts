import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { paneCommands } from "../commands.ts";
import { source } from "./pi.ts";
import type { SlashCommand } from "../../shared/protocol.ts";
import { typedTerminalCommand } from "../../src/lib/compose.ts";

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
  const root = mkdtempSync(join(tmpdir(), "pi-skills-"));
  roots.push(root);
  return root;
}
function put(path: string, content: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}
const skill = (root: string, name: string, description = `${name} skill`) => put(join(root, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\nbody\n`);
const scan = (home: string, cwd: string | null) => source.discover({ home, cwd, repoRoot: null, env: null, roots: {} }).sort((left, right) => left.name.localeCompare(right.name));
// fork: the bundled /llama and /mcp come from the scan too
const extra = (home: string, cwd: string | null) => scan(home, cwd).filter((command) => command.source !== "builtin");
const names = (home: string, cwd: string | null) => extra(home, cwd).map((command) => command.name);

/** a home, and a project that is a repository with a pane working in a subfolder of it */
function setup(): { home: string; repo: string; cwd: string; agentDir: string } {
  const home = temp();
  process.env.HOME = home;
  const repo = join(temp(), "repo");
  mkdirSync(join(repo, ".git"), { recursive: true });
  const cwd = join(repo, "packages", "app");
  mkdirSync(cwd, { recursive: true });
  return { home, repo, cwd, agentDir: join(home, ".pi", "agent") };
}

const builtinNames = (home: string, cwd: string | null = null) => paneCommands("pi", cwd, home).filter((command) => command.source === "builtin").map((command) => command.name);

describe("pi's builtins", () => {
  it("lists every 1.3.0 name, and the bundled /llama and /mcp", () => {
    const { home } = setup();
    const commands = builtinNames(home);
    expect(commands.sort()).toEqual([...source.builtins, "llama", "mcp"].sort());
  });

  it("matches the pinned builtin names and descriptions", () => {
    const upstream = [
      ["settings", "Open settings menu"],
      ["model", "Select model (opens selector UI)"],
      ["tree", "Navigate session tree (switch branches)"],
      ["thinking", "Set thinking level"],
      ["scoped-models", "Enable/disable models for Ctrl+P cycling"],
      ["export", "Export session (HTML default, or specify path: .html/.jsonl)"],
      ["import", "Import and resume a session from a JSONL file"],
      ["share", "Share session via a Radius artifact or a GitHub gist"],
      ["bug", "Report a bug to the Pi developers"],
      ["copy", "Copy last agent message to clipboard"],
      ["name", "Set session display name"],
      ["session", "Show session info and stats"],
      ["changelog", "Show changelog entries"],
      ["hotkeys", "Show all keyboard shortcuts"],
      ["fork", "Create a new fork from a previous user message"],
      ["clone", "Duplicate the current session at the current position"],
      ["trust", "Save project trust decision for future sessions"],
      ["login", "Configure provider authentication"],
      ["logout", "Remove provider authentication"],
      ["new", "Start a new session"],
      ["compact", "Manually compact the session context"],
      ["resume", "Resume a different session"],
      ["reload", "Reload keybindings, extensions, skills, prompts, themes, and context files"],
      ["quit", "Quit pi"],
    ] as const;
    expect(source.builtins).toEqual(upstream.map(([name]) => name));
    expect(Object.fromEntries(source.builtins.map((name) => [name, source.descriptions?.[name]]))).toEqual(Object.fromEntries(upstream));
  });

  it("defines the canonical 24 builtins with forms, including terminal tree", () => {
    expect(source.builtins).toEqual([
      "settings", "model", "tree", "thinking", "scoped-models", "export", "import", "share", "bug", "copy",
      "name", "session", "changelog", "hotkeys", "fork", "clone", "trust", "login", "logout", "new",
      "compact", "resume", "reload", "quit",
    ]);
    expect(source.terminalBound).toEqual(["tree"]);
    expect(source.forms?.["tree"]).toEqual([{ match: "bare", interaction: "terminal" }]);
    expect(source.forms?.["model"]).toEqual([
      { match: "bare", interaction: "dialog", dialog: "pi-model" },
      { match: "other", interaction: "none" },
    ]);
    expect(source.forms?.["thinking"]).toEqual([
      { match: "bare", interaction: "dialog", dialog: "pi-thinking" },
      { match: "other", interaction: "none" },
    ]);
  });

  it("keeps bare logout terminal-bound when OAuth credentials can open its selector", () => {
    expect(source.forms?.["logout"]?.[0]).toEqual({ match: "bare", interaction: "terminal" });
  });

  it("uses the canonical share description from pi's builtin command table", () => {
    expect(source.descriptions?.["share"]).toBe("Share session via a Radius artifact or a GitHub gist");
  });

  it("marks bare share, bug, copy and name output terminal when it is not persisted", () => {
    for (const name of ["share", "bug", "copy", "name"]) {
      expect(source.forms?.[name]?.[0]).toEqual({ match: "bare", interaction: "terminal" });
    }
    expect(source.forms?.["bug"]?.[1]).toEqual({ match: "other", interaction: "terminal" });
    expect(source.forms?.["name"]?.[1]).toEqual({ match: "other", interaction: "none" });
  });

  it("keeps reload and quit terminal because neither leaves bridge-readable result evidence", () => {
    expect(source.forms?.["reload"]).toEqual([{ match: "bare", interaction: "terminal" }]);
    expect(source.forms?.["quit"]).toEqual([{ match: "bare", interaction: "terminal" }]);
  });

  it("keeps new and clone unknown until an empty session has a persisted conversation", () => {
    expect(source.forms?.["new"]).toEqual([{ match: "bare", interaction: "unknown" }]);
    expect(source.forms?.["clone"]).toEqual([{ match: "bare", interaction: "unknown" }]);
  });

  it("limits none forms to effects recorded in the session or persisted state", () => {
    const noneForms = Object.fromEntries(Object.entries(source.forms ?? {})
      .map(([name, forms]) => [name, (forms ?? []).filter((form) => form.interaction === "none")] as const)
      .filter(([, forms]) => forms.length > 0));
    expect(noneForms).toEqual({
      model: [{ match: "other", interaction: "none" }],
      thinking: [{ match: "other", interaction: "none" }],
      compact: [{ match: "bare", interaction: "none" }],
      name: [{ match: "other", interaction: "none" }],
    });
  });

  it("pins builtins to Pi 1.3 and verifies only a matching major-minor version", () => {
    expect(source.pin).toBe("1.3.0");
    // fork: the bundled /llama and /mcp are builtin rows too, but found by a scan of pi's settings
    const pinned = (version: string) => paneCommands("pi", null, temp(), {}, version).filter((row) => row.source === "builtin" && source.builtins.includes(row.name));
    expect(pinned("1.3.9").every((row) => row.provenance?.verified)).toBeTrue();
    expect(pinned("1.4.0").some((row) => row.provenance?.verified)).toBeFalse();
  });

  it("compiles the scanner forms and terminal-bound names into catalog rows", () => {
    const rows = paneCommands("pi", null, temp());
    expect(rows.find(({ name }) => name === "tree")).toMatchObject({
      visibility: "terminal",
      forms: [{ match: "bare", interaction: "terminal" }],
    });
    expect(rows.find(({ name }) => name === "model")?.forms).toEqual(source.forms?.["model"]);
  });

  it("describes the bundled /llama and /mcp the way pi does", () => {
    const { home } = setup();
    const described = Object.fromEntries(paneCommands("pi", null, home).map((command) => [command.name, command.description]));
    expect(described["llama"]).toBe("Manage llama.cpp router models");
    expect(described["mcp"]).toBe("Manage MCP servers: sign in, reconnect, enable or disable, and change exposure");
  });

  it("drops /llama and /mcp that the user's extensions exclude with - or !", () => {
    const { home, agentDir } = setup();
    put(join(agentDir, "settings.json"), JSON.stringify({ extensions: ["-builtin:mcp"] }));
    expect(builtinNames(home)).toContain("llama");
    expect(builtinNames(home)).not.toContain("mcp");
    put(join(agentDir, "settings.json"), JSON.stringify({ extensions: ["!builtin:llama.cpp"] }));
    expect(builtinNames(home)).not.toContain("llama");
    expect(builtinNames(home)).toContain("mcp");
  });

  it("lets a trusted project's + entry switch a bundled extension back on", () => {
    const { home, repo, cwd, agentDir } = setup();
    put(join(agentDir, "settings.json"), JSON.stringify({ extensions: ["-builtin:mcp", "-builtin:llama.cpp"] }));
    put(join(cwd, ".pi", "settings.json"), JSON.stringify({ extensions: ["+builtin:mcp"] }));
    expect(builtinNames(home, cwd)).not.toContain("mcp");
    put(join(agentDir, "trust.json"), JSON.stringify({ [repo]: true }));
    expect(builtinNames(home, cwd)).toContain("mcp");
    expect(builtinNames(home, cwd)).not.toContain("llama");
  });

  it("lets a trusted project switch one off that the user keeps", () => {
    const { home, repo, cwd, agentDir } = setup();
    put(join(agentDir, "trust.json"), JSON.stringify({ [repo]: true }));
    put(join(cwd, ".pi", "settings.json"), JSON.stringify({ extensions: ["!builtin:mcp"] }));
    expect(builtinNames(home, cwd)).not.toContain("mcp");
  });
});

describe("pi's skill commands switch", () => {
  const skillRows = (home: string, cwd: string | null) => names(home, cwd).filter((name) => name.startsWith("skill:"));

  it("drops every skill: row when a trusted project sets enableSkillCommands to false", () => {
    const { home, repo, cwd, agentDir } = setup();
    skill(join(agentDir, "skills"), "mine");
    put(join(agentDir, "settings.json"), JSON.stringify({ enableSkillCommands: true }));
    put(join(agentDir, "trust.json"), JSON.stringify({ [repo]: true }));
    put(join(cwd, ".pi", "settings.json"), JSON.stringify({ enableSkillCommands: false }));
    put(join(cwd, ".pi", "prompts", "ship.md"), "---\ndescription: Ship it\n---\n");
    expect(names(home, cwd)).toEqual(["ship"]);
  });

  it("honours the legacy skills.enableSkillCommands only without the top-level key", () => {
    const { home, agentDir } = setup();
    skill(join(agentDir, "skills"), "mine");
    put(join(agentDir, "settings.json"), JSON.stringify({ skills: { enableSkillCommands: false } }));
    expect(skillRows(home, null)).toEqual([]);
    put(join(agentDir, "settings.json"), JSON.stringify({ enableSkillCommands: true, skills: { enableSkillCommands: false } }));
    expect(skillRows(home, null)).toEqual(["skill:mine"]);
  });

  it("keeps the legacy skills.customDirectories as the skills list", () => {
    const { home, agentDir } = setup();
    skill(join(agentDir, "extra"), "listed");
    put(join(agentDir, "settings.json"), JSON.stringify({ skills: { customDirectories: ["extra"] } }));
    expect(skillRows(home, null)).toEqual(["skill:listed"]);
  });

  it("still lists a skill with disable-model-invocation", () => {
    const { home, agentDir } = setup();
    put(join(agentDir, "skills", "manual", "SKILL.md"), "---\nname: manual\ndescription: Only by hand\ndisable-model-invocation: true\n---\nbody\n");
    expect(skillRows(home, null)).toEqual(["skill:manual"]);
  });
});

describe("pi's user skills", () => {
  it("lists a nested skill from the agent dir and ~/.agents, as the person's own", () => {
    const { home, agentDir } = setup();
    skill(join(agentDir, "skills", "group", "inner"), "deep-one");
    skill(join(home, ".agents", "skills"), "shared");
    put(join(agentDir, "skills", "loose.md"), "---\nname: loose\ndescription: A loose root file\n---\n");
    put(join(agentDir, "skills", "group", "ignored.md"), "---\nname: nested-loose\ndescription: Not at the root\n---\n");
    expect(extra(home, null)).toMatchObject([
      { name: "skill:deep-one", description: "deep-one skill", source: "skill", origin: "user" },
      { name: "skill:loose", description: "A loose root file", source: "skill", origin: "user" },
      { name: "skill:shared", description: "shared skill", source: "skill", origin: "user" },
    ]);
  });

  it("skips a skill with no description, which pi does not load", () => {
    const { home, agentDir } = setup();
    put(join(agentDir, "skills", "bare", "SKILL.md"), "---\nname: bare\n---\nbody\n");
    expect(names(home, null)).toEqual([]);
  });

  it("takes the agent dir from the pane's environ", () => {
    const { home } = setup();
    const other = temp();
    skill(join(other, "skills"), "elsewhere");
    const commands = source.discover({ home, cwd: null, repoRoot: null, env: [`PI_CODING_AGENT_DIR=${other}`], roots: {} });
    expect(commands.filter((command) => command.source !== "builtin").map((command) => command.name)).toEqual(["skill:elsewhere"]);
  });
});

describe("pi's settings skills", () => {
  it("adds paths from the agent dir, honours -path and !glob, and +path adds nothing pi does not find", () => {
    const { home, agentDir } = setup();
    skill(join(agentDir, "skills"), "off-by-path");
    skill(join(agentDir, "skills"), "off-by-glob");
    skill(join(agentDir, "skills"), "stays");
    skill(join(agentDir, "extra", "pack"), "listed");
    skill(join(agentDir, "extra", "pack"), "dropped");
    skill(join(agentDir, "forced"), "forced-in");
    put(join(agentDir, "solo", "single.md"), "---\ndescription: One file\n---\n");
    put(join(agentDir, "settings.json"), JSON.stringify({ skills: ["extra/pack", "solo/single.md", "-skills/off-by-path", "!skills/off-by-glob/**", "!extra/pack/dropped/*", "+forced"] }));
    expect(names(home, null)).toEqual(["skill:listed", "skill:solo", "skill:stays"]);
  });

  it("names a single-file skill without name: after its folder", () => {
    const { home, agentDir } = setup();
    put(join(agentDir, "skills", "loose.md"), "---\ndescription: A loose root file\n---\n");
    expect(names(home, null)).toEqual(["skill:skills"]);
  });

  it("honours .gitignore, .ignore and .fdignore in a skills folder", () => {
    const { home, agentDir } = setup();
    skill(join(agentDir, "skills"), "kept");
    skill(join(agentDir, "skills"), "private");
    skill(join(agentDir, "skills", "group"), "drafted");
    put(join(agentDir, "skills", ".gitignore"), "private/\n");
    put(join(agentDir, "skills", "group", ".ignore"), "drafted\n");
    expect(names(home, null)).toEqual(["skill:kept"]);
  });
});

describe("pi's prompts settings", () => {
  it("adds folders (recursively) and files, honours !glob and -path, and +path adds nothing", () => {
    const { home, agentDir } = setup();
    put(join(agentDir, "prompts", "auto.md"), "---\ndescription: Auto\n---\n");
    put(join(agentDir, "prompts", "gone.md"), "---\ndescription: Gone\n---\n");
    put(join(agentDir, "library", "top.md"), "---\ndescription: Top\n---\n");
    put(join(agentDir, "library", "nested", "deep.md"), "---\ndescription: Deep\n---\n");
    put(join(agentDir, "library", "draft.md"), "---\ndescription: Draft\n---\n");
    put(join(agentDir, "one.md"), "---\ndescription: One\n---\n");
    put(join(agentDir, "forced", "forced.md"), "---\ndescription: Forced\n---\n");
    put(join(agentDir, "settings.json"), JSON.stringify({ prompts: ["library", "one.md", "!draft.md", "-prompts/gone.md", "+forced/forced.md"] }));
    expect(extra(home, null)).toEqual([
      { name: "auto", description: "Auto", source: "user" },
      { name: "deep", description: "Deep", source: "user" },
      { name: "one", description: "One", source: "user" },
      { name: "top", description: "Top", source: "user" },
    ]);
  });

  it("resolves a trusted project's skills and prompts against <cwd>/.pi", () => {
    const { home, repo, cwd, agentDir } = setup();
    skill(join(cwd, ".pi", "team"), "team-skill");
    put(join(cwd, "docs", "prompts", "brief.md"), "---\ndescription: Brief\n---\n");
    put(join(cwd, ".pi", "settings.json"), JSON.stringify({ skills: ["team"], prompts: ["../docs/prompts"] }));
    expect(names(home, cwd)).toEqual([]);
    put(join(agentDir, "trust.json"), JSON.stringify({ [repo]: true }));
    expect(extra(home, cwd)).toMatchObject([
      { name: "brief", description: "Brief", source: "project" },
      { name: "skill:team-skill", description: "team-skill skill", source: "skill", origin: "project" },
    ]);
  });
});

describe("pi's link loops", () => {
  it("walks past folder links back to an ancestor in skills and recursive prompts folders", () => {
    const { home, agentDir } = setup();
    skill(join(agentDir, "skills"), "steady");
    put(join(agentDir, "skills", "x", "group", "inner", "SKILL.md"), "---\nname: inner\ndescription: Inner skill\n---\n");
    symlinkSync(".", join(agentDir, "skills", "x", "a"));
    symlinkSync(".", join(agentDir, "skills", "x", "b"));
    put(join(agentDir, "prompts", "x", "deep.md"), "---\ndescription: Deep\n---\n");
    symlinkSync(".", join(agentDir, "prompts", "x", "a"));
    symlinkSync("..", join(agentDir, "prompts", "x", "b"));
    put(join(agentDir, "settings.json"), JSON.stringify({ prompts: ["prompts"] }));
    expect(extra(home, null)).toMatchObject([
      { name: "deep", description: "Deep", source: "user" },
      { name: "skill:inner", description: "Inner skill", source: "skill", origin: "user" },
      { name: "skill:steady", description: "steady skill", source: "skill", origin: "user" },
    ]);
  });
});

describe("pi's precedence", () => {
  type Place = "project settings" | "project folder" | "user settings" | "user folder";
  const ORDER: readonly Place[] = ["project settings", "project folder", "user settings", "user folder"];
  function plantEverywhere(places: readonly Place[]): { home: string; cwd: string } {
    const { home, repo, cwd, agentDir } = setup();
    put(join(agentDir, "trust.json"), JSON.stringify({ [repo]: true }));
    const roots: Record<Place, string> = {
      "project settings": join(cwd, ".pi", "listed"),
      "project folder": join(cwd, ".pi", "skills"),
      "user settings": join(agentDir, "listed"),
      "user folder": join(agentDir, "skills"),
    };
    const prompts: Record<Place, string> = {
      "project settings": join(cwd, ".pi", "listed-prompts"),
      "project folder": join(cwd, ".pi", "prompts"),
      "user settings": join(agentDir, "listed-prompts"),
      "user folder": join(agentDir, "prompts"),
    };
    for (const place of places) {
      skill(roots[place], "dup", place);
      put(join(prompts[place], "dup.md"), `---\ndescription: ${place}\n---\n`);
    }
    put(join(agentDir, "settings.json"), JSON.stringify({ skills: ["listed"], prompts: ["listed-prompts"] }));
    put(join(cwd, ".pi", "settings.json"), JSON.stringify({ skills: ["listed"], prompts: ["listed-prompts"] }));
    return { home, cwd };
  }

  it("lets project settings, project folder, user settings and user folder win in that order", () => {
    for (let index = 0; index < ORDER.length; index++) {
      const places = ORDER.slice(index);
      const { home, cwd } = plantEverywhere([...places].reverse());
      const rows = extra(home, cwd);
      expect(rows.filter((row) => row.name === "skill:dup").map((row) => row.description)).toEqual([places[0]!]);
      expect(rows.filter((row) => row.name === "dup").map((row) => row.description)).toEqual([places[0]!]);
    }
  });

  it("counts one file reached through two paths once, for the higher rank", () => {
    const { home, repo, cwd, agentDir } = setup();
    put(join(agentDir, "trust.json"), JSON.stringify({ [repo]: true }));
    put(join(cwd, ".pi", "prompts", "ship.md"), "---\ndescription: Ship it\n---\n");
    mkdirSync(join(agentDir, "prompts"), { recursive: true });
    symlinkSync(join(cwd, ".pi", "prompts", "ship.md"), join(agentDir, "prompts", "release.md"));
    expect(extra(home, cwd)).toEqual([{ name: "ship", description: "Ship it", source: "project" }]);
  });

  it("dedupes skills and prompts apart, and leaves the builtins alone", () => {
    const { home, agentDir } = setup();
    skill(join(agentDir, "skills"), "review");
    put(join(agentDir, "prompts", "review.md"), "---\ndescription: Review prompt\n---\n");
    put(join(agentDir, "prompts", "model.md"), "---\ndescription: Model prompt\n---\n");
    const rows = paneCommands("pi", null, home).map((command) => `${command.source}:${command.name}`);
    expect(rows).toContain("builtin:model");
    expect(rows).toContain("user:model");
    expect(rows).toContain("user:review");
    expect(rows).toContain("skill:skill:review");
  });
});

describe("pi's project skills and prompts", () => {
  function plant(repo: string, cwd: string): void {
    skill(join(repo, ".pi", "skills"), "repo-skill");
    skill(join(cwd, ".pi", "skills"), "cwd-skill");
    skill(join(repo, "packages", ".agents", "skills"), "agents-skill");
    put(join(cwd, ".pi", "prompts", "ship.md"), "---\ndescription: Ship it\n---\n");
  }

  it("lists none without a trust decision", () => {
    const { home, repo, cwd } = setup();
    plant(repo, cwd);
    expect(names(home, cwd)).toEqual([]);
  });

  it("lists <cwd>/.pi and every ancestor's .agents/skills to the repo root, once trust.json lists the repo", () => {
    const { home, repo, cwd, agentDir } = setup();
    plant(repo, cwd);
    put(join(repo, ".agents", "skills", "root-loose.md"), "---\nname: root-loose\ndescription: Not a skill at an .agents root\n---\n");
    put(join(repo, ".agents", "skills", "group", "nested-loose.md"), "---\nname: nested-loose\ndescription: A skill below an .agents root\n---\n");
    put(join(agentDir, "trust.json"), JSON.stringify({ [repo]: true }));
    expect(extra(home, cwd)).toMatchObject([
      { name: "ship", description: "Ship it", source: "project" },
      { name: "skill:agents-skill", description: "agents-skill skill", source: "skill", origin: "project" },
      { name: "skill:cwd-skill", description: "cwd-skill skill", source: "skill", origin: "project" },
      { name: "skill:nested-loose", description: "A skill below an .agents root", source: "skill", origin: "project" },
    ]);
  });

  it("lists them under defaultProjectTrust always, and a closer refusal wins over it", () => {
    const { home, repo, cwd, agentDir } = setup();
    plant(repo, cwd);
    put(join(agentDir, "settings.json"), JSON.stringify({ defaultProjectTrust: "always" }));
    expect(names(home, cwd)).toEqual(["ship", "skill:agents-skill", "skill:cwd-skill"]);
    put(join(agentDir, "trust.json"), JSON.stringify({ [repo]: false }));
    expect(names(home, cwd)).toEqual([]);
  });
});

describe("pi skill identity", () => {
  it("lists a skill reached through a symlinked alias root once, identified by its real file", () => {
    const { home, agentDir } = setup();
    delete process.env["PI_CODING_AGENT_DIR"];
    skill(join(agentDir, "skills"), "aliased");
    mkdirSync(join(home, ".agents"), { recursive: true });
    symlinkSync(join(agentDir, "skills"), join(home, ".agents", "skills"), "dir");
    const rows = paneCommands("pi", null, home).filter(({ name }) => name === "skill:aliased");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "skill", origin: "user", id: realpathSync(join(agentDir, "skills", "aliased", "SKILL.md")) });
  });

  it("identifies a skill a settings entry names through a link by its real file", () => {
    const { home, agentDir } = setup();
    delete process.env["PI_CODING_AGENT_DIR"];
    skill(join(agentDir, "skills"), "entry");
    symlinkSync(join(agentDir, "skills"), join(home, "linked"), "dir");
    put(join(agentDir, "settings.json"), JSON.stringify({ skills: [join(home, "linked", "entry", "SKILL.md")] }));
    const rows = paneCommands("pi", null, home).filter(({ name }) => name === "skill:entry");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: realpathSync(join(agentDir, "skills", "entry", "SKILL.md")) });
  });
});

describe("pi's forms as the chat reads them", () => {
  it("tells pi's bare commands from the ones given an argument", () => {
    const home = mkdtempSync(join(tmpdir(), "pi-forms-"));
    let rows: SlashCommand[];
    try { rows = JSON.parse(JSON.stringify(paneCommands("pi", null, home))) as SlashCommand[]; }
    finally { rmSync(home, { recursive: true, force: true }); }
    // bare /name shows the name in the terminal; with an argument it only sets it, like /model <id>
    expect(typedTerminalCommand(rows, "/name")?.name).toBe("name");
    expect(typedTerminalCommand(rows, "/name Release 1")).toBeNull();
    expect(typedTerminalCommand(rows, "/model anthropic/fictional-model")).toBeNull();
    expect(typedTerminalCommand(rows, "/export out.html")?.name).toBe("export");
  });
});
