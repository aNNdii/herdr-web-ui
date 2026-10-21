/**
 * The review dialog's own keys, modelled on Gerrit: `[` `]` step through the files, `j` `k` move a
 * line cursor, `c` comments and `v` marks the file viewed. Every rule about when a key counts lives
 * here; the dialog asks `reviewKeyOf` once per keydown and acts on the answer.
 */
import { shortcutEventKey } from "./shortcuts.ts";
import { nativeModalOver } from "./useFocusTrap.ts";

export type ReviewKey = "next" | "previous" | "viewed" | "down" | "up" | "extend-down" | "extend-up" | "comment" | "clear" | "page-down" | "page-up" | "line-down" | "line-up";
export type CursorKey = Extract<ReviewKey, "down" | "up" | "extend-down" | "extend-up">;
/** text: input/textarea/select/contenteditable (empty too) · tree: in [role=tree] · control: button, a[href], summary, [role=button|menuitem*], only when :focus-visible · other */
export type KeyFocus = "text" | "control" | "tree" | "other";
export type ReviewKeyFacts = Pick<KeyboardEvent, "key" | "code" | "shiftKey" | "ctrlKey" | "altKey" | "metaKey" | "repeat" | "isComposing" | "keyCode">;

/** The documented keys, one row per action; a test checks docs/guide.md against it. */
export const REVIEW_KEYS: readonly { keys: readonly string[]; action: ReviewKey }[] = [
  { keys: ["]"], action: "next" },
  { keys: ["["], action: "previous" },
  { keys: ["v"], action: "viewed" },
  { keys: ["j", "↓"], action: "down" },
  { keys: ["k", "↑"], action: "up" },
  { keys: ["Shift+j", "Shift+↓"], action: "extend-down" },
  { keys: ["Shift+k", "Shift+↑"], action: "extend-up" },
  { keys: ["c", "Enter"], action: "comment" },
  { keys: ["Escape"], action: "clear" },
  { keys: ["Space", "PageDown"], action: "page-down" },
  { keys: ["Shift+Space", "PageUp"], action: "page-up" },
];

/** What shortcutEventKey reads for each key; Shift turns the cursor moves into extending ones. */
const PLAIN: Readonly<Record<string, ReviewKey>> = {
  "]": "next", "[": "previous", v: "viewed", j: "down", ArrowDown: "down", k: "up", ArrowUp: "up", c: "comment", Enter: "comment", Escape: "clear",
  " ": "page-down", PageDown: "page-down", PageUp: "page-up",
};
/** Shift extends the cursor moves; on Space it pages up, as the browser's own Shift+Space does. */
const EXTENDED: Readonly<Partial<Record<string, ReviewKey>>> = { j: "extend-down", ArrowDown: "extend-down", k: "extend-up", ArrowUp: "extend-up", " ": "page-up" };
const ARROWS = new Set(["ArrowDown", "ArrowUp"]);
/** A held key repeats only the moves and the pages. */
const REPEATS = new Set<ReviewKey>(["next", "previous", "down", "up", "extend-down", "extend-up", "page-down", "page-up"]);
/**
 * The keys that page the file: the browser's own, which find no scrolling body while the focus is on the dialog, so the
 * review pages for them. Not shortcuts, so they work with the review keys off too (`keyOff`).
 */
const PAGE_KEYS = new Set([" ", "PageDown", "PageUp"]);

/** Pure, for tests. See KeyFocus for the focus kinds. */
export function reviewKey(event: ReviewKeyFacts, focus: KeyFocus): ReviewKey | null {
  if (event.ctrlKey || event.altKey || event.metaKey) return null;
  if (event.isComposing || event.keyCode === 229) return null;
  if (focus === "text") return null;
  const name = shortcutEventKey(event);
  const plain = Object.hasOwn(PLAIN, name) ? PLAIN[name]! : null;
  if (plain === null) return null;
  // the tree moves its own rows with the arrows, and a focused control or tree row keeps Enter and Space (and the tree
  // its paging)
  if (ARROWS.has(name) && focus === "tree") return null;
  if ((name === "Enter" || PAGE_KEYS.has(name)) && (focus === "control" || focus === "tree")) return null;
  const key = event.shiftKey ? EXTENDED[name] ?? plain : plain;
  return event.repeat && !REPEATS.has(key) ? null : key;
}

const CONTROL_TAGS = new Set(["BUTTON", "SUMMARY"]);
const CONTROL_ROLES = new Set(["button", "menuitem", "menuitemcheckbox", "menuitemradio"]);
const TEXT_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

function keyFocus(element: Element | null): KeyFocus {
  if (element === null || typeof element.closest !== "function") return "other";
  if (TEXT_TAGS.has(element.tagName) || (element as HTMLElement).isContentEditable) return "text";
  if (element.closest('[role="tree"]') !== null) return "tree";
  const control = CONTROL_TAGS.has(element.tagName) || (element.tagName === "A" && element.hasAttribute("href")) || CONTROL_ROLES.has(element.getAttribute("role") ?? "");
  // a button a click focused gives Enter back: Enter after clicking Viewed comments instead of toggling it again
  return control && element.matches(":focus-visible") ? "control" : "other";
}

/** With the review keys off, what still acts: the browser's own keys, Escape, the pages, and an arrow as a line's scroll. */
function keyOff(key: ReviewKey, event: Pick<KeyboardEvent, "key">): ReviewKey | null {
  if (key === "clear" || key === "page-down" || key === "page-up") return key;
  if (ARROWS.has(event.key) && (key === "down" || key === "up")) return key === "down" ? "line-down" : "line-up";
  return null;
}

/**
 * The one entry for the dialog. null for an event already handled, a native dialog or an open popover over the review,
 * and everything reviewKey refuses; with the keys switched off, all but the browser's own keys (`keyOff`).
 * The focus is read from composedPath()[0], so a row inside a shadow root counts as itself.
 */
export function reviewKeyOf(event: KeyboardEvent, surface: HTMLElement | null, keysOn: boolean): ReviewKey | null {
  if (event.defaultPrevented) return null;
  if (nativeModalOver(surface)) return null;
  if (surface?.querySelector('[aria-haspopup][aria-expanded="true"]')) return null;
  // the window or the document as target has no closest(): it counts as "other"
  const key = reviewKey(event, keyFocus((event.composedPath()[0] ?? event.target) as Element | null));
  return key === null || keysOn ? key : keyOff(key, event);
}
