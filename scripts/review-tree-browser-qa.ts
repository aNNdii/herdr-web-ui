/**
 * The Review's file tree (ReviewDialog → ReviewTree, `@pierre/trees`) in the built app, against a real git
 * repository answered by the server's own repo-diff module: how a deep path is cut when the tree's column is
 * narrow. A flattened folder row gives up its front segments first, each down to its first letter and "…", and
 * only then cuts its last segment, at its start; a file name keeps its end and extension
 * (`…-import-service.test.ts` and `…-import-service.ts` stay apart); a short name is never cut. A level indents a
 * row about 14px, its indent guide kept.
 *
 * The tree draws in a shadow root and restyles nothing of its own on the page: these checks read what is drawn,
 * character by character, so a markup change of the library (a beta) shows here.
 *
 * A file's header keeps its Viewed button as the last of its tools, in the diff, the whole file, a Markdown file and
 * the file viewer's view.
 *
 * A viewed file that Hide viewed files drops leaves the folders as the reader opened and closed them; a filter still
 * opens the folders of its matches. Hide viewed files is offered in Changed alone; with every changed file viewed a
 * note says so (another under a filter), the file still shown listed under it, and Show viewed files lists them again. The shown file's own folder, closed by
 * the reader, stays closed as the file is marked viewed.
 *
 * A viewed file's check stays in sight however narrow the column, git's mark right of it, and its name fades in its colour; a
 * row's tooltip is its path (a flattened folder row's, its deepest folder's).
 *
 * The tree's column starts at its default width and has a grip on its right edge: a drag, the arrow keys, Home and
 * End move it, a double-click resets it, and only a real move stores a width. A stored width wider than the window
 * allows is drawn narrower and kept; a folded tree stays folded; a phone has no grip.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright-core";
import { build as viteBuild } from "vite";
import { repoDiffResponse } from "../server/repo-diff.ts";
import { serveStatic } from "../server/static.ts";

process.env["GIT_CONFIG_GLOBAL"] = "/dev/null";
process.env["GIT_CONFIG_NOSYSTEM"] = "1";

const root = realpathSync(mkdtempSync(join(tmpdir(), "herdr-review-tree-")));
const evidence = process.env.UI_EVIDENCE_DIR;
if (evidence) mkdirSync(evidence, { recursive: true });

/** The flattened chain of single-child folders the deep files sit in, and those files. */
const CHAIN = ["packages", "core", "src", "application", "services", "mob-dispatcher"];
const TEST_FILE = "mob-group-group-import-service.test.ts";
const SOURCE_FILE = "mob-group-group-import-service.ts";
const SHORT = ["README.md", ".gitignore"];
/** A changed image: the Review leaves it to the file viewer's view. */
const IMAGE = "logo.png";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  return result.stdout.toString();
}

/** A repository whose changed files are the deep ones and two short names at its root. */
function fixture(): string {
  const repo = join(root, "repo");
  const deep = join(repo, ...CHAIN);
  mkdirSync(deep, { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  const files = [join(deep, TEST_FILE), join(deep, SOURCE_FILE), ...SHORT.map((name) => join(repo, name))];
  for (const file of files) writeFileSync(file, "first\n");
  writeFileSync(join(repo, IMAGE), PNG);
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "first");
  for (const file of files) writeFileSync(file, "first\nsecond\n");
  // bytes past the end of the image change the file and leave it drawable
  writeFileSync(join(repo, IMAGE), Buffer.concat([PNG, Buffer.from("changed")]));
  return repo;
}

const repo = fixture();
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;

/** The routes the Review reads, on a stand-in that maps its one pane to the fixture repository. */
async function api(url: URL): Promise<Response | null> {
  const diff = /^\/api\/workspace\/diff\/(files|file|tree)$/.exec(url.pathname);
  if (diff) return repoDiffResponse(diff[1] as "files" | "file" | "tree", repo, url.searchParams);
  // the file routes the opened file is read through: an image as such, the rest as text
  const fs = /^\/api\/fs\/(stat|file)$/.exec(url.pathname);
  if (fs) {
    const path = url.searchParams.get("path") ?? "";
    let size: number;
    try { size = statSync(path).size; } catch { return Response.json({ error: { code: "not_found", message: "No readable file at this path." } }, { status: 404 }); }
    const image = path.endsWith(".png");
    const mime = image ? "image/png" : "text/plain";
    if (fs[1] === "stat") return Response.json({ path, name: path.split("/").pop(), kind: image ? "image" : "text", size, mime, modified: "2026-01-01T00:00:00Z" });
    return new Response(readFileSync(path), { headers: { "content-type": image ? mime : "text/plain; charset=utf-8" } });
  }
  return null;
}

/**
 * What one tree row shows, read in the page: each flattened segment (or the name) as drawn, whether it is at its
 * least width, and whether the row's content fits its place at all (every segment at its least may not).
 */
interface Drawn { parts: string[]; least: boolean[]; fits: boolean }

/**
 * A self-contained reader serialized into `evaluate`: the row of `path` (a file's path, or `null` for the
 * flattened folder row), as the characters a reader can see, left to right, with "…" where a marker shows.
 * A character half under a marker or half outside the row's clip counts as hidden.
 */
const readRow = (path: string | null): Drawn | null => {
  const shadow = document.querySelector(".review-tree")?.shadowRoot;
  if (!shadow) return null;
  const rows = [...shadow.querySelectorAll<HTMLElement>("[data-type='item']:not([data-file-tree-sticky-row])")];
  const row = path === null ? rows.find((one) => one.querySelector("[data-item-flattened-subitems]") !== null) : rows.find((one) => one.dataset["itemPath"] === path);
  if (!row) return null;
  const content = row.querySelector<HTMLElement>("[data-item-section='content']")!;
  const clipOf = (element: Element): DOMRect => {
    const own = element.getBoundingClientRect(), outer = content.getBoundingClientRect();
    const left = Math.max(own.left, outer.left);
    return new DOMRect(left, own.top, Math.max(0, Math.min(own.right, outer.right) - left), own.height);
  };
  const shown = (container: HTMLElement): string => {
    const clip = clipOf(container);
    const cell = container.querySelector("[data-truncate-marker-cell]")!;
    // the library's own test: the overflow copy wraps, so the marker's cell grows past one line
    const cut = cell.getBoundingClientRect().height > container.getBoundingClientRect().height + 0.5;
    const marker = container.querySelector("[data-truncate-marker]")!.getBoundingClientRect();
    const pieces: { x: number; text: string }[] = [];
    if (cut) pieces.push({ x: marker.left, text: "…" });
    const visible = container.querySelector("[data-truncate-content='visible']")!;
    const walker = document.createTreeWalker(visible, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? "";
      for (let index = 0; index < text.length; index++) {
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        const box = range.getBoundingClientRect();
        if (box.width === 0) continue;
        const inside = box.left >= clip.left - 0.5 && box.right <= clip.right + 0.5;
        const covered = cut && box.right > marker.left + 0.5 && box.left < marker.right - 0.5;
        if (inside && !covered) pieces.push({ x: box.left, text: text[index]! });
      }
    }
    return pieces.sort((a, b) => a.x - b.x).map((piece) => piece.text).join("");
  };
  const segments = [...row.querySelectorAll<HTMLElement>("[data-item-flattened-subitem]")];
  const holders = segments.length > 0 ? segments : [content];
  return {
    parts: holders.map((holder) => [...holder.querySelectorAll<HTMLElement>("[data-truncate-container]")].map(shown).join("")),
    least: segments.map((segment) => {
      // a front segment's least width as ReviewTree.shadow.css sets it: one letter and the marker, or its own when shorter
      const probe = document.createElement("span");
      probe.style.cssText = "display: inline-block; width: calc(1ch + 1em)";
      segment.append(probe);
      const least = probe.getBoundingClientRect().width;
      probe.remove();
      const text = document.createRange();
      text.selectNodeContents(segment.querySelector("[data-truncate-content='visible']")!);
      return segment.getBoundingClientRect().width <= Math.min(least, text.getBoundingClientRect().width) + 0.5;
    }),
    fits: content.scrollWidth <= content.clientWidth,
  };
};

/** The tree's column at `width` px, read once the layout settled. */
async function column(page: Page, width: number): Promise<void> {
  await page.evaluate(async (width) => {
    document.querySelector<HTMLElement>(".review-body")!.style.gridTemplateColumns = `${width}px minmax(0, 1fr)`;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, width);
}
async function drawn(page: Page, path: string | null): Promise<Drawn> {
  const row = await page.evaluate(([source, path]) => (new Function(`return (${source})`)() as typeof readRow)(path), [readRow.toString(), path] as const);
  assert.ok(row, `the tree draws the row of ${path ?? "the flattened folders"}`);
  return row;
}
async function read(page: Page, path: string | null): Promise<string[]> {
  return (await drawn(page, path)).parts;
}
async function shot(page: Page, name: string): Promise<void> {
  if (evidence) await page.locator(".review-tree-pane").screenshot({ path: join(evidence, `review-tree-${name}.png`) });
}

/** The files the tree draws, by path (none when no tree is drawn). */
async function listed(page: Page): Promise<string[]> {
  return page.evaluate(() => [...document.querySelector(".review-tree")?.shadowRoot?.querySelectorAll<HTMLElement>("[data-type='item'][data-item-type='file']:not([data-file-tree-sticky-row])") ?? []].map((row) => row.dataset["itemPath"] ?? ""));
}
/** The files the tree draws once `test` holds, frame by frame; fails after 10s. */
async function listedUntil(page: Page, what: string, test: (shown: string[]) => boolean): Promise<string[]> {
  const started = Date.now();
  for (;;) {
    const shown = await listed(page);
    if (test(shown)) return shown;
    assert.ok(Date.now() - started < 10_000, `${what}: ${JSON.stringify(shown)}`);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
}

/** A segment cut at its end: its start, at least one letter, then "…". */
const endCut = (shown: string, full: string): boolean => shown.endsWith("…") && shown.length >= 2 && full.startsWith(shown.slice(0, -1));
/** A name cut at its start: "…", then its end (nothing of it, at the narrowest). */
const startCut = (shown: string, full: string): boolean => shown.startsWith("…") && full.endsWith(shown.slice(1));

try {
  const app = join(import.meta.dir, ".."), output = join(root, "dist");
  symlinkSync(join(app, "node_modules"), join(root, "node_modules"), "dir");
  symlinkSync(join(app, "scripts/review-tree-fixture.tsx"), join(root, "fixture.tsx"));
  writeFileSync(join(root, "index.html"), '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/fixture.tsx"></script></body></html>');
  await viteBuild({ configFile: join(app, "vite.config.ts"), root, publicDir: false, logLevel: "warn", build: { outDir: output, emptyOutDir: true } });
  const policy = (await serveStatic("/")).headers.get("content-security-policy");
  assert.ok(policy, "build the app before its enforcing CSP regression");
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const url = new URL(request.url);
    const answer = await api(url);
    if (answer) return answer;
    if (url.pathname === "/favicon.ico") return new Response(null, { status: 204 });
    return new Response(Bun.file(join(output, url.pathname === "/" ? "index.html" : url.pathname.slice(1))), { headers: { "content-security-policy": policy } });
  } });
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });

  for (const theme of ["dark", "light"] as const) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme });
    await context.addInitScript((theme) => localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en", theme })), theme);
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
    await page.goto(`http://127.0.0.1:${server.port}/`);
    await page.evaluate((directory) => window.reviewTreeQA.open("pane-review", directory), repo);
    await page.getByRole("dialog", { name: "Review", exact: true }).waitFor();
    await page.waitForFunction(() => (document.querySelector(".review-tree")?.shadowRoot?.querySelectorAll("[data-item-type='file']").length ?? 0) >= 4);
    // the UI face's chunk for these names, loaded before anything is measured (it is fetched as text first needs it)
    await page.evaluate((text) => document.fonts.load("400 1em 'Pretendard Variable'", text), [...CHAIN, TEST_FILE, ...SHORT].join(""));

    // wide: nothing is cut
    await column(page, 640);
    assert.deepEqual(await read(page, null), CHAIN, `${theme}: a wide column shows every folder whole`);
    for (const name of [TEST_FILE, SOURCE_FILE]) assert.deepEqual(await read(page, `${CHAIN.join("/")}/${name}`), [name], `${theme}: a wide column shows ${name} whole`);
    await shot(page, `640-${theme}`);

    // a level moves a row about 14px in (the library's 22px less its 8px level gap), its indent guide kept; the
    // gap is cut on the tree alone, so the Changes list and the rest of the page keep theirs
    const indent = await page.evaluate((deep) => {
      const shadow = document.querySelector(".review-tree")!.shadowRoot!;
      const row = (path: string) => shadow.querySelector<HTMLElement>(`[data-type='item'][data-item-path="${path}"]:not([data-file-tree-sticky-row])`)!;
      const left = (path: string) => row(path).querySelector("[data-item-section='content']")!.getBoundingClientRect().left;
      return {
        step: left(deep) - left("README.md"),
        guides: row(deep).querySelectorAll("[data-item-section='spacing-item']").length,
        tree: getComputedStyle(document.querySelector(".review-tree")!).getPropertyValue("--trees-level-gap-override").trim(),
        page: getComputedStyle(document.body).getPropertyValue("--trees-level-gap-override").trim(),
      };
    }, `${CHAIN.join("/")}/${TEST_FILE}`);
    assert.ok(indent.step >= 12 && indent.step <= 16, `${theme}: a level indents a row about 14px: ${indent.step}`);
    assert.equal(indent.guides, 1, `${theme}: a nested row keeps its indent guide`);
    assert.deepEqual([indent.tree, indent.page], ["0px", ""], `${theme}: only the review tree drops its level gap`);

    // narrower and narrower: the order the folders give way in, and how a name is cut
    let frontAtLeast = false, lastCut = false, fileCut = false, tooNarrow = 0;
    for (let width = 640; width >= 200; width -= 8) {
      await column(page, width);
      const where = `${theme}, ${width}px`;
      const { parts, least, fits } = await drawn(page, null);
      assert.equal(parts.length, CHAIN.length, `${where}: one part per folder: ${JSON.stringify(parts)}`);
      const last = parts.length - 1;
      // too narrow for the front folders' first letters: the last one has nothing left, the row is clipped
      if (!fits) {
        assert.ok(parts[last] === "…" || parts[last] === "", `${where}: a row too narrow for its folders' first letters has given up its last one: ${JSON.stringify(parts)}`);
        tooNarrow = Math.max(tooNarrow, width);
      }
      // a front segment that gave way all it can: its first letter and "…", or whole when it is that short already
      const gaveWay = (at: number): boolean => least[at] === true && (parts[at] === `${CHAIN[at]![0]}…` || parts[at] === CHAIN[at]);
      if (fits) parts.forEach((shown, index) => {
        const full = CHAIN[index]!;
        if (index < last) {
          if (least[index] === true) assert.ok(gaveWay(index), `${where}: ${full} at its least shows its first letter: ${JSON.stringify(parts)}`);
          if (shown === full) return;
          // a front segment is cut at its end, and only once those before it gave way
          assert.ok(endCut(shown, full), `${where}: ${full} is cut at its end: ${JSON.stringify(parts)}`);
          for (let at = 0; at < index; at++) assert.ok(gaveWay(at), `${where}: the folders before ${full} give way first: ${JSON.stringify(parts)}`);
          frontAtLeast = true;
        } else if (shown !== full) {
          // the last segment is cut at its start, and only once every front one gave way
          assert.ok(startCut(shown, full), `${where}: the last folder keeps its end: ${JSON.stringify(parts)}`);
          for (let at = 0; at < last; at++) assert.ok(gaveWay(at), `${where}: the front folders gave way first: ${JSON.stringify(parts)}`);
          lastCut = true;
        }
      });
      const names: string[] = [];
      for (const name of [TEST_FILE, SOURCE_FILE]) {
        const [shown = ""] = await read(page, `${CHAIN.join("/")}/${name}`);
        if (shown !== name) {
          assert.ok(startCut(shown, name), `${where}: ${name} keeps its end and extension: ${JSON.stringify(shown)}`);
          fileCut = true;
        }
        names.push(shown);
      }
      assert.notEqual(names[0], names[1], `${where}: the two files stay apart: ${JSON.stringify(names)}`);
      for (const name of SHORT) assert.deepEqual(await read(page, name), [name], `${where}: a short name is never cut`);
      // the front folders giving way, the last one whole: `p…/c…/src/applica…/services/mob-dispatcher`
      if (width === 432) await shot(page, `432-${theme}`);
      // about the column's default width: the end that tells the two files apart is there whole
      if (width === 296) {
        assert.ok(names[0]!.endsWith("-import-service.test.ts") && names[1]!.endsWith("-import-service.ts"), `${where}: the files' distinct ends show: ${JSON.stringify(names)}`);
        await shot(page, `296-${theme}`);
      }
    }
    assert.ok(frontAtLeast && lastCut && fileCut, `${theme}: the sweep reached every stage (front folders ${frontAtLeast}, last folder ${lastCut}, file names ${fileCut})`);
    // five front folders' first letters, the separators and the row's lanes need about a 256px column (the default
    // is wider); a front folder that keeps more than its letter shows here
    assert.ok(tooNarrow <= 256, `${theme}: the folder row holds its first letters down to a ${tooNarrow + 8}px column`);
    await shot(page, `200-${theme}`);
    assert.deepEqual(errors, [], `${theme}: no page errors`);
    await context.close();
  }
  // the Viewed button closes the file's tools in every view the Review draws a file in
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(() => localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en" })));
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
    await page.goto(`http://127.0.0.1:${server.port}/`);
    await page.evaluate((directory) => window.reviewTreeQA.open("pane-review", directory), repo);
    await page.getByRole("dialog", { name: "Review", exact: true }).waitFor();
    const dialog = page.getByRole("dialog", { name: "Review", exact: true });
    const open = async (path: string): Promise<void> => {
      await page.locator(`.review-tree [data-item-path="${path}"]:not([data-file-tree-sticky-row])`).click();
    };
    /** The tools of the file shown, left to right as they stand in its header: the Viewed button by name. */
    const tools = async (): Promise<string[]> => page.locator(".review-file-head .review-tools").evaluate((element) =>
      [...element.querySelectorAll<HTMLElement>("button, a")].map((tool) => tool.classList.contains("review-viewed") ? "Viewed" : tool.getAttribute("aria-label") ?? tool.textContent?.trim() ?? ""));
    const last = async (view: string, ready: string): Promise<void> => {
      await page.locator(ready).waitFor();
      await page.locator(".review-file-head .review-viewed").waitFor();
      const order = await tools();
      assert.equal(order.at(-1), "Viewed", `${view}: the Viewed button is the last of the file's tools: ${JSON.stringify(order)}`);
      // the last of them on screen too, at the right end of its row
      const ends = await page.locator(".review-file-head .review-tools").evaluate((element) => {
        const viewed = element.querySelector(".review-viewed")!.getBoundingClientRect();
        return [...element.querySelectorAll("button, a")].every((tool) => tool.getBoundingClientRect().right <= viewed.right + 0.5);
      });
      assert.ok(ends, `${view}: the Viewed button stands at the right end of the tools`);
      if (evidence) await page.locator(".review-file-head").screenshot({ path: join(evidence, `review-viewed-${view}.png`) });
    };

    await open(`${CHAIN.join("/")}/${SOURCE_FILE}`);
    await last("diff", ".review-file[data-mode='diff'] .repo-diff-styles");
    await open(IMAGE);
    await last("viewer", ".review-viewer");
    await dialog.getByRole("button", { name: "All files", exact: true }).click();
    // the folders of All files start closed: a changed file at the root
    await open(".gitignore");
    await last("file", ".review-file[data-mode='file'] .review-file-head");
    await open("README.md");
    await last("markdown", ".review-file[data-mode='file'] .review-mode");
    assert.deepEqual(errors, [], "viewed: no page errors");
    await context.close();
  }
  // a viewed file Hide viewed files drops leaves the folders as the reader set them; a filter still opens its matches
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(() => localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en" })));
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
    await page.goto(`http://127.0.0.1:${server.port}/`);
    await page.evaluate((directory) => window.reviewTreeQA.open("pane-review", directory), repo);
    await page.getByRole("dialog", { name: "Review", exact: true }).waitFor();
    const deep = CHAIN.join("/");
    /** The files the tree draws, by path. */
    const files = async (): Promise<string[]> => page.evaluate(() => [...document.querySelector(".review-tree")?.shadowRoot?.querySelectorAll<HTMLElement>("[data-type='item'][data-item-type='file']:not([data-file-tree-sticky-row])") ?? []].map((row) => row.dataset["itemPath"] ?? ""));
    const until = async (what: string, test: (shown: string[]) => boolean): Promise<string[]> => {
      const started = Date.now();
      for (;;) {
        const shown = await files();
        if (test(shown)) return shown;
        assert.ok(Date.now() - started < 10_000, `${what}: ${JSON.stringify(shown)}`);
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      }
    };
    const inDeep = (shown: string[]): boolean => shown.some((path) => path.startsWith(`${deep}/`));
    await until("Changed lists its files, the deep ones open", (shown) => shown.length >= 4 && inDeep(shown));
    const hide = page.locator(".review-hide-viewed");
    await hide.click();
    assert.equal(await hide.getAttribute("aria-pressed"), "true", "Hide viewed files turns on");
    // the reader closes the deep folders
    await page.locator(".review-tree [data-type='item']:has([data-item-flattened-subitems]):not([data-file-tree-sticky-row])").click();
    await until("the deep folders close", (shown) => !inDeep(shown) && shown.includes("README.md"));
    // marks a file viewed: it stays listed while it is shown
    await page.locator('.review-tree [data-item-path="README.md"]:not([data-file-tree-sticky-row])').click();
    await page.locator(".review-file-head .review-viewed[aria-pressed='false']").click();
    await page.locator(".review-file-head .review-viewed[aria-pressed='true']").waitFor();
    assert.ok((await files()).includes("README.md"), "the file shown stays listed once viewed");
    // and picks another: the viewed file drops out, the deep folders stay closed
    await page.locator('.review-tree [data-item-path=".gitignore"]:not([data-file-tree-sticky-row])').click();
    const after = await until("the viewed file drops out once another is shown", (shown) => !shown.includes("README.md"));
    assert.ok(!inDeep(after), `the deep folders stay closed as a viewed file drops out: ${JSON.stringify(after)}`);
    if (evidence) await page.locator(".review-tree-pane").screenshot({ path: join(evidence, "review-tree-hidden-folders-kept.png") });
    // a filter is another listing: its matches open
    await page.getByRole("searchbox", { name: "Filter files" }).fill("import-service");
    await until("a filter opens the folders of its matches", (shown) => shown.includes(`${deep}/${TEST_FILE}`) && shown.includes(`${deep}/${SOURCE_FILE}`));
    assert.deepEqual(errors, [], "folders: no page errors");
    await context.close();
  }
  // Hide viewed files only in Changed; with every changed file viewed a note says so (another under a filter), the
  // file still shown listed under it, and Show viewed files turns the toggle off and lists them all again
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(() => localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en" })));
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
    await page.goto(`http://127.0.0.1:${server.port}/`);
    await page.evaluate((directory) => window.reviewTreeQA.open("pane-review", directory), repo);
    const dialog = page.getByRole("dialog", { name: "Review", exact: true });
    await dialog.waitFor();
    const deep = CHAIN.join("/");
    const changed = [`${deep}/${TEST_FILE}`, `${deep}/${SOURCE_FILE}`, ...SHORT, IMAGE];
    await listedUntil(page, "Changed lists every changed file", (shown) => changed.every((path) => shown.includes(path)));
    const hide = page.locator(".review-hide-viewed");
    const note = page.locator(".review-list-note");
    // All files offers no toggle (nothing there is hidden), Changed with stamps does
    await dialog.getByRole("button", { name: "All files", exact: true }).click();
    await page.locator(".review-ignored").waitFor();
    assert.equal(await hide.count(), 0, "All files has no Hide viewed files toggle");
    await dialog.getByRole("button", { name: "Changed files" }).click();
    await hide.waitFor();
    await hide.click();
    assert.equal(await hide.getAttribute("aria-pressed"), "true", "Hide viewed files turns on");
    // every changed file marked viewed, one after another: each drops out once the next is shown
    for (const path of changed) {
      await page.locator(`.review-tree [data-item-path="${path}"]:not([data-file-tree-sticky-row])`).click();
      await page.locator(".review-file-head .review-viewed[aria-pressed='false']").click();
      await page.locator(".review-file-head .review-viewed[aria-pressed='true']").waitFor();
    }
    // the last one is still shown: listed, under the note
    await note.getByText("All changed files are viewed.", { exact: true }).waitFor();
    assert.deepEqual(await listedUntil(page, "only the file shown stays listed", (shown) => shown.length === 1), [IMAGE], "the file still shown stays listed with every file viewed");
    const noteBox = (await note.boundingBox())!, treeBox = (await page.locator(".review-tree").boundingBox())!;
    assert.ok(noteBox.y + noteBox.height <= treeBox.y + 0.5, `the note stands above the file still listed: ${JSON.stringify([noteBox, treeBox])}`);
    if (evidence) await page.locator(".review-tree-pane").screenshot({ path: join(evidence, "review-tree-all-viewed-kept.png") });
    // the file closed (a phone's Back; a wide Review keeps a file shown): nothing is listed, the note stays
    await page.setViewportSize({ width: 640, height: 900 });
    await page.locator(".review-back").click();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByText("Choose a file in the tree.", { exact: true }).waitFor();
    await listedUntil(page, "a closed file drops out", (shown) => shown.length === 0);
    assert.equal((await note.locator(".repo-diff-note").textContent())?.trim(), "All changed files are viewed.", "the note stays once the file is closed");
    // a filter that matches only viewed files says so
    const search = page.getByRole("searchbox", { name: "Filter files" });
    await search.fill("import-service");
    await note.getByText("All matching files are viewed.", { exact: true }).waitFor();
    assert.deepEqual(await listed(page), [], "a filter over viewed files lists none");
    if (evidence) await page.locator(".review-tree-pane").screenshot({ path: join(evidence, "review-tree-all-matching-viewed.png") });
    await search.fill("");
    await note.getByText("All changed files are viewed.", { exact: true }).waitFor();
    // Show viewed files: the toggle off, stored so, every changed file listed again
    await page.locator(".review-show-viewed").click();
    assert.equal(await hide.getAttribute("aria-pressed"), "false", "Show viewed files turns the toggle off");
    await listedUntil(page, "Show viewed files lists every changed file again", (shown) => changed.every((path) => shown.includes(path)));
    assert.equal(await note.count(), 0, "the note leaves with the toggle off");
    assert.equal(await page.evaluate(() => localStorage.getItem("herdr-web-ui:review-hide-viewed")), null, "the toggle is stored off");
    assert.deepEqual(errors, [], "viewed notes: no page errors");
    await context.close();
  }
  // the file shown, marked viewed with its folder closed: it stays listed (a new list, the same listing), and its
  // folder stays as the reader left it; a filter, a new listing, still opens it
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(() => localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en" })));
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
    await page.goto(`http://127.0.0.1:${server.port}/`);
    await page.evaluate((directory) => window.reviewTreeQA.open("pane-review", directory), repo);
    await page.getByRole("dialog", { name: "Review", exact: true }).waitFor();
    const deep = CHAIN.join("/"), shownPath = `${deep}/${TEST_FILE}`;
    const inDeep = (shown: string[]): boolean => shown.some((path) => path.startsWith(`${deep}/`));
    await listedUntil(page, "Changed lists its files, the deep ones open", (shown) => shown.includes(shownPath));
    const hide = page.locator(".review-hide-viewed");
    await hide.click();
    assert.equal(await hide.getAttribute("aria-pressed"), "true", "Hide viewed files turns on");
    await page.locator(`.review-tree [data-item-path="${shownPath}"]:not([data-file-tree-sticky-row])`).click();
    await page.locator(".review-file-head .review-viewed[aria-pressed='false']").waitFor();
    // the reader closes the shown file's own folder
    await page.locator(".review-tree [data-type='item']:has([data-item-flattened-subitems]):not([data-file-tree-sticky-row])").click();
    await listedUntil(page, "the shown file's folder closes", (shown) => !inDeep(shown) && shown.includes("README.md"));
    // and marks the file viewed: the list is drawn again (the file kept), its folder stays closed
    await page.locator(".review-file-head .review-viewed[aria-pressed='false']").click();
    await page.locator(".review-file-head .review-viewed[aria-pressed='true']").waitFor();
    await page.locator(".review-scope .review-badge", { hasText: "1/5" }).waitFor();
    for (let frame = 0; frame < 20; frame++) {
      const shown = await listed(page);
      assert.ok(!inDeep(shown) && shown.includes("README.md"), `the shown file's folder stays closed as it is marked viewed: ${JSON.stringify(shown)}`);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    }
    if (evidence) await page.locator(".review-tree-pane").screenshot({ path: join(evidence, "review-tree-shown-folder-kept.png") });
    // a filter is a new listing: its matches open, the shown file among them
    const search = page.getByRole("searchbox", { name: "Filter files" });
    await search.fill("import-service");
    await listedUntil(page, "a filter opens the shown file's folder", (shown) => shown.includes(shownPath) && shown.includes(`${deep}/${SOURCE_FILE}`));
    await search.fill("");
    await hide.click();
    assert.equal(await hide.getAttribute("aria-pressed"), "false", "Hide viewed files turns off again");
    assert.deepEqual(errors, [], "shown folder: no page errors");
    await context.close();
  }
  // a viewed file's check stays in sight however long its name, git's mark right of it, the name faded; a row's
  // tooltip is its full path, the deepest folder's for a flattened folder row
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(() => localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en" })));
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
    await page.goto(`http://127.0.0.1:${server.port}/`);
    await page.evaluate((directory) => window.reviewTreeQA.open("pane-review", directory), repo);
    await page.getByRole("dialog", { name: "Review", exact: true }).waitFor();
    const deep = CHAIN.join("/"), viewedPath = `${deep}/${TEST_FILE}`, otherPath = `${deep}/${SOURCE_FILE}`;
    const row = (path: string) => page.locator(`.review-tree [data-item-path="${path}"]:not([data-file-tree-sticky-row])`);
    await row(viewedPath).click();
    await page.locator(".review-file-head .review-viewed[aria-pressed='false']").click();
    await page.locator(".review-file-head .review-viewed[aria-pressed='true']").waitFor();
    // the check shows at once, while the file is still the one shown: no other row's redraw brings it
    const checkShown = (path: string) => document.querySelector(".review-tree")?.shadowRoot?.querySelector(`[data-item-path="${path}"] [data-item-section='decoration'] > *`) != null;
    await page.waitForFunction(checkShown, viewedPath, { timeout: 3000 });
    await row(otherPath).click();
    await page.waitForFunction(checkShown, viewedPath);

    /** Where a row's check and git mark stand against the row, and the colour its name is drawn in. */
    const lanes = async (path: string) => page.evaluate((path) => {
      const row = document.querySelector(".review-tree")!.shadowRoot!.querySelector<HTMLElement>(`[data-type='item'][data-item-path="${path}"]:not([data-file-tree-sticky-row])`)!;
      const box = (element: Element | null) => element === null ? null : (({ left, right, width }) => ({ left, right, width }))(element.getBoundingClientRect());
      const check = row.querySelector("[data-item-section='decoration'] > *");
      return {
        row: box(row)!, content: box(row.querySelector("[data-item-section='content']"))!,
        check: box(check), checkText: check?.textContent ?? "", git: box(row.querySelector("[data-item-section='git']")),
        color: getComputedStyle(row.querySelector("[data-item-section='content']")!).color,
        opacity: Number(getComputedStyle(row.querySelector("[data-item-section='content']")!).opacity),
        gitOpacity: Number(getComputedStyle(row.querySelector("[data-item-section='git']")!).opacity),
      };
    }, path);
    for (const width of [200, 296, 640]) {
      await column(page, width);
      const where = `viewed, ${width}px`;
      const viewed = await lanes(viewedPath), other = await lanes(otherPath);
      assert.ok(viewed.check !== null && viewed.checkText.includes("✓"), `${where}: the viewed file shows its check`);
      // whole and in the row, after the name, before git's mark
      assert.ok(viewed.check.width >= 4, `${where}: the check keeps its width: ${JSON.stringify(viewed)}`);
      assert.ok(viewed.check.left >= viewed.content.right - 0.5 && viewed.check.right <= viewed.row.right + 0.5, `${where}: the check stands after the name, inside the row: ${JSON.stringify(viewed)}`);
      assert.ok(viewed.git !== null && viewed.git.left >= viewed.check.right - 0.5, `${where}: git's mark stays right of the check: ${JSON.stringify(viewed)}`);
      // git's mark at the row's right end, in line with the next row's
      assert.ok(other.git !== null && Math.abs(viewed.git.right - other.git.right) <= 0.5, `${where}: git's marks line up: ${JSON.stringify([viewed.git, other.git])}`);
      assert.equal(other.check, null, `${where}: a file not viewed has no check`);
      // faded, not greyed: the name keeps git's colour, and git's mark stays whole
      assert.equal(viewed.color, other.color, `${where}: the viewed file's name keeps its colour`);
      assert.ok(viewed.opacity < 0.8 && other.opacity === 1, `${where}: the viewed file's name fades: ${viewed.opacity} against ${other.opacity}`);
      assert.equal(viewed.gitOpacity, 1, `${where}: git's mark of a viewed file stays whole`);
      if (width === 200 && evidence) await page.locator(".review-tree-pane").screenshot({ path: join(evidence, "review-tree-viewed-200.png") });
    }

    // the tooltip: the row's path relative to the repository's root, on the tree's host
    const tooltip = async (target: ReturnType<typeof row>, expected: string, what: string): Promise<void> => {
      // from outside the tree, as a pointer comes to a row (one left still from the clicks above may not count as entering)
      await page.mouse.move(5, 5);
      await target.hover();
      const started = Date.now();
      for (;;) {
        const shown = await page.locator(".review-tree").getAttribute("title");
        if (shown === expected) return;
        assert.ok(Date.now() - started < 5_000, `${what}: ${JSON.stringify(shown)}`);
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      }
    };
    await tooltip(row(viewedPath), viewedPath, "a file row's tooltip is its path");
    // over the first segment of the flattened folder row: still the deepest folder
    await tooltip(page.locator(".review-tree [data-type='item']:has([data-item-flattened-subitems]):not([data-file-tree-sticky-row]) [data-item-flattened-subitem]").first(), deep, "a flattened folder row's tooltip is the deepest folder's path");
    await tooltip(row("README.md"), "README.md", "a root file's tooltip is its name");
    assert.deepEqual(errors, [], "viewed check: no page errors");
    await context.close();
  }
  // the tree's column: its default width, a grip that drags, steps and resets, and limits drawn but never stored
  {
    const KEY = "herdr-web-ui:review-tree-width";
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(() => localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en" })));
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
    const openReview = async (): Promise<void> => {
      await page.evaluate((directory) => window.reviewTreeQA.open("pane-review", directory), repo);
      await page.getByRole("dialog", { name: "Review", exact: true }).waitFor();
      await page.waitForFunction(() => (document.querySelector(".review-tree")?.shadowRoot?.querySelectorAll("[data-item-type='file']").length ?? 0) >= 4);
    };
    await page.goto(`http://127.0.0.1:${server.port}/`);
    await openReview();
    const grip = page.getByRole("separator", { name: "Resize file tree" });
    const stored = async (): Promise<string | null> => page.evaluate((key) => localStorage.getItem(key), KEY);
    /** The column as drawn and the body it is drawn in, once the layout settled. */
    const measure = async (): Promise<{ pane: number; body: number }> => page.evaluate(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return {
        pane: document.querySelector(".review-tree-pane")!.getBoundingClientRect().width,
        body: document.querySelector(".review-body")!.getBoundingClientRect().width,
      };
    });
    const near = (actual: number, expected: number, what: string): void => assert.ok(Math.abs(actual - expected) <= 1, `${what}: ${actual} is not ${expected}`);

    // the default: clamp(260px, 22%, 440px) of the body, nothing stored
    const start = await measure();
    const byDefault = Math.min(440, Math.max(260, start.body * 0.22));
    near(start.pane, byDefault, "the column starts at its default width");
    assert.equal(await stored(), null, "nothing is stored before the edge moves");
    // the grip sits on the column's right edge
    const box = (await grip.boundingBox())!;
    near(box.x + box.width / 2, (await page.locator(".review-tree-pane").boundingBox())!.x + start.pane, "the grip is centred on the column's edge");

    // a press that moves nothing stores nothing
    const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(middle.x, middle.y);
    await page.mouse.down();
    await page.mouse.up();
    assert.equal(await stored(), null, "a press without a move stores no width");
    // a drag moves the edge with the pointer and stores the width it ends at
    await page.mouse.move(middle.x, middle.y);
    await page.mouse.down();
    await page.mouse.move(middle.x + 50, middle.y, { steps: 5 });
    await page.mouse.move(middle.x + 100, middle.y, { steps: 5 });
    await page.mouse.up();
    const dragged = await measure();
    near(dragged.pane, byDefault + 100, "a drag widens the column by as much as the pointer moved");
    near(Number(await stored()), dragged.pane, "the dragged width is stored");
    if (evidence) await page.locator(".review-body").screenshot({ path: join(evidence, "review-tree-dragged.png") });
    // past the limits the drag stops: never under 200px, never over 640px here
    const now = (await grip.boundingBox())!;
    await page.mouse.move(now.x + now.width / 2, middle.y);
    await page.mouse.down();
    await page.mouse.move(5, middle.y, { steps: 10 });
    await page.mouse.up();
    near((await measure()).pane, 200, "a drag stops at the least width");
    assert.equal(await stored(), "200", "the least width is stored");

    // the keys, with the grip focused: 16px a press, Home and End to the limits
    await grip.focus();
    await page.keyboard.press("ArrowRight");
    near((await measure()).pane, 216, "ArrowRight widens the column by a step");
    assert.equal(await stored(), "216", "a key stores its width");
    await page.keyboard.press("ArrowLeft");
    near((await measure()).pane, 200, "ArrowLeft narrows it by a step");
    await page.keyboard.press("End");
    near((await measure()).pane, 640, "End widens it to the most");
    assert.equal(await grip.getAttribute("aria-valuenow"), "640", "the grip says the width it shows");
    assert.equal(await grip.getAttribute("aria-valuemax"), "640", "the grip says the widest it may be");
    await page.keyboard.press("Home");
    near((await measure()).pane, 200, "Home narrows it to the least");

    // a double-click forgets the width: the default again
    await grip.dblclick();
    near((await measure()).pane, byDefault, "a double-click resets the column");
    assert.equal(await stored(), null, "a double-click forgets the stored width");

    // a stored width wider than this window allows: drawn at the most it may be, kept for a wider window
    await page.evaluate((key) => localStorage.setItem(key, "900"), KEY);
    // landscape: a portrait window this narrow starts with the tree folded
    await page.setViewportSize({ width: 900, height: 700 });
    await page.reload();
    await openReview();
    const small = await measure();
    near(small.pane, Math.max(200, Math.min(640, small.body - 360)), "a narrow window draws a stored width at its most");
    assert.ok(small.pane + 360 <= small.body + 1, "the file keeps its room beside the column");
    assert.equal(await stored(), "900", "the stored width is kept");
    if (evidence) await page.locator(".review-body").screenshot({ path: join(evidence, "review-tree-capped.png") });
    await page.setViewportSize({ width: 1440, height: 900 });
    near((await measure()).pane, 640, "a wider window draws it wider again");
    assert.equal(await stored(), "900", "the stored width is still kept");

    // a folded tree stays folded, its width and grip with it
    await page.locator('.review-tree [data-item-path="README.md"]:not([data-file-tree-sticky-row])').click();
    await page.locator(".review-file-head").waitFor();
    await page.locator(".review-fold").click();
    await page.locator(".review-dialog[data-tree='folded']").waitFor();
    assert.equal(await grip.count(), 0, "a folded tree has no grip");
    assert.equal(await page.locator(".review-tree-pane").isVisible(), false, "a folded tree stays folded with a width stored");
    near((await page.locator(".review-file-pane").boundingBox())!.width, (await measure()).body, "the file takes the whole body");
    await page.locator(".review-fold").click();
    await grip.waitFor();

    // a phone: the tree or the file, no grip
    await page.setViewportSize({ width: 640, height: 900 });
    await page.locator(".review-back").click();
    await page.locator(".review-tree-pane").waitFor();
    assert.equal(await grip.count(), 0, "a phone has no grip");
    assert.deepEqual(errors, [], "column: no page errors");
    await context.close();
  }
  console.log("review tree: browser OK (front folders give way first to their first letter, the last folder and file names keep their end, short names whole; a level indents about 14px; Viewed is the file's last tool in every view; folders keep their state as viewed files drop out; every file viewed leaves a note and a way to show them again; a viewed file's check stays in sight, its name faded; rows show their path as a tooltip; the column drags, steps and resets, its limits drawn and never stored)");
} finally {
  await browser?.close(); server?.stop(true); rmSync(root, { recursive: true, force: true });
}
