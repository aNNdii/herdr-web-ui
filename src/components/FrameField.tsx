/**
 * The code view's comment field in a same-origin frame of its own. Focusing a field in the viewer's document makes iOS
 * Safari work over the whole document before its keyboard rises, which a long file makes slow; a field in a frame of its
 * own is focused in a document of a few elements (measured: the design spec's "Performance",
 * docs/superpowers/specs/2026-10-11-code-view-inline-comments-design.md). Nothing visible changes: the
 * frame's document is written at once (`prepareFrame`) with the app's CSS as text and the page's `<html>` attributes
 * (theme, density, palette, language, chat font), and `CommentField` is drawn into its body through a portal, so React's
 * events, context and the draft's keys work as they do in the page.
 *
 * - `row`: one frame per code comment layer (`useFieldFrame`), made ahead (after the mode turns on, or as a field
 *   first needs it), never moved in the document (iOS raises its keyboard only for a field it already had), placed by the
 *   layer over the field's slot in the card (`FieldFrame.place`). The slot holds the field's height, so the row and its
 *   room are measured as before.
 * - `sheet`: a frame of its own inside the sheet, made as the sheet opens (quick: its document holds a few elements).
 *
 * Across the frame's edge: keys the page listens for (Escape, the Mod+Shift shortcuts) are copied onto the slot, Tab
 * moves on in the page's order from the slot (`frameKey`), the card's focus ring follows the field (`data-field-focus`),
 * and the page's queries map the frame to its slot (lib/frameField.ts `fieldAnchor`, lib/commentDom.ts). The row's field
 * is scrolled above a soft keyboard by the app (the page itself is pinned, lib/viewport.ts).
 */
import { createContext, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

import "./FrameField.css";

import { FIELD_SLOT_CLASS } from "../lib/commentDom.ts";
import { frameKey, frameKeyUp, scrollDelta, setFrameAnchor, sheetsText, type SheetFacts } from "../lib/frameField.ts";
import { useT } from "../lib/i18n.ts";
import { keyboardUp } from "../lib/keyboard.ts";
import { tabStops } from "../lib/useFocusTrap.ts";
import { CommentField, type CommentDraft } from "./CommentDraft.tsx";

export type FramePlacement = "row" | "sheet";

const FRAME_CLASS = "comment-frame";
const STYLE_ID = "comment-frame-style";
const DOC_CLASS = "comment-frame-doc";

// ---- the frame's document ------------------------------------------------------------------------------------------

/** The documents of the frames that are up: the app's CSS and the `<html>` attributes are kept current in them. */
const liveFrames = new Map<Document, () => void>();
let styleText: string | null = null;
let headWatch: MutationObserver | null = null;
let rootWatch: MutationObserver | null = null;

/** The app's CSS as text (every same-origin style sheet of the page), cached until the page's `<head>` changes. */
export function appStyleText(): string {
  if (styleText === null) styleText = sheetsText(Array.from(document.styleSheets) as unknown as SheetFacts[]);
  return styleText;
}

function refreshStyles(): void {
  styleText = null;
  if (liveFrames.size === 0) return;
  const text = appStyleText();
  for (const doc of liveFrames.keys()) {
    const style = doc.getElementById(STYLE_ID);
    if (style !== null && style.textContent !== text) style.textContent = text;
  }
}

const styleNode = (node: Node): boolean => node.nodeName === "STYLE" || (node.nodeName === "LINK" && (node as HTMLLinkElement).rel === "stylesheet");

/** The page's `<html>` attributes on the frame's, with the frame's own class. */
function mirrorRoot(doc: Document): void {
  const from = document.documentElement;
  const to = doc.documentElement;
  for (const { name } of Array.from(to.attributes)) if (name !== "class" && !from.hasAttribute(name)) to.removeAttribute(name);
  for (const { name, value } of Array.from(from.attributes)) if (name !== "class" && to.getAttribute(name) !== value) to.setAttribute(name, value);
  const classes = `${from.className} ${DOC_CLASS}`.trim();
  if (to.className !== classes) to.className = classes;
}

/** Watches the page's `<head>` (CSS added, a dev server's update) and `<html>` (theme, density, chat font) for the frames that are up. */
function watchPage(): void {
  if (headWatch !== null) return;
  headWatch = new MutationObserver((records) => {
    let changed = false;
    for (const record of records) {
      if (record.type === "characterData" || (record.target as Node).nodeName === "STYLE") changed = true;
      for (const node of Array.from(record.addedNodes)) {
        if (!styleNode(node)) continue;
        changed = true;
        // a stylesheet link counts once it has loaded
        if (node.nodeName === "LINK") node.addEventListener("load", refreshStyles, { once: true });
      }
      for (const node of Array.from(record.removedNodes)) if (styleNode(node)) changed = true;
    }
    if (changed) refreshStyles();
  });
  headWatch.observe(document.head, { childList: true, subtree: true, characterData: true });
  rootWatch = new MutationObserver(() => {
    for (const [doc, sync] of liveFrames) {
      mirrorRoot(doc);
      sync();
    }
  });
  rootWatch.observe(document.documentElement, { attributes: true });
}

const prepared = new WeakSet<Document>();

/**
 * Writes the frame's document, once (a document already written is left as it is): standards mode, the app's CSS as text,
 * the page's `<html>` attributes, and a body classed for its `placement`. At once, not with `srcdoc` (which loads later):
 * the field is focused in the same tap or click that opened it. Returns the body, the portal's container.
 */
export function prepareFrame(frame: HTMLIFrameElement, placement: FramePlacement): HTMLElement | null {
  const doc = frame.contentDocument;
  if (doc === null) return null;
  if (!prepared.has(doc)) {
    doc.open();
    doc.write("<!doctype html><html><head></head><body></body></html>");
    doc.close();
    const style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = appStyleText();
    doc.head.append(style);
    mirrorRoot(doc);
    doc.body.className = `${FRAME_CLASS} is-${placement}`;
    prepared.add(doc);
    // the chat's face, loaded now: the field shows in it from its first frame
    const family = getComputedStyle(document.documentElement).getPropertyValue("--font-chat").trim() || getComputedStyle(document.documentElement).getPropertyValue("--font-ui").trim();
    try {
      if (family !== "") doc.fonts?.load(`16px ${family}`).catch(() => {});
    } catch {
      // a family the font loader cannot read: the field still draws, in it once it has loaded
    }
  }
  watchPage();
  return doc.body;
}

/** Keeps `doc`'s CSS and `<html>` attributes current while it is up; `sync` runs as the page's `<html>` changes. */
function goLive(doc: Document, sync: () => void): () => void {
  liveFrames.set(doc, sync);
  mirrorRoot(doc);
  const style = doc.getElementById(STYLE_ID);
  const text = appStyleText();
  if (style !== null && style.textContent !== text) style.textContent = text;
  return () => { if (liveFrames.get(doc) === sync) liveFrames.delete(doc); };
}

/** The slot's face on the frame's body: what the field inherits where it stood in the page. */
const COPIED = ["font-family", "font-size", "font-weight", "line-height", "letter-spacing", "color"] as const;
const COPIED_VARS = ["--comment-field-min", "--fs-chat", "--chat-scale"] as const;

function copyFace(slot: Element, body: HTMLElement): void {
  const style = getComputedStyle(slot);
  for (const name of COPIED) body.style.setProperty(name, style.getPropertyValue(name));
  for (const name of COPIED_VARS) {
    const value = style.getPropertyValue(name).trim();
    if (value === "") body.style.removeProperty(name);
    else body.style.setProperty(name, value);
  }
}

// ---- the row's persistent frame ------------------------------------------------------------------------------------

/** The code comment layer's frame for the row field, handed down to the row's `FrameField`. */
export interface FieldFrame {
  /** the frame's id, for the slot's `aria-owns` */
  id: string;
  /** the frame, made now if it is not yet */
  ensure(): HTMLIFrameElement | null;
  /** places the frame over its slot, in the layer's coordinates; null: its row is not drawn, the frame hides */
  place(top: number | null, left?: number, width?: number): void;
  /** the field in the frame has its size: the layer places its rows (and the room under the field's line) now */
  sized(): void;
  /** the viewer's scrolling body: the field is scrolled above a soft keyboard in it */
  scroller: RefObject<HTMLElement>;
}

export const FieldFrameContext = createContext<FieldFrame | null>(null);

/**
 * The host's class: the code comment layer's first child, static, that holds the row's frame. First, so its ref is set
 * before a row's `FrameField` runs its layout effects in the layer's first commit.
 */
export const FRAME_HOST_CLASS = "code-comment-frame-host";

/** On a row field's slot once it has the field's height: the layer measures the row with it then. */
const SLOT_SIZED_ATTR = "data-sized";

/** Whether the row field's slot `slot` has the field's height yet (`FrameField` sizes it in the commit after it opens). */
export const slotSized = (slot: Element): boolean => slot.hasAttribute(SLOT_SIZED_ATTR);

/**
 * The code comment layer's frame (`row`): made in `host` once `wanted` (the mode is on) after the layer has painted, or at
 * once by `ensure` where a field opens first; kept until the layer goes, so a field with text typed stays as it was.
 */
export function useFieldFrame(host: RefObject<HTMLDivElement>, wanted: boolean, scroller: RefObject<HTMLElement>, placeRows: RefObject<() => void>): FieldFrame {
  const id = useId();
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const t = useT();
  const title = useRef(t("Comment"));
  title.current = t("Comment");
  const frame = useMemo<FieldFrame>(() => ({
    id,
    scroller,
    ensure() {
      if (frameRef.current !== null) return frameRef.current;
      const parent = host.current;
      if (parent === null) return null;
      const made = parent.ownerDocument.createElement("iframe");
      made.className = FRAME_CLASS;
      made.id = id;
      made.title = title.current;
      made.tabIndex = -1;
      parent.append(made);
      frameRef.current = made;
      prepareFrame(made, "row");
      return made;
    },
    place(top, left = 0, width = 0) {
      const made = frameRef.current;
      if (made === null) return;
      if (top === null) {
        made.toggleAttribute("data-unplaced", true);
        return;
      }
      made.toggleAttribute("data-unplaced", false);
      const tops = `${top}px`;
      const lefts = `${left}px`;
      const widths = `${width}px`;
      if (made.style.top !== tops) made.style.top = tops;
      if (made.style.left !== lefts) made.style.left = lefts;
      if (made.style.width !== widths) made.style.width = widths;
    },
    sized() {
      placeRows.current?.();
    },
  }), [id, host, scroller, placeRows]);
  useEffect(() => { if (frameRef.current !== null) frameRef.current.title = t("Comment"); }, [t]);
  // after the layer has painted: the tap that opens a field finds its frame ready
  useEffect(() => {
    if (!wanted || frameRef.current !== null) return;
    let timer = 0;
    const raf = window.requestAnimationFrame(() => { timer = window.setTimeout(() => frame.ensure(), 0); });
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [wanted, frame]);
  useEffect(() => () => {
    const made = frameRef.current;
    frameRef.current = null;
    // its document leaves the live ones with its field (`FrameField`'s `goLive`), before React detaches the layer
    if (made === null) return;
    setFrameAnchor(made, null);
    made.remove();
  }, []);
  return frame;
}

// ---- the field ---------------------------------------------------------------------------------------------------

/** Puts the focus on `doc`'s body: an element of its own takes it for a moment and leaves, which no blur does in WebKit. */
function releaseFocus(doc: Document): void {
  const stand = doc.createElement("span");
  stand.tabIndex = -1;
  doc.body.append(stand);
  stand.focus({ preventScroll: true });
  stand.remove();
}

/** Moves the focus from `slot` to the tab stop after it (before it: `back`) in its dialog. */
function focusBeside(slot: HTMLElement, back: boolean): void {
  const scope = slot.closest<HTMLElement>("[aria-modal='true']") ?? slot.ownerDocument.body;
  const stops = tabStops(scope);
  const at = stops.indexOf(slot);
  if (stops.length === 0) return;
  const next = at < 0 ? stops[0] : back ? stops[(at - 1 + stops.length) % stops.length] : stops[(at + 1) % stops.length];
  next?.focus({ preventScroll: true });
}

const KEY_FIELDS = ["key", "code", "location", "repeat", "ctrlKey", "metaKey", "shiftKey", "altKey"] as const;

/**
 * The comment's field in a frame of its own, for the code view's `row` (the layer's frame, which the layer places over
 * the slot) or its `sheet` (a frame inside the slot). The slot is a Tab stop that hands its focus on to the field. Where
 * no frame can be made or written, the plain `CommentField` is drawn instead (`failed`).
 */
export function FrameField({ draft, placement }: { draft: CommentDraft; placement: FramePlacement }): JSX.Element {
  const t = useT();
  const shared = useContext(FieldFrameContext);
  const row = placement === "row" ? shared : null;
  const slotRef = useRef<HTMLDivElement>(null);
  const ownFrame = useRef<HTMLIFrameElement>(null);
  const [body, setBody] = useState<HTMLElement | null>(null);
  // no frame could be made or written for it: the plain field stands in the slot's place
  const [failed, setFailed] = useState(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // the frame, written and claimed for this field: its body is the portal's container (drawn in the next commit, still
  // inside the tap or click that opened it)
  useLayoutEffect(() => {
    const slot = slotRef.current;
    if (slot === null) return;
    const frame = row !== null ? row.ensure() : ownFrame.current;
    const ready = (): HTMLElement | null => {
      if (frame === null) return null;
      const container = prepareFrame(frame, placement);
      if (container !== null) copyFace(slot, container);
      return container;
    };
    const container = ready();
    if (frame === null || container === null) {
      console.warn("comment field: no frame to draw it in, the plain field instead");
      setFailed(true);
      return;
    }
    frame.toggleAttribute("data-open", true);
    setFrameAnchor(frame, slot);
    setBody(container);
    // a browser that swaps the frame's first blank document for another as it loads: written again, drawn again
    const onLoad = (): void => {
      const now = frame.contentDocument?.body ?? null;
      if (now !== null && now !== container) setBody(ready());
    };
    frame.addEventListener("load", onLoad);
    return () => {
      frame.removeEventListener("load", onLoad);
      // the focus leaves with the field: the draft's close then finds the page's body and gives it back (CommentDraft.tsx)
      if (frame.ownerDocument.activeElement === frame) {
        (frame.contentDocument?.activeElement as HTMLElement | null)?.blur();
        frame.blur();
        // WebKit keeps the focus on a frame it blurs (on the frame's own body): the draft would take that for a focus
        // given elsewhere and give none back (a key's ⊕), and the keys would go on into the hidden frame
        if (frame.ownerDocument.activeElement === frame) releaseFocus(frame.ownerDocument);
      }
      frame.toggleAttribute("data-open", false);
      setFrameAnchor(frame, null);
      // the row's frame is the layer's and stays; this field is no longer in it
      if (row !== null) frame.toggleAttribute("data-unplaced", true);
    };
  }, [row, placement]);

  // the field is in the frame: its size, its keys, its focus ring, and the first focus
  useLayoutEffect(() => {
    const slot = slotRef.current;
    const frame = row !== null ? row.ensure() : ownFrame.current;
    const field = draftRef.current.field.current;
    const view = body?.ownerDocument.defaultView;
    if (body === null || slot === null || frame === null || field === null || !view) return;
    const box = slot.closest<HTMLElement>(".comment-popover");
    // this document's CSS and `<html>` attributes kept current while the field is in it (a document the frame swapped in
    // as it loaded too: this runs again for its body)
    const stopLive = goLive(body.ownerDocument, () => copyFace(slot, body));
    // the field's height is the frame's and the slot's; a new width wraps the text again
    let width = -1;
    const size = (): void => {
      const height = `${field.offsetHeight}px`;
      if (frame.style.height !== height) frame.style.height = height;
      if (row !== null && slot.style.height !== height) {
        slot.style.height = height;
        slot.toggleAttribute(SLOT_SIZED_ATTR, true);
      }
    };
    const fit = (): void => {
      if (field.clientWidth !== width) {
        width = field.clientWidth;
        draftRef.current.fit();
      }
      size();
    };
    if (row !== null) slot.style.maxHeight = view.getComputedStyle(field).maxHeight;
    fit();
    // the row's room as tall as the field now, in this commit: one layout of the code for the opening. The layer's pass
    // also places the frame over its slot (CodeComments.tsx `place`, the one owner of the frame's place)
    row?.sized();
    const resized = new view.ResizeObserver(fit);
    resized.observe(field);

    // keys the page listens for go on to it, from the slot; Tab moves on in the page's order
    const onKeyDown = (event: KeyboardEvent): void => {
      const what = frameKey(event);
      if (what === null) return;
      if (what === "tab") {
        event.preventDefault();
        focusBeside(slot, event.shiftKey);
        return;
      }
      const init: KeyboardEventInit = { bubbles: true, cancelable: true, composed: true };
      for (const name of KEY_FIELDS) (init as Record<string, unknown>)[name] = event[name];
      const copy = new KeyboardEvent("keydown", init);
      slot.dispatchEvent(copy);
      if (copy.defaultPrevented) event.preventDefault();
      // the copy went through the box's own Escape (React's root in the page): not a second time from the field
      if (event.key === "Escape") event.stopPropagation();
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.isComposing || !frameKeyUp(event)) return;
      const init: KeyboardEventInit = { bubbles: true, cancelable: true, composed: true };
      for (const name of KEY_FIELDS) (init as Record<string, unknown>)[name] = event[name];
      slot.dispatchEvent(new KeyboardEvent("keyup", init));
    };
    // the card's edge takes the accent while its field has the focus (`:focus-within` does not see into the frame)
    const onFocusIn = (): void => { box?.toggleAttribute("data-field-focus", true); };
    const onFocusOut = (): void => { box?.toggleAttribute("data-field-focus", false); };

    // the row's field above a soft keyboard: the viewer's body scrolls it there (the page is pinned, lib/viewport.ts)
    let frameId = 0;
    const reveal = (): void => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        const scroller = row?.scroller.current;
        if (!scroller || box === null || body.ownerDocument.activeElement !== field) return;
        const vv = window.visualViewport;
        const area = scroller.getBoundingClientRect();
        const bottom = vv === null ? area.bottom : Math.min(area.bottom, vv.offsetTop + vv.height);
        const delta = scrollDelta(box.getBoundingClientRect(), { top: area.top, bottom }, 8);
        if (delta !== 0) scroller.scrollTop += delta;
      });
    };
    const onViewport = (): void => reveal();

    view.addEventListener("keydown", onKeyDown, true);
    view.addEventListener("keyup", onKeyUp, true);
    body.ownerDocument.addEventListener("focusin", onFocusIn);
    body.ownerDocument.addEventListener("focusout", onFocusOut);
    if (row !== null) window.visualViewport?.addEventListener("resize", onViewport);
    if (body.ownerDocument.activeElement === field) onFocusIn();

    draftRef.current.focusStart();
    // a keyboard already up (from another field) does not resize the view again
    if (row !== null && keyboardUp()) reveal();
    return () => {
      stopLive();
      resized.disconnect();
      window.cancelAnimationFrame(frameId);
      view.removeEventListener("keydown", onKeyDown, true);
      view.removeEventListener("keyup", onKeyUp, true);
      body.ownerDocument.removeEventListener("focusin", onFocusIn);
      body.ownerDocument.removeEventListener("focusout", onFocusOut);
      if (row !== null) window.visualViewport?.removeEventListener("resize", onViewport);
      box?.removeAttribute("data-field-focus");
    };
  }, [body, row]);

  // the plain field in the slot's place: sized and given its first focus as the draft gives a field drawn with it
  useLayoutEffect(() => {
    if (!failed) return;
    draftRef.current.fit();
    draftRef.current.focusStart();
  }, [failed]);

  // a focus on the slot (Tab, Shift+Tab, a script's) is the field's
  const onFocus = (): void => { draftRef.current.field.current?.focus({ preventScroll: true }); };
  if (failed) return <CommentField draft={draft} />;
  const portal = body === null ? null : createPortal(<CommentField draft={draft} />, body);
  if (row !== null) {
    return <div ref={slotRef} className={FIELD_SLOT_CLASS} tabIndex={0} aria-owns={row.id} onFocus={onFocus}>{portal}</div>;
  }
  return <div ref={slotRef} className={FIELD_SLOT_CLASS} tabIndex={0} onFocus={onFocus}>
    <iframe ref={ownFrame} className={FRAME_CLASS} title={t("Comment")} tabIndex={-1} />
    {portal}
  </div>;
}
