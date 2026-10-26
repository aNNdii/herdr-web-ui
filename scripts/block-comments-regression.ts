/**
 * Comments on an agent's replies in the chat, with a real Codex transcript (many turns, one reply in two answer parts)
 * and an owned herdr pane, on the Markdown comment layer the file viewer's preview has (components/MarkdownComments.tsx,
 * components/ChatComments.tsx): the app-wide comment mode and its toggle left of Find; with it on, a mouse's selection in
 * a reply opens the comment field over it (cut to the first answer part it touches, never the user's bubble), Enter or
 * leaving saves; each comment's text keeps a soft mark; its card (or count) sits beside its reply, in the free space
 * right of the transcript (never moving the text), from the reply's virtualized row, which grows when its cards run past
 * its text; cards edit and delete in place, read-only with the mode
 * off; a finger's own selection and the sheet on a touch screen; the composer's walk through the comments shown, then
 * the dialog for one whose turn is not loaded, then the file comments; the send; the setting that turns comments off;
 * and a whole-block comment stored before selections.
 *
 * One server, pane and browser per run. Each case starts from a fresh page with an empty comment store (or the
 * comments it seeds), so a case runs alone: `BLOCK_COMMENTS_CASE=<name>[,<name>]` runs only those (unset: all).
 * Waits are bounded polls (`eventually`, `frames`), never fixed sleeps. Serves `dist/`: build first.
 */
import "./test-herdr.ts";
import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type BrowserContextOptions, type Locator, type Page } from "playwright-core";
import { createServer } from "../server/index.ts";
import { herdrRpc, workspaceClose, workspaceCreate } from "../server/herdr/client.ts";
import { openSettingsPage } from "./settings-page.ts";
import { TOUCH_HOLD_MS } from "../src/lib/touchSelection.ts";

const INTRO = "Intro paragraph about the state.";
const LONG_PARAGRAPH = "A longer paragraph that runs across several lines on a phone, so its first line reaches the right edge of the column.";
const ANSWER = [
  INTRO,
  "",
  "1. Run the migration",
  "2. Restart the server",
  "   - check the logs",
  "",
  "See [docs](https://example.com) and open [spec.md](./docs/spec.md).",
  "",
  LONG_PARAGRAPH,
  "",
  "```ts",
  "const a = 1;",
  "```",
  "",
  // more than a view of text: the walk has to scroll to a comment, and a view of the end hides the intro
  ...Array.from({ length: 14 }, (_, n) => `Step ${n + 1} of the rollout keeps the service up while it moves.\n`),
].join("\n");
/** The reply before the last one, in two answer parts (two final-answer messages of one turn). */
const SPLIT_ONE = "First part of the split answer names the plan.";
const SPLIT_TWO = "Second part of the split answer gives the steps in order.";
/** The final reply's turn: its time is its comments' turn key. */
const FINAL_TS = "2026-10-04T10:01:05.000Z";
/** An earlier reply, tall enough that the final reply's row leaves the list's window when the chat is scrolled to its top. */
const earlier = (n: number): string => Array.from({ length: 9 }, (_, p) => `Earlier reply ${n}, paragraph ${p + 1}: the rollout notes keep growing so the chat is long.`).join("\n\n");
const SPEC_LINES = ["# Spec", "", "The spec line a file comment is on.", ""];
/** How many earlier exchanges come before the split reply, and the time of the `second`th second of the earlier ones. */
const EARLIER = 24;
const at = (second: number): string => new Date(Date.parse("2026-10-04T09:00:00.000Z") + second * 1000).toISOString();

const root = mkdtempSync(join(tmpdir(), "herdr-web-ui-block-comments-"));
const codexHome = join(root, "codex-home");
const thread = "01a0c7a1-56d9-7e20-9f08-f7a2d973bc12";
mkdirSync(join(codexHome, "sessions"), { recursive: true });
const transcript = join(codexHome, "sessions", `rollout-2026-10-04T00-00-00-${thread}.jsonl`);
const user = (ts: string, text: string): object => ({ timestamp: ts, type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text }] } });
const assistant = (ts: string, text: string): object => ({ timestamp: ts, type: "response_item", payload: { type: "message", role: "assistant", phase: "final_answer", content: [{ type: "output_text", text }] } });
writeFileSync(transcript, [
  { type: "session_meta", payload: { id: thread, cwd: root } },
  // earlier exchanges enough that the list mounts only a window of them (its pool of rows is sized by the view, so a
  // dozen turns would all stay drawn), then the split reply's and the final one
  ...Array.from({ length: EARLIER }, (_, i) => i + 1).flatMap((n) => [user(at(n * 2), `Question ${n}.`), assistant(at(n * 2 + 1), earlier(n))]),
  user("2026-10-04T10:00:30.000Z", "Split it in two."),
  assistant("2026-10-04T10:00:35.000Z", SPLIT_ONE),
  assistant("2026-10-04T10:00:36.000Z", SPLIT_TWO),
  user("2026-10-04T10:01:00.000Z", "Show me the plan."),
  assistant(FINAL_TS, ANSWER),
].map((row) => JSON.stringify(row)).join("\n"));
const db = new Database(join(codexHome, "state_5.sqlite"));
db.exec("CREATE TABLE threads (id TEXT, rollout_path TEXT, cwd TEXT, archived INTEGER, agent_role TEXT, created_at INTEGER, updated_at INTEGER, source TEXT, first_user_message TEXT)");
db.query("INSERT INTO threads VALUES (?, ?, ?, 0, NULL, 1, 1, 'cli', ?)").run(thread, transcript, root, "Question 1.");
db.close();
const standIn = join(root, "codex");
writeFileSync(standIn, "#!/bin/sh\nsleep 600\n");
chmodSync(standIn, 0o755);
mkdirSync(join(root, "docs"));
writeFileSync(join(root, "docs", "spec.md"), `${SPEC_LINES.join("\n")}\n`);
const specPath = realpathSync(join(root, "docs", "spec.md"));

const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };
/** A wide window: the chat pane has room for the cards' margin. */
const WIDE: BrowserContextOptions = { viewport: { width: 1920, height: 900 } };
/** A narrow window: counts. */
const NARROW: BrowserContextOptions = { viewport: { width: 760, height: 800 } };
/** 393 × 852, a touch screen. */
const IPHONE_14_PRO: BrowserContextOptions = { viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true };

/** Polls `check` every 50 ms until it holds; throws at the deadline (no fixed sleeps). */
async function eventually(what: string, check: () => Promise<boolean>, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(50);
  }
}

/** Polls the clock until it reaches `at` (`Date.now()` ms): a finger held on the screen until then (a long press is measured in time alone). */
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

/** A finger through CDP's touch events: the browser makes its own pointer events, a tap's click, a long press. */
type Finger = (type: "touchStart" | "touchMove" | "touchEnd", at?: { x: number; y: number }) => Promise<void>;
async function fingerOf(page: Page): Promise<Finger> {
  const cdp = await page.context().newCDPSession(page);
  return async (type, at) => {
    await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: at === undefined ? [] : [{ x: at.x, y: at.y }] });
  };
}

/** The highlights the comments' text is painted in (lib/commentHighlight.ts): a layer each at rest, the strong fill in focus. */
const MARKED_HIGHLIGHTS = ["comment-layer-0", "comment-layer-1", "comment-layer-2", "comment-layer-3", "comment-strong", "comment-pending"];

/** How many ranges the named CSS Custom Highlights hold. */
const highlighted = (page: Page, names: string | readonly string[] = MARKED_HIGHLIGHTS): Promise<number> => page.evaluate((wanted) => {
  const registry = (CSS as unknown as { highlights?: { get(key: string): { size: number } | undefined } }).highlights;
  return wanted.reduce((sum, name) => sum + (registry?.get(name)?.size ?? 0), 0);
}, typeof names === "string" ? [names] : [...names]);

/** The text the named CSS Custom Highlights paint, their ranges joined by spaces, blanks folded. */
const highlightText = (page: Page, names: string | readonly string[]): Promise<string> => page.evaluate((wanted) => {
  const registry = (CSS as unknown as { highlights?: { get(key: string): Iterable<AbstractRange> | undefined } }).highlights;
  return wanted.flatMap((name) => [...(registry?.get(name) ?? [])]).map((range) => range instanceof Range ? range.toString() : "").join(" ");
}, typeof names === "string" ? [names] : [...names]).then((text) => text.replace(/\s+/g, " ").trim());
/** What the strong fill paints: the selection a field is open on, or the comment in focus. */
const strongText = (page: Page): Promise<string> => highlightText(page, "comment-strong");
/** What the comments' layers paint at rest. */
const markedText = (page: Page): Promise<string> => highlightText(page, MARKED_HIGHLIGHTS.slice(0, 4));

/** Any comment popover, wherever it is drawn. */
const popoverOf = (page: Page): Locator => page.locator(".comment-popover");
/** The field over a selection (or a count's fields), portalled into the chat's scroller. */
const selectionFieldOf = (page: Page): Locator => page.locator(".chat-view > .markdown-comments-field .comment-popover.is-row");
/** The popover as a dialog of its own (the walk's, for a comment whose text is not shown). */
const dialogOf = (page: Page): Locator => page.locator(".modal-scrim > .modal.comment-popover");
/** The touch sheet. */
const sheetOf = (page: Page): Locator => page.locator(".modal-scrim > .modal.comment-popover.is-sheet");
const fieldOf = (page: Page): Locator => popoverOf(page).getByRole("textbox", { name: "Comment", exact: true });
const messageOf = (page: Page): Locator => page.getByRole("textbox", { name: "Message", exact: true });
/** A paragraph of a reply (or of the user's bubble) holding `text`. */
const partOf = (page: Page, text: string): Locator => page.locator(".chat-view .markdown p", { hasText: text });
/** The user's bubble holding `text`. */
const bubbleOf = (page: Page, text: string): Locator => page.locator(".chat-view .chat-bubble", { hasText: text });
/** The list row holding `text`. */
const rowOf = (page: Page, text: string): Locator => page.locator(".chat-view [data-chat-row]", { hasText: text });
/** The comment mode's toggle beside Find. */
const toggleOf = (page: Page): Locator => page.locator(".chat-frame-body > button.chat-comments-toggle");
/** The margins' cards and counts in the chat's rows, in document order. */
const cardsOf = (page: Page): Locator => page.locator(".chat-view [data-chat-row] .comment-margin .markdown-comment-card");
const countsOf = (page: Page): Locator => page.locator(".chat-view [data-chat-row] .comment-margin .markdown-comment-count");
/** The card of the comment whose text is `comment`. */
const cardWith = (page: Page, comment: string): Locator => cardsOf(page).filter({ hasText: comment });
/** The comments' context bar above the message box, and its text, which walks to them. */
const barOf = (page: Page): Locator => page.locator(".composer-surface > .composer-comments-bar");
const walkOf = (page: Page): Locator => barOf(page).locator("button.composer-comments-walk");

/** Whether the focused element matches `selector`. */
const focusedMatches = (page: Page, selector: string): Promise<boolean> => page.evaluate((wanted) => document.activeElement?.matches(wanted) ?? false, selector);
/** Waits for a comment field to take the focus. */
const fieldFocused = (page: Page): Promise<void> => eventually("a comment field to take the focus", () => focusedMatches(page, ".comment-popover textarea"));
const deleteOf = (page: Page): Locator => popoverOf(page).getByRole("button", { name: "Delete comment", exact: true });
const closeOf = (page: Page): Locator => popoverOf(page).getByRole("button", { name: "Close", exact: true });

/** One comment as the store keeps it. */
interface StoredComment { id: string; anchor: string; comment: string; quote?: string; kind?: string }
const storedOf = (page: Page): Promise<StoredComment[]> => page.evaluate(() => {
  const found: unknown[] = [];
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("ovis:block-comments:")) found.push(...(JSON.parse(localStorage.getItem(key)!) as { comments: unknown[] }).comments);
  }
  return found as StoredComment[];
});
/** The stored comments' texts, sorted. */
const storedTexts = async (page: Page): Promise<string[]> => (await storedOf(page)).map((entry) => entry.comment).sort();

const scrollOf = (page: Page): Promise<number> => page.locator(".chat-view").evaluate((node) => node.scrollTop);

/** The center of the first `word` in `element`'s text, in client pixels, its line scrolled to the chat view's middle first. */
async function wordPoint(element: Locator, word: string): Promise<{ x: number; y: number }> {
  return element.evaluate((node, wanted) => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    for (let next = walker.nextNode(); next; next = walker.nextNode()) {
      const at = (next as Text).data.indexOf(wanted);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(next, at);
      range.setEnd(next, at + wanted.length);
      const view = document.querySelector(".chat-view")!;
      const box = view.getBoundingClientRect();
      const first = range.getBoundingClientRect();
      view.scrollBy({ top: first.top + first.height / 2 - (box.top + box.height / 2), behavior: "instant" });
      const rect = range.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    throw new Error(`"${wanted}" is not in the element`);
  }, word);
}

/** The left edge of the first character of `word` (`end` false) or the right edge of its last, in `element`, client pixels, without scrolling. */
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

/**
 * A mouse's drag from the start of `from` in `first` to the end of `to` in `last` (a real press, moves and release, one
 * click), `first`'s line scrolled to the chat's middle first.
 */
async function dragAcross(page: Page, first: Locator, from: string, last: Locator, to: string): Promise<void> {
  await wordPoint(first, from);
  const start = await wordEdge(first, from, false);
  const end = await wordEdge(last, to, true);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2, { steps: 4 });
  await page.mouse.move(end.x, end.y, { steps: 4 });
  await page.mouse.up();
}

/** A comment `text` on `from`…`to` of `part` by a mouse's drag, typed at once and saved with Enter (the mode on). */
async function commentOn(page: Page, part: Locator, from: string, to: string, text: string): Promise<void> {
  const before = (await storedOf(page)).length;
  await dragAcross(page, part, from, part, to);
  await selectionFieldOf(page).waitFor();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
  await selectionFieldOf(page).waitFor({ state: "detached" });
  await eventually(`"${text}" to be stored`, async () => (await storedOf(page)).length === before + 1);
}

/** Turns the comment mode on by the chat's toggle (a mouse's click). */
async function modeOn(page: Page): Promise<Locator> {
  const toggle = toggleOf(page);
  await toggle.waitFor();
  assert.equal(await toggle.getAttribute("aria-pressed"), "false", "the mode starts off");
  await toggle.click();
  await eventually("the mode to turn on", async () => (await toggle.getAttribute("aria-pressed")) === "true");
  return toggle;
}

/** Whether `selector`'s first match lies inside the chat view's visible box (1 px of slack). */
const inView = (page: Page, selector: string): Promise<boolean> => page.evaluate((wanted) => {
  const node = document.querySelector(wanted);
  const view = document.querySelector(".chat-view")!;
  if (node === null) return false;
  const box = node.getBoundingClientRect();
  const outer = view.getBoundingClientRect();
  const top = outer.top + view.clientTop;
  return box.height > 0 && box.top >= top - 1 && box.bottom <= top + view.clientHeight + 1;
}, selector);

/** The chat view's scroll position stays put for a few frames in a row: a smooth scroll has ended. */
async function scrollSettled(page: Page): Promise<void> {
  let last = -1;
  let still = 0;
  await eventually("the chat view to stop scrolling", async () => {
    await frames(page, 2);
    const now = await scrollOf(page);
    still = now === last ? still + 1 : 0;
    last = now;
    return still >= 3;
  }, 5000);
}

/** The client box of the first line of `word` in `element`. */
const lineBox = (element: Locator, word: string): Promise<{ top: number; left: number; right: number }> => element.evaluate((node, wanted) => {
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  for (let next = walker.nextNode(); next; next = walker.nextNode()) {
    const at = (next as Text).data.indexOf(wanted);
    if (at < 0) continue;
    const range = document.createRange();
    range.setStart(next, at);
    range.setEnd(next, at + 1);
    const rect = range.getClientRects()[0]!;
    const paragraph = node.getBoundingClientRect();
    return { top: rect.top, left: rect.left, right: paragraph.right };
  }
  throw new Error(`"${wanted}" is not in the element`);
}, word);

/**
 * Where the reply's text is (client pixels): the intro paragraph's box and the transcript's (left and width), the
 * paragraph's content right edge and the right edge of its glyphs, and the right edge of what the chat's scroller shows
 * (its padding box): the free space a reply's margin takes lies between the text's edge and that one.
 */
const replyPlace = (page: Page): Promise<{ text: { left: number; width: number }; transcript: { left: number; width: number }; right: number; glyphs: number; viewRight: number }> =>
  partOf(page, INTRO).evaluate((node) => {
    const box = node.getBoundingClientRect();
    const transcript = node.closest(".chat-transcript")!.getBoundingClientRect();
    const view = node.closest<HTMLElement>(".chat-view")!;
    const outer = view.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(node);
    const glyphs = Math.max(...[...range.getClientRects()].filter((rect) => rect.width > 0).map((rect) => rect.right));
    return {
      text: { left: box.left, width: box.width }, transcript: { left: transcript.left, width: transcript.width },
      right: box.right - Number.parseFloat(getComputedStyle(node).paddingRight), glyphs, viewRight: outer.left + view.clientLeft + view.clientWidth,
    };
  });

/**
 * Whether a point at the centre of `element`'s box hits it or what is in it: nothing clips (a row, the list) or covers it
 * there. The element is scrolled to the middle of the chat first (`elementFromPoint` sees only what is on screen).
 */
const hitAtCentre = (element: Locator): Promise<boolean> => element.evaluate((node) => {
  node.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
  const box = node.getBoundingClientRect();
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  return hit !== null && node.contains(hit);
});

/** The context and page of a case: the pane's chat, its reply drawn. `errors` collects the page's, `sent` the texts it submitted to the pane. */
interface Opened { page: Page; context: BrowserContext; url: string; errors: string[]; sent: string[]; close: () => Promise<void> }
type Open = (options: BrowserContextOptions, seed?: { comments?: readonly object[]; settings?: Record<string, unknown> }) => Promise<Opened>;
type Case = (open: Open) => Promise<void>;

/** A stored comment on a reply that is not in the chat: its turn is not loaded. The walk reaches it in a dialog. */
const UNLOADED = {
  id: "unloaded-1",
  anchor: "2026-01-01T00:00:00.000Z:0:0",
  order: [Date.parse("2026-01-01T00:00:00.000Z"), 0, 0],
  block: { type: "paragraph", lines: [[{ type: "text", value: "A reply from a turn the chat has not loaded." }]] },
  comment: "Is this still true?",
};
/** A whole-block comment on the final reply's intro, stored as one was before selections (no quote). */
const LEGACY = {
  id: "legacy-1",
  anchor: `${FINAL_TS}:0:0`,
  order: [Date.parse(FINAL_TS), 0, 0],
  block: { type: "paragraph", lines: [[{ type: "text", value: INTRO }]] },
  comment: "Old block note.",
};
/** A file comment on docs/spec.md's preview: the walk reaches it after the reply's comments. */
const SPEC_COMMENT = {
  kind: "file", id: "spec-1", anchor: `file:${specPath}:preview:3-3`, created: 1, comment: "Spec note.", path: specPath,
  label: "docs/spec.md", view: "preview", lines: [3, 3], source: [SPEC_LINES[2]], quoteLines: [SPEC_LINES[2]],
};

/**
 * The margin never moves the text: on `options`' screen, with comments off, counts, or cards wanted (the default), the
 * reply's text and the transcript have one place and width, a comment (`LEGACY`, on the final reply's intro) beside it.
 * Returns the page with cards wanted, its margin drawn, for the caller to look at it; the caller closes it.
 */
async function textUnmoved(open: Open, options: BrowserContextOptions, device: string): Promise<Opened> {
  const placed = async (settings: Record<string, unknown>): Promise<{ opened: Opened; place: Awaited<ReturnType<typeof replyPlace>> }> => {
    const opened = await open(options, { comments: [LEGACY], settings });
    const beside = rowOf(opened.page, INTRO).locator(".comment-margin").locator(".markdown-comment-card, .markdown-comment-count");
    if (settings.comments === false) assert.equal(await opened.page.locator(".chat-view .comment-margin").count(), 0, `${device}: comments off, no margin`);
    else await eventually(`${device}: the reply's card or count`, async () => (await beside.count()) === 1);
    await frames(opened.page, 2);
    return { opened, place: await replyPlace(opened.page) };
  };
  const near = (a: { left: number; width: number }, b: { left: number; width: number }): boolean => Math.abs(a.left - b.left) <= 0.5 && Math.abs(a.width - b.width) <= 0.5;
  const off = await placed({ comments: false });
  await off.opened.close();
  const counts = await placed({ commentLayout: "counts" });
  await counts.opened.close();
  const cards = await placed({});
  for (const [what, other] of [["counts", counts.place], ["cards wanted", cards.place]] as const) {
    assert.ok(near(off.place.text, other.text) && near(off.place.transcript, other.transcript), `${device}: comments off and ${what}, the text has one place and width (${JSON.stringify({ off: off.place, [what]: other })})`);
  }
  return cards.opened;
}

const cases: Record<string, Case> = {
  /** The mode: off, a drag only selects (and copies); the chat's toggle turns it on or off for the file viewer too. */
  async "chat-mode"(open) {
    const { page, errors, close } = await open(DESKTOP);
    const toggle = toggleOf(page);
    await toggle.waitFor();
    assert.equal(await toggle.getAttribute("aria-pressed"), "false", "the mode starts off");
    assert.equal(await toggle.getAttribute("aria-label"), "Comment mode");
    const [toggleBox, frameBox] = [await toggle.boundingBox(), await page.locator(".chat-frame-body").boundingBox()];
    assert.ok(toggleBox !== null && frameBox !== null && frameBox.x + frameBox.width - (toggleBox.x + toggleBox.width) <= 24 && toggleBox.y - frameBox.y <= 16, `the toggle sits at the chat's top right (${JSON.stringify({ toggleBox, frameBox })})`);
    // the transcript starts below the floating toggle
    const firstTop = async (): Promise<number> => page.locator(".chat-view").evaluate((node) => {
      node.scrollTop = 0;
      return Math.min(...[...node.querySelectorAll("[data-chat-row], .chat-older, .chat-endcap")].map((row) => row.getBoundingClientRect().top));
    });
    let first = await firstTop();
    await eventually("the top of the transcript drawn", async () => { const now = await firstTop(); const still = now === first; first = now; return still; });
    assert.ok(first >= toggleBox!.y + toggleBox!.height, `the transcript starts below the toggle (${JSON.stringify({ first, toggleBox })})`);

    // back at the end, where the final reply's row is drawn again (the list unmounts it at the top)
    const intro = partOf(page, INTRO);
    await eventually("the final reply drawn again", async () => {
      await page.locator(".chat-view").evaluate((node) => { node.scrollTop = node.scrollHeight; });
      return (await intro.count()) === 1;
    }, 5000);
    await dragAcross(page, intro, "paragraph", intro, "state");
    await frames(page, 10);
    assert.equal(await popoverOf(page).count(), 0, "the mode off, a drag opens nothing");
    assert.equal(await page.evaluate(() => window.getSelection()?.toString() ?? ""), "paragraph about the state", "it stays a selection, to copy");
    assert.equal(await page.locator(".comment-pin").count(), 0, "no pin anywhere");
    console.log("PASS chat-mode: the toggle sits at the chat's top right above the transcript; the mode off, a drag only selects");

    await toggle.click();
    await eventually("the mode on", async () => (await toggle.getAttribute("aria-pressed")) === "true");
    await page.getByRole("button", { name: "spec.md", exact: true }).click();
    const viewer = page.getByRole("dialog", { name: "spec.md", exact: true });
    await viewer.locator(".file-viewer-markdown").waitFor();
    const viewerToggle = viewer.locator("button.file-viewer-comments");
    assert.equal(await viewerToggle.getAttribute("aria-pressed"), "true", "on in the chat is on in the file viewer");
    await viewerToggle.click();
    await eventually("the viewer's toggle off", async () => (await viewerToggle.getAttribute("aria-pressed")) === "false");
    await viewer.getByRole("button", { name: "Close file", exact: true }).click();
    await viewer.waitFor({ state: "detached" });
    assert.equal(await toggle.getAttribute("aria-pressed"), "false", "off in the viewer is off in the chat");
    console.log("PASS chat-mode: the chat's toggle turns the mode on in the file viewer too, and the viewer's turns it off in the chat");
    assert.deepEqual(errors, []);
    await close();
  },

  /** Selecting in a reply: the field, typing at once, Enter; the bubble and a second answer part left out; Escape saves. */
  async "chat-select"(open) {
    const { page, errors, close } = await open(DESKTOP);
    const toggle = await modeOn(page);
    const intro = partOf(page, INTRO);
    await dragAcross(page, intro, "paragraph", intro, "state");
    const field = selectionFieldOf(page);
    await field.waitFor();
    assert.equal(await strongText(page), "paragraph about the state", "the selection in the strong fill");
    await page.keyboard.type("Which state?");
    assert.equal(await fieldOf(page).inputValue(), "Which state?", "typing goes straight into the field");
    await page.keyboard.press("Enter");
    await field.waitFor({ state: "detached" });
    await eventually("the comment stored", async () => (await storedOf(page)).length === 1);
    const [stored] = await storedOf(page);
    assert.equal(stored!.quote, "paragraph about the state", "stored with the selected text");
    assert.equal(stored!.comment, "Which state?");
    await eventually("its text marked", async () => (await markedText(page)).includes("paragraph about the state"));
    await eventually("the toggle's count", async () => (await toggle.getAttribute("aria-label")) === "Comment mode, 1 comment");
    console.log("PASS chat-select: a drag in a reply opens the field over it, typing goes into it, Enter stores the selected text with the comment, marked");

    // from the user's bubble into the reply: only the reply's part
    await dragAcross(page, bubbleOf(page, "Show me the plan."), "Show", intro, "Intro");
    await field.waitFor();
    assert.equal(await strongText(page), "Intro", "only the reply's text from the bubble's drag");
    await page.keyboard.type("Bubble start.");
    await page.keyboard.press("Escape");
    await field.waitFor({ state: "detached" });
    await eventually("Escape to save it", async () => (await storedOf(page)).some((entry) => entry.comment === "Bubble start." && entry.quote === "Intro"));
    console.log("PASS chat-select: a drag from the user's bubble holds only the reply's text; Escape with text saves it");

    // from one answer part into the next: only the first
    const one = partOf(page, SPLIT_ONE);
    await dragAcross(page, one, "names", partOf(page, SPLIT_TWO), "Second");
    await field.waitFor();
    assert.equal(await strongText(page), "names the plan.", "only the first answer part");
    await page.keyboard.type("Split.");
    await page.keyboard.press("Enter");
    await field.waitFor({ state: "detached" });
    await eventually("the split comment stored", async () => (await storedOf(page)).some((entry) => entry.comment === "Split." && entry.quote === "names the plan."));
    console.log("PASS chat-select: a drag from one answer part into the next comments on the first part only");

    // an empty field leaves nothing; selecting a comment's place opens it
    await dragAcross(page, partOf(page, LONG_PARAGRAPH), "several", partOf(page, LONG_PARAGRAPH), "lines");
    await field.waitFor();
    const focused = await page.evaluate(() => `${document.activeElement?.tagName}.${document.activeElement?.className}`);
    await page.keyboard.press("Escape");
    await field.waitFor({ state: "detached" }).catch((error: Error) => { throw new Error(`${error.message} (the focus on ${focused})`); });
    await dragAcross(page, intro, "paragraph", intro, "state");
    await field.waitFor();
    assert.equal(await fieldOf(page).inputValue(), "Which state?", "the place of a comment opens it");
    await page.keyboard.press("Escape");
    await field.waitFor({ state: "detached" });
    assert.equal((await storedOf(page)).length, 3, "nothing new stored");
    console.log("PASS chat-select: an empty field leaves nothing; selecting a comment's place opens that comment");

    // no pins, and no frame around a block under the pointer
    assert.equal(await page.locator(".comment-pin, .comment-pins").count(), 0, "no pin anywhere");
    const paragraph = partOf(page, LONG_PARAGRAPH);
    await paragraph.hover();
    assert.equal(await paragraph.evaluate((node) => getComputedStyle(node).outlineStyle), "none", "no hover frame");
    console.log("PASS chat-select: no pin and no block hover frame");
    assert.deepEqual(errors, []);
    await close();
  },

  /**
   * The Comment button, the default (Settings → Comments → When you select text): with the mode off a drag shows none;
   * on, a drag in a reply shows it under the selection instead of the field, the selection a normal one (copied as
   * such); typing opens nothing; Escape hides it, the selection kept; the same words selected anew show it again; Tab reaches it, Enter
   * opens the field over the selection, typing and Enter save; its click does the same; on a comment's place it opens
   * that comment; a drag from the user's bubble into the reply is cut to the reply's text, button and all.
   */
  async "chat-button"(open) {
    const { page, errors, close } = await open(DESKTOP, { settings: { commentOnSelect: "button" } });
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    const intro = partOf(page, INTRO);
    const button = page.locator(".chat-view").getByRole("button", { name: "Comment on the selection", exact: true });
    const field = selectionFieldOf(page);
    const status = page.locator("p.markdown-comments-status[role='status']");
    const selected = (): Promise<string> => page.evaluate(() => window.getSelection()?.toString() ?? "");
    await dragAcross(page, intro, "paragraph", intro, "state");
    await frames(page, 10);
    assert.equal(await button.count(), 0, "the mode off, a drag shows no button");
    await page.evaluate(() => window.getSelection()?.removeAllRanges());

    await modeOn(page);
    await dragAcross(page, intro, "paragraph", intro, "state");
    await button.waitFor();
    await frames(page, 10);
    assert.equal(await popoverOf(page).count(), 0, "no field opens with the button");
    assert.equal(await selected(), "paragraph about the state", "the selection stays the browser's");
    assert.equal(await strongText(page), "", "and is not drawn as a comment's");
    await eventually("the live region to say the button shows", async () => (await status.textContent()) === "Comment button shown");
    assert.equal(await page.evaluate(() => document.activeElement?.matches(".markdown-select-comment") ?? false), false, "the focus stays where it was");
    const placed = await page.evaluate(() => {
      const rects = [...window.getSelection()!.getRangeAt(0).getClientRects()].filter((rect) => rect.width > 0);
      const last = rects.at(-1)!;
      const box = document.querySelector(".markdown-select-comment")!.getBoundingClientRect();
      return { gap: box.top - last.bottom, end: last.right, left: box.left, right: box.right };
    });
    assert.ok(Math.abs(placed.gap - 8) <= 1 && placed.left <= placed.end && placed.right >= placed.end, `the button sits 8 px under the selection's last line, at its end (${JSON.stringify(placed)})`);
    await page.keyboard.type("x");
    await frames(page, 6);
    assert.equal(await popoverOf(page).count(), 0, "typing opens no field");
    assert.ok(await button.isVisible(), "and leaves the button");
    await page.evaluate(() => navigator.clipboard.writeText(""));
    await page.keyboard.press("ControlOrMeta+c");
    await eventually("the selection copied", async () => (await page.evaluate(() => navigator.clipboard.readText())) === "paragraph about the state");
    assert.ok(await button.isVisible(), "the button stays as the selection is copied");
    console.log("PASS chat-button: in the mode a drag in a reply shows the Comment button under the selection's end, no field; the selection copies; typing opens nothing");

    await page.keyboard.press("Escape");
    await button.waitFor({ state: "detached" });
    assert.equal(await popoverOf(page).count(), 0, "Escape opens nothing");
    assert.equal(await selected(), "paragraph about the state", "and leaves the selection");
    // a press elsewhere drops the selection (a press inside it would drag its text); the same words selected again
    const away = await wordPoint(partOf(page, LONG_PARAGRAPH), "several");
    await page.mouse.click(away.x, away.y);
    await frames(page, 6);
    assert.equal(await button.count(), 0, "a press elsewhere shows no button");
    await dragAcross(page, intro, "paragraph", intro, "state");
    await button.waitFor();
    console.log("PASS chat-button: Escape hides the button and keeps the selection; the same words selected anew show it again");

    await page.keyboard.press("Tab");
    await eventually("Tab to reach the button", () => focusedMatches(page, ".markdown-select-comment"));
    await page.keyboard.press("Enter");
    await field.waitFor();
    await fieldFocused(page);
    assert.equal(await button.count(), 0, "the button goes as the field opens");
    assert.equal(await strongText(page), "paragraph about the state", "the selection in the strong fill");
    await page.keyboard.type("Button note.");
    await page.keyboard.press("Enter");
    await field.waitFor({ state: "detached" });
    await eventually("the comment stored", async () => (await storedOf(page)).some((entry) => entry.comment === "Button note." && entry.quote === "paragraph about the state"));
    console.log("PASS chat-button: Tab reaches the button, Enter opens the field over the selection, focused; typing and Enter store it");

    const long = partOf(page, LONG_PARAGRAPH);
    await dragAcross(page, long, "several", long, "lines");
    await button.click();
    await field.waitFor();
    await fieldFocused(page);
    await page.keyboard.type("Clicked.");
    await page.keyboard.press("Enter");
    await field.waitFor({ state: "detached" });
    await eventually("the clicked comment stored", async () => (await storedOf(page)).some((entry) => entry.comment === "Clicked." && entry.quote === "several lines"));
    await dragAcross(page, intro, "paragraph", intro, "state");
    await button.click();
    await field.waitFor();
    assert.equal(await fieldOf(page).inputValue(), "Button note.", "on a comment's place the button opens that comment");
    await page.keyboard.press("Escape");
    await field.waitFor({ state: "detached" });
    console.log("PASS chat-button: a click on the button opens the field too; on a comment's place it opens that comment");

    await dragAcross(page, bubbleOf(page, "Show me the plan."), "Show", intro, "Intro");
    await button.waitFor();
    assert.equal(await selected(), "Intro", "the selection from the bubble is cut to the reply's text");
    await button.click();
    await field.waitFor();
    assert.equal(await strongText(page), "Intro", "the field is on the reply's text only");
    await page.keyboard.press("Escape");
    await field.waitFor({ state: "detached" });
    assert.equal((await storedOf(page)).length, 2, "an empty field leaves nothing");
    console.log("PASS chat-button: a drag from the user's bubble into the reply shows the button for the reply's text only");
    assert.deepEqual(errors, []);
    await close();
  },

  /** Cards beside a reply in a wide pane: placed by their text, inside the row, the row grown where they run past its text. */
  async "chat-cards"(open) {
    // the margin never moves the text: comments off, counts or cards, the reply's text has one place and width; the card
    // lies right of the transcript, outside its row, which clips nothing of it, inside the scroller
    const unmoved = await textUnmoved(open, WIDE, "1920 × 900");
    const legacyCard = cardWith(unmoved.page, "Old block note.");
    await eventually("the seeded comment's card", async () => (await legacyCard.count()) === 1);
    const [legacyBox, place, legacyRow] = [(await legacyCard.boundingBox())!, await replyPlace(unmoved.page), (await rowOf(unmoved.page, INTRO).boundingBox())!];
    const seenCard = { legacyBox, place, legacyRow };
    assert.ok(Math.abs(legacyBox.x - (place.right + 24)) <= 1 && Math.abs(legacyBox.width - 280) <= 1, `the card 24 px right of the text, 280 px wide (${JSON.stringify(seenCard)})`);
    assert.ok(legacyBox.x >= legacyRow.x + legacyRow.width, `the card outside its row's box (${JSON.stringify(seenCard)})`);
    assert.ok(legacyBox.x + legacyBox.width <= place.viewRight + 0.5, `the card inside the scroller (${JSON.stringify(seenCard)})`);
    assert.ok(await hitAtCentre(legacyCard), "nothing clips or covers the card");
    // how: the list's container of that row alone drops paint containment (ChatComments.tsx `unclipRow`), which would clip
    // the card at the row's box; the other rows' keep it
    const containment = await legacyCard.evaluate((card) => {
      const container = card.closest("[data-chat-row]")!.parentElement!;
      const others = [...document.querySelectorAll(".chat-view [data-chat-row]")].map((row) => row.parentElement!).filter((other) => other !== container && !other.querySelector(".comment-margin"));
      const box = card.getBoundingClientRect();
      const at = (): boolean => card.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
      const own = container.style.contain;
      container.style.contain = "paint layout style";
      const clipped = !at();
      container.style.contain = own;
      const has = (value: string, part: string): boolean => value.split(/\s+/).includes(part);
      return { own: has(own, "paint") ? "paint" : has(own, "layout") ? "layout" : own, clipped, back: at(), others: others.length > 0 && others.every((other) => has(other.style.contain, "paint")) };
    });
    assert.deepEqual(containment, { own: "layout", clipped: true, back: true, others: true }, "only the row with a margin drops paint containment (keeping layout's), which would clip its card");
    const sideways = await unmoved.page.locator(".chat-view").evaluate((node) => [node.scrollWidth, node.clientWidth]);
    assert.equal(sideways[0], sideways[1], "the card widens no scrolling");
    assert.deepEqual(unmoved.errors, []);
    await unmoved.close();
    console.log("PASS chat-cards: with comments off, counts or cards the reply's text keeps one place and width; the card sits 24 px right of it, outside its row, nothing clipping or covering it");

    const { page, errors, close } = await open(WIDE);
    await modeOn(page);
    const composer = page.locator(".composer-surface");
    const composerBefore = await composer.boundingBox();
    const intro = partOf(page, INTRO);
    await commentOn(page, intro, "Intro", "paragraph", "Card one.");
    const card = cardWith(page, "Card one.");
    await card.waitFor();
    const [box, line] = [await card.boundingBox(), await lineBox(intro, "Intro")];
    assert.ok(box !== null && box.x >= line.right + 24 - 1, `the card right of the reply (${JSON.stringify({ box, line })})`);
    assert.ok(Math.abs(box!.y - line.top) <= 14, `the card level with its text's first line (${JSON.stringify({ box, line })})`);
    const composerAfter = await composer.boundingBox();
    assert.equal(composerAfter?.x, composerBefore?.x, "the composer's left edge is unchanged");
    assert.equal(await page.locator(".chat-minimap").count(), 1, "the minimap still shows");
    const overflow = await page.locator(".chat-view").evaluate((node) => [node.scrollWidth, node.clientWidth]);
    assert.equal(overflow[0], overflow[1], "nothing pans the chat sideways");
    console.log("PASS chat-cards: the card sits right of its reply, level with its text; the composer stays, the minimap shows");

    // several cards on one line of a short reply: pushed down 8 px apart, past its text: the row grows, the next turn moves
    const two = partOf(page, SPLIT_TWO);
    const splitRow = rowOf(page, SPLIT_ONE);
    const nextRow = rowOf(page, "Show me the plan.");
    await wordPoint(two, "Second");
    const gap = async (): Promise<number> => (await nextRow.boundingBox())!.y - (await splitRow.boundingBox())!.y;
    const before = await gap();
    for (const [from, to, text] of [["Second", "Second", "Push a."], ["part", "part", "Push b."], ["split", "split", "Push c."], ["answer", "answer", "Push d."]] as const) {
      await commentOn(page, two, from, to, text);
    }
    const pushed = cardsOf(page).filter({ hasText: "Push" });
    await eventually("four cards", async () => (await pushed.count()) === 4);
    const boxes = await pushed.evaluateAll((nodes) => nodes.map((node) => { const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; }).sort((a, b) => a.top - b.top));
    for (let i = 1; i < boxes.length; i++) assert.ok(boxes[i]!.top >= boxes[i - 1]!.bottom + 8 - 1, `cards 8 px apart (${JSON.stringify(boxes)})`);
    const rowBox = (await splitRow.boundingBox())!;
    assert.ok(rowBox.y + rowBox.height >= boxes.at(-1)!.bottom, `the row holds its cards (${JSON.stringify({ rowBox, last: boxes.at(-1) })})`);
    await eventually("the next turn moved down", async () => (await gap()) > before);
    console.log("PASS chat-cards: cards on one line are pushed down 8 px apart; past the reply's text the row grows and the next turn moves down");

    // a click edits in place, the bin deletes
    await card.click();
    await card.locator(".comment-popover.is-row").waitFor();
    await fieldFocused(page);
    await page.keyboard.type(" More.");
    await page.keyboard.press("Enter");
    await eventually("the edit stored", async () => (await storedTexts(page)).includes("Card one. More."));
    const edited = cardWith(page, "Card one. More.");
    await edited.hover();
    await edited.getByRole("button", { name: "Delete comment", exact: true }).click();
    await eventually("the card deleted", async () => !(await storedTexts(page)).includes("Card one. More."));
    console.log("PASS chat-cards: a card's click edits it in place; its bin deletes it");

    // a card's field open, the focus moved on without a press (the field stays open): its row scrolled out of the list's
    // window and back draws the field again, which takes no focus this time
    await cardWith(page, "Push a.").click();
    const pushField = splitRow.locator(".markdown-comment-card .comment-popover.is-row");
    await pushField.waitFor();
    await fieldFocused(page);
    const message = messageOf(page);
    await message.focus();
    const view = page.locator(".chat-view");
    await eventually("the split reply's row to unmount", async () => {
      await view.evaluate((node) => { node.scrollTop = 0; });
      return (await splitRow.count()) === 0;
    }, 5000);
    await eventually("the split reply's row back with its field", async () => {
      await view.evaluate((node) => { node.scrollTop = node.scrollHeight; });
      return (await pushField.count()) === 1;
    }, 5000);
    await frames(page, 6);
    assert.ok(await message.evaluate((node) => node === document.activeElement), `the field drawn again leaves the focus in the message box (on ${await page.evaluate(() => document.activeElement?.className ?? "")})`);
    await pushField.locator("textarea").click();
    await page.keyboard.press("Escape");
    await pushField.waitFor({ state: "detached" });
    console.log("PASS chat-cards: a card's field whose row was scrolled out of the window and back takes no focus again");

    // the mode off, a copy across two replies with cards beside them: the comments are no text of the replies
    await toggleOf(page).click();
    await eventually("the mode off", async () => (await toggleOf(page).getAttribute("aria-pressed")) === "false");
    await dragAcross(page, two, "steps", intro, "Intro");
    await frames(page, 4);
    const copied = await page.locator(".chat-view").evaluate((view) => {
      const data = new DataTransfer();
      view.dispatchEvent(new ClipboardEvent("copy", { clipboardData: data, bubbles: true, cancelable: true }));
      return { text: data.getData("text/plain"), html: data.getData("text/html") };
    });
    assert.ok(copied.text.includes("steps in order.") && copied.text.includes("Intro"), `the copy holds both replies' text (${JSON.stringify(copied.text)})`);
    assert.ok(!/Push [abcd]\./.test(copied.text) && !/Push [abcd]\./.test(copied.html), `no comment in the copy (${JSON.stringify(copied)})`);
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    console.log("PASS chat-cards: the mode off, a copy across two replies with cards beside them carries no comment text");

    // the minimap shows at every pane width where it showed before the margin (its old rule), never over the text or a card;
    // and stays hidden where it was hidden: 860 px is below the text's width and its two gutters (`chatW + 64`)
    let hiddenSteps = 0;
    for (const target of [860, 900, 1000, 1200]) {
      for (let step = 0; step < 2; step++) {
        const width = await page.locator(".chat-view").evaluate((node) => node.clientWidth);
        const size = page.viewportSize()!;
        await page.setViewportSize({ width: size.width + (target - width), height: size.height });
      }
      const measure = (): Promise<{ width: number; chatW: number; before: boolean; minimap: { left: number; right: number; top: number; bottom: number } | null; textLeft: number; cards: { left: number; right: number; top: number; bottom: number }[] }> => page.evaluate(() => {
        const view = document.querySelector<HTMLElement>(".chat-view")!;
        const probe = document.createElement("div");
        probe.style.cssText = "position: absolute; visibility: hidden; height: 0; width: var(--chat-w)";
        view.append(probe);
        const chatW = probe.getBoundingClientRect().width;
        probe.remove();
        const width = view.clientWidth;
        // the rule before the margin: the transcript `min(100% - 32px, --chat-w)` wide, 32 px free either side, and no phone
        const before = (width - Math.min(width - 32, chatW)) / 2 >= 32 && !matchMedia("(max-width: 768px)").matches;
        const box = (node: Element): { left: number; right: number; top: number; bottom: number } => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
        const map = document.querySelector(".chat-minimap");
        const minimap = map === null || map.getBoundingClientRect().width === 0 ? null : box(map);
        const textLeft = Math.min(...[...view.querySelectorAll("[data-chat-row] .chat-turn")].map((turn) => turn.getBoundingClientRect().left));
        const cards = [...view.querySelectorAll(".comment-margin .markdown-comment-card")].filter((card) => card.getBoundingClientRect().height > 0).map(box);
        return { width, chatW, before, minimap, textLeft, cards };
      });
      let seen = await measure();
      await eventually(`the minimap at a ${target} px pane as before the margin`, async () => {
        seen = await measure();
        return (seen.minimap !== null) === seen.before;
      }).catch((error: Error) => { throw new Error(`${error.message} (${JSON.stringify(seen)})`); });
      if (seen.minimap !== null) {
        const map = seen.minimap;
        assert.ok(map.right <= seen.textLeft, `the minimap left of the text (${JSON.stringify(seen)})`);
        assert.ok(seen.cards.every((card) => card.right <= map.left || card.left >= map.right || card.bottom <= map.top || card.top >= map.bottom), `no card under the minimap (${JSON.stringify(seen)})`);
      }
      if (seen.minimap === null) hiddenSteps++;
      console.log(`PASS chat-cards: at a ${seen.width} px pane (text ${Math.round(seen.chatW)} px) the minimap is ${seen.minimap === null ? "hidden" : "shown"}, as before the margin, clear of the text and the cards`);
    }
    assert.ok(hiddenSteps > 0, "one of the pane widths is too narrow for the minimap, which then stays hidden");
    assert.deepEqual(errors, []);
    await close();
  },

  /** Counts beside a reply in a narrow pane. */
  async "chat-counts"(open) {
    // the margin never moves the text; where the free space is only the transcript's inset (a narrow pane, a phone), the
    // count sits at the scroller's edge, its bubble clear of the text's glyphs, its target over the free space only
    for (const [options, device, touch] of [[NARROW, "760 × 800", false], [IPHONE_14_PRO, "393 × 852, touch", true]] as const) {
      const unmoved = await textUnmoved(open, options, device);
      const count = rowOf(unmoved.page, INTRO).locator(".comment-margin .markdown-comment-count");
      const bubble = count.locator(".markdown-comment-count-bubble");
      await eventually(`${device}: the seeded comment's count`, async () => (await count.count()) === 1);
      assert.equal(await cardsOf(unmoved.page).count(), 0, `${device}: no cards`);
      const [target, mark, place] = [(await count.boundingBox())!, (await bubble.boundingBox())!, await replyPlace(unmoved.page)];
      const seenCount = { target, mark, place };
      assert.ok(mark.x >= place.glyphs - 0.5 && mark.x >= place.right - 0.5, `${device}: the bubble clear of the text's glyphs (${JSON.stringify(seenCount)})`);
      assert.ok(target.x >= place.right - 0.5 && target.x + target.width <= place.viewRight + 0.5, `${device}: the target over the free space only (${JSON.stringify(seenCount)})`);
      assert.ok(mark.x + mark.width <= place.viewRight + 0.5, `${device}: the bubble inside the scroller (${JSON.stringify(seenCount)})`);
      if (touch) assert.ok(target.height >= 44, `${device}: a finger's target 44 px high (${JSON.stringify(seenCount)})`);
      assert.ok(await hitAtCentre(bubble), `${device}: nothing clips or covers the count`);
      const sideways = await unmoved.page.locator(".chat-view").evaluate((node) => [node.scrollWidth, node.clientWidth]);
      assert.equal(sideways[0], sideways[1], `${device}: the count widens no scrolling`);
      assert.deepEqual(unmoved.errors, []);
      await unmoved.close();
      console.log(`PASS chat-counts (${device}): with comments off, counts or cards wanted the reply's text keeps one place and width; the count sits at the scroller's edge, its bubble clear of the glyphs, nothing over it`);
    }

    const { page, errors, close } = await open(NARROW);
    await modeOn(page);
    const intro = partOf(page, INTRO);
    await commentOn(page, intro, "Intro", "Intro", "Count a.");
    await commentOn(page, intro, "about", "state", "Count b.");
    await eventually("one count for the line", async () => (await countsOf(page).count()) === 1);
    assert.equal(await cardsOf(page).count(), 0, "no cards");
    assert.equal((await countsOf(page).first().textContent())?.trim(), "2", "the two comments share a count");
    const [count, line] = [await countsOf(page).first().boundingBox(), await lineBox(intro, "Intro")];
    assert.ok(count !== null && count.x >= line.right - 1, `the count right of the text (${JSON.stringify({ count, line })})`);
    const overflow = await page.locator(".chat-view").evaluate((node) => [node.scrollWidth, node.clientWidth]);
    assert.equal(overflow[0], overflow[1], "nothing pans the chat sideways");
    await countsOf(page).first().click();
    await eventually("its two fields", async () => (await selectionFieldOf(page).count()) === 2);
    await page.keyboard.press("Escape");
    await eventually("the fields closed", async () => (await selectionFieldOf(page).count()) === 0);
    console.log("PASS chat-counts: a narrow pane shows a count beside the line, two comments in one; a click opens their fields, Escape closes them");

    // the mode off, a count on a reply's last line: its read-only cards stay inside the row, which grows for them
    const two = partOf(page, SPLIT_TWO);
    await commentOn(page, two, "steps", "order", "Count c, a longer comment so that its card runs past the end of the reply.");
    const toggle = toggleOf(page);
    await toggle.click();
    await eventually("the mode off", async () => (await toggle.getAttribute("aria-pressed")) === "false");
    const splitRow = rowOf(page, SPLIT_ONE);
    const nextRow = rowOf(page, "Show me the plan.");
    await wordPoint(two, "steps");
    const gap = async (): Promise<number> => (await nextRow.boundingBox())!.y - (await splitRow.boundingBox())!.y;
    const closed = await gap();
    const splitCount = splitRow.locator(".markdown-comment-count").last();
    await splitCount.click();
    const readonly = splitRow.locator(".markdown-comment-readonly");
    await readonly.waitFor();
    await eventually("the read-only cards inside their row", async () => {
      const [cards, row] = [await readonly.boundingBox(), await splitRow.boundingBox()];
      return cards !== null && row !== null && cards.y + cards.height <= row.y + row.height + 0.5;
    });
    await eventually("the next turn moved down", async () => (await gap()) > closed);
    await splitCount.click();
    await readonly.waitFor({ state: "detached" });
    await eventually("the row back to its height", async () => Math.abs((await gap()) - closed) <= 1);
    console.log("PASS chat-counts: with the mode off a count's read-only cards on a reply's last line stay inside its row, which grows for them and shrinks back as they close");
    assert.deepEqual(errors, []);
    await close();
  },

  /** The virtualized transcript: a row leaving and coming back keeps its cards' places; a field outlives its row. */
  async "chat-virtual"(open) {
    const { page, errors, close } = await open(WIDE);
    await modeOn(page);
    const intro = partOf(page, INTRO);
    await commentOn(page, intro, "Intro", "paragraph", "Virtual one.");
    const card = cardWith(page, "Virtual one.");
    await card.waitFor();
    const offset = async (): Promise<{ dx: number; dy: number }> => {
      const [box, line] = [(await card.boundingBox())!, await lineBox(intro, "Intro")];
      return { dx: Math.round(box.x - line.right), dy: Math.round(box.y - line.top) };
    };
    const before = await offset();
    const view = page.locator(".chat-view");
    await view.evaluate((node) => { node.scrollTop = 0; });
    await eventually("the reply's row to unmount", async () => {
      await view.evaluate((node) => { node.scrollTop = 0; });
      return (await intro.count()) === 0;
    }, 5000).catch(async (error: Error) => {
      const seen = await view.evaluate((node) => ({ pinned: node.getAttribute("data-chat-pinned"), top: node.scrollTop, height: node.scrollHeight, client: node.clientHeight, rows: node.querySelectorAll("[data-chat-row]").length, selection: window.getSelection()?.toString(), active: document.activeElement?.className }));
      throw new Error(`${error.message} (${JSON.stringify(seen)})`);
    });
    await view.evaluate((node) => { node.scrollTop = node.scrollHeight; });
    await eventually("the reply's row back", async () => {
      await view.evaluate((node) => { node.scrollTop = node.scrollHeight; });
      return (await intro.count()) === 1 && (await card.count()) === 1;
    }, 5000);
    await wordPoint(intro, "Intro");
    await eventually("its card at the same place", async () => JSON.stringify(await offset()) === JSON.stringify(before));
    console.log("PASS chat-virtual: a reply scrolled out of the list's window and back has its card at the same place");

    // a field with text typed, its row scrolled out of the window: Escape still saves it
    await dragAcross(page, partOf(page, "Step 1 of the rollout"), "rollout", partOf(page, "Step 1 of the rollout"), "service");
    await selectionFieldOf(page).waitFor();
    await page.keyboard.type("Scrolled away.");
    await view.evaluate((node) => { node.scrollTop = 0; });
    await eventually("the row scrolled out", async () => {
      await view.evaluate((node) => { node.scrollTop = 0; });
      return (await partOf(page, "Step 1 of the rollout").count()) === 0;
    }, 5000);
    await page.keyboard.press("Escape");
    await eventually("Escape to save it", async () => (await storedTexts(page)).includes("Scrolled away."));
    const away = (await storedOf(page)).find((entry) => entry.comment === "Scrolled away.")!;
    assert.equal(away.quote, "rollout keeps the service", "on the text selected");
    assert.ok(away.anchor.startsWith(`${FINAL_TS}:`), `on the scrolled-away turn (${away.anchor})`);
    console.log("PASS chat-virtual: a field with text typed, its row scrolled out of the window, is saved by Escape");
    assert.deepEqual(errors, []);
    await close();
  },

  /** The composer's walk: shown reply comments in reading order, then the unloaded one's dialog, then file comments. */
  async walk(open) {
    const { page, context, url, errors, close } = await open({ viewport: { width: 1280, height: 720 } }, { comments: [UNLOADED, SPEC_COMMENT] });
    const toggle = await modeOn(page);
    await commentOn(page, partOf(page, INTRO), "Intro", "Intro", "Walk two.");
    await commentOn(page, partOf(page, SPLIT_ONE), "First", "First", "Walk one.");
    await page.locator(".chat-view").evaluate((node) => { node.scrollTop = node.scrollHeight; });
    await scrollSettled(page);
    const walk = walkOf(page);
    await walk.click();
    // 1: the split reply's comment (earlier in reading order), its field open, in view
    await eventually("the first stop's field", async () => (await fieldOf(page).count()) === 1 && (await fieldOf(page).inputValue()) === "Walk one.");
    await fieldFocused(page);
    await scrollSettled(page);
    assert.ok(await inView(page, ".chat-view .comment-popover"), "its field in view");
    assert.ok((await strongText(page)).includes("First"), "its text in the strong fill");
    await page.keyboard.press("Escape");
    await eventually("the walk control to take the focus", () => walk.evaluate((node) => node === document.activeElement));
    await eventually("the field closed", async () => (await popoverOf(page).count()) === 0);
    // 2: the final reply's
    await page.keyboard.press("Enter");
    await eventually("the second stop's field", async () => (await fieldOf(page).count()) === 1 && (await fieldOf(page).inputValue()) === "Walk two.");
    await page.keyboard.press("Escape");
    await eventually("the walk control to take the focus", () => walk.evaluate((node) => node === document.activeElement));
    console.log("PASS walk: the mode on, the walk opens the shown reply comments' fields in reading order, in view; Escape hands the focus back to the walk");

    // 3: the comment whose turn is not loaded: the dialog
    await page.keyboard.press("Enter");
    await dialogOf(page).waitFor();
    await fieldFocused(page);
    assert.equal(await fieldOf(page).inputValue(), "Is this still true?", "the dialog opens the comment in its field");
    assert.equal(await dialogOf(page).locator(".comment-popover-quote").innerText(), "A reply from a turn the chat has not loaded.", "it quotes its block");
    await fieldOf(page).fill("Is this still true? Check.");
    await closeOf(page).click();
    await dialogOf(page).waitFor({ state: "detached" });
    await eventually("✕ to save the change", async () => (await storedTexts(page)).includes("Is this still true? Check."));
    console.log("PASS walk: then a comment whose turn is not loaded opens in a dialog; ✕ saves a change typed in it");

    // 4: the file comment: the viewer opens at it
    await walk.click();
    const viewer = page.getByRole("dialog", { name: "spec.md", exact: true });
    await viewer.locator(".file-viewer-markdown").waitFor();
    await eventually("the spec's comment open", async () => (await viewer.locator(".comment-popover textarea").count()) === 1 && (await viewer.locator(".comment-popover textarea").inputValue()) === "Spec note.");
    await viewer.getByRole("button", { name: "Close file", exact: true }).click();
    await viewer.waitFor({ state: "detached" });
    console.log("PASS walk: then the file comment, in the file viewer");

    // the mode off: the walk marks a shown comment, opening no field
    await toggle.click();
    await eventually("the mode off", async () => (await toggle.getAttribute("aria-pressed")) === "false");
    await walk.click();
    await eventually("the first stop marked", async () => (await strongText(page)).includes("First"));
    await frames(page);
    assert.equal(await page.locator(".chat-view .comment-popover").count(), 0, "the mode off, no field opens");
    await page.locator(".chat-view").click({ position: { x: 4, y: 200 } });
    await eventually("the mark to go with a click", async () => !(await strongText(page)).includes("First"));
    console.log("PASS walk: with the mode off the walk marks a shown comment, read-only, until a click");

    // the dialog open again, and its comment deleted in another tab: it closes
    await walk.click();
    await walk.click();
    await dialogOf(page).waitFor();
    const other = await context.newPage();
    await other.goto(url);
    await other.evaluate(() => {
      const key = Object.keys(localStorage).find((name) => name.startsWith("ovis:block-comments:"))!;
      const data = JSON.parse(localStorage.getItem(key)!) as { comments: { comment: string }[] };
      localStorage.setItem(key, JSON.stringify({ ...data, comments: data.comments.filter((comment) => !comment.comment.startsWith("Is this still true?")) }));
    });
    await dialogOf(page).waitFor({ state: "detached" });
    await other.close();
    console.log("PASS walk: the dialog of a comment deleted in another tab closes");
    assert.deepEqual(errors, []);
    await close();
  },

  /**
   * The walk with the mode off and counts (a narrow pane), by the keyboard: a stop on a reply's count shows its read-only
   * cards; the next stop, on another reply's count, shows that one's, and the first reply's close.
   */
  async "walk-counts"(open) {
    const { page, errors, close } = await open(NARROW);
    const toggle = await modeOn(page);
    await commentOn(page, partOf(page, INTRO), "Intro", "Intro", "Count walk two.");
    await commentOn(page, partOf(page, SPLIT_ONE), "First", "First", "Count walk one.");
    await toggle.click();
    await eventually("the mode off", async () => (await toggle.getAttribute("aria-pressed")) === "false");
    await page.locator(".chat-view").evaluate((node) => { node.scrollTop = node.scrollHeight; });
    await scrollSettled(page);
    const splitCount = rowOf(page, SPLIT_ONE).locator(".markdown-comment-count");
    const finalCount = rowOf(page, INTRO).locator(".markdown-comment-count");
    await eventually("a count beside each reply", async () => (await splitCount.count()) === 1 && (await finalCount.count()) === 1);
    const expanded = async (count: Locator): Promise<string | null> => (await count.count()) === 0 ? null : count.getAttribute("aria-expanded");
    const walk = walkOf(page);
    await walk.focus();
    await page.keyboard.press("Enter");
    await eventually("the first stop to show the split reply's cards", async () => (await expanded(splitCount)) === "true");
    assert.equal(await rowOf(page, SPLIT_ONE).locator(".markdown-comment-readonly").count(), 1, "its read-only cards");
    assert.ok(await walk.evaluate((node) => node === document.activeElement), "the walk control keeps the focus");
    await page.keyboard.press("Enter");
    await eventually("the second stop to show the final reply's cards", async () => (await expanded(finalCount)) === "true");
    await eventually("the split reply's cards to close", async () => (await expanded(splitCount)) !== "true" && (await rowOf(page, SPLIT_ONE).locator(".markdown-comment-readonly").count()) === 0)
      .catch(async (error: Error) => { throw new Error(`${error.message} (split count aria-expanded ${await expanded(splitCount)})`); });
    console.log("PASS walk-counts: by the keyboard, with the mode off, a stop on another reply's count closes the read-only cards the stop before opened");

    // the same with the walk's clearing and its next stop in one render: a click dispatched from a script runs the
    // composer's capture listener (the mark cleared) and the control's own handler (the next stop) in one task, with no
    // microtask between them, so the margins are never rendered with the walk standing nowhere
    await walk.evaluate((node) => (node as HTMLElement).click());
    await eventually("the third stop to show the split reply's cards again", async () => (await expanded(splitCount)) === "true");
    await eventually("the final reply's cards to close", async () => (await expanded(finalCount)) !== "true" && (await rowOf(page, INTRO).locator(".markdown-comment-readonly").count()) === 0)
      .catch(async (error: Error) => { throw new Error(`${error.message} (final count aria-expanded ${await expanded(finalCount)})`); });
    console.log("PASS walk-counts: a stop whose clearing comes in the same render still closes the read-only cards of the reply before");
    assert.deepEqual(errors, []);
    await close();
  },

  /**
   * The walk's own rules in one reply's margin (counts, the mode off): a stop on a count takes the place of the count a
   * click showed there, and as the walk is left (Escape on its control) the stop's cards close and the clicked ones do
   * not come back.
   */
  async "walk-one-margin"(open) {
    const { page, errors, close } = await open(NARROW);
    const toggle = await modeOn(page);
    await commentOn(page, partOf(page, INTRO), "Intro", "Intro", "One margin x.");
    await commentOn(page, partOf(page, LONG_PARAGRAPH), "several", "several", "One margin y.");
    await toggle.click();
    await eventually("the mode off", async () => (await toggle.getAttribute("aria-pressed")) === "false");
    const row = rowOf(page, INTRO);
    const counts = row.locator(".markdown-comment-count");
    await eventually("two counts beside the reply", async () => (await counts.count()) === 2);
    const [first, second] = [counts.nth(0), counts.nth(1)];
    const readonlyText = async (): Promise<string> => (await row.locator(".markdown-comment-readonly").allTextContents()).join("|").trim();
    await wordPoint(partOf(page, LONG_PARAGRAPH), "several");
    await second.click();
    await eventually("the clicked count's cards", async () => (await second.getAttribute("aria-expanded")) === "true" && (await readonlyText()) === "One margin y.");
    const walk = walkOf(page);
    await walk.focus();
    await page.keyboard.press("Enter");
    await eventually("the stop's count to take the clicked one's place", async () => (await first.getAttribute("aria-expanded")) === "true" && (await second.getAttribute("aria-expanded")) === "false" && (await readonlyText()) === "One margin x.");
    await page.keyboard.press("Escape");
    await eventually("the stop's cards to close as the walk is left", async () => (await first.getAttribute("aria-expanded")) === "false");
    await frames(page, 6);
    assert.equal(await second.getAttribute("aria-expanded"), "false", "the clicked count does not come back");
    assert.equal(await row.locator(".markdown-comment-readonly").count(), 0, "no read-only cards");
    console.log("PASS walk-one-margin: a stop's count takes the place of a clicked one in the same margin; leaving the walk closes it and the clicked one stays closed");
    assert.deepEqual(errors, []);
    await close();
  },

  /** A selection across two blocks of one answer: its card beside its reply, and the walk opens it there, not in the dialog. */
  async "chat-span"(open) {
    const { page, errors, close } = await open(WIDE);
    await modeOn(page);
    const intro = partOf(page, INTRO);
    const long = partOf(page, LONG_PARAGRAPH);
    await dragAcross(page, intro, "state", long, "longer");
    await selectionFieldOf(page).waitFor();
    await page.keyboard.type("Spans blocks.");
    await page.keyboard.press("Enter");
    await selectionFieldOf(page).waitFor({ state: "detached" });
    await eventually("the comment stored", async () => (await storedOf(page)).length === 1);
    const [stored] = await storedOf(page);
    assert.ok(stored!.anchor.startsWith(`${FINAL_TS}:`) && /@\d+-[\d.]+:\d+$/.test(stored!.anchor), `an anchor running on into a later block (${stored!.anchor})`);
    const card = rowOf(page, INTRO).locator(".comment-margin .markdown-comment-card", { hasText: "Spans blocks." });
    await eventually("its card beside its reply", async () => (await card.count()) === 1);
    console.log("PASS chat-span: a comment on a selection across two blocks of a reply has its card beside that reply");
    await page.locator(".chat-view").evaluate((node) => { node.scrollTop = node.scrollHeight; });
    await scrollSettled(page);
    await walkOf(page).click();
    await eventually("the walk to open its card's field", async () => (await card.locator(".comment-popover.is-row").count()) === 1);
    assert.equal(await dialogOf(page).count(), 0, "not the dialog");
    console.log("PASS chat-span: the walk opens it in its card, not in the dialog");
    assert.deepEqual(errors, []);
    await close();
  },

  /** The send and an open comment field (Task 2's rules): the keyboard's Send waits for a changed field, a mouse's press on Send saves it. */
  async acknowledged(open) {
    const { page, errors, sent, close } = await open(WIDE);
    await modeOn(page);
    await commentOn(page, partOf(page, INTRO), "Intro", "Intro", "Ack me.");
    await cardWith(page, "Ack me.").click();
    await fieldFocused(page);
    // the message box focused without a press outside the field, so only the send's acknowledgement can close it
    const message = messageOf(page);
    await message.focus();
    await message.fill("Please look.");
    await page.keyboard.press("Enter");
    await eventually("the message to be sent", async () => sent.length === 1, 5000);
    assert.ok(sent[0]!.includes("Ack me.") && sent[0]!.includes("Please look."), "the comment goes with the message");
    await eventually("the field and the card to go", async () => (await popoverOf(page).count()) === 0 && (await cardsOf(page).count()) === 0);
    console.log("PASS acknowledged: a saved comment's field open, unchanged, when its comment is sent closes as the send is acknowledged");

    const long = partOf(page, LONG_PARAGRAPH);
    await dragAcross(page, long, "several", long, "lines");
    await selectionFieldOf(page).waitFor();
    await page.keyboard.type("Still typing");
    await message.focus();
    await message.fill("Second message.");
    await page.keyboard.press("Enter");
    await fieldFocused(page);
    await frames(page);
    assert.equal(sent.length, 1, "nothing goes while a comment is being written");
    assert.equal(await fieldOf(page).inputValue(), "Still typing", "the field stays with its text");
    await page.keyboard.press("Enter");
    await selectionFieldOf(page).waitFor({ state: "detached" });
    await eventually("its card", async () => (await cardsOf(page).count()) === 1);
    console.log("PASS acknowledged: with text typed in a field, a keyboard's send stays and gives the field the focus; Enter saves it");

    // a saved comment being edited, with a change typed: the send is held back the same way
    const [saved] = await storedOf(page);
    await cardWith(page, "Still typing").click();
    await fieldFocused(page);
    await page.keyboard.type(", changed");
    await message.focus();
    await message.fill("Third message.");
    await page.keyboard.press("Enter");
    await fieldFocused(page);
    await frames(page);
    assert.equal(sent.length, 1, "nothing goes while a saved comment's edit is typed");
    assert.equal(await fieldOf(page).inputValue(), "Still typing, changed", "the edit stays with its text");
    assert.deepEqual(await storedTexts(page), ["Still typing"], "the comment is still stored as it was");
    await page.keyboard.press("Enter");
    await eventually("the edit stored", async () => (await storedTexts(page)).includes("Still typing, changed"));
    const edited = await storedOf(page);
    assert.notEqual(edited[0]!.id, saved!.id, "saved as a new comment (a new id)");
    assert.equal(await message.inputValue(), "Third message.", "the message waits in the box");
    console.log("PASS acknowledged: editing a saved comment holds a keyboard's send back too; saving it makes a new comment");

    // a mouse's press on Send is a press outside the field: it leaves it, which saves the comment, and the message goes with it
    const step = partOf(page, "Step 1 of the rollout");
    await dragAcross(page, step, "rollout", step, "rollout");
    await selectionFieldOf(page).waitFor();
    await page.keyboard.type("Saved by the press");
    await page.evaluate(() => {
      document.addEventListener("click", () => {
        (window as unknown as { storedAtClick: string[] }).storedAtClick = Object.keys(localStorage).filter((key) => key.startsWith("ovis:block-comments:"))
          .flatMap((key) => (JSON.parse(localStorage.getItem(key)!) as { comments: { comment: string }[] }).comments.map((entry) => entry.comment));
      }, { capture: true, once: true });
    });
    await page.getByRole("button", { name: /^Send message/ }).click();
    const stores = await page.evaluate(() => (window as unknown as { storedAtClick?: string[] }).storedAtClick ?? []);
    assert.deepEqual([...stores].sort(), ["Saved by the press", "Still typing, changed"], "the press on Send stored the comment typed");
    await eventually("the message to be sent", async () => sent.length === 2, 5000);
    assert.ok(sent[1]!.includes("Saved by the press") && sent[1]!.includes("Still typing, changed") && sent[1]!.includes("Third message."), `the message goes with the comment the press saved (${JSON.stringify(sent[1])})`);
    console.log("PASS acknowledged: with text typed in a field, a mouse's press on Send saves the comment and the message goes with it");
    assert.deepEqual(errors, []);
    await close();
  },

  /** A phone: the app's own selection, Comment, the sheet; counts beside the reply; nothing pans sideways. */
  async "chat-touch"(open) {
    const { page, errors, close } = await open(IPHONE_14_PRO);
    assert.ok(await page.evaluate(() => matchMedia("(pointer: coarse)").matches), "the pointer is coarse");
    const finger = await fingerOf(page);
    const toggle = toggleOf(page);
    await toggle.tap();
    await eventually("the mode on", async () => (await toggle.getAttribute("aria-pressed")) === "true");
    await eventually("the hint", async () => (await page.locator(".chat-frame-body .code-comment-hint").textContent().catch(() => null)) === "Select text to comment");
    const intro = partOf(page, INTRO);
    const at = await wordPoint(intro, "paragraph");
    const started = Date.now();
    await finger("touchStart", at);
    await holdUntil(started + TOUCH_HOLD_MS + 150);
    await eventually("the word selected", async () => (await highlightText(page, "comment-touch-selection")) === "paragraph", 1000);
    await finger("touchEnd");
    assert.equal(await page.evaluate(() => window.getSelection()?.toString() ?? ""), "", "no system selection");
    const pill = page.getByRole("button", { name: "Comment", exact: true });
    await pill.waitFor();
    await pill.tap();
    const sheet = sheetOf(page);
    await sheet.waitFor();
    await fieldFocused(page);
    assert.equal(await sheet.locator(".comment-sheet-quote").innerText(), "paragraph", "the sheet quotes the selected word");
    await fieldOf(page).fill("Touch note.");
    await sheet.getByRole("button", { name: "Save", exact: true }).tap();
    await sheet.waitFor({ state: "detached" });
    await eventually("stored", async () => (await storedTexts(page)).includes("Touch note."));
    console.log("PASS chat-touch: a long press selects a word in the app's selection, Comment opens the sheet quoting it, Save stores it");

    await eventually("a count beside the reply", async () => (await countsOf(page).count()) === 1);
    assert.equal(await cardsOf(page).count(), 0, "no cards on a phone");
    // the text keeps its place: the count sits in the transcript's inset at the scroller's edge, its target 44 px high
    // and as wide as that free space, never over the text's glyphs
    const target = await countsOf(page).first().boundingBox();
    const room = await replyPlace(page);
    assert.ok(target !== null && target.height >= 44 && target.x >= room.right - 0.5 && Math.abs(target.x + target.width - room.viewRight) <= 1, `a count's target is 44 px high, over the free space right of the text (${JSON.stringify({ target, room })})`);
    const overflow = await page.locator(".chat-view").evaluate((node) => [node.scrollWidth, node.clientWidth]);
    assert.equal(overflow[0], overflow[1], "nothing pans the chat sideways");
    await countsOf(page).first().tap();
    await sheet.waitFor();
    assert.equal(await fieldOf(page).inputValue(), "Touch note.", "the count's tap opens its comment in the sheet");
    await sheet.getByRole("button", { name: "Close", exact: true }).tap();
    await sheet.waitFor({ state: "detached" });
    console.log("PASS chat-touch: a count beside the reply (a target 44 px high over the free space), its tap opens the sheet; nothing pans sideways");

    // the chat unmounted (its lens switched by the shortcut) with an edit typed in the sheet: the edit is stored, as
    // leaving the sheet would store it
    await countsOf(page).first().tap();
    await sheet.waitFor();
    await fieldOf(page).fill("Touch note. Kept.");
    await page.keyboard.press("ControlOrMeta+Shift+J");
    await page.locator(".chat-view").waitFor({ state: "detached" });
    await sheet.waitFor({ state: "detached" });
    await eventually("the sheet's edit stored as the chat unmounts", async () => (await storedTexts(page)).includes("Touch note. Kept."), 2000)
      .catch(async (error: Error) => { throw new Error(`${error.message} (stored ${JSON.stringify(await storedTexts(page))})`); });
    await page.keyboard.press("ControlOrMeta+Shift+J");
    await page.locator(".chat-view").waitFor();
    await eventually("the count back", async () => (await countsOf(page).count()) === 1, 5000);
    console.log("PASS chat-touch: an edit typed in the sheet is stored when the chat unmounts (its lens switched)");

    // an older reply the list mounts only as it is scrolled to: in the mode it takes no system selection either
    const view = page.locator(".chat-view");
    const older = partOf(page, "Earlier reply 1, paragraph 1");
    await eventually("the oldest reply's row to mount", async () => {
      await view.evaluate((node) => { node.scrollTop = 0; });
      return (await older.count()) === 1;
    }, 5000);
    const selectOf = (): Promise<string> => older.evaluate((node) => getComputedStyle(node.closest("[data-comment-root]")!).userSelect);
    assert.equal(await selectOf(), "none", "the mode on, a reply mounted later takes no system selection");
    await toggle.tap();
    await eventually("the mode off", async () => (await toggle.getAttribute("aria-pressed")) === "false");
    await eventually("its text selectable again", async () => (await selectOf()) !== "none");
    console.log("PASS chat-touch: a reply the list mounts later takes no system selection in the mode, and does again with the mode off");
    assert.deepEqual(errors, []);
    await close();
  },

  /**
   * Settings → Comments off while the sheet holds an edit typed (a finger's count, the mode on): the sheet goes and the
   * edit is not stored after every comment was deleted (the store keeps nothing while comments are off).
   */
  async "touch-setting"(open) {
    const { page, errors, close } = await open(IPHONE_14_PRO);
    const finger = await fingerOf(page);
    const toggle = toggleOf(page);
    await toggle.tap();
    await eventually("the mode on", async () => (await toggle.getAttribute("aria-pressed")) === "true");
    const at = await wordPoint(partOf(page, INTRO), "paragraph");
    const started = Date.now();
    await finger("touchStart", at);
    await holdUntil(started + TOUCH_HOLD_MS + 150);
    await eventually("the word selected", async () => (await highlightText(page, "comment-touch-selection")) === "paragraph", 1000);
    await finger("touchEnd");
    await page.getByRole("button", { name: "Comment", exact: true }).tap();
    const sheet = sheetOf(page);
    await sheet.waitFor();
    await fieldOf(page).fill("Touch note.");
    await sheet.getByRole("button", { name: "Save", exact: true }).tap();
    await sheet.waitFor({ state: "detached" });
    await eventually("a count beside the reply", async () => (await countsOf(page).count()) === 1);
    await countsOf(page).first().tap();
    await sheet.waitFor();
    await fieldOf(page).fill("Touch note. Edited.");
    await page.keyboard.press("ControlOrMeta+Shift+Comma");
    await openSettingsPage(page, "Comments");
    const commentsSwitch = page.locator(".settings-dialog").getByRole("switch", { name: "Comments", exact: true });
    await commentsSwitch.click();
    const confirm = page.getByRole("alertdialog");
    await confirm.waitFor();
    await confirm.getByRole("button", { name: "Turn off and delete", exact: true }).click();
    await confirm.waitFor({ state: "detached" });
    await eventually("the sheet gone", async () => (await sheet.count()) === 0);
    await frames(page, 10);
    assert.deepEqual(await storedOf(page), [], "the edit typed in the sheet is not stored after Comments off");
    console.log("PASS touch-setting: Settings → Comments off with an edit typed in the sheet closes it and stores nothing");
    assert.deepEqual(errors, []);
    await close();
  },

  /** Settings → Comments off: asked, then nothing: no marks, cards, toggles, bar or stored comments. */
  async setting(open) {
    const { page, context, url, errors, sent, close } = await open(WIDE);
    await modeOn(page);
    await commentOn(page, partOf(page, INTRO), "Intro", "Intro", "Setting one.");
    // the store as it holds the intro's comment alone: what another tab writes back below
    const written = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((name) => name.startsWith("ovis:block-comments:"))!;
      return { key, value: localStorage.getItem(key)! };
    });
    await commentOn(page, partOf(page, LONG_PARAGRAPH), "several", "several", "Setting two.");
    // a new comment being written when comments are turned off: it goes too, unsaved
    const step = partOf(page, "Step 1 of the rollout");
    await dragAcross(page, step, "rollout", step, "rollout");
    await selectionFieldOf(page).waitFor();
    await page.keyboard.type("Unsaved thought");
    await page.keyboard.press("ControlOrMeta+Shift+Comma");
    // every comment setting is on one page, Comments, between Chat and Terminal: the switch, then the selected text's
    // group (both rows of the preview and the chat), then the code view's
    const settingsDialog = page.locator(".settings-dialog");
    await settingsDialog.waitFor();
    assert.deepEqual(await settingsDialog.getByRole("tab").allInnerTexts().then((names) => names.map((name) => name.trim()).slice(1, 4)), ["Chat", "Comments", "Terminal"], "Comments sits between Chat and Terminal");
    await openSettingsPage(page, "Comments");
    const commentsPage = settingsDialog.getByRole("tabpanel", { name: "Comments", exact: true });
    const commentsSwitch = commentsPage.getByRole("switch", { name: "Comments", exact: true });
    assert.deepEqual(await commentsPage.locator(".settings-section > h3").allInnerTexts(), ["Selected text", "Code view"], "the page's titled groups");
    const groupOf = (title: string): Locator => commentsPage.locator(".settings-section", { has: page.getByRole("heading", { name: title, exact: true }) });
    const selectedGroup = groupOf("Selected text");
    assert.equal(await selectedGroup.locator(".settings-note").innerText(), "In the Markdown preview and the chat");
    assert.deepEqual(await selectedGroup.locator(".settings-label").allInnerTexts(), ["When you select text", "Comments beside the text"]);
    assert.equal(await selectedGroup.getByRole("button", { name: "Open the comment field", exact: true }).getAttribute("aria-pressed"), "true", "the seeded field variant is chosen");
    assert.equal(await selectedGroup.getByRole("button", { name: "Show a Comment button", exact: true }).getAttribute("aria-pressed"), "false");
    const codeGroup = groupOf("Code view");
    assert.deepEqual(await codeGroup.locator(".settings-label").allInnerTexts(), ["Click a line to comment", "On mobile, comment with", "On mobile, write comments in"]);
    assert.ok(!(await codeGroup.innerText()).includes("In the code view"), "the code view's notes leave its name to the group");
    /** The rows below the switch: each control, and whether it is disabled. */
    const rowsDisabled = async (): Promise<boolean[]> => [
      ...await selectedGroup.getByRole("button").evaluateAll((nodes) => nodes.map((node) => (node as HTMLButtonElement).disabled)),
      ...await codeGroup.getByRole("switch").evaluateAll((nodes) => nodes.map((node) => (node as HTMLButtonElement).disabled)),
      ...await codeGroup.getByRole("button").evaluateAll((nodes) => nodes.map((node) => (node as HTMLButtonElement).disabled)),
    ];
    assert.ok((await rowsDisabled()).length === 9 && (await rowsDisabled()).every((disabled) => !disabled), "with comments on, every row below the switch is enabled");
    console.log("PASS setting: Settings → Comments, between Chat and Terminal, holds the switch, Selected text (When you select text, Comments beside the text) and Code view (its three rows)");
    await commentsSwitch.click();
    const confirm = page.getByRole("alertdialog");
    await confirm.waitFor();
    assert.equal(await confirm.getByRole("heading").first().innerText(), "Delete 2 comments?", "the question names how many are stored");
    await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
    await confirm.waitFor({ state: "detached" });
    assert.equal(await commentsSwitch.getAttribute("aria-checked"), "true", "Cancel keeps comments on");
    assert.equal(await fieldOf(page).inputValue(), "Unsaved thought", "and the field being written in");
    await commentsSwitch.click();
    await confirm.waitFor();
    await confirm.getByRole("button", { name: "Turn off and delete", exact: true }).click();
    await confirm.waitFor({ state: "detached" });
    assert.ok((await rowsDisabled()).every((disabled) => disabled), "with comments off, every row below the switch is disabled");
    // the Chat page and the File viewer page have no comment rows, and no note pointing elsewhere
    await openSettingsPage(page, "Chat");
    const chatPage = settingsDialog.getByRole("tabpanel", { name: "Chat", exact: true });
    for (const name of ["Comments", "Comments beside the text"]) assert.equal(await chatPage.locator(".settings-label", { hasText: new RegExp(`^${name}$`) }).count(), 0, `the Chat page has no ${name} row`);
    await openSettingsPage(page, "File viewer");
    const filesPage = settingsDialog.getByRole("tabpanel", { name: "File viewer", exact: true });
    assert.equal(await filesPage.getByRole("heading", { name: "Comments", exact: true }).count(), 0, "the File viewer page has no Comments group");
    assert.equal(await filesPage.getByRole("switch", { name: "Click a line to comment", exact: true }).count(), 0);
    assert.equal(await filesPage.locator(".settings-note").count(), 0, "nor the note that pointed to the Chat page");
    console.log("PASS setting: with Comments off every row below the switch is disabled; the Chat and File viewer pages show no comment rows");
    await page.keyboard.press("Escape");
    await page.locator(".settings-dialog").waitFor({ state: "detached" });
    await eventually("no card", async () => (await cardsOf(page).count()) === 0);
    assert.equal(await popoverOf(page).count(), 0, "the field being written in is gone");
    assert.equal(await toggleOf(page).count(), 0, "no toggle in the chat");
    assert.equal(await barOf(page).count(), 0, "no comments bar");
    assert.deepEqual(await storedOf(page), [], "no comment is stored, the unsaved one not either");
    await dragAcross(page, partOf(page, INTRO), "paragraph", partOf(page, INTRO), "state");
    await frames(page, 10);
    assert.equal(await popoverOf(page).count(), 0, "a drag opens nothing");
    await page.getByRole("button", { name: "spec.md", exact: true }).click();
    const viewer = page.getByRole("dialog", { name: "spec.md", exact: true });
    await viewer.locator(".file-viewer-markdown").waitFor();
    assert.equal(await viewer.locator("button.file-viewer-comments").count(), 0, "no toggle in the viewer");
    await viewer.getByRole("button", { name: "Close file", exact: true }).click();
    await viewer.waitFor({ state: "detached" });
    console.log("PASS setting: turning comments off asks about the 2 comments; Cancel keeps them and the field; confirmed, no field, card, toggle (chat or viewer), bar or stored comment is left");

    // no comment stored, but one being written with text typed: turning comments off would lose it, so it asks about it
    await page.keyboard.press("ControlOrMeta+Shift+Comma");
    await openSettingsPage(page, "Comments");
    await commentsSwitch.click();
    assert.equal(await commentsSwitch.getAttribute("aria-checked"), "true");
    await page.keyboard.press("Escape");
    await page.locator(".settings-dialog").waitFor({ state: "detached" });
    await dragAcross(page, step, "rollout", step, "rollout");
    await selectionFieldOf(page).waitFor();
    await page.keyboard.type("Typed only");
    await page.keyboard.press("ControlOrMeta+Shift+Comma");
    await openSettingsPage(page, "Comments");
    await commentsSwitch.click();
    await confirm.waitFor();
    assert.equal(await confirm.getByRole("heading").first().innerText(), "Delete 1 comment?", "the comment being written is the one asked about");
    await confirm.getByRole("button", { name: "Turn off and delete", exact: true }).click();
    await confirm.waitFor({ state: "detached" });
    await page.keyboard.press("Escape");
    await page.locator(".settings-dialog").waitFor({ state: "detached" });
    assert.equal(await popoverOf(page).count(), 0, "the field being written in is gone");
    assert.deepEqual(await storedOf(page), [], "nothing is stored");
    console.log("PASS setting: with only a comment being written, turning comments off asks about 1 comment; confirmed, it goes unsaved");

    // comments off here, and another tab that still has them on writes one: it stays stored, but nothing shows
    const other = await context.newPage();
    await other.goto(url);
    await other.evaluate(({ key, value }) => localStorage.setItem(key, value), written);
    await other.close();
    await eventually("the other tab's comment to be stored", async () => (await storedOf(page)).length === 1);
    await frames(page, 10);
    assert.equal(await highlighted(page), 0, "its text is not marked");
    assert.equal(await cardsOf(page).count() + await countsOf(page).count(), 0, "no card or count");
    assert.equal(await barOf(page).count(), 0, "no comments bar");
    await messageOf(page).fill("Off message.");
    await page.keyboard.press("Enter");
    await eventually("the message to be sent", async () => sent.length === 1, 5000);
    assert.equal(sent.at(-1), "Off message.", "the message goes alone");
    assert.deepEqual(await storedTexts(page), ["Setting one."], "the other tab's comment stays stored");
    console.log("PASS setting: with comments off, a comment another tab stores shows no mark, card or bar, and a sent message carries no quote");
    assert.deepEqual(errors, []);
    await close();
  },

  /** A whole-block reply comment stored before selections: a card, its block marked, edited in place. */
  async legacy(open) {
    const { page, errors, close } = await open(WIDE, { comments: [LEGACY] });
    const card = cardWith(page, "Old block note.");
    await card.waitFor();
    await eventually("its block marked", async () => (await markedText(page)).includes(INTRO));
    await modeOn(page);
    await card.click();
    await card.locator(".comment-popover.is-row").waitFor();
    await fieldFocused(page);
    assert.equal(await fieldOf(page).inputValue(), "Old block note.");
    await page.keyboard.type(" Edited.");
    await page.keyboard.press("Enter");
    await eventually("the edit stored", async () => (await storedTexts(page)).includes("Old block note. Edited."));
    const [stored] = await storedOf(page);
    assert.equal(stored!.quote, undefined, "still a whole-block comment");
    assert.equal(stored!.anchor, LEGACY.anchor, "on its block");
    await cardWith(page, "Old block note. Edited.").waitFor();
    console.log("PASS legacy: a whole-block reply comment shows a card, its block marked, and edits in place");
    assert.deepEqual(errors, []);
    await close();
  },
};

const wanted = process.env.BLOCK_COMMENTS_CASE?.split(",").map((name) => name.trim()).filter((name) => name !== "") ?? Object.keys(cases);
const unknown = wanted.filter((name) => !(name in cases));
if (unknown.length > 0) throw new Error(`unknown BLOCK_COMMENTS_CASE: ${unknown.join(", ")} (known: ${Object.keys(cases).join(", ")})`);

let workspace: string | undefined;
let server: ReturnType<typeof createServer> | undefined;
let browser: Browser | undefined;
const failed: string[] = [];

try {
  const created = await workspaceCreate({ cwd: root, label: "herdr-web-ui-test-block-comments" });
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
  /** A fresh context on the pane's chat, its reply drawn, with `seed`'s comments stored and settings set beforehand. */
  const open: Open = async (options, seed = {}) => {
    const context = await launched.newContext(options);
    await context.route("https://example.com/**", (route) => route.abort());
    const page = await context.newPage();
    await page.addInitScript(({ id, comments, settings }) => {
      // seeded once: a reload keeps what the page has done since. A selection opens the field at once (`commentOnSelect`
      // "field"), the variant the cases test; `chat-button` seeds the default, the Comment button
      if (localStorage.getItem("ovis:settings") === null) localStorage.setItem("ovis:settings", JSON.stringify({ language: "en", commentOnSelect: "field", ...settings }));
      localStorage.setItem(`ovis:view:${id}`, "chat");
      const key = `ovis:block-comments:${id}`;
      if (comments.length > 0 && localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify({ version: 1, comments }));
    }, { id: pane, comments: seed.comments ?? [], settings: seed.settings ?? {} });
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
    await partOf(page, INTRO).waitFor();
    return { page, context, url, errors, sent, close: () => context.close() };
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
