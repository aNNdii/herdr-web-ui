import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SettingsProvider } from "../lib/settings.ts";
import { ReviewDialog } from "./ReviewDialog.tsx";

const decode = (text: string): string => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

/** The buttons of the group labelled `label`: their text and whether each is pressed. */
function segments(html: string, label: string): { text: string; pressed: boolean }[] {
  const group = new RegExp(`<div class="segmented review-scope" role="group" aria-label="${label}">(.*?)</div>`).exec(html);
  expect(group, `a group named ${label}`).not.toBeNull();
  return [...group![1]!.matchAll(/<button type="button" aria-pressed="(true|false)"[^>]*>(.*?)<\/button>/g)]
    .map((button) => ({ text: decode(button[2]!.replace(/<[^>]*>/g, "")), pressed: button[1] === "true" }));
}

// The dialog's first render, before any effect: what a review shows as it opens, in English
describe("ReviewDialog as it opens", () => {
  const saved = new Map<string, PropertyDescriptor | undefined>();
  beforeEach(() => {
    for (const key of ["window", "navigator"]) saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { languages: ["en-US"] } });
    Object.defineProperty(globalThis, "window", { configurable: true, value: {
      matchMedia: () => ({ matches: false }),
      localStorage: { getItem: () => null, setItem() {} },
    } });
  });
  afterEach(() => {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });

  const render = (): string => renderToStaticMarkup(createElement(SettingsProvider, {
    children: createElement(ReviewDialog, { paneId: "w1:p1", directory: "/repo", onClose: () => {} }),
  }));

  test("the line under the title compares the uncommitted changes, its picker closed, and the tree column has no Compare fields", () => {
    const html = render();
    const part = /<div class="review-meta"><div class="compare-line">(<button[^>]*>)(.*?)<\/button><\/div><\/div>/.exec(html);
    expect(part, "the comparison's part under the title").not.toBeNull();
    expect(decode(part![2]!.replace(/<[^>]*>/g, ""))).toBe("Uncommitted changes");
    expect(part![1]).toContain("aria-haspopup=\"dialog\"");
    expect(part![1]).toContain("aria-expanded=\"false\"");
    expect(html).not.toContain("role=\"combobox\"");
    expect(html).not.toContain("aria-label=\"Compare\"");
  });

  test("the Changed files list is shown first, and no switch before Branches opens", () => {
    const html = render();
    expect(segments(html, "Files shown").map((button) => button.pressed)).toEqual([false, true]);
    expect(html).not.toContain("role=\"switch\"");
  });

  test("the note under the comparison is in the document from the first render, empty and clipped", () => {
    expect(render()).toContain("<p class=\"visually-hidden review-compare-note\" role=\"status\"></p>");
  });
});
