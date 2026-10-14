import { describe, expect, it } from "bun:test";

import { fieldAnchor, frameKey, frameKeyUp, framedField, scrollDelta, setFrameAnchor, sheetsText } from "./frameField.ts";

const key = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean; isComposing: boolean; keyCode: number }> = {}) => ({
  key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods,
});

describe("frameKey", () => {
  it("forwards Escape and the app's Mod+Shift shortcuts", () => {
    expect(frameKey(key("Escape"))).toBe("forward");
    expect(frameKey(key("K", { metaKey: true, shiftKey: true }))).toBe("forward");
    expect(frameKey(key(",", { ctrlKey: true, shiftKey: true }))).toBe("forward");
    expect(frameKey(key(" ", { metaKey: true, shiftKey: true }))).toBe("forward");
  });
  it("leaves Mod+Shift+Arrow to the text (keepsArrowsForText)", () => {
    expect(frameKey(key("ArrowUp", { metaKey: true, shiftKey: true }))).toBeNull();
  });
  it("takes Tab and Shift+Tab, not Ctrl+Tab", () => {
    expect(frameKey(key("Tab"))).toBe("tab");
    expect(frameKey(key("Tab", { shiftKey: true }))).toBe("tab");
    expect(frameKey(key("Tab", { ctrlKey: true }))).toBeNull();
  });
  it("leaves a key of an IME composition alone", () => {
    expect(frameKey(key("Escape", { isComposing: true }))).toBeNull();
    expect(frameKey(key("Process", { keyCode: 229 }))).toBeNull();
    expect(frameKey(key("Tab", { keyCode: 229 }))).toBeNull();
  });
  it("leaves Enter, Mod+Enter and text to the field", () => {
    expect(frameKey(key("Enter", { metaKey: true }))).toBeNull();
    expect(frameKey(key("Enter"))).toBeNull();
    expect(frameKey(key("a"))).toBeNull();
  });
});

describe("frameKeyUp", () => {
  it("forwards the release of a forwarded key and of the shortcut modifiers", () => {
    expect(frameKeyUp(key(" ", { metaKey: true, shiftKey: true }))).toBe(true);
    expect(frameKeyUp(key("Shift"))).toBe(true);
    expect(frameKeyUp(key("Meta"))).toBe(true);
    expect(frameKeyUp(key("Control"))).toBe(true);
  });
  it("keeps a typed key's release", () => {
    expect(frameKeyUp(key("a"))).toBe(false);
    expect(frameKeyUp(key(" "))).toBe(false);
    expect(frameKeyUp(key("Tab"))).toBe(false);
  });
});

describe("scrollDelta", () => {
  it("scrolls a box below the view up into it, with the margin", () => {
    expect(scrollDelta({ top: 100, bottom: 300 }, { top: 0, bottom: 250 }, 8)).toBe(58);
  });
  it("leaves a box in view", () => {
    expect(scrollDelta({ top: 10, bottom: 50 }, { top: 0, bottom: 250 }, 8)).toBe(0);
  });
  it("scrolls a box above the view down into it", () => {
    expect(scrollDelta({ top: -20, bottom: 50 }, { top: 0, bottom: 250 }, 8)).toBe(-28);
  });
  it("shows the top of a box taller than the view", () => {
    expect(scrollDelta({ top: 100, bottom: 600 }, { top: 0, bottom: 250 }, 8)).toBe(92);
  });
});

describe("sheetsText", () => {
  it("joins the rules, a sheet's media wrapped around its own", () => {
    const text = sheetsText([
      { cssRules: [{ cssText: "a { color: red; }" }], media: { mediaText: "" } },
      { cssRules: [{ cssText: "b { color: blue; }" }, { cssText: "i { color: green; }" }], media: { mediaText: "print" } },
    ]);
    expect(text).toContain("a { color: red; }");
    expect(text).toContain("@media print{b { color: blue; }\ni { color: green; }}");
    expect(text).not.toContain("@media all");
  });
  it("skips a sheet whose rules cannot be read", () => {
    const blocked = { get cssRules(): never { throw new Error("cross-origin"); } };
    expect(sheetsText([blocked, { cssRules: [{ cssText: "p {}" }] }])).toBe("p {}");
  });
  it("resolves a relative url against the sheet's own address", () => {
    const text = sheetsText([{ href: "https://host/app/assets/index.css", cssRules: [{ cssText: "@font-face { src: url(\"./font.woff2\"); }" }, { cssText: "x { background: url(data:image/png;base64,AA); }" }] }]);
    expect(text).toContain("url(\"https://host/app/assets/font.woff2\")");
    expect(text).toContain("url(data:image/png;base64,AA)");
  });
});

describe("fieldAnchor and framedField", () => {
  it("maps a registered frame, and a node in its document, to its slot", () => {
    const textarea = { localName: "textarea" };
    const frame = { localName: "iframe", contentDocument: { querySelector: () => textarea } };
    const slot = { localName: "div" };
    const inside = { localName: "textarea", ownerDocument: { defaultView: { frameElement: frame } } };
    setFrameAnchor(frame as unknown as Element, slot as unknown as Element);
    expect(fieldAnchor(frame as unknown as Element)).toBe(slot as unknown as Element);
    expect(fieldAnchor(inside as unknown as Element)).toBe(slot as unknown as Element);
    expect(framedField(slot as unknown as Element)).toBe(textarea as unknown as HTMLTextAreaElement);
    setFrameAnchor(frame as unknown as Element, null);
    expect(fieldAnchor(frame as unknown as Element)).toBe(frame as unknown as Element);
    expect(framedField(slot as unknown as Element)).toBeNull();
  });
  it("is the node itself, and no field, without a frame", () => {
    const node = { localName: "button" };
    expect(fieldAnchor(node as unknown as Element)).toBe(node as unknown as Element);
    expect(framedField(null)).toBeNull();
    expect(framedField(node as unknown as Element)).toBeNull();
  });
});
