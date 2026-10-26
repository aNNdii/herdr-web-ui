/**
 * Comments on files in the file viewer, with a real Codex transcript (its reply links `./src/sync.ts`
 * and `./docs/spec.md`) and an owned herdr pane. The cases: `chat` (the chat's own comments, which share the pins, the
 * popover and the highlights with the viewer). In the code view on a desktop (`code-room`, `code-inline`, `code-mode`):
 * the header's comment mode, the ⊕ beside a line's number, the field and the card under the line, in the room after it.
 * In the code view on phones and tablets (`code-touch`): a long press or a tap on a line, the bottom sheet or the field
 * under the line, the mode's hint, the composer's walk opening the sheet. In the Markdown preview (MarkdownComments.tsx):
 * the comment mode from the header (`preview-mode`: off, a drag only selects; on, it opens the field over the selection);
 * writing with a mouse or the keyboard (`preview`: type at once, Enter, Escape and a press elsewhere keep the text, an
 * empty field leaves nothing, a stored comment's place opens it); where a selection may start and end (`preview-select`:
 * the margin, backwards, a heading, a code block's label, a table, the space between blocks); the comments beside the
 * text, which never moves it (`preview-cards`: cards in the margin, placed, edited in place, deleted, read-only, the text
 * column unmoved by the first comment, on a desktop whose text a test's stylesheet sets narrower for room; `preview-counts`:
 * the text's one place with comments off, cards wanted or counts, counts though cards are wanted where the free space
 * right of the text is short (a desktop's dialog, a phone: at the body's edge, clear of the glyphs), their stacked
 * fields, read-only cards with the mode off); `preview-walk` (the composer's walk into the preview: a folded block unfolded, the
 * comment marked with the mode off, its card in edit with it on, the dialog where its text is not drawn); overlapping comments whose fills add up, in every palette (`preview-overlap`);
 * on phones and tablets (`preview-touch`: the app's own selection by a long press, its handles and Comment, the sheet
 * with its paging and its read-only form, counts sized for a finger, the walk opening the sheet; `preview-touch-wide`: a
 * finger's tap on a card opens the sheet, a mouse's click edits it in place, at 1600 px where cards fit);
 * the viewer's header (`header`: the mode's toggle naming the file's comments, which follow their lines, no counter walk,
 * no Write message, the toggle in the preview too); the sheet on a phone
 * (`form-phone`); and the composer's bar (`composer`), whose walk goes on from the chat's comments into the files': a card
 * in the preview (in edit, the comment mode on), a card in the code view (opened with the mode on), an outdated comment in a dialog, and whose send
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
import { TOUCH_HOLD_MS } from "../src/lib/touchSelection.ts";
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

/**
 * The highlights the text of the comments is painted in (lib/commentHighlight.ts): a saved comment's layer
 * (`comment-layer-0` … `-3`) at rest, `comment-strong` while it is in focus, and the one being written's `comment-pending`.
 */
const MARKED_HIGHLIGHTS = ["comment-layer-0", "comment-layer-1", "comment-layer-2", "comment-layer-3", "comment-strong", "comment-pending"];

/** How many ranges the named CSS Custom Highlights hold (every comment's by default, the one being written's too): what is painted over the text of the comments. */
const highlighted = (page: Page, names: string | readonly string[] = MARKED_HIGHLIGHTS): Promise<number> => page.evaluate((wanted) => {
  const registry = (CSS as unknown as { highlights?: { get(key: string): { size: number } | undefined } }).highlights;
  return wanted.reduce((sum, name) => sum + (registry?.get(name)?.size ?? 0), 0);
}, typeof names === "string" ? [names] : [...names]);

/** The text the named CSS Custom Highlights paint, their ranges joined: beside its pin the popover quotes nothing, so what a
 * new comment is on is read here (`comment-pending`). */
const highlightText = (page: Page, names: string | readonly string[] = "comment-pending"): Promise<string> => page.evaluate((wanted) => {
  const registry = (CSS as unknown as { highlights?: { get(key: string): Iterable<AbstractRange> | undefined } }).highlights;
  return wanted.flatMap((name) => [...(registry?.get(name) ?? [])]).map((range) => range instanceof Range ? range.toString() : "").join(" ");
}, typeof names === "string" ? [names] : [...names]);

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
 * click): in the comment mode the selection opens its comment at once, or shows the Comment button (`commentOnSelect`). Returns where it let go, with the
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

/** No Comment button over a selection (SelectionButton.tsx) anywhere. */
const assertNoButton = async (page: Page, what: string): Promise<void> => {
  assert.equal(await page.locator(".markdown-select-comment").count(), 0, `${what}: no Comment button`);
};

/** The context and page of a case: the pane's chat, its reply drawn, with an empty comment store; `errors` collects the page's, `sent` the texts it submitted to the pane. */
interface Opened { page: Page; errors: string[]; sent: string[]; close: () => Promise<void> }

/**
 * A case: given the browser and the pane, it opens its own pages. `seed`: comments the pane's store
 * holds before the page first loads (as another session left them), else it starts empty. `settings`: laid over the
 * fresh context's settings, in which a selection opens the field at once (`commentOnSelect` "field", the variant the
 * cases test; `preview-button` seeds the default, the Comment button).
 */
type Case = (open: (options: BrowserContextOptions, seed?: readonly object[], settings?: Record<string, unknown>) => Promise<Opened>) => Promise<void>;

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
    if (!key.startsWith("ovis:block-comments:")) continue;
    for (const comment of (JSON.parse(localStorage.getItem(key)!) as { comments: { kind?: string; lines: number[]; quoteLines: string[]; view: string; selection?: unknown }[] }).comments) {
      if (comment.kind === "file") found.push({ lines: comment.lines, quoteLines: comment.quoteLines, view: comment.view, selected: comment.selection !== undefined });
    }
  }
  return found;
});
/** The stored file comments' lines and text, in send order. */
const storedFileTexts = (page: Page): Promise<{ lines: number[]; comment: string }[]> => page.evaluate(() => {
  const found: { lines: number[]; comment: string }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)!;
    if (!key.startsWith("ovis:block-comments:")) continue;
    for (const comment of (JSON.parse(localStorage.getItem(key)!) as { comments: { kind?: string; lines: number[]; comment: string }[] }).comments) {
      if (comment.kind === "file") found.push({ lines: comment.lines, comment: comment.comment });
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
/** The open comment's popover, wherever it is drawn. */
const popoverOf = (page: Page): Locator => page.locator(".comment-popover");
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
 * How far the page and every element around the viewer's body are scrolled, summed: 0 while only the body itself
 * scrolled (the walk scrolls nothing else, never the page).
 */
const outerScroll = (viewer: Locator): Promise<number> => viewer.evaluate((node) => {
  let total = Math.abs(window.scrollX) + Math.abs(window.scrollY);
  for (let at = node.querySelector(".file-viewer-body")?.parentElement ?? null; at !== null; at = at.parentElement) total += Math.abs(at.scrollTop) + Math.abs(at.scrollLeft);
  return total;
});

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
/** The text up on `surface` (a viewer's body, the chat): what the strong highlight holds there. */
const upIn = (surface: Locator): Promise<{ text: string }> => surface.evaluate((node) => {
  const registry = (CSS as unknown as { highlights: { get(key: string): Iterable<Range> | undefined } }).highlights;
  const ranges = [...(registry.get("comment-strong") ?? [])].filter((range) => node.contains(range.commonAncestorContainer));
  return { text: ranges.map((range) => range.toString()).join("\n") };
});
/** Polls until the text up on `surface` includes `text`. */
async function assertUp(surface: Locator, text: string, what: string): Promise<void> {
  let seen: unknown = null;
  await eventually(`${what}: its text up`, async () => {
    const up = await upIn(surface);
    seen = up;
    return up.text.includes(text);
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

/** The start (`end` false) or end of the first `word` in `element`'s text, in client pixels, without scrolling. */
const wordEdge = (element: Locator, word: string, end: boolean): Promise<{ x: number; y: number }> => element.evaluate((node, wanted) => {
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

/** A mouse's drag from `from` to `to` (client pixels): a press, moves and a release, one click. */
async function dragPoints(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

/** The field over a selection in the preview (MarkdownComments.tsx): the row card in the layer the viewer's body holds. */
const selectionFieldIn = (viewer: Locator): Locator => viewer.locator(".file-viewer-body > .markdown-comments .comment-popover.is-row");

/** The text the strong fill paints (the selection a field is open on, or the comment in focus), its ranges joined by spaces, blanks folded. */
const strongText = async (page: Page): Promise<string> => (await highlightText(page, "comment-strong")).replace(/\s+/g, " ").trim();

/** The preview's file comments in the page's store: their lines, text and the words selected (null: on whole lines). */
const storedPreview = (page: Page): Promise<{ lines: number[]; comment: string; text: string | null }[]> => page.evaluate(() => {
  const found: { lines: number[]; comment: string; text: string | null }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)!;
    if (!key.startsWith("ovis:block-comments:")) continue;
    for (const comment of (JSON.parse(localStorage.getItem(key)!) as { comments: { kind?: string; view?: string; lines: number[]; comment: string; selection?: { text: string } }[] }).comments) {
      if (comment.kind === "file" && comment.view === "preview") found.push({ lines: comment.lines, comment: comment.comment, text: comment.selection?.text ?? null });
    }
  }
  return found;
});

/**
 * Polls until the field over a selection (`field`) sits beside the selection, 8 px clear (± 1): its top under the
 * selection's last line, or, without room there, its bottom above the first line (lib/selectionField.ts `fieldPlace`),
 * and inside the viewer's body sideways. The selection is read from the strong fill, which holds it while the field is
 * open (the browser's own selection goes once the field takes the focus).
 */
async function assertFieldOver(page: Page, viewer: Locator, field: Locator, what: string): Promise<void> {
  let seen: unknown = null;
  await eventually(`${what}: the field beside the selection, 8 px clear`, async () => {
    const lines = await page.evaluate(() => {
      const registry = (CSS as unknown as { highlights: { get(key: string): Iterable<AbstractRange> | undefined } }).highlights;
      const rects = [...(registry.get("comment-strong") ?? [])].flatMap((range) => range instanceof Range ? [...range.getClientRects()] : [])
        .filter((rect) => rect.width > 0 && rect.height > 0);
      return rects.length === 0 ? null : { top: Math.min(...rects.map((rect) => rect.top)), bottom: Math.max(...rects.map((rect) => rect.bottom)) };
    });
    const box = await field.boundingBox();
    const body = await viewer.locator(".file-viewer-body").boundingBox();
    seen = { lines, box, body };
    return lines !== null && box !== null && body !== null
      && (Math.abs(box.y - (lines.bottom + 8)) <= 1 || Math.abs(box.y + box.height - (lines.top - 8)) <= 1)
      && box.x >= body.x - 1 && box.x + box.width <= body.x + body.width + 1;
  }).catch((error: Error) => { throw new Error(`${error.message} (${JSON.stringify(seen)})`); });
}

/** The preview's margin cards (CommentMargin.tsx), in document order; one by its comment's id. */
const cardsIn = (viewer: Locator): Locator => viewer.locator(".file-viewer-body > .comment-margin .markdown-comment-card");
const cardIn = (viewer: Locator, id: string): Locator => viewer.locator(`.file-viewer-body > .comment-margin .markdown-comment-card[data-comment-id="${id}"]`);
/** The preview's counts beside the lines (CommentMargin.tsx), in document order. */
const countsIn = (viewer: Locator): Locator => viewer.locator(".file-viewer-body > .comment-margin .markdown-comment-count");
/** The fields a count opened (MarkdownComments.tsx), stacked over its first comment's text. */
const countFieldsIn = (viewer: Locator): Locator => viewer.locator(".file-viewer-body > .markdown-comments-field .comment-popover.is-row");

/** The client top of the first line box of `word` in `element` (its first character's box). */
const wordTop = (element: Locator, word: string): Promise<number> => element.evaluate((node, wanted) => {
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  for (let next = walker.nextNode(); next; next = walker.nextNode()) {
    const at = (next as Text).data.indexOf(wanted);
    if (at < 0) continue;
    const range = document.createRange();
    range.setStart(next, at);
    range.setEnd(next, at + 1);
    return range.getClientRects()[0]!.top;
  }
  throw new Error(`"${wanted}" is not in the element`);
}, word);

/**
 * A stored preview comment on the words of line `n` from column `from` to `to` (a table row's cells are set off by
 * " | ", lib/fileCommentDom.ts), as the comment layer saves one on a selection.
 */
function selectedComment(id: string, n: number, from: number, to: number, comment: string, created: number): object {
  const specPath = realpathSync(join(root, "docs", "spec.md"));
  const text = n === 42 ? "Older revision | 409 Conflict with the stored note" : SPEC_LINES[n - 1]!;
  return {
    ...seededComment(id, specPath, "docs/spec.md", "preview", SPEC_LINES, n, n, comment, created, [text]),
    anchor: `file:${specPath}:preview:${n}-${n}@0.${from}-0.${to}`,
    selection: { text: text.slice(from, to), start: [0, from], end: [0, to] },
  };
}

/** The boxes of `cards` (client pixels), in document order. */
const boxesOf = async (cards: Locator): Promise<{ x: number; y: number; width: number; height: number }[]> =>
  cards.evaluateAll((nodes) => nodes.map((node) => {
    const box = node.getBoundingClientRect();
    return { x: box.left, y: box.top, width: box.width, height: box.height };
  }));

/**
 * The preview's text in `viewer` (client pixels): its box's left and width, its content box's right edge (where its
 * glyphs end at most), and the right edge of what the viewer's body shows (its padding box): the free space the margin
 * takes lies between those two edges.
 */
const textBoxOf = (viewer: Locator): Promise<{ left: number; width: number; right: number; bodyRight: number }> => viewer.evaluate((node) => {
  const text = node.querySelector<HTMLElement>(".file-viewer-markdown")!;
  const box = text.getBoundingClientRect();
  const body = node.querySelector<HTMLElement>(".file-viewer-body")!;
  const outer = body.getBoundingClientRect();
  return { left: box.left, width: box.width, right: box.right - Number.parseFloat(getComputedStyle(text).paddingRight), bodyRight: outer.left + body.clientLeft + body.clientWidth };
});

/** The right edge of the glyphs drawn in `element` (client pixels): its text's line boxes, as far right as one goes. */
const glyphRight = (element: Locator): Promise<number> => element.evaluate((node) => {
  let right = Number.NEGATIVE_INFINITY;
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  for (let next = walker.nextNode(); next; next = walker.nextNode()) {
    const range = document.createRange();
    range.selectNodeContents(next);
    for (const rect of range.getClientRects()) if (rect.width > 0) right = Math.max(right, rect.right);
  }
  return right;
});

/**
 * Whether a point at the centre of `element`'s box hits it or what is in it: nothing clips or covers it there. The
 * element is scrolled to the middle of its scroller first (`elementFromPoint` sees only what is on screen).
 */
const hitAtCentre = (element: Locator): Promise<boolean> => element.evaluate((node) => {
  node.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
  const box = node.getBoundingClientRect();
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  return hit !== null && node.contains(hit);
});

/**
 * A desktop's viewer whose text is set narrower than any setting sets it (480 px, a test's stylesheet): the dialog (at
 * most 1100 px, the text at least 820 px) leaves short of the cards' 24 + 280 px right of the text, so this is how
 * `preview-cards` gets cards in the preview with a mouse and keys. Where the room comes from is not what it tests: the
 * text is measured, never moved (`marginLayout`); the real screens' rooms are `preview-counts` and `preview-touch-wide`.
 */
const ROOMY_TEXT = ".file-viewer .file-viewer-markdown.file-viewer-markdown-readable { max-width: 480px; }";

/** With `PREVIEW_MARGIN_SHOTS` set to a folder: a screenshot of the page there, to look at the margin's cards and counts. */
async function marginShot(page: Page, name: string): Promise<void> {
  if (process.env.PREVIEW_MARGIN_SHOTS) await page.screenshot({ path: join(process.env.PREVIEW_MARGIN_SHOTS, `${name}.png`) });
}

/** Turns the comment mode on by the viewer's header toggle (a mouse's click). */
async function modeOn(viewer: Locator): Promise<Locator> {
  const toggle = viewer.locator("button.file-viewer-comments");
  await toggle.waitFor();
  assert.equal(await toggle.getAttribute("aria-pressed"), "false", "the mode starts off");
  await toggle.click();
  await eventually("the mode to turn on", async () => (await toggle.getAttribute("aria-pressed")) === "true");
  return toggle;
}

const cases: Record<string, Case> = {
  /**
   * The chat's comment flow on the Markdown comment layer it shares with the preview: the mode off, a drag only selects;
   * the chat's toggle on, a drag opens the field over the reply's text, Enter saves it, marked, with its card or count;
   * the composer's walk opens it, and Delete removes it, its mark and the bar.
   */
  async chat(open) {
    const { page, errors, close } = await open(DESKTOP);
    const chat = page.locator(".chat-view");
    const paragraph = page.locator(".chat-view .markdown p", { hasText: REPLY });
    await dragText(page, null, paragraph, "every revision", paragraph, "in order");
    await frames(page, 10);
    assert.equal(await popoverOf(page).count(), 0, "the mode off, a drag opens nothing");
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    const toggle = page.locator(".chat-frame-body > button.chat-comments-toggle");
    await toggle.click();
    await eventually("the mode on", async () => (await toggle.getAttribute("aria-pressed")) === "true");
    await dragText(page, null, paragraph, "every revision", paragraph, "in order");
    const field = chat.locator("> .markdown-comments-field .comment-popover.is-row");
    await field.waitFor();
    await assertNoButton(page, "a drag in the chat");
    await page.keyboard.type("Say which order.");
    await page.keyboard.press("Enter");
    await field.waitFor({ state: "detached" });
    await eventually("the comment's text to be marked", async () => (await highlighted(page)) > 0);
    const beside = chat.locator("[data-chat-row] .comment-margin").locator(".markdown-comment-card, .markdown-comment-count");
    await eventually("its card or count beside the reply", async () => (await beside.count()) === 1);
    console.log("PASS chat: the mode off, a drag opens nothing; on (the chat's toggle), a drag opens the field over the reply, Enter saves it, marked, with its card or count");

    const walk = walkOf(page);
    await walk.waitFor();
    assert.equal(await walk.getAttribute("aria-label"), "1 comment on the reply");
    await walk.click();
    await eventually("the walk to open the comment's field", async () => (await popoverText(page)) === "Say which order.");
    await fieldFocused(page);
    await assertUp(chat, "every revision in order", "the chat's comment the walk opened");
    console.log("PASS chat: with one comment the composer bar shows, and its walk opens the comment's field, its text up");

    await deleteOf(page).click();
    await eventually("the card or count to go", async () => (await beside.count()) === 0);
    await walk.waitFor({ state: "detached" });
    await eventually("the mark to go", async () => (await highlighted(page)) === 0);
    console.log("PASS chat: Delete beside ↑ removes the comment, its mark and the bar");
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
          const settings = JSON.parse(localStorage.getItem("ovis:settings") ?? "{}") as Record<string, unknown>;
          localStorage.setItem("ovis:settings", JSON.stringify({ ...settings, wrapCode: true }));
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
    assert.equal(await toggle.locator(".comment-mode-count").count(), 0, "no badge without comments");
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
    // one look for every comment field: the chat's font for its text and its placeholder, in the frame too (never the code's)
    const faces = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.style.fontFamily = "var(--font-chat, var(--font-ui))";
      document.body.append(probe);
      const chat = getComputedStyle(probe).fontFamily;
      probe.remove();
      const mono = getComputedStyle(document.body).getPropertyValue("--font-mono");
      const field = document.querySelector<HTMLIFrameElement>("iframe.comment-frame[data-open]")!.contentDocument!.querySelector("textarea.comment-editor-field")!;
      return { chat, mono, text: getComputedStyle(field).fontFamily, placeholder: getComputedStyle(field, "::placeholder").fontFamily };
    });
    assert.equal(faces.text, faces.chat, "the field's text is in the chat's font");
    assert.equal(faces.placeholder, faces.chat, "and its placeholder, in the frame too");
    assert.notEqual(faces.chat, faces.mono, "which is not the code's");
    // one line beside ↑ at rest (about 52 px), growing to about 160 px, then scrolling
    const restHeight = (await rowPopover.boundingBox())!.height;
    assert.ok(restHeight >= 48 && restHeight <= 56, `the open row is about 52 px high at rest (${restHeight})`);
    await fieldOf(page, true).fill(Array.from({ length: 12 }, (_, index) => `Line ${index + 1} of a long comment`).join("\n"));
    await frames(page);
    const grown = await rowPopover.evaluate((box) => {
      const field = box.querySelector(".comment-field-slot")!.ownerDocument.querySelector<HTMLIFrameElement>("iframe.comment-frame[data-open]")!.contentDocument!.querySelector("textarea.comment-editor-field")!;
      return { height: box.getBoundingClientRect().height, scrolls: field.scrollHeight > field.clientHeight };
    });
    assert.ok(grown.height <= 164 && grown.height > restHeight, `twelve lines grow the row to about 160 px, no further (${grown.height})`);
    assert.ok(grown.scrolls, "and the field scrolls past that");
    // typed and left by Escape: the new comment is saved, the field gone
    await fieldOf(page, true).fill("A blank line between imports and types.");
    await page.keyboard.press("Escape");
    await rowPopover.waitFor({ state: "detached" });
    assert.ok(await viewer.isVisible(), "Escape left the field, not the viewer");
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
    await eventually("the badge to read 1", async () => (await toggle.locator(".comment-mode-count").textContent().catch(() => null)) === "1");
    assert.equal(await toggle.getAttribute("aria-label"), "Comment mode, 1 comment");
    console.log("PASS code-inline: ⊕ opens the field under line 4 (placeholder, focus, ↑ disabled while empty); typed and left by Escape, it is stored on [4, 4], its card under line 4, the number in the accent, the badge 1");

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

    // the card opens to edit, in its place; Escape unchanged closes it; changed, Escape saves the edit
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
    // the focus elsewhere in the viewer: Escape is the field's first, and saves the edit; the viewer stays
    await viewer.getByRole("link", { name: "Open in a new tab", exact: true }).focus();
    await page.keyboard.press("Escape");
    await rowPopover.waitFor({ state: "detached" });
    assert.ok(await viewer.isVisible(), "Escape from elsewhere left the field, not the viewer");
    assert.deepEqual(await storedFileTexts(page), [{ lines: [4, 4], comment: "A blank line between imports and types. Keep it." }], "Escape from elsewhere saved the edit");
    await eventually("line 4's card with the edit", async () => (await card4.locator(".code-comment-text").textContent().catch(() => null)) === "A blank line between imports and types. Keep it.");
    // Escape from the field itself saves an edit too
    await card4.click();
    await fieldFocused(page);
    await fieldOf(page, true).fill("A blank line between imports and types.");
    await page.keyboard.press("Escape");
    await rowPopover.waitFor({ state: "detached" });
    assert.ok(await viewer.isVisible(), "and the viewer stays");
    assert.deepEqual(await storedFileTexts(page), [{ lines: [4, 4], comment: "A blank line between imports and types." }], "Escape in the field saved the edit");
    console.log("PASS code-inline: the card opens in its place with its text; Escape closes it unchanged and saves it changed (from the field and from elsewhere in the viewer), the viewer staying");

    // one field at a time: the ⊕ of line 6 leaves line 4's field, which saves what was typed in it, and opens line 6's
    await card4.click();
    await fieldFocused(page);
    await page.keyboard.type(" Typed.");
    let at6 = await lineBox(lineOf(viewer, 6));
    // its own line's ⊕ (the pointer off the lines: it is back on line 4) is no other opening: the field stays, with its
    // text and the focus, and nothing is saved yet
    await page.mouse.move(at6.number, at6.y);
    await assertAddAt(viewer, 6, "line 6 hovered with line 4's changed field open");
    await page.mouse.move(at6.number, 4);
    await assertAddAt(viewer, 4, "no line hovered, line 4's changed field open");
    await visibleAdds(viewer).click();
    await frames(page);
    assert.equal(await rowOf(viewer, 4).locator(".comment-popover.is-row").count(), 1, "line 4's own ⊕ keeps its field");
    assert.equal(await fieldOf(page, true).inputValue(), "A blank line between imports and types. Typed.", "with its text");
    assert.ok(await focusedMatches(page, ".comment-editor-field"), "and the focus");
    assert.deepEqual(await storedFileTexts(page), [{ lines: [4, 4], comment: "A blank line between imports and types." }], "nothing saved yet");
    at6 = await lineBox(lineOf(viewer, 6));
    await page.mouse.move(at6.number, at6.y);
    await assertAddAt(viewer, 6, "line 6 hovered again");
    await visibleAdds(viewer).click();
    await eventually("line 6's field", async () => (await rowOf(viewer, 6).locator(".comment-popover.is-row").count()) === 1);
    assert.equal(await rowPopover.count(), 1, "one field");
    assert.equal(await fieldOf(page, true).getAttribute("placeholder"), "Write a comment…");
    await eventually("line 4's card back, with the edit", async () => (await card4.locator(".code-comment-text").textContent().catch(() => null)) === "A blank line between imports and types. Typed.");
    assert.deepEqual(await storedFileTexts(page), [{ lines: [4, 4], comment: "A blank line between imports and types. Typed." }], "line 4's edit saved as line 6's field opened");
    await fieldFocused(page);
    // typed, then a press elsewhere (on the code): the new comment is saved, and the press opens nothing
    await page.keyboard.type("Line 6 note");
    const at1 = await lineBox(lineOf(viewer, 1));
    await page.mouse.click(at1.number + 120, at1.y);
    await rowPopover.waitFor({ state: "detached" });
    const card6 = rowOf(viewer, 6).locator(".code-comment-card");
    await eventually("line 6's card", async () => (await card6.count()) === 1);
    assert.deepEqual(await storedFileTexts(page), [
      { lines: [4, 4], comment: "A blank line between imports and types. Typed." },
      { lines: [6, 6], comment: "Line 6 note" },
    ], "a press elsewhere saved line 6's comment");
    await frames(page);
    assert.equal(await rowPopover.count(), 0, "the press opened no field");
    // Shift+Enter breaks the line, Enter saves
    await card6.click();
    await fieldFocused(page);
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("second line");
    assert.equal(await fieldOf(page, true).inputValue(), "Line 6 note\nsecond line", "Shift+Enter adds a line");
    assert.equal(await rowPopover.count(), 1, "and keeps the field");
    await page.keyboard.press("Enter");
    await rowPopover.waitFor({ state: "detached" });
    assert.deepEqual((await storedFileTexts(page)).map((stored) => stored.comment), ["A blank line between imports and types. Typed.", "Line 6 note\nsecond line"], "Enter saved the edit");
    // an edit emptied and left by Escape deletes the comment
    await card6.click();
    await fieldFocused(page);
    await fieldOf(page, true).fill("");
    await page.keyboard.press("Escape");
    await rowPopover.waitFor({ state: "detached" });
    await eventually("line 6's card to go", async () => (await card6.count()) === 0);
    assert.deepEqual(await storedFileTexts(page), [{ lines: [4, 4], comment: "A blank line between imports and types. Typed." }], "the emptied comment is deleted");
    console.log("PASS code-inline: one field at a time: line 4's own ⊕ keeps its typed field (text, focus, nothing saved); the ⊕ of line 6 saves line 4's typed edit and opens line 6's field; a press elsewhere saves a typed new comment and opens nothing; Shift+Enter breaks the line, Enter saves; an edit emptied and left by Escape is deleted");

    // Delete removes it, its room and the badge
    await card4.getByRole("button", { name: "Delete comment on line 4", exact: true }).click();
    await eventually("the card to go", async () => (await viewer.locator(".code-comment-card").count()) === 0);
    // the last card: the focus goes to the header's toggle, not to the page
    await eventually("the focus on the header's toggle", () => focusedMatches(page, "button.file-viewer-comments"));
    await eventually("line 4's room to go", async () => !(await lineOf(viewer, 4).evaluate((line) => line.hasAttribute("data-comment-room"))));
    assert.equal(await toggle.locator(".comment-mode-count").count(), 0, "the badge goes");
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
    await eventually("the range to be highlighted", async () => (await highlightText(seeded.page, MARKED_HIGHLIGHTS)).includes("export interface Note"));
    // the pointer on a card brings its comment's text up, as on a pin in the preview, and leaving the card takes it down.
    // The pointer first off the cards: it rests where it clicked the reply's link, which the viewer may have opened a card over
    const rangeCard = rowOf(viewer, 4).locator(".code-comment-card", { hasText: "Range note" });
    const restedOnCard = await rangeCard.evaluate((node) => node.matches(":hover"));
    const title = await viewer.locator(".file-viewer-title").boundingBox();
    await seeded.page.mouse.move(title!.x + 4, title!.y + 4);
    await eventually("no text up before the pointer is on a card", async () => (await highlightText(seeded.page, "comment-strong")) === "").catch((error: Error) => {
      throw new Error(`${error.message} (the pointer rested on the card before: ${restedOnCard})`);
    });
    const overRange = await rangeCard.boundingBox();
    assert.ok(overRange !== null, "the range card to hover");
    await seeded.page.mouse.move(overRange.x + overRange.width / 2, overRange.y + overRange.height / 2);
    await eventually("the hovered card's text to come up", async () => (await highlightText(seeded.page, "comment-strong")).includes("export interface Note")).catch(async (error: Error) => {
      throw new Error(`${error.message} (up: ${JSON.stringify(await highlightText(seeded.page, "comment-strong"))}, all: ${JSON.stringify(await highlightText(seeded.page, MARKED_HIGHLIGHTS))}, hover: ${await rangeCard.evaluate((n) => `${n.matches(":hover")} id=${n.getAttribute("data-comment-id")} surface=${n.closest("[data-comment-surface]") !== null}`)})`);
    });
    // and no attribute on the body (an ancestor of every line), which would restyle them all
    assert.equal(await seeded.page.locator("[data-comment-focus]").count(), 0, "no element takes a focus attribute while a card's text is up");
    await seeded.page.mouse.move(overRange.x + overRange.width / 2, 2);
    await eventually("the text to go down as the pointer leaves the card", async () => (await highlightText(seeded.page, "comment-strong")) === "");
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
   * Comment mode: remembered across a reload; turned off, it leaves the open field (a field with text typed is saved, an
   * unchanged one closes), and the cards turn read-only; Settings → Comments → Click a line to comment; Settings → Comments →
   * Comments off takes the toggle away and disables the File viewer's group, with its note.
   */
  async "code-mode"(open) {
    const syncPath = realpathSync(join(root, "src", "sync.ts"));
    const { page, errors, close } = await open(DESKTOP, [seededComment("seed-line-8", syncPath, "src/sync.ts", "code", SYNC_LINES, 8, 8, "Compare with <=.", 1)]);
    let viewer = await openSync(page);
    let toggle = viewer.locator("button.file-viewer-comments");
    assert.equal(await toggle.getAttribute("aria-label"), "Comment mode, 1 comment");
    assert.equal(await toggle.locator(".comment-mode-count").textContent(), "1");
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

    // a field with text typed is saved and closed as the mode goes off. The toggle is pressed by the keyboard: a press
    // on it would be a press outside the field, which leaves it by itself
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
    await rowPopover.waitFor({ state: "detached" });
    assert.deepEqual(await storedFileTexts(page), [
      { lines: [8, 8], comment: "Compare with <=." },
      { lines: [2, 2], comment: "Typed before the mode went off" },
    ], "the field with text typed is saved as the mode goes off");
    await eventually("its card under line 2", async () => (await rowOf(viewer, 2).locator(".code-comment-card").count()) === 1);
    // an unchanged field closes as the mode goes off
    await pressToggle();
    await rowOf(viewer, 8).locator(".code-comment-card").click();
    await rowPopover.waitFor();
    await pressToggle();
    await rowPopover.waitFor({ state: "detached" });
    assert.equal(await toggle.getAttribute("aria-pressed"), "false");
    console.log("PASS code-mode: turning the mode off saves and closes a field with text typed; it closes an unchanged one");

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

    // Settings → Comments → Code view → Click a line to comment
    await page.keyboard.press("ControlOrMeta+Shift+Comma");
    await openSettingsPage(page, "Comments");
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

    // Settings → Comments off: no toggle; the Comments page's Code view group disabled
    viewer = await openSync(page);
    await page.keyboard.press("ControlOrMeta+Shift+Comma");
    await openSettingsPage(page, "Comments");
    await settingsDialog.getByRole("switch", { name: "Comments", exact: true }).click();
    const confirm = page.getByRole("alertdialog");
    await confirm.waitFor();
    await confirm.getByRole("button", { name: "Turn off and delete", exact: true }).click();
    await confirm.waitFor({ state: "detached" });
    const group = settingsDialog.locator(".settings-section", { has: page.getByRole("heading", { name: "Code view", exact: true }) });
    assert.ok(await group.getByRole("switch", { name: "Click a line to comment", exact: true }).isDisabled(), "Click a line to comment is disabled");
    for (const name of ["Long press", "Tap", "Bottom sheet", "Below the line"]) {
      assert.ok(await group.getByRole("button", { name, exact: true }).isDisabled(), `${name} is disabled`);
    }
    await page.keyboard.press("Escape");
    await settingsDialog.waitFor({ state: "detached" });
    assert.equal(await viewer.locator("button.file-viewer-comments").count(), 0, "no toggle with comments off");
    assert.equal(await viewer.locator(".code-comment-card").count(), 0, "no card");
    console.log("PASS code-mode: with Settings → Comments off the header has no toggle and the Comments page's Code view group is disabled");
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
      /** Settings → Comments → Code view: the option named `name`. */
      const chooseSetting = async (name: string): Promise<void> => {
        await page.keyboard.press("ControlOrMeta+Shift+Comma");
        await openSettingsPage(page, "Comments");
        const dialog = page.locator(".settings-dialog");
        const group = dialog.locator(".settings-section", { has: page.getByRole("heading", { name: "Code view", exact: true }) });
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
      assert.equal(await sheet.locator(".comment-popover-code-number").count(), 0, `${device}: the sheet shows no line number`);
      assert.equal(await sheet.evaluate((box) => getComputedStyle(box).resize), "none", `${device}: no resize grip`);
      assert.equal(await fieldOf(page, true).evaluate((field) => getComputedStyle(field).resize), "none", `${device}: nor on its field`);
      // the field in its frame looks as it did in the page: the sheet's input look, at 16 px, on no ground of the frame's own
      assert.equal(await sheet.locator("iframe.comment-frame[data-open]").count(), 1, `${device}: the sheet's field is in its own frame`);
      assert.deepEqual(await fieldOf(page, true).evaluate((field) => {
        const style = getComputedStyle(field);
        const frameStyle = getComputedStyle(field.ownerDocument.body);
        return [style.fontSize, style.borderTopWidth, frameStyle.backgroundColor, getComputedStyle(field.ownerDocument.documentElement).backgroundColor];
      }), ["16px", "1px", "rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0)"], `${device}: the sheet's field is 16 px with its input edge, the frame's document transparent`);
      // about four lines high at rest (the spec's sheet input), growing up to six
      const atRest = await fieldOf(page, true).evaluate((field) => ({ height: field.getBoundingClientRect().height, line: parseFloat(getComputedStyle(field).lineHeight) }));
      assert.ok(Number.isFinite(atRest.line) && atRest.height >= 4 * atRest.line - 2 && atRest.height <= 6 * atRest.line, `${device}: the sheet's field is about four lines high at rest (${JSON.stringify(atRest)})`);
      // line 4 is blank: nothing to quote, so no quote
      assert.equal(await sheet.locator(".comment-sheet-quote").count(), 0, `${device}: a blank line has no quote`);
      assert.deepEqual(await pressedIn(viewer), [], `${device}: no line is pressed once it opened`);
      assert.equal(await page.evaluate(() => window.getSelection()?.toString() ?? ""), "", `${device}: no text selected`);
      // measured where it comes to rest, not while it still rises (styles.css `sheet-in`)
      await sheetsSettled(page);
      const sheetBox = await sheet.boundingBox();
      assert.ok(sheetBox !== null && Math.abs(sheetBox.y + sheetBox.height - size.height) <= 1 && Math.abs(sheetBox.width - size.width) <= 1, `${device}: a bottom sheet, full width (${JSON.stringify(sheetBox)})`);
      assert.deepEqual(await tintIn(viewer, 4, true), { shown: true, onLine: true }, `${device}: line 4 stays tinted behind the sheet`);
      assert.equal((await tintIn(viewer, 4)).shown, false, `${device}: the press's own tint is gone`);
      console.log(`PASS code-touch (${device}): a long press on line 4 marks and tints it; held past 300 ms nothing opens yet, and the lift opens the bottom sheet (named "Comment on line 4", no visible heading, no line number, the field focused inside the lift, the line tinted behind it); the click after it is swallowed, no text selected`);

      // the scrim closes the sheet while it is empty, and saves it with text typed: the card under line 4
      await page.touchscreen.tap(size.width / 2, 8);
      await sheet.waitFor({ state: "detached" });
      assert.equal((await tintIn(viewer, 4, true)).shown, false, `${device}: the tint goes with the sheet`);
      await longPress(4);
      await sheet.waitFor({ timeout: 1000 });
      await fieldFocused(page);
      await fieldOf(page, true).fill("Phone note");
      await page.touchscreen.tap(size.width / 2, 8);
      await sheet.waitFor({ state: "detached" });
      await assertAddIdle("after the scrim saved the sheet");
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
      // text buttons without an icon: Delete quiet at the left, Save the one primary at the right (the app's `.btn`s)
      const sheetDelete = sheet.getByRole("button", { name: "Delete", exact: true });
      const sheetSave = sheet.getByRole("button", { name: "Save", exact: true });
      assert.equal(await sheetDelete.count(), 1, `${device}: the sheet has Delete`);
      assert.equal(await sheetDelete.evaluate((button) => button.classList.contains("btn") && button.classList.contains("btn-ghost")), true, `${device}: Delete is the ghost button`);
      assert.equal(await sheetSave.evaluate((button) => button.classList.contains("btn") && button.classList.contains("btn-primary")), true, `${device}: Save is the primary button`);
      assert.equal(await sheetDelete.locator("svg").count() + (await sheetSave.locator("svg").count()), 0, `${device}: neither carries an icon`);
      const [deleteBox, saveBox] = [await sheetDelete.boundingBox(), await sheetSave.boundingBox()];
      assert.ok(deleteBox !== null && saveBox !== null && deleteBox.x < saveBox.x, `${device}: Delete is left of Save`);
      // (the file and lines stay for assistive tech, `.visually-hidden`: what is shown is what counts)
      assert.equal(await sheet.evaluate((box) => {
        const shown = box.cloneNode(true) as HTMLElement;
        shown.querySelectorAll(".visually-hidden").forEach((node) => node.remove());
        return /\b(Line|Lines) \d/.test(shown.textContent ?? "");
      }), false, `${device}: no line number in the sheet's shown text`);
      for (const [name, button] of [["Delete", sheetDelete], ["✕", closeOf(page)]] as const) {
        const box = await button.boundingBox();
        assert.ok(box !== null && box.width >= 44 && box.height >= 44, `${device}: the edit sheet's ${name} is at least 44 × 44 px (${JSON.stringify(box)})`);
      }
      // a saved comment opened on a touch screen: the sheet takes the focus, not its field, so no keyboard rises (`popoverFocusesField`)
      await eventually(`${device}: the edit sheet to hold the focus`, () => focusedMatches(page, ".modal.comment-popover.is-sheet"));
      assert.equal(await focusedMatches(page, ".comment-editor-field"), false, `${device}: not its field`);
      await closeOf(page).tap();
      await sheet.waitFor({ state: "detached" });
      await assertAddIdle("after the edit sheet's ✕");
      console.log(`PASS code-touch (${device}): a tap on the scrim closes the empty sheet and saves one with text typed, its card under line 4; the card tapped opens the sheet with text-only Delete (ghost, left) and Save (primary, right) and ✕ at 44 px or more, the sheet focused and not its field`);

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
      // the finger's row with text typed, left by Escape: saved, its card under line 6
      await fieldOf(page, true).fill("Typed");
      await escapePopover(page);
      const card6 = rowOf(viewer, 6).locator(".code-comment-card");
      await eventually(`${device}: line 6's card after Escape`, async () => (await card6.count()) === 1);
      assert.deepEqual((await storedFileTexts(page)).filter((stored) => stored.lines[0] === 6), [{ lines: [6, 6], comment: "Typed" }], `${device}: Escape saved the finger's row`);
      await assertAddIdle("after a finger's row saved by Escape");
      // the row held (its edit opened by a finger), a finger's press on another line: its tint waits the fill's 80 ms
      // like any other; the press leaves the row
      await card6.locator(".code-comment-text").tap();
      await row6.waitFor({ timeout: 1000 });
      assert.deepEqual(await tintIn(viewer, 6, true), { shown: true, onLine: true }, `${device}: line 6 keeps its band while its edit row is open`);
      const other = await pressAt(8, "pointercancel");
      assert.equal(other.tintAtOnce, "0", `${device}: with a row held, a press on another line shows no band before 80 ms`);
      await row6.waitFor({ state: "detached" });
      // the edit emptied and left by Escape deletes the comment
      await card6.locator(".code-comment-text").tap();
      await row6.waitFor({ timeout: 1000 });
      await fieldOf(page, true).fill("");
      await escapePopover(page);
      await eventually(`${device}: line 6's emptied comment deleted`, async () => (await card6.count()) === 0);
      assert.deepEqual((await storedFileTexts(page)).filter((stored) => stored.lines[0] === 6), [], `${device}: nothing stored on line 6`);
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
      console.log(`PASS code-touch (${device}): with Below the line a long press opens the field under the line (16 px text, the line keeping its band); its text left by Escape is saved, and emptied as an edit deleted; a press on another line still waits 80 ms for its band; with Tap a tap opens it at once (the hint "Tap a line to comment"), in the sheet with Bottom sheet`);

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
        await page.evaluate((path) => history.replaceState({ ...history.state, "ovis:file-preview": { path, paneId: null, machineId: "local" } }, ""), join(root, "src", "sync.ts"));
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
    await page.evaluate(() => localStorage.setItem("ovis:settings", JSON.stringify({ language: "en", commentOnSelect: "field", commentMode: true })));
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
    // the quote is the commented line's text, plain, in the prose font, without its number
    assert.equal(await sheet.locator(".comment-sheet-quote").textContent(), SYNC_LINES[7]!.trim(), "the sheet quotes the commented line's text");
    assert.equal(await sheet.locator(".comment-popover-code-number").count(), 0, "without its number");
    assert.deepEqual(await sheet.locator(".comment-sheet-quote").evaluate((node) => {
      const style = getComputedStyle(node);
      const probe = document.createElement("span");
      probe.style.cssText = "color: var(--text-dim); border-left: var(--rail-w) solid var(--border-strong)";
      document.body.append(probe);
      const wanted = getComputedStyle(probe);
      const same = style.color === wanted.color && style.borderLeftWidth === wanted.borderLeftWidth && style.borderLeftColor === wanted.borderLeftColor;
      probe.remove();
      return [same, style.webkitLineClamp, style.fontFamily.includes("monospace") || style.fontFamily.includes("Mono")];
    }), [true, "3", false], "drawn as a blockquote is: the rail, --text-dim, three lines, in the prose font");
    assert.equal(await popoverText(page, true), "Compare with <=.");
    // as a card tapped to edit: the sheet has the focus, not its field (no keyboard)
    assert.equal(await focusedMatches(page, ".comment-editor-field"), false, "the field does not take the focus");
    assert.equal(await viewer.locator(".comment-popover.is-row").count(), 0, "no row under the line");
    console.log("PASS code-touch (phone): the composer's walk to a code comment with the mode on opens its bottom sheet, as a finger's tap on the card does");
    assert.deepEqual(errors, []);
    await close();
  },

  /**
   * The comment mode in the Markdown preview (MarkdownComments.tsx): the header's toggle shows there too, named Comment
   * mode. Off, a mouse's drag selects text as text and opens nothing; on, the same drag opens the field over the
   * selection at once, its bottom 8 px above the selection's first line, the selection in the strong fill. Turning the
   * mode off leaves the field, which keeps what was typed.
   */
  async "preview-mode"(open) {
    const { page, errors, close } = await open(DESKTOP);
    const viewer = await openSpec(page);
    const toggle = viewer.locator("button.file-viewer-comments");
    await toggle.waitFor();
    assert.equal(await toggle.getAttribute("aria-label"), "Comment mode", "the preview's toggle is named Comment mode");
    assert.equal(await toggle.getAttribute("aria-pressed"), "false", "the mode starts off");
    const line4 = previewLine(viewer, 4);
    const words = "revision it stores";
    await dragText(page, viewer, line4, "revision", line4, "stores");
    await frames(page, 10);
    assert.equal(await popoverOf(page).count(), 0, "with the mode off a drag opens nothing");
    assert.equal(await page.evaluate(() => window.getSelection()?.toString()), words, "and selects the dragged text as text");
    console.log("PASS preview-mode: the preview's header shows the toggle, named Comment mode; with the mode off a drag selects its text and opens nothing");

    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await toggle.click();
    await eventually("the mode to turn on", async () => (await toggle.getAttribute("aria-pressed")) === "true");
    await dragText(page, viewer, line4, "revision", line4, "stores");
    const field = selectionFieldIn(viewer);
    await field.waitFor();
    await eventually("the selection in the strong fill", async () => (await strongText(page)) === words);
    await assertFieldOver(page, viewer, field, "a drag over line 4");
    assert.equal(await focusedMatches(page, ".comment-editor-field"), false, "the field leaves the focus where it was until a key is typed");
    assert.equal(await page.evaluate(() => window.getSelection()?.toString()), words, "the selection stays as it was");
    console.log("PASS preview-mode: with the mode on the same drag opens the field over the selection, 8 px above its first line, the selection in the strong fill");

    await page.keyboard.type("Mode note");
    assert.equal(await fieldOf(page).inputValue(), "Mode note", "typing goes straight into the field");
    // a keyboard's press of the toggle: the focus leaves the field without leaving it; the mode turned off does
    await toggle.focus();
    await page.keyboard.press("Enter");
    await eventually("the mode to turn off", async () => (await toggle.getAttribute("aria-pressed")) === "false");
    await field.waitFor({ state: "detached" });
    assert.deepEqual(await storedPreview(page), [{ lines: [4, 4], comment: "Mode note", text: words }]);
    console.log("PASS preview-mode: typed text goes into the field; the mode turned off leaves it, and the comment is stored");

    // a selection made with the mode off, the mode turned on: a press or a Shift that changes nothing opens no field on it
    const line3 = previewLine(viewer, 3);
    await dragText(page, viewer, line3, "write", line3, "carries");
    await frames(page, 10);
    assert.equal(await field.count(), 0, "with the mode off the drag opens nothing");
    await toggle.click();
    await eventually("the mode to turn on", async () => (await toggle.getAttribute("aria-pressed")) === "true");
    assert.equal(await page.evaluate(() => window.getSelection()?.toString()), "write carries", "the selection made with the mode off is still there");
    // the focus off the toggle (a button's keys are its own), then Shift alone: the selection is as it was
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Shift");
    await frames(page, 10);
    assert.equal(await field.count(), 0, "a Shift that changes nothing opens no field on the old selection");
    // a press and release on the body's background, beside the text, below the header: nothing selected anew
    const background = await viewer.locator(".file-viewer-body").evaluate((node) => {
      const box = node.getBoundingClientRect();
      return { x: box.left + 4, y: box.top + 4 };
    });
    await page.mouse.click(background.x, background.y);
    await frames(page, 10);
    assert.equal(await field.count(), 0, "a press on the background opens no field on the old selection");
    // a press on a button in the text (a code block's Copy) leaves the selection as it is: the same again, made with the
    // mode off, then the mode on
    await toggle.click();
    await eventually("the mode to turn off", async () => (await toggle.getAttribute("aria-pressed")) === "false");
    await dragText(page, viewer, line3, "write", line3, "carries");
    await toggle.click();
    await eventually("the mode to turn on", async () => (await toggle.getAttribute("aria-pressed")) === "true");
    const copy = viewer.locator('.markdown-code[data-language="ts"] .markdown-code-copy');
    // its header (language and Copy) shows while the block is under the pointer
    await viewer.locator('.markdown-code[data-language="ts"]').hover();
    await copy.click();
    await frames(page, 10);
    assert.equal(await page.evaluate(() => window.getSelection()?.toString()), "write carries", "the press on Copy left the selection as it was");
    assert.equal(await field.count(), 0, "a press that changes nothing opens no field on the old selection");
    console.log("PASS preview-mode: a selection made with the mode off opens no field once the mode is on, on a Shift or a press (the background, a code block's Copy) that changes nothing");
    assert.deepEqual(errors, []);
    await close();
  },

  /**
   * Writing a comment in the preview with the mode on: a drag, then typing straight away and Enter stores it on the
   * dragged words (their text in a comment layer); Escape and a press elsewhere keep what was typed, an empty field
   * leaves nothing, Shift+Enter breaks the line; a keyboard's selection opens the field once Shift is let go; and
   * selecting a stored comment's place opens it with its text.
   */
  async preview(open) {
    const { page, errors, close } = await open(DESKTOP);
    const viewer = await openSpec(page);
    const body = viewer.locator(".file-viewer-body");
    await modeOn(viewer);
    const field = selectionFieldIn(viewer);
    const line4 = previewLine(viewer, 4);

    // 1. a drag, typing at once (no click), Enter; the field takes no focus, so the layer's live region says it opened
    const status = viewer.locator(".file-viewer-body > .markdown-comments-status[role='status']");
    assert.equal(await status.textContent(), "", "the live region is there, silent, before anything opens");
    await dragText(page, viewer, line4, "revision", line4, "stores");
    await field.waitFor();
    await eventually("the live region to say the field opened", async () => (await status.textContent()) === "Comment field open");
    await page.keyboard.type("Why?");
    await page.keyboard.press("Enter");
    await field.waitFor({ state: "detached" });
    assert.deepEqual(await storedPreview(page), [{ lines: [4, 4], comment: "Why?", text: "revision it stores" }]);
    await eventually("its text in the first comment layer", async () => (await highlightText(page, "comment-layer-0")) === "revision it stores");
    assert.equal(await page.evaluate(() => window.getSelection()?.isCollapsed ?? true), true, "the selection is cleared");
    assert.equal(await body.locator(".comment-pin").count(), 0, "the preview has no pins");
    console.log("PASS preview: a drag, typing at once and Enter store the comment on the dragged words, drawn in comment-layer-0; a live region says the field opened");

    // 2. Escape keeps what was typed in a new field, and the viewer stays
    const line3 = previewLine(viewer, 3);
    await dragText(page, viewer, line3, "write", line3, "carries");
    await field.waitFor();
    await page.keyboard.type("Kept by Escape");
    await page.keyboard.press("Escape");
    await field.waitFor({ state: "detached" });
    assert.ok(await viewer.isVisible(), "Escape leaves the field, not the viewer");
    assert.ok((await storedPreview(page)).some((c) => c.comment === "Kept by Escape" && c.text === "write carries"), "Escape stored it");

    // 3. a press elsewhere keeps it
    await dragText(page, viewer, previewLine(viewer, 8), "Rule", previewLine(viewer, 8), "revisions");
    await field.waitFor();
    await page.keyboard.type("Kept by a press");
    const away = await wordPoint(previewLine(viewer, 12), "order");
    await page.mouse.click(away.x, away.y);
    await field.waitFor({ state: "detached" });
    await frames(page);
    assert.equal(await field.count(), 0, "a click opens no field");
    assert.ok((await storedPreview(page)).some((c) => c.comment === "Kept by a press" && c.text === "Rule 1 of the revisions"), "a press elsewhere stored it");
    console.log("PASS preview: Escape and a press elsewhere keep what was typed; the viewer stays");

    // 4. an empty field and Escape: nothing stored, the selection cleared
    await dragText(page, viewer, previewLine(viewer, 10), "Rule", previewLine(viewer, 10), "revisions");
    await field.waitFor();
    await page.keyboard.press("Escape");
    await field.waitFor({ state: "detached" });
    assert.ok(await viewer.isVisible(), "the viewer stays");
    assert.equal((await storedPreview(page)).length, 3, "an empty field leaves nothing");
    assert.equal(await page.evaluate(() => window.getSelection()?.isCollapsed ?? true), true, "the selection is cleared");
    console.log("PASS preview: Escape on an empty field leaves nothing and clears the selection");

    // 5. Shift+Enter breaks the line, Enter saves
    await dragText(page, viewer, previewLine(viewer, 14), "Rule", previewLine(viewer, 14), "revisions");
    await field.waitFor();
    await page.keyboard.type("first");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("second");
    assert.equal(await fieldOf(page).inputValue(), "first\nsecond");
    await page.keyboard.press("Enter");
    await field.waitFor({ state: "detached" });
    assert.ok((await storedPreview(page)).some((c) => c.comment === "first\nsecond" && c.text === "Rule 4 of the revisions"), "stored with its line break");
    console.log("PASS preview: Shift+Enter breaks the line");

    // 6. the keyboard: a word selected, Shift+ArrowRight twice; the field opens as Shift is let go, not before
    const line16 = previewLine(viewer, 16);
    await line16.evaluate((node) => {
      node.scrollIntoView({ block: "center" });
      const text = document.createTreeWalker(node, NodeFilter.SHOW_TEXT).nextNode() as Text;
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, 4);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
    });
    await page.keyboard.down("Shift");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await frames(page, 10);
    assert.equal(await page.evaluate(() => window.getSelection()?.toString()), "Rule 5", "Shift+ArrowRight extends the selection");
    assert.equal(await field.count(), 0, "no field while Shift is held");
    await page.keyboard.up("Shift");
    await field.waitFor();
    await eventually("the keyboard's selection in the strong fill", async () => (await strongText(page)) === "Rule 5");
    await assertFieldOver(page, viewer, field, "a keyboard's selection");
    await page.keyboard.press("Escape");
    await field.waitFor({ state: "detached" });
    console.log("PASS preview: a keyboard's selection (Shift+arrows) opens the field once Shift is let go");

    // 7. the stored comment's place selected again opens it, its text in the field
    await dragText(page, viewer, line4, "revision", line4, "stores");
    await field.waitFor();
    assert.equal(await fieldOf(page).inputValue(), "Why?", "the comment there opens with its text");
    await eventually("its text in the strong fill", async () => (await strongText(page)) === "revision it stores");
    await page.keyboard.press("Escape");
    await field.waitFor({ state: "detached" });
    assert.equal((await storedPreview(page)).filter((c) => c.comment === "Why?").length, 1, "left unchanged, it stays as it was");
    console.log("PASS preview: selecting a stored comment's place opens it with its text");

    // 8. text typed in the field, then the viewer closed by the keyboard (Close file focused and Enter: no press outside
    // the field): the layer goes, and what was typed is stored, as leaving the field would store it
    await dragText(page, viewer, previewLine(viewer, 12), "order", previewLine(viewer, 12), "order");
    await field.waitFor();
    await page.keyboard.type("Kept as the viewer closes");
    await viewer.getByRole("button", { name: "Close file", exact: true }).focus();
    await page.keyboard.press("Enter");
    await viewer.waitFor({ state: "detached" });
    await eventually("the typed comment stored", async () => (await storedPreview(page)).some((c) => c.comment === "Kept as the viewer closes" && c.text === "order"));
    console.log("PASS preview: text typed in the field is stored when the viewer is closed by the keyboard");
    assert.deepEqual(errors, []);
    await close();
  },

  /**
   * Where a selection in the preview starts or ends does not matter (lib/markdownSelection.ts `clampSelection`): released
   * in the margin beside a line (Chrome runs the selection on), dragged backwards (into the margin too), ending on a
   * heading or on a code block's language label, across a table's rows, or starting on the white space between blocks.
   */
  async "preview-select"(open) {
    const { page, errors, close } = await open(DESKTOP);
    const viewer = await openSpec(page);
    await modeOn(viewer);
    const field = selectionFieldIn(viewer);
    const markdown = viewer.locator(".file-viewer-markdown");
    const leave = async (): Promise<void> => {
      await page.keyboard.press("Escape");
      await field.waitFor({ state: "detached" });
    };
    const save = async (text: string): Promise<void> => {
      await page.keyboard.type(text);
      await page.keyboard.press("Enter");
      await field.waitFor({ state: "detached" });
    };
    const storedAs = async (comment: string): Promise<{ lines: number[]; text: string | null } | undefined> => {
      const found = (await storedPreview(page)).find((c) => c.comment === comment);
      return found === undefined ? undefined : { lines: found.lines, text: found.text };
    };

    // 1. released in the margin right of line 4, over the cards' column (CommentMargin.tsx), empty yet: line 4's text
    // only, and the visible selection says so. From step 2 on a card stands there, and a press on a card is the card's:
    // the later releases beside the text are in the gap between the text and the cards
    const line4 = previewLine(viewer, 4);
    await line4.evaluate((node) => node.scrollIntoView({ block: "center" }));
    const start4 = await wordEdge(line4, "compares", false);
    const box = await markdown.evaluate((node) => { const rect = node.getBoundingClientRect(); return { left: rect.left, right: rect.right }; });
    await dragPoints(page, start4, { x: box.right + 40, y: start4.y });
    await field.waitFor();
    await eventually("line 4's text in the strong fill", async () => (await strongText(page)) === SPEC_LINES[3]);
    assert.equal(await page.evaluate(() => window.getSelection()?.toString()), SPEC_LINES[3], "the visible selection is cut back to line 4");
    await assertFieldOver(page, viewer, field, "a drag released in the margin");
    await leave();
    console.log("PASS preview-select: a drag released in the margin right of line 4 opens the field for line 4's text only");

    // 2. a real backward drag, from the end of line 4 to the start of line 3
    const line3 = previewLine(viewer, 3);
    const end4 = await wordEdge(line4, "stores.", true);
    const start3 = await wordEdge(line3, "A write", false);
    await dragPoints(page, end4, start3);
    await field.waitFor();
    assert.equal(await page.evaluate(() => {
      const selection = window.getSelection()!;
      const range = document.createRange();
      range.setStart(selection.anchorNode!, selection.anchorOffset);
      range.setEnd(selection.focusNode!, selection.focusOffset);
      return range.collapsed;
    }), true, "the drag left a backward selection");
    await save("Back");
    assert.deepEqual(await storedAs("Back"), { lines: [3, 4], text: `${SPEC_LINES[2]}\n${SPEC_LINES[3]}` });
    console.log("PASS preview-select: a backward drag from line 4's end to line 3's start comments on both lines");

    // 3. backward again, released in the margin left of line 3: cut back to line 3's start, where that comment is
    // (left of the text: the body's padding, and what the text, centred at its set width, leaves of the body's width)
    await dragPoints(page, end4, { x: box.left - 6, y: start3.y });
    await field.waitFor();
    assert.equal(await fieldOf(page).inputValue(), "Back", "the backward drag released beside line 3 selects the same place, which opens its comment");
    assert.equal(await page.evaluate(() => window.getSelection()?.toString().replace(/\s+/g, " ")), `${SPEC_LINES[2]} ${SPEC_LINES[3]}`, "the visible selection is cut back to line 3's start");
    await leave();
    console.log("PASS preview-select: a backward drag released in the margin left of line 3 is cut back to line 3");

    // 3b. where Chrome runs the selection on to the document's end (forward) or start (backward) as a drag is released
    // beside the text (this preview's Chrome stops at the line, so the selection is run on by hand between a real press
    // and release in the margin): the end the drag extended is cut back to the line at the release's height
    const runaway = async (at: { x: number; y: number }, backward: boolean): Promise<void> => {
      await page.mouse.move(at.x, at.y);
      await page.mouse.down();
      await line4.evaluate((node, back) => {
        const text = document.createTreeWalker(node, NodeFilter.SHOW_TEXT).nextNode() as Text;
        const doc = node.closest(".file-viewer-markdown")!;
        const selection = window.getSelection()!;
        if (back) selection.setBaseAndExtent(text, text.length, doc, 0);
        else selection.setBaseAndExtent(text, text.data.indexOf("compares"), doc, doc.childNodes.length);
      }, backward);
      await page.mouse.up();
    };
    await runaway({ x: box.right + 8, y: start4.y }, false);
    await field.waitFor();
    await eventually("line 4's text in the strong fill", async () => (await strongText(page)) === SPEC_LINES[3]);
    assert.equal(await page.evaluate(() => window.getSelection()?.toString()), SPEC_LINES[3], "the selection run on to the end is cut back to line 4");
    await leave();
    await runaway({ x: box.left - 6, y: start3.y }, true);
    await field.waitFor();
    assert.equal(await fieldOf(page).inputValue(), "Back", "the selection run back to the start is cut to line 3, the place of that comment");
    assert.equal(await page.evaluate(() => {
      const selection = window.getSelection()!;
      const range = document.createRange();
      range.setStart(selection.anchorNode!, selection.anchorOffset);
      range.setEnd(selection.focusNode!, selection.focusOffset);
      return range.collapsed && !selection.isCollapsed;
    }), true, "the visible selection keeps its direction");
    await leave();
    console.log("PASS preview-select: a selection Chrome runs on to the document's end or start, released beside a line, is cut back to that line");

    // 4. ending on a heading
    await dragText(page, viewer, line4, "revision", previewLine(viewer, 6), "Revisions");
    await field.waitFor();
    await save("Heading end");
    assert.deepEqual(await storedAs("Heading end"), { lines: [4, 6], text: "revision it stores.\nRevisions" });
    console.log("PASS preview-select: a drag ending on a heading takes the heading's text");

    // 5. a backward drag from the long block's first line ending on the ```ts block's language label: from its last code line
    const log1 = previewLine(viewer, FOLD_FIRST);
    await log1.evaluate((node) => node.scrollIntoView({ block: "center" }));
    const fromLog = await wordEdge(log1, "log line 1", true);
    const label = viewer.locator('.markdown-code[data-language="ts"] .markdown-code-header span').first();
    const onLabel = await label.evaluate((node) => { const rect = node.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; });
    await dragPoints(page, fromLog, onLabel);
    await field.waitFor();
    await save("Label end");
    assert.deepEqual(await storedAs("Label end"), { lines: [50, FOLD_FIRST], text: `${SPEC_LINES[49]}\nlog line 1` });
    console.log("PASS preview-select: a drag ending on the ts block's language label ends at its last code line, the label left out");

    // 6. across the table's rows 42–43: the cells set off by " | "
    await dragText(page, viewer, previewLine(viewer, 42), "Older revision", previewLine(viewer, 43), "merged note");
    await field.waitFor();
    await save("Rows");
    assert.deepEqual(await storedAs("Rows"), { lines: [42, 43], text: "Older revision | 409 Conflict with the stored note\nNewer revision | 200 with the merged note" });
    console.log("PASS preview-select: a drag across the table's rows 42–43 stores their cells joined by \" | \"");

    // 7. starting on the white space between the paragraph and the heading: from the heading's text
    const heading = previewLine(viewer, 6);
    await heading.evaluate((node) => node.scrollIntoView({ block: "center" }));
    const gap = await viewer.evaluate((node) => {
      const paragraph = node.querySelector('.file-viewer-markdown [data-source-line="4"]')!.closest("p")!.getBoundingClientRect();
      const title = node.querySelector('.file-viewer-markdown [data-source-line="6"]')!.getBoundingClientRect();
      return { x: title.left + 4, y: (paragraph.bottom + title.top) / 2, room: title.top - paragraph.bottom };
    });
    assert.ok(gap.room > 4, `there is white space between the blocks (${gap.room}px)`);
    await dragPoints(page, gap, await wordEdge(heading, "Revisions", true));
    await field.waitFor();
    await save("Gap start");
    assert.deepEqual(await storedAs("Gap start"), { lines: [6, 6], text: "Revisions" });
    console.log("PASS preview-select: a drag starting between blocks starts at the next block's text");
    assert.deepEqual(errors, []);
    await close();
  },

  /**
   * The Comment button, the default (Settings → Comments → When you select text: Show a Comment button): with the mode
   * off a drag shows none; on, a drag shows it under the selection's end, no field; the selection stays the browser's
   * and copies; typing opens nothing; it scrolls with the text; Escape hides it (the viewer and the selection stay), and so does a press
   * elsewhere; its click opens the field over the selection, focused, and typing and Enter save; on the comment's place
   * it opens that comment; a keyboard's selection shows it as Shift is let go, Tab reaches it and Enter opens the field.
   */
  async "preview-button"(open) {
    const { page, errors, close } = await open(DESKTOP, [], { commentOnSelect: "button" });
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    const viewer = await openSpec(page);
    const body = viewer.locator(".file-viewer-body");
    const button = body.getByRole("button", { name: "Comment on the selection", exact: true });
    const field = selectionFieldIn(viewer);
    const status = viewer.locator(".file-viewer-body > .markdown-comments-status[role='status']");
    const line4 = previewLine(viewer, 4);
    const words = "revision it stores";
    const selected = (): Promise<string> => page.evaluate(() => window.getSelection()?.toString() ?? "");
    /** The button's top less the selection's last line's bottom, and whether it spans the selection's end, sideways. */
    const placed = (): Promise<{ gap: number; atEnd: boolean; inside: boolean }> => viewer.evaluate((node) => {
      const rects = [...window.getSelection()!.getRangeAt(0).getClientRects()].filter((rect) => rect.width > 0);
      const last = rects.at(-1)!;
      const box = node.querySelector(".markdown-select-comment")!.getBoundingClientRect();
      const outer = node.querySelector(".file-viewer-body")!.getBoundingClientRect();
      return { gap: box.top - last.bottom, atEnd: box.left <= last.right && box.right >= last.right, inside: box.left >= outer.left && box.right <= outer.right };
    });

    await dragText(page, viewer, line4, "revision", line4, "stores");
    await frames(page, 10);
    assert.equal(await button.count(), 0, "the mode off, a drag shows no button");
    await page.evaluate(() => window.getSelection()?.removeAllRanges());

    await modeOn(viewer);
    await dragText(page, viewer, line4, "revision", line4, "stores");
    await button.waitFor();
    await frames(page, 10);
    assert.equal(await field.count(), 0, "no field opens with the button");
    assert.equal(await selected(), words, "the selection stays the browser's");
    await eventually("the live region to say the button shows", async () => (await status.textContent()) === "Comment button shown");
    assert.equal(await focusedMatches(page, ".markdown-select-comment"), false, "the focus stays where it was");
    const at = await placed();
    assert.ok(Math.abs(at.gap - 8) <= 1 && at.atEnd && at.inside, `the button sits 8 px under the selection's last line, at its end, inside the body (${JSON.stringify(at)})`);
    await page.keyboard.type("x");
    await frames(page, 6);
    assert.equal(await popoverOf(page).count(), 0, "typing opens no field");
    await page.evaluate(() => navigator.clipboard.writeText(""));
    await page.keyboard.press("ControlOrMeta+c");
    await eventually("the selection copied", async () => (await page.evaluate(() => navigator.clipboard.readText())) === words);
    assert.ok(await button.isVisible(), "the button stays as the selection is copied");
    await body.evaluate((node) => node.scrollBy({ top: 60, behavior: "instant" }));
    await frames(page, 4);
    const scrolled = await placed();
    assert.ok(Math.abs(scrolled.gap - at.gap) <= 1, `it scrolls with the text (${JSON.stringify({ at, scrolled })})`);
    console.log("PASS preview-button: in the mode a drag shows the Comment button 8 px under the selection's end, no field; the selection copies; typing opens nothing; it scrolls with the text");

    await page.keyboard.press("Escape");
    await button.waitFor({ state: "detached" });
    assert.ok(await viewer.isVisible(), "Escape hides the button, not the viewer");
    assert.equal(await popoverOf(page).count(), 0, "and opens nothing");
    assert.equal(await selected(), words, "and leaves the selection");
    // a press elsewhere drops the selection (a press inside it would drag its text); the same words selected anew
    const away = await wordPoint(previewLine(viewer, 12), "order");
    await page.mouse.click(away.x, away.y);
    await frames(page, 6);
    assert.equal(await button.count(), 0, "a press elsewhere shows no button");
    await dragText(page, viewer, line4, "revision", line4, "stores");
    await button.waitFor();
    await page.mouse.click(away.x, away.y);
    await button.waitFor({ state: "detached" });
    await frames(page, 6);
    assert.equal(await popoverOf(page).count(), 0, "a press elsewhere opens nothing");
    console.log("PASS preview-button: Escape hides the button (the viewer and the selection stay), the same words selected anew show it again, and a press elsewhere hides it");

    await dragText(page, viewer, line4, "revision", line4, "stores");
    await button.click();
    await field.waitFor();
    assert.equal(await button.count(), 0, "the button goes as the field opens");
    await fieldFocused(page);
    await eventually("the selection in the strong fill", async () => (await strongText(page)) === words);
    await assertFieldOver(page, viewer, field, "the button's field");
    await page.keyboard.type("Why?");
    await page.keyboard.press("Enter");
    await field.waitFor({ state: "detached" });
    assert.deepEqual(await storedPreview(page), [{ lines: [4, 4], comment: "Why?", text: words }]);
    await dragText(page, viewer, line4, "revision", line4, "stores");
    await button.click();
    await field.waitFor();
    assert.equal(await fieldOf(page).inputValue(), "Why?", "on the comment's place the button opens that comment");
    await page.keyboard.press("Escape");
    await field.waitFor({ state: "detached" });
    console.log("PASS preview-button: a click on the button opens the field over the selection, focused; typing and Enter store it; on its place it opens that comment");

    const line3 = previewLine(viewer, 3);
    await selectText(line3, "write", line3, "carries");
    await button.waitFor();
    assert.equal(await field.count(), 0, "a keyboard's selection shows the button too");
    await page.keyboard.press("Tab");
    await eventually("Tab to reach the button", () => focusedMatches(page, ".markdown-select-comment"));
    await page.keyboard.press("Enter");
    await field.waitFor();
    await fieldFocused(page);
    await eventually("the keyboard's selection in the strong fill", async () => (await strongText(page)) === "write carries");
    await page.keyboard.press("Escape");
    await field.waitFor({ state: "detached" });
    assert.equal((await storedPreview(page)).length, 1, "an empty field leaves nothing");
    console.log("PASS preview-button: a keyboard's selection shows the button as Shift is let go; Tab reaches it, Enter opens the field");
    assert.deepEqual(errors, []);
    await close();
  },

  /**
   * Two preview comments whose selections overlap on line 4 (columns 0–20 and 10–30): each is a highlight of its own (a
   * layer, lib/commentLayers.ts), so where they overlap their fills add up. On a screenshot of the line, in every palette
   * (Amber, Charcoal, Catppuccin; dark and light), a space in the overlap stands further from the page's colour than a
   * space in either part alone, and both stand off the page. In a dark palette the accent's fill lightens the page, in a
   * light one it darkens it: the distance from the page's colour is what reads as "darker". The strong fill (the comment
   * in focus) stands off the rest fill the same way.
   */
  async "preview-overlap"(open) {
    const specPath = realpathSync(join(root, "docs", "spec.md"));
    const text = SPEC_LINES[3]!;
    assert.equal(text, "compares it with the revision it stores.");
    const selected = (id: string, from: number, to: number, created: number): object => ({
      ...seededComment(id, specPath, "docs/spec.md", "preview", SPEC_LINES, 4, 4, `Note ${id}`, created, [text]),
      anchor: `file:${specPath}:preview:4-4@0.${from}-0.${to}`,
      selection: { text: text.slice(from, to), start: [0, from], end: [0, to] },
    });
    const { page, errors, close } = await open(DESKTOP, [selected("seed-overlap-a", 0, 20, 1), selected("seed-overlap-b", 10, 30, 2)]);
    const viewer = await openSpec(page);
    const line = previewLine(viewer, 4);
    await line.waitFor();

    // each comment's text is in a layer of its own
    const layers = (): Promise<string[]> => page.evaluate(() => {
      const registry = (CSS as unknown as { highlights?: { get(key: string): Iterable<AbstractRange> | undefined } }).highlights;
      return [0, 1, 2, 3].map((n) => [...(registry?.get(`comment-layer-${n}`) ?? [])].map((range) => range instanceof Range ? range.toString() : "").join("|"));
    });
    await eventually("both comments' text in layers of their own", async () => {
      const shown = await layers();
      return shown.includes(text.slice(0, 20)) && shown.includes(text.slice(10, 30));
    }).catch(async (error: Error) => { throw new Error(`${error.message} (layers: ${JSON.stringify(await layers())})`); });
    console.log("PASS preview-overlap: two overlapping comments are painted on two layers");

    await modeOn(viewer);
    await page.mouse.move(0, 0);
    /** where to sample: the middle of a space's box (no glyph there), and the page past the line's end */
    const points = await line.evaluate((node, columns) => {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      for (let next = walker.nextNode(); next !== null; next = walker.nextNode()) nodes.push(next as Text);
      const at = (column: number): DOMRect => {
        let left = column;
        for (const textNode of nodes) {
          if (left < textNode.length) {
            const range = document.createRange();
            range.setStart(textNode, left);
            range.setEnd(textNode, left + 1);
            return range.getBoundingClientRect();
          }
          left -= textNode.length;
        }
        throw new Error(`no column ${column} on line 4`);
      };
      const middle = (rect: DOMRect): { x: number; y: number } => ({ x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) });
      const last = at(columns.last);
      return {
        a: middle(at(columns.a)),
        overlap: middle(at(columns.overlap)),
        b: middle(at(columns.b)),
        page: { x: Math.round(last.right + 40), y: Math.round(last.top + last.height / 2) },
      };
    }, { a: 8, overlap: 11, b: 29, last: text.length - 1 });
    assert.deepEqual([8, 11, 29].map((n) => text[n]), [" ", " ", " "], "the samples are spaces");
    type Rgb = [number, number, number];
    const sample = async (): Promise<Record<keyof typeof points, Rgb>> => {
      await frames(page, 3);
      const shot = (await page.screenshot()).toString("base64");
      return page.evaluate(async ({ b64, at }) => {
        const image = new Image();
        image.src = `data:image/png;base64,${b64}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        const pixel = ({ x, y }: { x: number; y: number }): [number, number, number] => {
          const [r, g, b] = context.getImageData(x, y, 1, 1).data;
          return [r!, g!, b!];
        };
        return { a: pixel(at.a), overlap: pixel(at.overlap), b: pixel(at.b), page: pixel(at.page) };
      }, { b64: shot, at: points });
    };
    const off = (pixel: Rgb, page: Rgb): number => Math.hypot(pixel[0] - page[0], pixel[1] - page[1], pixel[2] - page[2]);
    /**
     * the first comment open brings its text up: the strong fill (`SurfaceMarks`). Its place selected by the keyboard
     * opens it (MarkdownComments.tsx), and its field takes the focus, so the browser's own selection paints nothing
     */
    const field = selectionFieldIn(viewer);
    const strong = async (on: boolean): Promise<void> => {
      if (on) {
        await selectText(line, "compares", line, "with the");
        await field.waitFor();
        await fieldOf(page).focus();
        assert.equal(await fieldOf(page).inputValue(), "Note seed-overlap-a", "the first comment opens");
      } else {
        await page.keyboard.press("Escape");
        await field.waitFor({ state: "detached" });
      }
      const want = on ? text.slice(0, 20) : "";
      await eventually(`the strong fill ${on ? "on" : "off"}`, async () => (await highlightText(page, "comment-strong")) === want);
    };
    const palettes = [["dark", "amber"], ["light", "amber"], ["dark", "charcoal"], ["light", "charcoal"], ["dark", "catppuccin"], ["light", "catppuccin"]] as const;
    const seen: string[] = [];
    for (const [theme, palette] of palettes) {
      await page.evaluate(({ theme, palette }) => {
        document.documentElement.dataset.theme = theme;
        document.documentElement.dataset.palette = palette;
      }, { theme, palette });
      const rest = await sample();
      const name = `${palette} ${theme}`;
      const alone = Math.min(off(rest.a, rest.page), off(rest.b, rest.page));
      const overlap = off(rest.overlap, rest.page);
      assert.ok(alone > 6, `${name}: each part alone stands off the page (${JSON.stringify(rest)})`);
      assert.ok(overlap > Math.max(off(rest.a, rest.page), off(rest.b, rest.page)) + 4, `${name}: the overlap stands further off the page than either part (${JSON.stringify(rest)})`);
      await strong(true);
      const focused = await sample();
      await strong(false);
      const strongOff = off(focused.a, focused.page);
      assert.ok(strongOff > off(rest.a, rest.page) + 4, `${name}: the strong fill stands further off the page than the rest fill (${JSON.stringify(focused)})`);
      seen.push(`${name}: page ${rest.page.join(",")} a ${rest.a.join(",")} b ${rest.b.join(",")} overlap ${rest.overlap.join(",")} strong ${focused.a.join(",")} (off the page: alone ${alone.toFixed(0)}, overlap ${overlap.toFixed(0)}, strong ${strongOff.toFixed(0)})`);
      if (process.env.PREVIEW_OVERLAP_SHOTS) await viewer.locator(".file-viewer-markdown p").first().screenshot({ path: join(process.env.PREVIEW_OVERLAP_SHOTS, `${palette}-${theme}.png`) }).catch(() => undefined);
    }
    for (const entry of seen) console.log(`  ${entry}`);
    console.log("PASS preview-overlap: in Amber, Charcoal and Catppuccin, dark and light, the overlap reads stronger than either part, each part off the page, the strong fill over the rest");
    assert.deepEqual(errors, []);
    await close();
  },

  /**
   * Cards in the margin (CommentMargin.tsx; Settings → Comments beside the text: cards, the default) where the free space
   * right of the text holds them: on a desktop with the text set narrower than any setting does (`ROOMY_TEXT`; a desktop's
   * dialog has no room for them otherwise, `preview-counts`; a wide touch screen's has, `preview-touch-wide`). One card per comment in reading order, each level with its
   * text's first line unless pushed below the one above, 8 px apart at least, 24 px right of the text, which keeps the
   * place and width it has with comments off; nothing clips or covers a card; no line numbers. With the mode off a
   * card is read-only (no bin, a click opens nothing); in the mode a click turns it into the field in its place (no
   * scroll), whose growing pushes the cards below at once and never moves the card above; Escape saves; the bin deletes.
   * The text column does not move as the first comment is saved. A whole-line comment from before shows a card and a
   * mark, and stays a whole-line comment when edited.
   */
  async "preview-cards"(open) {
    const ids = ["seed-card-3", "seed-card-4", "seed-card-42"];
    const notes = ["Say which revision.", "Stored where?", "Which status for a retry?"];
    /** A desktop with `ROOMY_TEXT`: room for cards right of the preview's text. */
    const roomy = async (seed: readonly object[] = [], settings: Record<string, unknown> = {}): Promise<Opened> => {
      const opened = await open(DESKTOP, seed, settings);
      await opened.page.addStyleTag({ content: ROOMY_TEXT });
      return opened;
    };
    // the text with comments off, on the same screen: where it is with cards beside it
    const plain = await roomy([], { comments: false });
    const plainText = await textBoxOf(await openSpec(plain.page));
    await plain.close();
    let { page, errors, close } = await roomy([
      selectedComment(ids[0]!, 3, 2, 7, notes[0]!, 1),
      selectedComment(ids[1]!, 4, 0, 8, notes[1]!, 2),
      selectedComment(ids[2]!, 42, 0, 14, notes[2]!, 3),
    ]);
    let viewer = await openSpec(page);
    const body = viewer.locator(".file-viewer-body");
    const markdown = viewer.locator(".file-viewer-markdown");
    const cards = cardsIn(viewer);
    await eventually("three cards", async () => (await cards.count()) === 3);

    // 1. reading order, each level with its text's first line unless pushed, none overlapping, 8 px apart at least
    const wants = [await wordTop(previewLine(viewer, 3), "write"), await wordTop(previewLine(viewer, 4), "compares"), await wordTop(previewLine(viewer, 42), "Older")];
    let seen: unknown = null;
    await eventually("the cards level with their text, pushed down only", async () => {
      const boxes = await boxesOf(cards);
      const order = await cards.evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.commentId));
      seen = { boxes, order, wants };
      if (order.join() !== ids.join()) return false;
      let below = Number.NEGATIVE_INFINITY;
      for (const [index, box] of boxes.entries()) {
        if (Math.abs(box.y - Math.max(wants[index]!, below + 8)) > 2) return false;
        below = box.y + box.height;
      }
      return true;
    }).catch((error: Error) => { throw new Error(`${error.message} (${JSON.stringify(seen)})`); });
    const boxes = await boxesOf(cards);
    assert.ok(wants[1]! < boxes[0]!.y + boxes[0]!.height + 8, "the second card was pushed below the first");
    for (let index = 1; index < boxes.length; index++) {
      assert.ok(boxes[index]!.y - (boxes[index - 1]!.y + boxes[index - 1]!.height) >= 7.5, `card ${index + 1} is 8 px below the one above at least (${JSON.stringify(boxes)})`);
    }
    const column = await textBoxOf(viewer);
    assert.ok(Math.abs(column.left - plainText.left) <= 0.5 && Math.abs(column.width - plainText.width) <= 0.5, `the text has the place and width it has with comments off (${JSON.stringify({ column, plainText })})`);
    for (const box of boxes) {
      assert.ok(Math.abs(box.x - (column.right + 24)) <= 1, `a card is 24 px right of the text (${JSON.stringify({ box, column })})`);
      assert.ok(Math.abs(box.width - 280) <= 1, `a card is 280 px wide (${box.width})`);
      assert.ok(box.x + box.width <= column.bodyRight + 0.5, `a card lies inside the body (${JSON.stringify({ box, column })})`);
    }
    for (const index of [0, 1, 2]) assert.ok(await hitAtCentre(cards.nth(index)), `nothing clips or covers card ${index + 1}`);
    await body.evaluate((node) => { node.scrollTop = 0; });
    assert.doesNotMatch((await cards.allTextContents()).join(" "), /\b(Line|Lines) \d/, "no card names a line");
    assert.deepEqual((await cards.allTextContents()).map((text) => text.trim()), notes, "a card shows its comment's text");
    console.log("PASS preview-cards: three cards in reading order, each level with its text's first line unless pushed, none overlapping, 8 px apart at least, 280 px wide 24 px right of the text, which keeps its place and width, nothing over them, no line numbers");
    await marginShot(page, "cards");

    // 2. the mode off: read-only, no bin, a click opens nothing
    await cards.nth(0).hover();
    assert.equal(await viewer.locator(".markdown-comment-delete").count(), 0, "with the mode off a card has no bin");
    await cards.nth(0).click();
    await frames(page);
    assert.equal(await popoverOf(page).count(), 0, "with the mode off a click on a card opens nothing");
    console.log("PASS preview-cards: with the mode off a card has no bin and a click on it opens nothing");

    // 3. the mode on: hovering a card brings its text up and shows its bin; a click turns it into the field in its place
    await modeOn(viewer);
    await cards.nth(0).hover();
    await eventually("the hovered card's text in the strong fill", async () => (await strongText(page)) === "write");
    assert.ok(await cards.nth(0).locator(".markdown-comment-delete").isVisible(), "a hovered card shows its bin");
    assert.equal(await cards.nth(1).locator(".markdown-comment-delete").isVisible(), false, "another card's bin stays hidden");
    const scrolls = async (): Promise<number[]> => [await bodyScroll(viewer), await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0)];
    const before = await scrolls();
    const first = (await boxesOf(cards))[0]!;
    await cards.nth(0).locator(".markdown-comment-text").click();
    const cardField = cards.nth(0).locator(".comment-popover.is-row");
    await cardField.waitFor();
    assert.equal(await fieldOf(page).inputValue(), notes[0], "the card's field holds its comment");
    await fieldFocused(page);
    const fieldBox = (await cardField.boundingBox())!;
    assert.ok(Math.abs(fieldBox.y - first.y) <= 1 && Math.abs(fieldBox.x - first.x) <= 1 && Math.abs(fieldBox.width - first.width) <= 1, `the field is in the card's place (${JSON.stringify({ fieldBox, first })})`);
    assert.deepEqual(await scrolls(), before, "opening a card scrolls neither the body nor the page");
    assert.equal(await strongText(page), "write", "the open card's text is in the strong fill");
    await marginShot(page, "card-edit");
    console.log("PASS preview-cards: in the mode a hovered card brings its text up and shows its bin; a click opens its field in its place, scrolling nothing");

    // 4. typing pushes the cards below at once; the card above never moves; Escape saves
    const long = " It keeps every revision it was given in the order it came, and answers a stale one with a conflict.";
    await page.keyboard.press("End");
    await page.keyboard.type(long);
    await frames(page, 2);
    const grown = (await cardField.boundingBox())!;
    const pushed = (await boxesOf(cards))[1]!;
    assert.ok(grown.height > fieldBox.height + 20, `the field grew (${fieldBox.height} → ${grown.height})`);
    assert.ok(Math.abs(grown.y - fieldBox.y) <= 1, "the field keeps its top while it grows");
    await marginShot(page, "card-grown");
    assert.ok(Math.abs(pushed.y - (grown.y + grown.height + 8)) <= 2, `the card below is pushed under the grown field at once (${JSON.stringify({ grown, pushed })})`);
    // each frame from here on: how many cards are drawn, and the second one's top (the saved edit is a comment of a new id)
    await page.evaluate(() => {
      const seen: { cards: number; second: number | null }[] = [];
      (window as unknown as { cardFrames: typeof seen }).cardFrames = seen;
      const sample = (): void => {
        const drawn = [...document.querySelectorAll<HTMLElement>(".comment-margin > .markdown-comment-card")].filter((card) => card.style.visibility !== "hidden");
        seen.push({ cards: drawn.length, second: drawn[1]?.getBoundingClientRect().top ?? null });
        if (seen.length < 40) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await page.keyboard.press("Escape");
    await cardField.waitFor({ state: "detached" });
    await eventually("40 frames sampled", () => page.evaluate(() => (window as unknown as { cardFrames: unknown[] }).cardFrames.length >= 40));
    const sampled = await page.evaluate(() => (window as unknown as { cardFrames: { cards: number; second: number | null }[] }).cardFrames);
    assert.ok(sampled.every((frame) => frame.cards === 3), `the saved card never leaves the margin (${JSON.stringify(sampled.map((frame) => frame.cards))})`);
    assert.ok((await storedPreview(page)).some((c) => c.comment === `${notes[0]}${long}` && c.text === "write"), "Escape saved the edit");
    await eventually("three cards again", async () => (await cards.count()) === 3 && (await cards.nth(0).textContent())?.trim() === `${notes[0]}${long}`);
    const above = (await boxesOf(cards))[0]!;
    await cards.nth(1).locator(".markdown-comment-text").click();
    const second = cards.nth(1).locator(".comment-popover.is-row");
    await second.waitFor();
    await page.keyboard.press("End");
    await page.keyboard.type(long);
    await frames(page, 2);
    const still = (await boxesOf(cards))[0]!;
    assert.ok(Math.abs(still.y - above.y) <= 0.5 && Math.abs(still.height - above.height) <= 0.5, `a growing card never moves the card above (${JSON.stringify({ above, still })})`);
    await page.keyboard.press("Escape");
    await second.waitFor({ state: "detached" });
    assert.ok((await storedPreview(page)).some((c) => c.comment === `${notes[1]}${long}` && c.text === "compares"), "Escape saved the second edit");
    console.log("PASS preview-cards: typing in a card's field pushes the cards below at once and never moves the card above; Escape saves, and the saved card never leaves the margin");

    // 5. the bin deletes at once
    await cards.nth(2).hover();
    await cards.nth(2).locator(".markdown-comment-delete").click();
    await eventually("two cards", async () => (await cards.count()) === 2);
    assert.equal((await storedPreview(page)).some((c) => c.comment === notes[2]), false, "the bin deleted the comment");
    assert.equal((await storedPreview(page)).length, 2);
    console.log("PASS preview-cards: the bin deletes the comment at once");

    // 5b. the keyboard: Tab to a card, Enter opens its field, Escape stores it and gives the focus back to its card; its bin
    // by the keyboard deletes it and the focus goes to the card before (none after), then to the mode's toggle
    const focusedCard = (): Promise<{ text: string | null; card: string | null; toggle: boolean }> => page.evaluate(() => {
      const active = document.activeElement;
      return {
        text: active?.matches(".comment-margin .markdown-comment-text") ? active.textContent : null,
        card: active?.closest<HTMLElement>(".markdown-comment-card")?.dataset.commentId ?? null,
        toggle: active?.matches("button.file-viewer-comments") ?? false,
      };
    });
    await cards.nth(0).locator(".markdown-comment-text").focus();
    const secondId = await cards.nth(1).getAttribute("data-comment-id");
    for (let tab = 0; tab < 3 && (await focusedCard()).card !== secondId; tab++) await page.keyboard.press("Tab");
    assert.equal((await focusedCard()).card, secondId, "Tab reaches the second card");
    assert.ok((await focusedCard()).text !== null, "on its text button");
    await page.keyboard.press("Enter");
    const keyed = cards.nth(1).locator(".comment-popover.is-row");
    await keyed.waitFor();
    await fieldFocused(page);
    await page.keyboard.press("End");
    await page.keyboard.type(" By keys.");
    await page.keyboard.press("Escape");
    await keyed.waitFor({ state: "detached" });
    assert.ok((await storedPreview(page)).some((c) => c.comment === `${notes[1]}${long} By keys.`), "Escape stored the keyboard's edit");
    await eventually("the focus back on the edited card's text", async () => (await focusedCard()).text?.trim() === `${notes[1]}${long} By keys.`);
    await page.keyboard.press("Tab");
    assert.ok(await cards.nth(1).locator(".markdown-comment-delete").evaluate((node) => node === document.activeElement), "Tab goes on to the card's bin");
    await page.keyboard.press("Enter");
    await eventually("one card", async () => (await cards.count()) === 1);
    await eventually("the focus on the card before", async () => (await focusedCard()).text?.trim() === `${notes[0]}${long}`);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await eventually("no card", async () => (await cards.count()) === 0);
    await eventually("the focus on the mode's toggle", async () => (await focusedCard()).toggle);
    console.log("PASS preview-cards: by the keyboard, Tab reaches a card, Enter opens its field, Escape stores it with the focus back on its card; its bin deletes it, the focus on the card before, then on the mode's toggle");
    assert.deepEqual(errors, []);
    await close();

    // 6. an empty file's first comment, on a desktop (a count beside it): no text box moves or changes width
    ({ page, errors, close } = await open(DESKTOP));
    viewer = await openSpec(page);
    await modeOn(viewer);
    const textBoxes = (): Promise<{ left: number; width: number }[]> => viewer.evaluate((node) => [
      node.querySelector(".file-viewer-markdown")!,
      ...node.querySelectorAll('.file-viewer-markdown [data-source-line="3"], .file-viewer-markdown [data-source-line="42"], .file-viewer-markdown [data-source-line="50"]'),
    ].map((element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, width: box.width };
    }));
    const unmoved = await textBoxes();
    await dragText(page, viewer, previewLine(viewer, 4), "revision", previewLine(viewer, 4), "stores");
    await selectionFieldIn(viewer).waitFor();
    await page.keyboard.type("The first one.");
    await page.keyboard.press("Enter");
    await eventually("its count", async () => (await countsIn(viewer).count()) === 1);
    assert.deepEqual(await textBoxes(), unmoved, "saving the first comment moves no text box and changes no width");
    console.log("PASS preview-cards: saving the first comment of a file moves no text box and changes no width");
    assert.deepEqual(errors, []);
    await close();

    // 7. a whole-line comment from before (no selection): a card, its paragraph marked, and edited it stays on whole lines
    const specPath = realpathSync(join(root, "docs", "spec.md"));
    ({ page, errors, close } = await roomy([seededComment("seed-whole-3-4", specPath, "docs/spec.md", "preview", SPEC_LINES, 3, 4, "Whole paragraph.", 1)]));
    viewer = await openSpec(page);
    const whole = cardsIn(viewer);
    await eventually("its card", async () => (await whole.count()) === 1);
    await eventually("its paragraph marked", async () => {
      const marked = (await highlightText(page, MARKED_HIGHLIGHTS)).replace(/\s+/g, " ");
      return marked.includes(SPEC_LINES[2]!) && marked.includes(SPEC_LINES[3]!);
    });
    await modeOn(viewer);
    await whole.nth(0).locator(".markdown-comment-text").click();
    await whole.nth(0).locator(".comment-popover.is-row").waitFor();
    await page.keyboard.press("End");
    await page.keyboard.type(" Still.");
    await page.keyboard.press("Escape");
    await whole.nth(0).locator(".comment-popover.is-row").waitFor({ state: "detached" });
    assert.deepEqual(await storedFileComments(page), [{ lines: [3, 4], quoteLines: [SPEC_LINES[2], SPEC_LINES[3]], view: "preview", selected: false }], "edited, it stays a whole-line comment");
    assert.deepEqual((await storedPreview(page)).map((c) => c.comment), ["Whole paragraph. Still."]);
    console.log("PASS preview-cards: a whole-line comment from before shows a card and a mark, and edited it stays on whole lines");
    assert.deepEqual(errors, []);
    await close();

    // 7b. a card's field with text typed, its comment deleted in another tab: the card goes, and what was typed is stored
    // again (as leaving would store it), never dropped; an unchanged card's field just goes with its card
    ({ page, errors, close } = await roomy([selectedComment("seed-card-gone", 4, 0, 8, "Gone elsewhere.", 1), selectedComment("seed-card-same", 42, 0, 5, "Left as it was.", 2)]));
    viewer = await openSpec(page);
    const gone = cardsIn(viewer);
    await eventually("two cards", async () => (await gone.count()) === 2);
    await modeOn(viewer);
    const deleteElsewhere = async (prefix: string): Promise<void> => {
      const other = await page.context().newPage();
      await other.goto(page.url());
      await other.evaluate((wanted) => {
        for (const key of Object.keys(localStorage).filter((name) => name.startsWith("ovis:block-comments:"))) {
          const data = JSON.parse(localStorage.getItem(key)!) as { comments: { comment: string }[] };
          localStorage.setItem(key, JSON.stringify({ ...data, comments: data.comments.filter((comment) => !comment.comment.startsWith(wanted)) }));
        }
      }, prefix);
      await other.close();
    };
    await gone.filter({ hasText: "Gone elsewhere." }).locator(".markdown-comment-text").click();
    await viewer.locator(".markdown-comment-card .comment-popover.is-row").waitFor();
    await page.keyboard.press("End");
    await page.keyboard.type(" Still typed.");
    await deleteElsewhere("Gone elsewhere.");
    await eventually("the typed text stored again", async () => (await storedPreview(page)).some((c) => c.comment === "Gone elsewhere. Still typed." && c.text === "compares"));
    await eventually("its card back with it, the field closed", async () => (await gone.filter({ hasText: "Gone elsewhere. Still typed." }).count()) === 1 && (await popoverOf(page).count()) === 0);
    await gone.filter({ hasText: "Left as it was." }).locator(".markdown-comment-text").click();
    await viewer.locator(".markdown-comment-card .comment-popover.is-row").waitFor();
    await deleteElsewhere("Left as it was.");
    await eventually("the unchanged field gone with its card", async () => (await popoverOf(page).count()) === 0 && (await gone.count()) === 1);
    await frames(page);
    assert.deepEqual((await storedPreview(page)).map((c) => c.comment), ["Gone elsewhere. Still typed."], "the unchanged one is not stored again");
    console.log("PASS preview-cards: a card's field with text typed whose comment another tab deletes stores the typed text again; an unchanged one goes with its card");
    assert.deepEqual(errors, []);
    await close();

    // 8. a card's field with text typed, then Settings → Comments off (every comment deleted): the typed edit is
    // not stored afterwards, and turned on again there is no comment and no card
    ({ page, errors, close } = await roomy([selectedComment("seed-card-off", 4, 0, 8, "Typed over.", 1)]));
    viewer = await openSpec(page);
    await eventually("its card", async () => (await cardsIn(viewer).count()) === 1);
    await modeOn(viewer);
    await cardsIn(viewer).nth(0).locator(".markdown-comment-text").click();
    await cardsIn(viewer).nth(0).locator(".comment-popover.is-row").waitFor();
    await page.keyboard.press("End");
    await page.keyboard.type(" Not kept.");
    await page.keyboard.press("ControlOrMeta+Shift+Comma");
    const settingsDialog = page.locator(".settings-dialog");
    await openSettingsPage(page, "Comments");
    const commentsSwitch = settingsDialog.getByRole("switch", { name: "Comments", exact: true });
    await commentsSwitch.click();
    const confirm = page.getByRole("alertdialog");
    await confirm.waitFor();
    await confirm.getByRole("button", { name: "Turn off and delete", exact: true }).click();
    await confirm.waitFor({ state: "detached" });
    await frames(page);
    assert.deepEqual(await storedPreview(page), [], "Comments off deleted every comment, and the typed edit was not stored after");
    await commentsSwitch.click();
    await eventually("Comments on again", async () => (await commentsSwitch.getAttribute("aria-checked")) === "true");
    await page.keyboard.press("Escape");
    await settingsDialog.waitFor({ state: "detached" });
    await viewer.locator("button.file-viewer-comments").waitFor();
    await frames(page);
    assert.deepEqual(await storedPreview(page), [], "turned on again, no comment is stored");
    assert.equal(await cardsIn(viewer).count(), 0, "and no card shows");
    console.log("PASS preview-cards: a card's typed edit is not stored after Settings → Comments off deleted every comment; on again, there is no comment and no card");
    assert.deepEqual(errors, []);
    await close();

    // 9. the bin by the keyboard while the next card is not placed (the margin left it hidden: its text not drawn as it
    // measured): the focus goes on past it to the next placed card, as the code view's cards do, never to the page
    ({ page, errors, close } = await roomy([
      selectedComment("seed-near-3", 3, 2, 7, "Near one.", 1),
      selectedComment("seed-near-4", 4, 0, 8, "Near two.", 2),
      selectedComment("seed-near-42", 42, 0, 14, "Near three.", 3),
    ]));
    viewer = await openSpec(page);
    const near = cardsIn(viewer);
    await eventually("three cards", async () => (await near.count()) === 3);
    await modeOn(viewer);
    await near.nth(0).locator(".markdown-comment-text").focus();
    await page.keyboard.press("Tab");
    assert.ok(await near.nth(0).locator(".markdown-comment-delete").evaluate((node) => node === document.activeElement), "Tab goes on to the first card's bin");
    // in one task, so no placing comes between: the second card as the margin leaves a card it could not place, then the
    // bin's keyboard click (detail 0)
    await page.evaluate(() => {
      const cards = [...document.querySelectorAll<HTMLElement>(".comment-margin > .markdown-comment-card")];
      cards[1]!.style.visibility = "hidden";
      (document.activeElement as HTMLElement).click();
    });
    await eventually("two cards", async () => (await near.count()) === 2);
    const focusedOn = (): Promise<string | null> => page.evaluate(() => {
      const active = document.activeElement;
      return active?.matches(".comment-margin .markdown-comment-text") ? active.closest<HTMLElement>(".markdown-comment-card")?.dataset.commentId ?? null : `${active?.tagName}.${active?.className}`;
    });
    await eventually("the focus on the next placed card", async () => (await focusedOn()) === "seed-near-42")
      .catch(async (error: Error) => { throw new Error(`${error.message} (the focus on ${await focusedOn()})`); });
    console.log("PASS preview-cards: the bin by the keyboard with the next card not placed moves the focus on to the next placed card");
    assert.deepEqual(errors, []);
    await close();

    // 10. the window narrowed by 100 px: the viewer narrows, the text keeps its width and moves sideways (centred in its
    // column, with room to spare: the narrow chat lane and counts), and the margin follows it, 4 px right of the text
    ({ page, errors, close } = await open({ viewport: { width: 1180, height: 800 } }, [selectedComment("seed-moved", 4, 0, 8, "Moves along.", 1)]));
    // the page's init script sets the settings on a load: one more after it, then a load
    await page.addInitScript(() => {
      const settings = JSON.parse(localStorage.getItem("ovis:settings") ?? "{}") as Record<string, unknown>;
      localStorage.setItem("ovis:settings", JSON.stringify({ ...settings, chatWidth: "narrow", commentLayout: "counts" }));
    });
    await page.reload();
    await page.locator(".conn-live").waitFor();
    viewer = await openSpec(page);
    await eventually("its count", async () => (await countsIn(viewer).count()) === 1);
    const besideText = (): Promise<{ text: number; width: number; margin: number }> => viewer.evaluate((node) => {
      const text = node.querySelector<HTMLElement>(".file-viewer-markdown")!;
      const box = text.getBoundingClientRect();
      const margin = node.querySelector(".file-viewer-body > .comment-margin")!.getBoundingClientRect();
      return { text: box.right - Number.parseFloat(getComputedStyle(text).paddingRight), width: box.width, margin: margin.left };
    });
    let placedAt = await besideText();
    await eventually("the margin 4 px right of the text", async () => { placedAt = await besideText(); return Math.abs(placedAt.margin - (placedAt.text + 4)) <= 1; });
    const wideAt = placedAt;
    await page.setViewportSize({ width: 1080, height: 800 });
    await eventually("the text moved sideways", async () => Math.abs((await besideText()).text - wideAt.text) > 4);
    let narrowAt = await besideText();
    assert.ok(Math.abs(narrowAt.width - wideAt.width) <= 0.5, `the text keeps its width (${JSON.stringify({ wideAt, narrowAt })})`);
    await eventually("the margin to follow the text", async () => { narrowAt = await besideText(); return Math.abs(narrowAt.margin - (narrowAt.text + 4)) <= 1; })
      .catch((error: Error) => { throw new Error(`${error.message} (${JSON.stringify({ wideAt, narrowAt })})`); });
    console.log("PASS preview-cards: the window narrowed by 100 px moves the text sideways at its width, and the margin (counts) follows it");
    assert.deepEqual(errors, []);
    await close();
  },

  /**
   * Counts beside the lines (CommentMargin.tsx): chosen in Settings → Comments → Comments beside the text, or where the
   * margin does not fit (a 760 px wide window) though cards are wanted. A count is level with the line its comments start
   * on; two starting on one visual line share one. In the mode a click opens their fields, stacked 8 px apart over the
   * first one's text, growing upward; a second click closes them; one emptied and left with Escape is deleted. With the
   * mode off a count opens read-only cards beside it.
   */
  async "preview-counts"(open) {
    const ids = ["seed-count-a", "seed-count-b", "seed-count-c"];
    const seed = [
      selectedComment(ids[0]!, 8, 0, 4, "Note a", 1),
      selectedComment(ids[1]!, 8, 14, 23, "Note b", 2),
      selectedComment(ids[2]!, 42, 0, 14, "Note c", 3),
    ];
    // 0. the margin never moves the text: with comments off, cards wanted (the default) or counts, the text has one place
    // and width; on a desktop the viewer's dialog (1100 px at most, the text 820 px) leaves short of the cards' 24 + 280 px
    // right of the text, so counts show though cards are wanted, 4 px right of the text, nothing over them
    const placedWith = async (options: BrowserContextOptions, settings: Record<string, unknown>, touch = false): Promise<{ text: { left: number; width: number }; line: { left: number; width: number }; opened: Opened; viewer: Locator }> => {
      const opened = await open(options, seed, settings);
      const shown = await openSpec(opened.page, touch);
      if (settings.comments !== false) await eventually("the margin's counts or cards", async () => (await countsIn(shown).count()) + (await cardsIn(shown).count()) > 0);
      else assert.equal(await shown.locator(".comment-margin").count(), 0, "comments off: no margin");
      await frames(opened.page, 2);
      const text = await textBoxOf(shown);
      const line = (await previewLine(shown, 8).boundingBox())!;
      return { text: { left: text.left, width: text.width }, line: { left: line.x, width: line.width }, opened, viewer: shown };
    };
    const sameText = (what: string, a: { text: { left: number; width: number }; line: { left: number; width: number } }, b: typeof a): void => {
      const near = (x: number, y: number): boolean => Math.abs(x - y) <= 0.5;
      assert.ok(near(a.text.left, b.text.left) && near(a.text.width, b.text.width) && near(a.line.left, b.line.left) && near(a.line.width, b.line.width), `${what}: the text has the same place and width (${JSON.stringify({ a: [a.text, a.line], b: [b.text, b.line] })})`);
    };
    const unmoved = async (options: BrowserContextOptions, device: string, touch = false): Promise<void> => {
      const off = await placedWith(options, { comments: false }, touch);
      await off.opened.close();
      const counted = await placedWith(options, { commentLayout: "counts" }, touch);
      await counted.opened.close();
      const carded = await placedWith(options, {}, touch);
      sameText(`${device}, comments off and counts`, off, counted);
      sameText(`${device}, comments off and cards wanted`, off, carded);
      const shown = carded.viewer;
      assert.equal(await cardsIn(shown).count(), 0, `${device}: no room for cards right of the text`);
      const text = await textBoxOf(shown);
      const glyphs = await glyphRight(previewLine(shown, 8));
      const boxes = await boxesOf(countsIn(shown));
      const bubbles = await boxesOf(shown.locator(".file-viewer-body > .comment-margin .markdown-comment-count-bubble"));
      const seen = { text, glyphs, boxes, bubbles };
      assert.equal(boxes.length, 2, `${device}: two counts (${JSON.stringify(seen)})`);
      for (const [index, box] of boxes.entries()) {
        const bubble = bubbles[index]!;
        assert.ok(bubble.x >= text.right - 0.5 && bubble.x >= glyphs - 0.5, `${device}: a count's bubble is clear of the text's glyphs (${JSON.stringify(seen)})`);
        assert.ok(box.x >= text.right - 0.5, `${device}: a count's target never lies over the text (${JSON.stringify(seen)})`);
        assert.ok(box.x + box.width <= text.bodyRight + 0.5 && bubble.x + bubble.width <= text.bodyRight + 0.5, `${device}: a count stays inside the body (${JSON.stringify(seen)})`);
        if (touch) assert.ok(box.height >= 44, `${device}: a finger's target is 44 px high (${JSON.stringify(seen)})`);
      }
      for (const index of [0, 1]) assert.ok(await hitAtCentre(countsIn(shown).nth(index).locator(".markdown-comment-count-bubble")), `${device}: nothing clips or covers count ${index + 1}`);
      if (!touch) {
        for (const box of boxes) assert.ok(Math.abs(box.x - (text.right + 4)) <= 1 && Math.abs(box.width - 24) <= 1, `${device}: a count sits 4 px right of the text, its 24 px column its target (${JSON.stringify(seen)})`);
      } else {
        for (const box of boxes) assert.ok(Math.abs(box.x - text.right) <= 1 && Math.abs(box.x + box.width - text.bodyRight) <= 1, `${device}: short of room, a finger's target spans the free space at the body's edge (${JSON.stringify(seen)})`);
      }
      assert.deepEqual(carded.opened.errors, []);
      await carded.opened.close();
      console.log(`PASS preview-counts (${device}): with comments off, cards wanted or counts the text keeps one place and width; counts show right of it, clear of its glyphs, inside the body, nothing over them`);
    };
    await unmoved(DESKTOP, "1280 × 800");
    await unmoved(IPHONE_14_PRO, "393 × 852, touch", true);

    let { page, errors, close } = await open(DESKTOP, seed);
    let viewer = await openSpec(page);
    const counts = countsIn(viewer);
    await eventually("counts, though cards are the default", async () => (await counts.count()) === 2);
    assert.equal(await cardsIn(viewer).count(), 0, "no room for cards in the viewer's dialog");
    // the setting, in Settings → Comments → Selected text
    await page.keyboard.press("ControlOrMeta+Shift+Comma");
    const settingsDialog = page.locator(".settings-dialog");
    await openSettingsPage(page, "Comments");
    const row = settingsDialog.getByRole("group", { name: "Comments beside the text", exact: true });
    assert.equal(await row.getByRole("button", { name: "Cards in the margin", exact: true }).getAttribute("aria-pressed"), "true", "cards are the default");
    await row.getByRole("button", { name: "Counts beside the lines", exact: true }).click();
    assert.equal(await row.getByRole("button", { name: "Counts beside the lines", exact: true }).getAttribute("aria-pressed"), "true");
    await page.keyboard.press("Escape");
    await settingsDialog.waitFor({ state: "detached" });
    await eventually("two counts", async () => (await counts.count()) === 2);
    assert.equal(await cardsIn(viewer).count(), 0, "no cards with counts");

    // 1. level with their lines; two comments starting on one visual line share one count. Beside the text where the free
    // space holds the 4 px gap and the 24 px column; else (`edge`) at the body's right edge, the bubble clear of the text
    const assertCounts = async (what: string, edge = false): Promise<void> => {
      const tops = [await wordTop(previewLine(viewer, 8), "Rule"), await wordTop(previewLine(viewer, 42), "Older")];
      let found: unknown = null;
      await eventually(`${what}: the counts level with their lines, ${edge ? "at the body's edge" : "beside the text"}`, async () => {
        const { right, bodyRight } = await textBoxOf(viewer);
        const boxes = await boxesOf(countsIn(viewer));
        const bubbles = await boxesOf(viewer.locator(".file-viewer-body > .comment-margin .markdown-comment-count-bubble"));
        found = { boxes, bubbles, tops, right, bodyRight };
        return boxes.length === 2 && boxes.every((box, index) => Math.abs(box.y - tops[index]!) <= 2 && (edge
          ? Math.abs(box.x - right) <= 1 && Math.abs(box.x + box.width - bodyRight) <= 1 && bubbles[index]!.x >= right - 0.5
          : Math.abs(box.x - (right + 4)) <= 1 && Math.abs(box.width - 24) <= 1));
      }).catch((error: Error) => { throw new Error(`${error.message} (${JSON.stringify(found)})`); });
    };
    await assertCounts("Settings → counts");
    assert.deepEqual((await counts.allTextContents()).map((text) => text.trim()), ["2", "1"], "the two comments on line 8 share a count of 2");
    assert.deepEqual(await counts.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label"))), ["2 comments", "1 comment"]);
    await marginShot(page, "counts");
    console.log("PASS preview-counts: with Settings → counts, counts sit 4 px right of the text, level with their lines; two comments on one line share a count of 2");

    // 2. a click opens both fields, stacked 8 px apart over the first one's text, growing upward; a second click closes them
    await modeOn(viewer);
    const fields = countFieldsIn(viewer);
    await counts.nth(0).click();
    await eventually("two fields", async () => (await fields.count()) === 2);
    assert.deepEqual(await fields.locator("textarea").evaluateAll((nodes) => nodes.map((node) => (node as HTMLTextAreaElement).value)), ["Note a", "Note b"], "in reading order, each holding its comment");
    const lineTop = await wordTop(previewLine(viewer, 8), "Rule");
    const stack = await boxesOf(fields);
    assert.ok(Math.abs(stack[1]!.y - (stack[0]!.y + stack[0]!.height + 8)) <= 1, `the fields are stacked 8 px apart (${JSON.stringify(stack)})`);
    assert.ok(Math.abs(stack[1]!.y + stack[1]!.height - (lineTop - 8)) <= 1, `the stack ends 8 px over the first comment's text (${JSON.stringify({ stack, lineTop })})`);
    assert.equal(await counts.nth(0).getAttribute("aria-expanded"), "true", "the count is open");
    await eventually("both comments' text in the strong fill", async () => (await strongText(page)) === "Rule revisions");
    await marginShot(page, "count-fields");
    await counts.nth(0).click();
    await eventually("the fields closed", async () => (await fields.count()) === 0);
    assert.equal((await storedPreview(page)).length, 3, "closing unchanged fields changes nothing");
    console.log("PASS preview-counts: a click on the count opens both fields stacked 8 px apart over the first one's text; a second click closes them");

    // 3. one emptied, then Escape: it is deleted, the other kept
    await counts.nth(0).click();
    await eventually("two fields", async () => (await fields.count()) === 2);
    await fields.nth(1).locator("textarea").click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Escape");
    await eventually("the fields closed", async () => (await fields.count()) === 0);
    assert.deepEqual((await storedPreview(page)).map((c) => c.comment).sort(), ["Note a", "Note c"], "the emptied comment is deleted, the other kept");
    await eventually("a count of 1 on line 8", async () => (await counts.allTextContents()).map((text) => text.trim()).join() === "1,1");
    console.log("PASS preview-counts: a comment emptied in its field and left with Escape is deleted");

    // 4. the mode off: a count opens read-only cards beside it, and closes them again
    await viewer.locator("button.file-viewer-comments").click();
    await eventually("the mode off", async () => (await viewer.locator("button.file-viewer-comments").getAttribute("aria-pressed")) === "false");
    await counts.nth(0).click();
    await eventually("a read-only card", async () => (await cardsIn(viewer).count()) === 1);
    assert.equal((await cardsIn(viewer).nth(0).textContent())?.trim(), "Note a");
    await marginShot(page, "count-readonly");
    assert.equal(await viewer.locator(".file-viewer-body > .comment-margin textarea, .file-viewer-body > .markdown-comments-field").count(), 0, "no field");
    assert.equal(await viewer.locator(".markdown-comment-delete").count(), 0, "no bin");
    await cardsIn(viewer).nth(0).click();
    await frames(page);
    assert.equal(await popoverOf(page).count(), 0, "a read-only card opens nothing");
    await counts.nth(0).click();
    await eventually("the card closed", async () => (await cardsIn(viewer).count()) === 0);
    console.log("PASS preview-counts: with the mode off a count opens its comments as read-only cards, and a second click closes them");
    assert.deepEqual(errors, []);
    await close();

    // 5. a window so narrow the text fills the body: counts, though cards are wanted, at the body's right edge, in the
    // text's and the body's padding
    ({ page, errors, close } = await open({ viewport: { width: 760, height: 640 } }, seed));
    viewer = await openSpec(page);
    await eventually("two counts", async () => (await countsIn(viewer).count()) === 2);
    assert.equal(await cardsIn(viewer).count(), 0, "no cards where the margin does not fit");
    await assertCounts("760 × 640", true);
    for (const index of [0, 1]) assert.ok(await hitAtCentre(countsIn(viewer).nth(index)), `nothing clips or covers count ${index + 1}`);
    console.log("PASS preview-counts: at 760 × 640 the text fills the body, and counts show though cards are wanted, at the body's right edge clear of the text");
    assert.deepEqual(errors, []);
    await close();
  },

  /**
   * The composer's walk into the preview (MarkdownComments.tsx `open`), on a desktop, whose viewer shows counts (no room
   * for cards right of the text): a comment in a folded code block's hidden lines unfolds the block; only the viewer's
   * body scrolls, to the comment's text and its count; with the mode off the comment is marked (the strong fill, until the
   * next click) and its count shows it read-only, with the mode on its count's field opens, focused.
   * A comment whose text the preview does not draw (a blank line) opens in the dialog. With counts, a stop opens the
   * count's read-only cards (the mode off, closed with the walk's mark) or its fields, the walked comment's focused.
   */
  async "preview-walk"(open) {
    const specPath = realpathSync(join(root, "docs", "spec.md"));
    const folded = "seed-spec-folded";
    // a comment on the blank line 2: placed (its line still reads the same), but the preview draws no element for it
    const blank = "seed-spec-blank";
    const { page, errors, close } = await open(DESKTOP, [
      seededComment(folded, specPath, "docs/spec.md", "preview", SPEC_LINES, FOLDED_LINE, FOLDED_LINE, "Fold note", 1),
      seededComment(blank, specPath, "docs/spec.md", "preview", SPEC_LINES, 2, 2, "Blank note", 2),
    ]);
    let viewer = await openSpec(page);
    const body = (): Locator => viewer.locator(".file-viewer-body");
    const foldedCount = `.file-viewer-body > .comment-margin .markdown-comment-count[data-comment-ids~="${folded}"]`;
    const foldedText = SPEC_LINES[FOLDED_LINE - 1]!;

    // a comment in the folded block's hidden lines: no count while its line is not drawn
    let more = viewer.locator(".markdown-code-more");
    assert.equal(await more.getAttribute("aria-expanded"), "false", "the long block opens folded");
    assert.equal(await more.getAttribute("data-fold-end"), String(FOLD_FIRST + 34), "its Show all names its last line");
    assert.equal(await previewLine(viewer, FOLDED_LINE).count(), 0, "the comment's line is folded away");
    await eventually("the margin", async () => (await viewer.locator(".file-viewer-body > .comment-margin").count()) === 1);
    assert.equal(await viewer.locator(foldedCount).count(), 0, "a comment on a folded line has no count");
    assert.equal(await viewer.locator(".file-viewer-body .comment-pin").count(), 0, "the preview has no pins");
    await viewer.getByRole("button", { name: "Close file", exact: true }).click();
    await viewer.waitFor({ state: "detached" });
    const walk = walkOf(page);
    assert.equal(await walk.getAttribute("aria-label"), "2 comments");

    /** Opens the viewer by the walk's next stop, its preview drawn. */
    const step = async (): Promise<void> => {
      await walk.click();
      viewer = page.getByRole("dialog", { name: "spec.md", exact: true });
      await viewer.locator(".file-viewer-markdown").waitFor();
    };
    /** The blank line's stop: its text is not drawn, so once the walk has waited for it, it opens in the dialog; Escape closes only that. */
    const blankStop = async (): Promise<void> => {
      await step();
      const dialog = dialogOf(page);
      await dialog.waitFor();
      assert.equal(await popoverText(page), "Blank note", "the dialog opens the comment in its field");
      assert.equal(await referenceText(dialog.locator(".comment-file-reference")), "spec.md · Line 2");
      assert.equal(await dialog.locator(".comment-popover-note").count(), 0, "with no note: it is not outdated");
      assert.equal(await viewer.locator(`.file-viewer-body > .comment-margin [data-comment-ids~="${blank}"]`).count(), 0, "it has no count");
      await fieldFocused(page);
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
      assert.ok(await viewer.isVisible(), "Escape closes the dialog, not the viewer");
      await viewer.getByRole("button", { name: "Close file", exact: true }).click();
      await viewer.waitFor({ state: "detached" });
    };
    /** The folded line's stop: its block unfolds, its text and its count are scrolled into view, the page itself unmoved. */
    const foldedStop = async (): Promise<void> => {
      await step();
      more = viewer.locator(".markdown-code-more");
      await eventually("the block to unfold", async () => (await more.getAttribute("aria-expanded")) === "true");
      await eventually("its count", async () => (await viewer.locator(foldedCount).count()) === 1);
      await eventually("its count scrolled into view", () => inBody(viewer, foldedCount));
      await eventually("its text scrolled into view", () => inBody(viewer, `.file-viewer-markdown [data-source-line="${FOLDED_LINE}"]`));
      assert.ok(await bodyScroll(viewer) > 0, "the viewer's body scrolled");
      assert.equal(await outerScroll(viewer), 0, "nothing but the viewer's body scrolled");
    };

    // 1. the first stop, line 2, is drawn nowhere: the dialog
    await blankStop();
    console.log("PASS preview-walk: a stop of the composer's walk whose text is never drawn (a blank line of the preview) opens the comment in the dialog; Escape closes only it");

    // 2. the next stop, line 80 in the folded block, with the mode off: unfolded and marked, no field
    await foldedStop();
    await eventually("its text to take the strong fill", async () => (await strongText(page)) === foldedText);
    // nothing takes the focus: the layer's live region says the comment
    const status = viewer.locator(".file-viewer-body > .markdown-comments-status[role='status']");
    await eventually("the live region to say the comment", async () => (await status.textContent()) === `Comment on “${foldedText}”: Fold note`);
    await frames(page);
    assert.equal(await popoverOf(page).count(), 0, "the mode off, the stop opens no field");
    assert.equal(await countFieldsIn(viewer).count(), 0, "no field over its text");
    await eventually("its count's read-only card", async () => (await cardsIn(viewer).allTextContents()).map((card) => card.trim()).join("|") === "Fold note");
    assert.equal(await viewer.locator("button.file-viewer-comments").getAttribute("aria-pressed"), "false", "the mode is off");
    assert.equal(await strongText(page), foldedText, "the mark stays: the mode off leaves it alone");
    // until the next click
    await viewer.locator(".file-viewer-title").click();
    await eventually("the mark to go with the click", async () => (await highlighted(page, "comment-strong")) === 0);
    console.log("PASS preview-walk: with the mode off the walk unfolds the code block hiding a comment's line, scrolls only the viewer's body to its text and count, and marks it with no field open (a live region says the comment, its count shows it read-only), until the next click");

    // 3. the mode on, the block folded again; the walk wraps round (the dialog again) to line 80: its count's field opens
    await modeOn(viewer);
    await more.click();
    await eventually("the block to fold", async () => (await more.getAttribute("aria-expanded")) === "false");
    await viewer.getByRole("button", { name: "Close file", exact: true }).click();
    await viewer.waitFor({ state: "detached" });
    await blankStop();
    await foldedStop();
    const editing = countFieldsIn(viewer);
    await editing.waitFor();
    await fieldFocused(page);
    assert.equal(await editing.getByRole("textbox", { name: "Comment", exact: true }).inputValue(), "Fold note", "its field holds its comment");
    await eventually("its text to take the strong fill", async () => (await strongText(page)) === foldedText);
    assert.equal(await editing.count(), 1, "one field, over its text");
    assert.equal(await viewer.locator(`${foldedCount}[aria-expanded="true"]`).count(), 1, "its count is open");
    await page.keyboard.press("End");
    await page.keyboard.type(", kept");
    // a selection elsewhere on the page meanwhile is not the walk's: saving the field leaves it (the field keeps the focus,
    // and its Enter is its keydown's)
    const title = await page.evaluate(() => {
      const node = document.querySelector(".file-viewer-title")!;
      window.getSelection()!.selectAllChildren(node);
      return window.getSelection()!.toString();
    });
    assert.ok(title.length > 0, "the title is selected");
    await fieldFocused(page);
    await page.keyboard.press("Enter");
    await eventually("the field to close", async () => (await editing.count()) === 0);
    await eventually("the edit to be stored", async () => (await storedPreview(page)).some((comment) => comment.comment === "Fold note, kept"));
    assert.equal(await page.evaluate(() => window.getSelection()!.toString()), title, "the page's selection stays");
    assert.equal(await outerScroll(viewer), 0, "nothing but the viewer's body scrolled");
    console.log("PASS preview-walk: with the mode on the walk unfolds the block and opens the comment's count's field, focused and holding it; saved, the page's own selection stays");
    assert.deepEqual(errors, []);
    await close();

    // 4. counts (a window too narrow for the margin), two comments on line 8 sharing one count, walked in reading order
    const [noteA, noteB] = ["seed-walk-a", "seed-walk-b"];
    const narrow = await open({ viewport: { width: 760, height: 640 } }, [
      selectedComment(noteA, 8, 0, 4, "Note a", 1),
      selectedComment(noteB, 8, 14, 23, "Note b", 2),
    ]);
    const walkNarrow = walkOf(narrow.page);
    await walkNarrow.waitFor();
    const stepNarrow = async (): Promise<Locator> => {
      await walkNarrow.click();
      const opened = narrow.page.getByRole("dialog", { name: "spec.md", exact: true });
      await opened.locator(".file-viewer-markdown").waitFor();
      return opened;
    };
    // the mode off: the stop at the first comment opens the count's read-only cards and marks the comment
    viewer = await stepNarrow();
    await eventually("one count of 2", async () => (await countsIn(viewer).allTextContents()).map((text) => text.trim()).join() === "2");
    await eventually("the count's read-only cards", async () => (await cardsIn(viewer).count()) === 2);
    assert.deepEqual((await cardsIn(viewer).allTextContents()).map((text) => text.trim()), ["Note a", "Note b"]);
    await eventually("the walked comment's text in the strong fill", async () => (await strongText(narrow.page)) === "Rule");
    assert.equal(await popoverOf(narrow.page).count(), 0, "the mode off, no field");
    // the walk's mark ends without a press (a key's click on the block's Show all): the cards it opened go with it
    await viewer.locator(".markdown-code-more").focus();
    await narrow.page.keyboard.press("Enter");
    await eventually("the mark to go", async () => (await highlighted(narrow.page, "comment-strong")) === 0);
    await eventually("the walk's read-only cards to close with its mark", async () => (await cardsIn(viewer).count()) === 0);
    console.log("PASS preview-walk: with counts and the mode off a stop opens the count's read-only cards and marks its comment; as the walk's mark ends the cards close");
    // the mode on: the stop at the second comment opens both fields of the count, the second one focused
    await modeOn(viewer);
    await viewer.getByRole("button", { name: "Close file", exact: true }).click();
    await viewer.waitFor({ state: "detached" });
    viewer = await stepNarrow();
    const stacked = countFieldsIn(viewer);
    await eventually("the count's two fields", async () => (await stacked.count()) === 2);
    assert.deepEqual(await stacked.locator("textarea").evaluateAll((nodes) => nodes.map((node) => (node as HTMLTextAreaElement).value)), ["Note a", "Note b"], "in reading order");
    await fieldFocused(narrow.page);
    assert.equal(await narrow.page.evaluate(() => (document.activeElement as HTMLTextAreaElement).value), "Note b", "the walked comment's field takes the focus");
    await narrow.page.keyboard.press("End");
    await narrow.page.keyboard.type(" too");
    await narrow.page.keyboard.press("Escape");
    await eventually("the fields closed", async () => (await stacked.count()) === 0);
    await eventually("the edit to be stored", async () => (await storedPreview(narrow.page)).map((c) => c.comment).sort().join() === "Note a,Note b too");
    assert.equal(await outerScroll(viewer), 0, "nothing but the viewer's body scrolled");
    console.log("PASS preview-walk: with counts and the mode on a stop at a count's second comment opens the count's fields with the second one focused; typed and left with Escape, only that comment changed");
    assert.deepEqual(narrow.errors, []);
    await narrow.close();

    // 5. the walk's stop and a click in one margin (counts, the mode off): a click on another count during the stop shows
    // that one in the stop's place, and it stays as the click ends the walk's mark; a second click closes it, and the
    // stop's count does not come back
    const [stopNote, clickNote] = ["seed-walk-stop", "seed-walk-click"];
    const twice = await open({ viewport: { width: 760, height: 640 } }, [
      selectedComment(stopNote, 8, 0, 4, "Stop note", 1),
      selectedComment(clickNote, 10, 0, 4, "Click note", 2),
    ]);
    const walkTwice = walkOf(twice.page);
    await walkTwice.waitFor();
    await walkTwice.click();
    viewer = twice.page.getByRole("dialog", { name: "spec.md", exact: true });
    await viewer.locator(".file-viewer-markdown").waitFor();
    const countFor = (id: string): Locator => viewer.locator(`.file-viewer-body > .comment-margin .markdown-comment-count[data-comment-ids~="${id}"]`);
    const shownCards = async (): Promise<string> => (await cardsIn(viewer).allTextContents()).map((text) => text.trim()).join("|");
    await eventually("the stop's count open", async () => (await countFor(stopNote).getAttribute("aria-expanded").catch(() => null)) === "true" && (await shownCards()) === "Stop note");
    assert.equal(await countFor(clickNote).getAttribute("aria-expanded"), "false", "the other count is closed");
    await countFor(clickNote).click();
    await eventually("the clicked count in the stop's place", async () => (await countFor(clickNote).getAttribute("aria-expanded")) === "true" && (await countFor(stopNote).getAttribute("aria-expanded")) === "false" && (await shownCards()) === "Click note");
    // the pointer off the count first: a hovered count brings its own text up
    await twice.page.mouse.move(1, 1);
    await eventually("the click to end the walk's mark", async () => (await highlighted(twice.page, "comment-strong")) === 0);
    await frames(twice.page, 6);
    assert.equal(await shownCards(), "Click note", "the clicked count stays open as the walk's mark ends");
    await countFor(clickNote).click();
    await eventually("a second click to close it", async () => (await countFor(clickNote).getAttribute("aria-expanded")) === "false");
    await frames(twice.page, 6);
    assert.equal(await countFor(stopNote).getAttribute("aria-expanded"), "false", "the stop's count does not come back");
    assert.equal(await shownCards(), "", "no read-only cards");
    console.log("PASS preview-walk: with counts and the mode off a click on another count during a stop takes its place and stays as the walk's mark ends; closed, the stop's count does not come back");
    assert.deepEqual(twice.errors, []);
    await twice.close();
  },

  /**
   * The preview on a phone and a tablet (MarkdownComments.tsx, TouchSelection.tsx, MarkdownCommentSheet.tsx): counts
   * only, each a finger's target 44 px high over the free space right of the text (never its glyphs) and 8 px from the
   * next; the mode turned on by a tap says "Select
   * text to comment" and takes the system's selection from the text; a finger resting 450 ms selects the word under it
   * (no system selection, no context menu), moving on extends it, the end handle dragged past the start swaps the ends;
   * Comment opens the sheet quoting the selected text, with no line number, and ✕ keeps what was typed; a merged count's
   * sheet pages "1 of 2" (› keeps an edit, Delete stays on the next); a finger moving before 450 ms scrolls and selects
   * nothing; the composer's walk opens the sheet (editable with the mode on, read-only with it off); with the mode off
   * the text selects as text again and a count opens the read-only sheet. Headless Chromium makes no selection of its
   * own for a long press and raises no context menu, so with the mode off the system's way back is checked by what
   * allows it (no `user-select: none`, a `contextmenu` and a `selectstart` not prevented, a selection made stays).
   */
  async "preview-touch"(open) {
    const ids = ["seed-touch-a", "seed-touch-b", "seed-touch-n", "seed-touch-c"];
    const seed = [
      selectedComment(ids[0]!, 8, 0, 4, "Note a", 1),
      selectedComment(ids[1]!, 8, 14, 23, "Note b", 2),
      selectedComment(ids[2]!, 8, 34, 39, "Note n", 3),
      selectedComment(ids[3]!, 42, 0, 14, "Note c", 4),
    ];
    for (const [device, options] of [["phone", IPHONE_14_PRO], ["tablet", IPAD]] as const) {
      const { page, errors, close } = await open(options, seed);
      assert.ok(await page.evaluate(() => matchMedia("(pointer: coarse)").matches), `${device}: the pointer is coarse`);
      const finger = await fingerOf(page);
      let viewer = await openSpec(page, true);
      const body = viewer.locator(".file-viewer-body");
      const markdown = viewer.locator(".file-viewer-markdown");
      const toggle = viewer.locator("button.file-viewer-comments");
      const sheet = page.locator(".modal-scrim > .modal.comment-popover.is-sheet");
      const handles = viewer.locator(".markdown-touch-handle");
      const pill = viewer.getByRole("button", { name: "Comment", exact: true });
      const counts = countsIn(viewer);
      const touchText = async (): Promise<string> => (await highlightText(page, "comment-touch-selection")).replace(/\s+/g, " ").trim();
      const systemCollapsed = (): Promise<boolean> => page.evaluate(() => (window.getSelection()?.toString() ?? "") === "");
      /** A `contextmenu` and a `selectstart` dispatched on the text now: whether each was prevented. */
      const prevented = (): Promise<{ menu: boolean; select: boolean }> => previewLine(viewer, 3).evaluate((node) => {
        const box = node.getBoundingClientRect();
        const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: box.left + 8, clientY: box.top + 8 });
        node.dispatchEvent(menu);
        const select = new Event("selectstart", { bubbles: true, cancelable: true });
        node.firstChild!.dispatchEvent(select);
        return { menu: menu.defaultPrevented, select: select.defaultPrevented };
      });
      /**
       * Lifts a finger that moved after it rested where it stopped: a lift while moving is a fling to Chromium, and a tap
       * during the fling only stops it (no click). The time is the gesture itself.
       */
      const rest = async (): Promise<void> => {
        await holdUntil(Date.now() + 200);
        await finger("touchEnd");
      };
      /** Rests a finger on `at` past 450 ms (a long press); `then` runs while it is still down. */
      const holdOn = async (at: { x: number; y: number }, then?: () => Promise<void>): Promise<void> => {
        const started = Date.now();
        await finger("touchStart", at);
        await holdUntil(started + 450 + 150);
        await then?.();
      };

      // 1. counts only, each a finger's target 44 px high, as wide as the free space right of the text (the text fills
      // the body: its own right padding and the body's), never over its glyphs, and 8 px apart
      await eventually(`${device}: the counts`, async () => (await counts.count()) === 2);
      assert.equal(await cardsIn(viewer).count(), 0, `${device}: no cards`);
      const targets = await boxesOf(counts);
      const room = await textBoxOf(viewer);
      for (const box of targets) {
        assert.ok(box.height >= 44, `${device}: a count's target is 44 px high at least (${JSON.stringify(box)})`);
        assert.ok(Math.abs(box.x - room.right) <= 1 && Math.abs(box.x + box.width - room.bodyRight) <= 1, `${device}: a count's target spans the free space right of the text (${JSON.stringify({ box, room })})`);
      }
      for (let i = 0; i < targets.length; i++) {
        for (let j = i + 1; j < targets.length; j++) {
          const [a, b] = [targets[i]!, targets[j]!];
          const apart = Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height), b.x - (a.x + a.width), a.x - (b.x + b.width));
          assert.ok(apart >= 8, `${device}: counts' targets 8 px apart at least (${JSON.stringify({ a, b })})`);
        }
      }
      assert.equal((await counts.nth(0).textContent())?.trim(), "3", `${device}: the three comments on line 8 share a count`);
      // a count's target reaches past its 24 px column: neither the page nor the viewer's body scrolls sideways for it
      const overflow = await viewer.evaluate((node) => {
        const page = document.scrollingElement!;
        const body = node.querySelector(".file-viewer-body")!;
        return { page: [page.scrollWidth, page.clientWidth], body: [body.scrollWidth, body.clientWidth] };
      });
      assert.ok(overflow.page[0] === overflow.page[1] && overflow.body[0]! <= overflow.body[1]!, `${device}: no sideways overflow with counts showing (${JSON.stringify(overflow)})`);
      console.log(`PASS preview-touch (${device}): counts only, each a target 44 px high over the free space right of the text, none closer than 8 px, and nothing overflows sideways`);

      // 2. the mode by a tap: the hint, and the text takes no system selection
      assert.notEqual(await markdown.evaluate((node) => getComputedStyle(node).userSelect), "none", `${device}: the mode off, the text selects`);
      await toggle.tap();
      await eventually(`${device}: the mode on`, async () => (await toggle.getAttribute("aria-pressed")) === "true");
      await eventually(`${device}: the hint`, async () => (await viewer.locator(".code-comment-hint").textContent().catch(() => null)) === "Select text to comment");
      // Chromium drops `-webkit-touch-callout` (WebKit's): the body's attribute whose rule sets it beside `user-select: none` is checked instead
      assert.deepEqual(await markdown.evaluate((node) => [getComputedStyle(node).userSelect, node.closest(".file-viewer-body")?.hasAttribute("data-touch-select") ?? false]), ["none", true], `${device}: the mode on, the text takes no system selection and no callout`);
      console.log(`PASS preview-touch (${device}): a tap on the toggle turns the mode on with the hint "Select text to comment", and the text takes no system selection`);

      // 3. a long press on "revision" selects that word, the app's own: no system selection, no context menu
      const line3 = previewLine(viewer, 3);
      const revision = await wordPoint(line3, "revision");
      const made = await wordPoint(line3, "made");
      const scrollBefore = await bodyScroll(viewer);
      let duringHold: { menu: boolean; select: boolean } | null = null;
      await holdOn(revision, async () => {
        await eventually(`${device}: the word selected while the finger rests`, async () => (await touchText()) === "revision", 1000);
        duringHold = await prevented();
      });
      assert.deepEqual(duringHold, { menu: true, select: true }, `${device}: a long press raises no context menu and starts no system selection`);
      assert.ok(await systemCollapsed(), `${device}: no system selection`);
      assert.equal(await handles.count(), 2, `${device}: two handles`);
      // 4. moving on without lifting extends it, by words; the view stays
      for (let step = 1; step <= 4; step++) await finger("touchMove", { x: revision.x + (made.x - revision.x) * step / 4, y: revision.y + (made.y - revision.y) * step / 4 });
      await eventually(`${device}: the selection extended`, async () => (await touchText()) === "revision it was made", 1000);
      await finger("touchEnd");
      assert.equal(await bodyScroll(viewer), scrollBefore, `${device}: extending scrolled nothing`);
      await pill.waitFor();
      assert.ok(await systemCollapsed(), `${device}: still no system selection after the lift`);
      console.log(`PASS preview-touch (${device}): a long press on "revision" selects exactly that word in the app's selection (no system selection, no context menu), and moving on extends it to "revision it was made"`);

      // 5. the end handle dragged across the start: the ends swap
      const end = viewer.locator('.markdown-touch-handle[data-edge="end"]');
      const knob = await end.boundingBox();
      assert.ok(knob !== null && knob.width >= 44 && knob.height >= 44, `${device}: a handle's target is 44 px at least (${JSON.stringify(knob)})`);
      const edges = await page.evaluate(() => {
        const ranges = [...((CSS as unknown as { highlights: { get(key: string): Iterable<Range> | undefined } }).highlights.get("comment-touch-selection") ?? [])];
        const rects = ranges.flatMap((range) => [...range.getClientRects()]).filter((rect) => rect.width > 0);
        const last = rects.at(-1)!;
        return { x: last.right, y: last.top + last.height / 2 };
      });
      const write = await wordEdge(line3, "write", false);
      const grab = { x: knob!.x + knob!.width / 2, y: knob!.y + knob!.height / 2 };
      await finger("touchStart", grab);
      for (let step = 1; step <= 6; step++) await finger("touchMove", { x: grab.x + (write.x - edges.x) * step / 6, y: grab.y + (write.y - edges.y) * step / 6 });
      await rest();
      await eventually(`${device}: the ends swapped`, async () => (await touchText()) === "write carries the", 1000);
      const [startBox, endBox] = [await viewer.locator('.markdown-touch-handle[data-edge="start"]').boundingBox(), await end.boundingBox()];
      assert.ok(startBox !== null && endBox !== null && (startBox.y < endBox.y - 1 || startBox.x < endBox.x), `${device}: the start handle before the end handle (${JSON.stringify({ startBox, endBox })})`);
      console.log(`PASS preview-touch (${device}): the end handle dragged across the start swaps the ends ("write carries the")`);

      // 6. Comment: 40 px high, over the selection or under it; the sheet quotes the selected text, with no line number
      await pill.waitFor();
      const pillBox = await pill.boundingBox();
      const lineBoxes = await page.evaluate(() => {
        const ranges = [...((CSS as unknown as { highlights: { get(key: string): Iterable<Range> | undefined } }).highlights.get("comment-touch-selection") ?? [])];
        const rects = ranges.flatMap((range) => [...range.getClientRects()]).filter((rect) => rect.width > 0);
        return { top: Math.min(...rects.map((rect) => rect.top)), bottom: Math.max(...rects.map((rect) => rect.bottom)) };
      });
      assert.ok(pillBox !== null && Math.abs(pillBox.height - 40) <= 1, `${device}: Comment is 40 px high (${JSON.stringify(pillBox)})`);
      assert.ok(pillBox!.y + pillBox!.height <= lineBoxes.top || pillBox!.y >= lineBoxes.bottom, `${device}: Comment clear of the selection (${JSON.stringify({ pillBox, lineBoxes })})`);
      await pill.tap();
      await sheet.waitFor();
      assert.equal(await sheet.getAttribute("aria-label"), "Comment", `${device}: the sheet is named Comment`);
      assert.equal((await sheet.locator(".comment-sheet-quote").textContent())?.trim(), "write carries the", `${device}: the sheet quotes the selected text`);
      assert.doesNotMatch(await sheet.innerText(), /\bLines? \d/, `${device}: no line number in the sheet`);
      assert.equal(await sheet.locator(".comment-popover-reference, .comment-popover-code-number").count(), 0, `${device}: no reference or line number`);
      assert.equal(await fieldOf(page).getAttribute("enterkeyhint"), "done", `${device}: the keyboard's Enter says done`);
      await eventually(`${device}: the touch selection dropped`, async () => (await touchText()) === "" && (await handles.count()) === 0 && (await pill.count()) === 0);
      await eventually(`${device}: the selected text in the strong fill`, async () => (await strongText(page)) === "write carries the");
      await fieldOf(page).fill("Touch note");
      await sheet.getByRole("button", { name: "Close", exact: true }).tap();
      await sheet.waitFor({ state: "detached" });
      await eventually(`${device}: the comment stored`, async () => (await storedPreview(page)).some((c) => c.comment === "Touch note"));
      const stored = (await storedPreview(page)).find((c) => c.comment === "Touch note")!;
      assert.deepEqual({ lines: stored.lines, text: stored.text?.trim() }, { lines: [3, 3], text: "write carries the" }, `${device}: on the selected words`);
      console.log(`PASS preview-touch (${device}): Comment (40 px, clear of the selection) opens the sheet quoting the selected text with no line number; typed and closed with ✕, the comment is stored on those words`);

      // 7. a merged count: "1 of 3", › keeps an edit, Delete stays on the next (else the one before), the row goes with one left
      await eventually(`${device}: the counts`, async () => (await counts.count()) >= 2);
      const merged = counts.filter({ hasText: "3" }).first();
      await merged.tap();
      await sheet.waitFor();
      const status = sheet.locator(".comment-sheet-page");
      const previous = sheet.getByRole("button", { name: "Previous comment", exact: true });
      const next = sheet.getByRole("button", { name: "Next comment", exact: true });
      const quoteText = async (): Promise<string | undefined> => (await sheet.locator(".comment-sheet-quote").textContent())?.trim();
      const onPage = (label: string, comment: string): Promise<void> => eventually(`${device}: ${label}, ${comment}`, async () =>
        (await status.textContent().catch(() => null))?.trim() === label && (await fieldOf(page).inputValue().catch(() => null)) === comment);
      assert.equal((await status.textContent())?.trim(), "1 of 3", `${device}: the merged count's sheet says 1 of 3`);
      assert.equal(await previous.isDisabled(), true, `${device}: ‹ disabled on the first`);
      assert.equal(await fieldOf(page).inputValue(), "Note a");
      assert.equal(await quoteText(), "Rule");
      await eventually(`${device}: the shown comment in the strong fill`, async () => (await strongText(page)) === "Rule");
      await fieldOf(page).fill("Note a edited");
      await next.tap();
      await onPage("2 of 3", "Note b");
      assert.equal(await quoteText(), "revisions");
      assert.ok((await storedPreview(page)).some((c) => c.comment === "Note a edited"), `${device}: › kept the edit`);
      await next.tap();
      await onPage("3 of 3", "Note n");
      assert.equal(await next.isDisabled(), true, `${device}: › disabled on the last`);
      assert.equal(await quoteText(), "notes");
      // Delete on the last: the one before
      await sheet.getByRole("button", { name: "Delete", exact: true }).tap();
      await onPage("2 of 2", "Note b");
      assert.ok(!(await storedPreview(page)).some((c) => c.comment === "Note n"), `${device}: Delete removed the shown one`);
      await previous.tap();
      await onPage("1 of 2", "Note a edited");
      // Delete at "1 of 2": the sheet stays on the next, and with one left the row goes
      await sheet.getByRole("button", { name: "Delete", exact: true }).tap();
      await eventually(`${device}: the next one shown, the row gone`, async () => (await fieldOf(page).inputValue().catch(() => null)) === "Note b" && (await status.count()) === 0);
      assert.equal(await quoteText(), "revisions");
      assert.ok(!(await storedPreview(page)).some((c) => c.comment === "Note a edited"), `${device}: Delete removed the shown one`);
      await sheet.getByRole("button", { name: "Close", exact: true }).tap();
      await sheet.waitFor({ state: "detached" });
      console.log(`PASS preview-touch (${device}): a tap on a merged count opens the sheet on "1 of 3" (‹ disabled), › keeps the edit, "3 of 3" has › disabled; Delete on the last shows the one before ("2 of 2"), Delete at "1 of 2" stays on the next, and the row goes with one left`);

      // 8. a finger moving more than 8 px before 450 ms scrolls, and selects nothing
      const start = await wordPoint(previewLine(viewer, 8), "keeps");
      const scrolled = await bodyScroll(viewer);
      await finger("touchStart", start);
      for (let step = 1; step <= 10; step++) await finger("touchMove", { x: start.x, y: start.y - step * 8 });
      await rest();
      await eventually(`${device}: the body scrolled`, async () => (await bodyScroll(viewer)) !== scrolled);
      await frames(page, 30);
      assert.equal(await touchText(), "", `${device}: a move before 450 ms selects nothing`);
      assert.equal(await handles.count(), 0);
      console.log(`PASS preview-touch (${device}): a finger moving more than 8 px before 450 ms scrolls the body and selects nothing`);

      // 9. the composer's walk on a touch screen opens the sheet, editable with the mode on
      await viewer.getByRole("button", { name: "Close file", exact: true }).tap();
      await viewer.waitFor({ state: "detached" });
      const walk = walkOf(page);
      await walk.tap();
      viewer = page.getByRole("dialog", { name: "spec.md", exact: true });
      await sheet.waitFor();
      assert.equal(await sheet.locator("textarea").count(), 1, `${device}: the walk's sheet, the mode on, is editable`);
      assert.ok(["Touch note", "Note b", "Note c"].includes(await fieldOf(page).inputValue()), `${device}: holding a comment`);
      await sheet.getByRole("button", { name: "Close", exact: true }).tap();
      await sheet.waitFor({ state: "detached" });
      console.log(`PASS preview-touch (${device}): with a coarse pointer the composer's walk opens the comment in the sheet, editable with the mode on`);

      // 10. the mode off: the system's selection back, a count opens the read-only sheet, and so does the walk
      await viewer.locator("button.file-viewer-comments").tap();
      await eventually(`${device}: the mode off`, async () => (await viewer.locator("button.file-viewer-comments").getAttribute("aria-pressed")) === "false");
      assert.notEqual(await viewer.locator(".file-viewer-markdown").evaluate((node) => getComputedStyle(node).userSelect), "none", `${device}: the text selects again`);
      let offHold: { menu: boolean; select: boolean } | null = null;
      await holdOn(await wordPoint(previewLine(viewer, 3), "carries"), async () => { offHold = await prevented(); });
      await finger("touchEnd");
      await frames(page, 6);
      assert.deepEqual(offHold, { menu: false, select: false }, `${device}: the mode off, a long press keeps the system's menu and selection`);
      assert.equal(await touchText(), "", `${device}: and makes no app selection`);
      assert.equal(await viewer.locator(".markdown-touch-handle").count(), 0);
      await selectText(previewLine(viewer, 3), "write", previewLine(viewer, 3), "carries");
      await frames(page, 6);
      assert.equal(await page.evaluate(() => window.getSelection()?.toString()), "write carries", `${device}: a selection is the system's again`);
      assert.equal(await popoverOf(page).count(), 0, `${device}: and opens nothing`);
      await page.evaluate(() => window.getSelection()?.removeAllRanges());
      const single = countsIn(viewer).filter({ hasText: /^\s*1\s*$/ }).last();
      await single.tap();
      await sheet.waitFor();
      assert.equal(await sheet.locator("textarea").count(), 0, `${device}: the read-only sheet has no input`);
      assert.deepEqual(await sheet.locator("button").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label") ?? node.textContent)), ["Close"], `${device}: no buttons but ✕`);
      assert.ok((await sheet.innerText()).includes("Note c") || (await sheet.innerText()).includes("Touch note"), `${device}: the comment shown as text`);
      await sheet.getByRole("button", { name: "Close", exact: true }).tap();
      await sheet.waitFor({ state: "detached" });
      await viewer.getByRole("button", { name: "Close file", exact: true }).tap();
      await viewer.waitFor({ state: "detached" });
      await walk.tap();
      viewer = page.getByRole("dialog", { name: "spec.md", exact: true });
      await sheet.waitFor();
      assert.equal(await sheet.locator("textarea").count(), 0, `${device}: the walk's sheet, the mode off, is read-only`);
      await sheet.getByRole("button", { name: "Close", exact: true }).tap();
      await sheet.waitFor({ state: "detached" });
      console.log(`PASS preview-touch (${device}): with the mode off the text takes the system's selection again (a long press makes no app selection, keeps its menu), a count opens the read-only sheet (no input, no buttons but ✕), and the walk opens it read-only`);
      assert.deepEqual(errors, []);
      await close();
    }
  },

  /**
   * A wide touch screen (1600 × 900, the viewer full screen): cards in the margin, right of the text, which keeps the
   * place and width it has with comments off; a 1180 px one has no room for them (counts). A finger's tap on a card opens
   * the sheet, a mouse's click edits it in place (each press by its own `pointerType`).
   */
  async "preview-touch-wide"(open) {
    const id = "seed-wide";
    const other = "seed-wide-other";
    const seed = [selectedComment(id, 8, 0, 4, "Wide note", 1), selectedComment(other, 10, 0, 4, "Other note", 2)];
    const screen: BrowserContextOptions = { viewport: { width: 1600, height: 900 }, hasTouch: true, isMobile: true };
    // 1180 px: the text (its lane, 820 px) leaves short of 24 + 280 px right of it
    const tablet = await open({ viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true }, seed);
    const tabletViewer = await openSpec(tablet.page, true);
    // the two comments' lines are closer than a finger's targets allow: one count
    await eventually("a count on a 1180 px screen", async () => (await countsIn(tabletViewer).count()) === 1);
    assert.equal(await cardsIn(tabletViewer).count(), 0, "no cards where the free space is short");
    await tablet.close();
    const plain = await open(screen, seed, { comments: false });
    const plainText = await textBoxOf(await openSpec(plain.page, true));
    await plain.close();
    const { page, errors, close } = await open(screen, seed);
    const viewer = await openSpec(page, true);
    const sheet = page.locator(".modal-scrim > .modal.comment-popover.is-sheet");
    await eventually("two cards", async () => (await cardsIn(viewer).count()) === 2);
    assert.equal(await countsIn(viewer).count(), 0, "no counts where the margin fits");
    const column = await textBoxOf(viewer);
    assert.ok(Math.abs(column.left - plainText.left) <= 0.5 && Math.abs(column.width - plainText.width) <= 0.5, `the text has the place and width it has with comments off (${JSON.stringify({ column, plainText })})`);
    for (const box of await boxesOf(cardsIn(viewer))) assert.ok(Math.abs(box.x - (column.right + 24)) <= 1 && box.x + box.width <= column.bodyRight + 0.5, `a card 24 px right of the text, inside the body (${JSON.stringify({ box, column })})`);
    for (const index of [0, 1]) assert.ok(await hitAtCentre(cardsIn(viewer).nth(index)), `nothing clips or covers card ${index + 1}`);
    console.log("PASS preview-touch-wide: a 1180 px touch screen shows counts; at 1600 × 900 cards show right of the text, which keeps its place and width, nothing over them");
    const toggle = viewer.locator("button.file-viewer-comments");
    await toggle.tap();
    await eventually("the mode on", async () => (await toggle.getAttribute("aria-pressed")) === "true");
    await cardIn(viewer, id).tap();
    await sheet.waitFor();
    assert.equal(await fieldOf(page).inputValue(), "Wide note", "the sheet holds the card's comment");
    assert.equal((await sheet.locator(".comment-sheet-quote").textContent())?.trim(), "Rule", "and quotes its text");
    assert.equal(await viewer.locator(".markdown-comment-card.is-editing").count(), 0, "the card is not edited in place");
    await sheet.getByRole("button", { name: "Close", exact: true }).tap();
    await sheet.waitFor({ state: "detached" });
    console.log("PASS preview-touch-wide: at 1600 × 900 on a touch screen a finger's tap on a card opens the sheet");
    const box = (await cardIn(viewer, id).boundingBox())!;
    await page.mouse.click(box.x + 20, box.y + box.height / 2);
    await viewer.locator(".markdown-comment-card.is-editing .comment-popover.is-row").waitFor();
    assert.equal(await sheet.count(), 0, "a mouse's click edits in place, no sheet");
    await page.keyboard.press("Escape");
    await eventually("the card back", async () => (await viewer.locator(".markdown-comment-card.is-editing").count()) === 0);
    console.log("PASS preview-touch-wide: a mouse's click on the same card edits it in place");

    // one comment field open at a time: the card's field a mouse opened is left (what was typed kept) as a finger's tap
    // on the other card opens the sheet. The tap is in the comment layer, so the field's own outside press does not leave it
    const again = (await cardIn(viewer, id).boundingBox())!;
    await page.mouse.click(again.x + 20, again.y + again.height / 2);
    const editing = viewer.locator(".markdown-comment-card.is-editing .comment-popover.is-row textarea");
    await editing.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" Kept.");
    assert.equal(await editing.inputValue(), "Wide note Kept.", "typed into the card's field");
    await cardIn(viewer, other).tap();
    await sheet.waitFor();
    assert.equal(await sheet.getByRole("textbox", { name: "Comment", exact: true }).inputValue(), "Other note", "the sheet holds the other card's comment");
    await eventually("the card's field left as the sheet opens", async () => (await viewer.locator(".markdown-comment-card.is-editing").count()) === 0)
      .catch(async (error: Error) => { throw new Error(`${error.message} (stored ${JSON.stringify((await storedPreview(page)).map((c) => c.comment))})`); });
    assert.ok((await storedPreview(page)).some((c) => c.comment === "Wide note Kept."), "what was typed in the left field is kept");
    await sheet.getByRole("button", { name: "Close", exact: true }).tap();
    await sheet.waitFor({ state: "detached" });
    console.log("PASS preview-touch-wide: a card's field is left, its text kept, as a finger's tap opens the sheet on another card");
    assert.deepEqual(errors, []);
    await close();
  },

  /**
   * The viewer's header: the comment mode's toggle names the file's comments (their count, with any outdated) and walks
   * nothing; the comments follow their lines when the file changes (a card under the moved line, the store told) and one
   * whose lines changed is outdated (no card). It has no Write message button (Close is the way back to the message box),
   * and the Markdown preview has the comment toggle as its source does. The composer's bar walks the comments (`composer`).
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
      assert.equal(await toggle.locator(".comment-mode-count").textContent(), "2", "the count is a badge on the icon");
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
          if (!key.startsWith("ovis:block-comments:")) continue;
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

      // 4. the Markdown preview takes the comment mode too: its header has the toggle, named for its comment, as its source's
      const spec = await openSpec(page);
      const specToggle = spec.locator("button.file-viewer-comments");
      assert.equal(await specToggle.count(), 1, "the preview shows the comment toggle");
      assert.equal(await specToggle.getAttribute("aria-label"), "Comment mode, 1 comment");
      await spec.getByRole("button", { name: "Show source", exact: true }).click();
      await lineOf(spec, 42).waitFor();
      assert.equal(await spec.locator("button.file-viewer-comments").count(), 1, "its source shows one");
      console.log("PASS header: the Markdown preview shows the comment toggle, as its source does");
      assert.deepEqual(errors, []);
    } finally {
      writeSync(SYNC_LINES);
      await close();
    }
  },

  /**
   * The composer's bar counts the file comments too, and its walk goes on from the chat's comments into the files: each
   * file stop opens the viewer at that comment, in the view it was written in. In the preview, the mode on, it opens the
   * field of the comment's count (a desktop's viewer has no room for cards), scrolling only the viewer's body; in the code view it scrolls the comment's card into view and marks it current until the next click, with no field
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

      // the chat's comment, written as in the chat case: a reply comment's anchor is the chat's to make. The comment mode
      // on by the chat's toggle (it is the device's: the preview's and the code view's too)
      const chatToggle = page.locator(".chat-frame-body > button.chat-comments-toggle");
      await chatToggle.click();
      await eventually("the mode on", async () => (await chatToggle.getAttribute("aria-pressed")) === "true");
      const paragraph = page.locator(".chat-view .markdown p", { hasText: REPLY });
      await dragText(page, null, paragraph, "every revision", paragraph, "in order");
      await chat.locator("> .markdown-comments-field .comment-popover.is-row").waitFor();
      await page.keyboard.type("Say which order.");
      await page.keyboard.press("Enter");
      await eventually("the chat's comment stored", async () => (await walk.getAttribute("aria-label")) === "5 comments");
      await eventually("the bar to count 5 comments", async () => (await walk.getAttribute("aria-label")) === "5 comments");
      assert.equal(await walk.locator(".composer-comments-text").textContent(), "5 comments");
      console.log("PASS composer: with one comment on the reply and four on files, the bar reads 5 comments");

      /** Whether the preview's count of `id` is open, its one field holding `text`. */
      const openedInViewer = async (viewer: Locator, id: string, text: string): Promise<boolean> => {
        const count = viewer.locator(`.file-viewer-body > .comment-margin .markdown-comment-count[data-comment-ids~="${id}"]`);
        const field = countFieldsIn(viewer).getByRole("textbox", { name: "Comment", exact: true });
        return (await count.getAttribute("aria-expanded").catch(() => null)) === "true" && (await field.count()) === 1 && (await field.inputValue()) === text;
      };

      // tap 1: the chat's comment, its field open (the mode on)
      await walk.click();
      await eventually("the walk to open the chat's comment", async () => (await chat.locator(".comment-popover").count()) === 1 && (await popoverText(page)) === "Say which order.");
      assert.equal(await page.locator(".file-viewer").count(), 0, "the chat's stop opens no viewer");
      console.log("PASS composer: tap 1 opens the chat's comment in its field");

      // tap 2: the viewer opens docs/spec.md in the preview, at its comment
      await walk.click();
      const spec = page.getByRole("dialog", { name: "spec.md", exact: true });
      await spec.locator(".file-viewer-markdown").waitFor();
      await eventually("the viewer to open the spec's comment", () => openedInViewer(spec, table, "Also return the stored revision."));
      assert.equal(await spec.getByRole("button", { name: "Show source", exact: true }).getAttribute("aria-pressed"), "false", "the preview shows");
      await fieldFocused(page);
      await eventually("the count in view", () => inBody(spec, `.file-viewer-body > .comment-margin .markdown-comment-count[data-comment-ids~="${table}"]`));
      assert.ok(await bodyScroll(spec) > 0, "the viewer's body scrolled to the table");
      assert.equal(await outerScroll(spec), 0, "the page did not scroll");
      // the mode off again for the code view's stop with it off (the toggle's press leaves the unchanged field)
      const specToggle = spec.locator("button.file-viewer-comments");
      await specToggle.click();
      await eventually("the mode to turn off", async () => (await specToggle.getAttribute("aria-pressed")) === "false");
      await eventually("the field to close", async () => (await spec.locator(".comment-popover").count()) === 0);
      await spec.getByRole("button", { name: "Close file", exact: true }).click();
      await spec.waitFor({ state: "detached" });
      console.log("PASS composer: tap 2 opens docs/spec.md in the preview with the comment's count's field open, focused and holding it, scrolling only the viewer's body");

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
      await openSettingsPage(page, "Comments");
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
      // the field edited: Escape with text typed saves the edit and closes the dialog, the viewer staying
      await fieldOf(page).fill("Say why a write is skipped, exactly.");
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
      await eventually("the edit to be stored", async () => (await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("ovis:block-comments:")).map((key) => localStorage.getItem(key)).join(""))).includes("Say why a write is skipped, exactly."));
      assert.ok(await sync.isVisible(), "the viewer stays");
      await sync.getByRole("button", { name: "Close file", exact: true }).click();
      await sync.waitFor({ state: "detached" });
      console.log("PASS composer: tap 3 opens src/sync.ts with the outdated comment on line 5 in a dialog (its reference, the old quote, the note, ✕ and Delete); Tab stays in it, Settings and its question lie above it, Escape with text typed saves the edit and closes it, the viewer staying");

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
      await eventually("the walk to wrap to the chat's comment", async () => (await chat.locator(".comment-popover").count()) === 1 && (await popoverText(page)) === "Say which order.");
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
        for (const key of Object.keys(localStorage).filter((name) => name.startsWith("ovis:block-comments:"))) {
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
          if (key.startsWith("ovis:block-comments:")) count += (JSON.parse(localStorage.getItem(key)!) as { comments: unknown[] }).comments.length;
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

    // the chat, the mode off: a touch selection opens nothing, and there is no Comment button. With the mode on (the
    // chat's toggle) a long press selects a word in the app's selection, and its Comment opens the sheet
    const paragraph = page.locator(".chat-view .markdown p", { hasText: REPLY });
    await selectText(paragraph, "every revision", paragraph, "in order");
    await frames(page, 10);
    assert.equal(await popoverOf(page).count(), 0, "a touch selection opens nothing");
    await assertNoButton(page, "a touch selection in the chat");
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    const chatToggle = page.locator(".chat-frame-body > button.chat-comments-toggle");
    await chatToggle.tap();
    await eventually("the mode on", async () => (await chatToggle.getAttribute("aria-pressed")) === "true");
    const finger = await fingerOf(page);
    const word = await wordPoint(paragraph, "revision");
    const held = Date.now();
    await finger("touchStart", word);
    // the Markdown layer's long press (lib/touchSelection.ts `TOUCH_HOLD_MS`, 450 ms), not the code view's
    await holdUntil(held + TOUCH_HOLD_MS + 150);
    await finger("touchEnd");
    const pill = page.getByRole("button", { name: "Comment", exact: true });
    await pill.waitFor();
    assert.ok(await tapFocuses(pill, "nearest"), "the chat's sheet takes the focus inside the tap on Comment");
    const sheet = dialogOf(page);
    await sheet.waitFor();
    await keyboardUp(page.locator(".chat-view"));
    console.log("PASS form-phone: a touch selection in the chat opens nothing with the mode off, no Comment button; with it on, a long press's Comment opens the sheet with its field focused inside the tap; the sheet stays in view as the keyboard rises");

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
    // the mode off again: the code view's toggle below turns it on
    await chatToggle.tap();
    await eventually("the mode off", async () => (await chatToggle.getAttribute("aria-pressed")) === "false");

    // the code view, in comment mode with Settings → On mobile, comment with → Tap (a long press opens its sheet from a
    // timer, outside any tap): a tap on a line at the view's bottom edge
    await page.getByRole("button", { name: "big.txt", exact: true }).tap();
    const viewer = page.getByRole("dialog", { name: "big.txt", exact: true });
    await lineOf(viewer, 40).waitFor();
    await viewer.locator("button.file-viewer-comments").tap();
    await page.keyboard.press("ControlOrMeta+Shift+Comma");
    await openSettingsPage(page, "Comments");
    const settingsDialog = page.locator(".settings-dialog");
    await settingsDialog.locator(".settings-section", { has: page.getByRole("heading", { name: "Code view", exact: true }) }).getByRole("button", { name: "Tap", exact: true }).tap();
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
    await openSettingsPage(page, "Comments");
    await settingsDialog.locator(".settings-section", { has: page.getByRole("heading", { name: "Code view", exact: true }) }).getByRole("button", { name: "Below the line", exact: true }).tap();
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
  const open = async (options: BrowserContextOptions, seed: readonly object[] = [], settings: Record<string, unknown> = {}): Promise<Opened> => {
    const context = await launched.newContext(options);
    const page = await context.newPage();
    await page.addInitScript((id) => {
      // a fresh context's settings; a reload keeps what the page changed since (comment mode)
      if (localStorage.getItem("ovis:settings") === null) localStorage.setItem("ovis:settings", JSON.stringify({ language: "en", commentOnSelect: "field", ...id.settings }));
      localStorage.setItem(`ovis:view:${id.pane}`, "chat");
      // seeded once: a reload keeps what the page has done to them since
      const key = `ovis:block-comments:${id.pane}`;
      if (id.seed.length > 0 && localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify({ version: 1, comments: id.seed }));
    }, { pane, seed, settings });
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
