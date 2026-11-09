import { afterEach, expect, it } from "bun:test";
import { MAX_COMPOSER_CHARS } from "./compose.ts";
import { composerDraftKey, composerDrafts } from "./composerDraft.ts";
import { quoteOffer } from "./selectionQuote.ts";

const pane = "local:selection-quote-test";
const key = composerDraftKey(pane);
afterEach(() => composerDrafts.set(key, ""));

it("offers no Quote without a pane to quote into or words to quote", () => {
  expect(quoteOffer(null, "backfill it")).toBeNull();
  expect(quoteOffer(pane, null)).toBeNull();
  expect(quoteOffer(pane, " \n ")).toBeNull();
});

it("quotes the words into the pane's draft after what it holds, for an agent alone", () => {
  composerDrafts.set(key, "Before step 1:");
  const offer = quoteOffer(pane, "backfill it from updated_at");
  expect(offer?.fits).toBe(true);
  expect(offer?.put()).toBe(true);
  expect(composerDrafts.read(key).text).toBe("Before step 1:\n\n> backfill it from updated_at\n\n");
  expect(composerDrafts.isAgentOnly(key)).toBe(true);
});

it("refuses a quote too long for the draft, never cut, and leaves the draft as it was", () => {
  composerDrafts.set(key, "x".repeat(MAX_COMPOSER_CHARS - 10));
  const offer = quoteOffer(pane, "a quote longer than the room left");
  expect(offer?.fits).toBe(false);
  expect(offer?.put()).toBe(false);
  expect(composerDrafts.read(key).text).toBe("x".repeat(MAX_COMPOSER_CHARS - 10));
});
