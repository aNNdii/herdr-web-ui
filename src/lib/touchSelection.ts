/**
 * The rules of the app's own selection on a touch screen in the comment mode (components/TouchSelection.tsx), without
 * the DOM: when a resting finger selects (`holdStep`), the word it selects (`wordBounds`), how a handle moves an end
 * (`moveEdge`, the ends swapping as they cross), and where the Comment pill goes (`pillTop`). Offsets are positions in
 * the commentable text as the hook counts it (its text nodes in document order, end to end).
 */

/** How long a finger rests before it selects the word under it. */
export const TOUCH_HOLD_MS = 450;
/** How far it may move meanwhile: a longer move is a scroll, and selects nothing. */
export const TOUCH_SLOP_PX = 8;

/** A finger's press: none (`idle`), resting where it went down (`pressing`), or holding a selection it extends (`selecting`). */
export type HoldState =
  | { kind: "idle" }
  | { kind: "pressing"; x: number; y: number }
  | { kind: "selecting" };

/** One event of a press: its finger down, moved or up (client pixels), or its timer (`TOUCH_HOLD_MS` after down). */
export interface HoldEvent { type: "down" | "move" | "up" | "timer"; x: number; y: number }

/**
 * The next state of a press and what it does: `select` the word at the press as the timer fires while the finger rests
 * within `TOUCH_SLOP_PX`; `cancel` on a move beyond that before it (a scroll: the timer then selects nothing); `extend`
 * the selection's end on each move after it; `end` as the finger lifts after it. A lift before the timer is a tap: it
 * does nothing here.
 */
export function holdStep(state: HoldState, event: HoldEvent): { state: HoldState; action: "none" | "select" | "extend" | "end" | "cancel" } {
  const idle: HoldState = { kind: "idle" };
  switch (event.type) {
    case "down":
      return { state: { kind: "pressing", x: event.x, y: event.y }, action: "none" };
    case "timer":
      return state.kind === "pressing" ? { state: { kind: "selecting" }, action: "select" } : { state, action: "none" };
    case "move":
      if (state.kind === "selecting") return { state, action: "extend" };
      if (state.kind === "pressing" && Math.hypot(event.x - state.x, event.y - state.y) > TOUCH_SLOP_PX) return { state: idle, action: "cancel" };
      return { state, action: "none" };
    case "up":
      return { state: idle, action: state.kind === "selecting" ? "end" : "none" };
  }
}

/** The segmenters made so far, by locale and granularity: one is asked on every move of a finger that extends. */
const segmenters = new Map<string, Intl.Segmenter>();

function segmenter(locale: string | undefined, granularity: "word" | "grapheme"): Intl.Segmenter {
  const key = `${locale ?? ""}\u0000${granularity}`;
  let found = segmenters.get(key);
  if (found === undefined) {
    found = new Intl.Segmenter(locale, { granularity });
    segmenters.set(key, found);
  }
  return found;
}

/**
 * The word of `text` around `offset` (a UTF-16 offset; at the end, the last character's), by `Intl.Segmenter`'s word
 * granularity in `locale`: a German compound is one word. Where the offset is on no word (white space, punctuation, an
 * emoji), that one character: its whole grapheme, so an emoji with a skin tone or a letter with its combining mark is
 * never split. Where the browser has no `Intl.Segmenter` (Firefox before 125, Safari before 14.1), `fallbackWordBounds`.
 */
export function wordBounds(text: string, offset: number, locale?: string): [start: number, end: number] {
  if (typeof Intl.Segmenter !== "function") return fallbackWordBounds(text, offset);
  if (text === "") return [0, 0];
  const at = Math.max(0, Math.min(offset, text.length - 1));
  const around = (granularity: "word" | "grapheme"): Intl.SegmentData | undefined => segmenter(locale, granularity).segment(text).containing(at);
  const word = around("word");
  if (word !== undefined && word.isWordLike === true) return [word.index, word.index + word.segment.length];
  const grapheme = around("grapheme");
  return grapheme === undefined ? [at, at + 1] : [grapheme.index, grapheme.index + grapheme.segment.length];
}

/** A letter, a digit, a combining mark or an underscore: part of a word. */
const WORD_CHAR = /^[\p{L}\p{N}\p{M}_]$/u;
/** An apostrophe, part of a word between two of its characters ("don't"). */
const APOSTROPHE = /^['\u2019]$/u;
/** What clings to the code point before it in one character: a combining mark, a skin tone, a variation selector. */
const CLINGS = /^[\p{M}\p{Emoji_Modifier}\uFE0F\uFE0E]$/u;
const ZWJ = "\u200D";

/** The code point of `text` starting at UTF-16 index `at`, and its length (1 or 2). */
function codePointAt(text: string, at: number): { char: string; length: number } {
  const char = String.fromCodePoint(text.codePointAt(at)!);
  return { char, length: char.length };
}

/** The start of the code point that UTF-16 index `at` lies in (a low surrogate's pair starts one before it). */
function codePointStart(text: string, at: number): number {
  const unit = text.charCodeAt(at);
  const before = at > 0 ? text.charCodeAt(at - 1) : 0;
  return unit >= 0xdc00 && unit <= 0xdfff && before >= 0xd800 && before <= 0xdbff ? at - 1 : at;
}

/** The code point that ends just before UTF-16 index `at`, and where it starts; null at the text's start. */
function codePointBefore(text: string, at: number): { char: string; start: number } | null {
  if (at <= 0) return null;
  const start = codePointStart(text, at - 1);
  return { char: codePointAt(text, start).char, start };
}

/**
 * `wordBounds` without `Intl.Segmenter`: the run of letters, digits, combining marks and underscores around `offset`
 * (an apostrophe between two of them included), scanned by code points. Off a word, the one character there: its code
 * point with what clings to it (combining marks, a skin tone, a variation selector, a zero-width-joined sequence), so a
 * surrogate pair or an emoji is never split.
 */
export function fallbackWordBounds(text: string, offset: number): [start: number, end: number] {
  if (text === "") return [0, 0];
  let at = codePointStart(text, Math.max(0, Math.min(offset, text.length - 1)));
  const isWord = (char: string): boolean => WORD_CHAR.test(char);
  // on what clings to a character (a skin tone, a mark), the character it clings to decides
  while (at > 0 && CLINGS.test(codePointAt(text, at).char) && !isWord(codePointAt(text, at).char)) at = codePointBefore(text, at)!.start;
  const here = codePointAt(text, at);
  if (isWord(here.char)) {
    let start = at;
    for (let before = codePointBefore(text, start); before !== null; before = codePointBefore(text, start)) {
      const joined = APOSTROPHE.test(before.char) && before.start > 0 && isWord(codePointBefore(text, before.start)!.char);
      if (!isWord(before.char) && !joined) break;
      start = before.start;
    }
    let end = at + here.length;
    while (end < text.length) {
      const next = codePointAt(text, end);
      const joined = APOSTROPHE.test(next.char) && end + next.length < text.length && isWord(codePointAt(text, end + next.length).char);
      if (!isWord(next.char) && !joined) break;
      end += next.length;
    }
    return [start, end];
  }
  let end = at + here.length;
  while (end < text.length) {
    const next = codePointAt(text, end);
    if (CLINGS.test(next.char)) end += next.length;
    else if (next.char === ZWJ && end + 1 < text.length) end += 1 + codePointAt(text, end + 1).length;
    else break;
  }
  return [at, end];
}

/**
 * The selection `start`–`end` with its `edge` dragged to `to`: past the other end, the ends swap and the dragged edge is
 * the other one now. Onto the other end it stays as it was: a selection never collapses.
 */
export function moveEdge(start: number, end: number, edge: "start" | "end", to: number): { start: number; end: number; edge: "start" | "end" } {
  const other = edge === "end" ? start : end;
  if (to === other) return { start, end, edge };
  if (edge === "end") return to > start ? { start, end: to, edge: "end" } : { start: to, end: start, edge: "start" };
  return to < end ? { start: to, end, edge: "start" } : { start: end, end: to, edge: "end" };
}

/**
 * The Comment pill's top: `gap` above the selection's first line (`first`, its top), where the pill (`height`) fits below
 * the top of the view (`view`); else `below` under the selection's last line (`last`, its bottom), clear of the end
 * handle's knob. All in one coordinate space.
 */
export function pillTop({ first, last, view, height, gap, below }: { first: number; last: number; view: number; height: number; gap: number; below: number }): number {
  const above = first - gap - height;
  return above >= view ? above : last + below;
}
