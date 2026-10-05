/** Mobile history regression using a real chat transcript and an owned herdr pane. */
import "./test-herdr.ts";
import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { createServer } from "../server/index.ts";
import { herdrRpc, workspaceClose, workspaceCreate } from "../server/herdr/client.ts";

const root = mkdtempSync(join(tmpdir(), "herdr-web-ui-file-back-"));
const codexHome = join(root, "codex-home");
const thread = "01a0c7a1-56d9-7e20-9f08-f7a2d973bc11";
mkdirSync(join(codexHome, "sessions"), { recursive: true });
const transcript = join(codexHome, "sessions", `rollout-2026-09-28T00-00-00-${thread}.jsonl`);
writeFileSync(transcript, [
  { type: "session_meta", payload: { id: thread, cwd: root } },
  { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Show me the demo video." }] } },
  { type: "response_item", payload: { type: "message", role: "assistant", phase: "final_answer", content: [{ type: "output_text", text: `Open [demo video](./preview.webm) or [notes](./notes.txt) or [guide](./docs/guide.md) or [big](./big.txt) or [big code](./big.ts) or [file URI notes](${new URL(`file://${join(root, "notes.txt")}`).href}) or [folder](${new URL(`file://${root}`).href}).\n\n${new URL(`file://${join(root, "notes.txt")}`).href}\n\n\`\`\`ts\nconst answer = 42;\n\nexport { answer };\n\`\`\`` }] } },
].map((row) => JSON.stringify(row)).join("\n"));
const db = new Database(join(codexHome, "state_5.sqlite"));
db.exec("CREATE TABLE threads (id TEXT, rollout_path TEXT, cwd TEXT, archived INTEGER, agent_role TEXT, created_at INTEGER, updated_at INTEGER, source TEXT, first_user_message TEXT)");
db.query("INSERT INTO threads VALUES (?, ?, ?, 0, NULL, 1, 1, 'cli', ?)").run(thread, transcript, root, "Show me the demo video.");
db.close();
const standIn = join(root, "codex");
writeFileSync(standIn, "#!/bin/sh\nsleep 600\n");
chmodSync(standIn, 0o755);
copyFileSync(join(import.meta.dir, "fixtures", "file-preview.webm"), join(root, "preview.webm"));
writeFileSync(join(root, "notes.txt"), "File preview history regression\n");
// in a subfolder, so a link is resolved from the file's folder (../notes.txt), not the pane's
mkdirSync(join(root, "docs"));
writeFileSync(join(root, "docs", "guide.md"), "# Guide\n\nSee [notes](../notes.txt).\n\n```ts\nconst x = 1;\n```\n");
// the load limit is seeded below at its smallest choice, so this file, a little past it, stays small
const TEXT_LOAD_LIMIT = 256 * 1024;
writeFileSync(join(root, "big.txt"), "a line of plain text, 0123456789\n".repeat(Math.ceil(TEXT_LOAD_LIMIT / 30)).slice(0, TEXT_LOAD_LIMIT + 10));
// code past the highlight limit (256 KB) but within the larger load limit (1 MB): shown whole, in plain text
writeFileSync(join(root, "big.ts"), "export const value = 1;\n".repeat(Math.ceil((TEXT_LOAD_LIMIT + 1024) / 24)));
let workspace: string | undefined;
let server: ReturnType<typeof createServer> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;

try {
  const created = await workspaceCreate({ cwd: root, label: "herdr-web-ui-test-file-back" });
  workspace = created.workspace.workspace_id;
  const pane = created.root_pane.pane_id;
  await herdrRpc("pane.send_text", { pane_id: pane, text: `${standIn} resume ${thread}\n` });
  for (let attempt = 0; attempt < 100; attempt++) {
    const info = await herdrRpc<{ process_info?: { foreground_processes?: { argv?: string[] }[] } }>("pane.process_info", { pane_id: pane });
    if (info.process_info?.foreground_processes?.some((process) => process.argv?.includes(standIn))) break;
    if (attempt === 99) throw new Error("test Codex process did not start");
    await Bun.sleep(50);
  }
  await herdrRpc("pane.report_agent", { pane_id: pane, source: "manual", agent: "codex", state: "idle", agent_session_path: transcript });
  server = createServer({ port: 0, hostname: "127.0.0.1", token: "", stateDir: join(root, "state"), codexHome });
  const origin = `http://127.0.0.1:${server.port}`;
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/opt/google/chrome/chrome", headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  // seeded once: a later step raises the load limit and reloads
  await page.addInitScript((textLoadLimit) => {
    if (localStorage.getItem("herdr-web-ui:settings") === null) localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en", textLoadLimit }));
  }, TEXT_LOAD_LIMIT);
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // A known prior document proves explicit close leaves no invisible preview entry.
  await page.goto(`${origin}/api/health`);
  await page.goto(`${origin}/?pane=${encodeURIComponent(pane)}`);
  await page.locator(".conn-live").waitFor();
  const videoLink = page.getByRole("button", { name: "demo video", exact: true });
  await videoLink.waitFor();
  await page.locator(".markdown-code .hl-keyword", { hasText: "const" }).waitFor();
  await page.locator(".markdown-code .hl-number", { hasText: "42" }).waitFor();
  console.log("PASS Chat fenced code block is syntax highlighted");
  // a blank line must survive in the text a copy picks up
  const codeText = await page.locator(".markdown-code .hl-code").innerText();
  if (codeText !== "const answer = 42;\n\nexport { answer };") throw new Error(`Chat code block text lost its blank line: ${JSON.stringify(codeText)}`);
  console.log("PASS Chat code block keeps its blank line in the text");
  const composer = page.getByRole("textbox", { name: "Message", exact: true });
  await composer.fill("Keep my mobile draft");
  const chatUrl = page.url();
  await page.evaluate(() => {
    history.replaceState({ ...history.state, testMarker: "preserved" }, "");
    (window as unknown as { testDocument: string }).testDocument = "same-document";
  });
  const baseline = await page.evaluate(() => history.length);
  const preview = page.getByRole("dialog", { name: "preview.webm", exact: true });
  await videoLink.click();
  await preview.locator("video").waitFor();
  await page.waitForFunction(() => (document.querySelector("video")?.readyState ?? 0) >= 1);
  assert.equal(await page.evaluate(() => history.length), baseline + 1);
  if (process.env.UI_EVIDENCE_DIR) {
    mkdirSync(process.env.UI_EVIDENCE_DIR, { recursive: true });
    await page.screenshot({ path: join(process.env.UI_EVIDENCE_DIR, "mobile-video-open.png") });
  }
  // The Android system Back button uses this same browser history traversal.
  await page.goBack();
  await preview.waitFor({ state: "hidden" });
  assert.equal(page.url(), chatUrl);
  assert.equal(await composer.inputValue(), "Keep my mobile draft");
  assert.equal(await page.evaluate(() => (window as unknown as { testDocument: string }).testDocument), "same-document");
  assert.equal(await page.evaluate(() => history.state.testMarker), "preserved");
  await videoLink.waitFor();
  if (process.env.UI_EVIDENCE_DIR) await page.screenshot({ path: join(process.env.UI_EVIDENCE_DIR, "mobile-back-to-chat.png") });
  console.log("PASS mobile Back closes a playable video and preserves the chat document and draft");

  await page.goForward();
  await preview.waitFor();
  await preview.getByRole("button", { name: "Close file", exact: true }).click();
  await preview.waitFor({ state: "hidden" });
  // Repeated opens must not accumulate extra history entries.
  await videoLink.click();
  await preview.waitFor();
  assert.equal(await page.evaluate(() => history.length), baseline + 1);
  await page.keyboard.press("Escape");
  await preview.waitFor({ state: "hidden" });
  await videoLink.click();
  await preview.waitFor();
  // A press on the backdrop itself closes the viewer. On a touch device the viewer fills the
  // scrim edge to edge, so the press is sent to the scrim rather than aimed at an exposed pixel.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.locator(".file-viewer-scrim").evaluate((scrim) => scrim.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
  await preview.waitFor({ state: "hidden" });
  await page.setViewportSize({ width: 390, height: 844 });
  console.log("PASS Forward restores the viewer; X, Escape and scrim close consume its entry");

  await page.getByRole("button", { name: "notes", exact: true }).click();
  const notes = page.getByRole("dialog", { name: "notes.txt", exact: true });
  await notes.getByText("File preview history regression", { exact: true }).waitFor();
  await page.reload();
  await notes.getByText("File preview history regression", { exact: true }).waitFor();
  await page.goBack();
  await notes.waitFor({ state: "hidden" });
  await videoLink.waitFor();
  await videoLink.click();
  await preview.waitFor();
  await preview.getByRole("button", { name: "Close file", exact: true }).click();
  await preview.waitFor({ state: "hidden" });
  await page.goBack();
  assert.equal(page.url(), `${origin}/api/health`, "no ghost modal entry or back trap after explicit close");
  assert.deepEqual(errors, []);
  console.log("PASS text preview survives reload; closed viewers leave normal Back navigation intact");
  await page.goto(`${origin}/?pane=${encodeURIComponent(pane)}`);
  await page.getByRole("button", { name: "file URI notes", exact: true }).tap();
  await page.locator(".file-viewer-text").waitFor();
  assert.match(await page.locator(".file-viewer-text").innerText(), /File preview history regression/);
  console.log("PASS Chat file URI label opens file content through touch");
  await page.getByRole("button", { name: "Close file", exact: true }).click();
  await page.locator(".file-viewer").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "folder", exact: true }).tap();
  await page.locator(".file-viewer .dir-browser").waitFor();
  await page.locator(".file-viewer .dir-browser").getByRole("button", { name: /notes.txt/ }).tap();
  await page.locator(".file-viewer-text").waitFor();
  assert.match(await page.locator(".file-viewer-text").innerText(), /File preview history regression/);
  console.log("PASS Chat folder URI opens directory browser through touch");
  await page.getByRole("button", { name: "Close file", exact: true }).click();
  await page.locator(".file-viewer").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: new URL(`file://${join(root, "notes.txt")}`).href, exact: true }).tap();
  await page.locator(".file-viewer-text").waitFor();
  assert.match(await page.locator(".file-viewer-text").innerText(), /File preview history regression/);
  console.log("PASS Chat plain file URI opens content through touch");
  await page.getByRole("button", { name: "Close file", exact: true }).click();
  await page.locator(".file-viewer").waitFor({ state: "hidden" });

  // Markdown: Show source (a toggle: off is the Preview), Raw, Copy; no Download, no Wrap (a setting)
  const guide = page.getByRole("dialog", { name: "guide.md", exact: true });
  await page.getByRole("button", { name: "guide", exact: true }).click();
  await guide.getByRole("heading", { name: "Guide", exact: true }).waitFor();
  await guide.locator(".hl-keyword", { hasText: "const" }).waitFor();
  assert.equal(await guide.getByRole("button", { name: "Show source", exact: true }).getAttribute("aria-pressed"), "false");
  assert.equal(await guide.getByRole("link", { name: "Download", exact: true }).count(), 0, "a new tab (Raw) saves the file too");
  assert.equal(await guide.getByRole("button", { name: "Wrap long lines", exact: true }).count(), 0, "Wrap is for code, not the rendered Markdown");
  console.log("PASS Markdown opens as a Preview with a highlighted code block");
  await guide.getByRole("button", { name: "Show source", exact: true }).click();
  await guide.locator(".file-viewer-text .hl-line").first().waitFor();
  assert.equal(await guide.locator(".file-viewer-text .hl-line").count(), 7);
  assert.match(await guide.locator(".file-viewer-text").innerText(), /# Guide/);
  console.log("PASS Code shows the Markdown source, one numbered line each");
  const raw = guide.getByRole("link", { name: "Raw", exact: true });
  assert.equal(await raw.getAttribute("target"), "_blank");
  assert.match(await raw.getAttribute("href") ?? "", /\/api\/fs\/file/);
  await guide.getByRole("button", { name: "Copy file", exact: true }).waitFor();
  console.log("PASS Raw opens the file in a new tab; Copy is offered");
  assert.equal(await guide.getByRole("button", { name: "Wrap long lines", exact: true }).count(), 0, "wrapping is a setting, not a header action");
  assert.equal(await guide.locator(".file-viewer-text[data-wrap]").count(), 0, "lines do not wrap by default");
  await guide.getByRole("button", { name: "Show source", exact: true }).click();
  // Without a clipboard API (plain-HTTP LAN) Copy selects the source: from a Preview it switches to Code first
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("no clipboard")) }, configurable: true }));
  await guide.getByRole("button", { name: "Copy file", exact: true }).click();
  await guide.locator(".file-viewer-text .hl-line").first().waitFor();
  assert.equal(await guide.getByRole("button", { name: "Show source", exact: true }).getAttribute("aria-pressed"), "true");
  const sourceText = await guide.locator(".file-viewer-text").innerText();
  assert.match(sourceText, /See \[notes\]\(\.\.\/notes\.txt\)\./);
  assert.equal(await page.evaluate(() => window.getSelection()?.toString()), sourceText, "the selection is exactly the Markdown source");
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await guide.getByRole("button", { name: "Copy file", exact: true }).click();
  assert.equal(await page.evaluate(() => window.getSelection()?.toString()), sourceText, "from Code, Copy selects the source in place");
  console.log("PASS Without a clipboard API, Copy selects the Markdown source (switching a Preview to Code)");
  await guide.getByRole("button", { name: "Show source", exact: true }).click();
  await guide.getByRole("button", { name: "notes", exact: true }).click();
  const linked = page.getByRole("dialog", { name: "notes.txt", exact: true });
  await linked.waitFor();
  assert.doesNotMatch(await linked.locator(".file-viewer-meta").getAttribute("title") ?? "", /\/docs\//);
  console.log("PASS A link in a Markdown preview opens the file it names");
  await page.getByRole("button", { name: "Close file", exact: true }).click();
  await page.locator(".file-viewer").waitFor({ state: "hidden" });

  // a text file past the load limit: shown in part, so it cannot be copied whole
  await page.getByRole("button", { name: "big", exact: true }).click();
  const big = page.getByRole("dialog", { name: "big.txt", exact: true });
  // the note is the header's size, where it is seen before the text: "256 KB of …"
  const cut = big.locator(".file-viewer-meta .file-viewer-notice");
  await cut.waitFor();
  assert.match(await cut.innerText(), /^256 KB of \d/);
  assert.match(await cut.getAttribute("title") ?? "", /^Showing the first 256 KB/);
  assert.equal(await big.getByRole("button", { name: "Copy file", exact: true }).count(), 0);
  assert.equal(await big.getByText("Too long to highlight").count(), 0, "plain text is never too long to highlight");
  console.log("PASS A text file past the load limit says so in its header and has no Copy");
  await page.getByRole("button", { name: "Close file", exact: true }).click();
  await page.locator(".file-viewer").waitFor({ state: "hidden" });

  // code too long to color: shown whole and plain, and the header says why. Only a load limit above
  // the highlight limit lets such code arrive whole.
  await page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem("herdr-web-ui:settings") ?? "{}") as Record<string, unknown>;
    localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ ...settings, textLoadLimit: 1024 * 1024, wrapCode: true }));
  });
  await page.goto(`${origin}/?pane=${encodeURIComponent(pane)}`);
  await page.locator(".conn-live").waitFor();
  await page.getByRole("button", { name: "big code", exact: true }).click();
  const bigCode = page.getByRole("dialog", { name: "big.ts", exact: true });
  const plainNote = bigCode.locator(".file-viewer-meta .file-viewer-notice");
  await plainNote.waitFor();
  assert.equal(await plainNote.getAttribute("title"), "Too long to highlight", "the note is the tooltip of the size");
  assert.equal(await plainNote.locator("span:not(.visually-hidden)").innerText(), "257 KB", "and not spelled out in the meta line");
  assert.equal(await plainNote.locator(".visually-hidden").innerText(), "Too long to highlight", "a screen reader still hears it");
  assert.equal(await bigCode.locator(".hl-note").count(), 0, "the note is not repeated under the code");
  assert.equal(await bigCode.locator(".file-viewer-text .hl-keyword").count(), 0, "the code is plain");
  await bigCode.getByRole("button", { name: "Copy file", exact: true }).waitFor();
  console.log("PASS Code too long to highlight says so in its header, once");
  await bigCode.locator(".file-viewer-text[data-wrap]").waitFor();
  console.log("PASS Settings → Wrap long lines wraps the code");
  await page.getByRole("button", { name: "Close file", exact: true }).click();
  await page.locator(".file-viewer").waitFor({ state: "hidden" });

  // the file found, then its body refused (the file gone since, a remote PC dropped): the error's
  // JSON must never show as the file's text
  await page.route("**/api/fs/file?**", (route) => route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: { code: "machine_unavailable", message: "The PC connection was interrupted" } }) }), { times: 1 });
  await page.getByRole("button", { name: "notes", exact: true }).click();
  const refused = page.getByRole("dialog", { name: "notes.txt", exact: true });
  await refused.getByRole("alert").waitFor();
  assert.equal(await refused.getByRole("alert").innerText(), "The file could not be opened.");
  assert.equal(await refused.getByText("machine_unavailable").count(), 0);
  assert.equal(await refused.locator(".file-viewer-text").count(), 0);
  console.log("PASS A file whose body is refused shows an error, not the error's JSON");
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  server?.stop();
  if (workspace) await workspaceClose(workspace);
  rmSync(root, { recursive: true, force: true });
}
