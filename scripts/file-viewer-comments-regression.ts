/**
 * Comments on files in the file viewer, with a real Codex transcript (its reply links `./src/sync.ts`
 * and `./docs/spec.md`) and an owned herdr pane: the code view's selections (on a desktop and a phone), the cards and highlights, the copy of code with cards in it, Escape; the Markdown
 * preview's selections, named by the source lines they came from, with cards under their blocks; the viewer's
 * header (its counter walking the file's comments, an outdated one in the modal editor); the
 * chat's own comments, which share the form, the cards and the highlights with the viewer; and the composer's
 * bar, whose walk goes on from the chat's comments into the files' and whose send takes them all.
 *
 * One server, pane and browser per run. Each case starts from a fresh page with an empty comment
 * store, so a case runs alone: `FILE_COMMENTS_CASE=<name>[,<name>]` runs only those (unset: all).
 * Waits are bounded polls (`eventually`), never fixed sleeps. Serves `dist/`: build first.
 */
import "./test-herdr.ts";
import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, devices, type Browser, type BrowserContextOptions, type Locator, type Page } from "playwright-core";
import { createServer } from "../server/index.ts";
import { herdrRpc, workspaceClose, workspaceCreate } from "../server/herdr/client.ts";

/** `src/sync.ts`: line 8 is the comparison a comment questions. */
const SYNC_LINES = [
  "import { load, store } from \"./store.ts\";",
  "",
  "export interface Note { id: string; revision: number; text: string }",
  "",
  "/** Writes a note unless a newer one is stored. */",
  "export async function sync(incoming: Note): Promise<Note> {",
  "  const stored = await load(incoming.id);",
  "  if (incoming.revision < stored.revision) {",
  "    return stored;",
  "  }",
  "  await store(incoming);",
  "  return incoming;",
  "}",
];

/**
 * `docs/spec.md`, for the preview's cases: a heading, a paragraph over two source lines, a table whose
 * rows are source lines 42–43, a list item with a continuation line, a fenced block.
 */
const SPEC_LINES = [
  "# Sync spec",
  "",
  "A write carries the revision it was made on, and the server",
  "compares it with the revision it stores.",
  "",
  "## Revisions",
  "",
];
for (let n = 1; SPEC_LINES.length < 37; n++) SPEC_LINES.push(`Rule ${n} of the revisions keeps the notes in order.`, "");
SPEC_LINES.push(
  "## Answers",
  "",
  "| Case | Answer |",
  "| --- | --- |",
  "| Older revision | 409 Conflict with the stored note |",
  "| Newer revision | 200 with the merged note |",
  "",
  "- Retry on a conflict",
  "  with the stored revision.",
  "- Give up after three tries.",
  "",
  "```ts",
  "const retries = 3;",
  "```",
);
assert.ok(SPEC_LINES[41]!.startsWith("| Older revision") && SPEC_LINES[42]!.startsWith("| Newer revision"), "the table's rows are lines 42–43");

/** The reply's paragraph the chat case comments on. */
const REPLY = "The sync plan keeps every revision in order and never loses a write.";

const root = mkdtempSync(join(tmpdir(), "herdr-web-ui-file-comments-"));
const codexHome = join(root, "codex-home");
const thread = "01a0c7a1-56d9-7e20-9f08-f7a2d973bc13";
mkdirSync(join(codexHome, "sessions"), { recursive: true });
const transcript = join(codexHome, "sessions", `rollout-2026-10-06T00-00-00-${thread}.jsonl`);
writeFileSync(transcript, [
  { type: "session_meta", payload: { id: thread, cwd: root } },
  { timestamp: "2026-10-06T10:00:00.000Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Show me the sync plan." }] } },
  { timestamp: "2026-10-06T10:00:05.000Z", type: "response_item", payload: { type: "message", role: "assistant", phase: "final_answer", content: [{ type: "output_text", text: `${REPLY}\n\nOpen [sync.ts](./src/sync.ts) or [spec.md](./docs/spec.md) or [big.txt](./src/big.txt).` }] } },
].map((row) => JSON.stringify(row)).join("\n"));
const db = new Database(join(codexHome, "state_5.sqlite"));
db.exec("CREATE TABLE threads (id TEXT, rollout_path TEXT, cwd TEXT, archived INTEGER, agent_role TEXT, created_at INTEGER, updated_at INTEGER, source TEXT, first_user_message TEXT)");
db.query("INSERT INTO threads VALUES (?, ?, ?, 0, NULL, 1, 1, 'cli', ?)").run(thread, transcript, root, "Show me the sync plan.");
db.close();
const standIn = join(root, "codex");
writeFileSync(standIn, "#!/bin/sh\nsleep 600\n");
chmodSync(standIn, 0o755);
mkdirSync(join(root, "src"));
writeFileSync(join(root, "src", "sync.ts"), `${SYNC_LINES.join("\n")}\n`);
mkdirSync(join(root, "docs"));
writeFileSync(join(root, "docs", "spec.md"), `${SPEC_LINES.join("\n")}\n`);
/** The smallest load limit (seeded in the settings): `src/big.txt`, a little past it, opens cut short. */
const TEXT_LOAD_LIMIT = 256 * 1024;
writeFileSync(join(root, "src", "big.txt"), "a line of plain text, 0123456789\n".repeat(Math.ceil((TEXT_LOAD_LIMIT + 1024) / 33)));

const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };
const { defaultBrowserType: _webkit, ...iPhone } = devices["iPhone 13"]!;
const PHONE: BrowserContextOptions = { ...iPhone, hasTouch: true };

/** Polls `check` every 50 ms until it holds; throws at the deadline (no fixed sleeps). */
async function eventually(what: string, check: () => Promise<boolean>, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(50);
  }
}

/** How many ranges the named CSS Custom Highlight holds: what is painted over the text of the comments. */
const highlighted = (page: Page, name = "block-comment"): Promise<number> => page.evaluate((highlight) => {
  const registry = (CSS as unknown as { highlights?: { get(key: string): { size: number } | undefined } }).highlights;
  return registry?.get(highlight)?.size ?? 0;
}, name);

/**
 * Selects text the way the end of a drag leaves it: from the start of `from` in `first` to the end of
 * `to` in `last` (the element's own text; `last` may be `first`), made the page's selection, then the
 * `pointerup` that ends a gesture, at the selection's end.
 */
async function selectText(first: Locator, from: string, last: Locator, to: string): Promise<void> {
  await first.evaluate((start, { stop, text }) => {
    const own = (element: Element): { nodes: Text[]; all: string } => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      let all = "";
      for (let next = walker.nextNode(); next; next = walker.nextNode()) {
        nodes.push(next as Text);
        all += (next as Text).data;
      }
      return { nodes, all };
    };
    const point = (found: { nodes: Text[] }, offset: number, atEnd: boolean): [Text, number] => {
      let seen = 0;
      for (const piece of found.nodes) {
        if (offset < seen + piece.length || (atEnd && offset === seen + piece.length)) return [piece, offset - seen];
        seen += piece.length;
      }
      throw new Error("no text node at the offset");
    };
    const head = own(start);
    const tail = own(stop as Element);
    const at = head.all.indexOf(text.from);
    if (at < 0) throw new Error(`"${text.from}" is not in ${JSON.stringify(head.all)}`);
    const on = tail.all.indexOf(text.to, stop === start ? at : 0);
    if (on < 0) throw new Error(`"${text.to}" is not in ${JSON.stringify(tail.all)}`);
    const range = document.createRange();
    range.setStart(...point(head, at, false));
    range.setEnd(...point(tail, on + text.to.length, true));
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const line = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0).at(-1) ?? range.getBoundingClientRect();
    (stop as Element).dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      pointerType: matchMedia("(pointer: coarse)").matches ? "touch" : "mouse",
      clientX: line.right,
      clientY: line.top + line.height / 2,
    }));
  }, { stop: await last.elementHandle(), text: { from, to } });
}

/** The context and page of a case: the pane's chat, its reply drawn, with an empty comment store; `errors` collects the page's, `sent` the texts it submitted to the pane. */
interface Opened { page: Page; errors: string[]; sent: string[]; close: () => Promise<void> }

/**
 * A case: given the browser and the pane, it opens its own pages. `seed`: comments the pane's store
 * holds before the page first loads (as another session left them), else it starts empty.
 */
type Case = (open: (options: BrowserContextOptions, seed?: readonly object[]) => Promise<Opened>) => Promise<void>;

/** A stored comment on lines `first`–`last` of `file` (whose lines are `lines`), in `view`, as the viewer saves one on whole lines. */
function seededComment(id: string, file: string, label: string, view: "code" | "preview", lines: readonly string[], first: number, last: number, comment: string, created: number, quoteLines?: string[]): object {
  const source = lines.slice(first - 1, last);
  return { kind: "file", id, anchor: `file:${file}:${view}:${first}-${last}`, created, comment, path: file, label, view, lines: [first, last], source, quoteLines: quoteLines ?? source };
}

/** The viewer of `src/sync.ts`, opened from the reply's link (a tap on a touch screen), with its code drawn. */
async function openSync(page: Page, touch = false): Promise<Locator> {
  const link = page.getByRole("button", { name: "sync.ts", exact: true });
  if (touch) await link.tap();
  else await link.click();
  const viewer = page.getByRole("dialog", { name: "sync.ts", exact: true });
  await viewer.locator(`.file-viewer-text .hl-line[data-source-line="${SYNC_LINES.length}"]`).waitFor();
  return viewer;
}

/** The viewer of `docs/spec.md`, opened from the reply's link (a tap on a touch screen), with its preview drawn. */
async function openSpec(page: Page, touch = false): Promise<Locator> {
  const link = page.getByRole("button", { name: "spec.md", exact: true });
  if (touch) await link.tap();
  else await link.click();
  const viewer = page.getByRole("dialog", { name: "spec.md", exact: true });
  await viewer.locator(`.file-viewer-markdown .hl-line[data-source-line="${SPEC_LINES.length - 1}"]`).waitFor();
  return viewer;
}

/** The element of the preview in `viewer` that source line `n` starts (`data-source-line`). */
const previewLine = (viewer: Locator, n: number): Locator => viewer.locator(`.file-viewer-markdown [data-source-line="${n}"]`);

/** The file comments of the page's store, of every pane: what a send would quote. */
const storedFileComments = (page: Page): Promise<{ lines: number[]; quoteLines: string[]; view: string }[]> => page.evaluate(() => {
  const found: { lines: number[]; quoteLines: string[]; view: string }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)!;
    if (!key.startsWith("herdr-web-ui:block-comments:")) continue;
    for (const comment of (JSON.parse(localStorage.getItem(key)!) as { comments: { kind?: string; lines: number[]; quoteLines: string[]; view: string }[] }).comments) {
      if (comment.kind === "file") found.push({ lines: comment.lines, quoteLines: comment.quoteLines, view: comment.view });
    }
  }
  return found;
});

/** Line `n` of the code in `viewer`. */
const lineOf = (viewer: Locator, n: number): Locator => viewer.locator(`.file-viewer-text .hl-line[data-source-line="${n}"]`);
/** The cards and form hanging under line `n`. */
const notesUnder = (viewer: Locator, n: number): Locator => viewer.locator(`.file-viewer-text .hl-line[data-source-line="${n}"] + .file-comment-notes`);
/** Waits for an opened form's field to take the focus (it does a frame after the form opens): Escape is the form's from there. */
const fieldFocused = (page: Page): Promise<void> => eventually("the form's field to take the focus", () => page.evaluate(() => document.activeElement?.matches(".block-comment-card.is-editing textarea") ?? false));
/** A reference's text as read (`FileReferenceLabel`: the stem, then the extension and the lines). */
const referenceText = (reference: Locator): Promise<string | null> => reference.evaluate((node) => node.textContent);

const cases: Record<string, Case> = {
  /** The chat's comment flow, unchanged by the form, the cards and the highlights being shared with the viewer. */
  async chat(open) {
    const { page, errors, close } = await open(DESKTOP);
    const paragraph = page.locator(".chat-view p.is-commentable", { hasText: REPLY });
    await selectText(paragraph, "every revision", paragraph, "in order");
    const button = page.locator(".chat-view .comment-selection");
    await button.waitFor();
    await button.click();
    const form = page.locator(".chat-view .block-comment-card.is-editing");
    await form.waitFor();
    const field = form.getByRole("textbox", { name: "Comment", exact: true });
    await field.fill("Say which order.");
    await page.keyboard.press("Control+Enter");
    await form.waitFor({ state: "detached" });
    const card = page.locator(".chat-view .block-comment-card:not(.is-editing)");
    await card.waitFor();
    assert.equal(await card.count(), 1);
    assert.equal(await card.locator(".block-comment-badge").textContent(), "Pending");
    assert.equal(await card.locator(".block-comment-text").innerText(), "Say which order.");
    await eventually("the comment's text to be highlighted", async () => (await highlighted(page)) > 0);
    console.log("PASS chat: a selection's Comment button opens the inline form; Ctrl+Enter saves a Pending card, highlighted");

    // the card is laid out as the form: Edit swaps one for the other with nothing moving
    const shape = (box: Locator, text: string): Promise<{ top: number; height: number; radius: string; textTop: number; footerTop: number; lastRight: number }> => box.evaluate((node, inner) => {
      const rect = node.getBoundingClientRect();
      const actions = node.querySelector(".block-comment-actions")!;
      return {
        top: rect.top, height: rect.height, radius: getComputedStyle(node).borderTopLeftRadius,
        textTop: node.querySelector(inner)!.getBoundingClientRect().top - rect.top,
        footerTop: actions.getBoundingClientRect().top - rect.top,
        lastRight: rect.right - actions.lastElementChild!.getBoundingClientRect().right,
      };
    }, text);
    const asCard = await shape(card, ".block-comment-text");
    assert.ok(asCard.footerTop > asCard.textTop, "the card's badge and buttons are under its text");
    await card.getByRole("button", { name: "Edit comment", exact: true }).click();
    await form.waitFor();
    assert.equal(await field.inputValue(), "Say which order.", "Edit opens the form with the comment");
    const asForm = await shape(form, "textarea");
    assert.equal(asForm.radius, asCard.radius, "the form and the card have one radius");
    for (const key of ["top", "height", "textTop", "footerTop", "lastRight"] as const) {
      assert.ok(Math.abs(asForm[key] - asCard[key]) <= 1, `the form's ${key} is the card's (${asForm[key]} vs ${asCard[key]})`);
    }
    console.log("PASS chat: the card is laid out as its form (text on top, badge and buttons in the footer, one radius); Edit moves nothing");
    await fieldFocused(page);
    await page.keyboard.press("Escape");
    await form.waitFor({ state: "detached" });
    await card.waitFor();
    console.log("PASS chat: Edit reopens the form with the text; Escape on the untouched form closes it");

    const walk = page.locator(".composer-surface > .composer-comments-bar button.composer-comments-walk");
    await walk.waitFor();
    assert.equal(await walk.getAttribute("aria-label"), "1 comment on the reply");
    await walk.click();
    await eventually("the walk to focus the card", () => page.evaluate(() => document.activeElement?.matches(".chat-view .block-comment-card:not(.is-editing)") ?? false));
    console.log("PASS chat: with one comment the composer bar shows, and its walk focuses the card");

    await card.getByRole("button", { name: "Delete comment", exact: true }).click();
    await eventually("the card to go", async () => (await card.count()) === 0);
    await walk.waitFor({ state: "detached" });
    await eventually("the highlight to go", async () => (await highlighted(page)) === 0);
    console.log("PASS chat: Delete removes the card, its highlight and the bar");
    assert.deepEqual(errors, []);
    await close();
  },

  /** The code view on a desktop: a triple click, a selection, the copy, Escape. */
  async code(open) {
    const { page, errors, close } = await open(DESKTOP);
    const viewer = await openSync(page);
    const filePath = await viewer.locator(".file-viewer-meta").getAttribute("title");
    assert.ok(filePath?.endsWith("/src/sync.ts"), `the viewer names the file's path: ${filePath}`);
    assert.equal(await viewer.locator(".file-viewer-body[data-comment-surface]").count(), 1, "the body is a comment surface");

    // 1. a triple click selects one line (to the next line's start): its Comment button is for that line alone.
    // No "+" in the gutter: a comment is on selected text, as in the chat
    await lineOf(viewer, 8).hover();
    assert.equal(await viewer.locator(".file-comment-add").count(), 0, "no + beside the hovered line");
    await lineOf(viewer, 8).click({ clickCount: 3 });
    const commentButton = viewer.locator(".comment-selection");
    await commentButton.waitFor();
    await commentButton.click();
    const form = viewer.locator(".block-comment-card.is-editing");
    await form.waitFor();
    assert.equal(await notesUnder(viewer, 8).locator(".block-comment-card.is-editing").count(), 1, "the form opens after line 8");
    const formReference = form.locator(".comment-file-reference");
    assert.equal(await referenceText(formReference), "sync.ts · Line 8");
    assert.equal(await formReference.getAttribute("title"), filePath);
    console.log("PASS code: no + beside a line; a triple-clicked line's Comment button opens the form after it, naming sync.ts · Line 8");

    // 2. saved: a Pending card, the line highlighted
    await form.getByRole("textbox", { name: "Comment", exact: true }).fill("Compare with <=.");
    await page.keyboard.press("Control+Enter");
    await form.waitFor({ state: "detached" });
    const lineCard = notesUnder(viewer, 8).locator(".block-comment-card:not(.is-editing)");
    await lineCard.waitFor();
    assert.equal(await lineCard.locator(".block-comment-badge").textContent(), "Pending");
    assert.equal(await referenceText(lineCard.locator(".comment-file-reference")), "sync.ts · Line 8");
    await eventually("line 8 to be highlighted", async () => (await highlighted(page)) > 0);
    const before = await highlighted(page);
    console.log("PASS code: Ctrl+Enter saves a Pending card under line 8; its text is highlighted");

    // 3. a selection over several lines, with a card between them
    await selectText(lineOf(viewer, 7), "await load", lineOf(viewer, 9), "return");
    await commentButton.waitFor();
    await commentButton.click();
    await form.waitFor();
    assert.equal(await referenceText(form.locator(".comment-file-reference")), "sync.ts · Lines 7–9");
    await form.getByRole("textbox", { name: "Comment", exact: true }).fill("Range note");
    await page.keyboard.press("Control+Enter");
    await form.waitFor({ state: "detached" });
    const rangeCard = notesUnder(viewer, 9).locator(".block-comment-card:not(.is-editing)");
    await rangeCard.waitFor();
    assert.equal(await referenceText(rangeCard.locator(".comment-file-reference")), "sync.ts · Lines 7–9");
    assert.equal(await rangeCard.locator(".block-comment-text").innerText(), "Range note");
    await eventually("the selection to be highlighted too", async () => (await highlighted(page)) > before);
    console.log("PASS code: a selection over lines 7–9 makes a card under line 9, and its text is highlighted");

    // 4. a copy over the cards is the code alone
    const copied = await lineOf(viewer, 6).evaluate((first) => {
      const last = first.closest("code")!.querySelector('.hl-line[data-source-line="10"]')!;
      const range = document.createRange();
      range.setStart(first, 0);
      range.setEnd(last, last.childNodes.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      const cards = [...document.querySelectorAll(".file-viewer-text .block-comment-card")].filter((card) => range.intersectsNode(card)).length;
      const clipboardData = new DataTransfer();
      const event = new ClipboardEvent("copy", { clipboardData, bubbles: true, cancelable: true });
      first.dispatchEvent(event);
      return { text: clipboardData.getData("text/plain"), cards, prevented: event.defaultPrevented };
    });
    assert.equal(copied.cards, 2, "the selection runs over both cards");
    assert.ok(copied.prevented, "the viewer writes the copy itself");
    assert.equal(copied.text, SYNC_LINES.slice(5, 10).join("\n"), "the copy is lines 6–10 exactly");
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    console.log("PASS code: copying lines 6–10 over two cards copies the five source lines exactly");

    // a copy inside a card is the browser's own: the comment's text, not an empty clipboard
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(page.url()).origin });
    await page.evaluate(() => navigator.clipboard.writeText("before the copy"));
    await rangeCard.locator(".block-comment-text").evaluate((text) => {
      // a focused field would copy its own selection
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      const range = document.createRange();
      range.selectNodeContents(text);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await page.keyboard.press("Control+C");
    await eventually("the card's text on the clipboard", async () => (await page.evaluate(() => navigator.clipboard.readText())) === "Range note");
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    console.log("PASS code: copying text inside a card copies that text");

    // 5. Escape: the untouched form first, then the viewer
    await lineOf(viewer, 3).click({ clickCount: 3 });
    await commentButton.waitFor();
    await commentButton.click();
    await form.waitFor();
    await fieldFocused(page);
    await page.keyboard.press("Escape");
    await form.waitFor({ state: "detached" });
    assert.ok(await viewer.isVisible(), "the viewer stays while Escape closes the form");
    await page.keyboard.press("Escape");
    await viewer.waitFor({ state: "detached" });
    console.log("PASS code: Escape closes an untouched form, the viewer stays; a second Escape closes the viewer");
    assert.deepEqual(errors, []);
    await close();
  },

  /** The code view on a phone: a selection's Comment button, no comment by a tap on a line number, Copy file. */
  async "code-phone"(open) {
    const { page, errors, close } = await open(PHONE);
    assert.ok(await page.evaluate(() => matchMedia("(pointer: coarse)").matches), "the phone's pointer is coarse");
    const viewer = await openSync(page, true);
    const tapPoint = (n: number): Promise<{ x: number; y: number }> => lineOf(viewer, n).evaluate((line) => {
      line.scrollIntoView({ block: "center" });
      const code = line.closest("code")!;
      const box = code.getBoundingClientRect();
      const start = box.left + code.clientLeft + parseFloat(getComputedStyle(code).paddingInlineStart);
      const rect = line.getClientRects()[0]!;
      return { x: (box.left + start) / 2, y: rect.top + rect.height / 2 };
    });
    // a tap on a line number does nothing of its own
    const number = await tapPoint(3);
    await page.touchscreen.tap(number.x, number.y);
    const form = viewer.locator(".block-comment-card.is-editing");
    assert.equal(await form.count(), 0, "a tap on a line number opens no form");
    const code = viewer.locator(".file-viewer-text");
    assert.notEqual(await code.evaluate((pre) => getComputedStyle(pre).userSelect), "none", "the code takes a selection on a touch screen");
    // text selected (as a long press and its handles leave it): the Comment button, under it, opens the form
    await selectText(lineOf(viewer, 8), "if", lineOf(viewer, 8), "revision");
    const commentButton = viewer.locator(".comment-selection");
    await commentButton.waitFor();
    await commentButton.tap();
    await form.waitFor();
    assert.equal(await referenceText(form.locator(".comment-file-reference")), "sync.ts · Line 8");
    assert.equal(await notesUnder(viewer, 8).locator(".block-comment-card.is-editing").count(), 1, "the form opens after line 8");
    await form.getByRole("button", { name: "Cancel", exact: true }).tap();
    await form.waitFor({ state: "detached" });
    console.log("PASS code-phone: a tap on a line number opens nothing; selected code's Comment button opens the form for Line 8");

    const copyButton = viewer.getByRole("button", { name: /^(Copy file|File copied)$/ });
    await page.evaluate(() => {
      const target = window as unknown as { copiedText: string | null };
      target.copiedText = null;
      Object.defineProperty(navigator, "clipboard", { value: { writeText: (value: string) => { target.copiedText = value; return Promise.resolve(); } }, configurable: true });
    });
    await copyButton.tap();
    await eventually("Copy file to copy the file", () => page.evaluate((whole) => (window as unknown as { copiedText: string | null }).copiedText === whole, `${SYNC_LINES.join("\n")}\n`));
    // without a clipboard API it selects the code
    await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("no clipboard")) }, configurable: true }));
    await copyButton.tap();
    await eventually("Copy file to select the source", () => page.evaluate((whole) => window.getSelection()?.toString() === whole, SYNC_LINES.join("\n")));
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    console.log("PASS code-phone: Copy file copies the whole file; without a clipboard it selects the source");

    // a file cut short takes comments too, and a viewer without a pane none
    await viewer.getByRole("button", { name: "Close file", exact: true }).tap();
    await viewer.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "big.txt", exact: true }).tap();
    const big = page.getByRole("dialog", { name: "big.txt", exact: true });
    await big.locator(".file-viewer-text .hl-line").first().waitFor();
    assert.equal(await big.locator(".file-viewer-meta .file-viewer-notice").count(), 1, "big.txt opens cut short");
    assert.equal(await big.locator(".file-viewer-body[data-comment-surface]").count(), 1, "a file cut short takes comments");
    await big.getByRole("button", { name: "Close file", exact: true }).tap();
    await big.waitFor({ state: "detached" });
    // as the app opens a file with no pane selected (App.tsx `viewFile`): the preview's history entry, read on load
    await page.evaluate((path) => history.replaceState({ ...history.state, "herdr-web-ui:file-preview": { path, paneId: null, machineId: "local" } }, ""), join(root, "src", "sync.ts"));
    await page.reload();
    const paneless = page.getByRole("dialog", { name: "sync.ts", exact: true });
    await paneless.locator(`.file-viewer-text .hl-line:nth-of-type(${SYNC_LINES.length})`).waitFor();
    assert.equal(await paneless.locator(".file-viewer-body[data-comment-surface]").count(), 0, "no comments without a pane");
    console.log("PASS code-phone: a file cut short takes comments; a viewer without a pane takes none");
    assert.deepEqual(errors, []);
    await close();
  },

  /** The Markdown preview: a selection names the source lines it came from, its card follows the block; and on a phone, a long press. */
  async preview(open) {
    const { page, errors, close } = await open(DESKTOP);
    const viewer = await openSpec(page);
    assert.equal(await viewer.locator(".file-viewer-body[data-comment-surface]").count(), 1, "the preview is a comment surface");
    const form = viewer.locator(".block-comment-card.is-editing");
    const commentButton = viewer.locator(".comment-selection");
    const tableNotes = viewer.locator(".file-viewer-markdown .markdown-block:has(table) + .file-comment-notes");

    // 1. across the table's rows 42–43: the form and then the card under the table
    await selectText(previewLine(viewer, 42), "Older revision", previewLine(viewer, 43), "merged note");
    await commentButton.waitFor();
    await commentButton.click();
    await form.waitFor();
    assert.equal(await tableNotes.locator(".block-comment-card.is-editing").count(), 1, "the form opens under the table");
    assert.equal(await referenceText(form.locator(".comment-file-reference")), "spec.md · Lines 42–43");
    await form.getByRole("textbox", { name: "Comment", exact: true }).fill("Also return the stored revision.");
    await page.keyboard.press("Control+Enter");
    await form.waitFor({ state: "detached" });
    const tableCard = tableNotes.locator(".block-comment-card:not(.is-editing)");
    await tableCard.waitFor();
    assert.equal(await tableCard.locator(".block-comment-badge").textContent(), "Pending");
    assert.equal(await referenceText(tableCard.locator(".comment-file-reference")), "spec.md · Lines 42–43");
    await eventually("the rows' text to be highlighted", async () => (await highlighted(page)) > 0);
    // the quote reads the rows' cells, set off by " | ", with no separator at a row's start
    assert.deepEqual(await storedFileComments(page), [{
      lines: [42, 43],
      quoteLines: ["Older revision | 409 Conflict with the stored note", "Newer revision | 200 with the merged note"],
      view: "preview",
    }]);
    console.log("PASS preview: a selection over the table's rows names spec.md · Lines 42–43; its form and Pending card hang under the table");

    // 2. inside the paragraph's second line: that source line alone
    await selectText(previewLine(viewer, 4), "revision it stores", previewLine(viewer, 4), "revision it stores");
    await commentButton.waitFor();
    await commentButton.click();
    await form.waitFor();
    assert.equal(await referenceText(form.locator(".comment-file-reference")), "spec.md · Line 4");
    assert.equal(await viewer.locator(".file-viewer-markdown p + .file-comment-notes .block-comment-card.is-editing").count(), 1, "the form opens under the paragraph");
    await form.getByRole("button", { name: "Cancel", exact: true }).click();
    await form.waitFor({ state: "detached" });
    console.log("PASS preview: a selection in the paragraph's second line names Line 4");

    // 3. a word of the fenced block: the fence's line + 1 + its index
    await selectText(previewLine(viewer, 50), "retries", previewLine(viewer, 50), "retries");
    await commentButton.waitFor();
    await commentButton.click();
    await form.waitFor();
    assert.equal(await referenceText(form.locator(".comment-file-reference")), "spec.md · Line 50");
    assert.equal(await viewer.locator(".file-viewer-markdown .markdown-block:has(.markdown-code) + .file-comment-notes .block-comment-card.is-editing").count(), 1, "the form opens under the code block");
    await form.getByRole("button", { name: "Cancel", exact: true }).click();
    await form.waitFor({ state: "detached" });
    console.log("PASS preview: a word in the fenced block names Line 50, the fence's line + 1");

    // a list item's continuation line: the item's lines; its form follows the item's own text
    await selectText(previewLine(viewer, 45), "stored revision", previewLine(viewer, 45), "stored revision");
    await commentButton.waitFor();
    await commentButton.click();
    await form.waitFor();
    assert.equal(await referenceText(form.locator(".comment-file-reference")), "spec.md · Lines 45–46");
    assert.equal(await viewer.locator(".file-viewer-markdown .markdown-item + .file-comment-notes .block-comment-card.is-editing").count(), 1, "the form opens under the item");
    await form.getByRole("button", { name: "Cancel", exact: true }).click();
    await form.waitFor({ state: "detached" });
    console.log("PASS preview: a selection in a list item's continuation names the item's Lines 45–46, under the item");

    // a comment shows only in the view it was written in
    const showSource = viewer.getByRole("button", { name: "Show source", exact: true });
    await showSource.click();
    await lineOf(viewer, 42).waitFor();
    assert.equal(await viewer.locator(".block-comment-card").count(), 0, "the preview's comment has no card in the code");
    await showSource.click();
    await tableCard.waitFor();
    console.log("PASS preview: the preview's comment shows in the preview only");
    assert.deepEqual(errors, []);
    await close();

    // a phone: a long press selects a word of the paragraph, and the Comment button shows below it.
    // Headless Chromium selects nothing on a long press (neither a synthesized tap gesture held for a
    // second nor raw touch events do), so the word is selected as a long press leaves it, and its
    // gesture ends with a touch's pointerup (`selectText` on a coarse pointer)
    const phone = await open(PHONE);
    const phoneViewer = await openSpec(phone.page, true);
    await previewLine(phoneViewer, 3).evaluate((line) => line.scrollIntoView({ block: "center" }));
    await selectText(previewLine(phoneViewer, 3), "revision", previewLine(phoneViewer, 3), "revision");
    assert.equal(await phone.page.evaluate(() => window.getSelection()?.toString()), "revision");
    const phoneButton = phoneViewer.locator(".comment-selection");
    await phoneButton.waitFor();
    const below = await phoneButton.evaluate((button) => {
      const rects = [...window.getSelection()!.getRangeAt(0).getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
      return { top: button.getBoundingClientRect().top, bottom: rects.at(-1)!.bottom };
    });
    assert.ok(below.top >= below.bottom, `the Comment button is below the selection (${below.top} vs ${below.bottom})`);
    await phoneButton.tap();
    const phoneForm = phoneViewer.locator(".block-comment-card.is-editing");
    await phoneForm.waitFor();
    assert.equal(await referenceText(phoneForm.locator(".comment-file-reference")), "spec.md · Line 3");
    console.log("PASS preview: on a phone a word selected by touch shows the Comment button below it, which opens the form for Line 3");
    assert.deepEqual(phone.errors, []);
    await phone.close();
  },

  /**
   * The viewer's header: the counter of the file's comments walks them one per tap, follows them when
   * the file changes, opens an outdated one in the modal editor and switches to the view a comment
   * was written in. It has no Write message button: Close is the way back to the message box.
   */
  async header(open) {
    const syncFile = join(root, "src", "sync.ts");
    const syncPath = realpathSync(syncFile);
    const specPath = realpathSync(join(root, "docs", "spec.md"));
    const page8 = "seed-line-8";
    const range = "seed-lines-7-9";
    const table = "seed-spec-42-43";
    const { page, errors, close } = await open(DESKTOP, [
      seededComment(page8, syncPath, "src/sync.ts", "code", SYNC_LINES, 8, 8, "Compare with <=.", 1),
      seededComment(range, syncPath, "src/sync.ts", "code", SYNC_LINES, 7, 9, "Range note", 2),
      seededComment(table, specPath, "docs/spec.md", "preview", SPEC_LINES, 42, 43, "Also return the stored revision.", 3,
        ["Older revision | 409 Conflict with the stored note", "Newer revision | 200 with the merged note"]),
    ]);
    const card = (viewer: Locator, id: string): Locator => viewer.locator(`.block-comment-card[data-comment-id="${id}"]`);
    /** Whether the card of `id` has the focus and is inside the viewer's body on screen. */
    const focusedInView = (id: string): Promise<boolean> => page.evaluate((wanted) => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !active.matches(`.block-comment-card[data-comment-id="${wanted}"]`)) return false;
      const body = active.closest(".file-viewer-body")!.getBoundingClientRect();
      const box = active.getBoundingClientRect();
      return box.top >= body.top - 1 && box.bottom <= body.bottom + 1;
    }, id);
    const writeSync = (lines: readonly string[]): void => writeFileSync(syncFile, `${lines.join("\n")}\n`);
    try {
      // 1. two comments: the counter reads 2 comments, and walks to them in sending order (lines 7–9, then line 8)
      let viewer = await openSync(page);
      assert.equal(await viewer.locator(".file-viewer-meta").getAttribute("title"), syncPath, "the comments were seeded on the path the viewer resolves");
      let counter = viewer.locator("button.file-viewer-comments");
      await counter.waitFor();
      assert.equal(await counter.getAttribute("aria-label"), "2 comments");
      assert.equal(await counter.locator(".file-viewer-comments-count").textContent(), "2", "the count is a bubble on the icon");
      assert.equal(await counter.innerText(), "2", "the button shows no words, only the bubble's count");
      await counter.click();
      await eventually("the walk to focus the comment on lines 7–9, in view", () => focusedInView(range));
      assert.equal(await notesUnder(viewer, 9).locator(`[data-comment-id="${range}"]`).count(), 1, "the first stop is the card under line 9");
      await eventually("its text to take the current highlight", async () => (await highlighted(page, "block-comment-current")) > 0);
      await counter.click();
      await eventually("the walk to focus the comment on line 8, in view", () => focusedInView(page8));
      assert.equal(await card(viewer, range).evaluate((note) => note.classList.contains("is-current")), false, "the walk stands on one card at a time");
      console.log("PASS header: the counter reads 2 comments; each tap walks to the next card (lines 7–9, then line 8), focused and in view");

      // 2. two lines inserted above line 8: the comment on line 8 follows its line to line 10, and the store says so
      await viewer.getByRole("button", { name: "Close file", exact: true }).click();
      await viewer.waitFor({ state: "detached" });
      const moved = [...SYNC_LINES.slice(0, 7), "  // a revision is a counter", "  // that only grows", ...SYNC_LINES.slice(7)];
      writeSync(moved);
      viewer = await openSync(page);
      await lineOf(viewer, moved.length).waitFor();
      await notesUnder(viewer, 10).locator(`[data-comment-id="${page8}"]`).waitFor();
      const storedLines = (id: string): Promise<number[] | null> => page.evaluate((wanted) => {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i)!;
          if (!key.startsWith("herdr-web-ui:block-comments:")) continue;
          const found = (JSON.parse(localStorage.getItem(key)!) as { comments: { id: string; lines: number[] }[] }).comments.find((c) => c.id === wanted);
          if (found !== undefined) return found.lines;
        }
        return null;
      }, id);
      await eventually("the store to hold the comment's new line", async () => JSON.stringify(await storedLines(page8)) === "[10,10]");
      // lines 7–9 no longer follow each other: that comment has no place in the file now
      counter = viewer.locator("button.file-viewer-comments");
      assert.equal(await counter.getAttribute("aria-label"), "2 comments · 1 outdated");
      assert.deepEqual(await storedLines(range), [7, 9], "an outdated comment keeps its lines");
      console.log("PASS header: after two lines were inserted above line 8, its comment shows at line 10 and is stored as lines [10, 10]");

      // 3. line 7 changed: the comment on lines 7–9 stays outdated, and the walk opens it in the modal editor
      await viewer.getByRole("button", { name: "Close file", exact: true }).click();
      await viewer.waitFor({ state: "detached" });
      writeSync(moved.map((line, index) => index === 6 ? "  const stored = await loadLatest(incoming.id);" : line));
      viewer = await openSync(page);
      counter = viewer.locator("button.file-viewer-comments");
      await counter.waitFor();
      assert.equal(await counter.getAttribute("aria-label"), "2 comments · 1 outdated");
      const editor = page.locator(".comment-editor");
      for (let tap = 0; tap < 2 && (await editor.count()) === 0; tap++) await counter.click();
      await editor.waitFor();
      assert.equal(await referenceText(editor.locator(".comment-editor-reference .comment-file-reference")), "sync.ts · Lines 7–9");
      assert.equal(await editor.locator("pre.comment-editor-plain").textContent(), SYNC_LINES.slice(6, 9).join("\n"), "the quote is the lines as they were");
      assert.equal(await editor.locator(".comment-editor-note").textContent(), "This part of the file has changed since.");
      assert.equal(await editor.getByRole("textbox", { name: "Comment", exact: true }).inputValue(), "Range note");
      await eventually("the editor's field to take the focus", () => page.evaluate(() => document.activeElement?.matches(".comment-editor textarea") ?? false));
      await page.keyboard.press("Escape");
      await editor.waitFor({ state: "detached" });
      assert.ok(await viewer.isVisible(), "Escape closes the editor, not the viewer");
      console.log("PASS header: with line 7 changed the counter reads 2 comments · 1 outdated; the walk opens the modal with sync.ts · Lines 7–9, the old quote and the note; Escape closes only it");

      // 4. no Write message: the header's comment group is the counter alone
      assert.equal(await viewer.getByRole("button", { name: "Write message", exact: true }).count(), 0, "no Write message button");
      await viewer.getByRole("button", { name: "Close file", exact: true }).click();
      await viewer.waitFor({ state: "detached" });
      console.log("PASS header: the header has no Write message button");

      // 5. a comment written in the preview, walked to from the code: the view switches to it
      const spec = await openSpec(page);
      await spec.getByRole("button", { name: "Show source", exact: true }).click();
      await lineOf(spec, 42).waitFor();
      const specCounter = spec.locator("button.file-viewer-comments");
      assert.equal(await specCounter.getAttribute("aria-label"), "1 comment");
      await specCounter.click();
      await spec.locator(".file-viewer-markdown").waitFor();
      await eventually("the walk to focus the preview's comment, in view", () => focusedInView(table));
      console.log("PASS header: walking to a comment written in the preview switches the code view to the preview and focuses its card");
      assert.deepEqual(errors, []);
    } finally {
      writeSync(SYNC_LINES);
      await close();
    }
  },

  /**
   * The composer's bar counts the file comments too, and its walk goes on from the chat's comments
   * into the files: each file stop opens the viewer at that comment, in the view it was written in;
   * after the viewer closes, the next tap goes on after the comment it showed last. A send takes them all.
   */
  async composer(open) {
    const syncPath = realpathSync(join(root, "src", "sync.ts"));
    const specPath = realpathSync(join(root, "docs", "spec.md"));
    const line8 = "seed-sync-8";
    const table = "seed-spec-42-43";
    const tableQuote = ["Older revision | 409 Conflict with the stored note", "Newer revision | 200 with the merged note"];
    // the spec's comment was written first: its file's comments are sent first
    const { page, errors, sent, close } = await open(DESKTOP, [
      seededComment(line8, syncPath, "src/sync.ts", "code", SYNC_LINES, 8, 8, "Compare with <=.", 2),
      seededComment(table, specPath, "docs/spec.md", "preview", SPEC_LINES, 42, 43, "Also return the stored revision.", 1, tableQuote),
    ]);
    const walk = page.locator(".composer-surface > .composer-comments-bar button.composer-comments-walk");
    await walk.waitFor();
    assert.equal(await walk.getAttribute("aria-label"), "2 comments", "with file comments the bar counts comments, not comments on the reply");

    // the chat's comment, written as in the chat case: a reply comment's anchor is the chat's to make
    const paragraph = page.locator(".chat-view p.is-commentable", { hasText: REPLY });
    await selectText(paragraph, "every revision", paragraph, "in order");
    await page.locator(".chat-view .comment-selection").click();
    const form = page.locator(".chat-view .block-comment-card.is-editing");
    await form.getByRole("textbox", { name: "Comment", exact: true }).fill("Say which order.");
    await page.keyboard.press("Control+Enter");
    await form.waitFor({ state: "detached" });
    const chatCard = page.locator(".chat-view .block-comment-card:not(.is-editing)");
    await chatCard.waitFor();
    await eventually("the bar to count 3 comments", async () => (await walk.getAttribute("aria-label")) === "3 comments");
    assert.equal(await walk.locator(".composer-comments-text").textContent(), "3 comments");
    console.log("PASS composer: with one comment on the reply and two on files, the bar reads 3 comments");

    /** Whether the focus is on the card of `id`, inside the viewer's body and on screen. */
    const focusedInViewer = (id: string): Promise<boolean> => page.evaluate((wanted) => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !active.matches(`.file-viewer-body .block-comment-card[data-comment-id="${wanted}"]`)) return false;
      const body = active.closest(".file-viewer-body")!.getBoundingClientRect();
      const box = active.getBoundingClientRect();
      return box.top >= body.top - 1 && box.bottom <= body.bottom + 1;
    }, id);

    // tap 1: the chat's card
    await walk.click();
    await eventually("the walk to focus the chat's card", () => page.evaluate(() => document.activeElement?.matches(".chat-view .block-comment-card:not(.is-editing)") ?? false));
    assert.equal(await page.locator(".file-viewer").count(), 0, "the chat's stop opens no viewer");
    console.log("PASS composer: tap 1 walks to the chat's card");

    // tap 2: the viewer opens docs/spec.md in the preview, at its comment
    await walk.click();
    const spec = page.getByRole("dialog", { name: "spec.md", exact: true });
    await spec.locator(".file-viewer-markdown").waitFor();
    await eventually("the viewer to focus the spec's comment, in view", () => focusedInViewer(table));
    assert.equal(await spec.locator(".file-viewer-markdown .markdown-block:has(table) + .file-comment-notes .block-comment-card").getAttribute("data-comment-id"), table, "its card hangs under the table");
    assert.equal(await spec.getByRole("button", { name: "Show source", exact: true }).getAttribute("aria-pressed"), "false", "the preview shows");
    // the viewer's own walk has nothing else in this file: it stays on the comment
    const specCounter = spec.locator("button.file-viewer-comments");
    assert.equal(await specCounter.getAttribute("aria-label"), "1 comment");
    await specCounter.click();
    await eventually("the viewer's walk to stay on the spec's comment", () => focusedInViewer(table));
    await spec.getByRole("button", { name: "Close file", exact: true }).click();
    await spec.waitFor({ state: "detached" });
    console.log("PASS composer: tap 2 opens docs/spec.md in the preview at its comment, focused; the viewer's walk stays there");

    // tap 3: on after the comment the viewer showed last, to src/sync.ts in the code view at line 8
    await walk.click();
    const sync = page.getByRole("dialog", { name: "sync.ts", exact: true });
    await lineOf(sync, SYNC_LINES.length).waitFor();
    await eventually("the viewer to focus the comment on line 8, in view", () => focusedInViewer(line8));
    assert.equal(await notesUnder(sync, 8).locator(`[data-comment-id="${line8}"]`).count(), 1, "the card under line 8");
    await sync.getByRole("button", { name: "Close file", exact: true }).click();
    await sync.waitFor({ state: "detached" });
    console.log("PASS composer: tap 3 opens src/sync.ts in the code view at its comment on line 8, focused");

    // a send takes every comment: the reply's first, then the files' in the order they were first commented, then the text
    const expected = [
      "> every revision in order\nSay which order.",
      `> docs/spec.md:42-43\n${tableQuote.map((line) => `> ${line}`).join("\n")}\nAlso return the stored revision.`,
      `> src/sync.ts:8\n> ${SYNC_LINES[7]}\nCompare with <=.`,
      "Thanks",
    ].join("\n\n");
    await page.getByRole("textbox", { name: "Message", exact: true }).fill("Thanks");
    await page.getByRole("button", { name: /^Send message/ }).click();
    await walk.waitFor({ state: "detached" });
    await eventually("the message to be sent", async () => sent.length > 0);
    assert.deepEqual(sent, [expected]);
    const stored = await page.evaluate(() => {
      let count = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)!;
        if (key.startsWith("herdr-web-ui:block-comments:")) count += (JSON.parse(localStorage.getItem(key)!) as { comments: unknown[] }).comments.length;
      }
      return count;
    });
    assert.equal(stored, 0, "the store is empty after the send");
    console.log("PASS composer: Send sends the reply's comment, then docs/spec.md's, then src/sync.ts's, then Thanks; the store is empty after");
    assert.deepEqual(errors, []);
    await close();
  },

  /**
   * The form on a phone. iOS raises the keyboard only for a focus inside the tap's own event: the field
   * must have the focus before the tap's task ends (checked here with only microtasks run after it, no frame).
   * The keyboard then shrinks the view from below (simulated by a shorter viewport): the form stays in it.
   * Send in the message box while a comment is half written sends nothing and shows that form.
   */
  async "form-phone"(open) {
    const { page, errors, sent, close } = await open(PHONE);
    const formField = ".block-comment-card.is-editing textarea";
    /** Shrinks the page as a phone's keyboard does, waits for the view to follow, and says whether `form` is inside `view`'s visible box. */
    const keyboardUp = async (view: Locator, form: Locator): Promise<void> => {
      const before = await view.evaluate((node) => node.clientHeight);
      await page.setViewportSize({ width: PHONE.viewport!.width, height: PHONE.viewport!.height - 300 });
      await eventually("the view to shrink", async () => (await view.evaluate((node) => node.clientHeight)) < before);
      await eventually("the form to be in the shrunk view", () => form.evaluate((card) => {
        const scroller = card.closest(".chat-view, .file-viewer-body")!;
        const box = scroller.getBoundingClientRect();
        const rect = card.getBoundingClientRect();
        return rect.top >= box.top - 1 && rect.bottom <= box.top + scroller.clientHeight + 1;
      }));
      await page.setViewportSize(PHONE.viewport!);
    };

    // the chat: the selection's Comment button
    const paragraph = page.locator(".chat-view p.is-commentable", { hasText: REPLY });
    await selectText(paragraph, "every revision", paragraph, "in order");
    const button = page.locator(".chat-view .comment-selection");
    await button.waitFor();
    const focusedInTap = await button.evaluate(async (node, field) => {
      (node as HTMLElement).click();
      for (let i = 0; i < 20; i++) await Promise.resolve();
      return document.activeElement?.matches(field) ?? false;
    }, formField);
    assert.ok(focusedInTap, "the chat's form takes the focus inside the tap on Comment");
    const chatForm = page.locator(".chat-view .block-comment-card.is-editing");
    await keyboardUp(page.locator(".chat-view"), chatForm);
    console.log("PASS form-phone: the chat's Comment button focuses the field inside the tap; the form stays in view as the keyboard rises");

    // Send with a comment half written: nothing goes, the form takes the focus (in the tap) and shows
    await chatForm.getByRole("textbox", { name: "Comment", exact: true }).fill("Half a thought");
    const message = page.getByRole("textbox", { name: "Message", exact: true });
    await message.fill("Thanks");
    const sendButton = page.getByRole("button", { name: /^Send message/ });
    await chatForm.evaluate((card) => card.closest(".chat-view")!.scrollTo({ top: 0 }));
    const heldForForm = await sendButton.evaluate(async (node, field) => {
      (node as HTMLElement).click();
      for (let i = 0; i < 20; i++) await Promise.resolve();
      return document.activeElement?.matches(field) ?? false;
    }, formField);
    assert.ok(heldForForm, "Send with a typed comment focuses its field, inside the tap");
    await eventually("the form to be scrolled into view", () => chatForm.evaluate((card) => {
      const box = card.closest(".chat-view")!.getBoundingClientRect();
      const rect = card.getBoundingClientRect();
      return rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1;
    }));
    assert.deepEqual(sent, [], "nothing was sent");
    assert.equal(await message.inputValue(), "Thanks", "the message stays in the box");
    await chatForm.getByRole("button", { name: "Cancel", exact: true }).tap();
    await chatForm.waitFor({ state: "detached" });
    await sendButton.tap();
    await eventually("the message to be sent once the form is gone", async () => sent.length > 0);
    assert.deepEqual(sent, ["Thanks"]);
    console.log("PASS form-phone: Send with a comment half written sends nothing and shows the form, focused; after Cancel it sends");

    // the code view: text selected on a line at the view's bottom edge, its Comment button tapped
    await page.getByRole("button", { name: "big.txt", exact: true }).tap();
    const viewer = page.getByRole("dialog", { name: "big.txt", exact: true });
    await lineOf(viewer, 40).waitFor();
    await lineOf(viewer, 40).evaluate((line) => line.scrollIntoView({ block: "end" }));
    await selectText(lineOf(viewer, 40), "plain", lineOf(viewer, 40), "text");
    const codeButton = viewer.locator(".comment-selection");
    await codeButton.waitFor();
    const focusedInCode = await codeButton.evaluate(async (node, field) => {
      (node as HTMLElement).click();
      for (let i = 0; i < 20; i++) await Promise.resolve();
      return document.activeElement?.matches(field) ?? false;
    }, formField);
    assert.ok(focusedInCode, "the code view's form takes the focus inside the tap on Comment");
    const codeForm = viewer.locator(".block-comment-card.is-editing");
    await keyboardUp(viewer.locator(".file-viewer-body"), codeForm);
    console.log("PASS form-phone: the code view's Comment button focuses the field inside the tap; the form stays in view as the keyboard rises");
    assert.deepEqual(errors, []);
    await close();
  },
};

const wanted = process.env.FILE_COMMENTS_CASE?.split(",").map((name) => name.trim()).filter((name) => name !== "") ?? Object.keys(cases);
const unknown = wanted.filter((name) => !(name in cases));
if (unknown.length > 0) throw new Error(`unknown FILE_COMMENTS_CASE: ${unknown.join(", ")} (known: ${Object.keys(cases).join(", ")})`);

let workspace: string | undefined;
let server: ReturnType<typeof createServer> | undefined;
let browser: Browser | undefined;
const failed: string[] = [];

try {
  const created = await workspaceCreate({ cwd: root, label: "herdr-web-ui-test-file-comments" });
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
  const url = `http://127.0.0.1:${server.port}/?pane=${encodeURIComponent(pane)}`;
  const launched = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/opt/google/chrome/chrome", headless: true, args: ["--no-sandbox"] });
  browser = launched;
  /** A fresh context (an empty comment store, or `seed`'s comments) on the pane's chat, its reply drawn. */
  const open = async (options: BrowserContextOptions, seed: readonly object[] = []): Promise<Opened> => {
    const context = await launched.newContext(options);
    const page = await context.newPage();
    await page.addInitScript((id) => {
      localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en", textLoadLimit: id.limit }));
      localStorage.setItem(`herdr-web-ui:view:${id.pane}`, "chat");
      // seeded once: a reload keeps what the page has done to them since
      const key = `herdr-web-ui:block-comments:${id.pane}`;
      if (id.seed.length > 0 && localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify({ version: 1, comments: id.seed }));
    }, { pane, limit: TEXT_LOAD_LIMIT, seed });
    page.setDefaultTimeout(10_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const sent: string[] = [];
    page.on("websocket", (socket) => socket.on("framesent", ({ payload }) => {
      try {
        const frame = JSON.parse(String(payload)) as { type?: string; text?: string };
        if (frame.type === "submit" && typeof frame.text === "string") sent.push(frame.text);
      } catch { /* not JSON */ }
    }));
    await page.goto(url);
    await page.locator(".conn-live").waitFor();
    await page.locator(".chat-view p.is-commentable", { hasText: REPLY }).waitFor();
    return { page, errors, sent, close: () => context.close() };
  };
  for (const name of wanted) {
    try {
      await cases[name]!(open);
      console.log(`PASS case ${name}`);
    } catch (error) {
      failed.push(name);
      console.log(`FAIL case ${name}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    }
  }
} finally {
  await browser?.close();
  server?.stop();
  if (workspace) await workspaceClose(workspace);
  rmSync(root, { recursive: true, force: true });
}
if (failed.length > 0) {
  console.log(`FAIL ${failed.length} of ${wanted.length} cases: ${failed.join(", ")}`);
  process.exit(1);
}
console.log(`PASS all ${wanted.length} cases: ${wanted.join(", ")}`);
