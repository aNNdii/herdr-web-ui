/**
 * The code view's comment field lives in a same-origin frame of its own (components/FrameField.tsx): focusing a field in
 * the viewer's document makes iOS Safari work over the whole document before the keyboard rises, which a long file makes
 * slow, and a field in a frame of its own is focused in a document of a few elements (measured: the design spec's
 * "Performance", docs/superpowers/specs/2026-10-11-code-view-inline-comments-design.md). These are the pure parts of
 * crossing that frame's boundary: which keys go on to the page, how far to scroll, the page's CSS as text, and the slot
 * a frame stands for in the page. Where the focus really is, and what counts as typing, are lib/focus.ts's.
 *
 * Everything here needs only plain properties (`localName`, `contentDocument`, `cssRules`), so stand-in objects test it
 * without a DOM, and an element of the frame's own realm passes where `instanceof` would not.
 */

/** The code view's field (row and sheet) is drawn in a frame of its own; false draws the plain field. */
export const FRAMED_CODE_FIELD = true;

/** What a key typed in the frame's field needs: its key, its modifiers and whether an IME composes it. */
export interface FrameKeyFacts {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
  keyCode?: number;
}

const composing = (event: FrameKeyFacts): boolean => event.isComposing === true || event.keyCode === 229;

/**
 * What the frame does with a key pressed in its field. `"forward"`: the page listens for it (Escape, the app's Mod+Shift
 * shortcuts, dictation's Mod+Shift+Space), so a copy goes to the field's slot in the page. `"tab"`: the focus moves on in
 * the page's order from the slot. Null: the field's own (text, Enter, Mod+Enter, which React's portal brings to the box,
 * and Mod+Shift+Arrow, which a text field keeps: lib/shortcuts.ts `keepsArrowsForText`). A key of an IME composition is
 * always the field's.
 */
export function frameKey(event: FrameKeyFacts): "forward" | "tab" | null {
  if (composing(event)) return null;
  if (event.key === "Escape") return "forward";
  if (event.key === "Tab") return event.ctrlKey || event.metaKey || event.altKey ? null : "tab";
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && !event.key.startsWith("Arrow")) return "forward";
  return null;
}

const MODIFIER_KEYS = new Set(["Shift", "Meta", "Control"]);

/** Whether a key's release goes on to the page too: a forwarded key's, and a shortcut modifier's (dictation is held). */
export function frameKeyUp(event: FrameKeyFacts): boolean {
  if (MODIFIER_KEYS.has(event.key)) return true;
  return frameKey(event) === "forward";
}

/**
 * How far to scroll (positive: down) to bring `box` into `view`, `margin` pixels clear of its edges: nothing where it is
 * in view, its top where it is taller than the view.
 */
export function scrollDelta(box: { top: number; bottom: number }, view: { top: number; bottom: number }, margin: number): number {
  const top = view.top + margin;
  const bottom = view.bottom - margin;
  if (box.bottom - box.top > bottom - top || box.top < top) return box.top - top;
  if (box.bottom > bottom) return box.bottom - bottom;
  return 0;
}

/** What `sheetsText` reads of a style sheet. */
export interface SheetFacts {
  cssRules: Iterable<{ cssText: string }>;
  media?: { mediaText: string };
  href?: string | null;
}

const URL_PATTERN = /url\((["']?)([^"')]*)\1\)/g;

/**
 * The text of `sheets` (the page's `document.styleSheets`), for a frame of the page's own to style itself with: each
 * sheet's rules, wrapped in its media where it has one, and a relative `url()` resolved against the sheet's own address
 * (the frame's document has the page's address, not the stylesheet's: a relative base build's fonts). A sheet whose rules
 * cannot be read (another origin's) is skipped.
 */
export function sheetsText(sheets: Iterable<SheetFacts>): string {
  const parts: string[] = [];
  for (const sheet of sheets) {
    let rules: string;
    try {
      rules = Array.from(sheet.cssRules, (rule) => rule.cssText).join("\n");
    } catch {
      continue;
    }
    const base = sheet.href ?? null;
    if (base !== null) {
      rules = rules.replace(URL_PATTERN, (whole, quote: string, url: string) => {
        if (url === "" || url.startsWith("data:") || url.startsWith("#")) return whole;
        try {
          return `url(${quote}${new URL(url, base).href}${quote})`;
        } catch {
          return whole;
        }
      });
    }
    const media = sheet.media?.mediaText ?? "";
    parts.push(media === "" || media === "all" ? rules : `@media ${media}{${rules}}`);
  }
  return parts.join("\n");
}

/** A frame's slot in the page (the element it stands for), and the other way round. */
const slotOfFrame = new WeakMap<object, Element>();
const frameOfSlot = new WeakMap<object, Element>();

/** Registers `frame` as the field of `slot` while it is (null: no longer). */
export function setFrameAnchor(frame: Element, slot: Element | null): void {
  const old = slotOfFrame.get(frame);
  if (old !== undefined) frameOfSlot.delete(old);
  if (slot === null) {
    slotOfFrame.delete(frame);
    return;
  }
  slotOfFrame.set(frame, slot);
  frameOfSlot.set(slot, frame);
}

/**
 * The element of the page that stands for `node`: the slot of a registered frame, or of the frame whose document `node`
 * is in; else `node` itself. `closest` and `contains` checks of the page ask through it.
 */
export function fieldAnchor(node: Element): Element {
  const own = slotOfFrame.get(node);
  if (own !== undefined) return own;
  let frame: Element | null | undefined;
  try {
    frame = node.ownerDocument?.defaultView?.frameElement;
  } catch {
    frame = null;
  }
  return (frame === null || frame === undefined ? undefined : slotOfFrame.get(frame)) ?? node;
}

/** The field in the frame `slot` stands for; null without one. */
export function framedField(slot: Element | null): HTMLTextAreaElement | null {
  if (slot === null) return null;
  const frame = frameOfSlot.get(slot);
  if (frame === undefined) return null;
  return (frame as HTMLIFrameElement).contentDocument?.querySelector<HTMLTextAreaElement>("textarea") ?? null;
}
