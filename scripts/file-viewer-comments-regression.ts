/**
 * Comments on files in the file viewer, with a real Codex transcript (its reply links `./src/sync.ts`
 * and `./docs/spec.md`) and an owned herdr pane. The cases: `chat` (the chat's own comments, which share the pins, the
 * popover and the highlights with the viewer). In the code view on a desktop (`code-room`, `code-inline`, `code-mode`):
 * the header's comment mode, the ⊕ beside a line's number, the field and the card under the line, in the room after it.
 * In the code view on phones and tablets (`code-touch`): a long press or a tap on a line, the bottom sheet or the field
 * under the line, the mode's hint, the composer's walk opening the sheet. In the Markdown preview (`preview`,
 * `preview-click`): a comment made by a mouse's drag
 * over text (it opens as the mouse lets go) or by clicking or tapping a line, never by a Comment button (there is none: a
 * keyboard or touch selection, a double or triple click open nothing), named by the
 * source lines it came from; its pin's tip where it was clicked or the drag let go, else (a stored comment without a
 * point) after the end of its text (the text highlighted), and the popover beside the pin, to its
 * right (a bottom sheet on a phone), a saved comment opened straight into its field (its text highlighted meanwhile)
 * with Delete beside ↑; Escape, which
 * never closes the viewer while a popover is open; the viewer's header (`header`: the mode's toggle naming the file's
 * comments, which follow their lines, no counter walk, no Write message, no toggle in the preview); the sheet on a phone
 * (`form-phone`); and the composer's bar (`composer`), whose walk goes on from the chat's comments into the files': a pin
 * in the preview, a card in the code view (opened with the mode on), an outdated comment in a dialog, and whose send
 * takes them all.
 *
 * One server, pane and browser per run. Each case starts from a fresh page with an empty comment
 * store, so a case runs alone: `FILE_COMMENTS_CASE=<name>[,<name>]` runs only those (unset: all).
 * Waits are bounded polls (`eventually`, `frames`); a touch's holds in `code-touch` wait for the clock (`holdUntil`),
 * since the time is the gesture itself (a finger resting past `LONG_PRESS_MS`, or short of it) and no state on the page
 * tells an armed press from a pressing one. Serves `dist/`: build first.
 */
import "./test-herdr.ts";
import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, devices, type Browser, type BrowserContextOptions, type Locator, type Page } from "playwright-core";
import { createServer } from "../server/index.ts";
import { LONG_PRESS_MS } from "../src/lib/codeCommentPress.ts";
import { SOURCE_PREVIEW_BYTES } from "../src/lib/filePreviewText.ts";
import { VIRTUAL_SOURCE_LINES } from "../src/lib/sourcePreview.ts";
import { herdrRpc, workspaceClose, workspaceCreate } from "../server/herdr/client.ts";
import { openSettingsPage } from "./settings-page.ts";
import { sheetsSettled } from "./sheets-settled.ts";

/** How long a finger rests to be past the long press (`LONG_PRESS_MS`), and so armed: the press is checked at this mark. */
const HOLD_MS = LONG_PRESS_MS + 150;

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
 * rows are source lines 42–43, a list item with a continuation line, a fenced block on line 50, and a
 * long fenced block the preview folds (its lines 54–88, the head 54–73 drawn).
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
  "",
  "```text",
  ...Array.from({ length: 35 }, (_, n) => `log line ${n + 1} of the sync`),
  "```",
);
assert.ok(SPEC_LINES[41]!.startsWith("| Older revision") && SPEC_LINES[42]!.startsWith("| Newer revision"), "the table's rows are lines 42–43");
assert.equal(SPEC_LINES[49], "const retries = 3;", "the short block's line is line 50");
/** The long block's first line, the last its folded head draws, and a line folded away. */
const FOLD_FIRST = 54;
const FOLD_HEAD_LAST = FOLD_FIRST + 19;
const FOLDED_LINE = 80;
assert.equal(SPEC_LINES[FOLD_FIRST - 1], "log line 1 of the sync");
assert.equal(SPEC_LINES[FOLDED_LINE - 1], "log line 27 of the sync");

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
  { timestamp: "2026-10-06T10:00:05.000Z", type: "response_item", payload: { type: "message", role: "assistant", phase: "final_answer", content: [{ type: "output_text", text: `${REPLY}\n\nOpen [sync.ts](./src/sync.ts) or [spec.md](./docs/spec.md) or [big.txt](./src/big.txt) or [long.txt](./src/long.txt) or [wide.ts](./src/wide.ts) or [chunks.ts](./src/chunks.ts).` }] } },
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
// `src/big.txt`, a long file still drawn with an element per line (below VIRTUAL_SOURCE_LINES, which a virtualized source
// takes no comments past), many chunks of lines long
writeFileSync(join(root, "src", "big.txt"), "a line of plain text, 0123456789\n".repeat(VIRTUAL_SOURCE_LINES - 100));
/** One line longer than a source's load limit: it opens cut inside its only line, which is then no whole line to comment on. */
writeFileSync(join(root, "src", "long.txt"), "one long line ".repeat(Math.ceil((SOURCE_PREVIEW_BYTES + 1024) / 14)));
/** `src/wide.ts`: line 2 ends well inside the code view, line 3 runs far past it, so the view (no wrapping) scrolls sideways. */
const WIDE_LINES = [
  "// one line here runs far past the view",
  "export const near = \"a line that ends inside the view\";",
  `export const far = "${"a long run of words ".repeat(30)}";`,
];
writeFileSync(join(root, "src", "wide.ts"), `${WIDE_LINES.join("\n")}\n`);
/**
 * `src/chunks.ts`, longer than the code view's chunks of lines (`CODE_CHUNK_LINES`, HighlightedCode.tsx), so its lines are
 * drawn in several: blank lines where a chunk of 200 would end (lines 199–201, 399–401, …), a line of spaces
 * after each line that wraps (lines 202 and 203, 402 and 403, …), and a blank line every ten lines.
 */
const CHUNK_LINES = Array.from({ length: 650 }, (_, index) => {
  const line = index + 1;
  if ((line > 1 && [199, 0, 1].includes(line % 200)) || line % 10 === 5) return "";
  if (line % 200 === 3) return "   ";
  if (line % 200 === 2) return `export const wide${line} = "${"a long run of words ".repeat(12)}";`;
  return `export const value${line} = compute(${line}, "text");`;
});
writeFileSync(join(root, "src", "chunks.ts"), `${CHUNK_LINES.join("\n")}\n`);

const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };
const { defaultBrowserType: _webkit, ...iPhone } = devices["iPhone 13"]!;
const PHONE: BrowserContextOptions = { ...iPhone, hasTouch: true };
/** The touch cases' phone and tablet (`code-touch`): their sizes, a touch screen, a mobile viewport. */
const IPHONE_14_PRO: BrowserContextOptions = { viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true };
const IPAD: BrowserContextOptions = { viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true };

/**
 * A finger on the page's touch screen, through CDP's touch events: the browser makes its own sequence of them (a
 * `pointerdown`, its moves, a `pointerup`, then a tap's mouse events and click, or a long press's `contextmenu`), as a
 * real finger does. `page.touchscreen` only taps.
 */
type Finger = (type: "touchStart" | "touchMove" | "touchEnd", at?: { x: number; y: number }) => Promise<void>;
async function fingerOf(page: Page): Promise<Finger> {
  const cdp = await page.context().newCDPSession(page);
  return async (type, at) => {
    await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: at === undefined ? [] : [{ x: at.x, y: at.y }] });
  };
}

/** Polls `check` every 50 ms until it holds; throws at the deadline (no fixed sleeps). */
async function eventually(what: string, check: () => Promise<boolean>, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(50);
  }
}

/**
 * Polls the clock until it reaches `at` (`Date.now()` ms): a finger held on the screen until then. A long press is
 * measured in time alone, so the clock is the condition waited for; never past `at` by more than one 25 ms step.
 */
async function holdUntil(at: number): Promise<void> {
  while (Date.now() < at) await Bun.sleep(Math.max(1, Math.min(25, at - Date.now())));
}

/** Waits `count` animation frames (the page's own updates run once per frame): for something that must not happen. */
const frames = (page: Page, count = 6): Promise<void> => page.evaluate((n) => new Promise<void>((resolve) => {
  let left = n;
  const tick = (): void => {
    left -= 1;
    if (left <= 0) resolve();
    else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}), count);

/** How many ranges the named CSS Custom Highlight holds: what is painted over the text of the comments. */
const highlighted = (page: Page, name = "block-comment"): Promise<number> => page.evaluate((highlight) => {
  const registry = (CSS as unknown as { highlights?: { get(key: string): { size: number } | undefined } }).highlights;
  return registry?.get(highlight)?.size ?? 0;
}, name);

/** The text the named CSS Custom Highlight paints, its ranges joined: beside its pin the popover quotes nothing, so what a
 * new comment is on is read here (`block-comment-pending`). */
const highlightText = (page: Page, name = "block-comment-pending"): Promise<string> => page.evaluate((highlight) => {
  const registry = (CSS as unknown as { highlights?: { get(key: string): Iterable<AbstractRange> | undefined } }).highlights;
  return [...(registry?.get(highlight) ?? [])].map((range) => range instanceof Range ? range.toString() : "").join(" ");
}, name);

/**
 * Selects text the way the keyboard (Shift+arrows) or a finger's long press leaves it: from the start of `from` in
 * `first` to the end of `to` in `last` (the element's own text; `last` may be `first`), made the page's selection,
 * then the event that ends the gesture: a finger's `pointerup` at the selection's end on a touch screen, else the
 * `keyup` of the Shift key. Neither is a mouse's drag, so the selection opens nothing.
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
    if (matchMedia("(pointer: coarse)").matches) {
      (stop as Element).dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "touch", clientX: line.right, clientY: line.top + line.height / 2 }));
    } else (stop as Element).dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Shift" }));
  }, { stop: await last.elementHandle(), text: { from, to } });
}

/** A point the pointer acted at, in client pixels, and the scroll of the viewer's body then: where it is on the text after a scroll. */
interface Pointed { x: number; y: number; scroll: number }
/** The viewer's body's `scrollTop` (`scope`: the viewer or its body). */
const bodyScroll = (scope: Locator): Promise<number> => scope.evaluate((node) => (node.matches(".file-viewer-body") ? node : node.querySelector(".file-viewer-body"))!.scrollTop);

/**
 * A mouse's drag from the start of `from` in `first` to the end of `to` in `last` (a press, moves and a release, one
 * click): the selection opens its comment at once (there is no Comment button). Returns where it let go, with the
 * scroll of `viewer`'s body then (0 for the chat: `viewer` null).
 */
async function dragText(page: Page, viewer: Locator | null, first: Locator, from: string, last: Locator, to: string): Promise<Pointed> {
  await first.evaluate((node) => node.scrollIntoView({ block: "center" }));
  const edge = (element: Locator, word: string, end: boolean): Promise<{ x: number; y: number }> => element.evaluate((node, wanted) => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    for (let next = walker.nextNode(); next; next = walker.nextNode()) {
      const at = (next as Text).data.indexOf(wanted.word);
      if (at < 0) continue;
      const offset = wanted.end ? at + wanted.word.length - 1 : at;
      const range = document.createRange();
      range.setStart(next, offset);
      range.setEnd(next, offset + 1);
      const rect = range.getBoundingClientRect();
      return { x: wanted.end ? rect.right - 1 : rect.left + 1, y: rect.top + rect.height / 2 };
    }
    throw new Error(`"${wanted.word}" is not in the element`);
  }, { word, end });
  const start = await edge(first, from, false);
  const end = await edge(last, to, true);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2, { steps: 4 });
  await page.mouse.move(end.x, end.y, { steps: 4 });
  await page.mouse.up();
  return { ...end, scroll: viewer === null ? 0 : await bodyScroll(viewer) };
}

/** No Comment button anywhere: there is none, whatever selected text. */
const assertNoButton = async (page: Page, what: string): Promise<void> => {
  assert.equal(await page.locator(".comment-selection").count(), 0, `${what}: no Comment button`);
};

/** A plain click at `at` (client pixels): returns it with the body's scroll then. */
async function clickAt(page: Page, viewer: Locator, at: { x: number; y: number }): Promise<Pointed> {
  await page.mouse.click(at.x, at.y);
  return { ...at, scroll: await bodyScroll(viewer) };
}

/** How far a pin's tip may lie from the point it was made at: rounding, the fractions' four decimals. */
const TIP_SLACK_PX = 3;
/** `pin`'s tip (its square top left corner) lies within `TIP_SLACK_PX` of `at`, where that point is now that the body may have scrolled: polled. */
async function assertTipAt(viewer: Locator, pin: Locator, at: Pointed, what: string): Promise<void> {
  let seen: unknown = null;
  await eventually(`${what}: its pin's tip at (${at.x.toFixed(1)}, ${at.y.toFixed(1)})`, async () => {
    const box = await pin.boundingBox().catch(() => null);
    const y = at.y - ((await bodyScroll(viewer)) - at.scroll);
    seen = { box, want: { x: at.x, y } };
    return box !== null && Math.abs(box.x - at.x) <= TIP_SLACK_PX && Math.abs(box.y - y) <= TIP_SLACK_PX;
  }).catch((error: Error) => { throw new Error(`${error.message} (${JSON.stringify(seen)})`); });
}

/**
 * The popover beside its pin in `body` lies to the pin's right, 8px from it, its top level with the pin's top where
 * the body has room below for it; else shifted up just enough to end 8px above the body's visible bottom: polled.
 */
async function assertBesideRight(body: Locator, pin: Locator, what: string): Promise<void> {
  let seen: unknown = null;
  await eventually(`${what}: the popover right of its pin, top-aligned where there is room`, async () => {
    const pinBox = await pin.boundingBox().catch(() => null);
    const place = body.locator(".comment-popover-place");
    const box = await place.boundingBox().catch(() => null);
    const side = await place.getAttribute("data-side").catch(() => null);
    const bottom = await body.evaluate((node) => node.getBoundingClientRect().top + node.clientTop + node.clientHeight);
    seen = { pinBox, box, side, bottom };
    if (pinBox === null || box === null || side !== "right" || Math.abs(box.x - (pinBox.x + pinBox.width + 8)) > 1) return false;
    const room = bottom - 8 - pinBox.y >= box.height;
    return room ? Math.abs(box.y - pinBox.y) <= 1 : box.y < pinBox.y && Math.abs(box.y + box.height - (bottom - 8)) <= 1;
  }).catch((error: Error) => { throw new Error(`${error.message} (${JSON.stringify(seen)})`); });
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
  await viewer.locator(`.file-viewer-markdown .hl-line[data-source-line="${FOLD_HEAD_LAST}"]`).waitFor();
  return viewer;
}

/** The element of the preview in `viewer` that source line `n` starts (`data-source-line`). */
const previewLine = (viewer: Locator, n: number): Locator => viewer.locator(`.file-viewer-markdown [data-source-line="${n}"]`);

/** The file comments of the page's store, of every pane: what a send would quote, and whether each is on a selection (else on whole lines). */
const storedFileComments = (page: Page): Promise<{ lines: number[]; quoteLines: string[]; view: string; selected: boolean }[]> => page.evaluate(() => {
  const found: { lines: number[]; quoteLines: string[]; view: string; selected: boolean }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)!;
    if (!key.startsWith("herdr-web-ui:block-comments:")) continue;
    for (const comment of (JSON.parse(localStorage.getItem(key)!) as { comments: { kind?: string; lines: number[]; quoteLines: string[]; view: string; selection?: unknown }[] }).comments) {
      if (comment.kind === "file") found.push({ lines: comment.lines, quoteLines: comment.quoteLines, view: comment.view, selected: comment.selection !== undefined });
    }
  }
  return found;
});

/** Line `n` of the code in `viewer`. */
const lineOf = (viewer: Locator, n: number): Locator => viewer.locator(`.file-viewer-text .hl-line[data-source-line="${n}"]`);
/** The code view's comment row under line `n` (its cards, or the open field) in `viewer`. */
const rowOf = (viewer: Locator, n: number): Locator => viewer.locator(`.code-comment-row[data-line="${n}"]`);
/** The code view's ⊕, while it shows. */
const visibleAdds = (viewer: Locator): Locator => viewer.locator(".code-comment-add:visible");
/**
 * Where code line `line` is (scrolled into the viewer's middle first, unless `scroll` is false): the middle of its first
 * row, a point on its number, and the divider's x (the code's hairline background, FileViewer.css).
 */
const lineBox = (line: Locator, scroll = true): Promise<{ y: number; number: number; divider: number }> => line.evaluate((node, scrolled) => {
  if (scrolled) node.scrollIntoView({ block: "center" });
  const code = node.closest("code")!;
  const box = code.getBoundingClientRect();
  const style = getComputedStyle(code);
  const lineHeight = parseFloat(getComputedStyle(node).lineHeight);
  // an inline line's first box is its first row; a line with a room is one box, its first row at its top
  const first = node.getClientRects()[0]!;
  const y = node.hasAttribute("data-comment-room") ? first.top + lineHeight / 2 : first.top + first.height / 2;
  return { y, number: box.left + 4, divider: box.left + parseFloat(style.backgroundPositionX) + parseFloat(style.backgroundSize) / 2 };
}, scroll);
/** Polls until exactly one ⊕ shows in `viewer`, centred (± 2 px) on line `n`'s divider, in the middle of its first row. */
async function assertAddAt(viewer: Locator, n: number, what: string): Promise<void> {
  let seen: unknown = null;
  await eventually(`${what}: one ⊕, centred on line ${n}'s divider`, async () => {
    const adds = visibleAdds(viewer);
    if ((await adds.count()) !== 1) { seen = { count: await adds.count() }; return false; }
    const box = await adds.boundingBox();
    const line = await lineBox(lineOf(viewer, n), false);
    seen = { box, line };
    return box !== null && Math.abs(box.x + box.width / 2 - line.divider) <= 2 && Math.abs(box.y + box.height / 2 - line.y) <= 2
      && box.width === 28 && box.height === 28;
  }).catch((error: Error) => { throw new Error(`${error.message} (${JSON.stringify(seen)})`); });
}
/**
 * Polls until line `n`'s row in `viewer` lies in the room under the line (`setCommentRooms`): the line has a room as
 * tall as the row, the row's top at the room's top (the line's own row above it), as wide as the code's `<pre>`, and the
 * next line below the row.
 */
async function assertRowUnder(viewer: Locator, n: number, what: string): Promise<void> {
  let seen: { room: number; roomTop: number; textBottom: number; row: { top: number; bottom: number; left: number; width: number } | null; pre: { left: number; width: number }; nextTop: number | null } | null = null;
  await eventually(`${what}: under line ${n}, in its room`, async () => {
    seen = await viewer.evaluate((node, line) => {
      const element = node.querySelector(`.file-viewer-text .hl-line[data-source-line="${line}"]`)!;
      const next = node.querySelector(`.file-viewer-text .hl-line[data-source-line="${line + 1}"]`);
      const row = node.querySelector(`.code-comment-row[data-line="${line}"]`)?.getBoundingClientRect() ?? null;
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      const pre = element.closest("pre")!.getBoundingClientRect();
      const room = element.hasAttribute("data-comment-room") ? parseFloat(style.paddingBottom) : 0;
      return {
        room, roomTop: box.bottom - room, textBottom: box.top + parseFloat(style.lineHeight),
        row: row === null ? null : { top: row.top, bottom: row.bottom, left: row.left, width: row.width },
        pre: { left: pre.left, width: pre.width },
        nextTop: next?.getClientRects()[0]?.top ?? null,
      };
    }, n);
    const { room, roomTop, textBottom, row, pre, nextTop } = seen;
    return row !== null && room > 0 && Math.abs(room - (row.bottom - row.top)) <= 1 && Math.abs(row.top - roomTop) <= 1 && Math.abs(roomTop - textBottom) <= 1
      && Math.abs(row.left - pre.left) <= 1 && Math.abs(row.width - pre.width) <= 1 && (nextTop === null || nextTop >= row.bottom - 1);
  }).catch((error: Error) => { throw new Error(`${error.message} (${JSON.stringify(seen)})`); });
}
/** The saved comments' pins in `scope` (a viewer, the chat), in reading order. */
const pinsIn = (scope: Locator): Locator => scope.locator(".comment-pin:not(.is-pending)");
/** The provisional pin of the comment being written in `scope`. */
const pendingPinIn = (scope: Locator): Locator => scope.locator(".comment-pin.is-pending");
/** The open comment's popover, wherever it is drawn. */
const popoverOf = (page: Page): Locator => page.locator(".comment-popover");
/** The popover beside its pin, inside `scope` (a viewer's body, the chat). */
const besidePinIn = (scope: Locator): Locator => scope.locator(".comment-popover");
/** The popover as a dialog of its own (the shared modal: a bottom sheet on a phone), portalled to the body. */
const dialogOf = (page: Page): Locator => page.locator(".modal-scrim > .modal.comment-popover");
/**
 * The open popover's field. `framed`: the code view's (its row and its sheet), drawn in a frame of its own
 * (FrameField.tsx), the one frame that has a field in it (`data-open`).
 */
const fieldOf = (page: Page, framed = false): Locator => framed
  ? page.locator("iframe.comment-frame[data-open]").contentFrame().getByRole("textbox", { name: "Comment", exact: true })
  : popoverOf(page).getByRole("textbox", { name: "Comment", exact: true });
/** Whether the focused element matches `selector`, followed into a frame that holds the focus (the code view's field). */
const focusedMatches = (page: Page, selector: string): Promise<boolean> => page.evaluate((wanted) => {
  let active = document.activeElement;
  while (active?.localName === "iframe") {
    const inner = (active as HTMLIFrameElement).contentDocument?.activeElement ?? null;
    if (inner === null || inner === inner.ownerDocument.body) break;
    active = inner;
  }
  return active?.matches(wanted) ?? false;
}, selector);
/** Waits for an opened popover's field (in the page, or in its frame) to take the focus (it does as the popover mounts): Escape is the popover's from there. */
const fieldFocused = (page: Page): Promise<void> => eventually("the popover's field to take the focus", () => focusedMatches(page, ".comment-editor-field"));
/** A reference's text as read (`FileReferenceLabel`: the stem, then the extension and the lines). */
const referenceText = (reference: Locator): Promise<string | null> => reference.evaluate((node) => node.textContent);
/** The open popover's file reference, as read. */
const popoverReference = (page: Page): Promise<string | null> => referenceText(popoverOf(page).locator(".comment-file-reference"));

/** Writes `text` in the open popover's field and saves it with Ctrl+Enter; returns once the popover is gone. */
async function saveTyped(page: Page, text: string): Promise<void> {
  await fieldFocused(page);
  await fieldOf(page).fill(text);
  await page.keyboard.press("Control+Enter");
  await popoverOf(page).waitFor({ state: "detached" });
}

/** Closes an untouched popover by Escape (its field, or its box where the field did not take the focus, has it). */
async function escapePopover(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await popoverOf(page).waitFor({ state: "detached" });
}

/**
 * Where the pin matching `pin` in `scope` lies against the end of the element `line`'s own text (its last line on
 * screen): `dx` from that end to the pin's tip (its square top left corner), `dy` from the line's middle.
 */
const pinAgainstLine = (scope: Locator, pin: string, line: string): Promise<{ dx: number; dy: number } | null> => scope.evaluate((node, wanted) => {
  const found = node.querySelector(wanted.pin);
  const element = node.querySelector(wanted.line);
  if (found === null || element === null) return null;
  const range = document.createRange();
  range.selectNodeContents(element);
  const last = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0).at(-1);
  if (last === undefined) return null;
  const box = found.getBoundingClientRect();
  return { dx: box.left - last.right, dy: box.top - (last.top + last.height / 2) };
}, { pin, line });
/** How far right of the end of its text a pin's tip may be: its gap (4px), and a little for rounding. */
const PIN_REACH_PX = 8;
/**
 * Polls until the pin matching `pin` in `scope`, one without a point (a selection's made with the keyboard, a triple
 * click or a finger, or a stored one from before points), has its tip within `PIN_REACH_PX` right of the end of
 * `line`'s text, at that line's middle.
 */
async function assertPinAtLineEnd(scope: Locator, pin: string, line: string, what: string): Promise<void> {
  let seen: { dx: number; dy: number } | null = null;
  await eventually(`${what}: the pin's tip within ${PIN_REACH_PX}px right of its line's end, at its middle`, async () => {
    seen = await pinAgainstLine(scope, pin, line);
    return seen !== null && seen.dx >= 0 && seen.dx <= PIN_REACH_PX && Math.abs(seen.dy) <= 2;
  }).catch((error: Error) => { throw new Error(`${error.message} (offset ${JSON.stringify(seen)})`); });
}

/** Whether the element matching `selector` is inside the viewer's body on screen (1px of slack). */
const inBody = (viewer: Locator, selector: string): Promise<boolean> => viewer.evaluate((node, wanted) => {
  const found = node.querySelector(wanted);
  const body = node.querySelector(".file-viewer-body");
  if (found === null || body === null) return false;
  const box = found.getBoundingClientRect();
  const outer = body.getBoundingClientRect();
  return box.height > 0 && box.top >= outer.top - 1 && box.bottom <= outer.bottom + 1;
}, selector);

/**
 * A point on the element `element` (a code line, a preview element), in client pixels, scrolled into the viewer's
 * middle first: on its text near the start, or (`atNumber`, a code line) in its number's gutter.
 */
const pointOn = (element: Locator, atNumber = false): Promise<{ x: number; y: number }> => element.evaluate((node, gutter) => {
  node.scrollIntoView({ block: "center" });
  const range = document.createRange();
  range.selectNodeContents(node);
  const rect = [...range.getClientRects()].find((found) => found.width > 0 && found.height > 0)!;
  if (!gutter) return { x: rect.left + Math.min(rect.width, 40) / 2, y: rect.top + rect.height / 2 };
  const code = node.closest("code")!;
  const box = code.getBoundingClientRect();
  const start = box.left + code.clientLeft + parseFloat(getComputedStyle(code).paddingInlineStart);
  return { x: (box.left + start) / 2, y: rect.top + rect.height / 2 };
}, atNumber);

/**
 * The start (`end` false) or end of code line `line`'s text, in client pixels, for a drag (`scroll`: the line is first
 * scrolled into the viewer's middle; false keeps the view, where an earlier line was put).
 */
const textEdge = (line: Locator, end: boolean, scroll: boolean): Promise<{ x: number; y: number }> => line.evaluate((node, wanted) => {
  if (wanted.scroll) node.scrollIntoView({ block: "center" });
  const range = document.createRange();
  range.selectNodeContents(node);
  const rects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
  const rect = wanted.end ? rects.at(-1)! : rects[0]!;
  return { x: wanted.end ? rect.right - 1 : rect.left + 1, y: rect.top + rect.height / 2 };
}, { end, scroll });

/** The composer's comments bar above the message box, and its text, which walks to them. */
const walkOf = (page: Page): Locator => page.locator(".composer-surface > .composer-comments-bar button.composer-comments-walk");

/** What the open popover's field holds (a saved comment opens in it), or null while none is open. */
const popoverText = async (page: Page, framed = false): Promise<string | null> => {
  if (framed && (await page.locator("iframe.comment-frame[data-open]").count()) !== 1) return null;
  const field = fieldOf(page, framed);
  return (await field.count()) === 1 ? field.inputValue() : null;
};
/** The open popover's Delete (a saved comment's, beside ↑), and its ✕ (a dialog's and a sheet's only). */
const deleteOf = (page: Page): Locator => popoverOf(page).getByRole("button", { name: "Delete comment", exact: true });
const closeOf = (page: Page): Locator => popoverOf(page).getByRole("button", { name: "Close", exact: true });
/** The text up on `surface` (a viewer's body, the chat): what the active and current highlights hold there, and whether it is in focus mode. */
const upIn = (surface: Locator): Promise<{ text: string; focus: boolean }> => surface.evaluate((node) => {
  const registry = (CSS as unknown as { highlights: { get(key: string): Iterable<Range> | undefined } }).highlights;
  const ranges = [...(registry.get("block-comment-active") ?? []), ...(registry.get("block-comment-current") ?? [])].filter((range) => node.contains(range.commonAncestorContainer));
  return { text: ranges.map((range) => range.toString()).join("\n"), focus: node.hasAttribute("data-comment-focus") };
});
/** Polls until the text up on `surface` includes `text`, the surface in focus mode. */
async function assertUp(surface: Locator, text: string, what: string): Promise<void> {
  let seen: unknown = null;
  await eventually(`${what}: its text up, in focus mode`, async () => {
    const up = await upIn(surface);
    seen = up;
    return up.text.includes(text) && up.focus;
  }).catch((error: Error) => { throw new Error(`${error.message} (${JSON.stringify(seen)})`); });
}
/** The center of the first `word` in `element`'s text, in client pixels. */
const wordPoint = (element: Locator, word: string): Promise<{ x: number; y: number }> => element.evaluate((node, wanted) => {
  node.scrollIntoView({ block: "center" });
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  for (let next = walker.nextNode(); next; next = walker.nextNode()) {
    const at = (next as Text).data.indexOf(wanted);
    if (at < 0) continue;
    const range = document.createRange();
    range.setStart(next, at);
    range.setEnd(next, at + wanted.length);
    const rect = range.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }
  throw new Error(`"${wanted}" is not in the element`);
}, word);

const cases: Record<string, Case> = {
  /** The chat's comment flow: the pins, the popover and the highlights it shares with the viewer. */
  async chat(open) {
    const { page, errors, close } = await open(DESKTOP);
    const chat = page.locator(".chat-view");
    const paragraph = page.locator(".chat-view p.is-commentable", { hasText: REPLY });
    // a keyboard selection opens nothing; a mouse's drag over the same text opens it
    await selectText(paragraph, "every revision", paragraph, "in order");
    await frames(page, 10);
    assert.equal(await popoverOf(page).count(), 0, "a keyboard selection opens nothing");
    await assertNoButton(page, "a keyboard selection in the chat");
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await dragText(page, null, paragraph, "every revision", paragraph, "in order");
    await besidePinIn(chat).waitFor();
    await pendingPinIn(chat).waitFor();
    await assertNoButton(page, "a drag in the chat");
    await saveTyped(page, "Say which order.");
    await eventually("its pin", async () => (await pinsIn(chat).count()) === 1);
    await eventually("the comment's text to be highlighted", async () => (await highlighted(page)) > 0);
    console.log("PASS chat: a keyboard selection opens nothing; a mouse's drag opens the popover beside a provisional pin; Ctrl+Enter saves it as a pin, highlighted");

    // its pin opens it straight into its field, its text up; Escape on the untouched field closes it
    await pinsIn(chat).click();
    await besidePinIn(chat).waitFor();
    await fieldFocused(page);
    assert.equal(await fieldOf(page).inputValue(), "Say which order.", "the pin opens the field with the comment");
    await page.mouse.move(2, 2);
    await assertUp(chat, "every revision in order", "the chat's comment opened by its pin");
    await escapePopover(page);
    console.log("PASS chat: the pin opens the comment in its field, its text up; Escape on the untouched field closes it");

    const walk = walkOf(page);
    await walk.waitFor();
    assert.equal(await walk.getAttribute("aria-label"), "1 comment on the reply");
    await walk.click();
    await eventually("the walk to open the pin's popover", async () => (await popoverText(page)) === "Say which order.");
    assert.ok(await pinsIn(chat).evaluate((pin) => pin.classList.contains("is-current")), "the walk marks the pin");
    console.log("PASS chat: with one comment the composer bar shows, and its walk opens the pin's popover");

    await deleteOf(page).click();
    await eventually("the pin to go", async () => (await pinsIn(chat).count()) === 0);
    await walk.waitFor({ state: "detached" });
    await eventually("the highlight to go", async () => (await highlighted(page)) === 0);
    console.log("PASS chat: Delete beside ↑ removes the pin, its highlight and the bar");
    assert.deepEqual(errors, []);
    await close();
  },

  /**
   * The prototype gate of the code view's inline comment cards: a line can have empty room below it (the CSS a card is
   * placed in) without the copied text changing, with Wrap long lines off and on, and the code view has a divider
   * between the line numbers and the code. The room is written as `setCommentRooms` (lib/codeCommentDom.ts) writes it.
   * A file longer than a chunk of lines (`chunks.ts`) is drawn in block chunks: rooms on the lines either side of a
   * chunk's end, copies across each end (also the browser's own copy, to the clipboard), and the lines below a room in
   * later chunks moving by it.
   */
  async "code-room"(open) {
    const ROOM = 60;
    /** `chunked`: the rooms and copies are placed at the chunks' ends, read from the drawn code */
    interface RoomCheck { file: string; text: string; rooms: number[]; copies: [number, number][]; chunked?: boolean }
    const checks: RoomCheck[] = [
      // blank lines 2 and 4; line 2 is a blank line with a room, lines 6 and 8 are code
      { file: "sync.ts", text: SYNC_LINES.join("\n"), rooms: [2, 6, 8], copies: [[1, 3], [5, 7], [7, 9], [1, SYNC_LINES.length]] },
      // line 3 runs far past the view: it wraps with Wrap long lines on, and carries a room after its last row
      { file: "wide.ts", text: WIDE_LINES.join("\n"), rooms: [2, 3], copies: [[1, 2], [2, 3], [1, 3]] },
      // rooms on a blank line before a chunk's end, the lines either side of the first end and the wrapping line ending the second
      { file: "chunks.ts", text: CHUNK_LINES.join("\n"), rooms: [], copies: [], chunked: true },
    ];
    const { page, errors, close } = await open(DESKTOP);
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    for (const wrap of [false, true]) {
      if (wrap) {
        // Settings → Wrap long lines is the setting `wrapCode`: the page's init script resets the settings on a load, so one more follows it
        await page.addInitScript(() => {
          const settings = JSON.parse(localStorage.getItem("herdr-web-ui:settings") ?? "{}") as Record<string, unknown>;
          localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ ...settings, wrapCode: true }));
        });
        await page.reload();
        await page.locator(".conn-live").waitFor();
        await page.locator(".chat-view p.is-commentable", { hasText: REPLY }).waitFor();
      }
      for (const check of checks) {
        const label = `${check.file}, wrap ${wrap ? "on" : "off"}`;
        await page.getByRole("button", { name: check.file, exact: true }).click();
        const viewer = page.getByRole("dialog", { name: check.file, exact: true });
        await lineOf(viewer, check.text.split("\n").length).waitFor();
        assert.equal(await viewer.locator(".file-viewer-text[data-wrap]").count(), wrap ? 1 : 0, `${label}: Wrap long lines follows the setting`);
        let { rooms, copies } = check;
        if (check.chunked) {
          const chunks = await viewer.locator("pre.file-viewer-text").evaluate((pre) => [...pre.querySelectorAll(".hl-chunk")].map((chunk) => {
            const style = getComputedStyle(chunk);
            return {
              first: Number(chunk.firstElementChild?.getAttribute("data-source-line")),
              last: Number(chunk.lastElementChild?.getAttribute("data-source-line")),
              display: style.display,
              counter: `${style.counterReset} / ${style.counterSet}`,
              numbers: [...chunk.querySelectorAll(".hl-line")].every((line) => getComputedStyle(line, "::before").content === `"${line.getAttribute("data-source-line")}"`),
              contain: style.contain,
            };
          }));
          assert.ok(chunks.length >= 3, `${label}: the code is drawn in chunks of lines (${chunks.length})`);
          chunks.forEach((chunk, i) => {
            assert.equal(chunk.display, "block", `${label}: a chunk is a block`);
            assert.equal(chunk.first, i === 0 ? 1 : chunks[i - 1]!.last + 1, `${label}: chunk ${i + 1} starts after the one before`);
            // the line numbers run on: each line shows its own number, no counter (a room renumbers nothing), and no style containment
            assert.equal(chunk.counter, "none / none", `${label}: chunk ${i + 1} sets no counter`);
            assert.ok(chunk.numbers, `${label}: chunk ${i + 1} numbers each line by its source line`);
            assert.ok(!/style|content|strict/.test(chunk.contain), `${label}: a chunk does not contain style (${chunk.contain})`);
          });
          const ends = chunks.slice(0, -1).map((chunk) => chunk.last);
          rooms = [ends[0]! - 3, ends[0]!, ends[0]! + 1, ends[1]!];
          copies = [[1, CHUNK_LINES.length], ...ends.flatMap((end): [number, number][] => [[end, end + 1], [end - 4, end + 4]])];
        }
        const report = await viewer.locator("pre.file-viewer-text").evaluate((pre, spec) => {
          const code = pre.querySelector("code")!;
          const lineNamed = (n: number): HTMLElement => pre.querySelector<HTMLElement>(`.hl-line[data-source-line="${n}"]`)!;
          const count = pre.querySelectorAll(".hl-line").length;
          /** Row positions are the code's own: a short file's viewer hangs from a fixed top and grows downward only. */
          const codeTop = (): number => code.getBoundingClientRect().top;
          /** The rects of a line's text rows, one per row and span: where its text is, whatever box the line is. */
          const rowsOf = (line: HTMLElement): DOMRect[] => {
            const rects: DOMRect[] = [];
            const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
            for (let next = walker.nextNode(); next; next = walker.nextNode()) {
              const range = document.createRange();
              range.selectNodeContents(next);
              rects.push(...[...range.getClientRects()].filter((rect) => rect.width > 0));
            }
            return rects;
          };
          /** The distinct tops of a line's rows, in order (rows of one line differ by a line height, spans of one row by nothing). */
          const rowTops = (line: HTMLElement): number[] => rowsOf(line).map((rect) => rect.top - codeTop()).filter((top, i, all) => i === 0 || Math.abs(top - all[i - 1]!) > 3);
          const snapshot = (): { text: string; height: number; width: number; rows: (number[] | null)[] } => ({
            text: (pre as HTMLElement).innerText,
            height: code.getBoundingClientRect().height,
            width: pre.scrollWidth,
            rows: Array.from({ length: count }, (_, i) => { const tops = rowTops(lineNamed(i + 1)); return tops.length === 0 ? null : tops; }),
          });
          const before = snapshot();
          // exactly what setCommentRooms writes
          for (const n of spec.rooms) {
            const line = lineNamed(n);
            line.setAttribute("data-comment-room", "");
            line.style.setProperty("--comment-room", `${spec.room}px`);
          }
          const after = snapshot();
          const selection = window.getSelection()!;
          const copies = spec.copies.map(([first, last]) => {
            const range = document.createRange();
            range.setStartBefore(lineNamed(first));
            range.setEndAfter(lineNamed(last));
            selection.removeAllRanges();
            selection.addRange(range);
            return selection.toString();
          });
          selection.removeAllRanges();
          const whole = document.createRange();
          whole.selectNodeContents(pre);
          selection.addRange(whole);
          const everything = selection.toString();
          selection.removeAllRanges();
          // the line numbers and the divider, from the computed style
          const style = getComputedStyle(pre);
          const token = (name: string): number => parseFloat(style.getPropertyValue(name));
          const probe = document.createElement("span");
          probe.style.cssText = "position: absolute; visibility: hidden; width: 1ch; color: var(--border)";
          // in the <code>: the divider and the numbers are placed in its 1ch (its font is the UA's monospace, not the <pre>'s)
          code.append(probe);
          const ch = probe.getBoundingClientRect().width;
          const border = getComputedStyle(probe).color;
          probe.remove();
          const codeStyle = getComputedStyle(code);
          const codeLeft = code.getBoundingClientRect().left;
          const first = lineNamed(1);
          const number = getComputedStyle(first, "::before");
          const digits = parseFloat(style.getPropertyValue("--hl-digits"));
          // hit tests: the number is on the commented line's first row, and nothing of it is on its other rows or in the room
          const hits = spec.rooms.map((n) => {
            const line = lineNamed(n);
            line.scrollIntoView({ block: "center" });
            const lineHeight = parseFloat(getComputedStyle(line).lineHeight);
            const box = line.getBoundingClientRect();
            // a blank line has no text to measure: its one row is the top of its box, its room the bottom
            const rows = rowsOf(line).map((rect) => rect.top + rect.height / 2);
            const firstY = rows[0] ?? box.top + lineHeight / 2;
            const lastY = rows.at(-1) ?? firstY;
            const hitAt = (y: number): number => Number(document.elementFromPoint(codeLeft + 2, y)?.closest(".hl-line") === line);
            return { line: n, rowsCount: Math.max(1, rowTops(line).length), onFirstRow: hitAt(firstY), onLastRow: hitAt(lastY), inRoom: hitAt(lastY + lineHeight / 2 + spec.room / 2) };
          });
          return {
            before,
            after,
            copies,
            everything,
            ch,
            hits,
            divider: {
              image: codeStyle.backgroundImage,
              size: codeStyle.backgroundSize,
              repeat: codeStyle.backgroundRepeat,
              x: parseFloat(codeStyle.backgroundPositionX),
              border,
              hairline: token("--hairline"),
              gap: token("--space-4"),
              clear: token("--space-5"),
            },
            numbers: {
              digits,
              edge: number.width === "auto" ? NaN : parseFloat(number.width) - parseFloat(number.paddingRight),
              textLeft: rowsOf(first)[0]!.left - codeLeft,
            },
          };
        }, { rooms, room: ROOM, copies });

        // the file ends with a newline, and upstream draws the empty row after it (DESIGN.md: a complete file keeps it), so
        // innerText has that final newline; a selection of the whole <pre> stops at the last character, as before
        assert.equal(report.before.text, `${check.text}\n`, `${label}: the text is the file's`);
        assert.equal(report.after.text, `${check.text}\n`, `${label}: innerText with rooms is still the file's text`);
        copies.forEach(([first, last], i) => {
          assert.equal(report.copies[i], check.text.split("\n").slice(first - 1, last).join("\n"), `${label}: a selection of lines ${first}–${last} copies those lines`);
        });
        assert.equal(report.everything, check.text, `${label}: selecting the whole <pre> (Copy's fallback) gives the whole text`);
        if (check.chunked) {
          // the browser's own copy of a selection across a chunk's end, with the rooms in place
          for (const [first, last] of copies.slice(1, 3)) {
            await viewer.locator("pre.file-viewer-text").evaluate((pre, [a, z]) => {
              const range = document.createRange();
              range.setStartBefore(pre.querySelector(`.hl-line[data-source-line="${a}"]`)!);
              range.setEndAfter(pre.querySelector(`.hl-line[data-source-line="${z}"]`)!);
              window.getSelection()!.removeAllRanges();
              window.getSelection()!.addRange(range);
            }, [first, last]);
            await page.evaluate(() => navigator.clipboard.writeText(""));
            await page.keyboard.press("ControlOrMeta+c");
            const want = check.text.split("\n").slice(first - 1, last).join("\n");
            let copied = "";
            await eventually(`${label}: the copy of lines ${first}–${last}`, async () => (copied = await page.evaluate(() => navigator.clipboard.readText())) !== "");
            assert.equal(copied, want, `${label}: the browser copies lines ${first}–${last} across a chunk's end as they are`);
          }
          await page.evaluate(() => window.getSelection()!.removeAllRanges());
        }
        // the lines below a room are ROOM lower per room above them; a line's own rows (its text, wrapped ones too) do not move by its own room
        report.after.rows.forEach((rows, i) => {
          const line = i + 1;
          const was = report.before.rows[i];
          if (rows === null || !was) return;
          const moved = ROOM * rooms.filter((n) => n < line).length;
          assert.equal(rows.length, was.length, `${label}: line ${line} keeps its ${was.length} rows`);
          rows.forEach((top, row) => {
            assert.ok(Math.abs(top - was[row]! - moved) <= 1, `${label}: line ${line} row ${row + 1} is ${moved}px lower (was ${was[row]}, is ${top})`);
          });
        });
        assert.ok(Math.abs(report.after.height - report.before.height - ROOM * rooms.length) <= 1, `${label}: the code is ${ROOM * rooms.length}px taller (${report.before.height} → ${report.after.height})`);
        assert.ok(Math.abs(report.after.width - report.before.width) <= 1, `${label}: a room does not widen the code (${report.before.width} → ${report.after.width})`);
        if (check.file === "wide.ts" && wrap) assert.ok((report.after.rows[2]?.length ?? 0) > 1, `${label}: line 3 wraps onto rows`);
        // the number sits on the commented line's first row, never on its later rows or in its room
        for (const hit of report.hits) {
          assert.equal(hit.onFirstRow, 1, `${label}: line ${hit.line}'s number is on its first row`);
          if (hit.rowsCount > 1) assert.equal(hit.onLastRow, 0, `${label}: line ${hit.line}'s number is not on its last row`);
          assert.equal(hit.inRoom, 0, `${label}: line ${hit.line}'s number is not in its room`);
        }
        // the divider: a hairline in --border between the numbers and the code, the numbers where they were, the code clear of it
        const { divider, numbers } = report;
        const want = numbers.digits * report.ch + divider.gap;
        assert.ok(divider.image.startsWith("linear-gradient(") && divider.image.split(divider.border).length === 3, `${label}: the divider is a --border gradient (${divider.image})`);
        assert.equal(divider.size, `${divider.hairline}px 100%`, `${label}: the divider is a hairline wide, the code's height`);
        assert.equal(divider.repeat, "no-repeat", `${label}: the divider does not repeat`);
        assert.ok(Math.abs(divider.x - want) <= 1, `${label}: the divider sits ${divider.gap}px right of the numbers' digits (${divider.x} vs ${want})`);
        assert.ok(Math.abs(numbers.edge - numbers.digits * report.ch) <= 1, `${label}: the numbers keep their place (${numbers.edge} vs ${numbers.digits * report.ch})`);
        assert.ok(Math.abs(numbers.textLeft - (want + divider.clear)) <= 1, `${label}: the code starts ${divider.clear}px right of the divider (${numbers.textLeft} vs ${want + divider.clear})`);
        await viewer.getByRole("button", { name: "Close file", exact: true }).click();
        await viewer.waitFor({ state: "detached" });
      }
      console.log(`PASS code-room: wrap ${wrap ? "on" : "off"}: a ${ROOM}px room after a line (a blank one and a wrapped one too) moves what is below it by that much, leaves the text, a copy across it and the fallback's whole selection as they were, keeps the number on the first row; the divider is a hairline, the numbers and the code clear of it; a long file's chunks of lines copy exactly across their ends (selection, the browser's copy, innerText) and move with a room above them`);
    }
    assert.deepEqual(errors, []);
    await close();
  },

  /**
   * The code view's comments on a desktop, in comment mode (the header's toggle): the ⊕ on the hovered line, centred on
   * the divider; the field under the line; the card it saves, under the line, in the room `setCommentRooms` makes; a
   * card opened to edit, Escape, Delete (the room goes); a copy across a card; a legacy range comment's card stacked
   * with a whole-line one's; one ⊕ at a time.
   */
  async "code-inline"(open) {
    const syncPath = realpathSync(join(root, "src", "sync.ts"));
    const { page, errors, close } = await open(DESKTOP);
    let viewer = await openSync(page);
    let body = viewer.locator(".file-viewer-body");
    const toggle = viewer.locator("button.file-viewer-comments");
    assert.equal(await toggle.getAttribute("aria-label"), "Comment mode", "the header's toggle is named Comment mode");
    assert.equal(await toggle.getAttribute("title"), "Comment mode");
    assert.equal(await toggle.getAttribute("aria-pressed"), "false", "comment mode starts off");
    assert.equal(await toggle.locator(".file-viewer-comments-count").count(), 0, "no badge without comments");
    // the mode off: a line hovered shows no ⊕
    let at4 = await lineBox(lineOf(viewer, 4));
    await page.mouse.move(at4.number, at4.y);
    await frames(page);
    assert.equal(await visibleAdds(viewer).count(), 0, "no ⊕ while the mode is off");
    await toggle.click();
    assert.equal(await toggle.getAttribute("aria-pressed"), "true", "the toggle turns the mode on");
    await frames(page);
    assert.equal(await viewer.locator(".code-comment-hint").count(), 0, "a mouse's toggle shows no hint");
    // the keyboard, the pointer off the code: Tab from the toggle reaches the one ⊕, on the first line in view, named for it
    const add = viewer.locator("button.code-comment-add");
    const keyField = body.locator(".comment-popover.is-row");
    // the last line is the empty row after the file's final newline: upstream draws it, as a complete file's last line (DESIGN.md)
    const lastLine = SYNC_LINES.length + 1;
    await toggle.focus();
    for (let i = 0; i < 20 && !(await focusedMatches(page, "button.code-comment-add")); i++) await page.keyboard.press("Tab");
    assert.ok(await focusedMatches(page, "button.code-comment-add"), "Tab reaches the ⊕");
    await assertAddAt(viewer, 1, "the ⊕ focused by Tab");
    assert.equal(await add.getAttribute("aria-label"), "Add a comment to line 1");
    assert.equal(await viewer.locator("pre.file-viewer-text[data-comment-line]").count(), 1, "the line it is on is tinted");
    // arrows move it a line, centred on that line's divider, and its name follows
    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowDown");
    await assertAddAt(viewer, 4, "ArrowDown × 3");
    assert.equal(await add.getAttribute("aria-label"), "Add a comment to line 4");
    // End: the last line, in the body's view; Home: the first; PageDown and PageUp: a page, clamped to the lines there are
    await page.keyboard.press("End");
    await assertAddAt(viewer, lastLine, "End");
    assert.equal(await add.getAttribute("aria-label"), `Add a comment to line ${lastLine}`);
    await eventually("the last line in the body's view", () => lineOf(viewer, lastLine).evaluate((line) => {
      const box = line.getBoundingClientRect();
      const view = line.closest(".file-viewer-body")!.getBoundingClientRect();
      return box.top >= view.top - 1 && box.bottom <= view.bottom + 1;
    }));
    await page.keyboard.press("Home");
    await assertAddAt(viewer, 1, "Home");
    await page.keyboard.press("PageDown");
    await assertAddAt(viewer, lastLine, "PageDown");
    await page.keyboard.press("PageUp");
    await assertAddAt(viewer, 1, "PageUp");
    // Enter opens line 4's field in a row, which takes the focus; Escape closes it, unchanged, and the focus is back on the ⊕ at line 4
    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowDown");
    await assertAddAt(viewer, 4, "ArrowDown × 3 again");
    await page.keyboard.press("Enter");
    await keyField.waitFor();
    await fieldFocused(page);
    assert.equal(await rowOf(viewer, 4).locator(".comment-popover.is-row").count(), 1, "Enter opens the field under line 4");
    assert.equal(await fieldOf(page, true).getAttribute("placeholder"), "Write a comment…");
    await page.keyboard.press("Escape");
    await keyField.waitFor({ state: "detached" });
    await eventually("the focus back on the ⊕", () => focusedMatches(page, "button.code-comment-add"));
    await assertAddAt(viewer, 4, "the field closed");
    assert.equal(await add.getAttribute("aria-label"), "Add a comment to line 4");
    assert.ok(await viewer.isVisible(), "Escape closed the field, not the viewer");
    console.log("PASS code-inline: with the pointer off the code, Tab reaches the one ⊕ (line 1, named for it); ↓ × 3 → line 4 centred on its divider; End, Home, PageDown, PageUp; Enter opens line 4's field with the focus in it; Escape closes it and the focus is back on the ⊕ at line 4");
    // the mode on: line 4 (a blank one) hovered shows one ⊕, centred on its divider
    at4 = await lineBox(lineOf(viewer, 4));
    await page.mouse.move(at4.number, at4.y);
    await assertAddAt(viewer, 4, "line 4 hovered");
    assert.equal(await visibleAdds(viewer).getAttribute("aria-label"), "Add a comment to line 4");
    console.log("PASS code-inline: the header's Comment mode toggle, off and without a badge at first; no ⊕ while it is off; on, the hovered line 4 shows one ⊕ centred on the divider");

    // ⊕: the field under line 4, its placeholder the generic one, focused, ↑ disabled while empty
    await visibleAdds(viewer).click();
    const rowPopover = body.locator(".comment-popover.is-row");
    await rowPopover.waitFor();
    await fieldFocused(page);
    assert.equal(await fieldOf(page, true).getAttribute("placeholder"), "Write a comment…");
    assert.ok(await popoverOf(page).getByRole("button", { name: "Save comment", exact: true }).isDisabled(), "↑ is disabled while the field is empty");
    await assertRowUnder(viewer, 4, "the field");
    assert.equal(await page.locator(".comment-pin").count(), 0, "no pin in the code view");
    // the field is in the layer's own frame (FrameField.tsx), made ahead and kept: marked here, the next opening finds the same one
    assert.equal(await body.evaluate((node) => {
      const frame = node.querySelector(".code-comments > .code-comment-frame-host > iframe.comment-frame[data-open]");
      if (frame !== null) (frame as unknown as { seenBefore: boolean }).seenBefore = true;
      return frame !== null && frame.contentDocument?.querySelector("textarea.comment-editor-field") !== null;
    }), true, "the row's field is in the layer's frame");
    assert.equal(await rowPopover.evaluate((box) => box.hasAttribute("data-field-focus")), true, "the card's edge follows the field's focus in its frame");
    // the frame sits over the field's slot, in the card
    const overSlot = await rowPopover.evaluate((box) => {
      const slot = box.querySelector(".comment-field-slot")!.getBoundingClientRect();
      const frame = document.querySelector(".code-comment-frame-host > iframe.comment-frame[data-open]")!.getBoundingClientRect();
      return { dy: Math.abs(slot.top - frame.top), dx: Math.abs(slot.left - frame.left), dw: Math.abs(slot.width - frame.width), dh: Math.abs(slot.height - frame.height) };
    });
    assert.ok(overSlot.dy <= 1 && overSlot.dx <= 1 && overSlot.dw <= 1 && overSlot.dh <= 1, `the frame lies over the field's slot (${JSON.stringify(overSlot)})`);
    await fieldOf(page, true).fill("A blank line between imports and types.");
    await page.keyboard.press("Control+Enter");
    await rowPopover.waitFor({ state: "detached" });
    assert.deepEqual(await storedFileComments(page), [{ lines: [4, 4], quoteLines: [""], view: "code", selected: false }], "one comment on all of line 4");
    const card4 = rowOf(viewer, 4).locator(".code-comment-card");
    await eventually("line 4's card", async () => (await card4.count()) === 1);
    assert.equal(await card4.locator(".code-comment-text").textContent(), "A blank line between imports and types.");
    // a card is read with its line: the text button and its Delete name it
    assert.equal(await card4.locator("button.code-comment-text").getAttribute("aria-label"), "Comment on line 4: A blank line between imports and types.");
    assert.equal(await card4.locator("button.code-comment-delete").getAttribute("aria-label"), "Delete comment on line 4");
    await assertRowUnder(viewer, 4, "the card");
    await eventually("line 4's number in the accent", async () => {
      const [number, accent] = await lineOf(viewer, 4).evaluate((line) => {
        const probe = document.createElement("span");
        probe.style.color = "var(--accent)";
        document.body.append(probe);
        const wanted = getComputedStyle(probe).color;
        probe.remove();
        return [getComputedStyle(line, "::before").color, wanted];
      });
      return number === accent;
    });
    await eventually("the badge to read 1", async () => (await toggle.locator(".file-viewer-comments-count").textContent().catch(() => null)) === "1");
    assert.equal(await toggle.getAttribute("aria-label"), "Comment mode, 1 comment");
    console.log("PASS code-inline: ⊕ opens the field under line 4 (placeholder, focus, ↑ disabled while empty); Ctrl+Enter stores it on [4, 4], its card under line 4, the number in the accent, the badge 1");

    // a selection across the card copies the source exactly, as does the whole <pre> (Copy's fallback)
    const copies = await viewer.locator("pre.file-viewer-text").evaluate((pre) => {
      const named = (n: number): Element => pre.querySelector(`.hl-line[data-source-line="${n}"]`)!;
      const selection = window.getSelection()!;
      const range = document.createRange();
      range.setStartBefore(named(3));
      range.setEndAfter(named(5));
      selection.removeAllRanges();
      selection.addRange(range);
      const across = selection.toString();
      const whole = document.createRange();
      whole.selectNodeContents(pre);
      selection.removeAllRanges();
      selection.addRange(whole);
      const all = selection.toString();
      selection.removeAllRanges();
      return { across, all, inner: (pre as HTMLElement).innerText };
    });
    assert.equal(copies.across, SYNC_LINES.slice(2, 5).join("\n"), "a selection of lines 3–5 across the card is those lines");
    assert.equal(copies.all, SYNC_LINES.join("\n"), "the whole <pre> is the file's text");
    // innerText ends with the file's final newline (the empty row upstream draws after it); a selection stops before it
    assert.equal(copies.inner, `${SYNC_LINES.join("\n")}\n`, "innerText is the file's text");
    console.log("PASS code-inline: a selection across the card, and the whole <pre>, copy the file's text exactly");

    // the card opens to edit, in its place; Escape unchanged closes it, changed keeps it with the focus
    await card4.click();
    await rowPopover.waitFor();
    await fieldFocused(page);
    assert.equal(await popoverText(page, true), "A blank line between imports and types.", "the card opens with its text");
    assert.equal(await card4.count(), 0, "the field takes the card's place");
    await assertRowUnder(viewer, 4, "the card opened");
    await page.keyboard.press("Escape");
    await rowPopover.waitFor({ state: "detached" });
    assert.ok(await viewer.isVisible(), "Escape closes the unchanged field, not the viewer");
    await card4.click();
    await fieldFocused(page);
    await page.keyboard.type(" Keep it.");
    await page.keyboard.press("Escape");
    await frames(page);
    assert.equal(await rowPopover.count(), 1, "Escape keeps a changed field");
    assert.ok(await focusedMatches(page, ".comment-editor-field"), "and its focus");
    assert.ok(await viewer.isVisible(), "and the viewer");
    assert.equal(await body.evaluate((node) => (node.querySelector(".code-comment-frame-host > iframe.comment-frame[data-open]") as unknown as { seenBefore?: boolean } | null)?.seenBefore === true), true, "the second opening uses the same frame");
    // the app's shortcuts reach the page from the field in its frame: Settings opens over it, its Escape closes it alone, the text stays
    await page.keyboard.press("ControlOrMeta+Shift+Comma");
    await page.locator(".settings-dialog").waitFor();
    await page.keyboard.press("Escape");
    await page.locator(".settings-dialog").waitFor({ state: "detached" });
    assert.equal(await rowPopover.count(), 1, "Escape closed Settings alone");
    assert.equal(await fieldOf(page, true).inputValue(), "A blank line between imports and types. Keep it.", "the text typed stays");
    // Tab goes on from the field in the page's order (Delete, then ↑), and Shift+Tab comes back into it
    await fieldOf(page, true).focus();
    await page.keyboard.press("Tab");
    await eventually("Tab from the field to its Delete", () => focusedMatches(page, ".comment-popover.is-row button.comment-popover-delete"));
    await page.keyboard.press("Tab");
    await eventually("Tab on to its ↑", () => focusedMatches(page, ".comment-popover.is-row button.comment-popover-save"));
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    await eventually("Shift+Tab back into the field", () => focusedMatches(page, ".comment-editor-field"));
    // a theme changed while the field is open reaches the frame's document
    const theme = await page.evaluate(() => document.documentElement.dataset["theme"] ?? null);
    await page.evaluate(() => { document.documentElement.dataset["theme"] = "light"; });
    await eventually("the frame's <html> to take the theme", () => body.evaluate((node) => (node.querySelector(".code-comment-frame-host > iframe.comment-frame[data-open]") as HTMLIFrameElement | null)?.contentDocument?.documentElement.dataset["theme"] === "light"));
    await page.evaluate((was) => { if (was === null) delete document.documentElement.dataset["theme"]; else document.documentElement.dataset["theme"] = was; }, theme);
    console.log("PASS code-inline: the row's field is in the layer's frame (the same one for each opening, over the field's slot, the card's edge following its focus); Ctrl+Shift+, opens Settings from it and Escape closes Settings alone; Tab and Shift+Tab go on in the page's order; a theme change reaches the frame");
    // the focus elsewhere in the viewer: Escape is the field's first, and keeps it
    await viewer.getByRole("link", { name: "Open in a new tab", exact: true }).focus();
    await page.keyboard.press("Escape");
    await frames(page);
    assert.equal(await rowPopover.count(), 1, "Escape from elsewhere keeps a changed field");
    assert.ok(await focusedMatches(page, ".comment-editor-field"), "giving it the focus back");
    await fieldOf(page, true).fill("A blank line between imports and types.");
    await page.keyboard.press("Escape");
    await rowPopover.waitFor({ state: "detached" });
    console.log("PASS code-inline: the card opens in its place with its text; Escape closes it unchanged, keeps it changed (the focus back in its field), the viewer staying");

    // one field at a time: with text typed in line 4's field the ⊕ of line 6 gives that field the focus back; unchanged,
    // line 6's field takes its place
    await card4.click();
    await fieldFocused(page);
    await page.keyboard.type(" Typed.");
    let at6 = await lineBox(lineOf(viewer, 6));
    await page.mouse.move(at6.number, at6.y);
    await assertAddAt(viewer, 6, "line 6 hovered with line 4's changed field open");
    await visibleAdds(viewer).click();
    await frames(page);
    assert.equal(await rowPopover.count(), 1, "one field");
    assert.equal(await rowOf(viewer, 4).locator(".comment-popover.is-row").count(), 1, "line 4's field stays");
    assert.equal(await fieldOf(page, true).inputValue(), "A blank line between imports and types. Typed.", "with its text");
    assert.ok(await focusedMatches(page, ".comment-editor-field"), "and the focus");
    await fieldOf(page, true).fill("A blank line between imports and types.");
    at6 = await lineBox(lineOf(viewer, 6));
    await page.mouse.move(at6.number, at6.y);
    await assertAddAt(viewer, 6, "line 6 hovered with line 4's unchanged field open");
    await visibleAdds(viewer).click();
    await eventually("line 6's field", async () => (await rowOf(viewer, 6).locator(".comment-popover.is-row").count()) === 1);
    assert.equal(await rowPopover.count(), 1, "one field");
    assert.equal(await fieldOf(page, true).getAttribute("placeholder"), "Write a comment…");
    assert.equal(await card4.count(), 1, "line 4's card is back");
    await fieldFocused(page);
    await escapePopover(page);
    console.log("PASS code-inline: one field at a time: with text typed in line 4's field the ⊕ of line 6 keeps it, its text and its focus; unchanged, line 6's field takes its place");

    // Delete removes it, its room and the badge
    await card4.getByRole("button", { name: "Delete comment on line 4", exact: true }).click();
    await eventually("the card to go", async () => (await viewer.locator(".code-comment-card").count()) === 0);
    // the last card: the focus goes to the header's toggle, not to the page
    await eventually("the focus on the header's toggle", () => focusedMatches(page, "button.file-viewer-comments"));
    await eventually("line 4's room to go", async () => !(await lineOf(viewer, 4).evaluate((line) => line.hasAttribute("data-comment-room"))));
    assert.equal(await toggle.locator(".file-viewer-comments-count").count(), 0, "the badge goes");
    assert.deepEqual(await storedFileComments(page), []);
    console.log("PASS code-inline: the card's Delete removes the comment, its room and the badge");
    assert.deepEqual(errors, []);
    await close();

    // a legacy comment on a range (lines 2–4, on a selection) and a whole-line one on 4: two cards under line 4, in the
    // order they are sent, the range still highlighted
    const range = { ...seededComment("seed-range-2-4", syncPath, "src/sync.ts", "code", SYNC_LINES, 2, 4, "Range note", 2), selection: { text: `\n${SYNC_LINES[2]}\n`, start: [0, 0], end: [2, 0] }, anchor: `file:${syncPath}:code:2-4@0.0-2.0` };
    const whole = seededComment("seed-line-4", syncPath, "src/sync.ts", "code", SYNC_LINES, 4, 4, "Line note", 1);
    const seeded = await open(DESKTOP, [whole, range]);
    viewer = await openSync(seeded.page);
    body = viewer.locator(".file-viewer-body");
    const cards = rowOf(viewer, 4).locator(".code-comment-card .code-comment-text");
    await eventually("two cards under line 4", async () => (await cards.count()) === 2);
    assert.deepEqual(await cards.allTextContents(), ["Range note", "Line note"], "stacked in send order");
    assert.equal(await viewer.locator(".code-comment-row").count(), 1, "one row, under line 4");
    await assertRowUnder(viewer, 4, "the two cards");
    await eventually("the range to be highlighted", async () => (await highlightText(seeded.page, "block-comment")).includes("export interface Note"));
    // the pointer on a card brings its comment's text up, as on a pin in the preview, and leaving the card takes it down
    assert.equal(await highlightText(seeded.page, "block-comment-active"), "", "no text up before the pointer is on a card");
    const rangeCard = rowOf(viewer, 4).locator(".code-comment-card", { hasText: "Range note" });
    const overRange = await rangeCard.boundingBox();
    assert.ok(overRange !== null, "the range card to hover");
    await seeded.page.mouse.move(overRange.x + overRange.width / 2, overRange.y + overRange.height / 2);
    await eventually("the hovered card's text to come up", async () => (await highlightText(seeded.page, "block-comment-active")).includes("export interface Note")).catch(async (error: Error) => {
      throw new Error(`${error.message} (up: ${JSON.stringify(await highlightText(seeded.page, "block-comment-active"))}, all: ${JSON.stringify(await highlightText(seeded.page, "block-comment"))}, hover: ${await rangeCard.evaluate((n) => `${n.matches(":hover")} id=${n.getAttribute("data-comment-id")} surface=${n.closest("[data-comment-surface]") !== null}`)})`);
    });
    // and with no focus mode here: the body (an ancestor of every line) gets no attribute, which would restyle them all
    assert.equal(await viewer.locator(".file-viewer-body").evaluate((n) => n.hasAttribute("data-comment-focus")), false, "the code view's body takes no focus attribute while a card's text is up");
    await seeded.page.mouse.move(overRange.x + overRange.width / 2, 2);
    await eventually("the text to go down as the pointer leaves the card", async () => (await highlightText(seeded.page, "block-comment-active")) === "");
    // the mode off: a mouse's drag from the start of line 3 to the end of line 6 across line 4's cards selects exactly the
    // source lines, as does one let go over a card (the cards, in the layer after the code, stay out of the selection)
    const selectedText = (): Promise<string> => seeded.page.evaluate(() => window.getSelection()?.toString() ?? "");
    const dragStart = await textEdge(lineOf(viewer, 3), false, true);
    const dragEnd = await textEdge(lineOf(viewer, 6), true, false);
    await seeded.page.mouse.move(dragStart.x, dragStart.y);
    await seeded.page.mouse.down();
    await seeded.page.mouse.move(dragStart.x + 20, dragStart.y + 20, { steps: 4 });
    await seeded.page.mouse.move(dragEnd.x, dragEnd.y, { steps: 8 });
    await seeded.page.mouse.up();
    assert.equal(await selectedText(), SYNC_LINES.slice(2, 6).join("\n"), "a drag across line 4's cards selects exactly lines 3–6");
    await seeded.page.mouse.click(dragEnd.x, dragEnd.y - 60);
    const overCard = await rowOf(viewer, 4).locator(".code-comment-card").first().boundingBox();
    assert.ok(overCard !== null, "a card to release over");
    await seeded.page.mouse.move(dragStart.x, dragStart.y);
    await seeded.page.mouse.down();
    await seeded.page.mouse.move(dragStart.x + 20, dragStart.y + 20, { steps: 4 });
    await seeded.page.mouse.move(overCard.x + overCard.width / 2, overCard.y + overCard.height / 2, { steps: 8 });
    await seeded.page.mouse.up();
    const released = await selectedText();
    assert.ok(released.startsWith(SYNC_LINES[2]!) && SYNC_LINES.join("\n").includes(released), `a drag let go over a card selects source lines only (${JSON.stringify(released)})`);
    assert.ok(!released.includes("Range note") && !released.includes("Line note"), "and no card text");
    await seeded.page.mouse.click(dragEnd.x, dragEnd.y - 60);
    console.log("PASS code-inline: with the mode off a mouse's drag across line 4's cards, and one let go over a card, select the source lines and no card text");
    // the mode on (a new context: off again), line 4's whole-line card opened; line 6 hovered shows one ⊕, at line 6,
    // and the pointer gone from the lines it is back on line 4
    await viewer.locator("button.file-viewer-comments").click();
    await rowOf(viewer, 4).locator(".code-comment-card", { hasText: "Line note" }).click();
    await body.locator(".comment-popover.is-row").waitFor();
    assert.equal(await popoverText(seeded.page, true), "Line note");
    at6 = await lineBox(lineOf(viewer, 6));
    await seeded.page.mouse.move(at6.number, at6.y);
    await assertAddAt(viewer, 6, "line 6 hovered with line 4's field open");
    await seeded.page.mouse.move(at6.number, 4);
    await assertAddAt(viewer, 4, "no line hovered, line 4's field open");
    await escapePopover(seeded.page);
    // the range card opens on its own target: its highlight's selection, not the whole lines
    await rowOf(viewer, 4).locator(".code-comment-card", { hasText: "Range note" }).click();
    await fieldFocused(seeded.page);
    await fieldOf(seeded.page, true).fill("Range note, edited");
    await seeded.page.keyboard.press("Control+Enter");
    await body.locator(".comment-popover.is-row").waitFor({ state: "detached" });
    const stored = (await storedFileComments(seeded.page)).sort((a, b) => a.lines[0]! - b.lines[0]!);
    assert.deepEqual(stored.map((c) => [c.lines, c.selected]), [[[2, 4], true], [[4, 4], false]], "the edit keeps the range's target");
    // an edit closes onto the card edited, not the row's first (the second one: line note edited in place)
    await rowOf(viewer, 4).locator(".code-comment-card", { hasText: "Line note" }).click();
    await fieldFocused(seeded.page);
    await fieldOf(seeded.page, true).fill("Line note, edited");
    await seeded.page.keyboard.press("Control+Enter");
    await body.locator(".comment-popover.is-row").waitFor({ state: "detached" });
    await eventually("the focus on the edited card's text", async () => await seeded.page.evaluate(() => document.activeElement?.textContent) === "Line note, edited");
    // Delete hands the focus on: the remaining card's text, then (the last one gone) the header's toggle
    const stacked = rowOf(viewer, 4).locator(".code-comment-card");
    assert.equal(await stacked.count(), 2);
    const textId = await stacked.first().locator("button.code-comment-text").getAttribute("id");
    assert.ok(textId !== null && textId !== "", "a card's text has an id");
    assert.equal(await stacked.first().locator("button.code-comment-delete").getAttribute("aria-describedby"), textId, "a Delete is described by its card's text, so stacked cards differ");
    await stacked.first().getByRole("button", { name: "Delete comment on line 4", exact: true }).click();
    await eventually("one card left", async () => (await stacked.count()) === 1);
    await eventually("the focus on the remaining card's text", async () => await seeded.page.evaluate(() => document.activeElement?.textContent) === "Line note, edited");
    await stacked.first().getByRole("button", { name: "Delete comment on line 4", exact: true }).click();
    await eventually("no card left", async () => (await stacked.count()) === 0);
    await eventually("the focus on the header's toggle", () => focusedMatches(seeded.page, "button.file-viewer-comments"));
    console.log("PASS code-inline: an edit closes onto its own card; Delete moves the focus to the remaining card's text button, and after the last card to the header's toggle");
    console.log("PASS code-inline: a legacy range comment (lines 2–4, a selection) and a whole-line one on 4 stack under line 4 in send order, the range highlighted; with line 4's field open a hovered line 6 shows the one ⊕, back on line 4 once no line is hovered; an edit keeps the range's target");

    // the code scrolled sideways (no wrapping): the ⊕ follows the divider, and hides while the divider is out of view
    await viewer.getByRole("button", { name: "Close file", exact: true }).click();
    await viewer.waitFor({ state: "detached" });
    await seeded.page.getByRole("button", { name: "wide.ts", exact: true }).click();
    const wide = seeded.page.getByRole("dialog", { name: "wide.ts", exact: true });
    await lineOf(wide, WIDE_LINES.length).waitFor();
    const code = wide.locator("pre.file-viewer-text");
    assert.ok(await code.evaluate((node) => node.scrollWidth - node.clientWidth > 400), "the code scrolls sideways");
    const at2 = await lineBox(lineOf(wide, 2));
    await seeded.page.mouse.move(at2.number, at2.y);
    await assertAddAt(wide, 2, "line 2 hovered");
    await code.evaluate((node) => { node.scrollLeft = 10; });
    await assertAddAt(wide, 2, "the code scrolled 10px sideways");
    await code.evaluate((node) => { node.scrollLeft = 200; });
    await eventually("the ⊕ to hide with the divider out of view", async () => (await visibleAdds(wide).count()) === 0);
    await code.evaluate((node) => { node.scrollLeft = 0; });
    await assertAddAt(wide, 2, "the code scrolled back");
    console.log("PASS code-inline: with the code scrolled sideways the ⊕ follows the divider, and hides while the divider is out of view");

    // a long file scrolled down: the first Tab to the ⊕ lands on the first line in view and the body does not jump to the top
    await wide.getByRole("button", { name: "Close file", exact: true }).click();
    await wide.waitFor({ state: "detached" });
    await seeded.page.getByRole("button", { name: "big.txt", exact: true }).click();
    const big = seeded.page.getByRole("dialog", { name: "big.txt", exact: true });
    await lineOf(big, 40).waitFor();
    const bigBody = big.locator(".file-viewer-body");
    const bigToggle = big.locator("button.file-viewer-comments");
    assert.equal(await bigToggle.getAttribute("aria-pressed"), "true", "the mode is still on");
    await bigBody.evaluate((node) => { node.scrollTop = 20000; });
    await frames(seeded.page);
    // the first line that starts at or below the body's top edge
    const firstSeen = await bigBody.evaluate((node) => {
      const top = node.getBoundingClientRect().top + node.clientTop;
      const line = [...node.querySelectorAll<HTMLElement>(".hl-line[data-source-line]")].find((element) => element.getBoundingClientRect().top >= top);
      return { line: Number(line?.dataset["sourceLine"]), scrollTop: node.scrollTop };
    });
    assert.ok(firstSeen.scrollTop > 10000 && firstSeen.line > 100, `the body is scrolled down (${JSON.stringify(firstSeen)})`);
    // the idle ⊕ lies inside the body's current view, so a browser that scrolls to a focused element (Chromium does not for
    // a box this small; others do) has nothing to scroll to
    const idleBox = await big.locator("button.code-comment-add").evaluate((node) => {
      const box = node.getBoundingClientRect();
      const view = node.closest(".file-viewer-body")!.getBoundingClientRect();
      return { inView: box.top >= view.top && box.bottom <= view.bottom && box.left >= view.left && box.right <= view.right, box: [box.left, box.top], view: [view.left, view.top, view.right, view.bottom] };
    });
    assert.ok(idleBox.inView, `the idle ⊕ is inside the body's view (${JSON.stringify(idleBox)})`);
    await bigToggle.focus();
    for (let i = 0; i < 20 && !(await focusedMatches(seeded.page, "button.code-comment-add")); i++) await seeded.page.keyboard.press("Tab");
    assert.ok(await focusedMatches(seeded.page, "button.code-comment-add"), "Tab reaches the ⊕ in the long file");
    await frames(seeded.page);
    assert.equal(await big.locator("button.code-comment-add").getAttribute("aria-label"), `Add a comment to line ${firstSeen.line}`, "the ⊕ is on the first visible line, not line 1");
    assert.ok(Math.abs(await bigBody.evaluate((node) => node.scrollTop) - firstSeen.scrollTop) <= 2, "focusing the ⊕ did not scroll the body");
    await assertAddAt(big, firstSeen.line, "the ⊕ focused by Tab in the scrolled long file");
    console.log("PASS code-inline: in a long file scrolled down the first Tab puts the ⊕ on the first visible line, with no jump to the top");
    assert.deepEqual(seeded.errors, []);
    await seeded.close();
  },

  /**
   * Comment mode: remembered across a reload; turned off, it keeps a field with text typed (which still saves) and closes
   * an unchanged one, and the cards turn read-only; Settings → File viewer → Click a line to comment; Settings → Chat →
   * Comments off takes the toggle away and disables the File viewer's group, with its note.
   */
  async "code-mode"(open) {
    const syncPath = realpathSync(join(root, "src", "sync.ts"));
    const { page, errors, close } = await open(DESKTOP, [seededComment("seed-line-8", syncPath, "src/sync.ts", "code", SYNC_LINES, 8, 8, "Compare with <=.", 1)]);
    let viewer = await openSync(page);
    let toggle = viewer.locator("button.file-viewer-comments");
    assert.equal(await toggle.getAttribute("aria-label"), "Comment mode, 1 comment");
    assert.equal(await toggle.locator(".file-viewer-comments-count").textContent(), "1");
    await toggle.click();
    assert.equal(await toggle.getAttribute("aria-pressed"), "true");
    // closed first: a reload would open it again from the address
    await viewer.getByRole("button", { name: "Close file", exact: true }).click();
    await viewer.waitFor({ state: "detached" });
    await page.reload();
    await page.locator(".conn-live").waitFor();
    await page.locator(".chat-view p.is-commentable", { hasText: REPLY }).waitFor();
    viewer = await openSync(page);
    toggle = viewer.locator("button.file-viewer-comments");
    assert.equal(await toggle.getAttribute("aria-pressed"), "true", "the mode survives a reload");
    console.log("PASS code-mode: the toggle names the count; the mode survives a reload");

    // a field with text typed stays when the mode goes off, and still saves. The toggle is pressed by the keyboard: a
    // press on it would be a press outside the field, which closes an unchanged one by itself
    const body = viewer.locator(".file-viewer-body");
    const rowPopover = body.locator(".comment-popover.is-row");
    const pressToggle = async (): Promise<void> => {
      await toggle.focus();
      await page.keyboard.press("Enter");
    };
    const at2 = await lineBox(lineOf(viewer, 2));
    await page.mouse.move(at2.number, at2.y);
    await visibleAdds(viewer).click();
    await fieldFocused(page);
    await fieldOf(page, true).fill("Typed before the mode went off");
    await pressToggle();
    assert.equal(await toggle.getAttribute("aria-pressed"), "false");
    await frames(page);
    assert.equal(await rowPopover.count(), 1, "the changed field stays with the mode off");
    assert.equal(await fieldOf(page, true).inputValue(), "Typed before the mode went off");
    await fieldOf(page, true).focus();
    await page.keyboard.press("Control+Enter");
    await rowPopover.waitFor({ state: "detached" });
    await eventually("its card under line 2", async () => (await rowOf(viewer, 2).locator(".code-comment-card").count()) === 1);
    // an unchanged field closes as the mode goes off
    await pressToggle();
    await rowOf(viewer, 8).locator(".code-comment-card").click();
    await rowPopover.waitFor();
    await pressToggle();
    await rowPopover.waitFor({ state: "detached" });
    assert.equal(await toggle.getAttribute("aria-pressed"), "false");
    console.log("PASS code-mode: turning the mode off keeps a field with text typed, which still saves; it closes an unchanged one");

    // the mode off: the cards are read-only, no ⊕, a click on a line opens nothing
    const card8 = rowOf(viewer, 8).locator(".code-comment-card");
    assert.equal(await card8.getByRole("button", { name: /^Delete comment/ }).count(), 0, "no Delete with the mode off");
    await card8.click();
    await frames(page);
    assert.equal(await popoverOf(page).count(), 0, "a click on a card opens nothing with the mode off");
    const at8 = await pointOn(lineOf(viewer, 8));
    await page.mouse.move(at8.x, at8.y);
    await frames(page);
    assert.equal(await visibleAdds(viewer).count(), 0, "no ⊕ with the mode off");
    await page.mouse.click(at8.x, at8.y);
    await frames(page);
    assert.equal(await popoverOf(page).count(), 0, "a click on a line opens nothing");
    // the mode on, Click a line to comment off (the default): a click on a line opens nothing either
    await toggle.click();
    const at11 = await pointOn(lineOf(viewer, 11));
    await page.mouse.click(at11.x, at11.y);
    await frames(page);
    assert.equal(await popoverOf(page).count(), 0, "without Click a line to comment, a click on a line opens nothing");
    console.log("PASS code-mode: with the mode off the cards have no Delete and open nothing, no ⊕ shows and a line click opens nothing; on, a line click opens nothing without the setting");

    // Settings → File viewer → Click a line to comment
    await page.keyboard.press("ControlOrMeta+Shift+Comma");
    await openSettingsPage(page, "File viewer");
    const settingsDialog = page.locator(".settings-dialog");
    await settingsDialog.getByRole("switch", { name: "Click a line to comment", exact: true }).click();
    await page.keyboard.press("Escape");
    await settingsDialog.waitFor({ state: "detached" });
    assert.ok(await viewer.isVisible(), "Escape closed Settings alone");
    await page.mouse.click(at11.x, at11.y);
    await rowPopover.waitFor();
    assert.equal(await fieldOf(page, true).getAttribute("placeholder"), "Write a comment…", "a click on line 11 opens its field");
    await fieldFocused(page);
    await escapePopover(page);
    // a click on line 8 opens its comment
    await page.mouse.click(at8.x, at8.y);
    await rowPopover.waitFor();
    assert.equal(await popoverText(page, true), "Compare with <=.", "a click on a commented line opens its comment");
    await escapePopover(page);
    // the mode off, the setting on: a line click still opens nothing
    await toggle.click();
    await page.mouse.click(at11.x, at11.y);
    await frames(page);
    assert.equal(await popoverOf(page).count(), 0, "with the mode off a line click opens nothing, the setting on");
    await toggle.click();
    // a double click selects a word, and leaves no field: in a short file (the viewer hangs from the top and only grows
    // downward, so the field its first click opens moves nothing under the second) and in one taller than the viewer
    const viewerTop = await viewer.evaluate((node) => node.getBoundingClientRect().top);
    // content-sized, hanging from the top gap ((100vh - 92vh) / 2): the short file's viewer ends well above the scrim's bottom edge
    const placed = await viewer.evaluate((node) => {
      const box = node.getBoundingClientRect();
      const scrim = node.closest(".file-viewer-scrim")!.getBoundingClientRect();
      return { top: box.top - scrim.top, bottom: box.bottom, scrimBottom: scrim.bottom, gap: (window.innerHeight - window.innerHeight * 0.92) / 2 };
    });
    assert.ok(Math.abs(placed.top - placed.gap) <= 1, `the viewer's top is the scrim's top gap (${JSON.stringify(placed)})`);
    assert.ok(placed.bottom < placed.scrimBottom - placed.gap, `a short file's viewer is content-sized, not full height (${JSON.stringify(placed)})`);
    const storeWord = await wordPoint(lineOf(viewer, 11), "store");
    await page.mouse.dblclick(storeWord.x, storeWord.y);
    await frames(page, 10);
    assert.equal(await popoverOf(page).count(), 0, "no field after a double click in a short file");
    assert.equal(await page.evaluate(() => window.getSelection()?.toString()), "store", "the word is selected in a short file");
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await page.mouse.click(at11.x, at11.y);
    await rowPopover.waitFor();
    assert.equal(await viewer.evaluate((node) => node.getBoundingClientRect().top), viewerTop, "a field opening moves no short file's viewer");
    await escapePopover(page);
    await viewer.getByRole("button", { name: "Close file", exact: true }).click();
    await viewer.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "big.txt", exact: true }).click();
    const big = page.getByRole("dialog", { name: "big.txt", exact: true });
    await lineOf(big, 40).waitFor();
    const plain = await wordPoint(lineOf(big, 20), "plain");
    await page.mouse.dblclick(plain.x, plain.y);
    await frames(page, 10);
    assert.equal(await popoverOf(page).count(), 0, "no field after a double click");
    assert.equal(await page.evaluate(() => window.getSelection()?.toString()), "plain", "the word is selected");
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await big.getByRole("button", { name: "Close file", exact: true }).click();
    await big.waitFor({ state: "detached" });
    console.log("PASS code-mode: with Click a line to comment a click on a line opens its field (its comment on a commented line); a double click selects a word and leaves no field; the mode off, nothing");

    // a file cut short: its cut-off line takes no comment
    await page.getByRole("button", { name: "long.txt", exact: true }).click();
    const long = page.getByRole("dialog", { name: "long.txt", exact: true });
    await lineOf(long, 1).waitFor();
    const cut = await pointOn(lineOf(long, 1));
    await page.mouse.click(cut.x, cut.y);
    await frames(page);
    assert.equal(await popoverOf(page).count(), 0, "a click on a line cut off at the load limit opens nothing");
    await long.getByRole("button", { name: "Close file", exact: true }).click();
    await long.waitFor({ state: "detached" });
    console.log("PASS code-mode: a line cut off at the load limit takes no comment");

    // Settings → Chat → Comments off: no toggle; the File viewer's Comments group disabled, with its note
    viewer = await openSync(page);
    await page.keyboard.press("ControlOrMeta+Shift+Comma");
    await openSettingsPage(page, "Chat");
    await settingsDialog.getByRole("switch", { name: "Comments", exact: true }).click();
    const confirm = page.getByRole("alertdialog");
    await confirm.waitFor();
    await confirm.getByRole("button", { name: "Turn off and delete", exact: true }).click();
    await confirm.waitFor({ state: "detached" });
    await openSettingsPage(page, "File viewer");
    const group = settingsDialog.locator(".settings-section", { has: page.getByRole("heading", { name: "Comments", exact: true }) });
    assert.ok(await group.getByRole("switch", { name: "Click a line to comment", exact: true }).isDisabled(), "Click a line to comment is disabled");
    for (const name of ["Long press", "Tap", "Bottom sheet", "Below the line"]) {
      assert.ok(await group.getByRole("button", { name, exact: true }).isDisabled(), `${name} is disabled`);
    }
    assert.equal(await group.locator(".settings-note").count(), 1, "the group has its note");
    assert.equal(await group.getByRole("button", { name: "Open Chat settings", exact: true }).count(), 1, "which links to the Chat settings");
    await page.keyboard.press("Escape");
    await settingsDialog.waitFor({ state: "detached" });
    assert.equal(await viewer.locator("button.file-viewer-comments").count(), 0, "no toggle with comments off");
    assert.equal(await viewer.locator(".code-comment-card").count(), 0, "no card");
    console.log("PASS code-mode: with Settings → Chat → Comments off the header has no toggle and the File viewer's Comments group is disabled, with its note");
    assert.deepEqual(errors, []);
    await close();
  },

  /**
   * The code view on phones and tablets (a touch screen, 393 × 852 and 820 × 1180), in comment mode: the mode turned on
   * by a tap shows a hint under the header, and no mark in the code; a finger's press on the code raises no context menu;
   * a long press (300 ms) on a line marks and tints it and arms it, and its lift opens the bottom sheet (its heading, the
   * line quoted, the field focused inside the lift), the click after it swallowed; a shorter press, a move or a scroll
   * (before or after arming) opens nothing; the scrim closes an empty sheet only; Save, the card, the card tapped to edit
   * (Delete and ✕ full touch targets, the sheet focused, not its field); a long press no click follows swallows no later
   * click; Settings → Below the line (the band of a held row never skips a new press's delay), → Tap, → Bottom sheet. On
   * the phone also: Copy file, and a viewer without a pane; and the composer's walk to a comment with the mode on, which
   * opens the sheet.
   */
  async "code-touch"(open) {
    for (const [device, options] of [["phone", IPHONE_14_PRO], ["tablet", IPAD]] as const) {
      const { page, errors, close } = await open(options);
      const size = options.viewport!;
      assert.ok(await page.evaluate(() => matchMedia("(pointer: coarse)").matches), `${device}: the pointer is coarse`);
      const finger = await fingerOf(page);
      // what the page let through: clicks (seen first, at the window's capture, and at the end), and whether a comment's
      // field had the focus as a finger's lift finished (its `pointerup` at the window, after the app's own handling)
      await page.evaluate(() => {
        const seen = window as unknown as { clicksIn: number; clicksOut: number; focusAtLift: boolean };
        Object.assign(seen, { clicksIn: 0, clicksOut: 0, focusAtLift: false });
        window.addEventListener("click", () => { seen.clicksIn += 1; }, true);
        window.addEventListener("click", () => { seen.clicksOut += 1; });
        window.addEventListener("pointerup", (event) => {
          // the code view's field is in a frame of its own: the focus followed into it
          const active = document.activeElement;
          const inner = active?.localName === "iframe" ? (active as HTMLIFrameElement).contentDocument?.activeElement : active;
          if (event.pointerType === "touch") seen.focusAtLift = inner?.matches(".comment-editor-field") ?? false;
        });
      });
      const seen = (): Promise<{ clicksIn: number; clicksOut: number; focusAtLift: boolean }> => page.evaluate(() => {
        const { clicksIn, clicksOut, focusAtLift } = window as unknown as { clicksIn: number; clicksOut: number; focusAtLift: boolean };
        return { clicksIn, clicksOut, focusAtLift };
      });
      let viewer = await openSync(page, true);
      let toggle = viewer.locator("button.file-viewer-comments");
      const sheet = page.locator(".modal-scrim > .modal.comment-popover.is-sheet");
      /** The lines marked as pressed in `scope` (a viewer), by number. */
      const pressedIn = (scope: Locator): Promise<string[]> => scope.evaluate((node) => [...node.querySelectorAll<HTMLElement>(".file-viewer-text .hl-line.is-pressing")].map((line) => line.dataset["sourceLine"]!));
      /** The press's tint in `scope` (`held`: the band of the line a finger opened): shown (its opacity), and whether it lies on line `n`'s row. */
      const tintIn = (scope: Locator, n: number, held = false): Promise<{ shown: boolean; onLine: boolean }> => scope.evaluate((node, { line, selector }) => {
        const tint = node.querySelector(selector);
        const element = node.querySelector(`.file-viewer-text .hl-line[data-source-line="${line}"]`);
        if (tint === null || element === null) return { shown: false, onLine: false };
        const box = tint.getBoundingClientRect();
        const row = element.getClientRects()[0]!;
        const style = getComputedStyle(tint);
        const probe = document.createElement("span");
        probe.style.color = "var(--bg-hover)";
        document.body.append(probe);
        const hover = getComputedStyle(probe).color;
        probe.remove();
        // a line with a room after it is one box, its first row at its top
        const middle = element.hasAttribute("data-comment-room") ? row.top + parseFloat(getComputedStyle(element).lineHeight) / 2 : row.top + row.height / 2;
        return { shown: style.opacity === "1" && style.backgroundColor === hover, onLine: Math.abs(box.top + box.height / 2 - middle) <= 2 };
      }, { line: n, selector: held ? ".code-comment-held" : ".code-comment-press" });
      /**
       * A finger's press on line `n` dispatched in the page (`pointerdown`, then `then`), with what it gives at once: whether
       * the press's tint shows (its band waits 80 ms), and whether a `contextmenu` and a `selectstart` dispatched during it
       * were prevented. Headless Chromium sends neither for a long press, so the ones a phone's browser raises are
       * dispatched here.
       */
      const pressAt = (n: number, then: "pointercancel" | null): Promise<{ tintAtOnce: string; menuPrevented: boolean; selectPrevented: boolean }> => lineOf(viewer, n).evaluate((line, end) => {
        const row = line.getClientRects()[0]!;
        const at = { bubbles: true, cancelable: true, composed: true, clientX: row.left + 8, clientY: row.top + row.height / 2 };
        const touch = { ...at, pointerType: "touch", pointerId: 11, isPrimary: true };
        line.dispatchEvent(new PointerEvent("pointerdown", touch));
        const tint = line.closest(".file-viewer-body")?.querySelector(".code-comment-press");
        const tintAtOnce = tint ? getComputedStyle(tint).opacity : "none";
        const menu = new MouseEvent("contextmenu", at);
        line.dispatchEvent(menu);
        const select = new Event("selectstart", { bubbles: true, cancelable: true });
        line.dispatchEvent(select);
        if (end !== null) line.dispatchEvent(new PointerEvent(end, touch));
        return { tintAtOnce, menuPrevented: menu.defaultPrevented, selectPrevented: select.defaultPrevented };
      }, then);
      /** Whether a `selectstart` dispatched on line `n` with no press on it was prevented. */
      const selectPreventedAt = (n: number): Promise<boolean> => lineOf(viewer, n).evaluate((line) => {
        const select = new Event("selectstart", { bubbles: true, cancelable: true });
        line.dispatchEvent(select);
        return select.defaultPrevented;
      });
      /** A point on code line `line`'s first row, a little into the code (a blank line too), scrolled into the view's middle first. */
      const rowPoint = (line: Locator): Promise<{ x: number; y: number }> => line.evaluate((node) => {
        node.scrollIntoView({ block: "center" });
        const row = node.getClientRects()[0]!;
        const code = node.closest("code")!;
        const start = code.getBoundingClientRect().left + code.clientLeft + parseFloat(getComputedStyle(code).paddingInlineStart);
        return { x: start + 12, y: row.top + row.height / 2 };
      });
      /**
       * A finger has no ⊕: it stays idle (no size, no line) and without the focus, while a field a finger opened is up
       * and once it closed (no focus given back to it, which would put it on a line)
       */
      const assertAddIdle = async (when: string): Promise<void> => {
        await frames(page, 3);
        const add = await viewer.locator("button.code-comment-add").evaluate((node) => ({
          idle: node.classList.contains("is-idle"),
          size: [(node as HTMLElement).offsetWidth, (node as HTMLElement).offsetHeight],
          focused: document.activeElement === node,
          line: node.closest(".file-viewer-body")?.querySelector("pre.file-viewer-text")?.hasAttribute("data-comment-line") ?? false,
        }));
        assert.deepEqual(add, { idle: true, size: [0, 0], focused: false, line: false }, `${device}: no ⊕ ${when}`);
      };
      const hint = viewer.locator(".code-comment-hint");
      /** The hint says `text` under the header and lets taps through; `gone`: it goes within 3 s, not much sooner. */
      const assertHint = async (text: string, gone: boolean): Promise<void> => {
        await eventually(`${device}: the hint "${text}"`, async () => (await hint.textContent().catch(() => null)) === text);
        const shown = Date.now();
        // its live region is there before it, so a screen reader hears each hint
        assert.equal(await hint.evaluate((node) => node.parentElement?.getAttribute("role")), "status", `${device}: the hint is said in a status`);
        const [box, head] = await Promise.all([hint.boundingBox(), viewer.locator(".file-viewer-header").boundingBox()]);
        assert.ok(box !== null && head !== null && box.y >= head.y + head.height - 1 && box.y <= head.y + head.height + 40, `${device}: the hint is under the header (${JSON.stringify({ box, head })})`);
        assert.equal(await hint.evaluate((node) => getComputedStyle(node).pointerEvents), "none", `${device}: the hint takes no tap`);
        if (!gone) return;
        await hint.waitFor({ state: "detached", timeout: 3000 });
        assert.ok(Date.now() - shown >= 2000, `${device}: the hint stays about 2.6 s (${Date.now() - shown} ms)`);
      };
      /** Closes Settings, from a page or its list. */
      const closeSettings = async (): Promise<void> => {
        const dialog = page.locator(".settings-dialog");
        for (let i = 0; i < 3 && (await dialog.count()) > 0; i++) {
          await page.keyboard.press("Escape");
          await frames(page);
        }
        await dialog.waitFor({ state: "detached" });
      };
      /** Settings → File viewer → Comments: the option named `name`. */
      const chooseSetting = async (name: string): Promise<void> => {
        await page.keyboard.press("ControlOrMeta+Shift+Comma");
        await openSettingsPage(page, "File viewer");
        const dialog = page.locator(".settings-dialog");
        const group = dialog.locator(".settings-section", { has: page.getByRole("heading", { name: "Comments", exact: true }) });
        await group.getByRole("button", { name, exact: true }).tap();
        assert.equal(await group.getByRole("button", { name, exact: true }).getAttribute("aria-pressed"), "true", `${device}: ${name} chosen`);
        await closeSettings();
      };

      // the mode off: the code selects as it does; a tap turns it on, with the hint, and no mark in the code
      assert.notEqual(await lineOf(viewer, 4).evaluate((line) => getComputedStyle(line).userSelect), "none", `${device}: with the mode off the code takes a selection`);
      const pressOff = await pressAt(4, "pointercancel");
      assert.equal(pressOff.menuPrevented, false, `${device}: with the mode off a finger's press on the code keeps its context menu`);
      assert.equal(pressOff.selectPrevented, false, `${device}: and its selection`);
      await toggle.tap();
      assert.equal(await toggle.getAttribute("aria-pressed"), "true", `${device}: a tap turns the mode on`);
      await assertHint("Press and hold a line to comment", true);
      await toggle.tap();
      assert.equal(await toggle.getAttribute("aria-pressed"), "false");
      await assertHint("Comment mode off", false);
      await toggle.tap();
      await assertHint("Press and hold a line to comment", false);
      assert.equal(await visibleAdds(viewer).count(), 0, `${device}: no ⊕`);
      assert.equal((await tintIn(viewer, 4)).shown, false, `${device}: no line tinted`);
      assert.equal((await tintIn(viewer, 4, true)).shown, false, `${device}: no line held`);
      assert.equal(await viewer.locator("pre.file-viewer-text[data-comment-line]").count(), 0, `${device}: no line marked`);
      // the code keeps its selection (`user-select: none` over a long file costs WebKit every keystroke in a field): only a
      // finger's press blocks one while it lasts
      assert.notEqual(await lineOf(viewer, 4).evaluate((line) => getComputedStyle(line).userSelect), "none", `${device}: with the mode on the code still takes a selection`);
      const pressOn = await pressAt(4, "pointercancel");
      assert.equal(pressOn.menuPrevented, true, `${device}: with the mode on a finger's press on the code raises no context menu`);
      assert.equal(pressOn.selectPrevented, true, `${device}: and starts no selection while it lasts`);
      assert.deepEqual(await pressedIn(viewer), [], `${device}: the cancelled press leaves no line pressed`);
      assert.equal(await selectPreventedAt(4), false, `${device}: with no press on it the code takes a selection`);
      console.log(`PASS code-touch (${device}): a tap on the toggle turns the mode on with the hint "Press and hold a line to comment" under the header (a status, taking no tap, gone within 3 s), off with "Comment mode off"; no mark in the code, and a finger's press on it raises no context menu and starts no selection while it lasts (both do with the mode off; a selection does with no press)`);

      /**
       * Holds a finger on line `n` past 300 ms (to 450 ms): the line is marked and tinted, and still nothing opens while
       * the finger is down (the press is armed); then lifts it, which opens it.
       */
      const longPress = async (n: number): Promise<void> => {
        const at = await rowPoint(lineOf(viewer, n));
        const started = Date.now();
        await finger("touchStart", at);
        await eventually(`${device}: line ${n} marked as pressed`, async () => (await pressedIn(viewer)).includes(String(n)), 1000);
        await eventually(`${device}: line ${n} tinted while held`, async () => {
          const tint = await tintIn(viewer, n);
          return tint.shown && tint.onLine;
        }, 1000);
        await holdUntil(started + HOLD_MS);
        assert.equal(await popoverOf(page).count(), 0, `${device}: nothing opens while the finger is still down after 300 ms`);
        assert.deepEqual(await pressedIn(viewer), [String(n)], `${device}: line ${n} is still pressed, armed`);
        assert.equal((await tintIn(viewer, n)).shown, true, `${device}: and tinted`);
        await finger("touchEnd");
      };
      const before = await seen();
      await longPress(4);
      await sheet.waitFor({ timeout: 1000 });
      await frames(page, 10);
      assert.equal(await sheet.count(), 1, `${device}: the sheet stays after the lift`);
      const after = await seen();
      assert.ok(after.focusAtLift, `${device}: the field has the focus inside the lift (iOS raises the keyboard)`);
      assert.ok(after.clicksIn - before.clicksIn >= 1, `${device}: the lift is a tap's end, which the browser follows with a click`);
      assert.equal(after.clicksOut - before.clicksOut, 0, `${device}: the click after the long press is swallowed`);
      await fieldFocused(page);
      assert.equal(await sheet.getAttribute("aria-label"), "Comment on line 4", `${device}: the sheet is named for assistive tech`);
      assert.equal(await sheet.locator(".comment-popover-heading").count(), 0, `${device}: and has no visible heading`);
      assert.equal(await sheet.locator(".comment-popover-code-number").textContent(), "4", `${device}: the quote names the line`);
      assert.equal(await sheet.evaluate((box) => getComputedStyle(box).resize), "none", `${device}: no resize grip`);
      assert.equal(await fieldOf(page, true).evaluate((field) => getComputedStyle(field).resize), "none", `${device}: nor on its field`);
      // the field in its frame looks as it did in the page: the sheet's input look, at 16 px, on no ground of the frame's own
      assert.equal(await sheet.locator("iframe.comment-frame[data-open]").count(), 1, `${device}: the sheet's field is in its own frame`);
      assert.deepEqual(await fieldOf(page, true).evaluate((field) => {
        const style = getComputedStyle(field);
        const frameStyle = getComputedStyle(field.ownerDocument.body);
        return [style.fontSize, style.borderTopWidth, frameStyle.backgroundColor, getComputedStyle(field.ownerDocument.documentElement).backgroundColor];
      }), ["16px", "1px", "rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0)"], `${device}: the sheet's field is 16 px with its input edge, the frame's document transparent`);
      assert.equal(await sheet.locator(".comment-popover-code").textContent(), `4${SYNC_LINES[3]}`, `${device}: and quotes it`);
      assert.deepEqual(await pressedIn(viewer), [], `${device}: no line is pressed once it opened`);
      assert.equal(await page.evaluate(() => window.getSelection()?.toString() ?? ""), "", `${device}: no text selected`);
      // measured where it comes to rest, not while it still rises (styles.css `sheet-in`)
      await sheetsSettled(page);
      const sheetBox = await sheet.boundingBox();
      assert.ok(sheetBox !== null && Math.abs(sheetBox.y + sheetBox.height - size.height) <= 1 && Math.abs(sheetBox.width - size.width) <= 1, `${device}: a bottom sheet, full width (${JSON.stringify(sheetBox)})`);
      assert.deepEqual(await tintIn(viewer, 4, true), { shown: true, onLine: true }, `${device}: line 4 stays tinted behind the sheet`);
      assert.equal((await tintIn(viewer, 4)).shown, false, `${device}: the press's own tint is gone`);
      console.log(`PASS code-touch (${device}): a long press on line 4 marks and tints it; held past 300 ms nothing opens yet, and the lift opens the bottom sheet (named "Comment on line 4", no visible heading, the line quoted with its number, the field focused inside the lift, the line tinted behind it); the click after it is swallowed, no text selected`);

      // the scrim closes the sheet while it is empty, keeps it with text typed; Save stores it, the card under line 4
      await page.touchscreen.tap(size.width / 2, 8);
      await sheet.waitFor({ state: "detached" });
      assert.equal((await tintIn(viewer, 4, true)).shown, false, `${device}: the tint goes with the sheet`);
      await longPress(4);
      await sheet.waitFor({ timeout: 1000 });
      await fieldFocused(page);
      await fieldOf(page, true).fill("Phone note");
      await page.touchscreen.tap(size.width / 2, 8);
      await frames(page);
      assert.equal(await sheet.count(), 1, `${device}: the scrim keeps a sheet with text typed`);
      assert.equal(await fieldOf(page, true).inputValue(), "Phone note");
      await sheet.getByRole("button", { name: "Save comment", exact: true }).tap();
      await sheet.waitFor({ state: "detached" });
      await assertAddIdle("after the sheet's Save");
      assert.deepEqual(await storedFileComments(page), [{ lines: [4, 4], quoteLines: [""], view: "code", selected: false }], `${device}: one comment on all of line 4`);
      const card4 = rowOf(viewer, 4).locator(".code-comment-card");
      await eventually(`${device}: line 4's card`, async () => (await card4.count()) === 1);
      assert.equal(await card4.locator(".code-comment-text").textContent(), "Phone note");
      await assertRowUnder(viewer, 4, `${device}: the card`);
      // the card tapped: the sheet to edit it, with Delete
      await card4.tap();
      await sheet.waitFor();
      assert.equal(await sheet.getAttribute("aria-label"), "Comment on line 4");
      assert.equal(await popoverText(page, true), "Phone note");
      assert.equal(await deleteOf(page).count(), 1, `${device}: the sheet has Delete`);
      for (const [name, button] of [["Delete", deleteOf(page)], ["✕", closeOf(page)]] as const) {
        const box = await button.boundingBox();
        assert.ok(box !== null && box.width >= 44 && box.height >= 44, `${device}: the edit sheet's ${name} is at least 44 × 44 px (${JSON.stringify(box)})`);
      }
      // a saved comment opened on a touch screen: the sheet takes the focus, not its field, so no keyboard rises (`popoverFocusesField`)
      await eventually(`${device}: the edit sheet to hold the focus`, () => focusedMatches(page, ".modal.comment-popover.is-sheet"));
      assert.equal(await focusedMatches(page, ".comment-editor-field"), false, `${device}: not its field`);
      await closeOf(page).tap();
      await sheet.waitFor({ state: "detached" });
      await assertAddIdle("after the edit sheet's ✕");
      console.log(`PASS code-touch (${device}): a tap on the scrim closes the empty sheet and keeps one with text typed; Save stores it and its card shows under line 4; the card tapped opens the sheet with Delete and ✕ at 44 px or more, the sheet focused and not its field`);

      // a press of 150 ms opens nothing
      const at6 = await rowPoint(lineOf(viewer, 6));
      let started = Date.now();
      await finger("touchStart", at6);
      await holdUntil(started + LONG_PRESS_MS / 2);
      await finger("touchEnd");
      await holdUntil(started + HOLD_MS);
      await frames(page);
      assert.equal(await popoverOf(page).count(), 0, `${device}: a press of 150 ms opens nothing`);
      assert.deepEqual(await pressedIn(viewer), [], `${device}: and leaves no line pressed`);

      // a long press no click follows (a context menu took it, or nothing came) swallows no later click: not after a
      // touch's press, nor after a short while (a keyboard's click, which no press comes before)
      const touchOn = (n: number, type: "pointerdown" | "pointerup"): Promise<void> => lineOf(viewer, n).evaluate((line, kind) => {
        const row = line.getClientRects()[0]!;
        line.dispatchEvent(new PointerEvent(kind, { bubbles: true, cancelable: true, composed: true, pointerType: "touch", pointerId: 9, isPrimary: true, clientX: row.left + 8, clientY: row.top + row.height / 2 }));
      }, type);
      const openedWithoutClick = async (): Promise<void> => {
        const down = Date.now();
        await touchOn(6, "pointerdown");
        // past the 300 ms that arm it; the lift opens it
        await holdUntil(down + HOLD_MS);
        assert.equal(await sheet.count(), 0, `${device}: an armed press opens nothing before its lift`);
        await touchOn(6, "pointerup");
        await sheet.waitFor({ timeout: 1000 });
        await fieldFocused(page);
        await page.keyboard.press("Escape");
        await sheet.waitFor({ state: "detached" });
      };
      await openedWithoutClick();
      await toggle.tap();
      assert.equal(await toggle.getAttribute("aria-pressed"), "false", `${device}: a tap after a long press no click followed is not swallowed`);
      await toggle.tap();
      await openedWithoutClick();
      // past the moment a lift's click would have come (CLICK_AFTER_LIFT_MS, 500 ms, in CodeCommentTouch.tsx)
      await holdUntil(Date.now() + 600);
      await toggle.focus();
      await page.keyboard.press("Enter");
      assert.equal(await toggle.getAttribute("aria-pressed"), "false", `${device}: a keyboard's click after a long press no click followed is not swallowed`);
      await toggle.tap();
      assert.equal(await toggle.getAttribute("aria-pressed"), "true");
      console.log(`PASS code-touch (${device}): a press of 150 ms opens nothing; a long press no click follows swallows neither the next tap nor, a moment later, a keyboard's click`);

      // a file taller than the view: a touch that moves 30 px (a scroll of the body), or the body scrolled under a
      // resting finger, before 300 ms opens nothing and leaves no line pressed
      await viewer.getByRole("button", { name: "Close file", exact: true }).tap();
      await viewer.waitFor({ state: "detached" });
      await page.getByRole("button", { name: "big.txt", exact: true }).tap();
      const big = page.getByRole("dialog", { name: "big.txt", exact: true });
      await lineOf(big, 40).waitFor();
      const bigBody = big.locator(".file-viewer-body");
      const at20 = await rowPoint(lineOf(big, 20));
      started = Date.now();
      await finger("touchStart", at20);
      for (const dy of [10, 20, 30]) await finger("touchMove", { x: at20.x, y: at20.y - dy });
      await eventually(`${device}: a move of 30 px leaves no line pressed`, async () => (await pressedIn(big)).length === 0, 1000);
      await holdUntil(started + HOLD_MS);
      await finger("touchEnd");
      await frames(page);
      assert.equal(await popoverOf(page).count(), 0, `${device}: a touch that moves 30 px opens nothing`);
      const at24 = await rowPoint(lineOf(big, 24));
      started = Date.now();
      await finger("touchStart", at24);
      await eventually(`${device}: line 24 pressed`, async () => (await pressedIn(big)).includes("24"), 1000);
      await bigBody.evaluate((node) => { node.scrollTop += 30; });
      await eventually(`${device}: the scroll leaves no line pressed`, async () => (await pressedIn(big)).length === 0, 1000);
      await holdUntil(started + HOLD_MS);
      await finger("touchEnd");
      await frames(page);
      assert.equal(await popoverOf(page).count(), 0, `${device}: a scroll under a resting finger opens nothing`);
      assert.equal((await tintIn(big, 24)).shown, false, `${device}: and leaves no tint`);
      // armed (held past 300 ms), then moved 30 px: the lift opens nothing
      const at28 = await rowPoint(lineOf(big, 28));
      started = Date.now();
      await finger("touchStart", at28);
      await holdUntil(started + HOLD_MS);
      assert.deepEqual(await pressedIn(big), ["28"], `${device}: line 28 is armed`);
      for (const dy of [10, 20, 30]) await finger("touchMove", { x: at28.x, y: at28.y - dy });
      await eventually(`${device}: a move after arming leaves no line pressed`, async () => (await pressedIn(big)).length === 0, 1000);
      await finger("touchEnd");
      await frames(page, 10);
      assert.equal(await popoverOf(page).count(), 0, `${device}: a move of 30 px after arming opens nothing on the lift`);
      assert.equal((await tintIn(big, 28)).shown, false, `${device}: and leaves no tint`);
      await big.getByRole("button", { name: "Close file", exact: true }).tap();
      await big.waitFor({ state: "detached" });
      console.log(`PASS code-touch (${device}): a touch that moves 30 px, or a scroll of the body under it, before 300 ms opens nothing and leaves no line pressed; nor does a move of 30 px after it armed`);

      // Settings → On mobile, write comments in → Below the line: a long press opens the field under the line, its text
      // 16 px, the line keeping its band
      viewer = await openSync(page, true);
      toggle = viewer.locator("button.file-viewer-comments");
      await chooseSetting("Below the line");
      const row6 = rowOf(viewer, 6).locator(".comment-popover.is-row");
      await longPress(6);
      await row6.waitFor({ timeout: 1000 });
      assert.equal(await sheet.count(), 0, `${device}: no sheet`);
      await fieldFocused(page);
      assert.equal(await fieldOf(page, true).getAttribute("placeholder"), "Write a comment…");
      assert.equal(await fieldOf(page, true).evaluate((field) => getComputedStyle(field).fontSize), "16px", `${device}: the field's text is 16 px`);
      // the card is the input box: its field is bare, with no border or ground of its own (the sheet's input look must not leak into the row)
      assert.deepEqual(await fieldOf(page, true).evaluate((field) => { const style = getComputedStyle(field); return [style.borderTopWidth, style.backgroundColor]; }), ["0px", "rgba(0, 0, 0, 0)"], `${device}: the row's field has no border of its own`);
      await assertRowUnder(viewer, 6, `${device}: the field`);
      assert.deepEqual(await tintIn(viewer, 6, true), { shown: true, onLine: true }, `${device}: line 6 keeps its band while its field is open`);
      await assertAddIdle("beside a finger's row");
      // the row held (text typed keeps it), a finger's press on another line: its tint waits the fill's 80 ms like any
      // other, and the held band stays where it is
      await fieldOf(page, true).fill("Typed");
      const other = await pressAt(8, "pointercancel");
      assert.equal(other.tintAtOnce, "0", `${device}: with a row held, a press on another line shows no band before 80 ms`);
      assert.equal(await row6.count(), 1, `${device}: the row with text typed stays`);
      assert.deepEqual(await tintIn(viewer, 6, true), { shown: true, onLine: true }, `${device}: and its line keeps its band`);
      await fieldOf(page, true).fill("");
      await escapePopover(page);
      await assertAddIdle("after a finger's row closed");
      // → On mobile, comment with → Tap: a tap opens the field at once
      await chooseSetting("Tap");
      await toggle.tap();
      await assertHint("Comment mode off", false);
      await toggle.tap();
      await assertHint("Tap a line to comment", false);
      let tapAt = await rowPoint(lineOf(viewer, 6));
      await page.touchscreen.tap(tapAt.x, tapAt.y);
      await row6.waitFor({ timeout: 1000 });
      await fieldFocused(page);
      // Save, once something is typed: the focus goes to the new card, never the ⊕
      await fieldOf(page, true).fill("Row note");
      await row6.getByRole("button", { name: "Save comment", exact: true }).tap();
      await row6.waitFor({ state: "detached" });
      await assertAddIdle("after a finger's row saved");
      const card6 = rowOf(viewer, 6).locator(".code-comment-card");
      await eventually(`${device}: line 6's card`, async () => (await card6.count()) === 1);
      await card6.locator(".code-comment-text").tap();
      await row6.waitFor({ timeout: 1000 });
      await assertAddIdle("beside a finger's edit row");
      await escapePopover(page);
      await assertAddIdle("after a finger's edit row closed");
      // the note goes again, so what follows sees the file as it was
      await card6.locator(".code-comment-text").tap();
      await row6.waitFor({ timeout: 1000 });
      await deleteOf(page).tap();
      await eventually(`${device}: line 6's card deleted`, async () => (await card6.count()) === 0);
      await assertAddIdle("after a finger's Delete");
      // → Bottom sheet: a tap opens the sheet at once
      await chooseSetting("Bottom sheet");
      tapAt = await rowPoint(lineOf(viewer, 6));
      await page.touchscreen.tap(tapAt.x, tapAt.y);
      await sheet.waitFor({ timeout: 1000 });
      assert.equal(await sheet.getAttribute("aria-label"), "Comment on line 6");
      await fieldFocused(page);
      await closeOf(page).tap();
      await sheet.waitFor({ state: "detached" });
      await assertAddIdle("after the sheet's ✕");
      // an iPad's trackpad shows the ⊕ on a hovered line; a finger's tap on it opens that line as a tap on the line does
      // (the sheet), not as a mouse's (a row)
      const hoverAt = await rowPoint(lineOf(viewer, 8));
      await page.mouse.move(hoverAt.x, hoverAt.y);
      await page.mouse.move(hoverAt.x + 4, hoverAt.y);
      const shownAdd = viewer.locator("button.code-comment-add:not(.is-idle)");
      await shownAdd.waitFor({ timeout: 1000 });
      const addBox = (await shownAdd.boundingBox())!;
      await page.touchscreen.tap(addBox.x + addBox.width / 2, addBox.y + addBox.height / 2);
      await sheet.waitFor({ timeout: 1000 });
      assert.equal(await sheet.getAttribute("aria-label"), "Comment on line 8", `${device}: a finger's tap on the ⊕ opens its line's sheet`);
      assert.equal(await viewer.locator(".comment-popover.is-row").count(), 0, `${device}: not a mouse's row`);
      await closeOf(page).tap();
      await sheet.waitFor({ state: "detached" });
      // the trackpad's pointer off the code again
      await page.mouse.move(1, 1);
      console.log(`PASS code-touch (${device}): no ⊕ beside a finger's row or after a finger's field closed (Save, Escape, ✕, row and sheet), and a finger's tap on a ⊕ a trackpad showed opens its line's sheet`);
      console.log(`PASS code-touch (${device}): with Below the line a long press opens the field under the line (16 px text, the line keeping its band), and a press on another line still waits 80 ms for its band; with Tap a tap opens it at once (the hint "Tap a line to comment"), in the sheet with Bottom sheet`);

      if (device === "phone") {
        // the mode off: Copy file copies the whole file; when nothing can copy it selects the source
        await toggle.tap();
        assert.equal(await toggle.getAttribute("aria-pressed"), "false");
        const copyButton = viewer.getByRole("button", { name: /^(Copy file|File copied)$/ });
        await page.evaluate(() => {
          const target = window as unknown as { copiedText: string | null };
          target.copiedText = null;
          Object.defineProperty(navigator, "clipboard", { value: { writeText: (value: string) => { target.copiedText = value; return Promise.resolve(); } }, configurable: true });
        });
        await copyButton.tap();
        await eventually("Copy file to copy the file", () => page.evaluate((whole) => (window as unknown as { copiedText: string | null }).copiedText === whole, `${SYNC_LINES.join("\n")}\n`));
        await page.evaluate(() => {
          Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("no clipboard")) }, configurable: true });
          document.execCommand = () => false;
        });
        await copyButton.tap();
        await eventually("Copy file to select the source", () => page.evaluate((whole) => window.getSelection()?.toString() === whole, SYNC_LINES.join("\n")));
        await page.evaluate(() => window.getSelection()?.removeAllRanges());
        assert.equal(await popoverOf(page).count(), 0, "Copy file opens no comment");
        // a viewer without a pane (as the app opens a file with no pane selected, App.tsx `viewFile`) takes no comments:
        // no toggle, and a tap on a line opens nothing, whatever the mode
        await toggle.tap();
        await page.evaluate((path) => history.replaceState({ ...history.state, "herdr-web-ui:file-preview": { path, paneId: null, machineId: "local" } }, ""), join(root, "src", "sync.ts"));
        await page.reload();
        const paneless = page.getByRole("dialog", { name: "sync.ts", exact: true });
        await paneless.locator(`.file-viewer-text .hl-line:nth-of-type(${SYNC_LINES.length})`).waitFor();
        assert.equal(await paneless.locator("button.file-viewer-comments").count(), 0, "no toggle without a pane");
        const lone = await pointOn(paneless.locator(".file-viewer-text .hl-line:nth-of-type(3)"));
        await page.touchscreen.tap(lone.x, lone.y);
        await frames(page);
        assert.equal(await popoverOf(page).count(), 0, "a tap on a line of a viewer without a pane opens nothing");
        console.log("PASS code-touch (phone): with the mode off Copy file copies the whole file, and selects the source when nothing can copy; a viewer without a pane has no toggle, and a tap on a line opens nothing");
      }
      assert.deepEqual(errors, []);
      await close();
    }

    // the composer's walk on a phone with the mode on opens the comment as a finger does: its bottom sheet (a walk has no
    // pointer event; the screen's coarse pointer says so), and the viewer scrolls the card into place beneath it
    const { page, errors, close } = await open(IPHONE_14_PRO, [
      seededComment("seed-walk-8", realpathSync(join(root, "src", "sync.ts")), "src/sync.ts", "code", SYNC_LINES, 8, 8, "Compare with <=.", 1),
    ]);
    await page.evaluate(() => localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en", codeCommentMode: true })));
    await page.reload();
    await page.locator(".conn-live").waitFor();
    const walk = walkOf(page);
    await walk.waitFor();
    await walk.tap();
    const viewer = page.getByRole("dialog", { name: "sync.ts", exact: true });
    await lineOf(viewer, SYNC_LINES.length).waitFor();
    const sheet = page.locator(".modal-scrim > .modal.comment-popover.is-sheet");
    await sheet.waitFor({ timeout: 2000 });
    assert.equal(await sheet.getAttribute("aria-label"), "Comment on line 8");
    // the quote is the viewer's line: the same token colours (a clone of its spans) and its number in the gutter's colour
    const colours = async (root: Locator, selector: string): Promise<string> => root.locator(selector).first().evaluate((node) => getComputedStyle(node).color);
    assert.equal(await colours(sheet, ".comment-popover-code .hl-keyword"), await colours(viewer, `.hl-line[data-source-line="8"] .hl-keyword`), "the quote's keyword is coloured as the code view's");
    // (line 8 is commented, so its own gutter number is in the accent: the quote's is the plain gutter colour, --line-number)
    assert.equal(await sheet.locator(".comment-popover-code-number").evaluate((node) => {
      const probe = document.createElement("span");
      probe.style.color = "var(--line-number)";
      document.body.append(probe);
      const wanted = getComputedStyle(probe).color;
      probe.remove();
      return [getComputedStyle(node).color, getComputedStyle(node).fontWeight].join("|") === `${wanted}|400` ? "gutter" : "other";
    }), "gutter", "its number is the gutter's: --line-number, regular weight");
    assert.equal(await popoverText(page, true), "Compare with <=.");
    // as a card tapped to edit: the sheet has the focus, not its field (no keyboard)
    assert.equal(await focusedMatches(page, ".comment-editor-field"), false, "the field does not take the focus");
    assert.equal(await viewer.locator(".comment-popover.is-row").count(), 0, "no row under the line");
    console.log("PASS code-touch (phone): the composer's walk to a code comment with the mode on opens its bottom sheet, as a finger's tap on the card does");
    assert.deepEqual(errors, []);
    await close();
  },

  /** The Markdown preview: a mouse's drag names the source lines it came from, its pin where it let go; and on a phone, a long press (nothing) and a tap. */
  async preview(open) {
    const { page, errors, close } = await open(DESKTOP);
    const viewer = await openSpec(page);
    const body = viewer.locator(".file-viewer-body");
    assert.equal(await viewer.locator(".file-viewer-body[data-comment-surface]").count(), 1, "the preview is a comment surface");

    // 1. a drag across the table's rows 42–43: the popover at once, then the pin where it let go
    const release = await dragText(page, viewer, previewLine(viewer, 42), "Older revision", previewLine(viewer, 43), "merged note");
    await besidePinIn(body).waitFor();
    await assertNoButton(page, "a drag over the preview's table rows");
    assert.equal(await popoverReference(page), "spec.md · Lines 42–43");
    await saveTyped(page, "Also return the stored revision.");
    await eventually("its pin", async () => (await pinsIn(body).count()) === 1);
    await assertTipAt(viewer, pinsIn(body), release, "the rows' comment");
    await eventually("the rows' text to be highlighted", async () => (await highlighted(page)) > 0);
    // the quote reads the rows' cells, set off by " | ", with no separator at a row's start
    assert.deepEqual(await storedFileComments(page), [{
      lines: [42, 43],
      quoteLines: ["Older revision | 409 Conflict with the stored note", "Newer revision | 200 with the merged note"],
      view: "preview",
      selected: true,
    }]);
    console.log("PASS preview: a selection over the table's rows names spec.md · Lines 42–43; saved, its pin sits where the drag let go");

    // 2. inside the paragraph's second line: that source line alone
    await dragText(page, viewer, previewLine(viewer, 4), "revision it stores", previewLine(viewer, 4), "revision it stores");
    await besidePinIn(body).waitFor();
    assert.equal(await popoverReference(page), "spec.md · Line 4");
    await fieldFocused(page);
    await escapePopover(page);
    console.log("PASS preview: a selection in the paragraph's second line names Line 4");

    // 3. a word of the fenced block: the fence's line + 1 + its index
    await dragText(page, viewer, previewLine(viewer, 50), "retries", previewLine(viewer, 50), "retries");
    await besidePinIn(body).waitFor();
    assert.equal(await popoverReference(page), "spec.md · Line 50");
    await fieldFocused(page);
    await escapePopover(page);
    console.log("PASS preview: a word in the fenced block names Line 50, the fence's line + 1");

    // a list item's continuation line: the item's lines
    await dragText(page, viewer, previewLine(viewer, 45), "stored revision", previewLine(viewer, 45), "stored revision");
    await besidePinIn(body).waitFor();
    assert.equal(await popoverReference(page), "spec.md · Lines 45–46");
    await fieldFocused(page);
    await escapePopover(page);
    console.log("PASS preview: a selection in a list item's continuation names the item's Lines 45–46");

    // a comment shows only in the view it was written in
    const showSource = viewer.getByRole("button", { name: "Show source", exact: true });
    await showSource.click();
    await lineOf(viewer, 42).waitFor();
    await eventually("no pin in the code", async () => (await pinsIn(body).count()) === 0);
    await showSource.click();
    await eventually("the pin back in the preview", async () => (await pinsIn(body).count()) === 1);
    console.log("PASS preview: the preview's comment has its pin in the preview only");
    assert.deepEqual(errors, []);
    await close();

    // a phone: a long press selects a word of the paragraph, and opens nothing: there is no Comment button.
    // Headless Chromium selects nothing on a long press (neither a synthesized tap gesture held for a
    // second nor raw touch events do), so the word is selected as a long press leaves it, and its
    // gesture ends with a touch's pointerup (`selectText` on a coarse pointer)
    const phone = await open(PHONE);
    const phoneViewer = await openSpec(phone.page, true);
    await previewLine(phoneViewer, 3).evaluate((line) => line.scrollIntoView({ block: "center" }));
    await selectText(previewLine(phoneViewer, 3), "revision", previewLine(phoneViewer, 3), "revision");
    assert.equal(await phone.page.evaluate(() => window.getSelection()?.toString()), "revision");
    await frames(phone.page, 10);
    assert.equal(await popoverOf(phone.page).count(), 0, "a touch selection opens nothing");
    await assertNoButton(phone.page, "a touch selection in the preview");
    await phone.page.evaluate(() => window.getSelection()?.removeAllRanges());
    // a tap on the paragraph is the way: its sheet, on all of its lines
    const at3 = await pointOn(previewLine(phoneViewer, 3));
    await phone.page.touchscreen.tap(at3.x, at3.y);
    await dialogOf(phone.page).waitFor();
    assert.equal(await popoverReference(phone.page), "spec.md · Lines 3–4");
    console.log("PASS preview: on a phone a word selected by touch opens nothing and shows no Comment button; a tap on its paragraph opens the sheet for Lines 3–4");
    assert.deepEqual(phone.errors, []);
    await phone.close();
  },

  /**
   * A click in the preview comments on the element under it: a paragraph whole, by its source lines; a table row; a
   * list item. And the composer's walk reaches a comment a folded code block hides, by unfolding the block (the preview's
   * header has no comment button).
   */
  async "preview-click"(open) {
    const specPath = realpathSync(join(root, "docs", "spec.md"));
    const folded = "seed-spec-folded";
    // a comment on the blank line 2: placed (its line still reads the same), but the preview draws no element for it
    const blank = "seed-spec-blank";
    const { page, errors, close } = await open(DESKTOP, [
      seededComment(folded, specPath, "docs/spec.md", "preview", SPEC_LINES, FOLDED_LINE, FOLDED_LINE, "Fold note", 1),
      seededComment(blank, specPath, "docs/spec.md", "preview", SPEC_LINES, 2, 2, "Blank note", 2),
    ]);
    let viewer = await openSpec(page);

    // the walk to a comment in the folded block's hidden lines: the block unfolds, its pin opens
    let more = viewer.locator(".markdown-code-more");
    assert.equal(await more.getAttribute("aria-expanded"), "false", "the long block opens folded");
    assert.equal(await more.getAttribute("data-fold-end"), String(FOLD_FIRST + 34), "its Show all names its last line");
    assert.equal(await previewLine(viewer, FOLDED_LINE).count(), 0, "the comment's line is folded away");
    assert.equal(await pinsIn(viewer.locator(".file-viewer-body")).count(), 0, "a comment on a folded line has no pin");
    assert.equal(await viewer.locator("button.file-viewer-comments").count(), 0, "the preview's header has no comment button");
    await viewer.getByRole("button", { name: "Close file", exact: true }).click();
    await viewer.waitFor({ state: "detached" });
    const walk = walkOf(page);
    assert.equal(await walk.getAttribute("aria-label"), "2 comments");
    // the first stop, line 2, has no pin: once the walk has waited for one, it opens in the dialog
    await walk.click();
    viewer = page.getByRole("dialog", { name: "spec.md", exact: true });
    const body = viewer.locator(".file-viewer-body");
    const dialog = dialogOf(page);
    await dialog.waitFor();
    assert.equal(await popoverText(page), "Blank note", "the dialog opens the comment in its field");
    assert.equal(await referenceText(dialog.locator(".comment-file-reference")), "spec.md · Line 2");
    assert.equal(await dialog.locator(".comment-popover-note").count(), 0, "with no note: it is not outdated");
    assert.equal(await body.locator(`.comment-pin[data-comment-id="${blank}"]`).count(), 0, "it has no pin");
    await fieldFocused(page);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    assert.ok(await viewer.isVisible(), "Escape closes the dialog, not the viewer");
    console.log("PASS preview-click: a stop of the composer's walk whose pin is never drawn (a blank line of the preview) opens the comment in the dialog; Escape closes only it");
    // the next stop: line 80, in the folded block
    await viewer.getByRole("button", { name: "Close file", exact: true }).click();
    await viewer.waitFor({ state: "detached" });
    await walk.click();
    await viewer.locator(".file-viewer-markdown").waitFor();
    more = viewer.locator(".markdown-code-more");
    await eventually("the block to unfold", async () => (await more.getAttribute("aria-expanded")) === "true");
    await eventually("the walk to open the folded comment", async () => (await popoverText(page)) === "Fold note");
    assert.equal(await popoverReference(page), `spec.md · Line ${FOLDED_LINE}`);
    const foldedPin = `.comment-pin[data-comment-id="${folded}"]`;
    assert.ok(await body.locator(foldedPin).evaluate((pin) => pin.classList.contains("is-current")), "the walk marks its pin");
    await assertPinAtLineEnd(body, foldedPin, `.hl-line[data-source-line="${FOLDED_LINE}"]`, "the folded comment");
    await eventually("its pin to be scrolled into view", () => inBody(viewer, foldedPin));
    await eventually("its text to take the current highlight", async () => (await highlighted(page, "block-comment-current")) > 0);
    await fieldFocused(page);
    await escapePopover(page);
    console.log("PASS preview-click: the composer's walk unfolds the code block that hides a comment's line, opens its pin's popover in its field and marks the pin");

    // a click on a paragraph: all of its source lines, whole
    const p3 = await pointOn(previewLine(viewer, 3));
    await page.mouse.move(p3.x, p3.y);
    // the frame is a tint and two box shadows (FileViewer.css), not an outline
    await eventually("the hovered paragraph to be framed", () => previewLine(viewer, 3).evaluate((line) => getComputedStyle(line.closest("p")!).boxShadow !== "none"));
    const clicked3 = await clickAt(page, viewer, p3);
    await besidePinIn(body).waitFor();
    await pendingPinIn(body).waitFor();
    assert.equal(await popoverReference(page), "spec.md · Lines 3–4");
    await assertTipAt(viewer, pendingPinIn(body), clicked3, "the provisional pin of a clicked paragraph");
    await assertBesideRight(body, pendingPinIn(body), "a clicked paragraph's new comment");
    assert.equal(await popoverOf(page).locator(".comment-popover-quote").count(), 0, "beside its pin the popover quotes nothing");
    assert.equal((await highlightText(page)).replace(/\s+/g, " ").trim(), (`${SPEC_LINES[2]}\n${SPEC_LINES[3]}`).replace(/\s+/g, " ").trim(), "the quote is the paragraph's lines");
    await saveTyped(page, "Paragraph note");
    await eventually("its pin", async () => (await pinsIn(body).count()) === 2);
    await assertTipAt(viewer, body.locator('.comment-pin[aria-label$=": Paragraph note"]'), clicked3, "the paragraph's comment");
    const paragraph = (await storedFileComments(page)).find((comment) => comment.lines[0] === 3);
    assert.deepEqual(paragraph, { lines: [3, 4], quoteLines: [SPEC_LINES[2], SPEC_LINES[3]], view: "preview", selected: false }, "a comment on the paragraph's whole lines");
    console.log("PASS preview-click: a pointer over a paragraph frames it; a click opens a popover on its Lines 3–4, right of a provisional pin whose tip is where it was clicked; saved, its pin stays there");

    // a click on the paragraph again opens its comment to edit
    const again = await pointOn(previewLine(viewer, 4));
    await page.mouse.click(again.x, again.y);
    await eventually("the paragraph's comment to open", async () => (await popoverText(page)) === "Paragraph note");
    await fieldFocused(page);
    await escapePopover(page);

    // a table row is its own line; a list item its own lines
    const row = await pointOn(previewLine(viewer, 42));
    await page.mouse.click(row.x, row.y);
    await besidePinIn(body).waitFor();
    assert.equal(await popoverReference(page), "spec.md · Line 42");
    await fieldFocused(page);
    await escapePopover(page);
    const item = await pointOn(previewLine(viewer, 45));
    await page.mouse.click(item.x, item.y);
    await besidePinIn(body).waitFor();
    assert.equal(await popoverReference(page), "spec.md · Lines 45–46");
    await fieldFocused(page);
    await escapePopover(page);
    // a link or a code block's controls are no line: a click on Show less folds the block, and opens nothing
    await more.click();
    await eventually("the block to fold", async () => (await more.getAttribute("aria-expanded")) === "false");
    await frames(page);
    assert.equal(await popoverOf(page).count(), 0, "the fold button opens no comment");
    console.log("PASS preview-click: a click on the paragraph again opens its comment to edit; a table row names Line 42, a list item Lines 45–46; the fold button comments on nothing");
    assert.deepEqual(errors, []);
    await close();
  },

  /**
   * The viewer's header: the comment mode's toggle names the file's comments (their count, with any outdated) and walks
   * nothing; the comments follow their lines when the file changes (a card under the moved line, the store told) and one
   * whose lines changed is outdated (no card). It has no Write message button (Close is the way back to the message box),
   * and the Markdown preview has no comment toggle. The composer's bar walks the comments (`composer`).
   */
  async header(open) {
    const syncFile = join(root, "src", "sync.ts");
    const syncPath = realpathSync(syncFile);
    const specPath = realpathSync(join(root, "docs", "spec.md"));
    const page8 = "seed-line-8";
    const range = "seed-lines-7-9";
    const { page, errors, close } = await open(DESKTOP, [
      seededComment(page8, syncPath, "src/sync.ts", "code", SYNC_LINES, 8, 8, "Compare with <=.", 1),
      seededComment(range, syncPath, "src/sync.ts", "code", SYNC_LINES, 7, 9, "Range note", 2),
      seededComment("seed-spec-42-43", specPath, "docs/spec.md", "preview", SPEC_LINES, 42, 43, "Also return the stored revision.", 3,
        ["Older revision | 409 Conflict with the stored note", "Newer revision | 200 with the merged note"]),
    ]);
    const cardOf = (id: string): string => `.code-comment-card[data-comment-id="${id}"]`;
    const writeSync = (lines: readonly string[]): void => writeFileSync(syncFile, `${lines.join("\n")}\n`);
    try {
      // 1. two comments of the file: the toggle is named for them and badged 2; a press only turns the mode, it walks nothing
      let viewer = await openSync(page);
      let body = viewer.locator(".file-viewer-body");
      assert.equal(await viewer.locator(".file-viewer-meta").getAttribute("title"), syncPath, "the comments were seeded on the path the viewer resolves");
      let toggle = viewer.locator("button.file-viewer-comments");
      await toggle.waitFor();
      assert.equal(await toggle.getAttribute("aria-label"), "Comment mode, 2 comments");
      assert.equal(await toggle.locator(".file-viewer-comments-count").textContent(), "2", "the count is a badge on the icon");
      assert.equal(await toggle.innerText(), "2", "the button shows no words, only the badge's count");
      await eventually("both cards", async () => (await body.locator(".code-comment-card").count()) === 2);
      assert.equal(await toggle.getAttribute("aria-pressed"), "false", "the mode is off at first");
      await toggle.click();
      await eventually("the mode to turn on", async () => (await toggle.getAttribute("aria-pressed")) === "true");
      await frames(page);
      assert.equal(await viewer.locator(".comment-popover").count(), 0, "the toggle opens no comment");
      assert.equal(await viewer.locator(".code-comment-card.is-current").count(), 0, "and marks none");
      await toggle.click();
      await eventually("the mode to turn off", async () => (await toggle.getAttribute("aria-pressed")) === "false");
      console.log("PASS header: the toggle is named Comment mode, 2 comments with a badge of 2; a press turns the mode on and off and walks to no comment");

      // 2. two lines inserted above line 8: the comment on line 8 follows its line to line 10, and the store says so
      await viewer.getByRole("button", { name: "Close file", exact: true }).click();
      await viewer.waitFor({ state: "detached" });
      const moved = [...SYNC_LINES.slice(0, 7), "  // a revision is a counter", "  // that only grows", ...SYNC_LINES.slice(7)];
      writeSync(moved);
      viewer = await openSync(page);
      body = viewer.locator(".file-viewer-body");
      await lineOf(viewer, moved.length).waitFor();
      await eventually("the moved comment's card under line 10", async () => (await rowOf(viewer, 10).locator(cardOf(page8)).count()) === 1);
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
      toggle = viewer.locator("button.file-viewer-comments");
      assert.equal(await toggle.getAttribute("aria-label"), "Comment mode, 2 comments · 1 outdated");
      assert.deepEqual(await storedLines(range), [7, 9], "an outdated comment keeps its lines");
      assert.equal(await body.locator(cardOf(range)).count(), 0, "an outdated comment has no card");
      console.log("PASS header: after two lines were inserted above line 8, its card is under line 10 and it is stored as lines [10, 10]; the comment on lines 7–9 is outdated, with no card, and the toggle says so");

      // 3. no Write message: the header's comment group is the toggle alone
      assert.equal(await viewer.getByRole("button", { name: "Write message", exact: true }).count(), 0, "no Write message button");
      await viewer.getByRole("button", { name: "Close file", exact: true }).click();
      await viewer.waitFor({ state: "detached" });
      console.log("PASS header: the header has no Write message button");

      // 4. the Markdown preview takes no comment mode: its header has no toggle, the source's has
      const spec = await openSpec(page);
      assert.equal(await spec.locator("button.file-viewer-comments").count(), 0, "the preview shows no comment toggle");
      await spec.getByRole("button", { name: "Show source", exact: true }).click();
      await lineOf(spec, 42).waitFor();
      assert.equal(await spec.locator("button.file-viewer-comments").count(), 1, "its source shows one");
      console.log("PASS header: the Markdown preview shows no comment toggle, its source does");
      assert.deepEqual(errors, []);
    } finally {
      writeSync(SYNC_LINES);
      await close();
    }
  },

  /**
   * The composer's bar counts the file comments too, and its walk goes on from the chat's comments into the files: each
   * file stop opens the viewer at that comment, in the view it was written in. In the preview it opens the pin's popover;
   * in the code view it scrolls the comment's card into view and marks it current until the next click, with no field
   * open while the mode is off and the card's field open while it is on; an outdated comment opens in a dialog. After the
   * viewer closes, the next tap goes on after the comment it showed last. A send takes them all.
   */
  async composer(open) {
    const syncFile = join(root, "src", "sync.ts");
    const syncPath = realpathSync(syncFile);
    const specPath = realpathSync(join(root, "docs", "spec.md"));
    const line5 = "seed-sync-5";
    const line8 = "seed-sync-8";
    const line12 = "seed-sync-12";
    const table = "seed-spec-42-43";
    const tableQuote = ["Older revision | 409 Conflict with the stored note", "Newer revision | 200 with the merged note"];
    // the spec's comment was written first: its file's comments are sent first, the sync file's by line
    const { page, errors, sent, close } = await open(DESKTOP, [
      seededComment(line8, syncPath, "src/sync.ts", "code", SYNC_LINES, 8, 8, "Compare with <=.", 2),
      seededComment(table, specPath, "docs/spec.md", "preview", SPEC_LINES, 42, 43, "Also return the stored revision.", 1, tableQuote),
      seededComment(line12, syncPath, "src/sync.ts", "code", SYNC_LINES, 12, 12, "Return the merged note.", 3),
      seededComment(line5, syncPath, "src/sync.ts", "code", SYNC_LINES, 5, 5, "Say why a write is skipped.", 4),
    ]);
    // line 5 changes on disk before the viewer opens: that comment is outdated
    const writeSync = (lines: readonly string[]): void => writeFileSync(syncFile, `${lines.join("\n")}\n`);
    writeSync(SYNC_LINES.map((line, index) => index === 4 ? "/** Writes a note. */" : line));
    try {
      const chat = page.locator(".chat-view");
      const walk = walkOf(page);
      await walk.waitFor();
      assert.equal(await walk.getAttribute("aria-label"), "4 comments", "with file comments the bar counts comments, not comments on the reply");

      // the chat's comment, written as in the chat case: a reply comment's anchor is the chat's to make
      const paragraph = page.locator(".chat-view p.is-commentable", { hasText: REPLY });
      await dragText(page, null, paragraph, "every revision", paragraph, "in order");
      await saveTyped(page, "Say which order.");
      await eventually("the chat's pin", async () => (await pinsIn(chat).count()) === 1);
      await eventually("the bar to count 5 comments", async () => (await walk.getAttribute("aria-label")) === "5 comments");
      assert.equal(await walk.locator(".composer-comments-text").textContent(), "5 comments");
      console.log("PASS composer: with one comment on the reply and four on files, the bar reads 5 comments");

      /** Whether the viewer's popover reads `text` and the pin of `id` is marked current. */
      const openedInViewer = async (viewer: Locator, id: string, text: string): Promise<boolean> =>
        (await besidePinIn(viewer.locator(".file-viewer-body")).count()) === 1 && (await popoverText(page)) === text
        && await viewer.locator(`.comment-pin[data-comment-id="${id}"]`).evaluate((pin) => pin.classList.contains("is-current")).catch(() => false);

      // tap 1: the chat's pin
      await walk.click();
      await eventually("the walk to open the chat's comment", async () => (await besidePinIn(chat).count()) === 1 && (await popoverText(page)) === "Say which order.");
      assert.equal(await page.locator(".file-viewer").count(), 0, "the chat's stop opens no viewer");
      console.log("PASS composer: tap 1 opens the chat's comment by its pin");

      // tap 2: the viewer opens docs/spec.md in the preview, at its comment
      await walk.click();
      const spec = page.getByRole("dialog", { name: "spec.md", exact: true });
      await spec.locator(".file-viewer-markdown").waitFor();
      await eventually("the viewer to open the spec's comment", () => openedInViewer(spec, table, "Also return the stored revision."));
      assert.equal(await spec.getByRole("button", { name: "Show source", exact: true }).getAttribute("aria-pressed"), "false", "the preview shows");
      // the preview takes no comment mode: its header has no toggle to walk with
      assert.equal(await spec.locator("button.file-viewer-comments").count(), 0, "the viewer's header has no counter to walk");
      await spec.getByRole("button", { name: "Close file", exact: true }).click();
      await spec.waitFor({ state: "detached" });
      console.log("PASS composer: tap 2 opens docs/spec.md in the preview at its comment's popover");

      // tap 3: on after the comment the viewer showed last, to src/sync.ts in the code view: line 5 is outdated, so a dialog
      await walk.click();
      const sync = page.getByRole("dialog", { name: "sync.ts", exact: true });
      await lineOf(sync, SYNC_LINES.length).waitFor();
      const dialog = dialogOf(page);
      await dialog.waitFor();
      assert.equal(await referenceText(dialog.locator(".comment-file-reference")), "sync.ts · Line 5");
      assert.equal(await dialog.locator("pre.comment-popover-plain").textContent(), SYNC_LINES[4], "the quote is the line as it was");
      assert.equal(await dialog.locator(".comment-popover-note").textContent(), "This part of the file has changed since.");
      assert.equal(await popoverText(page), "Say why a write is skipped.", "the outdated comment's dialog opens it in its field");
      assert.equal(await closeOf(page).count(), 1, "the dialog keeps ✕");
      assert.equal(await deleteOf(page).count(), 1, "and Delete");
      assert.equal(await sync.locator(".code-comment-card").count(), 2, "the file's other two comments have their cards, this one has none");
      await fieldFocused(page);
      // Tab goes round the dialog's own controls, never out to the viewer under it
      const inDialog = (): Promise<boolean> => page.evaluate(() => document.querySelector(".modal.comment-popover")?.contains(document.activeElement) ?? false);
      for (let tab = 0; tab < 3; tab++) {
        await page.keyboard.press("Tab");
        assert.ok(await inDialog(), `Tab ${tab + 1} keeps the focus in the dialog`);
      }
      await page.keyboard.press("Shift+Tab");
      assert.ok(await inDialog(), "Shift+Tab keeps the focus in the dialog");
      // Settings opened by its shortcut over the dialog lies above it, and the question it asks above Settings
      /** What is drawn at the middle of the screen: inside which of these. */
      const topmost = (): Promise<string | null> => page.evaluate(() => {
        const hit = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
        return hit?.closest(".confirm-dialog") ? "confirm" : hit?.closest(".settings-dialog") ? "settings" : hit?.closest(".comment-popover") ? "comment" : hit?.closest(".file-viewer") ? "viewer" : hit?.className ?? null;
      });
      await page.keyboard.press("ControlOrMeta+Shift+Comma");
      await page.locator(".settings-dialog").waitFor();
      await eventually("Settings to be topmost", async () => (await topmost()) === "settings");
      await openSettingsPage(page, "Chat");
      const commentsSwitch = page.locator(".settings-dialog").getByRole("switch", { name: "Comments", exact: true });
      await commentsSwitch.click();
      const confirm = page.getByRole("alertdialog");
      await confirm.waitFor();
      await eventually("its question to be topmost", async () => (await topmost()) === "confirm");
      await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
      await confirm.waitFor({ state: "detached" });
      await page.keyboard.press("Escape");
      await page.locator(".settings-dialog").waitFor({ state: "detached" });
      assert.equal(await dialog.count(), 1, "the comment's dialog stays under Settings, and Escape closes Settings alone");
      await eventually("the dialog to be topmost again", async () => (await topmost()) === "comment");
      await eventually("the focus back in the dialog", inDialog);
      // the field edited: Escape with text typed keeps the dialog and the viewer, Ctrl+Enter saves the edit
      await fieldOf(page).fill("Say why a write is skipped, exactly.");
      await page.keyboard.press("Escape");
      await frames(page);
      assert.equal(await dialog.count(), 1, "Escape with text typed leaves the dialog");
      assert.ok(await sync.isVisible(), "and the viewer");
      await page.keyboard.press("Control+Enter");
      await dialog.waitFor({ state: "detached" });
      await eventually("the edit to be stored", async () => (await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("herdr-web-ui:block-comments:")).map((key) => localStorage.getItem(key)).join(""))).includes("Say why a write is skipped, exactly."));
      assert.ok(await sync.isVisible(), "the viewer stays");
      await sync.getByRole("button", { name: "Close file", exact: true }).click();
      await sync.waitFor({ state: "detached" });
      console.log("PASS composer: tap 3 opens src/sync.ts with the outdated comment on line 5 in a dialog (its reference, the old quote, the note, ✕ and Delete); Tab stays in it, Settings and its question lie above it, Escape with text typed keeps it, Ctrl+Enter saves the edit");

      // tap 4: on after the edited comment, line 8, the mode off: its card is scrolled into view and marked current, with no field open
      await walk.click();
      await lineOf(sync, SYNC_LINES.length).waitFor();
      const card8 = rowOf(sync, 8).locator(`.code-comment-card[data-comment-id="${line8}"]`);
      await eventually("line 8's card to be current", async () => (await card8.count()) === 1 && await card8.evaluate((card) => card.classList.contains("is-current")));
      await eventually("the card in view", () => inBody(sync, `.code-comment-card[data-comment-id="${line8}"]`));
      await frames(page);
      assert.equal(await sync.locator(".comment-popover").count(), 0, "the mode off, the stop opens no field");
      assert.equal(await sync.locator("button.file-viewer-comments").getAttribute("aria-pressed"), "false", "the mode is off");
      assert.equal(await sync.locator(".code-comment-card.is-current").count(), 1, "the walk stands on one card");
      // until the next click
      await sync.locator(".file-viewer-title").click();
      await eventually("the mark to go with the click", async () => (await sync.locator(".code-comment-card.is-current").count()) === 0);
      // the mode on for the next stop
      await sync.locator("button.file-viewer-comments").click();
      await eventually("the mode to turn on", async () => (await sync.locator("button.file-viewer-comments").getAttribute("aria-pressed")) === "true");
      await sync.getByRole("button", { name: "Close file", exact: true }).click();
      await sync.waitFor({ state: "detached" });
      console.log("PASS composer: tap 4 opens src/sync.ts at line 8's card with the mode off: scrolled into view, marked current until the next click, no field open");

      // tap 5: line 12, the mode on: the card's field opens in place of the card, filled and focused
      await walk.click();
      await lineOf(sync, SYNC_LINES.length).waitFor();
      const row12 = rowOf(sync, 12).locator(".comment-popover.is-row");
      await row12.waitFor();
      await fieldFocused(page);
      assert.equal(await fieldOf(page, true).inputValue(), "Return the merged note.");
      assert.equal(await rowOf(sync, 12).locator(".code-comment-card").count(), 0, "the field takes the card's place");
      await eventually("the field in view", () => inBody(sync, ".code-comment-row .comment-popover"));
      await escapePopover(page);
      await sync.getByRole("button", { name: "Close file", exact: true }).click();
      await sync.waitFor({ state: "detached" });
      console.log("PASS composer: tap 5 opens src/sync.ts at line 12 with the mode on: the card's field opens in its place, filled, focused and in view");

      // the walk wraps round (the chat's pin, the spec's pin) to the outdated comment on line 5 again: its dialog is open, the
      // comment deleted in another tab: the dialog closes, and the viewer stays
      await walk.click();
      await eventually("the walk to wrap to the chat's comment", async () => (await besidePinIn(chat).count()) === 1 && (await popoverText(page)) === "Say which order.");
      await walk.click();
      await spec.locator(".file-viewer-markdown").waitFor();
      await eventually("the viewer to open the spec's comment again", () => openedInViewer(spec, table, "Also return the stored revision."));
      await spec.getByRole("button", { name: "Close file", exact: true }).click();
      await spec.waitFor({ state: "detached" });
      await walk.click();
      await lineOf(sync, SYNC_LINES.length).waitFor();
      await dialog.waitFor();
      assert.equal(await popoverText(page), "Say why a write is skipped, exactly.", "the outdated comment's dialog opens again");
      const other = await page.context().newPage();
      await other.goto(page.url());
      await other.evaluate(() => {
        for (const key of Object.keys(localStorage).filter((name) => name.startsWith("herdr-web-ui:block-comments:"))) {
          const data = JSON.parse(localStorage.getItem(key)!) as { comments: { comment: string }[] };
          localStorage.setItem(key, JSON.stringify({ ...data, comments: data.comments.filter((comment) => !comment.comment.startsWith("Say why a write is skipped")) }));
        }
      });
      await dialog.waitFor({ state: "detached" });
      await other.close();
      assert.ok(await sync.isVisible(), "the viewer stays");
      await eventually("the bar to count 4 comments", async () => (await walk.getAttribute("aria-label")) === "4 comments");
      await sync.getByRole("button", { name: "Close file", exact: true }).click();
      await sync.waitFor({ state: "detached" });
      console.log("PASS composer: the dialog of the outdated comment, opened again by the wrapped walk, closes when another tab deletes that comment; the viewer stays and the bar counts 4");

      // a send takes every comment: the reply's first, then the files' in the order they were first commented, then the text
      const expected = [
        "> every revision in order\nSay which order.",
        `> docs/spec.md:42-43\n${tableQuote.map((line) => `> ${line}`).join("\n")}\nAlso return the stored revision.`,
        `> src/sync.ts:8\n> ${SYNC_LINES[7]}\nCompare with <=.`,
        `> src/sync.ts:12\n> ${SYNC_LINES[11]}\nReturn the merged note.`,
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
      console.log("PASS composer: Send sends the reply's comment, then docs/spec.md's, then src/sync.ts's by line, then Thanks; the store is empty after");
      assert.deepEqual(errors, []);
    } finally {
      writeSync(SYNC_LINES);
      await close();
    }
  },

  /**
   * The comment's sheet on a phone. iOS raises the keyboard only for a focus inside the tap's own event: the field
   * must have the focus before the tap's task ends (checked here with only microtasks run after it, no frame). The
   * keyboard then shrinks the view from below (simulated by a shorter viewport): the sheet stays in it. Send in the
   * message box while a comment is half written sends nothing and gives that comment's field the focus.
   */
  async "form-phone"(open) {
    const { page, errors, sent, close } = await open(PHONE);
    /** The sheet's field: in the page (the chat's), or in its frame (the code view's), the focus followed into it. */
    const sheetField = ".modal.comment-popover textarea, body.comment-frame.is-sheet > textarea";
    /**
     * Shrinks the page as a phone's keyboard does, waits for `view` to follow, and for the sheet and its field (its frame,
     * the code view's) to stay on screen; `keyboard`: and for the page to say the keyboard is up (lib/viewport.ts).
     */
    const keyboardUp = async (view: Locator, keyboard = false): Promise<void> => {
      const before = await view.evaluate((node) => node.clientHeight);
      await page.setViewportSize({ width: PHONE.viewport!.width, height: PHONE.viewport!.height - 300 });
      await eventually("the view to shrink", async () => (await view.evaluate((node) => node.clientHeight)) < before);
      await eventually("the sheet and its field to be on the shrunk screen", () => page.evaluate(() => {
        const sheet = document.querySelector(".modal.comment-popover");
        const field = sheet?.querySelector("iframe.comment-frame") ?? sheet?.querySelector("textarea");
        if (!sheet || !field) return false;
        const box = sheet.getBoundingClientRect();
        const input = field.getBoundingClientRect();
        return box.top >= -1 && box.bottom <= window.innerHeight + 1 && input.top >= 0 && input.bottom <= window.innerHeight + 1;
      }));
      if (keyboard) await eventually("the page to know the keyboard is up", () => page.evaluate(() => document.documentElement.hasAttribute("data-keyboard")));
      await page.setViewportSize(PHONE.viewport!);
    };

    /** A tap's click on the middle of `element` (a single one, `detail` 1, of the primary button): whether the sheet's field has the focus before the tap's task ends. */
    const tapFocuses = (element: Locator, block: ScrollLogicalPosition = "center"): Promise<boolean> => element.evaluate(async (node, wanted) => {
      node.scrollIntoView({ block: wanted.block });
      const box = node.getBoundingClientRect();
      node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, detail: 1, clientX: box.left + Math.min(box.width, 60) / 2, clientY: box.top + box.height / 2 }));
      for (let i = 0; i < 20; i++) await Promise.resolve();
      return document.activeElement?.matches(wanted.field) ?? false;
    }, { field: sheetField, block });

    // the chat: a touch selection opens nothing, and there is no Comment button; a tap on the paragraph is the way
    const paragraph = page.locator(".chat-view p.is-commentable", { hasText: REPLY });
    await selectText(paragraph, "every revision", paragraph, "in order");
    await frames(page, 10);
    assert.equal(await popoverOf(page).count(), 0, "a touch selection opens nothing");
    await assertNoButton(page, "a touch selection in the chat");
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    assert.ok(await tapFocuses(paragraph), "the chat's sheet takes the focus inside the tap on its paragraph");
    const sheet = dialogOf(page);
    await sheet.waitFor();
    await keyboardUp(page.locator(".chat-view"));
    console.log("PASS form-phone: a touch selection in the chat opens nothing, no Comment button; a tap on the paragraph opens the sheet with its field focused inside the tap; the sheet stays in view as the keyboard rises");

    // Send with a comment half written: nothing goes, the comment's field takes the focus (in the tap)
    await fieldOf(page).fill("Half a thought");
    const message = page.getByRole("textbox", { name: "Message", exact: true });
    await message.fill("Thanks");
    const sendButton = page.getByRole("button", { name: /^Send message/ });
    const heldForComment = await sendButton.evaluate(async (node, field) => {
      (node as HTMLElement).click();
      for (let i = 0; i < 20; i++) await Promise.resolve();
      return document.activeElement?.matches(field) ?? false;
    }, sheetField);
    assert.ok(heldForComment, "Send with a typed comment focuses its field, inside the tap");
    assert.deepEqual(sent, [], "nothing was sent");
    assert.equal(await message.inputValue(), "Thanks", "the message stays in the box");
    await fieldOf(page).fill("");
    await sheet.getByRole("button", { name: "Close", exact: true }).tap();
    await sheet.waitFor({ state: "detached" });
    await sendButton.tap();
    await eventually("the message to be sent once the comment is given up", async () => sent.length > 0);
    assert.deepEqual(sent, ["Thanks"]);
    console.log("PASS form-phone: Send with a comment half written sends nothing and focuses its field; given up, the message goes");

    // the code view, in comment mode with Settings → On mobile, comment with → Tap (a long press opens its sheet from a
    // timer, outside any tap): a tap on a line at the view's bottom edge
    await page.getByRole("button", { name: "big.txt", exact: true }).tap();
    const viewer = page.getByRole("dialog", { name: "big.txt", exact: true });
    await lineOf(viewer, 40).waitFor();
    await viewer.locator("button.file-viewer-comments").tap();
    await page.keyboard.press("ControlOrMeta+Shift+Comma");
    await openSettingsPage(page, "File viewer");
    const settingsDialog = page.locator(".settings-dialog");
    await settingsDialog.locator(".settings-section", { has: page.getByRole("heading", { name: "Comments", exact: true }) }).getByRole("button", { name: "Tap", exact: true }).tap();
    for (let i = 0; i < 3 && (await settingsDialog.count()) > 0; i++) {
      await page.keyboard.press("Escape");
      await frames(page);
    }
    await settingsDialog.waitFor({ state: "detached" });
    /** A finger's tap on the middle of code line `line` (its press, its lift, then its click): whether the sheet's field (`wantedField`: another) has the focus before the click's task ends. */
    const touchTapFocuses = (line: Locator, block: ScrollLogicalPosition = "center", wantedField = sheetField): Promise<boolean> => line.evaluate(async (node, wanted) => {
      node.scrollIntoView({ block: wanted.block });
      const box = node.getClientRects()[0]!;
      const at = { clientX: box.left + Math.min(box.width, 60) / 2, clientY: box.top + box.height / 2 };
      const touch = { bubbles: true, cancelable: true, composed: true, pointerType: "touch", pointerId: 3, isPrimary: true, ...at };
      node.dispatchEvent(new PointerEvent("pointerdown", touch));
      node.dispatchEvent(new PointerEvent("pointerup", touch));
      node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, detail: 1, ...at }));
      for (let i = 0; i < 20; i++) await Promise.resolve();
      const active = document.activeElement;
      const inner = active?.localName === "iframe" ? (active as HTMLIFrameElement).contentDocument?.activeElement : active;
      return inner?.matches(wanted.field) ?? false;
    }, { field: wantedField, block });
    assert.ok(await touchTapFocuses(lineOf(viewer, 40), "end"), "the code view's sheet takes the focus inside the tap on a line");
    await sheet.waitFor();
    assert.equal(await popoverReference(page), "big.txt · Line 40");
    await keyboardUp(viewer.locator(".file-viewer-body"), true);
    console.log("PASS form-phone: a tap on a code line at the view's bottom edge opens the sheet with its field focused inside the tap; the sheet stays in view as the keyboard rises, and the page knows the keyboard is up");

    // a tap on a line opens the sheet too, focused inside the tap
    await fieldOf(page, true).fill("");
    await sheet.getByRole("button", { name: "Close", exact: true }).tap();
    await sheet.waitFor({ state: "detached" });
    assert.ok(await touchTapFocuses(lineOf(viewer, 12)), "a tap on a line opens the sheet with its field focused inside the tap");
    assert.equal(await popoverReference(page), "big.txt · Line 12");
    console.log("PASS form-phone: a tap on a code line opens its sheet with the field focused inside the tap");

    // Settings → Below the line: a tap on a line at the view's bottom edge opens its row, the field focused inside the tap
    // in the layer's frame; as the keyboard rises the viewer's body scrolls the row above it
    await sheet.getByRole("button", { name: "Close", exact: true }).tap();
    await sheet.waitFor({ state: "detached" });
    await page.keyboard.press("ControlOrMeta+Shift+Comma");
    await openSettingsPage(page, "File viewer");
    await settingsDialog.locator(".settings-section", { has: page.getByRole("heading", { name: "Comments", exact: true }) }).getByRole("button", { name: "Below the line", exact: true }).tap();
    for (let i = 0; i < 3 && (await settingsDialog.count()) > 0; i++) {
      await page.keyboard.press("Escape");
      await frames(page);
    }
    await settingsDialog.waitFor({ state: "detached" });
    assert.ok(await touchTapFocuses(lineOf(viewer, 40), "end", "body.comment-frame.is-row > textarea"), "a tap on a code line opens its row with the field focused inside the tap");
    const row40 = viewer.locator(".code-comment-row .comment-popover.is-row");
    await row40.waitFor();
    await page.setViewportSize({ width: PHONE.viewport!.width, height: PHONE.viewport!.height - 300 });
    await eventually("the row above the keyboard, in the viewer's body", () => viewer.evaluate((node) => {
      const box = node.querySelector(".comment-popover.is-row")!.getBoundingClientRect();
      const body = node.querySelector(".file-viewer-body")!.getBoundingClientRect();
      return box.bottom <= body.bottom + 1 && box.bottom <= window.innerHeight + 1 && box.top >= body.top - 1;
    }));
    await page.setViewportSize(PHONE.viewport!);
    await escapePopover(page);
    console.log("PASS form-phone: with Below the line a tap on a code line at the view's bottom edge opens its row with the field focused inside the tap (in the layer's frame), and the row is scrolled above the keyboard");
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
      // a fresh context's settings; a reload keeps what the page changed since (comment mode)
      if (localStorage.getItem("herdr-web-ui:settings") === null) localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en" }));
      localStorage.setItem(`herdr-web-ui:view:${id.pane}`, "chat");
      // seeded once: a reload keeps what the page has done to them since
      const key = `herdr-web-ui:block-comments:${id.pane}`;
      if (id.seed.length > 0 && localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify({ version: 1, comments: id.seed }));
    }, { pane, seed });
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
