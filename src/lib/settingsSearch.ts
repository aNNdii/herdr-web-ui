/**
 * Settings' pages, their deep link (`#settings/<page>`) and its search. Pure logic: the dialog
 * (components/SettingsDialog.tsx) and its pages (components/settings/) draw it.
 */

/** Every page, in the navigation's order. The id is the deep link's `<page>`. */
export const SETTINGS_PAGES = ["appearance", "terminal", "chat", "voice", "notifications", "shortcuts", "devices", "remote-pcs", "usage", "about"] as const;
export type SettingsPageId = (typeof SETTINGS_PAGES)[number];

const HASH_PREFIX = "#settings";

/**
 * What a location hash asks of Settings: null when it is not a Settings link at all (`#auth=…`
 * belongs to lib/authLink.ts), else the page it names, or null for the list (`#settings`, or a
 * page this version does not have).
 */
export function parseSettingsHash(hash: string): { page: SettingsPageId | null } | null {
  if (hash !== HASH_PREFIX && !hash.startsWith(`${HASH_PREFIX}/`)) return null;
  let name = "";
  try { name = decodeURIComponent(hash.slice(HASH_PREFIX.length + 1)); } catch { /* a malformed escape names no page */ }
  return { page: (SETTINGS_PAGES as readonly string[]).includes(name) ? name as SettingsPageId : null };
}

/** The hash for a page, or for the list of pages (a phone's first screen). */
export function settingsHash(page: SettingsPageId | null): string {
  return page === null ? HASH_PREFIX : `${HASH_PREFIX}/${page}`;
}

function fold(text: string): string {
  return text.normalize("NFKC").toLocaleLowerCase();
}

/** The words of a search, folded: each one has to be found for a row to stay. */
export function searchWords(query: string): string[] {
  return fold(query).split(/\s+/).filter((word) => word !== "");
}

/**
 * Whether a row stays in the results: every word is found somewhere in its texts (its label and
 * description in the language shown, its English keywords, its group's and page's titles).
 * No words keep every row.
 */
export function matchesSearch(words: readonly string[], texts: ReadonlyArray<string | null | undefined>): boolean {
  if (words.length === 0) return true;
  const haystack = fold(texts.filter((text): text is string => typeof text === "string" && text !== "").join(" "));
  return words.every((word) => haystack.includes(word));
}
