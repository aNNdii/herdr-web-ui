/**
 * Block comments on an agent's reply, made by selecting text: the highlight and a speech bubble per comment, the desktop
 * popover and the phone's sheet, a selection over several parts, with a real Codex transcript and an owned herdr pane.
 * Waits are bounded polls (`eventually`, `frames`), never fixed sleeps.
 */
import "./test-herdr.ts";
import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Locator, type Page } from "playwright-core";
import { createServer } from "../server/index.ts";
import { herdrRpc, workspaceClose, workspaceCreate } from "../server/herdr/client.ts";

const INTRO = "Intro paragraph about the state.";
const LONG_PARAGRAPH = "A longer paragraph that runs across several lines on a phone, so its first line reaches the right edge where the comment button sits.";
const ANSWER = [
  INTRO,
  "",
  "1. Run the migration",
  "2. Restart the server",
  "   - check the logs",
  "",
  "See [docs](https://example.com).",
  "",
  LONG_PARAGRAPH,
  "",
  "```ts",
  "const a = 1;",
  "```",
].join("\n");

/** A reply with an inline and a display formula: what a selection in a formula, its highlight and its bubble's tail are measured on. */
const MATH_ANSWER = [
  "Energy relates to mass as \\(E = mc^2\\) in a vacuum.",
  "",
  "\\[ a^2 + b^2 = c^2 \\]",
].join("\n");

/** A reply with a long code block (it folds) and a link, for selections in an unfolded block and for the editor's quote. */
const LONG_CODE = Array.from({ length: 40 }, (_, n) => `line ${n + 1}`).join("\n");
const LONG_ANSWER = [
  "Intro paragraph about the state.",
  "",
  "See [docs](https://example.com).",
  "",
  "```text",
  LONG_CODE,
  "```",
].join("\n");

const root = mkdtempSync(join(tmpdir(), "herdr-web-ui-block-comments-"));
const codexHome = join(root, "codex-home");
const thread = "01a0c7a1-56d9-7e20-9f08-f7a2d973bc12";
mkdirSync(join(codexHome, "sessions"), { recursive: true });
const transcript = join(codexHome, "sessions", `rollout-2026-10-04T00-00-00-${thread}.jsonl`);
/** Writes the rollout: the user's question and `answer` as the final answer. */
const writeTranscript = (answer: string): void => writeFileSync(transcript, [
  { type: "session_meta", payload: { id: thread, cwd: root } },
  { timestamp: "2026-10-04T10:00:00.000Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Show me the plan." }] } },
  { timestamp: "2026-10-04T10:00:05.000Z", type: "response_item", payload: { type: "message", role: "assistant", phase: "final_answer", content: [{ type: "output_text", text: answer }] } },
].map((row) => JSON.stringify(row)).join("\n"));
writeTranscript(ANSWER);
const db = new Database(join(codexHome, "state_5.sqlite"));
db.exec("CREATE TABLE threads (id TEXT, rollout_path TEXT, cwd TEXT, archived INTEGER, agent_role TEXT, created_at INTEGER, updated_at INTEGER, source TEXT, first_user_message TEXT)");
db.query("INSERT INTO threads VALUES (?, ?, ?, 0, NULL, 1, 1, 'cli', ?)").run(thread, transcript, root, "Show me the plan.");
db.close();
const standIn = join(root, "codex");
writeFileSync(standIn, "#!/bin/sh\nsleep 600\n");
chmodSync(standIn, 0o755);
const evidence = process.env.UI_EVIDENCE_DIR;
if (evidence) mkdirSync(evidence, { recursive: true });
let workspace: string | undefined;
let server: ReturnType<typeof createServer> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;

/** The comments' context bar: the first row of the message box, one for all the comments stored for the pane. The held row has a chip of its own (`.composer-queue-comments`). */
const barOf = (page: Page): Locator => page.locator(".composer-surface > .composer-comments-bar");
/** The bar's text: one button that says how many comments there are and walks to them. */
const walkOf = (page: Page): Locator => barOf(page).locator("button.composer-comments-walk");
/** The bar's X, which takes every comment at once. */
const removeOf = (page: Page): Locator => barOf(page).locator("button.composer-comments-remove");
/** The undo that takes the bar's place after the X. */
const undoOf = (page: Page): Locator => barOf(page).locator("button.composer-comments-undo");
/** What the walk button's name says ("3 comments on the reply"; waiting, "3 comments waiting. <why>"). */
const labelOf = (page: Page): Promise<string | null> => walkOf(page).getAttribute("aria-label");
/** The Comment button floating over a selection in the chat. */
const floatOf = (page: Page): Locator => page.locator(".chat-view .comment-selection");
/** The desktop editor: a popover in the chat view, where the Comment button was or under a bubble. It shows no quote. */
const popoverOf = (page: Page): Locator => page.locator(".chat-view .comment-popover");
/** The modal editor (a bottom sheet on a phone): for a touch screen, a window of 768px or less, and a part that is not in the chat. It quotes the selection. */
const sheetOf = (page: Page): Locator => page.locator(".comment-editor");
/** Every bubble in the chat: one per comment, in reading order (the DOM's order is the walk's). */
const notesOf = (page: Page): Locator => page.locator(".chat-view .block-comment-row");
/** The bubbles as read: the comment only (the excerpt is in the name, not drawn). */
const noteTexts = async (page: Page): Promise<string[]> => (await notesOf(page).allTextContents()).map((text) => text.trim());
/** The bubbles' accessible names: "Comment on “excerpt”: text" for a selection, the text itself for a comment on a whole part. */
const noteNames = (page: Page): Promise<string[]> => notesOf(page).evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label") ?? node.textContent!.trim()));
/** What a Playwright run has no more of than "a page of an earlier interface": nothing of it may exist (no "+", gutter, tile, pill, send count, and no excerpt drawn in a bubble). */
const staleOf = (page: Page): Locator => page.locator(".block-comment-add, .chat-view .is-selected, .has-comment-gutter, .composer-comments-tile, .composer-comments-pill, .composer-send-count, .block-comment-quote");
/**
 * What stays as it is when the comments' bar comes or goes: the controls row, and the distance from
 * the message's first line to it (the message gives up part of its top padding and of its floor for
 * the bar's own gap, so its box is shorter while the bar is there, and the space under its text is not).
 */
async function messageLayout(page: Page): Promise<{ controls: number; below: number }> {
  return page.evaluate(() => {
    const text = document.querySelector<HTMLElement>(".composer-surface > .composer-text")!;
    const controls = document.querySelector<HTMLElement>(".composer-surface .composer-controls-left")!.getBoundingClientRect().top;
    const firstLine = text.getBoundingClientRect().top + parseFloat(getComputedStyle(text).paddingTop);
    return { controls, below: controls - firstLine };
  });
}
/** The controls row and the first line's distance to it are `wanted` (within 1px), polled: the message follows the bar in a layout effect. */
async function assertMessageLayout(page: Page, wanted: { controls: number; below: number }, what: string): Promise<void> {
  let seen = wanted;
  await eventually(`the controls row and the message's first line to stay where they are ${what}`, async () => {
    seen = await messageLayout(page);
    return Math.abs(seen.controls - wanted.controls) <= 1 && Math.abs(seen.below - wanted.below) <= 1;
  }).catch((error: Error) => { throw new Error(`${error.message} (controls ${seen.controls}px, line to controls ${seen.below}px; wanted ${wanted.controls}px, ${wanted.below}px)`); });
}

/** Polls `check` every 50 ms until it holds; throws at the deadline (no fixed sleeps). */
async function eventually(what: string, check: () => Promise<boolean>, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(50);
  }
}

/** Waits `count` animation frames (the page's own updates run once per frame). */
const frames = (page: Page, count = 3): Promise<void> => page.evaluate((n) => new Promise<void>((resolve) => {
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
/**
 * The highlight holds one range per part segment of every comment shown: by default one per bubble (a selection in one
 * part, or a comment on a whole part), `ranges` where some comment spans parts. Returns the number of bubbles.
 */
async function highlightMatchesNotes(page: Page, what: string, ranges?: number): Promise<number> {
  let seen = [0, 0];
  await eventually(`the highlight to match the bubbles: ${what}`, async () => {
    seen = [await highlighted(page), ranges ?? (await notesOf(page).count())];
    return seen[0] === seen[1];
  }).catch((error: Error) => { throw new Error(`${error.message} (highlight ranges ${seen[0]}, wanted ${seen[1]})`); });
  return notesOf(page).count();
}

/** One comment as the store keeps it (`herdr-web-ui:block-comments:<pane>`); `until` is the last part a selection over several reaches. */
interface StoredComment { id: string; anchor: string; comment: string; order: number[]; quote?: string; range?: [number, number]; until?: { anchor: string; end: number } }
const storedOf = (page: Page): Promise<StoredComment[]> => page.evaluate(() => {
  const found: unknown[] = [];
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("herdr-web-ui:block-comments:")) found.push(...(JSON.parse(localStorage.getItem(key)!) as { comments: unknown[] }).comments);
  }
  return found as StoredComment[];
});
/**
 * The store with the comment written as `text` in the shape an earlier version kept: on its first part as a whole (no
 * quote, range or end part), its anchor without the selection's `@…` suffix, which has the end part's path and end offset
 * when the selection ran over several parts (`@6-3.1:5`), and its order without the selection's `-1, start`.
 */
function legacyOf(data: { version: number; comments: StoredComment[] }, text: string): { version: number; comments: Omit<StoredComment, "quote" | "range" | "until">[] } {
  return {
    ...data,
    comments: data.comments.map((entry) => {
      if (entry.comment !== text) return entry;
      const { quote: _quote, range: _range, until: _until, ...rest } = entry;
      return { ...rest, anchor: rest.anchor.replace(/@\d+-[\d.]+(?::\d+)?$/, ""), order: rest.order.slice(0, -2) };
    }),
  };
}
/** Rewrites the page's stored comments with `legacyOf`; the page is to be reloaded after. */
async function makeLegacy(page: Page, storeKey: string, text: string): Promise<void> {
  const raw = await page.evaluate((key) => localStorage.getItem(key), storeKey);
  assert.ok(raw !== null, "the comment was stored");
  const legacy = legacyOf(JSON.parse(raw) as { version: number; comments: StoredComment[] }, text);
  assert.equal(legacy.comments.filter((entry) => !("quote" in entry)).length, 1, "one comment was turned into the earlier shape");
  await page.evaluate(([key, value]) => localStorage.setItem(key!, value!), [storeKey, JSON.stringify(legacy)]);
}
/** The quote the store holds for the comment written as `text`: what was selected, and what the message will carry. */
const storedQuote = async (page: Page, text: string): Promise<string | undefined> => (await storedOf(page)).find((entry) => entry.comment === text)?.quote;

/**
 * The ranges of the named highlight, as the text each covers, whether each lies inside one commentable part (never
 * across parts: the bubbles between would be painted), and whether any of them takes in a group of bubbles.
 */
const rangesOf = (page: Page, name: string): Promise<{ texts: string[]; withinPart: boolean[]; paintsBubbles: boolean }> => page.evaluate((highlight) => {
  const registry = (CSS as unknown as { highlights?: { get(key: string): Iterable<Range> | undefined } }).highlights;
  const ranges = [...(registry?.get(highlight) ?? [])];
  const partOf = (node: Node): Element | null => (node instanceof Element ? node : node.parentElement)?.closest(".is-commentable") ?? null;
  const groups = [...document.querySelectorAll(".block-comment-notes")];
  return {
    texts: ranges.map((range) => range.toString()),
    withinPart: ranges.map((range) => { const part = partOf(range.startContainer); return part !== null && part === partOf(range.endContainer); }),
    paintsBubbles: ranges.some((range) => groups.some((group) => range.intersectsNode(group))),
  };
}, name);

/** No rail, bar or tint on a commented part (the highlight is all there is), and none of the old tint variables. */
async function assertNoRail(page: Page, what: string): Promise<void> {
  const found = await page.evaluate(() => {
    const marks: string[] = [];
    for (const element of document.querySelectorAll(".chat-view .is-commentable, .chat-view .block-comment-notes")) {
      const content = getComputedStyle(element, "::before").content;
      if (content !== "none" && content !== "normal") marks.push(`${element.tagName}.${element.className} ::before ${content}`);
    }
    for (const element of document.querySelectorAll(".chat-view p.is-commented, .chat-view .markdown-item.is-commented")) {
      const style = getComputedStyle(element);
      if (style.backgroundColor !== "rgba(0, 0, 0, 0)" || style.boxShadow !== "none") marks.push(`${element.tagName}.${element.className} fill ${style.backgroundColor} shadow ${style.boxShadow}`);
    }
    const root = getComputedStyle(document.querySelector(".chat-view")!);
    for (const name of ["--comment-tint", "--comment-bar-x", "--comment-edge"]) if (root.getPropertyValue(name).trim() !== "") marks.push(`${name} is still set`);
    return marks;
  });
  assert.deepEqual(found, [], `${what}: nothing is drawn beside commented text`);
}

/** How far a bubble's tail may point from where its highlight ends (or starts, for a comment on a whole part), in px. */
const TAIL_TOLERANCE_PX = 12;
/** Where a tail points: at the end of `text` (a selection in a part), `"text start"` (a comment on a whole part: the text's first character, plus --space-3), or a formula's last/first row of glyphs. */
type TailAt = { text: string } | "text start" | "formula end" | "formula start";
/** The distance in px between the middle of `note`'s tail and the place `at` names in `part` (measured on the page's own boxes, not on the highlight's ranges). */
async function tailGap(note: Locator, part: Locator, at: TailAt): Promise<number> {
  return part.evaluate((node, arg) => {
    const skipped = ".block-comment-notes, .block-comment-row, .markdown-code-header, button:not(.markdown-file), [aria-hidden='true']";
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
      acceptNode: (found) => {
        const hit = found.parentElement?.closest(skipped);
        return hit && node.contains(hit) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes: Text[] = [];
    let all = "";
    for (let next = walker.nextNode(); next; next = walker.nextNode()) {
      nodes.push(next as Text);
      all += (next as Text).data;
    }
    const glyph = (offset: number): DOMRect => {
      let seen = 0;
      for (const piece of nodes) {
        if (offset < seen + piece.length) {
          const range = document.createRange();
          range.setStart(piece, offset - seen);
          range.setEnd(piece, offset - seen + 1);
          return range.getBoundingClientRect();
        }
        seen += piece.length;
      }
      throw new Error(`no text at offset ${offset}`);
    };
    const space3 = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--space-3"));
    const rows = [...node.querySelectorAll(".katex-html > .base")];
    let wanted: number;
    if (arg.at === "formula end") wanted = [...rows.at(-1)!.getClientRects()].at(-1)!.right;
    else if (arg.at === "formula start") wanted = rows[0]!.getClientRects()[0]!.left + space3;
    else if (arg.at === "text start") wanted = glyph(all.search(/\S/)).left + space3;
    else {
      const start = all.indexOf(arg.at.text);
      if (start < 0) throw new Error(`"${arg.at.text}" is not in the part: ${JSON.stringify(all)}`);
      wanted = glyph(start + arg.at.text.length - 1).right;
    }
    const bubble = arg.bubble;
    const tail = bubble.getBoundingClientRect().left + bubble.clientLeft + parseFloat(getComputedStyle(bubble, "::before").left);
    return Math.abs(tail - wanted);
  }, { bubble: await note.elementHandle(), at });
}
/** The tail of `note` points within `TAIL_TOLERANCE_PX` of `at` in `part`: polled, the bubbles are placed once per frame after a change. */
async function assertTail(note: Locator, part: Locator, at: TailAt, what: string): Promise<void> {
  let gap = Number.POSITIVE_INFINITY;
  await eventually(`${what}: the bubble's tail to point within ${TAIL_TOLERANCE_PX}px of ${JSON.stringify(at)}`, async () => (gap = await tailGap(note, part, at)) <= TAIL_TOLERANCE_PX)
    .catch((error: Error) => { throw new Error(`${error.message} (off by ${gap}px)`); });
}

/**
 * What a bubble looks like, read against the tokens it is drawn with: a button card with the elevated fill and a
 * hairline edge, the tokens' radius and padding, its text colour and size, a tail, and no excerpt inside. The pointer is
 * moved off it and its transitions finished first.
 */
async function assertBubbleLook(page: Page, note: Locator, what: string): Promise<void> {
  await page.mouse.move(1, 1);
  const look = await note.evaluate(async (node) => {
    await Promise.all(node.getAnimations().map((animation) => animation.finished));
    const style = getComputedStyle(node);
    const root = getComputedStyle(document.documentElement);
    const probe = document.createElement("div");
    document.body.append(probe);
    const colour = (token: string): string => { probe.style.color = `var(${token})`; return getComputedStyle(probe).color; };
    probe.style.backgroundColor = "var(--bg-elevated)";
    const elevated = getComputedStyle(probe).backgroundColor;
    const length = (token: string): string => root.getPropertyValue(token).trim();
    const result = {
      tag: node.tagName,
      border: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
      borderStyle: style.borderTopStyle,
      borderColor: [style.borderTopColor, colour("--border")],
      background: [style.backgroundColor, elevated],
      color: [style.color, colour("--text")],
      radius: [style.borderTopLeftRadius, length("--radius-md")],
      padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
      wantedPadding: [length("--space-1"), length("--space-2"), length("--space-1"), length("--space-2")],
      fontSize: [style.fontSize, length("--fs-sm")],
      tail: getComputedStyle(node, "::before").content,
      title: node.getAttribute("title"),
      quotes: node.querySelectorAll(".block-comment-quote, q").length,
    };
    probe.remove();
    return result;
  });
  assert.equal(look.tag, "BUTTON", `${what}: the bubble is a button (keyboard, editing)`);
  assert.deepEqual(look.border, ["1px", "1px", "1px", "1px"], `${what}: a hairline edge`);
  assert.equal(look.borderStyle, "solid");
  assert.equal(look.borderColor[0], look.borderColor[1], `${what}: the edge is --border`);
  assert.equal(look.background[0], look.background[1], `${what}: the fill is --bg-elevated`);
  assert.equal(look.color[0], look.color[1], `${what}: the text is --text`);
  assert.equal(look.radius[0], look.radius[1], `${what}: the corners are --radius-md`);
  assert.deepEqual(look.padding, look.wantedPadding, `${what}: the padding is --space-1 --space-2`);
  assert.equal(look.fontSize[0], look.fontSize[1], `${what}: the text is --fs-sm`);
  assert.notEqual(look.tail, "none", `${what}: the bubble has a tail`);
  assert.equal(look.title, "Edit comment");
  assert.equal(look.quotes, 0, `${what}: no excerpt is drawn in the bubble`);
}

/** The group of bubbles under `part` (a paragraph or a block's host, not a list item): right under it, the tail's room above each bubble, each bubble inside the part's width, stacked with room for the tails. */
function assertBubbleGroup(part: Locator, what: string): Promise<void> {
  return part.evaluate((node, label) => {
    const group = node.nextElementSibling;
    if (!(group instanceof HTMLElement) || !group.classList.contains("block-comment-notes")) throw new Error(`${label}: no bubbles under the part`);
    const root = getComputedStyle(document.documentElement);
    const space1 = parseFloat(root.getPropertyValue("--space-1"));
    const rise = parseFloat(getComputedStyle(group).getPropertyValue("--tail-size")) * 0.71;
    const area = group.getBoundingClientRect();
    const gap = area.top - node.getBoundingClientRect().bottom;
    const problems: string[] = [];
    if (Math.abs(gap - (space1 + rise)) > 1.5) problems.push(`the group is ${gap}px under the part, wanted --space-1 + the tail's rise (${space1 + rise}px)`);
    const bubbles = [...group.querySelectorAll(".block-comment-row")].map((bubble) => bubble.getBoundingClientRect());
    for (const box of bubbles) {
      if (box.left < area.left - 0.5 || box.right > area.right + 0.5) problems.push(`a bubble leaves the part's width (${box.left}-${box.right}px, part ${area.left}-${area.right}px)`);
      if (box.width > 0.8 * area.width + 1) problems.push(`a bubble is wider than 80% of the part (${box.width}px of ${area.width}px)`);
    }
    for (let index = 1; index < bubbles.length; index++) {
      const between = bubbles[index]!.top - bubbles[index - 1]!.bottom;
      if (Math.abs(between - (space1 + rise)) > 1.5) problems.push(`bubbles ${index} and ${index + 1} are ${between}px apart, wanted --space-1 + the tail's rise (${space1 + rise}px)`);
    }
    return problems.map((problem) => `${label}: ${problem}`);
  }, what).then((problems) => assert.deepEqual(problems, [], `${what}: the bubbles sit right under their part`));
}

/**
 * Selects text in `part` the way the end of a drag or a long press leaves it: a range over the
 * part's own text nodes (not its notes, header or buttons), made the page's selection, then the
 * `pointerup` that ends a gesture. `from` is where the text starts; with `to`, the selection runs
 * on to the end of the first `to` after it. The selected text is scrolled to the view's middle.
 */
async function select(page: Page, part: Locator, from: string, to?: string): Promise<void> {
  await part.evaluate((node, text) => {
    const skipped = ".block-comment-notes, .block-comment-row, .markdown-code-header, button:not(.markdown-file), [aria-hidden='true']";
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
      acceptNode: (found) => {
        const hit = found.parentElement?.closest(skipped);
        return hit && node.contains(hit) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes: Text[] = [];
    let all = "";
    for (let next = walker.nextNode(); next; next = walker.nextNode()) {
      nodes.push(next as Text);
      all += (next as Text).data;
    }
    const start = all.indexOf(text.from);
    if (start < 0) throw new Error(`"${text.from}" is not in the part: ${JSON.stringify(all)}`);
    let end = start + text.from.length;
    if (text.to !== undefined) {
      const at = all.indexOf(text.to, end);
      if (at < 0) throw new Error(`"${text.to}" does not follow "${text.from}" in the part`);
      end = at + text.to.length;
    }
    const point = (offset: number, atEnd: boolean): [Text, number] => {
      let seen = 0;
      for (const piece of nodes) {
        if (offset < seen + piece.length || (atEnd && offset === seen + piece.length)) return [piece, offset - seen];
        seen += piece.length;
      }
      throw new Error("no text node at the offset");
    };
    const range = document.createRange();
    range.setStart(...point(start, false));
    range.setEnd(...point(end, true));
    // the selected text in the middle of the chat view: a long block may be taller than the view
    const view = document.querySelector(".chat-view")!;
    const box = view.getBoundingClientRect();
    const line = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0).at(-1) ?? range.getBoundingClientRect();
    view.scrollBy({ top: line.top + line.height / 2 - (box.top + box.height / 2), behavior: "instant" });
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    // released at the selection's end, as a drag to the right leaves it
    node.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      pointerType: matchMedia("(pointer: coarse)").matches ? "touch" : "mouse",
      clientX: line.right,
      clientY: line.top + line.height / 2,
    }));
  }, { from, to });
}

/**
 * Selects across parts of one reply the way the end of a drag leaves it: from `from` in `first` (its own text, as `select`
 * counts it) to the end of `to` in `last`, a later part. The page's selection, then the `pointerup` that ends a gesture, on
 * `last` at the selection's end, which is scrolled to the view's middle.
 */
async function selectSpan(page: Page, first: Locator, from: string, last: Locator, to: string): Promise<void> {
  await page.evaluate(({ start, stop, text }) => {
    const skipped = ".block-comment-notes, .block-comment-row, .markdown-code-header, button:not(.markdown-file), [aria-hidden='true']";
    const own = (root: Element): { nodes: Text[]; all: string } => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (found) => {
          const hit = found.parentElement?.closest(skipped);
          return hit && root.contains(hit) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        },
      });
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
    const tail = own(stop);
    const at = head.all.indexOf(text.from);
    const on = tail.all.indexOf(text.to);
    if (at < 0) throw new Error(`"${text.from}" is not in the first part: ${JSON.stringify(head.all)}`);
    if (on < 0) throw new Error(`"${text.to}" is not in the last part: ${JSON.stringify(tail.all)}`);
    const range = document.createRange();
    range.setStart(...point(head, at, false));
    range.setEnd(...point(tail, on + text.to.length, true));
    const view = document.querySelector(".chat-view")!;
    const box = view.getBoundingClientRect();
    const line = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0).at(-1) ?? range.getBoundingClientRect();
    view.scrollBy({ top: line.top + line.height / 2 - (box.top + box.height / 2), behavior: "instant" });
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    stop.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      pointerType: matchMedia("(pointer: coarse)").matches ? "touch" : "mouse",
      clientX: line.right,
      clientY: line.top + line.height / 2,
    }));
  }, { start: await first.elementHandle(), stop: await last.elementHandle(), text: { from, to } });
}

/**
 * Selects text with the real mouse: by default right to left, pressing at the end of `to` (the first one
 * after `from`), dragging to the start of `from` and letting go there; `forward`, from the start of `from`
 * to the end of `to`. `part` may hold several parts (a list), the text counted is all of its own. Returns
 * both points (client pixels; the text is scrolled to the view's middle first, so they are the points the
 * mouse really used).
 */
async function drag(page: Page, part: Locator, from: string, to: string, { forward = false }: { forward?: boolean } = {}): Promise<{ press: { x: number; y: number }; release: { x: number; y: number } }> {
  const points = await part.evaluate((node, text) => {
    const skipped = ".block-comment-notes, .block-comment-row, .markdown-code-header, button:not(.markdown-file), [aria-hidden='true']";
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
      acceptNode: (found) => {
        const hit = found.parentElement?.closest(skipped);
        return hit && node.contains(hit) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes: Text[] = [];
    let all = "";
    for (let next = walker.nextNode(); next; next = walker.nextNode()) {
      nodes.push(next as Text);
      all += (next as Text).data;
    }
    const start = all.indexOf(text.from);
    const after = all.indexOf(text.to, start + text.from.length);
    if (start < 0 || after < 0) throw new Error(`"${text.from}"…"${text.to}" is not in the part: ${JSON.stringify(all)}`);
    const end = after + text.to.length;
    /** the box of the character at `offset` */
    const glyph = (offset: number): DOMRect => {
      let seen = 0;
      for (const piece of nodes) {
        if (offset < seen + piece.length) {
          const range = document.createRange();
          range.setStart(piece, offset - seen);
          range.setEnd(piece, offset - seen + 1);
          return range.getBoundingClientRect();
        }
        seen += piece.length;
      }
      throw new Error("no text node at the offset");
    };
    const view = document.querySelector(".chat-view")!;
    const box = view.getBoundingClientRect();
    const first = glyph(start);
    view.scrollBy({ top: first.top + first.height / 2 - (box.top + box.height / 2), behavior: "instant" });
    const head = glyph(start);
    const tail = glyph(end - 1);
    const atTail = { x: tail.right, y: tail.top + tail.height / 2 };
    const atHead = { x: head.left, y: head.top + head.height / 2 };
    return { press: atTail, release: atHead, wrapped: tail.top > head.bottom - 1 };
  }, { from, to });
  if (forward) [points.press, points.release] = [points.release, points.press];
  assert.ok(points.wrapped, `the text "${from}"…"${to}" runs over two lines or more at this width`);
  await page.mouse.move(points.press.x, points.press.y);
  await page.mouse.down();
  await page.mouse.move(points.release.x, points.release.y, { steps: 12 });
  await page.mouse.up();
  return { press: points.press, release: points.release };
}

/**
 * Where the bar sits in the card: its edges against the content column (the message's text, and the
 * attachment tiles' left edge), the room above it (below the strip, or from the card's top) and between
 * it and the message's first line, the order of the rows in the DOM and on screen, its borders, and the
 * tokens those are drawn with.
 */
const barLayout = (page: Page): Promise<{
  left: number; right: number; tile: number | null; fromEdge: number; above: number; below: number;
  stripFirst: boolean; textAfter: boolean; borders: number[]; space: Record<string, number>;
}> => page.evaluate(() => {
  const surface = document.querySelector(".composer-surface")!;
  const bar = surface.querySelector(":scope > .composer-comments-bar")!;
  const text = surface.querySelector(":scope > .composer-text")!;
  const strip = surface.querySelector(":scope > .composer-attachments");
  const tile = strip?.querySelector(".composer-attachment") ?? null;
  const outer = surface.getBoundingClientRect();
  const innerLeft = outer.left + surface.clientLeft;
  const innerTop = outer.top + surface.clientTop;
  const box = bar.getBoundingClientRect();
  const field = text.getBoundingClientRect();
  const fieldStyle = getComputedStyle(text);
  const style = getComputedStyle(bar);
  const root = getComputedStyle(document.documentElement);
  const follows = (a: Node, b: Node): boolean => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  return {
    left: box.left - (field.left + parseFloat(fieldStyle.paddingLeft)),
    right: field.right - parseFloat(fieldStyle.paddingRight) - box.right,
    tile: tile ? box.left - tile.getBoundingClientRect().left : null,
    fromEdge: box.left - innerLeft,
    above: strip ? box.top - strip.getBoundingClientRect().bottom : box.top - innerTop,
    below: field.top + parseFloat(fieldStyle.paddingTop) - box.bottom,
    stripFirst: strip === null || (follows(strip, bar) && strip.getBoundingClientRect().bottom <= box.top + 1),
    textAfter: follows(bar, text) && field.top >= box.bottom - 1,
    borders: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth].map(parseFloat),
    space: Object.fromEntries(["--space-2", "--space-3", "--space-4", "--space-5"].map((name) => [name, parseFloat(root.getPropertyValue(name))])),
  };
});
/**
 * The bar is a box in the content column, below the attachments, with no rail: its edges are the column's
 * (`column`, a space token: the tiles' and the text's inset), `--space-2` below a strip or `--space-3`
 * from the card's top, `--space-2` above the message's first line, and no border.
 */
function assertBarLayout(layout: Awaited<ReturnType<typeof barLayout>>, where: string, { column, strip }: { column: string; strip: boolean }): void {
  const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1;
  assert.ok(near(layout.left, 0) && near(layout.right, 0), `${where}: the bar's left and right edges are the content column's (${layout.left} / ${layout.right}px off)`);
  assert.ok(near(layout.fromEdge, layout.space[column]!), `${where}: the column is ${column} in from the card (${layout.fromEdge}px, wanted ${layout.space[column]}px)`);
  if (layout.tile !== null) assert.ok(near(layout.tile, 0), `${where}: the bar starts at the attachment tiles' left edge (${layout.tile}px off)`);
  const wanted = layout.space[strip ? "--space-2" : "--space-3"]!;
  assert.ok(near(layout.above, wanted), `${where}: the bar is ${strip ? "--space-2 below the attachments" : "--space-3 from the card's top"} (${layout.above}px, wanted ${wanted}px)`);
  assert.ok(near(layout.below, layout.space["--space-2"]!), `${where}: the message's first line is --space-2 below the bar (${layout.below}px, wanted ${layout.space["--space-2"]}px)`);
  assert.ok(layout.stripFirst, `${where}: the attachments come before the bar, in the DOM and on screen`);
  assert.ok(layout.textAfter, `${where}: the message comes after the bar, in the DOM and on screen`);
  assert.deepEqual(layout.borders, [0, 0, 0, 0], `${where}: the bar has no border, so no rail`);
}

/** Where the Comment button is against the selection's last line and the chat view, in viewport pixels. */
interface Placement {
  button: { top: number; bottom: number; left: number; right: number; height: number };
  view: { top: number; bottom: number; left: number; right: number };
  line: { top: number; bottom: number };
}
const placementOf = (page: Page): Promise<Placement> => page.evaluate(() => {
  const plain = (rect: DOMRect): { top: number; bottom: number; left: number; right: number; height: number } => ({ top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, height: rect.height });
  const button = document.querySelector(".chat-view .comment-selection")!.getBoundingClientRect();
  const view = document.querySelector(".chat-view")!;
  const box = view.getBoundingClientRect();
  const range = window.getSelection()!.getRangeAt(0);
  const line = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0).at(-1)!;
  // the view's padding box: what the button is placed in
  return {
    button: plain(button),
    view: { top: box.top + view.clientTop, bottom: box.top + view.clientTop + view.clientHeight, left: box.left + view.clientLeft, right: box.left + view.clientLeft + view.clientWidth },
    line: { top: line.top, bottom: line.bottom },
  };
});
const insideView = ({ button, view }: Placement): boolean => button.left >= view.left - 0.5 && button.right <= view.right + 0.5 && button.top >= view.top - 0.5 && button.bottom <= view.bottom + 0.5;

/**
 * Makes the comment `text` on the selection `from`…`to` of `part`: select, the floating button, the
 * editor, type, Save. With a mouse in a wide window the editor is the popover (no quote: the returned quote is what the
 * store then holds); `sheet` (a window of 768px or less) or `touch` (taps instead of clicks) give the modal, and the
 * returned quote is the one it showed.
 */
async function comment(page: Page, part: Locator, from: string, text: string, { to, touch = false, sheet = false }: { to?: string; touch?: boolean; sheet?: boolean } = {}): Promise<string> {
  await select(page, part, from, to);
  const button = floatOf(page);
  await button.waitFor();
  if (touch) await button.tap();
  else await button.click();
  const modal = touch || sheet;
  const editor = modal ? sheetOf(page) : popoverOf(page);
  await editor.waitFor();
  const shown = modal ? await editor.locator(".comment-editor-plain").innerText() : null;
  await editor.getByRole("textbox", { name: "Comment" }).fill(text);
  if (touch) await editor.getByRole("button", { name: "Save", exact: true }).tap();
  else await editor.getByRole("button", { name: "Save", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
  return shown ?? (await storedQuote(page, text)) ?? "";
}

/**
 * What the walk stands on: how many bubbles are `is-current`, the first one's index among the bubbles
 * of the chat (the DOM's order, the walk's), whether it has the focus, how many ranges the current highlight holds,
 * whether the first of them lies inside the chat view, and whether the bubble does (the walk shows both).
 */
const currentOf = (page: Page): Promise<{ count: number; index: number; noteFocused: boolean; marked: number; inView: boolean; bubbleInView: boolean }> => page.evaluate(() => {
  const notes = [...document.querySelectorAll(".chat-view .block-comment-row")];
  const current = notes.filter((note) => note.classList.contains("is-current"));
  const note = current[0];
  const registry = (CSS as unknown as { highlights?: { get(key: string): Iterable<Range> & { size: number } | undefined } }).highlights;
  const marks = registry?.get("block-comment-current");
  const range = marks === undefined ? undefined : [...marks][0];
  const view = document.querySelector(".chat-view")!.getBoundingClientRect();
  const box = range?.getBoundingClientRect();
  const bubble = note?.getBoundingClientRect();
  return {
    count: current.length,
    index: note === undefined ? -1 : notes.indexOf(note),
    noteFocused: note !== undefined && note === document.activeElement,
    marked: marks?.size ?? 0,
    inView: box !== undefined && box.height > 0 && box.top >= view.top - 1 && box.bottom <= view.bottom + 1,
    bubbleInView: bubble !== undefined && bubble.height > 0 && bubble.top >= view.top - 1 && bubble.bottom <= view.bottom + 1,
  };
});

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
  const origin = `http://127.0.0.1:${server.port}`;
  const url = `${origin}/?pane=${encodeURIComponent(pane)}`;
  const storeKey = `herdr-web-ui:block-comments:${pane}`;
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/opt/google/chrome/chrome", headless: true, args: ["--no-sandbox"] });
  const errors: string[] = [];
  /** Opens the pane's chat in a new context, with `comments` stored for it and `settings` set beforehand, and records every submitted text. `ready` is the paragraph that tells the reply is drawn. */
  const open = async (options: Parameters<NonNullable<typeof browser>["newContext"]>[0], comments?: unknown, settings: Record<string, unknown> = {}, ready = INTRO): Promise<{ page: Page; sent: string[] }> => {
    // evidence for a PR is drawn at twice the resolution; the layout is the same
    const context = await browser!.newContext({ deviceScaleFactor: evidence ? 2 : 1, ...options });
    await context.route("https://example.com/**", (route) => route.abort());
    const page = await context.newPage();
    await page.addInitScript(({ id, stored, preset }) => {
      localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en", ...preset }));
      localStorage.setItem(`herdr-web-ui:view:${id}`, "chat");
      if (stored !== undefined) localStorage.setItem(`herdr-web-ui:block-comments:${id}`, JSON.stringify(stored));
    }, { id: pane, stored: comments, preset: settings });
    page.setDefaultTimeout(10_000);
    page.on("pageerror", (error) => errors.push(error.message));
    const sent: string[] = [];
    page.on("websocket", (socket) => socket.on("framesent", ({ payload }) => {
      try {
        const frame = JSON.parse(String(payload));
        if (frame.type === "submit") sent.push(frame.text);
      } catch { /* not JSON */ }
    }));
    await page.goto(url);
    await page.locator(".conn-live").waitFor();
    await page.locator("p.is-commentable", { hasText: ready }).waitFor();
    return { page, sent };
  };

  // ── desktop ──
  {
    const { page, sent } = await open({ viewport: { width: 1280, height: 800 } });
    const intro = page.locator("p.is-commentable", { hasText: "Intro paragraph about the state." });
    const nested = page.locator(".markdown-list .markdown-list .markdown-item.is-commentable", { hasText: "check the logs" });
    const long = page.locator("p.is-commentable", { hasText: "A longer paragraph" });
    const code = page.locator(".markdown-block.is-commentable", { has: page.locator(".markdown-code") });
    const popover = popoverOf(page);
    const sheet = sheetOf(page);
    const field = popover.getByRole("textbox", { name: "Comment" });
    const message = page.getByRole("textbox", { name: "Message", exact: true });
    assert.equal(await page.locator(".chat-turn-user .is-commentable").count(), 0, "a user message is not commentable");
    // the controls row and the message's first line with no comment: they stay when the comments' bar comes, and when it goes
    const messageFree = await messageLayout(page);

    // a part has no button of its own and no hover: nothing of the old interface exists, and the pointer on a part lights nothing
    assert.equal(await staleOf(page).count(), 0, "no + , gutter class, chosen part, tile, pill or send count exists");
    await intro.hover();
    await frames(page);
    assert.equal(await intro.evaluate((node) => getComputedStyle(node).backgroundColor), "rgba(0, 0, 0, 0)", "a part under the pointer is not tinted");
    assert.equal(await staleOf(page).count(), 0, "hovering a part shows no +");
    assert.equal(await floatOf(page).count(), 0, "no Comment button without a selection");
    console.log("PASS desktop: nothing of the old + , hover or gutter exists, and a hovered part shows nothing");

    // a selection in the user's own message is not a comment; one in a reply is, once it ends, with a button above its end
    await select(page, page.locator(".chat-turn-user .chat-bubble"), "Show me");
    await frames(page, 4);
    assert.equal(await floatOf(page).count(), 0, "a selection in the user's message offers no Comment button");
    await select(page, long, "so its first line");
    await floatOf(page).waitFor();
    const above = await placementOf(page);
    assert.ok(above.button.bottom <= above.line.top, `with a mouse the button is above the selection's last line (button bottom ${above.button.bottom}px, line top ${above.line.top}px)`);
    assert.ok(insideView(above), `the button is inside the chat view: ${JSON.stringify(above)}`);
    assert.equal(await floatOf(page).innerText(), "Comment");
    if (evidence) await page.screenshot({ path: join(evidence, "block-comments-desktop-selection.png"), clip: { x: above.view.left, y: Math.max(0, above.line.top - 90), width: above.view.right - above.view.left, height: 200 } });
    await page.evaluate(() => window.getSelection()!.removeAllRanges());
    await floatOf(page).waitFor({ state: "detached" });
    console.log("PASS desktop: a selection in a reply shows the Comment button above it, inside the view; one in a user message does not; a collapsed selection takes it away");

    // a real drag, right to left over two lines: the button is at the release, above the line the pointer let go on
    await page.setViewportSize({ width: 700, height: 800 });
    const { release } = await drag(page, long, "runs across", "comment button sits.");
    await floatOf(page).waitFor();
    await frames(page);
    const dragged = await page.evaluate((point) => {
      const button = document.querySelector(".chat-view .comment-selection")!.getBoundingClientRect();
      const lines = [...window.getSelection()!.getRangeAt(0).getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
      const under = lines.filter((rect) => rect.top <= point.y && point.y <= rect.bottom).sort((a, b) => a.height - b.height)[0]!;
      return { centre: button.left + button.width / 2, bottom: button.bottom, underTop: under.top, lastTop: lines.at(-1)!.top };
    }, release);
    assert.ok(Math.abs(dragged.centre - release.x) <= 24, `the button is centred on the release (button centre ${dragged.centre}px, release ${release.x}px)`);
    assert.ok(dragged.bottom <= dragged.underTop, `the button is above the line the release is on (button bottom ${dragged.bottom}px, line top ${dragged.underTop}px)`);
    assert.ok(dragged.underTop < dragged.lastTop, `that line is not the selection's last line (${dragged.underTop}px, last ${dragged.lastTop}px): the button follows the pointer, not the selection's end`);
    // the same selection does not move the button
    const settled = await floatOf(page).boundingBox();
    await frames(page, 6);
    assert.deepEqual(await floatOf(page).boundingBox(), settled, "the button does not jump while the selection is unchanged");
    // 700px is a narrow window (768px or less): the editor is the modal with the quote, not the popover, and no selection is shown pending
    await floatOf(page).click();
    await sheet.waitFor();
    assert.equal(await popover.count(), 0, "a narrow window gets the modal, not the popover");
    assert.equal(await highlighted(page, "block-comment-pending"), 0, "the modal quotes the selection: nothing is highlighted as pending");
    assert.match(await sheet.locator(".comment-editor-plain").innerText(), /runs across[\s\S]*comment button sits\./);
    await sheet.getByRole("button", { name: "Cancel", exact: true }).click();
    await sheet.waitFor({ state: "hidden" });
    await page.evaluate(() => window.getSelection()!.removeAllRanges());
    await floatOf(page).waitFor({ state: "detached" });
    await page.setViewportSize({ width: 1280, height: 800 });
    console.log("PASS desktop: a mouse drag from right to left over two lines puts the Comment button at the release, above its line, and it stays put");

    // a real drag forward over two list items (one comment over both): the button follows the pointer, to the line it let go on in the second
    const list = page.locator(".markdown-list").first();
    const across = await drag(page, list, "Run the migration", "Restart the server", { forward: true });
    await floatOf(page).waitFor();
    await frames(page);
    const over = await page.evaluate((point) => {
      const button = document.querySelector(".chat-view .comment-selection")!.getBoundingClientRect();
      const lines = [...window.getSelection()!.getRangeAt(0).getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
      const under = lines.filter((rect) => rect.top <= point.y && point.y <= rect.bottom).sort((a, b) => a.height - b.height)[0]!;
      return { centre: button.left + button.width / 2, bottom: button.bottom, underTop: under.top, firstTop: lines[0]!.top };
    }, across.release);
    assert.ok(Math.abs(over.centre - across.release.x) <= 24, `the button is centred on the release (button centre ${over.centre}px, release ${across.release.x}px)`);
    assert.ok(over.underTop > over.firstTop, `the release is on a later line than the selection's first (${over.underTop}px, first ${over.firstTop}px)`);
    assert.ok(over.bottom <= over.underTop && over.underTop - over.bottom <= 24, `the button is just above the line the release is on, not the first item's (button bottom ${over.bottom}px, line top ${over.underTop}px)`);
    await page.evaluate(() => window.getSelection()!.removeAllRanges());
    await floatOf(page).waitFor({ state: "detached" });
    console.log("PASS desktop: a mouse drag over two list items puts the Comment button on the line under the release, in the second item");

    // the popover: with a mouse in a wide window a comment is written in a small card where the Comment button was, with no
    // quote; the selected text stays visible as the pending highlight
    await select(page, intro, "the state");
    await floatOf(page).waitFor();
    const buttonBox = (await floatOf(page).boundingBox())!;
    await floatOf(page).click();
    await popover.waitFor();
    await floatOf(page).waitFor({ state: "detached" });
    assert.equal(await sheet.count(), 0, "a mouse in a wide window gets the popover, not the modal");
    assert.equal(await popover.getAttribute("role"), "dialog");
    assert.equal(await popover.getAttribute("aria-label"), "Comment");
    assert.equal(await popover.getAttribute("aria-modal"), null, "the popover is not modal");
    assert.equal(await page.locator(".modal-scrim").count(), 0, "no scrim: the chat stays usable");
    assert.equal(await popover.locator(".comment-editor-plain, .comment-editor-block, .modal-title").count(), 0, "the popover quotes nothing: the selection is the highlight");
    assert.equal(await popover.getByRole("button", { name: "Delete", exact: true }).count(), 0, "a new comment has nothing to delete");
    await popover.getByRole("button", { name: "Cancel", exact: true }).waitFor();
    await popover.getByRole("button", { name: "Save", exact: true }).waitFor();
    await frames(page);
    const card = await popover.evaluate((node) => {
      const view = document.querySelector(".chat-view")!;
      const area = view.getBoundingClientRect();
      const box = node.getBoundingClientRect();
      return {
        left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width,
        absolute: getComputedStyle(node).position === "absolute",
        inView: node.parentElement === view,
        view: { left: area.left + view.clientLeft, right: area.left + view.clientLeft + view.clientWidth, top: area.top + view.clientTop, bottom: area.top + view.clientTop + view.clientHeight },
        space2: parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--space-2")),
      };
    });
    assert.ok(card.absolute && card.inView, "the popover is absolute inside the scrolling chat view, so it scrolls with the text");
    assert.ok(Math.abs(card.left - buttonBox.x) <= 2 && Math.abs(card.top - buttonBox.y) <= 2, `the popover's top-left is where the button's was (popover ${card.left},${card.top}px, button ${buttonBox.x},${buttonBox.y}px)`);
    assert.ok(Math.abs(card.width - Math.min(360, card.view.right - card.view.left - 2 * card.space2)) <= 1, `the popover is min(360px, the view's width minus 2 × --space-2) wide (${card.width}px)`);
    assert.ok(card.left >= card.view.left + card.space2 - 1 && card.right <= card.view.right - card.space2 + 1 && card.top >= card.view.top - 1 && card.bottom <= card.view.bottom + 1, `the popover lies inside the view: ${JSON.stringify(card)}`);
    // the selection shows as a highlight while the field has the browser's own selection
    assert.equal(await highlighted(page, "block-comment-pending"), 1, "the pending highlight holds the selected text while the popover is open");
    assert.deepEqual((await rangesOf(page, "block-comment-pending")).texts, ["the state"]);
    assert.equal(await highlighted(page), 1, "the base highlight (tint and underline) shows it too");
    await eventually("the field to have the focus, the caret at its end", () => field.evaluate((node) => node === document.activeElement && (node as HTMLTextAreaElement).selectionStart === (node as HTMLTextAreaElement).value.length));
    assert.equal(await field.getAttribute("placeholder"), "Write a comment…");
    // the field starts one line high, grows with what is typed, and scrolls past its cap; the popover grows away from its anchor
    const lineHeight = await field.evaluate((node) => parseFloat(getComputedStyle(node).lineHeight));
    const empty = (await field.boundingBox())!.height;
    const cardTop = (await popover.boundingBox())!.y;
    assert.ok(empty < 2 * lineHeight, `the empty field is one line high (${empty}px)`);
    await field.fill("one\ntwo\nthree");
    const three = (await field.boundingBox())!.height;
    assert.ok(three >= empty + 2 * lineHeight - 1, `three lines grow the field (${empty} → ${three}px)`);
    await frames(page, 2);
    assert.ok(Math.abs((await popover.boundingBox())!.y - cardTop) <= 1, "the popover grows away from its anchor: its top stays where it was");
    await field.fill(Array.from({ length: 20 }, (_, n) => `line ${n}`).join("\n"));
    const capped = await field.evaluate((node) => ({ height: node.getBoundingClientRect().height, scrolls: node.scrollHeight > node.clientHeight }));
    assert.ok(capped.height <= 4 * lineHeight + 20 && capped.scrolls, `twenty lines stop at four and scroll (${capped.height}px)`);
    await field.fill("Second thought");
    assert.ok((await field.boundingBox())!.height < 2 * lineHeight, "the field shrinks back with its text");
    if (evidence) {
      const box = (await popover.boundingBox())!;
      await page.screenshot({ path: join(evidence, "block-comments-popover.png"), clip: { x: Math.max(0, box.x - 40), y: Math.max(0, box.y - 60), width: Math.min(box.width + 80, 1280), height: box.height + 120 } });
    }
    console.log("PASS desktop: a new comment opens a popover where the button was, with no quote, the selection highlighted as pending, its field growing with its text up to a cap");
    // Cmd/Ctrl+Enter saves; the selection and the pending highlight go, and the focus goes to the composer
    await field.press("Control+Enter");
    await popover.waitFor({ state: "hidden" });
    await floatOf(page).waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => window.getSelection()!.isCollapsed), true, "saving a comment lets the selection go");
    assert.equal(await highlighted(page, "block-comment-pending"), 0, "the pending highlight goes with the popover");
    await eventually("the focus to go to the composer", () => page.evaluate(() => document.activeElement?.classList.contains("composer-text") === true));

    // the comments' bar comes below nothing (no file) above the message, and the controls and the first line keep their places
    await barOf(page).waitFor();
    await assertMessageLayout(page, messageFree, "with the comments' bar there");

    // a saved comment: the text highlighted, a speech bubble under its part with the comment only, the bar counting it
    await page.locator("p.is-commented", { hasText: "Intro paragraph" }).waitFor();
    assert.equal(await notesOf(page).count(), 1);
    assert.equal(await staleOf(page).count(), 0, "no excerpt is drawn in the bubble, and nothing of the old interface exists");
    assert.deepEqual(await noteTexts(page), ["Second thought"]);
    assert.deepEqual(await noteNames(page), ["Comment on “the state”: Second thought"], "the excerpt is in the bubble's name");
    assert.equal(await highlightMatchesNotes(page, "one comment"), 1);
    assert.deepEqual((await rangesOf(page, "block-comment")).texts, ["the state"]);
    assert.equal(await labelOf(page), "1 comment on the reply");
    await assertTail(notesOf(page).first(), intro, { text: "the state" }, "the first comment");
    await assertNoRail(page, "one comment");
    console.log("PASS desktop: saving makes a speech bubble with the comment, the text is highlighted, the bar counts it, nothing is drawn beside the text");

    // a second selection in the same paragraph is its own comment: two bubbles, in reading order whichever was written first
    assert.equal(await comment(page, intro, "Intro paragraph", "First thought"), "Intro paragraph");
    assert.equal(await page.locator("p.is-commented").count(), 1, "still one commented paragraph");
    assert.deepEqual(await noteTexts(page), ["First thought", "Second thought"], "the bubbles follow the text's order, not the order they were written in");
    assert.deepEqual(await noteNames(page), ["Comment on “Intro paragraph”: First thought", "Comment on “the state”: Second thought"]);
    assert.equal(await page.locator("p.is-commented + .block-comment-notes .block-comment-row").count(), 2, "both bubbles are in the paragraph's one group");
    assert.equal(await highlightMatchesNotes(page, "two comments in one paragraph"), 2);
    assert.equal(await labelOf(page), "2 comments on the reply");
    // each tail points at where its own text ends, though the first ends early in the line: the bubble moved right under it
    await assertTail(notesOf(page).nth(0), intro, { text: "Intro paragraph" }, "the first of two");
    await assertTail(notesOf(page).nth(1), intro, { text: "the state" }, "the second of two");
    await assertBubbleGroup(intro, "two bubbles under a paragraph");
    await assertBubbleLook(page, notesOf(page).first(), "the first bubble");
    console.log("PASS desktop: two selections in one paragraph are two comments and two bubbles, in reading order, each tail at its own highlight's end");

    // hovering a bubble brings its comment's text up (the active highlight), and leaving takes it down
    await notesOf(page).first().hover();
    await eventually("the active highlight to hold the hovered comment's text", async () => (await highlighted(page, "block-comment-active")) === 1);
    assert.deepEqual((await rangesOf(page, "block-comment-active")).texts, ["Intro paragraph"]);
    await page.mouse.move(1, 1);
    await eventually("the active highlight to empty", async () => (await highlighted(page, "block-comment-active")) === 0);
    console.log("PASS desktop: a hovered bubble strengthens its comment's highlight, and only its own");

    // Escape gives a new comment up: nothing is stored, the popover and the pending highlight go, the focus goes to the composer
    await select(page, long, "so its first line");
    await floatOf(page).waitFor();
    await floatOf(page).click();
    await popover.waitFor();
    await field.fill("not this");
    assert.equal(await highlighted(page, "block-comment-pending"), 1);
    // Escape pressed with the focus elsewhere (the message box) is not the popover's
    await message.focus();
    await page.keyboard.press("Escape");
    await frames(page, 3);
    assert.equal(await popover.count(), 1, "Escape outside the popover leaves it open");
    assert.equal(await field.inputValue(), "not this");
    await field.focus();
    await page.keyboard.press("Escape");
    await popover.waitFor({ state: "hidden" });
    assert.equal((await storedOf(page)).length, 2, "a comment given up is not stored");
    assert.equal(await highlighted(page, "block-comment-pending"), 0, "the pending highlight goes with the popover");
    await eventually("the focus to go to the composer", () => page.evaluate(() => document.activeElement?.classList.contains("composer-text") === true));
    console.log("PASS desktop: Escape from inside the popover gives the comment up; from outside it does not");

    // the same on a nested list item (its bubble sits in the item's own box), a code block and a longer paragraph
    assert.equal(await comment(page, nested, "check the logs", "Also the exit code"), "check the logs");
    assert.equal(await comment(page, code, "const a = 1", "Use let"), "const a = 1");
    assert.equal(await comment(page, long, "longer paragraph", "Temporary"), "longer paragraph");
    assert.equal(await page.locator(".is-commented").count(), 4);
    assert.equal(await notesOf(page).count(), 5);
    assert.deepEqual(await noteTexts(page), ["First thought", "Second thought", "Also the exit code", "Temporary", "Use let"]);
    assert.equal(await highlightMatchesNotes(page, "five comments"), 5);
    assert.equal(await staleOf(page).count(), 0);
    await assertNoRail(page, "five comments");

    // a bubble sits right under its part, inside its width, each tail at its highlight's end, whatever the kind of part
    await assertBubbleGroup(intro, "paragraph");
    await assertBubbleGroup(page.locator(".markdown-block.is-commented", { has: page.locator(".markdown-code") }), "code block");
    await assertTail(notesOf(page).nth(2), nested, { text: "check the logs" }, "a list item at depth 2");
    await assertTail(notesOf(page).nth(3), long, { text: "longer paragraph" }, "a long paragraph");
    await assertTail(notesOf(page).nth(4), code, { text: "const a = 1" }, "a code block");
    for (const [index, name] of ["Comment on “Intro paragraph”: First thought", "Comment on “the state”: Second thought", "Comment on “check the logs”: Also the exit code", "Comment on “longer paragraph”: Temporary", "Comment on “const a = 1”: Use let"].entries()) {
      assert.equal(await notesOf(page).nth(index).getAttribute("aria-label"), name);
    }
    console.log("PASS desktop: bubbles sit right under a paragraph, a list item and a code block, inside their width, each tail at its text's end");
    if (evidence) await page.screenshot({ path: join(evidence, "block-comments-desktop.png") });
    if (evidence) {
      // the composer as a whole: the context bar first in the box
      const card = (await page.locator(".composer").boundingBox())!;
      await page.screenshot({ path: join(evidence, "block-comments-desktop-composer.png"), clip: { x: card.x, y: Math.max(0, card.y - 8), width: card.width, height: card.height + 16 } });
    }

    // a click on a bubble edits its comment in the popover under it: no quote, Delete, the comment with the caret at its end
    const firstBubble = notesOf(page).first();
    await firstBubble.click();
    await popover.waitFor();
    assert.equal(await sheet.count(), 0, "a mouse in a wide window edits in the popover");
    await eventually("the field to hold the comment with the caret at its end", () => field.evaluate((node) => node === document.activeElement && (node as HTMLTextAreaElement).value === "First thought" && (node as HTMLTextAreaElement).selectionStart === 13));
    assert.equal(await popover.getByRole("button", { name: "Delete", exact: true }).count(), 1, "an existing comment can be deleted from its popover");
    assert.equal(await popover.locator(".comment-editor-plain, .comment-editor-block").count(), 0, "no quote here either");
    assert.equal(await highlighted(page, "block-comment-pending"), 0, "an edited comment has its own highlight: nothing is pending");
    const under = { bubble: (await firstBubble.boundingBox())!, card: (await popover.boundingBox())! };
    assert.ok(Math.abs(under.card.x - under.bubble.x) <= 2 && Math.abs(under.card.y - (under.bubble.y + under.bubble.height + 4)) <= 2, `the popover opens 4px under the bubble, left-aligned with it (bubble ${JSON.stringify(under.bubble)}, popover ${JSON.stringify(under.card)})`);
    // pressing the bubble of an untouched popover closes it, and once more opens it
    await firstBubble.click();
    await popover.waitFor({ state: "hidden" });
    await firstBubble.click();
    await popover.waitFor();
    await eventually("the field to hold the comment", async () => (await field.inputValue()) === "First thought");
    await field.fill("First thought, briefly");
    await popover.getByRole("button", { name: "Save", exact: true }).click();
    await popover.waitFor({ state: "hidden" });
    await eventually("the edited bubble", async () => (await noteTexts(page))[0] === "First thought, briefly");
    assert.equal((await noteNames(page))[0], "Comment on “Intro paragraph”: First thought, briefly");
    await eventually("the focus to go back to the bubble", () => firstBubble.evaluate((node) => node === document.activeElement));
    assert.equal(await highlightMatchesNotes(page, "after an edit"), 5);
    // Escape gives an edit up and the focus goes back to the bubble
    await firstBubble.click();
    await popover.waitFor();
    await field.fill("not kept");
    await page.keyboard.press("Escape");
    await popover.waitFor({ state: "hidden" });
    assert.equal((await noteTexts(page))[0], "First thought, briefly", "Escape gives the edit up");
    await eventually("the focus to go back to the bubble", () => firstBubble.evaluate((node) => node === document.activeElement));
    console.log("PASS desktop: a bubble opens the popover under it with Delete, a second press closes it, Save keeps the edit and Escape gives it up, the focus returns to the bubble");

    // a press outside closes the popover while nothing is typed; with text typed it stays, and so does the text
    const outside = page.locator(".chat-turn-user .chat-bubble");
    await firstBubble.click();
    await popover.waitFor();
    await outside.click();
    await popover.waitFor({ state: "hidden" });
    await firstBubble.click();
    await popover.waitFor();
    await field.fill("kept text");
    await outside.click();
    await frames(page, 3);
    assert.equal(await popover.count(), 1, "a press outside leaves a popover with text typed in it open");
    assert.equal(await field.inputValue(), "kept text", "nothing typed is lost");
    // a press on another bubble only puts the focus back in the field: the text stays and nothing else opens
    await notesOf(page).last().click();
    await frames(page, 3);
    assert.equal(await popover.count(), 1, "another bubble does not replace a popover with text in it");
    assert.equal(await field.inputValue(), "kept text");
    await eventually("the focus to go back to the field", () => field.evaluate((node) => node === document.activeElement));
    await popover.getByRole("button", { name: "Cancel", exact: true }).click();
    await popover.waitFor({ state: "hidden" });
    assert.equal((await noteTexts(page))[0], "First thought, briefly", "Cancel keeps the comment as it was");
    console.log("PASS desktop: a press outside closes an untouched popover and leaves one with text typed in it, text and all");

    // a narrow window (768px or less) opens the modal from a bubble too, with the quote; the popover is for a mouse in a wide window
    await page.setViewportSize({ width: 700, height: 800 });
    await firstBubble.click();
    await sheet.waitFor();
    assert.equal(await popover.count(), 0, "a narrow window gets the modal, not the popover");
    assert.equal(await sheet.locator(".comment-editor-plain").innerText(), "Intro paragraph");
    assert.equal(await sheet.getByRole("textbox", { name: "Comment" }).inputValue(), "First thought, briefly");
    await sheet.getByRole("button", { name: "Cancel", exact: true }).click();
    await sheet.waitFor({ state: "hidden" });
    await page.setViewportSize({ width: 1280, height: 800 });
    console.log("PASS desktop: in a window of 768px or less a bubble opens the modal with the quote");

    // the context bar: the box's first row, a count of the comments, no tile, no pill, no badge on Send
    const walk = walkOf(page);
    const bar = barOf(page);
    assert.equal(await walk.innerText(), "5 comments on the reply");
    assert.equal(await labelOf(page), "5 comments on the reply");
    assert.equal(await walk.getAttribute("title"), "5 comments on the reply\nGo to the next comment");
    assert.equal(await page.locator(".composer-controls .composer-comments-chip").count(), 0, "the control row holds no comment chip");
    assert.equal(await page.locator(".composer-attachments").count(), 0, "with no file there is no strip, and the comments are not in one");
    assert.equal(await bar.evaluate((node) => node.classList.contains("is-going")), true, "with an agent the comments go with the next message");
    const barBox = (await bar.boundingBox())!;
    const surfaceBox = (await page.locator(".composer-surface").boundingBox())!;
    const textBox = (await message.boundingBox())!;
    assert.ok(barBox.y >= surfaceBox.y - 1 && barBox.y + barBox.height <= textBox.y + 1, `with no file the bar is the box's first row, above the message (bar ${barBox.y}–${barBox.y + barBox.height}px, message from ${textBox.y}px)`);
    assertBarLayout(await barLayout(page), "desktop", { column: "--space-5", strip: false });
    const sendButton = page.getByRole("button", { name: /^Send message/ });
    assert.equal(await sendButton.getAttribute("title"), "Send message · Comments to send: 5");
    // going: an accent icon; the text is the text colour (the bar has no rail)
    const textColor = (): Promise<string> => walk.evaluate((node) => getComputedStyle(node).color);
    const goingText = await textColor();
    const goingIcon = await walk.locator("svg").evaluate((node) => getComputedStyle(node).color);
    // a slash command is not sent with comments: the bar says "waiting" in words (and dims), and goes back once the command is gone
    await message.fill("/help");
    await eventually("the bar to wait", () => bar.evaluate((node) => node.classList.contains("is-waiting")));
    assert.equal(await walk.innerText(), "5 comments waiting");
    assert.equal(await labelOf(page), "5 comments waiting. Comments stay here: they are not sent with a command.");
    assert.equal(await walk.getAttribute("title"), "5 comments waiting\nComments stay here: they are not sent with a command.\nGo to the next comment");
    assert.notEqual(await textColor(), goingText, "waiting, the text is dimmer");
    assert.notEqual(await walk.locator("svg").evaluate((node) => getComputedStyle(node).color), goingIcon, "waiting, the icon is not the accent");
    await message.fill("");
    await eventually("the bar to stop waiting", () => bar.evaluate((node) => !node.classList.contains("is-waiting")));
    assert.equal(await labelOf(page), "5 comments on the reply");
    assert.equal(await textColor(), goingText, "going again, the text colour is back");
    console.log("PASS desktop: the context bar is a box in the content column, counts the comments, says waiting in words for a command, and no tile, pill or send count exists");

    // with a file attached the bar is below its strip, not above it: the tiles first, then the box, then the message (a held upload keeps the tile)
    await page.route("**/api/pane/image", () => { /* never answered: the tile stays uploading until it is removed */ });
    await page.locator(".composer-surface input[type='file']").setInputFiles({ name: "shot.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==", "base64") });
    await page.locator(".composer-surface > .composer-attachments .composer-attachment").waitFor();
    await frames(page);
    assertBarLayout(await barLayout(page), "desktop with a file", { column: "--space-5", strip: true });
    await page.getByRole("button", { name: "Remove shot.png", exact: true }).click();
    await page.locator(".composer-surface > .composer-attachments").waitFor({ state: "detached" });
    await page.unroute("**/api/pane/image");
    await frames(page);
    assertBarLayout(await barLayout(page), "desktop, the file gone", { column: "--space-5", strip: false });
    console.log("PASS desktop: with a file the bar sits below the attachment strip, in the content column, and goes back to the card's top without it");

    // the bar walks to the bubbles, one per tap, round again; the bubble is current and focused, its text has the current highlight, and the view shows both
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1280, height: 380 });
    await page.locator(".chat-view").evaluate((node) => { node.scrollTop = 0; });
    assert.deepEqual(await currentOf(page), { count: 0, index: -1, noteFocused: false, marked: 0, inView: false, bubbleInView: false }, "no bubble is current before the walk");
    const stops = [0, 1, 2, 3, 4, 0];
    for (const [tap, index] of stops.entries()) {
      await walk.click();
      await eventually(`tap ${tap + 1} to mark bubble ${index} current, focus it and show its text and itself`, async () => {
        const now = await currentOf(page);
        return now.count === 1 && now.index === index && now.noteFocused && now.marked === 1 && now.inView && now.bubbleInView;
      });
    }
    // the current bubble: an accent border (its tail's too) and icon, the elevated fill kept, no tint
    const currentLook = await page.locator(".block-comment-row.is-current").evaluate(async (node) => {
      await Promise.all(node.getAnimations().map((animation) => animation.finished));
      const style = getComputedStyle(node);
      const probe = document.createElement("div");
      document.body.append(probe);
      const colour = (token: string): string => { probe.style.color = `var(${token})`; return getComputedStyle(probe).color; };
      probe.style.backgroundColor = "var(--bg-elevated)";
      const result = {
        border: style.borderTopColor, accent: colour("--accent"), edge: colour("--border"),
        background: style.backgroundColor, elevated: getComputedStyle(probe).backgroundColor,
        icon: getComputedStyle(node.querySelector("svg")!).color,
        tail: getComputedStyle(node, "::before").borderTopColor,
      };
      probe.remove();
      return result;
    });
    assert.equal(currentLook.border, currentLook.accent, "the current bubble's border is --accent");
    assert.notEqual(currentLook.border, currentLook.edge, "it is not the resting edge");
    assert.equal(currentLook.tail, currentLook.accent, "its tail follows");
    assert.equal(currentLook.icon, currentLook.accent, "its icon is --accent");
    assert.equal(currentLook.background, currentLook.elevated, "it keeps the elevated fill: no tint");
    // Escape on the focused note ends it (and the current highlight) and hands the focus back to the walk button, so the keyboard walks on from there
    const walkFocused = (): Promise<boolean> => walk.evaluate((node) => node === document.activeElement);
    await page.keyboard.press("Escape");
    await eventually("Escape to end the current note and its highlight", async () => { const now = await currentOf(page); return now.count === 0 && now.marked === 0; });
    await eventually("Escape to focus the walk button again", walkFocused);
    // the walk stopped at note 0 after the six taps, so the keyboard goes on with notes 1 and 2
    for (const index of [1, 2]) {
      await page.keyboard.press("Enter");
      await eventually(`Enter on the walk button to mark note ${index} current and focus it`, async () => { const now = await currentOf(page); return now.count === 1 && now.index === index && now.noteFocused && now.marked === 1; });
      await page.keyboard.press("Escape");
      await eventually(`Escape after the keyboard walk to focus the walk button again (step ${index})`, async () => (await currentOf(page)).count === 0 && (await walkFocused()));
    }
    // a click anywhere else ends it too
    await walk.click();
    await eventually("a note to be current again", async () => (await currentOf(page)).count === 1);
    await page.locator(".chat-turn-user .chat-bubble").click();
    await eventually("a click elsewhere to end the current note and its highlight", async () => { const now = await currentOf(page); return now.count === 0 && now.marked === 0; });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ reducedMotion: null });
    console.log("PASS desktop: the bar walks the chat one note per tap, marking the current note and its text, until Escape or a click elsewhere");

    // the popover of an existing comment: Delete is a quiet ghost button on the left, Save the primary one, and deleting leaves the focus on the message
    await page.locator(".block-comment-row", { hasText: "Temporary" }).click();
    await popover.waitFor();
    const del = popover.getByRole("button", { name: "Delete", exact: true });
    assert.equal(await del.evaluate((node) => node.classList.contains("btn-ghost") && !node.classList.contains("btn-danger")), true, "Delete is a ghost button");
    assert.equal(await popover.getByRole("button", { name: "Save", exact: true }).evaluate((node) => node.classList.contains("btn-primary")), true, "Save is the primary button");
    const footer = await popover.locator(".comment-popover-actions button").evaluateAll((nodes) => nodes.map((node) => ({ name: node.textContent, left: node.getBoundingClientRect().left })));
    assert.deepEqual(footer.map((button) => button.name), ["Delete", "Cancel", "Save"], "Delete, then Cancel and Save");
    assert.ok(footer[0]!.left < footer[1]!.left - 40, "Delete stands apart on the left");
    if (evidence) {
      const box = (await popover.boundingBox())!;
      await page.screenshot({ path: join(evidence, "block-comments-popover-edit.png"), clip: { x: Math.max(0, box.x - 40), y: Math.max(0, box.y - 80), width: Math.min(box.width + 80, 1280), height: box.height + 120 } });
    }
    // a danger button elsewhere (a confirm, Remove PC) stays one under the pointer, not the neutral grey of the others
    await page.evaluate(() => {
      const button = document.createElement("button");
      button.className = "btn btn-danger";
      button.id = "danger-probe";
      button.textContent = "Remove";
      button.style.cssText = "position:fixed;left:8px;top:8px;z-index:100000";
      document.body.append(button);
    });
    const probe = page.locator("#danger-probe");
    const rest = await probe.evaluate((node) => getComputedStyle(node).borderColor);
    await probe.hover();
    await eventually("the pointer to be on the danger button", () => probe.evaluate((node) => node.matches(":hover")));
    // let its transition finish before reading the colour
    await probe.evaluate((node) => Promise.all(node.getAnimations().map((animation) => animation.finished)).then(() => undefined));
    assert.equal(await probe.evaluate((node) => getComputedStyle(node).borderColor), rest, "a danger button keeps its danger border on hover");
    await probe.evaluate((node) => node.remove());
    await del.click();
    await popover.waitFor({ state: "hidden" });
    assert.equal(await labelOf(page), "4 comments on the reply");
    assert.equal(await highlightMatchesNotes(page, "after a delete"), 4);
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains("composer-text")), true, "deleting a comment from its popover leaves the focus on the message (the bubble is gone), not on the page");
    console.log("PASS desktop: edit and delete from the popover under a bubble");

    // the X takes every comment, and an undo stands in the bar's own place: same row, the focus on it, the notes and their highlight gone
    // from the chat; a click on it brings every note and the count back, and the focus goes back to the walk button
    const placeOf = (): Promise<{ x: number; y: number; width: number; height: number }> => bar.evaluate((node) => { const box = node.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height }; });
    const barBefore = await placeOf();
    const textsBefore = await noteTexts(page);
    assert.equal(textsBefore.length, 4);
    await removeOf(page).click();
    await eventually("the bar to turn into the undo", () => bar.evaluate((node) => node.classList.contains("is-undo")));
    await eventually("every note to leave the chat", async () => (await notesOf(page).count()) === 0 && (await page.locator(".is-commented, .is-current").count()) === 0);
    await eventually("the highlight to go with the notes", async () => (await highlighted(page)) === 0);
    const barAfter = await placeOf();
    for (const key of ["x", "y", "width", "height"] as const) assert.ok(Math.abs(barAfter[key] - barBefore[key]) <= 1, `the undo bar is in the bar's place (${key}: ${barBefore[key]} → ${barAfter[key]})`);
    assert.equal(await bar.locator(".composer-comments-text").innerText(), "Comments removed: 4");
    assert.equal(await undoOf(page).innerText(), "Undo");
    assert.equal(await removeOf(page).count(), 0, "the undo bar has no X");
    assert.equal(await walkOf(page).count(), 0, "the undo bar has no walk button");
    assert.equal(await undoOf(page).evaluate((node) => node.getAttribute("aria-describedby") === node.parentElement!.querySelector(".composer-comments-text")!.id), true, "the focus on Undo reads what was removed");
    await eventually("the focus to move to Undo", () => undoOf(page).evaluate((node) => node === document.activeElement));
    await undoOf(page).click();
    await eventually("every note to come back", async () => (await notesOf(page).count()) === 4);
    assert.deepEqual(await noteTexts(page), textsBefore, "the same notes, in the same order");
    assert.equal(await highlightMatchesNotes(page, "after the undo"), 4);
    assert.equal(await labelOf(page), "4 comments on the reply");
    assert.equal(await bar.evaluate((node) => node.classList.contains("is-undo")), false, "the walking bar is back");
    await assertMessageLayout(page, messageFree, "with the undo bar and the walking bar alike");
    await eventually("the focus to return to the walk button", () => walk.evaluate((node) => node === document.activeElement));
    console.log("PASS desktop: the bar's X turns it into an undo in the same place, and Undo brings every note and the highlight back");

    // the agent starts again while a comment is being written: the popover and the draft stay, and
    // the code block is not rebuilt as the reply turns live and final again
    await page.locator(".markdown-code").evaluate((node) => { (node as HTMLElement).dataset.kept = "yes"; });
    await select(page, intro, "about");
    await floatOf(page).waitFor();
    await floatOf(page).click();
    await popover.waitFor();
    await field.fill("half a thought");
    await herdrRpc("pane.report_agent", { pane_id: pane, source: "manual", agent: "codex", state: "working", agent_session_path: transcript });
    await page.locator(".chat-turn-agent .is-commentable").first().waitFor({ state: "detached" });
    assert.equal(await field.inputValue(), "half a thought", "the draft survives the reply turning live");
    await popover.getByRole("button", { name: "Cancel", exact: true }).click();
    await popover.waitFor({ state: "hidden" });
    await herdrRpc("pane.report_agent", { pane_id: pane, source: "manual", agent: "codex", state: "idle", agent_session_path: transcript });
    await page.locator("p.is-commentable", { hasText: "Intro paragraph" }).waitFor();
    assert.equal(await page.locator(".markdown-code").evaluate((node) => (node as HTMLElement).dataset.kept), "yes", "the code block is the same element after live and back");
    assert.equal(await highlightMatchesNotes(page, "after the reply turned live and final again"), 4);
    assert.equal(await notesOf(page).count(), 4);
    console.log("PASS desktop: a reply turning live keeps the open popover, its code block and the highlights");

    // a narrow window: the button of a selection at a line's right end still lies inside the view
    await page.setViewportSize({ width: 820, height: 800 });
    await select(page, long, "right edge where the comment button sits.");
    await floatOf(page).waitFor();
    const narrow = await placementOf(page);
    assert.ok(insideView(narrow), `the button stays inside a narrow view: ${JSON.stringify(narrow)}`);
    await page.evaluate(() => window.getSelection()!.removeAllRanges());
    await floatOf(page).waitFor({ state: "detached" });
    await page.setViewportSize({ width: 1280, height: 800 });
    console.log("PASS desktop: in a narrow window the button stays inside the view");

    await page.reload();
    await page.locator(".conn-live").waitFor();
    await page.locator("p.is-commented").first().waitFor();
    assert.equal(await labelOf(page), "4 comments on the reply");
    assert.equal(await page.locator(".is-commented").count(), 3);
    assert.equal(await notesOf(page).count(), 4);
    assert.equal(await highlightMatchesNotes(page, "after a reload"), 4);
    await assertTail(notesOf(page).first(), intro, { text: "Intro paragraph" }, "after a reload");
    await assertNoRail(page, "after a reload");
    console.log("PASS desktop: comments, their highlights and their bubbles' tails survive a reload");

    await message.fill("Thanks");
    await sendButton.click();
    await bar.waitFor({ state: "detached" });
    assert.equal(await page.locator(".is-commented").count(), 0);
    assert.equal(await highlighted(page), 0, "sent comments leave no highlight");
    assert.equal(await page.locator(".composer-attachments").count(), 0);
    assert.ok(sent.some((text) => text === "> Intro paragraph\nFirst thought, briefly\n\n> the state\nSecond thought\n\n> check the logs\nAlso the exit code\n\n> const a = 1\nUse let\n\nThanks"), `sent: ${JSON.stringify(sent)}`);
    console.log("PASS desktop: send carries each comment's selected text quoted, in reading order, then clears them");

    // an undo left alone expires (10 s, a bounded poll with a longer deadline): the comments stay gone, and the box has the focus
    await comment(page, intro, "Intro paragraph", "One more");
    await comment(page, long, "longer paragraph", "And another");
    await eventually("both comments to be counted", async () => (await labelOf(page)) === "2 comments on the reply");
    await removeOf(page).click();
    await eventually("the undo", () => bar.evaluate((node) => node.classList.contains("is-undo")));
    await eventually("the undo to expire", async () => (await bar.count()) === 0, 15000);
    assert.equal(await notesOf(page).count(), 0, "the comments stay gone after the undo expired");
    assert.equal(await page.locator(".composer-attachments").count(), 0, "no strip is left behind");
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains("composer-text")), true, "the undo had the focus: the message box takes it when it expires");
    await assertMessageLayout(page, messageFree, "after the bar is gone");
    console.log("PASS desktop: an unused undo expires after 10 s and the comments stay gone");
    await page.context().close();
  }

  // ── a selection over several parts is ONE comment: highlighted in every part, quoted whole, its bubble under the last part ──
  {
    const { page, sent } = await open({ viewport: { width: 1280, height: 800 } });
    const popover = popoverOf(page);
    const field = popover.getByRole("textbox", { name: "Comment" });
    const message = page.getByRole("textbox", { name: "Message", exact: true });
    const intro = page.locator("p.is-commentable", { hasText: INTRO });
    const second = page.locator(".markdown-item.is-commentable", { hasText: "Restart the server" });
    const middle = page.locator(".markdown-item.is-commentable", { hasText: "Run the migration" });
    const long = page.locator("p.is-commentable", { hasText: "A longer paragraph" });
    /** Whether the part's next sibling is a group of bubbles: its own bubbles hang there. */
    const hasGroup = (part: Locator): Promise<boolean> => part.evaluate((node) => node.nextElementSibling?.classList.contains("block-comment-notes") ?? false);

    // a triple click selects a paragraph and runs on to the start of the next part: still a comment on that one paragraph
    await long.click({ clickCount: 3, position: { x: 40, y: 10 } });
    await floatOf(page).waitFor();
    await floatOf(page).click();
    await popover.waitFor();
    assert.deepEqual((await rangesOf(page, "block-comment-pending")).texts, [LONG_PARAGRAPH], "a triple click falls back to the paragraph it started in: one pending range");
    await field.fill("Whole paragraph");
    await popover.getByRole("button", { name: "Save", exact: true }).click();
    await popover.waitFor({ state: "hidden" });
    const whole = (await storedOf(page)).find((entry) => entry.comment === "Whole paragraph")!;
    assert.equal(whole.until, undefined, "a triple click's end, at the start of the next part, makes no end part");
    assert.equal(whole.quote, LONG_PARAGRAPH);
    assert.deepEqual(whole.range, [0, LONG_PARAGRAPH.length]);
    assert.equal(await page.locator(".is-commented").count(), 1, "only the paragraph is commented");
    assert.equal(await hasGroup(long), true, "its bubble hangs under it");
    await assertTail(notesOf(page).first(), long, { text: "button sits." }, "a triple-clicked paragraph");
    console.log("PASS desktop: a triple click on a paragraph is a comment on that paragraph alone");

    // one selection from the middle of the intro over the first list item, to the start of the second item: one comment
    await selectSpan(page, intro, "about", second, "Restart");
    await floatOf(page).waitFor();
    const lines = await page.evaluate(() => window.getSelection()!.toString());
    assert.match(lines, /about the state\.[\s\S]*Run the migration[\s\S]*Restart/, "the selection spans three parts");
    await floatOf(page).click();
    await popover.waitFor();
    const pending = await rangesOf(page, "block-comment-pending");
    assert.deepEqual([...pending.texts].sort(), ["Restart", "Run the migration", "about the state."].sort(), "the pending highlight: the paragraph from the start, the item whole, the second item up to the end");
    assert.deepEqual(pending.withinPart, [true, true, true], "each pending range lies in one part");
    assert.equal(pending.paintsBubbles, false, "no pending range takes in a group of bubbles");
    assert.equal(await highlighted(page), 4, "the base highlight: the paragraph's comment and the three segments");
    if (evidence) await page.screenshot({ path: join(evidence, "block-comments-desktop-spanning.png") });
    await field.fill("Spans parts");
    await popover.getByRole("button", { name: "Save", exact: true }).click();
    await popover.waitFor({ state: "hidden" });
    await assertNoRail(page, "a spanning comment");
    // one comment: its quote is every part's selected text, its range is in the first part, its end in the last
    const spanning = (await storedOf(page)).find((entry) => entry.comment === "Spans parts")!;
    assert.deepEqual(spanning.quote?.split("\n"), ["about the state.", "Run the migration", "Restart"], "the quote is the whole selection, one line break between the parts");
    assert.deepEqual(spanning.range, [INTRO.indexOf("about"), INTRO.length], "the range is in the first part, to its end");
    assert.equal(spanning.until?.end, "Restart".length, "the end part is the second item, up to the end of the selection");
    assert.equal((await storedOf(page)).length, 2, "one comment for the whole selection");
    // the bubble hangs under the last part; the parts covered all count as commented, and none of the highlights crosses a part
    assert.equal(await notesOf(page).count(), 2);
    assert.equal(await second.locator(".block-comment-notes .block-comment-row").count(), 1, "the bubble hangs under the part where the selection ends");
    assert.equal(await middle.locator(".block-comment-notes").count(), 0, "a part in between has no bubble");
    assert.equal(await hasGroup(intro), false, "the part where it starts has none of its own");
    assert.equal(await page.locator(".is-commented").count(), 4, "the paragraph, both items and the long paragraph are commented");
    assert.equal(await highlightMatchesNotes(page, "a spanning comment and a single one", 4), 2);
    const saved = await rangesOf(page, "block-comment");
    assert.deepEqual([...saved.texts].sort(), [LONG_PARAGRAPH, "Restart", "Run the migration", "about the state."].sort());
    assert.ok(saved.withinPart.every(Boolean), "each range lies in one part");
    assert.equal(saved.paintsBubbles, false, "no range takes in a group of bubbles");
    assert.deepEqual(await noteTexts(page), ["Spans parts", "Whole paragraph"], "the spanning comment sorts by where it starts");
    const names = await noteNames(page);
    assert.ok(names[0]!.startsWith("Comment on “about the state. Run the migr") && names[0]!.endsWith("…”: Spans parts"), `the name of the spanning bubble carries an excerpt of the whole selection: ${names[0]}`);
    await assertTail(notesOf(page).first(), second, { text: "Restart" }, "the spanning comment, under the last part");
    await assertBubbleLook(page, notesOf(page).first(), "the spanning bubble");
    assert.equal(await labelOf(page), "2 comments on the reply");
    // hovering its bubble strengthens all three segments
    await notesOf(page).first().hover();
    await eventually("the active highlight to hold the three segments", async () => (await highlighted(page, "block-comment-active")) === 3);
    await page.mouse.move(1, 1);
    await eventually("the active highlight to empty", async () => (await highlighted(page, "block-comment-active")) === 0);
    console.log("PASS desktop: a selection over a paragraph and two list items is one comment, highlighted in each part, with its bubble and tail under the last");

    // its bubble edits it in the popover; the walk stops on it, marking all three segments, with the bubble in view
    await notesOf(page).first().click();
    await popover.waitFor();
    await eventually("the field to hold the comment", async () => (await field.inputValue()) === "Spans parts");
    assert.equal(await highlighted(page, "block-comment-pending"), 0, "an edit has its comment's own highlight");
    await popover.getByRole("button", { name: "Cancel", exact: true }).click();
    await popover.waitFor({ state: "hidden" });
    await walkOf(page).click();
    await eventually("the walk to stand on the spanning comment: its three segments current, its bubble focused and in view", async () => {
      const now = await currentOf(page);
      return now.count === 1 && now.index === 0 && now.noteFocused && now.marked === 3 && now.inView && now.bubbleInView;
    });
    await walkOf(page).click();
    await eventually("the walk to go on to the paragraph's comment", async () => { const now = await currentOf(page); return now.count === 1 && now.index === 1 && now.noteFocused && now.marked === 1 && now.bubbleInView; });
    await page.keyboard.press("Escape");
    console.log("PASS desktop: a spanning comment edits from its bubble, and the walk marks all its parts and shows its bubble");

    await page.reload();
    await page.locator(".conn-live").waitFor();
    await page.locator("p.is-commented").first().waitFor();
    assert.equal(await notesOf(page).count(), 2);
    assert.equal(await second.locator(".block-comment-notes .block-comment-row").count(), 1, "after a reload the bubble is under the last part again");
    assert.equal(await highlightMatchesNotes(page, "after a reload", 4), 2);
    await assertTail(notesOf(page).first(), second, { text: "Restart" }, "after a reload");
    const stored = JSON.parse((await page.evaluate((key) => localStorage.getItem(key), storeKey))!) as { version: number; comments: StoredComment[] };
    console.log("PASS desktop: a spanning comment survives a reload under its last part");

    // sent in reading order: the spanning comment first (it starts in the intro), every part's line quoted
    await message.fill("Thanks");
    await page.getByRole("button", { name: /^Send message/ }).click();
    await barOf(page).waitFor({ state: "detached" });
    assert.ok(sent.some((text) => text === `> about the state.\n> Run the migration\n> Restart\nSpans parts\n\n> ${LONG_PARAGRAPH}\nWhole paragraph\n\nThanks`), `sent: ${JSON.stringify(sent)}`);
    console.log("PASS desktop: the message quotes every part of a spanning selection, a > before each line");
    await page.context().close();

    // the last part changed (the reply was written again): the bubble moves under the first part and the highlight is clamped to it
    writeTranscript(ANSWER.replace("2. Restart the server", "2. Restart it"));
    {
      const changed = await open({ viewport: { width: 1280, height: 800 } }, stored);
      await changed.page.locator("p.is-commented").first().waitFor();
      const here = changed.page.locator("p.is-commentable", { hasText: INTRO });
      assert.equal(await here.evaluate((node) => node.nextElementSibling?.querySelectorAll(".block-comment-row").length ?? 0), 1, "the bubble moved under the first part");
      assert.deepEqual(await noteTexts(changed.page), ["Spans parts", "Whole paragraph"]);
      assert.equal(await changed.page.locator(".markdown-item.is-commented").count(), 0, "the items are not covered any more");
      await highlightMatchesNotes(changed.page, "a spanning comment whose last part changed", 2);
      assert.deepEqual([...(await rangesOf(changed.page, "block-comment")).texts].sort(), [LONG_PARAGRAPH, "about the state."].sort(), "the highlight is clamped to the first part, from where the selection starts");
      await assertTail(notesOf(changed.page).first(), here, { text: "about the state." }, "a comment whose last part changed");
      console.log("PASS desktop: a spanning comment whose last part changed hangs under its first part, highlighted there only");
      await changed.page.context().close();
    }
    writeTranscript(ANSWER);

    // a comment of an earlier version made from it (on the first part as a whole, no end part): the transform strips a spanning anchor too
    {
      const old = await open({ viewport: { width: 1280, height: 800 } }, legacyOf(stored, "Spans parts"));
      await old.page.locator("p.is-commented").first().waitFor();
      const here = old.page.locator("p.is-commentable", { hasText: INTRO });
      assert.deepEqual(await noteTexts(old.page), ["Spans parts", "Whole paragraph"]);
      assert.equal(await old.page.locator(".markdown-item.is-commented").count(), 0, "a comment on a whole part covers only that part");
      assert.equal(await notesOf(old.page).first().getAttribute("aria-label"), null, "a comment on a whole part has its text as its name");
      await highlightMatchesNotes(old.page, "an earlier version's comment", 2);
      assert.deepEqual([...(await rangesOf(old.page, "block-comment")).texts].sort(), [INTRO, LONG_PARAGRAPH].sort(), "it highlights its whole part");
      await assertTail(notesOf(old.page).first(), here, "text start", "a comment on a whole part");
      console.log("PASS desktop: an earlier version's comment highlights its whole part, its tail a little in from the text's start");
      await old.page.context().close();
    }
  }

  // ── formulas: a selection in one is highlighted whole, and its bubble's tail points at its glyphs ──
  {
    writeTranscript(MATH_ANSWER);
    const { page } = await open({ viewport: { width: 1280, height: 800 } }, undefined, {}, "Energy relates to mass");
    const popover = popoverOf(page);
    const field = popover.getByRole("textbox", { name: "Comment" });
    const inline = page.locator("p.is-commentable", { hasText: "Energy relates to mass" });
    const display = page.locator(".markdown-block.is-commentable", { has: page.locator(".markdown-math-display") });
    /** Presses inside the formula at its left, drags to its right and lets go: a selection that starts and ends inside it. */
    const dragInside = async (formula: Locator): Promise<void> => {
      const box = (await formula.boundingBox())!;
      const y = box.y + box.height / 2;
      await page.mouse.move(box.x + 2, y);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width - 2, y, { steps: 8 });
      await page.mouse.up();
    };
    /** Whether some range of the named highlight reaches over the whole box of `formula` (its glyphs, not only its hidden MathML). */
    const covers = async (name: string, formula: Locator): Promise<boolean> => {
      const box = (await formula.boundingBox())!;
      const boxes = await page.evaluate((highlight) => {
        const registry = (CSS as unknown as { highlights?: { get(key: string): Iterable<Range> | undefined } }).highlights;
        return [...(registry?.get(highlight) ?? [])].map((range) => { const rect = range.getBoundingClientRect(); return { left: rect.left, right: rect.right }; });
      }, name);
      return boxes.some((found) => found.left <= box.x + 2 && found.right >= box.x + box.width - 2);
    };

    // a selection over text and a formula: the button is on its line, inside the view, above it
    await select(page, inline, "relates to mass", " in a vacuum");
    await floatOf(page).waitFor();
    const over = await placementOf(page);
    assert.ok(insideView(over), `the button is inside the view: ${JSON.stringify(over)}`);
    assert.ok(over.button.bottom <= over.line.top, `the button is above the selection's last line, after the formula (button bottom ${over.button.bottom}px, line top ${over.line.top}px)`);
    await page.evaluate(() => window.getSelection()!.removeAllRanges());
    await floatOf(page).waitFor({ state: "detached" });

    // a drag inside an inline formula: the whole formula is the comment's text
    await dragInside(inline.locator(".katex"));
    await floatOf(page).waitFor();
    assert.ok(insideView(await placementOf(page)), "the button for a selection in a formula is inside the view");
    await floatOf(page).click();
    await popover.waitFor();
    assert.equal(await highlighted(page, "block-comment-pending"), 1);
    assert.equal(await covers("block-comment-pending", inline.locator(".katex")), true, "the pending highlight covers the inline formula whole");
    await field.fill("Which units?");
    await popover.getByRole("button", { name: "Save", exact: true }).click();
    await popover.waitFor({ state: "hidden" });
    assert.equal(await highlightMatchesNotes(page, "an inline formula"), 1);
    assert.equal(await covers("block-comment", inline.locator(".katex")), true, "the highlight covers the inline formula whole");
    await assertTail(notesOf(page).first(), inline, "formula end", "an inline formula");
    console.log("PASS desktop: a selection in an inline formula highlights it whole, and the bubble's tail points at its right edge");

    // a drag inside a display formula, then the same comment as an earlier version stored it (the whole part)
    await dragInside(display.locator(".katex"));
    await floatOf(page).waitFor();
    await floatOf(page).click();
    await popover.waitFor();
    await field.fill("Check the square");
    await popover.getByRole("button", { name: "Save", exact: true }).click();
    await popover.waitFor({ state: "hidden" });
    assert.equal(await highlightMatchesNotes(page, "a display formula"), 2);
    assert.equal(await covers("block-comment", display.locator(".katex")), true, "the highlight covers the display formula whole");
    await assertTail(notesOf(page).nth(1), display, "formula end", "a display formula, which is not a whole line wide for the tail");
    await makeLegacy(page, storeKey, "Check the square");
    await page.reload();
    await page.locator(".conn-live").waitFor();
    await page.locator("p.is-commented").first().waitFor();
    assert.equal(await highlightMatchesNotes(page, "after the display comment turned into a whole-part one"), 2);
    assert.equal(await covers("block-comment", display.locator(".katex")), true, "a comment on a whole display formula highlights it whole");
    await assertTail(notesOf(page).nth(1), display, "formula start", "a whole display formula, its tail in from the formula's left edge");
    console.log("PASS desktop: a display formula is highlighted whole, selected or as a whole part, its tail at the formula's glyphs");
    await page.context().close();
    writeTranscript(ANSWER);
  }

  // ── desktop, Chat width Full: the column fills the view, and the button stays inside it ──
  {
    const { page } = await open({ viewport: { width: 1280, height: 800 } }, undefined, { chatWidth: "full" });
    await eventually("the layout to settle", () => page.evaluate(() => document.documentElement.dataset["chatWidth"] === "full"));
    const parts: [Locator, string][] = [
      [page.locator("p.is-commentable", { hasText: "Intro paragraph about the state." }), "the state."],
      [page.locator("p.is-commentable", { hasText: "A longer paragraph" }), "button sits."],
      [page.locator(".markdown-list .markdown-list .markdown-item.is-commentable", { hasText: "check the logs" }), "the logs"],
      [page.locator(".markdown-block.is-commentable", { has: page.locator(".markdown-code") }), "const a = 1;"],
    ];
    for (const [part, tail] of parts) {
      // the end of the text is where the button centres: at Full it is the view's right edge that clamps it
      await select(page, part, tail);
      await floatOf(page).waitFor();
      const placed = await placementOf(page);
      assert.ok(insideView(placed), `at Full the button for "${tail}" lies outside the view: ${JSON.stringify(placed)}`);
      await page.evaluate(() => window.getSelection()!.removeAllRanges());
      await floatOf(page).waitFor({ state: "detached" });
    }
    console.log("PASS desktop: Chat width Full, the Comment button lies inside the view for every kind of part");
    await page.context().close();
  }

  // ── a message queued while the agent works: its comments are held apart from the typed text ──
  {
    const quote = (text: string) => ({ type: "paragraph", lines: [[{ type: "text", value: text }]] });
    // comments of the earlier kind (no selection quote) whose block is not in the chat: they are stops of the bar's walk
    const stored = {
      version: 1,
      comments: [
        { id: "held-1", anchor: "held:0:0", order: [1, 0, 0], comment: "First thought", block: quote("Quoted one.") },
        { id: "held-2", anchor: "held:0:1", order: [1, 0, 1], comment: "Second thought", block: quote("Quoted two.") },
      ],
    };
    const { page, sent } = await open({ viewport: { width: 1280, height: 800 } }, stored);
    await eventually("the context bar", async () => (await barOf(page).count()) === 1);
    assert.equal(await labelOf(page), "2 comments on the reply");
    await herdrRpc("pane.report_agent", { pane_id: pane, source: "manual", agent: "codex", state: "working", agent_session_path: transcript });
    const message = page.getByRole("textbox", { name: "Message", exact: true });
    await message.fill("Remember the exit code");
    const queueButton = page.getByRole("button", { name: /^Queue message/ });
    await queueButton.waitFor();
    assert.equal(await queueButton.getAttribute("aria-label"), "Queue message · Comments to send: 2");
    await queueButton.click();
    const held = page.locator(".composer-queue-item");
    await held.waitFor();
    const heldText = held.locator(".composer-queue-text");
    assert.equal(await heldText.inputValue(), "Remember the exit code", "the held row holds only the typed text");
    assert.equal(await held.locator(".composer-queue-comments").innerText(), "2", "the held row's chip counts its comments");
    assert.equal(await held.locator("button.composer-queue-comments").count(), 0, "the held chip only informs: it is no button");
    await barOf(page).waitFor({ state: "detached" });
    // the comments are a snapshot beside the text: with the text cleared the row is comments only, and still sendable
    const sendNow = held.getByRole("button", { name: "Send now", exact: true });
    await heldText.fill("");
    assert.equal(await heldText.getAttribute("placeholder"), "Comments only");
    assert.equal(await heldText.inputValue(), "", "clearing the text leaves the comments out of the box");
    assert.equal(await held.locator(".composer-queue-comments").innerText(), "2");
    await eventually("Send now enabled", () => sendNow.isEnabled());
    console.log("PASS desktop: a held message keeps its comments apart, its text box shows only the typed text, and Send now stays enabled");

    // Send now sends the comments composed with the text, so a text too long for that is refused, nothing sent
    const max = await heldText.evaluate((node) => (node as HTMLTextAreaElement).maxLength);
    assert.ok(max > 0, "the held text box has a cap");
    await heldText.fill("x".repeat(max - 10));
    const before = sent.length;
    await sendNow.click();
    await held.locator(".composer-queue-error").waitFor();
    assert.equal(await held.locator(".composer-queue-error").innerText(), "Too long to send. Shorten the message or remove comments.");
    assert.equal(sent.length, before, "a message too long with its comments is not sent");
    assert.equal(await page.locator(".composer-queue-item").count(), 1, "the refused message stays held");
    console.log("PASS desktop: Send now refuses a message that is too long with its comments, and sends nothing");
    await held.getByRole("button", { name: "Discard", exact: true }).click();
    await held.waitFor({ state: "detached" });
    await herdrRpc("pane.report_agent", { pane_id: pane, source: "manual", agent: "codex", state: "idle", agent_session_path: transcript });
    await page.context().close();
  }

  // ── phone: a long press selects, the button is below the selection, the bar is a finger's size ──
  {
    const { page } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    assert.equal(await page.evaluate(() => matchMedia("(hover: none)").matches && matchMedia("(pointer: coarse)").matches), true, "the phone context has no hover and a coarse pointer");
    const item = page.locator(".markdown-item.is-commentable", { hasText: "Run the migration" });
    const second = page.locator(".markdown-list .markdown-list .markdown-item.is-commentable", { hasText: "check the logs" });
    const editor = sheetOf(page);
    const bar = barOf(page);
    const walk = walkOf(page);
    const touchTarget = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--touch-target")));
    // the controls row and the message's first line with no comment: the bar comes and goes without moving them
    const messageFree = await messageLayout(page);

    // a tap chooses nothing any more: no tint, no button, no +
    await item.tap();
    await frames(page);
    assert.equal(await floatOf(page).count(), 0, "a tap on a part shows no Comment button");
    assert.equal(await staleOf(page).count(), 0, "a tap on a part chooses nothing and shows no +");
    assert.equal(await item.evaluate((node) => getComputedStyle(node).backgroundColor), "rgba(0, 0, 0, 0)", "a tapped part is not tinted");

    // a selection: the button is below its last line (the OS menu and handles are above and around it), inside the view, a finger tall
    await select(page, item, "the migration");
    await floatOf(page).waitFor();
    const below = await placementOf(page);
    assert.ok(below.button.top >= below.line.bottom, `on a touch screen the button is below the selection's last line (button top ${below.button.top}px, line bottom ${below.line.bottom}px)`);
    assert.ok(insideView(below), `the button is inside the chat view: ${JSON.stringify(below)}`);
    assert.ok(below.button.height >= touchTarget - 1, `the button is a finger tall (${below.button.height}px, wanted ${touchTarget}px)`);
    if (evidence) await page.screenshot({ path: join(evidence, "block-comments-phone-selection.png"), clip: { x: 0, y: Math.max(0, below.line.top - 80), width: 390, height: 200 } });
    await floatOf(page).tap();
    await editor.waitFor();
    const fits = await editor.evaluate((node) => node.getBoundingClientRect().bottom <= (window.visualViewport?.height ?? window.innerHeight) + 1);
    assert.ok(fits, "the editor sits inside the visible viewport");
    assert.equal(await editor.locator(".comment-editor-plain").innerText(), "the migration");
    // a phone keeps the modal, a bottom sheet with the quote: no popover, and no selection shown as pending
    assert.equal(await popoverOf(page).count(), 0, "a touch screen gets the sheet, not the popover");
    assert.equal(await highlighted(page, "block-comment-pending"), 0, "the sheet quotes the selection: nothing is highlighted as pending");
    assert.equal(await editor.getAttribute("aria-modal"), "true", "the sheet is modal");
    // taps inside the editor stay inside it
    await editor.locator(".modal-title").tap();
    await editor.locator(".comment-editor-block").tap();
    await frames(page);
    assert.equal(await staleOf(page).count(), 0, "a tap inside the editor chooses nothing");
    if (evidence) await page.screenshot({ path: join(evidence, "block-comments-phone-editor.png") });
    await editor.getByRole("button", { name: "Cancel", exact: true }).tap();
    await editor.waitFor({ state: "hidden" });
    assert.equal(await bar.count(), 0, "a cancelled comment is no comment");
    console.log("PASS phone: a selection shows the Comment button below it, a finger tall and inside the view; a tap on a part does nothing; the editor sits above the fold");

    // a comment, and the bar: the count, an X a finger can press; no rail, tile or pill
    assert.equal(await comment(page, item, "the migration", "On a phone", { touch: true }), "the migration");
    assert.equal(await labelOf(page), "1 comment on the reply");
    await assertMessageLayout(page, messageFree, "with the comments' bar there");
    // the bubble: the comment only, a tail at the end of the highlight, its name with the excerpt
    assert.deepEqual(await noteTexts(page), ["On a phone"]);
    assert.deepEqual(await noteNames(page), ["Comment on “the migration”: On a phone"]);
    await assertTail(notesOf(page).first(), item, { text: "the migration" }, "on a phone");
    await assertNoRail(page, "on a phone");
    const xBox = (await removeOf(page).boundingBox())!;
    assert.ok(xBox.width >= touchTarget && xBox.height >= touchTarget, `the bar's X is a finger's size (${xBox.width} × ${xBox.height}px, wanted ${touchTarget}px)`);
    const walkBox = (await walk.boundingBox())!;
    const barBox = (await bar.boundingBox())!;
    assert.ok(barBox.height >= touchTarget - 1, `the bar is a finger tall (${barBox.height}px, wanted ${touchTarget}px)`);
    assert.ok(walkBox.height >= touchTarget - 1, `the walk button is a finger tall (${walkBox.height}px, wanted ${touchTarget}px)`);
    assertBarLayout(await barLayout(page), "phone", { column: "--space-4", strip: false });
    assert.equal(await staleOf(page).count(), 0);
    assert.equal(await page.locator(".composer-controls .composer-comments-chip").count(), 0, "the control row holds no comment chip");
    const boxBefore = (await page.locator(".composer").boundingBox())!.height;
    assert.equal(await comment(page, second, "the logs", "A second one", { touch: true }), "the logs");
    assert.equal(await labelOf(page), "2 comments on the reply");
    assert.ok(Math.abs((await page.locator(".composer").boundingBox())!.height - boxBefore) <= 1, "a second comment does not grow the composer");
    assert.equal(await highlightMatchesNotes(page, "on the phone"), 2);
    // the bar fits the card at 390px: no sideways overflow of the bar either
    assert.ok(await bar.evaluate((node) => node.scrollWidth <= node.clientWidth + 1), "the bar fits the phone's width");

    // a tap walks to the first note and marks it current, its text highlighted; a second tap moves on
    await walk.tap();
    await eventually("the first tap to mark one bubble current and focus it, with its text and itself in view", async () => { const now = await currentOf(page); return now.count === 1 && now.index === 0 && now.noteFocused && now.marked === 1 && now.inView && now.bubbleInView; });
    await walk.tap();
    await eventually("the second tap to move the mark to the next bubble", async () => { const now = await currentOf(page); return now.count === 1 && now.index === 1 && now.noteFocused && now.marked === 1 && now.inView && now.bubbleInView; });
    if (evidence) await page.screenshot({ path: join(evidence, "block-comments-phone.png") });
    if (evidence) {
      const card = (await page.locator(".composer").boundingBox())!;
      await page.screenshot({ path: join(evidence, "block-comments-phone-bar.png"), clip: { x: 0, y: Math.max(0, card.y - 8), width: 390, height: Math.min(card.height + 16, 844 - Math.max(0, card.y - 8)) } });
    }
    console.log("PASS phone: the bar's X is touch-sized, no tile or pill exists, and the bar's taps mark the current bubble and its text");

    // notes, highlights and the Comment button make the chat no wider than its box
    await select(page, item, "Run the migration");
    await floatOf(page).waitFor();
    const width = await page.locator(".chat-view").evaluate((node) => ({ scroll: node.scrollWidth, client: node.clientWidth }));
    assert.ok(width.scroll <= width.client, `the chat scrolls sideways (scrollWidth ${width.scroll}px > clientWidth ${width.client}px)`);
    const outer = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    assert.ok(outer.scroll <= outer.client, `the page scrolls sideways (scrollWidth ${outer.scroll}px > clientWidth ${outer.client}px)`);
    await page.evaluate(() => window.getSelection()!.removeAllRanges());
    await floatOf(page).waitFor({ state: "detached" });
    console.log("PASS phone: notes, highlights and the Comment button cause no horizontal overflow");

    // the X takes all the comments at once: the notes leave the chat and the bar turns into the undo, the same height
    const heightOf = async (): Promise<number> => (await bar.boundingBox())!.height;
    const walkingHeight = await heightOf();
    await removeOf(page).tap();
    await eventually("every note to leave the chat", async () => (await notesOf(page).count()) === 0 && (await page.locator(".is-commented, .is-current").count()) === 0);
    await eventually("the undo", () => bar.evaluate((node) => node.classList.contains("is-undo")));
    assert.ok(Math.abs((await heightOf()) - walkingHeight) <= 1, "the undo bar is as tall as the walk bar on a phone");
    assert.equal(await bar.locator(".composer-comments-text").innerText(), "Comments removed: 2");
    await undoOf(page).tap();
    await eventually("both notes to come back", async () => (await notesOf(page).count()) === 2);
    assert.equal(await labelOf(page), "2 comments on the reply");
    assert.equal(await highlightMatchesNotes(page, "after the undo on the phone"), 2);
    // Delete in the sheet takes the bubble that opened it with it: on a touch screen the focus is let go, not given to the composer (no keyboard unasked)
    await notesOf(page).first().tap();
    await editor.waitFor();
    await editor.getByRole("button", { name: "Delete", exact: true }).tap();
    await editor.waitFor({ state: "hidden" });
    await frames(page);
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains("composer-text")), false, "on a touch screen Delete in the sheet does not move the focus to the message box (no keyboard)");
    await eventually("the deleted comment's bubble to be gone", async () => (await notesOf(page).count()) === 1);
    assert.equal(await labelOf(page), "1 comment on the reply");
    // the second X, and the bar goes once the undo is gone (it expires, or a message is sent)
    await removeOf(page).tap();
    await eventually("every note to leave the chat again", async () => (await notesOf(page).count()) === 0);
    await eventually("the undo to expire", async () => (await bar.count()) === 0, 15000);
    assert.equal(await page.locator(".composer-attachments").count(), 0, "no strip is left behind");
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains("composer-text")), false, "on a touch screen the expiry does not move the focus to the message box (no keyboard)");
    await assertMessageLayout(page, messageFree, "after the bar is gone");
    console.log("PASS phone: the bar's X removes every comment into an undo of the same height, Undo brings them back, and the bar goes when it expires");
    assert.deepEqual(errors, []);
    await page.context().close();
  }

  // ── a long code block: unfolded, it stays unfolded as comments are added to it; the quote of a long selection scrolls ──
  {
    writeTranscript(LONG_ANSWER);
    const { page, sent } = await open({ viewport: { width: 1280, height: 800 } });
    const longCode = page.locator(".markdown-block.is-commentable", { has: page.locator(".markdown-code") });
    const more = longCode.locator(".markdown-code-more");
    const editor = sheetOf(page);
    assert.match(await more.innerText(), /^Show all \d+ lines$/);
    await more.click();
    assert.equal(await more.getAttribute("aria-expanded"), "true");
    await longCode.locator(".markdown-code").evaluate((node) => { (node as HTMLElement).dataset.kept = "yes"; });
    // two comments on the one code block: neither rebuilds it, so the block the reader unfolded stays unfolded after both
    assert.equal(await comment(page, longCode, "line 35", "Trim this"), "line 35");
    await page.locator(".markdown-block.is-commented").waitFor();
    const stillUnfolded = async (what: string): Promise<void> => {
      assert.equal(await more.getAttribute("aria-expanded"), "true", `the unfolded code block stays unfolded ${what}`);
      assert.equal(await more.innerText(), "Show less");
      assert.equal(await longCode.locator(".markdown-code").evaluate((node) => (node as HTMLElement).dataset.kept), "yes", `the code block is the same element ${what}`);
      assert.match(await longCode.locator("pre").innerText(), /line 40/);
    };
    await stillUnfolded("after the first comment");
    assert.equal(await comment(page, longCode, "line 38", "And this"), "line 38");
    await stillUnfolded("after a second comment is added to it");
    // a selection across lines keeps its line breaks, in the store and in the message
    assert.equal(await comment(page, longCode, "line 5", "Lines", { to: "line 9" }), "line 5\nline 6\nline 7\nline 8\nline 9");
    await stillUnfolded("after a third comment");
    assert.deepEqual(await noteTexts(page), ["Lines", "Trim this", "And this"], "three bubbles on the one block, in the order of the text");
    assert.deepEqual(await noteNames(page), ["Comment on “line 5 line 6 line 7 line 8 lin…”: Lines", "Comment on “line 35”: Trim this", "Comment on “line 38”: And this"], "the first one's excerpt is cut at 32 characters");
    assert.equal(await highlightMatchesNotes(page, "three comments on a code block"), 3);
    assert.equal(await highlighted(page), 3, "the highlight holds a range per comment on the block");
    await assertBubbleGroup(longCode, "three bubbles under a long code block");
    await assertTail(notesOf(page).nth(0), longCode, { text: "line 9" }, "a selection over five lines: its last line's end");
    await assertTail(notesOf(page).nth(1), longCode, { text: "line 35" }, "a line of an unfolded block");
    console.log("PASS desktop: an unfolded long code block stays unfolded after a second and a third comment, one bubble and one highlight each");

    // the sheet (a window of 768px or less, here 700px) quotes the selection: a long quote is as tall as its text and the dialog's body scrolls; it is context, so nothing in it takes focus
    await page.setViewportSize({ width: 700, height: 800 });
    await select(page, longCode, "line 1", "line 30");
    await floatOf(page).waitFor();
    await floatOf(page).click();
    await editor.waitFor();
    const quoted = editor.locator(".comment-editor-block");
    assert.equal(await quoted.locator(".comment-editor-plain").innerText(), Array.from({ length: 30 }, (_, n) => `line ${n + 1}`).join("\n"), "the editor shows the whole selection, lines kept");
    assert.equal(await quoted.locator("button, a[href], [tabindex]").count(), 0, "nothing in the editor's quote takes focus");
    const frame = await quoted.evaluate((node) => {
      const body = node.closest(".modal-body")!;
      return { quote: node.scrollHeight - node.clientHeight, body: body.scrollHeight > body.clientHeight };
    });
    assert.ok(frame.quote <= 1 && frame.body, `a long quote has no scrolling frame of its own, the dialog's body scrolls (quote overflow ${frame.quote}px)`);
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    await editor.waitFor({ state: "hidden" });
    assert.equal(await notesOf(page).count(), 3, "a cancelled comment adds no note");
    console.log("PASS desktop: the editor's quote of a long selection keeps its lines; the dialog's body scrolls, not the quote");

    // a selection over a link quotes its words, as text
    const linked = page.locator("p.is-commentable", { hasText: "See docs." });
    assert.equal(await comment(page, linked, "See docs", "The link", { sheet: true }), "See docs");
    await notesOf(page).filter({ hasText: "The link" }).click();
    await editor.waitFor();
    assert.equal(await editor.locator(".comment-editor-block a").count(), 0, "a link in the editor's quote is no link");
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    await editor.waitFor({ state: "hidden" });
    await page.setViewportSize({ width: 1280, height: 800 });

    // the message carries a "> " before every line of a multi-line selection
    await page.getByRole("textbox", { name: "Message", exact: true }).fill("Done");
    await page.getByRole("button", { name: /^Send message/ }).click();
    await barOf(page).waitFor({ state: "detached" });
    assert.ok(sent.some((text) => text === "> See docs\nThe link\n\n> line 5\n> line 6\n> line 7\n> line 8\n> line 9\nLines\n\n> line 35\nTrim this\n\n> line 38\nAnd this\n\nDone"), `sent: ${JSON.stringify(sent)}`);
    console.log("PASS desktop: a multi-line selection is sent with a > before every line");
    await page.context().close();
    writeTranscript(ANSWER);
  }

  // ── a comment stored by the earlier version (on a whole block, no selection) still renders, edits and sends ──
  {
    // made the way a reader makes one now, then turned into the old shape: the part's own anchor and order, no quote, no range
    const first = await open({ viewport: { width: 1280, height: 800 } });
    await comment(first.page, first.page.locator("p.is-commentable", { hasText: INTRO }), "Intro paragraph", "Legacy words");
    assert.equal((await storedOf(first.page)).length, 1);
    await makeLegacy(first.page, storeKey, "Legacy words");
    await first.page.reload();
    const { page, sent } = first;
    await page.locator(".conn-live").waitFor();
    const intro = page.locator("p.is-commentable", { hasText: INTRO });
    await page.locator("p.is-commented").waitFor();
    const editor = sheetOf(page);
    const popover = popoverOf(page);
    assert.deepEqual(await noteTexts(page), ["Legacy words"], "the old comment shows as a bubble with its text");
    assert.equal(await notesOf(page).first().getAttribute("aria-label"), null, "a comment on a whole part has its text as its name");
    assert.equal(await staleOf(page).count(), 0);
    assert.equal(await labelOf(page), "1 comment on the reply");
    // a comment on a whole part highlights all of its text, and its tail stands a little in from where the text starts
    assert.equal(await highlightMatchesNotes(page, "a comment on a whole part"), 1);
    assert.deepEqual((await rangesOf(page, "block-comment")).texts, [INTRO], "the whole paragraph is highlighted");
    await assertTail(notesOf(page).first(), intro, "text start", "a comment on a whole part");
    await assertNoRail(page, "a comment on a whole part");
    // with a mouse its editor is the popover: no quote, the text of the comment; the block is drawn only in the modal (a window of 768px or less)
    await notesOf(page).first().click();
    await popover.waitFor();
    assert.equal(await popover.getByRole("textbox", { name: "Comment" }).inputValue(), "Legacy words");
    assert.equal(await popover.locator(".comment-editor-block").count(), 0);
    await popover.getByRole("button", { name: "Cancel", exact: true }).click();
    await popover.waitFor({ state: "hidden" });
    await page.setViewportSize({ width: 700, height: 800 });
    await notesOf(page).first().click();
    await editor.waitFor();
    assert.match(await editor.locator(".comment-editor-block").innerText(), /Intro paragraph about the state\./);
    assert.equal(await editor.getByRole("textbox", { name: "Comment" }).inputValue(), "Legacy words");
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    await editor.waitFor({ state: "hidden" });
    await page.setViewportSize({ width: 1280, height: 800 });
    // a selection comment beside it in the same paragraph: the old one first, then the new
    await comment(page, intro, "the state", "New words");
    assert.deepEqual(await noteTexts(page), ["Legacy words", "New words"]);
    assert.deepEqual(await noteNames(page), ["Legacy words", "Comment on “the state”: New words"]);
    assert.equal(await highlightMatchesNotes(page, "an old and a new comment"), 2);
    await page.getByRole("textbox", { name: "Message", exact: true }).fill("Thanks");
    await page.getByRole("button", { name: /^Send message/ }).click();
    await barOf(page).waitFor({ state: "detached" });
    assert.ok(sent.some((text) => text === "> Intro paragraph about the state.\nLegacy words\n\n> the state\nNew words\n\nThanks"), `sent: ${JSON.stringify(sent)}`);
    console.log("PASS desktop: a comment of the earlier version highlights its whole part, edits and sends beside a selection comment");
    await page.context().close();
  }

  // ── a stored comment whose block this version cannot draw ──
  {
    const broken = { id: "broken", anchor: "x:0:0", order: [0, 0, 0], comment: "kept", block: { type: "blockquote", blocks: [{ type: "video" }] } };
    const { page } = await open({ viewport: { width: 1280, height: 800 } }, { version: 1, comments: [broken] });
    await walkOf(page).click(); // the part is not in the chat: the bar's stop opens its editor
    const editor = page.locator(".comment-editor");
    await editor.waitFor();
    assert.equal(await editor.getByRole("textbox", { name: "Comment" }).inputValue(), "kept");
    await page.locator(".conn-live").waitFor();
    assert.deepEqual(errors.filter((message) => !/render failed/.test(message)), []);
    console.log("PASS a block the editor cannot draw leaves the app and the comment usable");
    await page.context().close();
  }
} finally {
  await browser?.close();
  server?.stop();
  if (workspace) await workspaceClose(workspace);
  rmSync(root, { recursive: true, force: true });
}
