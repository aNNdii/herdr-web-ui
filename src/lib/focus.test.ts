import { describe, expect, it } from "bun:test";

import { deepActiveElement, isTypingField } from "./focus.ts";

describe("deepActiveElement", () => {
  it("follows a focused frame into its document", () => {
    const textarea = { localName: "textarea" };
    const frame = { localName: "iframe", contentDocument: { activeElement: textarea } };
    expect(deepActiveElement({ activeElement: frame as unknown as Element })).toBe(textarea as unknown as Element);
  });
  it("stops at a frame whose document cannot be read", () => {
    const frame = { localName: "iframe", get contentDocument(): never { throw new Error("cross-origin"); } };
    expect(deepActiveElement({ activeElement: frame as unknown as Element })).toBe(frame as unknown as Element);
  });
  it("is the active element itself otherwise, null for none", () => {
    const button = { localName: "button" };
    expect(deepActiveElement({ activeElement: button as unknown as Element })).toBe(button as unknown as Element);
    expect(deepActiveElement({ activeElement: null })).toBeNull();
  });
});

describe("isTypingField", () => {
  const element = (props: Record<string, unknown>) => ({
    classList: { contains: (name: string) => ((props["classes"] as string[] | undefined) ?? []).includes(name) },
    closest: (selector: string) => (selector === "[data-direct-typing]" && props["direct"] === true ? {} : null),
    ...props,
  }) as unknown as Element;
  it("counts a textarea, a text input and an editable element", () => {
    expect(isTypingField(element({ localName: "textarea" }))).toBe(true);
    expect(isTypingField(element({ localName: "input", type: "text" }))).toBe(true);
    expect(isTypingField(element({ localName: "div", isContentEditable: true }))).toBe(true);
  });
  it("counts xterm's helper only in direct typing", () => {
    expect(isTypingField(element({ localName: "textarea", classes: ["xterm-helper-textarea"] }))).toBe(false);
    expect(isTypingField(element({ localName: "textarea", classes: ["xterm-helper-textarea"], direct: true }))).toBe(true);
  });
  it("does not count a checkbox, a frame or nothing", () => {
    expect(isTypingField(element({ localName: "input", type: "checkbox" }))).toBe(false);
    expect(isTypingField(element({ localName: "iframe" }))).toBe(false);
    expect(isTypingField(null)).toBe(false);
  });
});
