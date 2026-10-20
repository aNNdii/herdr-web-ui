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
 * A viewed file that Show viewed files (off, in View options) drops leaves the folders as the reader opened and closed
 * them; a filter still opens the folders of its matches. Show viewed files is offered in Changed alone, Show ignored
 * files in All files alone, and the button carries a dot while an option is off its default; with every changed file viewed a
 * note says so (another under a filter), the file still shown listed under it, and Show viewed files lists them again. The shown file's own folder, closed by
 * the reader, stays closed as the file is marked viewed.
 *
 * A viewed file's check stays in sight however narrow the column, git's mark right of it, and its name fades in its colour; a
 * row's tooltip is its path (a flattened folder row's, its deepest folder's).
 *
 * The tree's column starts at its default width and has a grip on its right edge: a drag, the arrow keys, Home and
 * End move it, a double-click resets it, and only a real move stores a width. A stored width wider than the window
 * allows is drawn narrower and kept; a folded tree stays folded; a phone has no grip.
 *
 * Branches, on a repository of their own: the line under the title opens Compare's picker, whose Branches tab lists the
 * branches (worktree, then `hash · age · subject`); a branch chosen loads the comparison from the merge base at once, the
 * keyboard drives the pickers (filter, arrows, Enter on a branch or on free text, Escape for the picker alone, the focus
 * back on its part), and a refused name is said in red under the line, its part marked. A tap on an added, an unchanged and a removed line, in the unified and the split view,
 * each saves a comment whose quote names the version (`@ feat/x (hash) · worktree …`, or the base at the merge base);
 * the checks read the row numbers branch comments are placed by (unified: new numbers, a removed row its old one;
 * split: old numbers on the left). On a 390×844 phone a tap opens the picker as a bottom sheet, whose list scrolls alone and stays in the
 * visible area over a keyboard, and a tap on a branch chooses and loads it.
 *
 * Uncommitted is the first comparison: a staged, an unstaged, a partly staged and an untracked file are listed once
 * each, and a line of the new side takes a comment on the file on disk. Under Branches, a compare branch checked out
 * in a worktree is read there with its uncommitted changes while View options' Show uncommitted changes is on (the tree, the list and the title
 * are the worktree's; the branch list stays the pane's folder's), and from its commits alone once it is off. A
 * worktree that moved on to another branch is asked once, then left out with a note under the comparison, the branch list
 * read again. A bridge from before `uncommitted` gets its stand-ins and a note, and is asked them directly from then on.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Locator, type Page } from "playwright-core";
import { build as viteBuild } from "vite";
import { repoDiffResponse, type RepoDiffRoute } from "../server/repo-diff.ts";
import { serveStatic } from "../server/static.ts";
import { branchQuote, type BranchComment } from "../src/lib/branchComments.ts";

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

/** The file a branch changes: numbered lines, so each row's number can be read from its text. */
const BRANCH_FILE = "src/a.ts";
/** The pane whose review shows the branch fixture. */
const BRANCH_PANE = "pane-branches";
const numbered = (count: number): string[] => Array.from({ length: count }, (_, index) => `export const line${index + 1} = ${index + 1};`);
/** Branches enough that the field's list scrolls on a phone. */
const TOPICS = Array.from({ length: 40 }, (_, index) => `topic/${String(index).padStart(2, "0")}`);

/**
 * A repository checked out on `feat/x`, which branched from `main`: it adds two lines after line 5, changes line 10
 * and removes line 20 of {@link BRANCH_FILE}, so a line after the addition has a new number 2 above its old one. `main`
 * went on after the fork (`next.ts`), which a comparison from the merge base leaves out. `other` adds `other.ts` and is
 * checked out in a worktree of its own; the topic branches sit on the fork.
 */
function branchFixture(): { repo: string; worktree: string; fork: string; wip: string; gone: string } {
  const branches = join(root, "branches"), worktree = join(root, "wt-other"), wip = join(root, "wt-wip"), gone = join(root, "wt-gone");
  mkdirSync(join(branches, "src"), { recursive: true });
  git(branches, "init", "-q", "-b", "main");
  const lines = numbered(30);
  writeFileSync(join(branches, BRANCH_FILE), `${lines.join("\n")}\n`);
  writeFileSync(join(branches, "next.ts"), "one\n");
  git(branches, "add", ".");
  git(branches, "commit", "-q", "-m", "first");
  const fork = git(branches, "rev-parse", "HEAD").trim();
  for (const topic of TOPICS) git(branches, "branch", topic);
  git(branches, "branch", "other");
  writeFileSync(join(branches, "next.ts"), "two\n");
  git(branches, "commit", "-q", "-am", "main goes on");
  git(branches, "switch", "-q", "-c", "feat/x", fork);
  const changed = [...lines.slice(0, 5), "export const added1 = 1;", "export const added2 = 2;", ...lines.slice(5, 9), "export const line10 = 100;", ...lines.slice(10, 19), ...lines.slice(20)];
  writeFileSync(join(branches, BRANCH_FILE), `${changed.join("\n")}\n`);
  git(branches, "commit", "-q", "-am", "feature");
  git(branches, "worktree", "add", "-q", worktree, "other");
  writeFileSync(join(worktree, "other.ts"), "other\n");
  git(worktree, "add", ".");
  git(worktree, "commit", "-q", "-m", "other");
  // `wip` adds `wip.ts`, and its worktree holds an edit of it, a new `notes.md` and `next.ts` emptied (a removed line
  // only, which a comment on the file on disk cannot take), none committed
  git(branches, "worktree", "add", "-q", "-b", "wip", wip, fork);
  writeFileSync(join(wip, "wip.ts"), "one\n");
  git(wip, "add", ".");
  git(wip, "commit", "-q", "-m", "wip");
  writeFileSync(join(wip, "wip.ts"), "one\ntwo\n");
  writeFileSync(join(wip, "notes.md"), "draft\n");
  writeFileSync(join(wip, "next.ts"), "");
  // `gone` adds `gone.ts` in a worktree that moves on to another branch once the branch list named it
  git(branches, "worktree", "add", "-q", "-b", "gone", gone, fork);
  writeFileSync(join(gone, "gone.ts"), "gone\n");
  git(gone, "add", ".");
  git(gone, "commit", "-q", "-m", "gone");
  return { repo: branches, worktree, fork, wip, gone };
}

/** The pane whose review shows a file of each kind Uncommitted lists. */
const KINDS_PANE = "pane-kinds";
/** The line {@link kindsFixture} adds to `unstaged.ts`. */
const UNSTAGED_LINE = "export const unstaged = 4;";

/** A repository with a staged, an unstaged, a partly staged and an untracked file. */
function kindsFixture(): string {
  const kinds = join(root, "kinds");
  mkdirSync(kinds, { recursive: true });
  git(kinds, "init", "-q", "-b", "main");
  const lines = numbered(3).join("\n");
  for (const name of ["staged.ts", "unstaged.ts", "partial.ts"]) writeFileSync(join(kinds, name), `${lines}\n`);
  git(kinds, "add", ".");
  git(kinds, "commit", "-q", "-m", "first");
  writeFileSync(join(kinds, "staged.ts"), `${lines}\nexport const staged = 4;\n`);
  writeFileSync(join(kinds, "partial.ts"), `${lines}\nexport const partial = 4;\n`);
  git(kinds, "add", "staged.ts", "partial.ts");
  writeFileSync(join(kinds, "partial.ts"), `${lines}\nexport const partial = 4;\nexport const partial2 = 5;\n`);
  writeFileSync(join(kinds, "unstaged.ts"), `${lines}\n${UNSTAGED_LINE}\n`);
  writeFileSync(join(kinds, "untracked.ts"), "new\n");
  return kinds;
}

const repo = fixture();
const branchRepo = branchFixture();
const kindsRepo = kindsFixture();
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;

/** The routes the Review reads, on a stand-in that maps each pane to its fixture repository. */
async function api(url: URL): Promise<Response | null> {
  const diff = /^\/api\/workspace\/diff\/(files|file|tree|branches)$/.exec(url.pathname);
  if (diff) {
    // an absolute folder is read as asked (a worktree, a shown file's folder), as the server does; without one the
    // branch fixture's pane reviews its repository, the kinds pane its own, every other pane the deep one
    const directory = url.searchParams.get("directory") ?? "";
    const pane = url.searchParams.get("pane_id");
    const cwd = directory.startsWith("/") ? directory : pane === BRANCH_PANE ? branchRepo.repo : pane === KINDS_PANE ? kindsRepo : repo;
    return repoDiffResponse(diff[1] as RepoDiffRoute, cwd, url.searchParams);
  }
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

/** View options' row named `name` (ReviewOptions.tsx), its menu opened from the button when it is not open yet. */
async function viewOption(page: Page, name: string): Promise<Locator> {
  const button = page.getByRole("button", { name: "View options", exact: true });
  if (await button.getAttribute("aria-expanded") !== "true") await button.click();
  return page.getByRole("menu", { name: "View options", exact: true }).getByRole("menuitemcheckbox", { name, exact: true });
}
/** Toggles View options' row `name`, then closes the menu with Escape (the review stays open): whether it is on now. */
async function toggleViewOption(page: Page, name: string): Promise<boolean> {
  const row = await viewOption(page, name);
  await row.click();
  const on = await row.getAttribute("aria-checked") === "true";
  await closeViewOptions(page);
  return on;
}
/** Escape closes View options alone: the focus back on its button, the review still open. */
async function closeViewOptions(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await page.getByRole("menu", { name: "View options", exact: true }).waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "View options", "a closed View options gives the focus back to its button");
  assert.ok(await page.getByRole("dialog", { name: "Review", exact: true }).isVisible(), "Escape on View options leaves the review open");
}

/** A part of the comparison under the review's title (ComparePicker.tsx): `compare`, and under Branches `base`. */
const comparePart = (page: Page, part: "compare" | "base"): Locator => page.locator(`.review-meta .compare-part[data-part="${part}"]`);
/** Until the line under the title compares the branch `compare` with `base`. */
async function comparisonIs(page: Page, compare: string, base: string): Promise<void> {
  await page.waitForFunction(([compare, base]) => {
    const name = (part: string): string | null => document.querySelector(`.review-meta .compare-part[data-part="${part}"] .compare-part-name`)?.textContent ?? null;
    return name("compare") === compare && name("base") === base;
  }, [compare, base] as const);
}
/** Takes `name` as typed in a part's picker (Compare's on its Branches tab): Enter on its search field closes the picker. */
async function chooseBranch(page: Page, part: "compare" | "base", name: string): Promise<void> {
  const label = part === "compare" ? "Compare" : "Base";
  if (await comparePart(page, part).getAttribute("aria-expanded") !== "true") await comparePart(page, part).click();
  const picker = page.getByRole("dialog", { name: label, exact: true });
  const branches = picker.getByRole("group", { name: "Compare", exact: true }).getByRole("button", { name: "Branches", exact: true });
  if (part === "compare" && await branches.getAttribute("aria-pressed") !== "true") await branches.click();
  const search = picker.getByRole("combobox", { name: label, exact: true });
  await search.fill(name);
  await search.press("Enter");
  await picker.waitFor({ state: "detached" });
}
/** Compares `tip` (Compare's picker: its tab, then its row). */
async function chooseTip(page: Page, tip: "Uncommitted" | "Staged"): Promise<void> {
  await comparePart(page, "compare").click();
  const picker = page.getByRole("dialog", { name: "Compare", exact: true });
  await picker.getByRole("group", { name: "Compare", exact: true }).getByRole("button", { name: tip, exact: true }).click();
  await picker.locator(".compare-picker-tip").click();
  await picker.waitFor({ state: "detached" });
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
    assert.equal(await toggleViewOption(page, "Show viewed files"), false, "Show viewed files turns off");
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
    const note = page.locator(".review-list-note");
    const dot = page.locator(".review-options .review-options-dot");
    // All files offers Show ignored files (off) and not Show viewed files (nothing there is hidden); Changed with stamps
    // the other way round. Every option at its default: no dot
    await dialog.getByRole("button", { name: "All files", exact: true }).click();
    const ignored = await viewOption(page, "Show ignored files");
    assert.equal(await ignored.getAttribute("aria-checked"), "false", "Show ignored files starts off");
    assert.equal(await (await viewOption(page, "Show viewed files")).count(), 0, "All files has no Show viewed files");
    await closeViewOptions(page);
    assert.equal(await dot.count(), 0, "no dot while every option is at its default");
    await dialog.getByRole("button", { name: "Changed files" }).click();
    assert.equal(await (await viewOption(page, "Show ignored files")).count(), 0, "Changed files has no Show ignored files");
    await closeViewOptions(page);
    assert.equal(await toggleViewOption(page, "Show viewed files"), false, "Show viewed files turns off");
    assert.equal(await dot.count(), 1, "a dot while Show viewed files is off");
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
    assert.equal(await (await viewOption(page, "Show viewed files")).getAttribute("aria-checked"), "true", "Show viewed files turns the option back on");
    await closeViewOptions(page);
    assert.equal(await dot.count(), 0, "the dot leaves with the option back at its default");
    await listedUntil(page, "Show viewed files lists every changed file again", (shown) => changed.every((path) => shown.includes(path)));
    assert.equal(await note.count(), 0, "the note leaves with the toggle off");
    assert.equal(await page.evaluate(() => localStorage.getItem("herdr-web-ui:review-hide-viewed")), null, "Show viewed files is stored on (nothing hidden)");
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
    assert.equal(await toggleViewOption(page, "Show viewed files"), false, "Show viewed files turns off");
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
    assert.equal(await toggleViewOption(page, "Show viewed files"), true, "Show viewed files turns on again");
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
  // Branches: a branch from Compare's picker loads the comparison from the merge base at once, a keyboard drives the pickers, and every line of the
  // diff takes a comment, in both layouts, whose head names the version it is on
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(() => localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en", commentMode: true, mobileCommentGesture: "tap", diffStyle: "unified" })));
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    // the unknown name below is refused with a 404, which the browser logs
    page.on("console", (message) => { if (message.type() === "error" && !message.text().includes("status of 404")) errors.push(`console: ${message.text()}`); });
    // the lists the review asks for, as `scope head`: the uncommitted changes once per open, a branch comparison once per choice
    const asked: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/workspace/diff/files" && url.searchParams.get("pane_id") === BRANCH_PANE) asked.push(`${url.searchParams.get("scope")} ${url.searchParams.get("head") ?? ""}`.trim());
    });
    const treed = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/workspace/diff/tree" && url.searchParams.get("pane_id") === BRANCH_PANE;
    });
    await page.goto(`http://127.0.0.1:${server.port}/`);
    await page.evaluate(([pane, directory]) => window.reviewTreeQA.open(pane!, directory!), [BRANCH_PANE, branchRepo.repo]);
    const dialog = page.getByRole("dialog", { name: "Review", exact: true });
    await dialog.waitFor();
    // the tree's answer names the branch checked out, which leaves the uncommitted comparison as it was
    await treed;
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.deepEqual(asked, ["uncommitted"], "the uncommitted list loads once; the tree's answer does not load it again");
    const compare = comparePart(page, "compare"), base = comparePart(page, "base");
    const picker = page.getByRole("dialog", { name: "Compare", exact: true });
    const branchesTab = picker.getByRole("group", { name: "Compare", exact: true }).getByRole("button", { name: "Branches", exact: true });
    const search = picker.getByRole("combobox", { name: "Compare", exact: true });
    const listbox = picker.getByRole("listbox", { name: "Compare", exact: true });
    const comparing = async (head: string, files: string[]): Promise<void> => {
      await comparisonIs(page, head, "main");
      await listedUntil(page, `${head} vs main lists its own changes`, (shown) => JSON.stringify(shown) === JSON.stringify(files));
    };
    assert.equal(await compare.textContent(), "Uncommitted changes", "the line under the title starts on the uncommitted changes");
    // Compare's picker: its Branches tab lists the branches, the focus in its search field
    await compare.click();
    assert.equal(await compare.getAttribute("aria-expanded"), "true", "a click opens the picker under its part");
    await branchesTab.click();
    await listbox.getByRole("option").first().waitFor();
    assert.ok(await search.evaluate((node) => node === document.activeElement), "the Branches tab puts the focus in its search field");
    // the rows: the review's own checkout is this worktree, one checked out elsewhere names its folder, each its tip commit
    const hereMeta = await listbox.getByRole("option", { name: /^feat\/x/ }).locator(".compare-picker-meta").textContent();
    const featHash = git(branchRepo.repo, "rev-parse", "feat/x").trim().slice(0, 7);
    assert.match(hereMeta ?? "", new RegExp(`^this worktree · ${featHash} · (just now|\\d+ minutes? ago) · feature$`), "a row names its worktree, then its commit as hash · age · subject");
    const elsewhere = listbox.getByRole("option", { name: /^other/ }).locator(".compare-picker-worktree");
    assert.deepEqual([await elsewhere.textContent(), await elsewhere.getAttribute("title")], ["wt-other", branchRepo.worktree], "a branch checked out elsewhere names its worktree, its path as the tooltip");
    // the keyboard: typing filters the list, the arrows move, Escape closes the picker alone and gives the focus back
    await page.keyboard.type("othe");
    assert.deepEqual(await listbox.getByRole("option").locator(".compare-picker-name").allTextContents(), ["other"], "typing filters the list");
    await page.keyboard.press("ArrowDown");
    const active = await search.getAttribute("aria-activedescendant");
    assert.ok(active !== null && (await page.locator(`[id="${active}"] .compare-picker-name`).textContent()) === "other", `ArrowDown makes the match active: ${active}`);
    await page.keyboard.press("Escape");
    await picker.waitFor({ state: "detached" });
    assert.equal(await compare.getAttribute("aria-expanded"), "false", "Escape closes the picker");
    assert.ok(await dialog.isVisible(), "Escape on an open picker leaves the review open");
    assert.ok(await compare.evaluate((node) => node === document.activeElement), "a closed picker gives the focus back to its part");
    assert.equal(await compare.textContent(), "Uncommitted changes", "a closed picker leaves the comparison as it was");
    // Enter takes the active branch and compares it with the default base from their merge base at once; main's own
    // commit after the fork is not listed
    await compare.click();
    await branchesTab.click();
    await page.keyboard.type("feat/x");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await comparing("feat/x", [BRANCH_FILE]);
    // the branch checked out here is read with its uncommitted changes, Show uncommitted changes on and naming this worktree
    const here = await viewOption(page, "Show uncommitted changes");
    assert.equal(await here.getAttribute("aria-checked"), "true", "Show uncommitted changes starts on");
    assert.equal(await dialog.locator(`[id="${await here.getAttribute("aria-describedby")}"]`).textContent(), "Not yet committed in this worktree", "Show uncommitted changes names the review's own checkout");
    await closeViewOptions(page);
    assert.ok(asked.includes("uncommitted feat/x"), `the branch here is asked with its uncommitted changes: ${JSON.stringify(asked)}`);

    // under Branches the picker opens on its list, the branch compared checked; Enter takes the active branch
    await compare.click();
    assert.equal(await listbox.getByRole("option", { selected: true }).locator(".compare-picker-name").textContent(), "feat/x", "the branch compared is checked");
    await page.keyboard.type("othe");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await comparing("other", ["other.ts"]);
    // the same name chosen again loads again: the only way to pick up commits made since
    const again = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return url.pathname === "/api/workspace/diff/files" && url.searchParams.get("head") === "other";
    }, { timeout: 3000 });
    await chooseBranch(page, "compare", "other");
    await again;
    await comparing("other", ["other.ts"]);
    // Enter on free text takes the text as typed; an unknown one is refused in red under the line, its part marked
    await chooseBranch(page, "base", "nope");
    const refusal = dialog.locator(".review-compare-error");
    assert.equal(await refusal.textContent(), "No commit by that name.", "an unknown base is refused under the line");
    assert.equal(await refusal.getAttribute("role"), "alert", "the refusal is said as an error");
    assert.deepEqual([await base.getAttribute("aria-invalid"), await base.getAttribute("aria-describedby")], ["true", await refusal.getAttribute("id")], "the refused part says so, described by the refusal");
    await chooseBranch(page, "base", "main");
    await chooseBranch(page, "compare", "feat/x");
    await comparing("feat/x", [BRANCH_FILE]);
    assert.equal(await refusal.count(), 0, "a known base clears the refusal");

    // branch comments need the commits alone: Show uncommitted changes off, the comparison from the merge base to the branch's tip
    const commits = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/workspace/diff/files" && url.searchParams.get("scope") === "commit" && url.searchParams.get("head") === "feat/x";
    });
    assert.equal(await toggleViewOption(page, "Show uncommitted changes"), false, "Show uncommitted changes is off");
    await commits;
    await comparing("feat/x", [BRANCH_FILE]);

    // comments on every kind of line: a tap (the touch gesture, here from a desktop) on a row of the diff
    const headHash = git(branchRepo.repo, "rev-parse", "feat/x").trim();
    await page.locator(`.review-tree [data-item-path="${BRANCH_FILE}"]:not([data-file-tree-sticky-row])`).click();
    await page.locator(".review-file[data-mode='diff'] .repo-diff-styles").waitFor();
    /** The rows drawn for a line's text, in the shadow root: their number, kind, and whether they are in the split view's left column. */
    const rowsOf = async (text: string): Promise<{ line: number; type: string; left: boolean }[]> => page.evaluate((text) =>
      [...document.querySelector(".review-file diffs-container")?.shadowRoot?.querySelectorAll<HTMLElement>("[data-line][data-line-type]") ?? []]
        .filter((row) => row.textContent === text)
        .map((row) => ({ line: Number(row.dataset["line"]), type: row.dataset["lineType"] ?? "", left: row.closest("[data-deletions]") !== null })), text);
    const rowsUntil = async (text: string, count: number): Promise<{ line: number; type: string; left: boolean }[]> => {
      const started = Date.now();
      for (;;) {
        const rows = await rowsOf(text);
        if (rows.length >= count) return rows;
        assert.ok(Date.now() - started < 10_000, `the diff draws ${count} row(s) of ${text}: ${JSON.stringify(rows)}`);
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      }
    };
    const line = (n: number): string => `export const line${n} = ${n};`;
    /** The branch comments the store holds for the pane, in the order they were saved. */
    const stored = async (): Promise<BranchComment[]> => page.evaluate(() => {
      const found: BranchComment[] = [];
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index)!;
        if (!key.startsWith("herdr-web-ui:block-comments:")) continue;
        for (const comment of (JSON.parse(localStorage.getItem(key)!) as { comments: BranchComment[] }).comments) if (comment.kind === "branch") found.push(comment);
      }
      return found.sort((a, b) => a.created - b.created);
    });
    /** A tap on the row of `text` (in the left column, or not), the comment written and saved: the stored comment's quote, as a send writes it. */
    const commentOn = async (text: string, left: boolean, note: string): Promise<{ quote: string; comment: BranchComment }> => {
      const before = (await stored()).length;
      const tapped = await page.evaluate(([text, left]) => {
        const row = [...document.querySelector(".review-file diffs-container")!.shadowRoot!.querySelectorAll<HTMLElement>("[data-line][data-line-type]")]
          .find((one) => one.textContent === text && (one.closest("[data-deletions]") !== null) === left);
        if (row === undefined) return false;
        const box = row.getBoundingClientRect();
        const at = { bubbles: true, composed: true, pointerType: "touch", isPrimary: true, clientX: box.left + 40, clientY: box.top + box.height / 2 };
        row.dispatchEvent(new PointerEvent("pointerdown", at));
        row.dispatchEvent(new PointerEvent("pointerup", at));
        return true;
      }, [text, left] as const);
      assert.ok(tapped, `a row of ${text} is drawn${left ? " in the left column" : ""}`);
      const field = page.locator("[data-draft] textarea");
      await field.fill(note);
      await field.press("Enter");
      await field.waitFor({ state: "detached" });
      const all = await stored();
      assert.equal(all.length, before + 1, `a comment on ${text} is stored`);
      const comment = all.at(-1)!;
      return { quote: branchQuote(comment), comment };
    };
    const onHead = (lines: string, text: string): string => `> ${BRANCH_FILE}:${lines} @ feat/x (${headHash.slice(0, 7)}) · worktree ${branchRepo.repo}\n> ${text}`;
    const onBase = (lines: string, text: string): string => `> ${BRANCH_FILE}:${lines} @ main (${branchRepo.fork.slice(0, 7)})\n> ${text}`;

    // unified: a context row carries the new number, a removed row the old one
    assert.deepEqual(await rowsUntil(line(12), 1), [{ line: 14, type: "context", left: false }], "unified: an unchanged row carries its new number");
    assert.deepEqual(await rowsOf(line(20)), [{ line: 20, type: "change-deletion", left: false }], "unified: a removed row carries its old number");
    assert.equal((await commentOn("export const added1 = 1;", false, "Why two?")).quote, onHead("6", "export const added1 = 1;"), "unified: a comment on an added line");
    assert.equal((await commentOn(line(12), false, "Still needed?")).quote, onHead("14", line(12)), "unified: a comment on an unchanged line is on the head's line");
    const removed = await commentOn(line(20), false, "Why removed?");
    assert.equal(removed.quote, onBase("20", line(20)), "unified: a comment on a removed line names the base at the merge base");
    // the removed line's comment is drawn under its own row
    const under = await page.evaluate(([text, note]) => {
      const row = [...document.querySelector(".review-file diffs-container")!.shadowRoot!.querySelectorAll<HTMLElement>("[data-line][data-line-type]")].find((one) => one.textContent === text)!;
      const card = [...document.querySelectorAll<HTMLElement>(".review-file .review-note")].find((one) => one.textContent?.includes(note));
      return card === undefined ? null : { row: row.getBoundingClientRect().bottom, card: card.getBoundingClientRect().top };
    }, [line(20), "Why removed?"] as const);
    assert.ok(under !== null && under.card >= under.row - 1 && under.card <= under.row + 16, `unified: the removed line's comment is drawn under its row: ${JSON.stringify(under)}`);
    if (evidence) await page.locator(".review-file").screenshot({ path: join(evidence, "review-branch-unified.png") });

    // split: the left column carries the old numbers, the right the new
    await page.locator(".repo-diff-styles").getByRole("button", { name: "Split" }).click();
    const split = await rowsUntil(line(8), 2);
    assert.deepEqual(split.map(({ line: n, left }) => [n, left]).sort(), [[10, false], [8, true]].sort(), `split: an unchanged line is 8 on the left, 10 on the right: ${JSON.stringify(split)}`);
    assert.deepEqual((await rowsOf(line(10))).map(({ line: n, left }) => [n, left]), [[10, true]], "split: the removed line is on the left, by its old number");
    assert.equal((await commentOn("export const line10 = 100;", false, "Why 100?")).quote, onHead("12", "export const line10 = 100;"), "split: a comment on an added line");
    assert.equal((await commentOn(line(8), true, "Left side.")).quote, onHead("10", line(8)), "split: an unchanged line picked on the left is the head's line");
    assert.equal((await commentOn(line(10), true, "Old value.")).quote, onBase("10", line(10)), "split: a comment on a removed line");
    if (evidence) await page.locator(".review-file").screenshot({ path: join(evidence, "review-branch-split.png") });
    // every comment is drawn in the diff
    for (const note of ["Why two?", "Still needed?", "Why removed?", "Why 100?", "Left side.", "Old value."]) {
      await page.locator(".review-file .review-note", { hasText: note }).waitFor();
    }
    assert.deepEqual(errors, [], "branches: no page errors");
    await context.close();
  }
  // Branches while the branch list is still on its way: free text loads at once, without waiting for the list
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(() => localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en" })));
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let release = (): void => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.route((url) => url.pathname === "/api/workspace/diff/branches", async (route) => { await held; await route.continue(); });
    await page.goto(`http://127.0.0.1:${server.port}/`);
    await page.evaluate(([pane, directory]) => window.reviewTreeQA.open(pane!, directory!), [BRANCH_PANE, branchRepo.repo]);
    const dialog = page.getByRole("dialog", { name: "Review", exact: true });
    await dialog.waitFor();
    await chooseBranch(page, "compare", "other");
    await comparisonIs(page, "other", "main");
    await listedUntil(page, "free text loads while the branch list is held", (shown) => JSON.stringify(shown) === JSON.stringify(["other.ts"]));
    release();
    assert.deepEqual(errors, [], "branches, list held: no page errors");
    await context.close();
  }
  // Branches on a phone: a tap on the comparison's part opens its picker as a bottom sheet, whose list scrolls alone and
  // stays in the visible area as a keyboard takes the bottom, and a tap on a branch chooses and loads it
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await context.addInitScript(() => localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en" })));
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
    await page.goto(`http://127.0.0.1:${server.port}/`);
    await page.evaluate(([pane, directory]) => window.reviewTreeQA.open(pane!, directory!), [BRANCH_PANE, branchRepo.repo]);
    const dialog = page.getByRole("dialog", { name: "Review", exact: true });
    await dialog.waitFor();
    const compare = comparePart(page, "compare");
    await compare.tap();
    assert.equal(await compare.getAttribute("aria-expanded"), "true", "phone: a tap opens the picker");
    const picker = page.getByRole("dialog", { name: "Compare", exact: true });
    await picker.getByRole("group", { name: "Compare", exact: true }).getByRole("button", { name: "Branches", exact: true }).tap();
    const list = picker.getByRole("listbox", { name: "Compare", exact: true });
    await list.getByRole("option").first().waitFor();
    /** The scroll places of the list, the page and every scroll box of the review. */
    const places = async (): Promise<{ list: number; others: number[] }> => page.evaluate(() => ({
      list: document.querySelector<HTMLElement>(".compare-picker-list[role='listbox']")!.scrollTop,
      others: [document.scrollingElement!.scrollTop, ...[...document.querySelectorAll<HTMLElement>(".review-dialog, .review-dialog *")].filter((one) => !one.matches(".compare-picker-list[role='listbox']")).map((one) => one.scrollTop)],
    }));
    // the sheet where it settled, once it has risen
    let sheet = (await picker.boundingBox())!;
    for (let frame = 0; frame < 60; frame++) {
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const now = (await picker.boundingBox())!;
      if (JSON.stringify(now) === JSON.stringify(sheet)) break;
      sheet = now;
    }
    assert.ok(Math.abs(sheet.x) <= 0.5 && Math.abs(sheet.width - 390) <= 0.5 && Math.abs(sheet.y + sheet.height - 844) <= 1, `phone: the picker is a bottom sheet across the screen: ${JSON.stringify(sheet)}`);
    const box = (await list.boundingBox())!;
    const before = await places();
    // a finger's swipe up the list, then a long one past its end: the scroll stays in the list
    const cdp = await context.newCDPSession(page);
    const swipe = async (distance: number): Promise<void> => {
      const x = box.x + box.width / 2, from = box.y + box.height - 20;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: from }] });
      for (let step = 1; step <= 10; step++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: from - distance * step / 10 }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    };
    await swipe(Math.min(300, box.height - 40));
    assert.ok((await places()).list > before.list, "phone: a swipe scrolls the list");
    for (let time = 0; time < 4; time++) await swipe(box.height - 40);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const after = await places();
    assert.ok(after.list > before.list, `phone: the list scrolls: ${before.list} → ${after.list}`);
    assert.deepEqual(after.others, before.others, "phone: nothing under the list scrolls with it");
    if (evidence) await page.screenshot({ path: join(evidence, "review-branch-phone-list.png") });

    // a soft keyboard takes the bottom of the screen: the list stays above it
    await page.setViewportSize({ width: 390, height: 480 });
    const menuInView = async (): Promise<{ top: number; bottom: number; height: number; view: number }> => page.evaluate(() => {
      const menu = document.querySelector<HTMLElement>(".compare-picker")!.getBoundingClientRect();
      const view = window.visualViewport;
      return { top: menu.top, bottom: menu.bottom, height: menu.height, view: view === null ? window.innerHeight : view.offsetTop + view.height };
    });
    const started = Date.now();
    let inView = await menuInView();
    while (inView.bottom > inView.view + 0.5 && Date.now() - started < 5_000) {
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      inView = await menuInView();
    }
    assert.ok(inView.top >= -0.5 && inView.bottom <= inView.view + 0.5 && inView.height >= 80, `phone: the open list stays in the visible area over a keyboard: ${JSON.stringify(inView)}`);
    if (evidence) await page.screenshot({ path: join(evidence, "review-branch-phone-keyboard.png") });
    await page.setViewportSize({ width: 390, height: 844 });

    // a tap on a branch chooses it, closes the picker and loads it
    await list.getByRole("option", { name: /^other/ }).tap();
    await picker.waitFor({ state: "detached" });
    assert.equal(await compare.getAttribute("aria-expanded"), "false", "phone: a tap on a branch closes the picker");
    await comparisonIs(page, "other", "main");
    await listedUntil(page, "phone: the tapped branch's changes load", (shown) => JSON.stringify(shown) === JSON.stringify(["other.ts"]));
    assert.deepEqual(errors, [], "branches on a phone: no page errors");
    await context.close();
  }
  // A, Uncommitted: every kind of change not committed is listed once, and a line of the new side takes a comment on
  // the file on disk
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(() => localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en", commentMode: true, mobileCommentGesture: "tap", diffStyle: "unified" })));
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
    await page.goto(`http://127.0.0.1:${server.port}/`);
    await page.evaluate(([pane, directory]) => window.reviewTreeQA.open(pane!, directory!), [KINDS_PANE, kindsRepo]);
    const dialog = page.getByRole("dialog", { name: "Review", exact: true });
    await dialog.waitFor();
    assert.equal(await comparePart(page, "compare").textContent(), "Uncommitted changes", "uncommitted: the line under the title compares the uncommitted changes first");
    await comparePart(page, "compare").click();
    const comparePicker = page.getByRole("dialog", { name: "Compare", exact: true });
    const segments = comparePicker.getByRole("group", { name: "Compare", exact: true }).getByRole("button");
    assert.deepEqual(await segments.allTextContents(), ["Uncommitted", "Staged", "Branches"], "uncommitted: Compare offers exactly three comparisons");
    assert.equal(await segments.first().getAttribute("aria-pressed"), "true", "uncommitted: Uncommitted is the first comparison");
    await page.keyboard.press("Escape");
    await comparePicker.waitFor({ state: "detached" });
    const kinds = ["partial.ts", "staged.ts", "unstaged.ts", "untracked.ts"];
    await listedUntil(page, "uncommitted: a staged, an unstaged, a partly staged and an untracked file, once each", (shown) => JSON.stringify([...shown].sort()) === JSON.stringify(kinds));
    await page.locator('.review-tree [data-item-path="unstaged.ts"]:not([data-file-tree-sticky-row])').click();
    await page.locator(".review-file[data-mode='diff'] .repo-diff-styles").waitFor();
    await page.waitForFunction((text) => [...document.querySelector(".review-file diffs-container")?.shadowRoot?.querySelectorAll<HTMLElement>("[data-line][data-line-type]") ?? []].some((row) => row.textContent === text), UNSTAGED_LINE);
    await page.evaluate((text) => {
      const row = [...document.querySelector(".review-file diffs-container")!.shadowRoot!.querySelectorAll<HTMLElement>("[data-line][data-line-type]")].find((one) => one.textContent === text)!;
      const box = row.getBoundingClientRect();
      const at = { bubbles: true, composed: true, pointerType: "touch", isPrimary: true, clientX: box.left + 40, clientY: box.top + box.height / 2 };
      row.dispatchEvent(new PointerEvent("pointerdown", at));
      row.dispatchEvent(new PointerEvent("pointerup", at));
    }, UNSTAGED_LINE);
    const field = page.locator("[data-draft] textarea");
    await field.fill("Why four?");
    await field.press("Enter");
    await field.waitFor({ state: "detached" });
    const saved = await page.evaluate(() => {
      const found: { kind: string; path?: string; comment: string }[] = [];
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index)!;
        if (key.startsWith("herdr-web-ui:block-comments:")) found.push(...(JSON.parse(localStorage.getItem(key)!) as { comments: { kind: string; path?: string; comment: string }[] }).comments);
      }
      return found.map(({ kind, path, comment }) => ({ kind, path, comment }));
    });
    assert.deepEqual(saved, [{ kind: "file", path: join(kindsRepo, "unstaged.ts"), comment: "Why four?" }], "uncommitted: a comment on an added line is on the file on disk");
    assert.deepEqual(errors, [], "uncommitted: no page errors");
    await context.close();
  }
  // B, a worktree's uncommitted changes: the switch reads compare's worktree, the whole review with it; off, the commits
  // alone from the pane's folder. The branch list is the pane's folder's either way
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(() => localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en", commentMode: true, mobileCommentGesture: "tap", diffStyle: "unified" })));
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
    // the lists asked for compare `wip`, as `scope directory`, and the folder of every branch list
    const lists: string[] = [];
    const branchFolders = new Set<string>();
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/workspace/diff/files" && url.searchParams.get("head") === "wip") lists.push(`${url.searchParams.get("scope")} ${url.searchParams.get("directory")}`);
      if (url.pathname === "/api/workspace/diff/branches") branchFolders.add(url.searchParams.get("directory") ?? "");
    });
    await page.goto(`http://127.0.0.1:${server.port}/`);
    await page.evaluate(([pane, directory]) => window.reviewTreeQA.open(pane!, directory!), [BRANCH_PANE, branchRepo.repo]);
    const dialog = page.getByRole("dialog", { name: "Review", exact: true });
    await dialog.waitFor();
    await chooseBranch(page, "compare", "wip");
    await comparisonIs(page, "wip", "main");
    const including = await viewOption(page, "Show uncommitted changes");
    assert.equal(await including.getAttribute("aria-checked"), "true", "worktree: Show uncommitted changes starts on");
    const description = dialog.locator(`[id="${await including.getAttribute("aria-describedby")}"]`);
    assert.deepEqual([await description.textContent(), await including.getAttribute("title")], ["Not yet committed in wt-wip", branchRepo.wip], "worktree: the option names compare's worktree in its description, its path as the tooltip");
    await closeViewOptions(page);
    const title = dialog.locator(".review-title .modal-title");
    await listedUntil(page, "worktree: its commit, its edit and its new file", (shown) => JSON.stringify([...shown].sort()) === JSON.stringify(["next.ts", "notes.md", "wip.ts"]));
    assert.equal(await title.textContent(), "wt-wip", "worktree: the title is the worktree's");
    assert.equal(await toggleViewOption(page, "Show uncommitted changes"), false, "worktree: Show uncommitted changes turns off");
    await listedUntil(page, "worktree off: the branch's commits alone", (shown) => JSON.stringify(shown) === JSON.stringify(["wip.ts"]));
    assert.equal(await title.textContent(), "branches", "worktree off: the title is the pane's repository's");
    assert.equal(await toggleViewOption(page, "Show uncommitted changes"), true, "worktree: Show uncommitted changes turns on again");
    await listedUntil(page, "worktree on again", (shown) => JSON.stringify([...shown].sort()) === JSON.stringify(["next.ts", "notes.md", "wip.ts"]));
    assert.equal(await title.textContent(), "wt-wip", "worktree on again: the title is the worktree's");
    // a removed line is refused (the comment would go on the file on disk), and the hint names the way out
    await page.locator('.review-tree [data-item-path="next.ts"]:not([data-file-tree-sticky-row])').click();
    await page.locator(".review-file[data-mode='diff'] .repo-diff-styles").waitFor();
    await page.waitForFunction(() => [...document.querySelector(".review-file diffs-container")?.shadowRoot?.querySelectorAll<HTMLElement>("[data-line][data-line-type='change-deletion']") ?? []].some((row) => row.textContent === "one"));
    await page.evaluate(() => {
      const row = [...document.querySelector(".review-file diffs-container")!.shadowRoot!.querySelectorAll<HTMLElement>("[data-line][data-line-type='change-deletion']")].find((one) => one.textContent === "one")!;
      const box = row.getBoundingClientRect();
      const at = { bubbles: true, composed: true, pointerType: "touch", isPrimary: true, clientX: box.left + 40, clientY: box.top + box.height / 2 };
      row.dispatchEvent(new PointerEvent("pointerdown", at));
      row.dispatchEvent(new PointerEvent("pointerup", at));
    });
    await dialog.locator(".review-file-hint").getByText("Comments go on lines of the file as it is now, not on removed ones. Turn off “Show uncommitted changes” in View options to comment on removed lines.").waitFor();
    assert.equal(await page.locator("[data-draft] textarea").count(), 0, "worktree: a removed line takes no comment while Show uncommitted changes is on");
    assert.deepEqual(lists, [`uncommitted ${branchRepo.wip}`, `commit ${branchRepo.repo}`, `uncommitted ${branchRepo.wip}`], "worktree: on reads the worktree, off the pane's folder");
    assert.deepEqual([...branchFolders], [branchRepo.repo], "worktree: the branch list stays the pane's folder's");
    assert.deepEqual(errors, [], "worktree: no page errors");
    await context.close();
  }
  // C, a worktree that moved on: asked once, refused, then compared without it, the note under the comparison, the branch list
  // read once more and the switch gone
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(() => localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en" })));
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    // the refusal is a 409, which the browser logs
    page.on("console", (message) => { if (message.type() === "error" && !message.text().includes("status of 409")) errors.push(`console: ${message.text()}`); });
    const lists: string[] = [];
    let branchLists = 0;
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/workspace/diff/files" && url.searchParams.get("head") === "gone") lists.push(`${url.searchParams.get("scope")} gone`);
      if (url.pathname === "/api/workspace/diff/branches") branchLists += 1;
    });
    const branchesAnswered = (): Promise<unknown> => page.waitForResponse((response) => new URL(response.url()).pathname === "/api/workspace/diff/branches");
    await page.goto(`http://127.0.0.1:${server.port}/`);
    await page.evaluate(([pane, directory]) => window.reviewTreeQA.open(pane!, directory!), [BRANCH_PANE, branchRepo.repo]);
    const dialog = page.getByRole("dialog", { name: "Review", exact: true });
    await dialog.waitFor();
    // Compare's Branches tab reads the branch list
    const listed1 = branchesAnswered();
    await comparePart(page, "compare").click();
    await page.getByRole("dialog", { name: "Compare", exact: true }).getByRole("group", { name: "Compare", exact: true }).getByRole("button", { name: "Branches", exact: true }).click();
    await listed1;
    // the worktree moves on after the branch list named it
    git(branchRepo.gone, "switch", "-q", "-c", "gone-elsewhere");
    const listed2 = branchesAnswered();
    await chooseBranch(page, "compare", "gone");
    await comparisonIs(page, "gone", "main");
    const note = dialog.locator(".review-compare-note[role='status']");
    const moved = "gone is no longer checked out in its worktree, so uncommitted changes are left out.";
    await note.getByText(moved, { exact: true }).waitFor();
    await listed2;
    await listedUntil(page, "moved: the branch's commits alone", (shown) => JSON.stringify(shown) === JSON.stringify(["gone.ts"]));
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.deepEqual(lists, ["uncommitted gone", "commit gone"], "moved: the worktree is asked once, then the commits alone");
    assert.equal(branchLists, 2, "moved: the branch list is read once more");
    assert.equal(await (await viewOption(page, "Show uncommitted changes")).count(), 0, "moved: Show uncommitted changes is gone with the worktree");
    await closeViewOptions(page);
    assert.equal(await note.textContent(), moved, "moved: the note stays once the branch list is read again");
    assert.equal(await note.getAttribute("role"), "status", "moved: the note is a status, not an alert");
    assert.equal(await dialog.getByRole("alert").count(), 0, "moved: nothing is said as an error");
    assert.deepEqual(errors, [], "moved: no page errors");
    await context.close();
  }
  // D, a bridge from before `uncommitted`: it refuses the scope once, its stand-ins are read and said under the comparison, and
  // asked directly from then on
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(() => localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en" })));
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    // the refusal is a 400, which the browser logs
    page.on("console", (message) => { if (message.type() === "error" && !message.text().includes("status of 400")) errors.push(`console: ${message.text()}`); });
    await page.route((url) => url.pathname === "/api/workspace/diff/files" && url.searchParams.get("scope") === "uncommitted", (route) => route.fulfill({
      status: 400, contentType: "application/json",
      body: JSON.stringify({ error: { code: "invalid_scope", message: "scope must be workspace, staged or commit" } }),
    }));
    const asked: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/workspace/diff/files") asked.push(`${url.searchParams.get("scope")} ${url.searchParams.get("head") ?? ""}`.trim());
    });
    await page.goto(`http://127.0.0.1:${server.port}/`);
    await page.evaluate(([pane, directory]) => window.reviewTreeQA.open(pane!, directory!), [BRANCH_PANE, branchRepo.repo]);
    const dialog = page.getByRole("dialog", { name: "Review", exact: true });
    await dialog.waitFor();
    const note = dialog.locator(".review-compare-note[role='status']");
    await note.getByText("This PC's bridge leaves out staged changes.", { exact: true }).waitFor();
    await dialog.locator(".review-list-note").getByText("No unstaged changes.", { exact: true }).waitFor();
    assert.deepEqual(asked, ["uncommitted", "workspace"], "older bridge: refused once, then the unstaged changes");
    await chooseTip(page, "Staged");
    await chooseTip(page, "Uncommitted");
    await note.getByText("This PC's bridge leaves out staged changes.", { exact: true }).waitFor();
    await chooseBranch(page, "compare", "feat/x");
    await comparisonIs(page, "feat/x", "main");
    await note.getByText("This PC's bridge compares only commits.", { exact: true }).waitFor();
    await listedUntil(page, "older bridge: the branch's commits", (shown) => JSON.stringify(shown) === JSON.stringify([BRANCH_FILE]));
    assert.deepEqual(asked, ["uncommitted", "workspace", "staged", "workspace", "commit feat/x"], "older bridge: the stand-ins are asked directly once refused");
    assert.equal(await note.getAttribute("role"), "status", "older bridge: the note is a status, not an alert");
    assert.equal(await (await viewOption(page, "Show uncommitted changes")).count(), 0, "older bridge: no Show uncommitted changes for changes it cannot read");
    await closeViewOptions(page);
    assert.deepEqual(errors, [], "older bridge: no page errors");
    await context.close();
  }
  console.log("review tree: browser OK (Uncommitted lists every kind of change once and takes a comment on the file on disk; a worktree's uncommitted changes are read there while Show uncommitted changes is on (View options, which also holds Show viewed files and Show ignored files), a moved worktree once, then left out with a note; an older bridge gets its stand-ins and a note; Branches load from the merge base, the comparison's pickers work by keyboard and as a bottom sheet by touch on a phone, and every line of a branch diff takes a comment that names its version, in unified and split; front folders give way first to their first letter, the last folder and file names keep their end, short names whole; a level indents about 14px; Viewed is the file's last tool in every view; folders keep their state as viewed files drop out; every file viewed leaves a note and a way to show them again; a viewed file's check stays in sight, its name faded; rows show their path as a tooltip; the column drags, steps and resets, its limits drawn and never stored)");
} finally {
  await browser?.close(); server?.stop(true); rmSync(root, { recursive: true, force: true });
}
