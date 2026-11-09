// Fork: the pi command menu from both sources at once. Upstream's live list (piExtensionCommands, the web UI's pi
// extension) and the fork's file scan (skills/pi.ts discover: prompts, skills, the bundled /llama and /mcp) meet in
// mergeCatalogSources; each command shows once, the running pi's row where it lists one.
import { afterAll, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeCatalogSources, registerCatalogSource, type CatalogPane } from "./catalog-sources.ts";
import { paneCommands } from "./commands.ts";
import { piExtensionCommands } from "./pi.ts";

// short: a unix socket path must fit in about 100 bytes, and macOS's temp dir is long
const root = mkdtempSync(join(tmpdir(), "pim-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function put(path: string, content: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

it.skipIf(process.platform === "win32")("lists each pi command once with the running pi's list and the scan, the running pi's row first", async () => {
  const agentDir = join(root, "agent");
  put(join(agentDir, "prompts", "team.md"), "---\ndescription: A prompt the extension's /team runs before\n---\n");
  put(join(agentDir, "prompts", "review.md"), "---\ndescription: Review the change\n---\n");
  put(join(agentDir, "skills", "plan", "SKILL.md"), "---\nname: plan\ndescription: Plan the work\n---\nbody\n");
  const sockets = join(agentDir, "herdr-web-ui-ask");
  mkdirSync(sockets, { recursive: true, mode: 0o700 });
  // pi.getCommands()'s extension rows: pi's bundled extensions register /llama and /mcp like any other
  const answer = { version: 1, pid: 850, commands: [
    { name: "team", description: "Start specialist agents", scope: "user", origin: "top-level" },
    { name: "ponytail", scope: "user", origin: "package" },
    { name: "llama", description: "Manage llama.cpp router models", scope: "user", origin: "top-level" },
    { name: "mcp", description: "Manage MCP servers", scope: "user", origin: "top-level" },
  ] };
  const server = Bun.serve({ unix: join(sockets, "850.sock"), fetch: (request) => new URL(request.url).pathname === "/v1/commands" ? Response.json(answer) : new Response(null, { status: 404 }) });
  const processes = [{ pid: 850, argv: ["/usr/bin/pi"] }];
  const environ = [`PI_CODING_AGENT_DIR=${agentDir}`];
  // an agent name of its own: the registered pi source would ask herdr for the pane's processes
  const remove = registerCatalogSource({ agent: "pi-merge-test", owns: [], shadows: true,
    rows: () => piExtensionCommands("pane", undefined, { processes, processesAfter: async () => processes, environOf: () => environ, home: root }) });
  try {
    const scanned = paneCommands("pi", null, root, { environ });
    const pane = { pane_id: "pane" } as CatalogPane;
    const merged = await mergeCatalogSources("pi-merge-test", pane, root, scanned);
    const typed = merged.map((command) => `${command.trigger ?? "/"}${command.name}`);
    expect(typed.filter((name, index) => typed.indexOf(name) !== index)).toEqual([]);
    const row = (name: string) => merged.find((command) => command.name === name);
    // the running pi's /team, which it runs before the prompt template of that name
    expect(row("team")).toMatchObject({ description: "Start specialist agents", source: "user", provenance: { transport: "native" } });
    expect(row("ponytail")).toMatchObject({ source: "plugin" });
    // what only the scan knows fills in: prompts and skills, which the extension does not list
    expect(row("review")).toMatchObject({ description: "Review the change", source: "user" });
    expect(row("skill:plan")).toMatchObject({ source: "skill" });
    // the bundled extensions' commands stay the scan's built-ins (Settings' Suggest built-in commands hides them)
    expect(row("llama")).toMatchObject({ source: "builtin" });
    expect(row("mcp")).toMatchObject({ source: "builtin" });

    // without the extension (or pi < 1.3.0) the scan alone answers, as before
    const alone = await mergeCatalogSources("pi-without-extension", pane, root, scanned);
    expect(alone).toEqual(scanned);
    expect(alone.find((command) => command.name === "team")).toMatchObject({ source: "user", description: "A prompt the extension's /team runs before" });
  } finally {
    remove();
    await server.stop(true);
  }
});
