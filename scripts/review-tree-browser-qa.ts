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
 *
 * The review's keys (lib/reviewKeys.ts), on a repository of their own: a Markdown file opens as its source in Changed
 * files and as its preview in All files, and the view chosen holds for the list's next file and after the review is
 * opened again. `]` and `[` step through the files in the order the tree draws them, a closed folder's files and a file
 * the filter leaves out included, one tree row selected after each, the status line naming the file by its path (the
 * same words again as new text); `v` and Shift+v
 * toggle Viewed and say so. `j`/`k` put the cursor on the first line in view, then move it a line (unified: a removed
 * line before its added one; split: a removed line on the left), past folded lines, kept from unified to split; its bar
 * stands 3:1 or more against `--bg` and its selected number's own background on an unchanged, an added and a removed line
 * in both themes. In the virtualized file
 * it lands where the reader scrolled and follows past the rows drawn; a mouse drag there is drawn as it goes, with a
 * cursor shown or not, and no selection by the mouse draws the cursor until a key comes. Shift+j selects, `c` opens the
 * comment on the lines and turns comment mode on, and Escape gives the focus back; Enter after a click on Viewed
 * comments, Enter and Space on a button reached by Tab press it. A selection the mouse leaves on the page does not hold
 * the cursor back. A whole line's field starts at its text; `c` on a commented line opens that comment to edit; Space
 * pages the diff. Escape drops a selection first, then closes. The keys do
 * nothing in a comment, in the filter, under View options and once switched off; in the preview the arrows, j and k
 * scroll it a line and Space pages it, with the focus on the dialog.
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

/** The pane whose review shows {@link keysFixture}. */
const KEYS_PANE = "pane-keys";
/**
 * keysFixture's changed files as the tree draws them (`sort: "default"` of `@pierre/trees`): folders first, a folder's
 * own folders before its files, `file2` before `file10`.
 */
const KEYS_ORDER = ["docs/a.md", "docs/b.md", "src/zeta/deep.ts", "src/code.ts", "file2.ts", "file10.ts"];
/** Numbered lines, line 10 changed, line 20 removed and a line added after 30: hunks at 7–13, 17–23 and 28–33. */
const CODE_FILE = "src/code.ts";
/** Unchanged, and past LINE_ELEMENT_LIMIT (src/lib/highlight.ts, 20 000 lines): All files draws it in the virtualized view. */
const BIG_FILE = "big.ts";
const BIG_LINES = 25_000;

/** A repository for the review's keys: two Markdown files, a code diff, a folder of its own and a large text. */
function keysFixture(): string {
  const keys = join(root, "keys");
  mkdirSync(join(keys, "docs"), { recursive: true });
  mkdirSync(join(keys, "src", "zeta"), { recursive: true });
  git(keys, "init", "-q", "-b", "main");
  // long enough that its preview scrolls
  const guide = (changed: number | null): string => `# Guide\n\n${Array.from({ length: 200 }, (_, index) => `Paragraph ${index + 1}${index + 1 === changed ? ", changed" : ""} of the guide.`).join("\n\n")}\n`;
  const code = numbered(40);
  const small = ["src/zeta/deep.ts", "file2.ts", "file10.ts"];
  writeFileSync(join(keys, "docs", "a.md"), guide(null));
  writeFileSync(join(keys, "docs", "b.md"), "# Notes\n\nfirst\n");
  writeFileSync(join(keys, CODE_FILE), `${code.join("\n")}\n`);
  for (const name of small) writeFileSync(join(keys, name), "first\n");
  writeFileSync(join(keys, BIG_FILE), `${numbered(BIG_LINES).join("\n")}\n`);
  git(keys, "add", ".");
  git(keys, "commit", "-q", "-m", "first");
  writeFileSync(join(keys, "docs", "a.md"), guide(3));
  writeFileSync(join(keys, "docs", "b.md"), "# Notes\n\nfirst\nsecond\n");
  const changed = [...code.slice(0, 9), "export const line10 = 100;", ...code.slice(10, 19), ...code.slice(20, 30), "export const added = 31;", ...code.slice(30)];
  writeFileSync(join(keys, CODE_FILE), `${changed.join("\n")}\n`);
  for (const name of small) writeFileSync(join(keys, name), "first\nsecond\n");
  return keys;
}

const repo = fixture();
const branchRepo = branchFixture();
const kindsRepo = kindsFixture();
const keysRepo = keysFixture();
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;

/** The routes the Review reads, on a stand-in that maps each pane to its fixture repository. */
async function api(url: URL): Promise<Response | null> {
  const diff = /^\/api\/workspace\/diff\/(files|file|tree|branches)$/.exec(url.pathname);
  if (diff) {
    // an absolute folder is read as asked (a worktree, a shown file's folder), as the server does; without one the
    // branch fixture's pane reviews its repository, the kinds and the keys panes their own, every other pane the deep one
    const directory = url.searchParams.get("directory") ?? "";
    const pane = url.searchParams.get("pane_id");
    const cwd = directory.startsWith("/") ? directory : pane === BRANCH_PANE ? branchRepo.repo : pane === KINDS_PANE ? kindsRepo : pane === KEYS_PANE ? keysRepo : repo;
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

/** `count` frames of the page: long enough for a key's render to land, without a fixed sleep. */
async function frames(page: Page, count: number): Promise<void> {
  await page.evaluate((count) => new Promise<void>((resolve) => {
    let left = count;
    const next = (): void => { left -= 1; if (left <= 0) resolve(); else requestAnimationFrame(next); };
    requestAnimationFrame(next);
  }), count);
}
/** What `read` gives once `test` holds, read frame by frame; fails with the last reading after 10s. */
async function settled<T>(page: Page, what: string, read: () => Promise<T>, test: (value: T) => boolean): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await read();
    if (test(value)) return value;
    assert.ok(Date.now() - started < 10_000, `${what}: ${JSON.stringify(value)}`);
    await frames(page, 2);
  }
}

/** A drawn row of the file shown: its number, its kind (`context`, `change-addition`, `change-deletion`) and whether it is in a split view's left column. */
interface KeyRow { line: number; type: string; left: boolean }
/** The same row: its number on the same side (a removed line is the old file's, as is the left column). */
const sameRow = (a: KeyRow, b: KeyRow): boolean => a.line === b.line && a.left === b.left && a.type.includes("deletion") === b.type.includes("deletion");

/**
 * What the file shown draws of the line cursor: the rows whose number the library marks selected, those of them that
 * carry the cursor's bar (REVIEW_CSS's box-shadow on the number), and whether the code's host has the cursor's class.
 */
async function cursorDrawn(page: Page): Promise<{ selected: KeyRow[]; barred: KeyRow[]; bar: boolean }> {
  return page.evaluate(() => {
    const host = document.querySelector<HTMLElement>(".review-file diffs-container");
    const cells = [...host?.shadowRoot?.querySelectorAll<HTMLElement>("[data-column-number][data-selected-line]") ?? []];
    const row = (cell: HTMLElement) => ({ line: Number(cell.dataset["columnNumber"]), type: cell.dataset["lineType"] ?? "", left: cell.closest("[data-deletions]") !== null });
    return { selected: cells.map(row), barred: cells.filter((cell) => getComputedStyle(cell).boxShadow !== "none").map(row), bar: host?.classList.contains("review-cursor") === true };
  });
}
/** Until the cursor alone is drawn, on `row`: one bar, and (`single`) one selected number, which a split view's unchanged line doubles. */
async function cursorOn(page: Page, row: KeyRow, what: string, single = true): Promise<void> {
  await settled(page, what, () => cursorDrawn(page), (drawn) => drawn.bar && drawn.barred.length === 1 && sameRow(drawn.barred[0]!, row) && (!single || drawn.selected.length === 1));
}
/**
 * The first row the cursor may stand on that the file's scroll box shows whole (in a split view a removed line on the
 * left, every other row on the right), as the first `j` should find it; null before any is drawn.
 */
async function firstRowInView(page: Page): Promise<KeyRow | null> {
  return page.evaluate(() => {
    const body = document.querySelector<HTMLElement>(".review-file");
    const scroller = body?.querySelector<HTMLElement>(".review-scroll");
    if (!body || !scroller) return null;
    const view = scroller.getBoundingClientRect();
    const rows = [...body.querySelector("diffs-container")?.shadowRoot?.querySelectorAll<HTMLElement>("[data-line]") ?? []]
      .map((element) => ({ line: Number(element.dataset["line"]), type: element.dataset["lineType"] ?? "", left: element.closest("[data-deletions]") !== null, box: element.getBoundingClientRect() }))
      .filter((row) => (!row.left || row.type.includes("deletion")) && row.box.height > 0 && row.box.top >= view.top - 0.5 && row.box.bottom <= view.bottom + 0.5)
      // a removed line and its added one side by side: the removed one first, as the cursor runs
      .sort((a, b) => a.box.top - b.box.top || Number(b.left) - Number(a.left));
    const first = rows[0];
    return first === undefined ? null : { line: first.line, type: first.type, left: first.left };
  });
}
/** The middle of the code (`gutter`: the number) of the drawn row of `line`, on the right or the unified column. */
async function rowPoint(page: Page, line: number, gutter: boolean): Promise<{ x: number; y: number }> {
  const point = await page.evaluate(([line, gutter]) => {
    const root = document.querySelector(".review-file diffs-container")?.shadowRoot;
    const element = [...root?.querySelectorAll<HTMLElement>(gutter ? `[data-column-number="${line}"]` : `[data-line="${line}"]`) ?? []]
      .find((one) => one.closest("[data-deletions]") === null && !(one.dataset["lineType"] ?? "").includes("deletion"));
    if (element === undefined) return null;
    const box = element.getBoundingClientRect();
    return { x: gutter ? box.left + box.width / 2 : box.left + 40, y: box.top + box.height / 2 };
  }, [line, gutter] as const);
  assert.ok(point !== null, `the row of line ${line} is drawn`);
  return point;
}
/**
 * The contrast of the cursor's bar on the row it stands on: against `--bg`, and against the number's own background as
 * drawn (the selection's tint over the row's), each colour painted on a canvas so any CSS colour reads as sRGB.
 */
async function barContrast(page: Page): Promise<{ type: string; bar: string; bg: number; drawn: number }> {
  return page.evaluate(() => {
    const cell = [...document.querySelector(".review-file diffs-container")?.shadowRoot?.querySelectorAll<HTMLElement>("[data-column-number][data-selected-line]") ?? []]
      .find((one) => getComputedStyle(one).boxShadow !== "none");
    if (cell === undefined) return { type: "", bar: "", bg: 0, drawn: 0 };
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    const paint = (layers: string[]): number[] => {
      context.clearRect(0, 0, 1, 1);
      for (const layer of layers) {
        context.fillStyle = layer;
        context.fillRect(0, 0, 1, 1);
      }
      return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
    };
    const luminance = (rgb: number[]): number => {
      const [r = 0, g = 0, b = 0] = rgb.map((value) => { const s = value / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: number[], b: number[]): number => {
      const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (high! + 0.05) / (low! + 0.05);
    };
    const probe = document.createElement("div");
    probe.style.backgroundColor = "var(--bg)";
    document.body.append(probe);
    const bg = getComputedStyle(probe).backgroundColor;
    probe.remove();
    // the shadow's colour comes first in its computed value: `rgb(…) -3px 0px 0px 0px inset`
    const bar = /^(.*?)\s+-?[\d.]+px/.exec(getComputedStyle(cell).boxShadow)?.[1] ?? "";
    const under = [bg, getComputedStyle(cell).backgroundColor];
    return { type: cell.dataset["lineType"] ?? "", bar, bg: ratio(paint([bg, bar]), paint([bg])), drawn: ratio(paint([...under, bar]), paint(under)) };
  });
}
/** The file the review shows, by its absolute path (its header's tooltip); null with none shown. */
async function shownFile(page: Page): Promise<string | null> {
  return page.evaluate(() => document.querySelector(".review-file-head .review-file-path")?.getAttribute("title") ?? null);
}
/** The rows the tree marks selected, by path. */
async function treeSelected(page: Page): Promise<string[]> {
  return page.evaluate(() => [...document.querySelector(".review-tree")?.shadowRoot?.querySelectorAll<HTMLElement>("[data-type='item'][aria-selected='true']:not([data-file-tree-sticky-row])") ?? []].map((row) => row.dataset["itemPath"] ?? ""));
}
/** Opens the keys fixture's review, its Changed files listed: the dialog. */
async function openKeysReview(page: Page): Promise<Locator> {
  await page.evaluate(([pane, directory]) => window.reviewTreeQA.open(pane!, directory!), [KEYS_PANE, keysRepo]);
  const dialog = page.getByRole("dialog", { name: "Review", exact: true });
  await dialog.waitFor();
  await listedUntil(page, "keys: Changed lists every changed file", (shown) => shown.length === KEYS_ORDER.length);
  return dialog;
}
/** Opens `path` from the tree (its folder open): the focus is the tree's then. */
async function openFromTree(page: Page, path: string): Promise<void> {
  await page.locator(`.review-tree [data-item-path="${path}"]:not([data-file-tree-sticky-row])`).click();
  await settled(page, `${path} opens`, () => shownFile(page), (shown) => shown === join(keysRepo, path));
}
/** A click on the shown file's path: the focus on the review itself, no control, field or tree. */
async function focusReview(page: Page): Promise<void> {
  await page.locator(".review-file-head .review-file-path").click();
  assert.ok(await page.evaluate(() => document.activeElement?.closest("button, a, input, textarea, [role='tree'], .review-tree") == null), "the focus is on no control");
}

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
    await context.addInitScript((theme) => localStorage.setItem("ovis:settings", JSON.stringify({ language: "en", theme })), theme);
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
    await context.addInitScript(() => localStorage.setItem("ovis:settings", JSON.stringify({ language: "en" })));
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
    await context.addInitScript(() => localStorage.setItem("ovis:settings", JSON.stringify({ language: "en" })));
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
    await context.addInitScript(() => localStorage.setItem("ovis:settings", JSON.stringify({ language: "en" })));
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
    assert.equal(await page.evaluate(() => localStorage.getItem("ovis:review-hide-viewed")), null, "Show viewed files is stored on (nothing hidden)");
    assert.deepEqual(errors, [], "viewed notes: no page errors");
    await context.close();
  }
  // the file shown, marked viewed with its folder closed: it stays listed (a new list, the same listing), and its
  // folder stays as the reader left it; a filter, a new listing, still opens it
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(() => localStorage.setItem("ovis:settings", JSON.stringify({ language: "en" })));
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
    await context.addInitScript(() => localStorage.setItem("ovis:settings", JSON.stringify({ language: "en" })));
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
    const KEY = "ovis:review-tree-width";
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(() => localStorage.setItem("ovis:settings", JSON.stringify({ language: "en" })));
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
    await context.addInitScript(() => localStorage.setItem("ovis:settings", JSON.stringify({ language: "en", commentMode: true, mobileCommentGesture: "tap", diffStyle: "unified" })));
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
        if (!key.startsWith("ovis:block-comments:")) continue;
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
    await context.addInitScript(() => localStorage.setItem("ovis:settings", JSON.stringify({ language: "en" })));
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
    await context.addInitScript(() => localStorage.setItem("ovis:settings", JSON.stringify({ language: "en" })));
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
    await context.addInitScript(() => localStorage.setItem("ovis:settings", JSON.stringify({ language: "en", commentMode: true, mobileCommentGesture: "tap", diffStyle: "unified" })));
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
        if (key.startsWith("ovis:block-comments:")) found.push(...(JSON.parse(localStorage.getItem(key)!) as { comments: { kind: string; path?: string; comment: string }[] }).comments);
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
    await context.addInitScript(() => localStorage.setItem("ovis:settings", JSON.stringify({ language: "en", commentMode: true, mobileCommentGesture: "tap", diffStyle: "unified" })));
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
    await context.addInitScript(() => localStorage.setItem("ovis:settings", JSON.stringify({ language: "en" })));
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
    await context.addInitScript(() => localStorage.setItem("ovis:settings", JSON.stringify({ language: "en" })));
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
  /** A page of its own for the review's keys, Settings as given (and the system's colours), its errors collected. */
  const keysPage = async (settings: Record<string, unknown>, colorScheme?: "dark" | "light") => {
    const context = await browser!.newContext({ viewport: { width: 1440, height: 900 }, ...(colorScheme === undefined ? {} : { colorScheme }) });
    await context.addInitScript((settings) => localStorage.setItem("ovis:settings", JSON.stringify(settings)), settings);
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
    await page.goto(`http://127.0.0.1:${server!.port}/`);
    return { context, page, errors };
  };
  // keys: `]` and `[` in the tree's order, a closed folder's files and a file the filter leaves out included, one row
  // selected after each and the status line naming the file; `v` says what it did; no key acts in the filter, under
  // View options or switched off, and off is kept
  {
    const { context, page, errors } = await keysPage({ language: "en" });
    const dialog = await openKeysReview(page);
    assert.deepEqual(await listed(page), KEYS_ORDER, "keys: the tree draws folders first and numbers by value");
    const status = page.locator("section.review-dialog > p.visually-hidden[role='status']");
    const said = async (text: string, what: string): Promise<void> => { await settled(page, what, () => status.textContent(), (shown) => shown === text); };
    const opened = async (path: string, what: string): Promise<void> => {
      await settled(page, what, () => shownFile(page), (shown) => shown === join(keysRepo, path));
      await settled(page, `${what}, its row alone selected in the tree`, () => treeSelected(page), (rows) => JSON.stringify(rows) === JSON.stringify([path]));
    };
    const stays = async (path: string, what: string): Promise<void> => {
      await frames(page, 10);
      assert.equal(await shownFile(page), join(keysRepo, path), what);
    };
    // the reader closes src: its files still count, and the tree opens it again for the one shown
    await page.locator(".review-tree [data-item-type='folder']:is([data-item-path='src'], [data-item-path='src/']):not([data-file-tree-sticky-row])").click();
    await listedUntil(page, "keys: src closes", (shown) => shown.length > 0 && !shown.some((path) => path.startsWith("src/")));
    await page.getByText("Choose a file in the tree.", { exact: true }).click();
    await page.keyboard.press("]");
    await opened(KEYS_ORDER[0]!, "keys: ] with no file open opens the first file");
    await said("docs/a.md", "keys: the status line names the file ] opened, by its path");
    for (const path of KEYS_ORDER.slice(1)) {
      await page.keyboard.press("]");
      await opened(path, `keys: ] opens ${path} next`);
    }
    await said("file10.ts", "keys: the status line names each file");
    if (evidence) await page.locator(".review-tree-pane").screenshot({ path: join(evidence, "review-keys-last-file.png") });
    await page.keyboard.press("]");
    await stays("file10.ts", "keys: ] at the last file does nothing");
    await page.keyboard.press("[");
    await opened("file2.ts", "keys: [ opens the file before");
    // a row added by Ctrl+click opens its file; a key from there leaves no row it passes through open
    await page.locator(`.review-tree [data-item-path="${CODE_FILE}"]:not([data-file-tree-sticky-row])`).click({ modifiers: ["ControlOrMeta"] });
    await settled(page, "keys: a Ctrl+click opens its row's file", () => shownFile(page), (shown) => shown === join(keysRepo, CODE_FILE));
    await focusReview(page);
    await page.keyboard.press("[");
    await opened("src/zeta/deep.ts", "keys: [ from two rows selected opens the file before the shown one");
    await stays("src/zeta/deep.ts", "keys: and stays there, not on a row it deselected");
    for (const path of ["src/code.ts", "file2.ts"]) {
      await page.keyboard.press("]");
      await opened(path, `keys: ] opens ${path} again`);
    }

    // a file the filter leaves out: ] opens the first one listed after it, [ the last one before it (none here)
    const search = page.getByRole("searchbox", { name: "Filter files" });
    await search.fill("file1");
    await listedUntil(page, "keys: the filter lists file10.ts alone", (shown) => JSON.stringify(shown) === JSON.stringify(["file10.ts"]));
    // in the filter a key is text
    await search.press("]");
    assert.equal(await search.inputValue(), "file1]", "keys: ] in the filter is typed");
    await stays("file2.ts", "keys: ] in the filter opens no file");
    await search.fill("file1");
    await listedUntil(page, "keys: the filter lists file10.ts again", (shown) => JSON.stringify(shown) === JSON.stringify(["file10.ts"]));
    await focusReview(page);
    await page.keyboard.press("[");
    await stays("file2.ts", "keys: [ from a file the filter leaves out, none listed before it, does nothing");
    await page.keyboard.press("]");
    await opened("file10.ts", "keys: ] from a file the filter leaves out opens the first one listed after it");
    await search.fill("");
    await listedUntil(page, "keys: the filter cleared", (shown) => shown.length === KEYS_ORDER.length);

    // v toggles Viewed as the button does, Shift+v too, and the status line says which
    const viewed = page.locator(".review-file-head .review-viewed");
    assert.deepEqual([await viewed.getAttribute("aria-pressed"), await viewed.getAttribute("title"), await viewed.getAttribute("aria-keyshortcuts")], ["false", "Mark as viewed (V)", "v"], "keys: the Viewed button names its key");
    await focusReview(page);
    await page.keyboard.press("v");
    await settled(page, "keys: v marks the file viewed", () => viewed.getAttribute("aria-pressed"), (pressed) => pressed === "true");
    await said("Marked as viewed", "keys: the status line says the file is viewed");
    assert.equal(await viewed.getAttribute("title"), "Viewed (V)", "keys: a viewed file's button names its key too");
    await page.keyboard.press("Shift+KeyV");
    await settled(page, "keys: Shift+v is v", () => viewed.getAttribute("aria-pressed"), (pressed) => pressed === "false");
    await said("Not viewed", "keys: the status line says the file is not viewed");
    // the same words again are said again: the click marks it viewed without a word, v takes it back, "Not viewed" once
    // more, as new text in the live region
    const seen = (): Promise<boolean> => status.locator("span").evaluate((node) => (node as HTMLElement & { qaSeen?: boolean }).qaSeen === true);
    await status.locator("span").evaluate((node) => { (node as HTMLElement & { qaSeen?: boolean }).qaSeen = true; });
    await viewed.click();
    await settled(page, "keys: a click marks the file viewed again", () => viewed.getAttribute("aria-pressed"), (pressed) => pressed === "true");
    await focusReview(page);
    await page.keyboard.press("v");
    await settled(page, "keys: v marks it not viewed once more", () => viewed.getAttribute("aria-pressed"), (pressed) => pressed === "false");
    await said("Not viewed", "keys: the same words again");
    assert.equal(await seen(), false, "keys: the same words are new text in the live region, said again");

    // View options open: its menu has the keys
    await (await viewOption(page, "Keyboard shortcuts")).waitFor();
    for (const key of ["[", "v", "j"]) await page.keyboard.press(key);
    await stays("file10.ts", "keys: [ under View options opens no file");
    assert.equal(await viewed.getAttribute("aria-pressed"), "false", "keys: v under View options marks nothing");
    assert.equal((await cursorDrawn(page)).bar, false, "keys: j under View options draws no cursor");
    await closeViewOptions(page);

    // switched off: no review key acts, only the browser's (Escape closes the review, an arrow scrolls); off is kept for
    // the next opening
    assert.equal(await toggleViewOption(page, "Keyboard shortcuts"), false, "keys: Keyboard shortcuts turns off");
    assert.equal(await page.evaluate(() => localStorage.getItem("ovis:review-keys-off")), "1", "keys: off is kept on this device");
    await focusReview(page);
    for (const key of ["[", "v", "j", "ArrowDown"]) await page.keyboard.press(key);
    await stays("file10.ts", "keys: [ does nothing once switched off");
    assert.equal(await viewed.getAttribute("aria-pressed"), "false", "keys: v does nothing once switched off");
    assert.equal((await cursorDrawn(page)).bar, false, "keys: j and the arrows (a line's scroll then) draw no cursor once switched off");
    assert.deepEqual([await viewed.getAttribute("title"), await viewed.getAttribute("aria-keyshortcuts")], ["Mark as viewed", null], "keys: the Viewed button names no key once switched off");
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    await openKeysReview(page);
    const row = await viewOption(page, "Keyboard shortcuts");
    assert.equal(await row.getAttribute("aria-checked"), "false", "keys: off holds when the review opens again");
    await row.click();
    assert.equal(await row.getAttribute("aria-checked"), "true", "keys: Keyboard shortcuts turns on again");
    await closeViewOptions(page);
    assert.equal(await page.evaluate(() => localStorage.getItem("ovis:review-keys-off")), null, "keys: on again forgets the choice");
    assert.deepEqual(errors, [], "keys: no page errors");
    await context.close();
  }
  // Markdown: Source in Changed files, Preview in All files, a choice per list that holds for the list's next file and
  // after the review is opened again
  {
    const { context, page, errors } = await keysPage({ language: "en" });
    const dialog = await openKeysReview(page);
    const view = async (want: "Preview" | "Source", what: string): Promise<void> => {
      await settled(page, what, () => page.evaluate(() => document.querySelector(".review-file-head .review-mode button[aria-pressed='true']")?.textContent ?? null), (shown) => shown === want);
    };
    const choose = async (name: "Preview" | "Source"): Promise<void> => page.locator(".review-file-head .review-mode").getByRole("button", { name, exact: true }).click();
    const stored = async (): Promise<(string | null)[]> => page.evaluate(() => ["changed", "all"].map((list) => localStorage.getItem(`ovis:review-markdown-view:${list}`)));
    await openFromTree(page, "docs/a.md");
    await view("Source", "markdown: Changed files opens a Markdown file as its source");
    await page.locator(".review-file[data-mode='diff'] diffs-container").waitFor();
    await dialog.getByRole("button", { name: "All files", exact: true }).click();
    await view("Preview", "markdown: in All files the same file is its preview at once");
    await page.locator(".review-file .review-preview").waitFor();
    await choose("Source");
    await view("Source", "markdown: Source is chosen in All files");
    assert.deepEqual(await stored(), [null, "source"], "markdown: a click keeps its own list's view alone");
    await dialog.getByRole("button", { name: "Changed files" }).click();
    await view("Source", "markdown: Changed files keeps its own view");
    await choose("Preview");
    await view("Preview", "markdown: Preview is chosen in Changed files");
    assert.deepEqual(await stored(), ["preview", "source"], "markdown: each list keeps its own view");
    await focusReview(page);
    await page.keyboard.press("]");
    await settled(page, "markdown: ] opens the next file", () => shownFile(page), (shown) => shown === join(keysRepo, "docs/b.md"));
    await view("Preview", "markdown: the list's next Markdown file shows as chosen");
    await page.evaluate(() => window.reviewTreeQA.close());
    await dialog.waitFor({ state: "detached" });
    await openKeysReview(page);
    await openFromTree(page, "docs/b.md");
    await view("Preview", "markdown: Changed files' choice holds when the review opens again");
    await dialog.getByRole("button", { name: "All files", exact: true }).click();
    await view("Source", "markdown: All files' choice holds when the review opens again");
    assert.deepEqual(errors, [], "markdown: no page errors");
    await context.close();
  }
  // the line cursor in the diff, in both themes: the first j lands on the first line in view, each press moves a line
  // (a removed line before its added one), past folded lines, kept into the split view, where a removed line's cursor
  // is on the left; its bar stands 3:1 or more against --bg and its selected number on an unchanged, a removed and an
  // added line
  const contrasts: string[] = [];
  for (const theme of ["dark", "light"] as const) {
    const { context, page, errors } = await keysPage({ language: "en", theme, diffStyle: "unified" }, theme);
    await openKeysReview(page);
    await openFromTree(page, CODE_FILE);
    const first = await settled(page, `${theme}: the diff is drawn`, () => firstRowInView(page), (row) => row !== null);
    const unified: KeyRow[] = [
      { line: 7, type: "context", left: false }, { line: 8, type: "context", left: false }, { line: 9, type: "context", left: false },
      { line: 10, type: "change-deletion", left: false }, { line: 10, type: "change-addition", left: false },
      { line: 11, type: "context", left: false }, { line: 12, type: "context", left: false }, { line: 13, type: "context", left: false },
    ];
    assert.ok(first !== null && sameRow(first, unified[0]!), `${theme}: the diff starts with its first hunk's context: ${JSON.stringify(first)}`);
    await focusReview(page);
    assert.equal((await cursorDrawn(page)).selected.length, 0, `${theme}: no cursor before a key`);
    const measure = async (): Promise<void> => {
      const contrast = await barContrast(page);
      assert.ok(contrast.bar !== "", `${theme}: the cursor's bar has a colour: ${JSON.stringify(contrast)}`);
      assert.ok(contrast.bg >= 3, `${theme}: the cursor's bar on a ${contrast.type} line stands ${contrast.bg.toFixed(2)}:1 against --bg (${contrast.bar})`);
      assert.ok(contrast.drawn >= 3, `${theme}: the cursor's bar on a ${contrast.type} line stands ${contrast.drawn.toFixed(2)}:1 against its selected number (${contrast.bar})`);
      contrasts.push(`${theme} ${contrast.type} ${contrast.bg.toFixed(2)}:1 (${contrast.drawn.toFixed(2)}:1 on its selected number)`);
    };
    await page.keyboard.press("j");
    await cursorOn(page, unified[0]!, `${theme}: the first j puts the cursor on the first line in view, without moving on`);
    await measure();
    for (const row of unified.slice(1)) {
      await page.keyboard.press("j");
      await cursorOn(page, row, `${theme}: j moves the cursor a line, a removed line before its added one: ${JSON.stringify(row)}`);
      if (row.line === 10) await measure();
    }
    if (evidence) await page.locator(".review-file").screenshot({ path: join(evidence, `review-keys-cursor-${theme}.png`) });
    // past the folded lines: 13, then the next hunk's 17
    await page.keyboard.press("j");
    await cursorOn(page, { line: 17, type: "context", left: false }, `${theme}: j skips the folded lines`);
    await page.keyboard.press("k");
    await cursorOn(page, unified[7]!, `${theme}: k moves the cursor back a line`);
    for (let press = 0; press < 10; press++) await page.keyboard.press("k");
    await cursorOn(page, unified[0]!, `${theme}: at the first line the cursor stays`);
    // split: the cursor stays on its line; a removed line's is on the left, its added one's on the right
    for (let press = 0; press < 4; press++) await page.keyboard.press("j");
    await cursorOn(page, unified[4]!, `${theme}: the cursor on the added line`);
    await page.locator(".repo-diff-styles").getByRole("button", { name: "Split" }).click();
    await cursorOn(page, unified[4]!, `${theme}: the cursor stays on its line in the split view, on the right`, false);
    await page.keyboard.press("k");
    await cursorOn(page, { line: 10, type: "change-deletion", left: true }, `${theme}: in the split view a removed line's cursor is on the left`, false);
    await page.keyboard.press("k");
    await cursorOn(page, unified[2]!, `${theme}: an unchanged line's cursor is on the right`, false);
    if (evidence) await page.locator(".review-file").screenshot({ path: join(evidence, `review-keys-cursor-split-${theme}.png`) });
    assert.deepEqual(errors, [], `${theme}: cursor: no page errors`);
    await context.close();
  }
  // a comment by key: Shift+j selects, c opens the field on the lines and turns comment mode on, keys in the field are
  // its text, Escape gives the focus back; Enter after a click on Viewed comments, Enter on a button reached by Tab
  // presses it; a mouse selection moves the cursor unseen; Escape drops a selection, then closes the review
  {
    const { context, page, errors } = await keysPage({ language: "en", diffStyle: "unified" });
    const dialog = await openKeysReview(page);
    const line = (n: number): KeyRow => ({ line: n, type: "context", left: false });
    const barredLines = async (lines: number[], what: string): Promise<void> => {
      await settled(page, what, () => cursorDrawn(page), (drawn) => JSON.stringify(drawn.barred.map((row) => row.line)) === JSON.stringify(lines));
    };
    // opened from the tree: the keys work with the focus there, and it comes back there
    await openFromTree(page, CODE_FILE);
    await settled(page, "comment: the diff is drawn", () => firstRowInView(page), (row) => row !== null);
    await page.keyboard.press("j");
    await cursorOn(page, line(7), "comment: j with the focus in the tree puts the cursor");
    await page.keyboard.press("Shift+KeyJ");
    await page.keyboard.press("Shift+KeyJ");
    await barredLines([7, 8, 9], "comment: Shift+j selects down from the cursor");
    const toggle = page.locator(".review-file-head .review-comments");
    assert.equal(await toggle.getAttribute("aria-pressed"), "false", "comment: comment mode starts off");
    await page.keyboard.press("c");
    const field = page.locator("[data-draft] textarea");
    await field.waitFor();
    await settled(page, "comment: the field takes the focus", () => field.evaluate((node) => node === document.activeElement), (focused) => focused);
    assert.equal(await toggle.getAttribute("aria-pressed"), "true", "comment: c turns comment mode on as the field opens");
    if (evidence) await page.locator(".review-file").screenshot({ path: join(evidence, "review-keys-comment.png") });
    // with the field open the keys are its text
    await page.keyboard.press("]");
    await page.keyboard.press("v");
    assert.equal(await field.inputValue(), "]v", "comment: ] and v in the field are typed");
    assert.equal(await shownFile(page), join(keysRepo, CODE_FILE), "comment: ] in the field opens no file");
    await field.fill("");
    await page.keyboard.press("Escape");
    await field.waitFor({ state: "detached" });
    assert.ok(await dialog.isVisible(), "comment: Escape closes the field, not the review");
    await settled(page, "comment: the focus goes back to the tree it was in", () => page.evaluate(() => document.activeElement?.closest(".review-tree") != null), (back) => back);
    await cursorOn(page, line(9), "comment: the cursor stands on the selection's end, the selection gone");

    // Enter after a click on Viewed comments: a button the mouse focused gives Enter back
    const viewed = page.locator(".review-file-head .review-viewed");
    await viewed.click();
    await settled(page, "comment: a click marks the file viewed", () => viewed.getAttribute("aria-pressed"), (pressed) => pressed === "true");
    assert.equal(await viewed.evaluate((node) => node.matches(":focus-visible")), false, "comment: a clicked button shows no focus ring");
    await page.keyboard.press("Enter");
    await field.waitFor();
    assert.equal(await viewed.getAttribute("aria-pressed"), "true", "comment: Enter after a click on Viewed comments, it does not press Viewed again");
    await page.keyboard.press("Escape");
    await field.waitFor({ state: "detached" });
    assert.ok(await dialog.isVisible(), "comment: Escape closes the field, not the review");
    await settled(page, "comment: the focus goes back to Viewed", () => viewed.evaluate((node) => node === document.activeElement), (back) => back);
    // a button reached by Tab keeps Enter
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    assert.ok(await viewed.evaluate((node) => node === document.activeElement && node.matches(":focus-visible")), "comment: Tab brings the focus back to Viewed, its ring shown");
    await page.keyboard.press("Enter");
    await settled(page, "comment: Enter on a button reached by Tab presses it", () => viewed.getAttribute("aria-pressed"), (pressed) => pressed === "false");
    await frames(page, 10);
    assert.equal(await field.count(), 0, "comment: Enter on a button reached by Tab opens no comment");
    // and the space bar: it presses the button, it pages nothing
    await page.keyboard.press("Space");
    await settled(page, "comment: Space on a button reached by Tab presses it", () => viewed.getAttribute("aria-pressed"), (pressed) => pressed === "true");
    await page.keyboard.press("Space");
    await settled(page, "comment: Space presses it again", () => viewed.getAttribute("aria-pressed"), (pressed) => pressed === "false");

    // a mouse selection moves the cursor without drawing it; the next key shows it where the selection ends
    const from = await rowPoint(page, 11, false), to = await rowPoint(page, 13, false);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 5 });
    await page.mouse.up();
    await frames(page, 4);
    const byMouse = await cursorDrawn(page);
    assert.deepEqual([byMouse.bar, byMouse.barred.length], [false, 0], `comment: a mouse selection draws no cursor: ${JSON.stringify(byMouse)}`);
    // the selection stays on the page: a key's keyup reads it again, and the cursor must not follow it back
    await page.keyboard.press("j");
    await cursorOn(page, line(13), "comment: the next key shows the cursor on the selection's last line, without moving it");
    await page.keyboard.press("k");
    await cursorOn(page, line(12), "comment: with the selection still there, the next key moves the cursor");

    // Escape drops a selection first, and closes the review only then
    await page.keyboard.press("k");
    await cursorOn(page, line(11), "comment: k moves the cursor up");
    await page.keyboard.press("Shift+KeyJ");
    await barredLines([11, 12], "comment: Shift+j selects again");
    await page.keyboard.press("Escape");
    await cursorOn(page, line(12), "comment: Escape drops the selection, the cursor stays on its end");
    assert.ok(await dialog.isVisible(), "comment: the first Escape leaves the review open");

    // a whole line's field starts at the line's text, where its card will be, not at the row's far end
    await page.keyboard.press("c");
    await field.waitFor();
    const place = await page.evaluate(() => {
      const box = document.querySelector("[data-draft]")!.getBoundingClientRect();
      const body = document.querySelector(".review-file .review-scroll")!.getBoundingClientRect();
      return { left: box.left - body.left, width: body.width };
    });
    assert.ok(place.left < place.width / 3, `comment: a whole line's field starts at its text: ${JSON.stringify(place)}`);
    await field.fill("First note");
    await page.keyboard.press("Enter");
    await field.waitFor({ state: "detached" });
    // c on the line again opens its comment to edit, not a new one; Escape closes it and the review stays
    await cursorOn(page, line(12), "comment: the cursor stays on the commented line");
    await page.keyboard.press("c");
    const editing = page.locator(".review-file .comment-popover-edit textarea");
    await editing.waitFor();
    assert.equal(await editing.inputValue(), "First note", "comment: c on a commented line opens its comment to edit");
    assert.equal(await field.count(), 0, "comment: and no new field");
    await settled(page, "comment: the comment's field takes the focus", () => editing.evaluate((node) => node === document.activeElement), (focused) => focused);
    await page.keyboard.press("Escape");
    await editing.waitFor({ state: "detached" });
    assert.ok(await dialog.isVisible(), "comment: Escape closes the comment, not the review");
    // Space and PageDown page the diff, Shift+Space and PageUp back
    const scroller = page.locator(".review-file .review-scroll");
    const scrolled = (): Promise<number> => scroller.evaluate((node) => node.scrollTop);
    await focusReview(page);
    const top = await scrolled();
    const room = await scroller.evaluate((node) => node.scrollHeight - node.clientHeight);
    if (room > 0) {
      await page.keyboard.press("Space");
      await settled(page, "comment: Space pages the diff down", scrolled, (now) => now > top);
      const down = await scrolled();
      await page.keyboard.press("Shift+Space");
      await settled(page, "comment: Shift+Space pages it back", scrolled, (now) => now < down);
    }

    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    assert.deepEqual(errors, [], "comment: no page errors");
    await context.close();
  }
  // the virtualized whole file: the first j lands where the reader scrolled, the cursor follows past the rows drawn; a
  // mouse drag over the numbers is drawn as it goes, a cursor shown or not, and draws no cursor until a key comes
  {
    const { context, page, errors } = await keysPage({ language: "en" });
    const dialog = await openKeysReview(page);
    await dialog.getByRole("button", { name: "All files", exact: true }).click();
    await listedUntil(page, "virtual: All files lists the large file", (shown) => shown.includes(BIG_FILE));
    await openFromTree(page, BIG_FILE);
    await page.locator(".review-file[data-mode='file'] diffs-container").waitFor();
    await settled(page, "virtual: the file's first rows are drawn", () => firstRowInView(page), (row) => row !== null);
    await page.locator(".review-file .review-scroll").evaluate((scroller) => { scroller.scrollTop = scroller.scrollHeight / 2; });
    await settled(page, "virtual: rows halfway down are drawn", () => firstRowInView(page), (row) => row !== null && row.line > 1000);
    await frames(page, 4);
    const first = (await firstRowInView(page))!;
    await focusReview(page);
    await page.keyboard.press("j");
    await cursorOn(page, first, "virtual: the first j lands on the first line in view where the reader scrolled");
    for (let press = 0; press < 60; press++) await page.keyboard.press("j");
    const far: KeyRow = { ...first, line: first.line + 60 };
    await cursorOn(page, far, "virtual: sixty j move the cursor sixty lines, past the rows drawn at first");
    const inView = await page.evaluate(() => {
      const view = document.querySelector<HTMLElement>(".review-file .review-scroll")!.getBoundingClientRect();
      const cell = [...document.querySelector(".review-file diffs-container")?.shadowRoot?.querySelectorAll<HTMLElement>("[data-column-number][data-selected-line]") ?? []]
        .find((one) => getComputedStyle(one).boxShadow !== "none");
      const box = cell?.getBoundingClientRect();
      return box !== undefined && box.top >= view.top - 0.5 && box.bottom <= view.bottom + 0.5;
    });
    assert.ok(inView, "virtual: the cursor's line is scrolled into view");
    // a drag over the numbers, the cursor shown: drawn as it is made, as a selection without the cursor's bar
    const start = far.line - 8, end = far.line - 4;
    const from = await rowPoint(page, start, true), to = await rowPoint(page, end, true);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    const live = await settled(page, "virtual: a drag is drawn while it is made", () => cursorDrawn(page), (drawn) => drawn.selected.length === 5);
    assert.deepEqual([live.bar, live.barred.length], [false, 0], `virtual: a drag shows no cursor bar: ${JSON.stringify(live)}`);
    if (evidence) await page.locator(".review-file").screenshot({ path: join(evidence, "review-keys-virtual-drag.png") });
    await page.mouse.up();
    await frames(page, 4);
    const dropped = await cursorDrawn(page);
    assert.deepEqual([dropped.bar, dropped.barred.length, dropped.selected.length], [false, 0, 5], `virtual: the mouse's selection stays drawn and draws no cursor until a key comes: ${JSON.stringify(dropped)}`);
    await page.keyboard.press("j");
    await cursorOn(page, { ...first, line: end }, "virtual: the next key shows the cursor on the drag's last line, without moving it");
    assert.deepEqual(errors, [], "virtual: no page errors");
    await context.close();
  }
  // the Markdown preview: the review takes neither the arrows nor j and k, so they scroll it
  {
    const { context, page, errors } = await keysPage({ language: "en" });
    const dialog = await openKeysReview(page);
    await dialog.getByRole("button", { name: "All files", exact: true }).click();
    await page.getByRole("searchbox", { name: "Filter files" }).fill("a.md");
    await listedUntil(page, "preview: the filter opens docs", (shown) => shown.includes("docs/a.md"));
    await openFromTree(page, "docs/a.md");
    const preview = page.locator(".review-file .review-preview");
    await preview.locator(".file-viewer-markdown").waitFor();
    type Watched = Window & { reviewKeysPrevented?: boolean[] };
    await page.evaluate(() => {
      const seen: boolean[] = [];
      (window as Watched).reviewKeysPrevented = seen;
      // added after the review's own listener: whether that one took the key
      window.addEventListener("keydown", (event) => seen.push(event.defaultPrevented));
    });
    // a click in the preview leaves the focus on the dialog, where the browser's arrows find nothing to scroll: the review
    // scrolls the preview a line for them, and for j and k
    await preview.click({ position: { x: 40, y: 40 } });
    for (const key of ["ArrowDown", "ArrowDown", "ArrowDown", "j", "k"]) await page.keyboard.press(key);
    await settled(page, "preview: the arrows scroll the preview", () => preview.evaluate((node) => node.scrollTop), (top) => top > 0);
    assert.deepEqual(await page.evaluate(() => (window as Watched).reviewKeysPrevented), [true, true, true, true, true], "preview: the review scrolls for the arrows, j and k");
    const top = await preview.evaluate((node) => node.scrollTop);
    await page.keyboard.press("Space");
    await settled(page, "preview: Space pages the preview", () => preview.evaluate((node) => node.scrollTop), (now) => now > top);
    assert.equal(await page.locator(".review-file diffs-container").count(), 0, "preview: no code view, so no cursor");
    assert.deepEqual(errors, [], "preview: no page errors");
    await context.close();
  }
  console.log(`review keys: cursor bar contrast ${contrasts.join(", ")}`);
  console.log("review tree: browser OK (the review's keys: a Markdown view per list, kept; ] and [ in the tree's order with one row selected and the file announced, v and Shift+v announced; the line cursor in unified, split and the virtualized file, its bar 3:1 against --bg and its selected number in both themes; Shift+j, c with comment mode and focus back, Enter after a click and on a Tab-focused button, mouse selections unseen until a key, Escape a selection then the review; no key in a comment, the filter, View options or once off; the preview's arrows, j, k and Space scroll it; Uncommitted lists every kind of change once and takes a comment on the file on disk; a worktree's uncommitted changes are read there while Show uncommitted changes is on (View options, which also holds Show viewed files and Show ignored files), a moved worktree once, then left out with a note; an older bridge gets its stand-ins and a note; Branches load from the merge base, the comparison's pickers work by keyboard and as a bottom sheet by touch on a phone, and every line of a branch diff takes a comment that names its version, in unified and split; front folders give way first to their first letter, the last folder and file names keep their end, short names whole; a level indents about 14px; Viewed is the file's last tool in every view; folders keep their state as viewed files drop out; every file viewed leaves a note and a way to show them again; a viewed file's check stays in sight, its name faded; rows show their path as a tooltip; the column drags, steps and resets, its limits drawn and never stored)");
} finally {
  await browser?.close(); server?.stop(true); rmSync(root, { recursive: true, force: true });
}
